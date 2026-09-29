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

  it('rejects invalid messages', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const res = await a.request('room:join', { name: '' });
    expect(res).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });
});

describe('room persistence and timers', () => {
  it('stores state in SQLite and times out the current player on the alarm', async () => {
    const code = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    await a.request('room:join', { name: 'Ana' });
    await b.request('room:join', { name: 'Ben' });
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
