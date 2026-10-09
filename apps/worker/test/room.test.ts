import type { ServerMessage } from '@nomercy/engine';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Room } from '../src/room';

const BASE = 'http://example.com';

async function createRoom(): Promise<string> {
  const res = await exports.default.fetch(`${BASE}/api/rooms`, { method: 'POST' });
  expect(res.status).toBe(200);
  return ((await res.json()) as { code: string }).code;
}

let nextRequest = 0;

async function connect(code: string) {
  const res = await exports.default.fetch(`${BASE}/api/rooms/${code}/ws`, { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const msgs: ServerMessage[] = [];
  ws.addEventListener('message', (e) => {
    msgs.push(JSON.parse(e.data as string) as ServerMessage);
  });

  const waitFor = async <T extends ServerMessage>(pred: (m: ServerMessage) => m is T, from = 0): Promise<T> => {
    for (let i = 0; i < 200; i++) {
      const found = msgs.slice(from).find(pred);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for message');
  };

  const request = async (type: string, payload: object = {}) => {
    const requestId = `r${nextRequest++}`;
    ws.send(JSON.stringify({ type, requestId, payload }));
    return waitFor((m): m is Extract<ServerMessage, { type: 'ack' }> => m.type === 'ack' && m.requestId === requestId);
  };

  const latest = <K extends ServerMessage['type']>(type: K) =>
    msgs.filter((m): m is Extract<ServerMessage, { type: K }> => m.type === type).at(-1);

  return { ws, msgs, waitFor, request, latest };
}

describe('room API', () => {
  it('creates a room and reports it exists', async () => {
    const code = await createRoom();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const info = await (await exports.default.fetch(`${BASE}/api/rooms/${code}`)).json();
    expect(info).toEqual({ exists: true, status: 'lobby', players: 0 });
  });

  it('rejects malformed codes and unknown rooms', async () => {
    expect((await exports.default.fetch(`${BASE}/api/rooms/bad`)).status).toBe(400);
    const info = await (await exports.default.fetch(`${BASE}/api/rooms/ZZZZZZ`)).json();
    expect(info).toEqual({ exists: false });
  });
});

describe('room over WebSocket', () => {
  it('seats players, starts a game, and hides other hands', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);

    expect((await a.request('room:join', { name: 'Ana' })).ok).toBe(true);
    expect((await b.request('room:join', { name: 'Ben' })).ok).toBe(true);
    const bStart = await b.request('game:start');
    expect(bStart.ok).toBe(false);

    expect(await a.request('game:start')).toMatchObject({ ok: false, error: { code: 'not_ready' } });
    expect((await b.request('room:ready', { ready: true })).ok).toBe(true);
    expect(a.latest('room:state')!.room.players.find((p) => p.name === 'Ben')!.ready).toBe(true);

    expect((await a.request('game:start')).ok).toBe(true);
    const gameA = await a.waitFor((m): m is Extract<ServerMessage, { type: 'game:state' }> => m.type === 'game:state');
    await b.waitFor((m) => m.type === 'game:state');

    expect(gameA.game.hand).toHaveLength(7);
    expect(gameA.game.players.map((p) => p.cardCount)).toEqual([7, 7]);
    expect(gameA.deadline).toBeGreaterThan(Date.now());
    const bHandIds = b.latest('game:state')!.game.hand.map((c) => c.id);
    expect(bHandIds.some((id) => JSON.stringify(a.msgs).includes(`"${id}"`))).toBe(false);
  });

  it('rejects moves out of turn and stale versions, and accepts a legal draw', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    await b.request('room:ready', { ready: true });
    await a.request('game:start');
    const state = await a.waitFor((m): m is Extract<ServerMessage, { type: 'game:state' }> => m.type === 'game:state');

    const me = state.game.youId!;
    const turn = state.game.currentPlayerId === me ? a : b;
    const other = turn === a ? b : a;

    const wrong = await other.request('game:draw', { stateVersion: state.stateVersion });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'not_your_turn' } });

    const stale = await turn.request('game:draw', { stateVersion: state.stateVersion - 1 });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale' } });

    const draw = await turn.request('game:draw', { stateVersion: state.stateVersion });
    expect(draw.ok).toBe(true);
  });

  it('lets a player rejoin their seat with the token', async () => {
    const code = await createRoom();
    const a = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    const welcome = await a.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    a.ws.close();

    const again = await connect(code);
    expect((await again.request('room:rejoin', { playerToken: welcome.playerToken })).ok).toBe(true);
    const back = await again.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    expect(back.playerId).toBe(welcome.playerId);

    const bad = await (await connect(code)).request('room:rejoin', { playerToken: 'nope' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'unknown_token' } });
  });

  it('keeps a room scoreboard that the host can reset', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    const c = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    await c.request('room:join', { name: 'Cy' });
    await b.request('room:ready', { ready: true });
    await c.request('room:ready', { ready: true });
    await a.request('game:start');
    expect(a.latest('room:state')!.room.gamesPlayed).toBe(0);

    // Ben and Cy leave, so Ana wins the game.
    await b.request('room:leave');
    await c.request('room:leave');
    const finished = await a.waitFor(
      (m): m is Extract<ServerMessage, { type: 'room:state' }> => m.type === 'room:state' && m.room.status === 'finished',
    );
    expect(finished.room.gamesPlayed).toBe(1);
    expect(finished.room.players.find((p) => p.name === 'Ana')?.wins).toBe(1);

    const d = await connect(code);
    await a.request('room:lobby');
    await d.request('room:join', { name: 'Dee' });
    expect(await d.request('room:resetScores')).toMatchObject({ ok: false, error: { code: 'not_host' } });
    expect((await a.request('room:resetScores')).ok).toBe(true);
    const reset = a.latest('room:state')!.room;
    expect(reset.gamesPlayed).toBe(0);
    expect(reset.players.every((p) => p.wins === 0)).toBe(true);
  });

  it('lets players rename themselves in the lobby only, with unique names', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    expect(await b.request('room:rename', { name: ' ana ' })).toMatchObject({ ok: false, error: { code: 'name_taken' } });
    expect((await b.request('room:rename', { name: '   ' })).ok).toBe(false);
    expect((await b.request('room:rename', { name: ' Benny ' })).ok).toBe(true);
    expect(a.latest('room:state')!.room.players.map((p) => p.name)).toEqual(['Ana', 'Benny']);

    await b.request('room:ready', { ready: true });
    await a.request('game:start');
    expect(await a.request('room:rename', { name: 'Anna' })).toMatchObject({ ok: false, error: { code: 'game_in_progress' } });
  });

  it('lets the host take a finished room back to the lobby', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    await b.request('room:ready', { ready: true });
    await a.request('game:start');
    expect(await a.request('room:lobby')).toMatchObject({ ok: false, error: { code: 'game_in_progress' } });

    // Ben forfeits, so Ana wins and the room is finished.
    await b.request('room:leave');
    await a.waitFor((m): m is Extract<ServerMessage, { type: 'room:state' }> => m.type === 'room:state' && m.room.status === 'finished');
    expect((await b.request('room:lobby')).ok).toBe(false);

    expect((await a.request('room:lobby')).ok).toBe(true);
    const lobby = a.latest('room:state')!.room;
    expect(lobby.status).toBe('lobby');
    expect(lobby.players.map((p) => p.name)).toEqual(['Ana']);

    const c = await connect(code);
    expect((await c.request('room:join', { name: 'Cy' })).ok).toBe(true);
    expect(await a.request('game:start')).toMatchObject({ ok: false, error: { code: 'not_ready' } });
    await c.request('room:ready', { ready: true });
    expect((await a.request('game:start')).ok).toBe(true);
    // Ready flags reset once the game is under way.
    expect(a.latest('room:state')!.room.players.every((p) => !p.ready)).toBe(true);
  });

  it('relays throws between seated players with a cooldown', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    const watcher = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    const ben = await b.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    const ana = await a.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');

    expect((await a.request('room:throw', { targetId: ben.playerId, item: 'shoe' })).ok).toBe(true);
    const seen = await watcher.waitFor((m): m is Extract<ServerMessage, { type: 'throw' }> => m.type === 'throw');
    expect(seen).toMatchObject({ fromId: ana.playerId, targetId: ben.playerId, item: 'shoe' });
    await b.waitFor((m) => m.type === 'throw');

    expect(await a.request('room:throw', { targetId: ben.playerId, item: 'egg' })).toMatchObject({
      ok: false,
      error: { code: 'slow_down' },
    });
    expect(await b.request('room:throw', { targetId: ben.playerId, item: 'egg' })).toMatchObject({
      ok: false,
      error: { code: 'bad_target' },
    });
    expect(await b.request('room:throw', { targetId: ana.playerId, item: 'sword' })).toMatchObject({
      ok: false,
      error: { code: 'bad_message' },
    });
    expect(await watcher.request('room:throw', { targetId: ana.playerId, item: 'rose' })).toMatchObject({
      ok: false,
      error: { code: 'not_seated' },
    });
  });

  it('rejects invalid messages', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const res = await a.request('room:join', { name: '' });
    expect(res).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });
});

describe('voting to end the game', () => {
  type RoomState = Extract<ServerMessage, { type: 'room:state' }>;

  async function startGame(names: string[]) {
    const code = await createRoom();
    const conns = [];
    for (const name of names) {
      const c = await connect(code);
      await c.request('room:join', { name });
      conns.push(c);
    }
    for (const c of conns.slice(1)) await c.request('room:ready', { ready: true });
    expect((await conns[0]!.request('game:start')).ok).toBe(true);
    await conns[0]!.waitFor((m) => m.type === 'game:state');
    return { code, conns };
  }

  it('finishes the game when a majority agrees', async () => {
    const { conns } = await startGame(['Ana', 'Ben', 'Cy']);
    const [a, b, c] = conns as [Awaited<ReturnType<typeof connect>>, Awaited<ReturnType<typeof connect>>, Awaited<ReturnType<typeof connect>>];
    expect((await b.request('game:endVote', { outcome: 'finish' })).ok).toBe(true);
    const running = a.latest('room:state')!.room.endVote!;
    expect(running).toMatchObject({ outcome: 'finish', voterIds: expect.any(Array), noIds: [] });
    expect(running.yesIds).toHaveLength(1);
    expect(await c.request('game:endVote', { outcome: 'cancel' })).toMatchObject({ ok: false, error: { code: 'vote_running' } });

    const from = a.msgs.length;
    expect((await c.request('game:vote', { agree: true })).ok).toBe(true);
    const done = await a.waitFor((m): m is RoomState => m.type === 'room:state' && m.room.status === 'finished', from);
    expect(done.room.endVote).toBeNull();
    expect(a.latest('game:state')!.game.phase).toMatchObject({ kind: 'roundOver', early: { reason: 'vote' } });
    await a.waitFor((m) => m.type === 'notice', from);
  });

  it('cancels back to the lobby, and drops a vote once it cannot pass', async () => {
    const { code, conns } = await startGame(['Ana', 'Ben']);
    const [a, b] = conns as [Awaited<ReturnType<typeof connect>>, Awaited<ReturnType<typeof connect>>];

    // Two players: both must agree, so one "no" ends the vote.
    await a.request('game:endVote', { outcome: 'cancel' });
    const from = a.msgs.length;
    await b.request('game:vote', { agree: false });
    await a.waitFor((m) => m.type === 'notice', from);
    expect(a.latest('room:state')!.room).toMatchObject({ status: 'playing', endVote: null });
    expect(await a.request('game:endVote', { outcome: 'cancel' })).toMatchObject({ ok: false, error: { code: 'slow_down' } });

    // Skip the cooldown, then pass a cancel vote.
    await runInDurableObject(env.ROOMS.getByName(code), (instance: Room) => {
      (instance as unknown as { room: { lastVoteEndedAt: number } }).room.lastVoteEndedAt = 0;
    });
    await a.request('game:endVote', { outcome: 'cancel' });
    await b.request('game:vote', { agree: true });
    await a.waitFor((m): m is RoomState => m.type === 'room:state' && m.room.status === 'lobby');

    const watcher = await connect(code);
    expect(await watcher.request('game:vote', { agree: true })).toMatchObject({ ok: false, error: { code: 'not_seated' } });
  });

  it('lets a vote lapse on the alarm', async () => {
    const { code, conns } = await startGame(['Ana', 'Ben', 'Cy']);
    const a = conns[0]!;
    await a.request('game:endVote', { outcome: 'finish' });
    const stub = env.ROOMS.getByName(code);
    await runInDurableObject(stub, (instance: Room) => {
      const room = (instance as unknown as { room: { endVote: { expiresAt: number }; deadline: number } }).room;
      room.endVote.expiresAt = Date.now() - 1000;
      room.deadline = Date.now() + 60_000;
    });
    const from = a.msgs.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await a.waitFor((m) => m.type === 'notice', from);
    expect(a.latest('room:state')!.room).toMatchObject({ status: 'playing', endVote: null });
  });
});

describe('room persistence and timers', () => {
  it('ends the game when the match clock runs out', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    expect(await b.request('room:settings', { matchMinutes: 10 })).toMatchObject({ ok: false, error: { code: 'not_host' } });
    expect(await a.request('room:settings', { matchMinutes: 6 })).toMatchObject({ ok: false, error: { code: 'bad_message' } });
    expect((await a.request('room:settings', { matchMinutes: 10 })).ok).toBe(true);
    // Changing one setting keeps the other.
    expect(a.latest('room:state')!.room.settings).toEqual({ turnSeconds: 30, matchMinutes: 10 });

    await b.request('room:ready', { ready: true });
    await a.request('game:start');
    const started = await a.waitFor(
      (m): m is Extract<ServerMessage, { type: 'room:state' }> => m.type === 'room:state' && m.room.status === 'playing',
    );
    expect(started.room.matchEndsAt).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect((await a.request('room:settings', { matchMinutes: 5 })).ok).toBe(false);

    const stub = env.ROOMS.getByName(code);
    await runInDurableObject(stub, (instance: Room, state) => {
      const row = state.storage.sql.exec<{ data: string }>('SELECT data FROM room WHERE id = 1').one();
      const room = JSON.parse(row.data);
      room.matchEndsAt = Date.now() - 1000;
      state.storage.sql.exec('UPDATE room SET data = ? WHERE id = 1', JSON.stringify(room));
      (instance as unknown as { room: unknown }).room = room;
    });

    const from = a.msgs.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const events = await a.waitFor(
      (m): m is Extract<ServerMessage, { type: 'game:events' }> => m.type === 'game:events',
      from,
    );
    expect(events.events.map((e) => e.type)).toEqual(['timeUp', 'won']);
    const finished = await a.waitFor(
      (m): m is Extract<ServerMessage, { type: 'room:state' }> => m.type === 'room:state' && m.room.status === 'finished',
      from,
    );
    expect(finished.room.matchEndsAt).toBeNull();
    const game = a.latest('game:state')!.game;
    expect(game.phase).toMatchObject({ kind: 'roundOver' });
  });

  it('stores state in SQLite and times out the current player on the alarm', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    await b.request('room:ready', { ready: true });
    await a.request('game:start');
    await a.waitFor((m) => m.type === 'game:state');

    const stub = env.ROOMS.getByName(code);
    const before = await runInDurableObject(stub, (_instance: Room, state) => {
      const row = state.storage.sql.exec<{ data: string }>('SELECT data FROM room WHERE id = 1').one();
      const room = JSON.parse(row.data);
      // Pretend the turn clock ran out.
      room.deadline = Date.now() - 1000;
      state.storage.sql.exec('UPDATE room SET data = ? WHERE id = 1', JSON.stringify(room));
      (_instance as unknown as { room: unknown }).room = room;
      return room as { status: string; stateVersion: number; game: { currentIndex: number } };
    });
    expect(before.status).toBe('playing');

    const from = a.msgs.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const events = await a.waitFor(
      (m): m is Extract<ServerMessage, { type: 'game:events' }> => m.type === 'game:events',
      from,
    );
    expect(events.events[0]?.type).toBe('timedOut');
  });
});

describe('reactions', () => {
  it('relays allowed emoji to everyone and rejects others and spam', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    const welcome = await a.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');

    expect((await a.request('room:react', { emoji: '🔥' })).ok).toBe(true);
    const got = await b.waitFor((m): m is Extract<ServerMessage, { type: 'reaction' }> => m.type === 'reaction');
    expect(got).toEqual({ type: 'reaction', playerId: welcome.playerId, emoji: '🔥' });

    const spam = await a.request('room:react', { emoji: '😂' });
    expect(spam).toMatchObject({ ok: false, error: { code: 'slow_down' } });

    const bad = await b.request('room:react', { emoji: '🍕' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });
});

describe('chat', () => {
  it('relays cleaned messages to seated players and keeps history for rejoin', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    const viewer = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    const welcome = await a.waitFor((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');

    expect((await a.request('room:chat', { text: '  gg   no\nmercy  ' })).ok).toBe(true);
    const got = await b.waitFor((m): m is Extract<ServerMessage, { type: 'chat' }> => m.type === 'chat');
    expect(got.message).toMatchObject({ playerId: welcome.playerId, name: 'Ana', text: 'gg no mercy' });
    expect(viewer.msgs.some((m) => m.type === 'chat')).toBe(false);

    // Reconnecting with the seat token brings the history back.
    a.ws.close();
    const again = await connect(code);
    await again.request('room:rejoin', { playerToken: welcome.playerToken });
    const history = await again.waitFor(
      (m): m is Extract<ServerMessage, { type: 'chat:history' }> => m.type === 'chat:history',
    );
    expect(history.messages.map((m) => m.text)).toEqual(['gg no mercy']);
  });

  it('rejects empty, too long, unseated and spammy messages', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const outsider = await connect(code);
    await a.request('room:join', { name: 'Ana' });

    expect(await a.request('room:chat', { text: '   ' })).toMatchObject({ ok: false, error: { code: 'bad_message' } });
    expect(await a.request('room:chat', { text: 'x'.repeat(201) })).toMatchObject({
      ok: false,
      error: { code: 'bad_message' },
    });
    expect(await outsider.request('room:chat', { text: 'hi' })).toMatchObject({
      ok: false,
      error: { code: 'not_seated' },
    });
    expect((await a.request('room:chat', { text: 'one' })).ok).toBe(true);
    expect(await a.request('room:chat', { text: 'two' })).toMatchObject({ ok: false, error: { code: 'slow_down' } });
  });
});

describe('spectators', () => {
  it('lets anyone with the code watch a started game without seeing hands', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    await b.request('room:ready', { ready: true });
    await a.request('game:start');

    const watcher = await connect(code);
    const view = await watcher.waitFor((m): m is Extract<ServerMessage, { type: 'game:state' }> => m.type === 'game:state');
    expect(view.game.youId).toBeNull();
    expect(view.game.hand).toEqual([]);
    expect(view.game.players.map((p) => p.cardCount)).toEqual([7, 7]);

    // Players see the watcher count go up.
    await a.waitFor(
      (m): m is Extract<ServerMessage, { type: 'room:state' }> => m.type === 'room:state' && m.room.spectators === 1,
    );

    // Watchers can't act or join mid-game.
    expect(await watcher.request('game:draw', { stateVersion: view.stateVersion })).toMatchObject({
      ok: false,
      error: { code: 'not_seated' },
    });
    expect(await watcher.request('room:join', { name: 'Cy' })).toMatchObject({
      ok: false,
      error: { code: 'game_in_progress' },
    });
  });
});

describe('bots', () => {
  it('lets the host add up to two bots, who are always ready', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
    expect(await b.request('room:addBot', { level: 'easy' })).toMatchObject({ ok: false, error: { code: 'not_host' } });
    expect((await a.request('room:addBot', { level: 'easy' })).ok).toBe(true);
    expect((await a.request('room:addBot', { level: 'hard' })).ok).toBe(true);
    expect(await a.request('room:addBot', { level: 'normal' })).toMatchObject({ ok: false, error: { code: 'too_many_bots' } });

    const bots = a.latest('room:state')!.room.players.filter((p) => p.bot);
    expect(bots.map((p) => p.bot)).toEqual(['easy', 'hard']);
    expect(bots.every((p) => p.ready && p.connected && p.name.startsWith('🤖'))).toBe(true);
    expect((await a.request('room:setBot', { playerId: bots[0]!.id, level: 'normal' })).ok).toBe(true);
    expect((await a.request('room:kick', { playerId: bots[1]!.id })).ok).toBe(true);
    expect(a.latest('room:state')!.room.players.filter((p) => p.bot).map((p) => p.bot)).toEqual(['normal']);
  });

  it('plays a bot turn on the alarm, and the bots go when the last person leaves', async () => {
    const code = await createRoom();
    const a = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await a.request('room:addBot', { level: 'hard' });
    expect((await a.request('game:start')).ok).toBe(true);

    const stub = env.ROOMS.getByName(code);
    type Rec = {
      seats: { id: string; bot?: string }[];
      game: { currentIndex: number; phase: { kind: string }; players: { id: string }[] };
      botAt: number | null;
      deadline: number;
    };
    const botId = await runInDurableObject(stub, (instance: Room) => {
      const room = (instance as unknown as { room: Rec }).room;
      const bot = room.seats.find((s) => s.bot)!;
      // Hand the turn to the bot and make its move due now.
      room.game.currentIndex = room.game.players.findIndex((p) => p.id === bot.id);
      room.game.phase = { kind: 'awaitingPlay' };
      room.botAt = Date.now() - 1;
      room.deadline = Date.now() + 60_000;
      return bot.id;
    });
    const from = a.msgs.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const moved = await a.waitFor(
      (m): m is Extract<ServerMessage, { type: 'game:events' }> =>
        m.type === 'game:events' && m.events.some((e) => 'playerId' in e && e.playerId === botId),
      from,
    );
    expect(moved.events.length).toBeGreaterThan(0);

    expect((await a.request('room:leave')).ok).toBe(true);
    expect(a.latest('room:state')!.room).toMatchObject({ status: 'lobby', players: [] });
  });
});

describe('quick play and public rooms', () => {
  const openRooms = async () =>
    ((await (await exports.default.fetch(`${BASE}/api/open-rooms`)).json()) as { rooms: { code: string; host: string; players: number }[] })
      .rooms;
  const quickPlay = async () => {
    const res = await exports.default.fetch(`${BASE}/api/quickplay`, { method: 'POST' });
    expect(res.status).toBe(200);
    return ((await res.json()) as { code: string }).code;
  };

  it('puts Quick play players together and lists public rooms until the game starts', async () => {
    const code = await quickPlay();
    const a = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    expect(a.latest('room:state')!.room.public).toBe(true);
    expect(await openRooms()).toContainEqual(expect.objectContaining({ code, host: 'Ana', players: 1 }));

    // The next Quick play player lands in the same room instead of a new one.
    expect(await quickPlay()).toBe(code);

    // Private rooms stay off the list until the host makes them public.
    const priv = await createRoom();
    const c = await connect(priv);
    await c.request('room:join', { name: 'Cy' });
    expect((await openRooms()).map((r) => r.code)).not.toContain(priv);
    expect((await c.request('room:public', { public: true })).ok).toBe(true);
    expect((await openRooms()).map((r) => r.code)).toContain(priv);

    const b = await connect(code);
    await b.request('room:join', { name: 'Ben' });
    await b.request('room:ready', { ready: true });
    expect((await a.request('game:start')).ok).toBe(true);
    expect((await openRooms()).map((r) => r.code)).not.toContain(code);
    expect((await c.request('room:public', { public: false })).ok).toBe(true);
    expect((await openRooms()).map((r) => r.code)).not.toContain(priv);
  });

  it('adds a bot to a Quick play room nobody else has joined', async () => {
    const code = await quickPlay();
    const a = await connect(code);
    await a.request('room:join', { name: 'Solo' });
    expect(a.latest('room:state')!.room.autoBotAt).toBeGreaterThan(Date.now());

    const stub = env.ROOMS.getByName(code);
    await runInDurableObject(stub, (instance: Room) => {
      (instance as unknown as { room: { autoBotAt: number } }).room.autoBotAt = Date.now() - 1;
    });
    const from = a.msgs.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await a.waitFor((m) => m.type === 'notice', from);
    const room = a.latest('room:state')!.room;
    expect(room.players.filter((p) => p.bot)).toHaveLength(1);
    expect(room.autoBotAt).toBeNull();
  });
});
