import { DurableObject } from 'cloudflare:workers';
import {
  AFK_STRIKES,
  applyAction,
  botAction,
  BOT_CATCH,
  BOT_THINK,
  BOT_UNO_CHANCE,
  type BotLevel,
  drawValue,
  MAX_BOTS,
  type Reaction,
  type Throwable,
  endEarly,
  createGame,
  current,
  DEFAULT_TURN_SECONDS,
  EngineError,
  MAX_PLAYERS,
  MIN_PLAYERS,
  REACTION_COOLDOWN_MS,
  THROW_COOLDOWN_MS,
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY,
  type ChatMessage,
  playerView,
  type Action,
  type ClientMessage,
  type ErrorInfo,
  type GameEvent,
  type GameState,
  type EndVote,
  END_VOTE_COOLDOWN_MS,
  END_VOTE_MS,
  type RoomSettings,
  type RoomStatus,
  type RoomView,
  type ServerMessage,
} from '@nomercy/engine';
import { parseClientMessage } from './schema';

/** Delete a room this long after its last player disconnects. */
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
/** Turn length for players marked AFK. */
const AFK_TURN_MS = 3_000;
const RATE_LIMIT_PER_SECOND = 10;
const BOT_NAMES = ['🤖 John', '🤖 Tom', '🤖 David', '🤖 Jerry', '🤖 Mike', '🤖 Sam', '🤖 Peter', '🤖 Alex'];
/** What a bot throws back when it's annoyed. */
const BOT_AMMO: Throwable[] = ['tomato', 'egg', 'shoe', 'pie', 'poop', 'angryShoe', 'angryStick', 'stone', 'sock', 'bomb'];
/** Minimum gap between one bot's emotes, so it never floods the table. */
const BOT_EMOTE_GAP_MS = 4_000;

interface Seat {
  id: string;
  token: string;
  name: string;
  joinedAt: number;
  afkStrikes: number;
  left: boolean;
  /** Optional so seats saved before the ready check still load (as not ready). */
  ready?: boolean;
  /** Games won in this room; optional so older rooms still load. */
  wins?: number;
  /** Set for a computer player: its difficulty. */
  bot?: BotLevel;
}

interface RoomRecord {
  code: string;
  hostId: string;
  status: RoomStatus;
  settings: RoomSettings;
  seats: Seat[];
  game: GameState | null;
  stateVersion: number;
  deadline: number | null;
  /** When the match clock runs out; optional so rooms saved before it existed still load. */
  matchEndsAt?: number | null;
  /** A running vote to end the game early; optional so older rooms still load. */
  endVote?: EndVote | null;
  lastVoteEndedAt?: number;
  gamesPlayed?: number;
  emptySince: number | null;
  /** Recent chat, oldest first. Optional so rooms saved before chat existed still load. */
  chat?: ChatMessage[];
  /** When the bot whose turn it is makes its move. */
  botAt?: number | null;
  /**
   * A bot's try at catching a player who forgot UNO; `at` is null once the bot decided to let it go,
   * so it only rolls once per chance.
   */
  botCatch?: { botId: string; targetId: string; at: number | null } | null;
}

interface SocketAttachment {
  playerId: string | null;
}

class RoomError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class Room extends DurableObject<Env> {
  private room: RoomRecord | null = null;
  private rate = new WeakMap<WebSocket, { windowStart: number; count: number }>();
  /** Last reaction time per player; in memory only, so it resets on hibernation. */
  private lastReaction = new Map<string, number>();
  private lastThrow = new Map<string, number>();
  private lastChat = new Map<string, number>();
  /** Who last played a draw card, for a bot to blame when it takes a stack. */
  private lastDrawBy: string | null = null;
  private lastBotEmote = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');
      const row = ctx.storage.sql.exec<{ data: string }>('SELECT data FROM room WHERE id = 1').toArray()[0];
      this.room = row ? (JSON.parse(row.data) as RoomRecord) : null;
    });
  }

  // --- RPC from the entry Worker -------------------------------------------

  /** Claims this room code. Returns false if the code is already in use. */
  async create(code: string): Promise<boolean> {
    if (this.room) return false;
    this.room = {
      code,
      hostId: '',
      status: 'lobby',
      settings: { turnSeconds: DEFAULT_TURN_SECONDS, matchMinutes: 0 },
      seats: [],
      game: null,
      stateVersion: 0,
      deadline: null,
      emptySince: Date.now(),
    };
    this.save();
    await this.scheduleAlarm();
    return true;
  }

  async info(): Promise<{ exists: boolean; status?: RoomStatus; players?: number }> {
    if (!this.room) return { exists: false };
    return { exists: true, status: this.room.status, players: this.room.seats.filter((s) => !s.left).length };
  }

  // --- WebSocket lifecycle ---------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (!this.room) return new Response('Room not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies SocketAttachment);
    // Everyone gets the new room view, so the watcher count stays current.
    this.broadcastRoom();
    if (this.room.game) this.sendGame(server, null);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    const parsed = parseClientMessage(raw);
    if (!this.allow(ws)) {
      this.reply(ws, parsed.requestId, { code: 'rate_limited', message: 'Slow down' });
      return;
    }
    if ('error' in parsed) {
      this.reply(ws, parsed.requestId, { code: 'bad_message', message: parsed.error });
      return;
    }
    try {
      await this.handle(ws, parsed);
      this.reply(ws, parsed.requestId);
    } catch (e) {
      if (e instanceof RoomError || e instanceof EngineError) {
        this.reply(ws, parsed.requestId, { code: e.code, message: e.message });
      } else {
        console.error('room error', e);
        this.reply(ws, parsed.requestId, { code: 'internal', message: 'Something went wrong' });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }

  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();

    if (room.endVote && now >= room.endVote.expiresAt - 50) {
      this.closeVote('⏱ The vote to end the game ran out of time');
      this.save();
      this.broadcastRoom();
    }

    if (room.status === 'playing' && room.game && room.matchEndsAt && now >= room.matchEndsAt - 50) {
      const { state, events } = endEarly(room.game, 'time');
      this.commit(state, events);
    } else if (room.status === 'playing' && room.botAt && now >= room.botAt - 50 && this.connectedIds().size > 0) {
      this.botMove();
    } else if (room.status === 'playing' && room.game && room.deadline !== null && now >= room.deadline - 50) {
      const seat = this.seat(current(room.game).id);
      if (seat) seat.afkStrikes++;
      this.runAction(current(room.game).id, { type: 'timeout' });
    }
    if (room.status === 'playing' && room.botCatch?.at && now >= room.botCatch.at - 50 && this.connectedIds().size > 0) {
      this.botCatchUno();
    }
    this.save();

    if (this.connectedIds().size === 0 && room.emptySince !== null && now >= room.emptySince + EMPTY_ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.scheduleAlarm();
  }

  // --- Message handling ------------------------------------------------------

  private async handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    const room = this.requireRoom();
    const me = this.attachment(ws).playerId;

    switch (msg.type) {
      case 'room:join': {
        if (me) throw new RoomError('already_joined', 'You already have a seat');
        if (room.status !== 'lobby') throw new RoomError('game_in_progress', 'This game has already started');
        if (this.seated().length >= MAX_PLAYERS) throw new RoomError('room_full', 'This room is full');
        const seat: Seat = {
          id: crypto.randomUUID(),
          token: crypto.randomUUID(),
          name: msg.payload.name,
          joinedAt: Date.now(),
          afkStrikes: 0,
          left: false,
          ready: false,
        };
        room.seats.push(seat);
        if (!this.seat(room.hostId)) room.hostId = seat.id;
        this.bind(ws, seat);
        break;
      }

      case 'room:rejoin': {
        const seat = room.seats.find((s) => s.token === msg.payload.playerToken && !s.left);
        if (!seat) throw new RoomError('unknown_token', 'Your seat is no longer available');
        for (const other of this.socketsFor(seat.id)) {
          if (other !== ws) other.close(4000, 'Opened in another tab');
        }
        seat.afkStrikes = 0;
        this.bind(ws, seat);
        break;
      }

      case 'room:leave': {
        const seat = this.requireSeat(me);
        this.leaveSeat(seat);
        ws.serializeAttachment({ playerId: null } satisfies SocketAttachment);
        break;
      }

      case 'room:rename': {
        const seat = this.requireSeat(me);
        if (room.status !== 'lobby') throw new RoomError('game_in_progress', 'You can only change your name in the lobby');
        const name = msg.payload.name;
        const taken = this.seated().some((s) => s.id !== seat.id && s.name.toLowerCase() === name.toLowerCase());
        if (taken) throw new RoomError('name_taken', `Someone here is already called ${name}`);
        seat.name = name;
        break;
      }

      case 'room:kick': {
        this.requireHost(me);
        if (room.status === 'playing') throw new RoomError('game_in_progress', 'You can only kick in the lobby');
        const seat = this.requireSeat(msg.payload.playerId);
        if (seat.id === me) throw new RoomError('bad_target', 'You cannot kick yourself');
        this.leaveSeat(seat);
        for (const s of this.socketsFor(seat.id)) {
          s.serializeAttachment({ playerId: null } satisfies SocketAttachment);
          s.close(4001, 'Removed by host');
        }
        break;
      }

      case 'room:addBot': {
        this.requireHost(me);
        if (room.status !== 'lobby') throw new RoomError('game_in_progress', 'Add bots in the lobby');
        const seated = this.seated();
        if (seated.length >= MAX_PLAYERS) throw new RoomError('room_full', 'This room is full');
        if (seated.filter((s) => s.bot).length >= MAX_BOTS) {
          throw new RoomError('too_many_bots', `A room can have up to ${MAX_BOTS} bots`);
        }
        const taken = new Set(seated.map((s) => s.name.toLowerCase()));
        const free = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
        const name = free[Math.floor(Math.random() * free.length)] ?? `🤖 Bot ${seated.length + 1}`;
        room.seats.push({
          id: crypto.randomUUID(),
          token: crypto.randomUUID(),
          name,
          joinedAt: Date.now(),
          afkStrikes: 0,
          left: false,
          ready: true,
          bot: msg.payload.level,
        });
        break;
      }

      case 'room:setBot': {
        this.requireHost(me);
        if (room.status !== 'lobby') throw new RoomError('game_in_progress', 'Change bots in the lobby');
        const seat = this.requireSeat(msg.payload.playerId);
        if (!seat.bot) throw new RoomError('bad_target', 'That player is not a bot');
        seat.bot = msg.payload.level;
        break;
      }

      case 'room:react': {
        const seat = this.requireSeat(me);
        const now = Date.now();
        if (now - (this.lastReaction.get(seat.id) ?? 0) < REACTION_COOLDOWN_MS) {
          throw new RoomError('slow_down', 'One reaction at a time');
        }
        this.lastReaction.set(seat.id, now);
        const reaction: ServerMessage = { type: 'reaction', playerId: seat.id, emoji: msg.payload.emoji };
        for (const ws of this.ctx.getWebSockets()) this.send(ws, reaction);
        // Reactions are fire-and-forget: nothing to save or re-broadcast.
        return;
      }

      case 'game:endVote': {
        const seat = this.requireSeat(me);
        if (room.status !== 'playing' || !room.game) throw new RoomError('no_game', 'No game is running');
        const voters = this.voters();
        if (!voters.includes(seat.id)) throw new RoomError('not_active', 'Only players still in can end the game');
        if (room.endVote) throw new RoomError('vote_running', 'A vote is already running');
        if (Date.now() - (room.lastVoteEndedAt ?? 0) < END_VOTE_COOLDOWN_MS) {
          throw new RoomError('slow_down', 'Wait a moment before starting another vote');
        }
        room.endVote = {
          byId: seat.id,
          outcome: msg.payload.outcome,
          voterIds: voters,
          yesIds: [seat.id],
          noIds: [],
          expiresAt: Date.now() + END_VOTE_MS,
        };
        this.settleVote();
        break;
      }

      case 'game:vote': {
        const seat = this.requireSeat(me);
        const vote = room.endVote;
        if (!vote) throw new RoomError('no_vote', 'There is no vote running');
        if (!vote.voterIds.includes(seat.id)) throw new RoomError('not_active', 'Only players still in can vote');
        if (vote.yesIds.includes(seat.id) || vote.noIds.includes(seat.id)) {
          throw new RoomError('already_voted', 'You already voted');
        }
        (msg.payload.agree ? vote.yesIds : vote.noIds).push(seat.id);
        this.settleVote();
        break;
      }

      case 'room:throw': {
        const seat = this.requireSeat(me);
        const target = this.seat(msg.payload.targetId);
        if (!target) throw new RoomError('bad_target', 'That player is not here');
        if (target.id === seat.id) throw new RoomError('bad_target', 'You cannot throw at yourself');
        const now = Date.now();
        if (now - (this.lastThrow.get(seat.id) ?? 0) < THROW_COOLDOWN_MS) {
          throw new RoomError('slow_down', 'Catch your breath before throwing again');
        }
        this.lastThrow.set(seat.id, now);
        const out: ServerMessage = { type: 'throw', fromId: seat.id, targetId: target.id, item: msg.payload.item };
        for (const ws of this.ctx.getWebSockets()) this.send(ws, out);
        if (target.bot) this.botAnnoyed(target, seat.id, 0.6);
        // Like reactions, throws are fire-and-forget.
        return;
      }

      case 'room:chat': {
        const seat = this.requireSeat(me);
        const now = Date.now();
        if (now - (this.lastChat.get(seat.id) ?? 0) < CHAT_COOLDOWN_MS) {
          throw new RoomError('slow_down', 'You are sending messages too fast');
        }
        this.lastChat.set(seat.id, now);
        const message: ChatMessage = {
          id: crypto.randomUUID(),
          playerId: seat.id,
          name: seat.name,
          text: msg.payload.text,
          at: now,
        };
        room.chat = [...(room.chat ?? []), message].slice(-CHAT_HISTORY);
        this.save();
        const out: ServerMessage = { type: 'chat', message };
        // Only seated players get chat, matching who receives the history.
        for (const ws of this.ctx.getWebSockets()) if (this.attachment(ws).playerId) this.send(ws, out);
        return;
      }

      case 'room:settings':
        this.requireHost(me);
        if (room.status === 'playing') throw new RoomError('game_in_progress', 'Change settings between games');
        room.settings = {
          turnSeconds: msg.payload.turnSeconds ?? room.settings.turnSeconds,
          matchMinutes: msg.payload.matchMinutes ?? room.settings.matchMinutes ?? 0,
        };
        break;

      case 'room:resetScores':
        this.requireHost(me);
        if (room.status === 'playing') throw new RoomError('game_in_progress', 'Reset scores between games');
        for (const s of room.seats) s.wins = 0;
        room.gamesPlayed = 0;
        break;

      case 'room:lobby': {
        this.requireHost(me);
        if (room.status !== 'finished') throw new RoomError('game_in_progress', 'Finish the game first');
        this.backToLobby();
        break;
      }

      case 'room:ready': {
        const seat = this.requireSeat(me);
        if (room.status === 'playing') throw new RoomError('game_in_progress', 'A game is already running');
        seat.ready = msg.payload.ready;
        break;
      }

      case 'game:start': {
        this.requireHost(me);
        if (room.status !== 'lobby') throw new RoomError('game_in_progress', 'Return to the lobby first');
        const seated = this.seated();
        if (seated.length < MIN_PLAYERS) throw new RoomError('not_enough_players', `Need at least ${MIN_PLAYERS} players`);
        if (seated.some((s) => s.id !== room.hostId && !s.ready)) {
          throw new RoomError('not_ready', 'Everyone needs to be ready first');
        }
        const seed = crypto.getRandomValues(new Uint32Array(1))[0] as number;
        room.game = createGame(
          seated.map((s) => ({ id: s.id, name: s.name })),
          seed,
        );
        for (const s of seated) {
          s.afkStrikes = 0;
          // Everyone readies up again before the next game; bots are always ready.
          s.ready = !!s.bot;
        }
        room.status = 'playing';
        room.stateVersion++;
        const minutes = room.settings.matchMinutes ?? 0;
        room.matchEndsAt = minutes > 0 ? Date.now() + minutes * 60_000 : null;
        room.endVote = null;
        this.resetDeadline();
        this.planBots(true);
        this.broadcastRoom();
        this.broadcastGame([]);
        break;
      }

      default: {
        const seat = this.requireSeat(me);
        if (!room.game || room.status !== 'playing') throw new RoomError('no_game', 'No game is running');
        if (
          (msg.type === 'game:play' || msg.type === 'game:draw') &&
          msg.payload.stateVersion !== room.stateVersion
        ) {
          throw new RoomError('stale', 'The table changed; try again');
        }
        const action = toAction(msg);
        if (current(room.game).id === seat.id && action.type !== 'callUno' && action.type !== 'catchUno') {
          seat.afkStrikes = 0;
        }
        this.runAction(seat.id, action);
      }
    }

    this.save();
    await this.scheduleAlarm();
    this.broadcastRoom();
  }

  /** Applies an engine action, updates timers and status, and broadcasts. */
  private runAction(playerId: string, action: Action): void {
    const room = this.requireRoom();
    const game = room.game as GameState;
    const { state, events } = applyAction(game, playerId, action);
    this.commit(state, events);
  }

  /** Stores a new game state, updates timers and status, and broadcasts. */
  private commit(state: GameState, events: GameEvent[]): void {
    const room = this.requireRoom();
    const before = turnKey(room.game as GameState);
    room.game = state;
    room.stateVersion++;

    if (state.phase.kind === 'roundOver') {
      room.status = 'finished';
      room.deadline = null;
      room.matchEndsAt = null;
      room.endVote = null;
      // Scoreboard: every finished game counts, and the winner gets a win if still seated.
      room.gamesPlayed = (room.gamesPlayed ?? 0) + 1;
      const winner = this.seat(state.phase.winnerId);
      if (winner) winner.wins = (winner.wins ?? 0) + 1;
    } else if (turnKey(state) !== before) {
      this.resetDeadline();
    }
    this.planBots(turnKey(state) !== before);
    this.botReactions(events);
    this.save();
    this.broadcastGame(events);
    if (room.status === 'finished') this.broadcastRoom();
  }

  /** Players who may vote to end the game: people still in it and still seated (bots don't vote). */
  private voters(): string[] {
    const game = this.requireRoom().game;
    if (!game) return [];
    return game.players.filter((p) => p.status === 'active' && this.seat(p.id) && !this.seat(p.id)?.bot).map((p) => p.id);
  }

  /** Passes the vote on a strict majority of players still in, or drops it once that can't happen. */
  private settleVote(): void {
    const room = this.requireRoom();
    const vote = room.endVote;
    if (!vote || room.status !== 'playing' || !room.game) return;
    const voters = this.voters();
    vote.voterIds = vote.voterIds.filter((id) => voters.includes(id));
    vote.yesIds = vote.yesIds.filter((id) => vote.voterIds.includes(id));
    vote.noIds = vote.noIds.filter((id) => vote.voterIds.includes(id));
    const n = vote.voterIds.length;
    const name = this.seat(vote.byId)?.name ?? 'Someone';

    if (vote.yesIds.length * 2 > n) {
      this.closeVote(
        vote.outcome === 'finish'
          ? `🏁 Game ended by vote (started by ${name})`
          : `✖ Game cancelled by vote (started by ${name})`,
      );
      if (vote.outcome === 'finish') {
        const { state, events } = endEarly(room.game, 'vote');
        this.commit(state, events);
      } else {
        this.backToLobby();
      }
    } else if ((n - vote.noIds.length) * 2 <= n) {
      this.closeVote('The vote to end the game did not pass');
    }
  }

  private closeVote(notice: string): void {
    const room = this.requireRoom();
    room.endVote = null;
    room.lastVoteEndedAt = Date.now();
    const msg: ServerMessage = { type: 'notice', text: notice };
    for (const ws of this.ctx.getWebSockets()) this.send(ws, msg);
  }

  /** Back to the lobby with no game. Seats given up mid-game are dropped so the lobby shows who is still here. */
  private backToLobby(): void {
    const room = this.requireRoom();
    room.seats = this.seated();
    room.game = null;
    room.deadline = null;
    room.matchEndsAt = null;
    room.endVote = null;
    room.botAt = null;
    room.botCatch = null;
    room.status = 'lobby';
    room.stateVersion++;
  }

  private leaveSeat(seat: Seat): void {
    const room = this.requireRoom();
    if (room.status === 'playing' && room.game) {
      seat.left = true;
      const p = room.game.players.find((x) => x.id === seat.id);
      if (p?.status === 'active') this.runAction(seat.id, { type: 'forfeit' });
      // One fewer voter can decide a running vote.
      this.settleVote();
    } else {
      room.seats = room.seats.filter((s) => s.id !== seat.id);
    }
    if (room.hostId === seat.id) this.transferHost();
    // Bots don't play on their own: once the last person leaves, the bots go too.
    if (!this.seated().some((s) => !s.bot)) {
      if (room.status !== 'lobby') this.backToLobby();
      room.seats = room.seats.filter((s) => !s.bot);
    }
  }

  private async onDisconnect(ws: WebSocket): Promise<void> {
    const room = this.room;
    if (!room) return;
    const { playerId } = this.attachment(ws);
    const connected = this.connectedIds(ws);
    if (playerId && room.hostId === playerId && !connected.has(playerId)) this.transferHost(ws);
    if (connected.size === 0) room.emptySince = Date.now();
    this.save();
    await this.scheduleAlarm();
    this.broadcastRoom(ws);
  }

  /** Passes host to the longest-seated connected player, if any. */
  private transferHost(closing?: WebSocket): void {
    const room = this.requireRoom();
    const connected = this.connectedIds(closing);
    const others = this.seated()
      .filter((s) => s.id !== room.hostId && !s.bot)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const next = others.find((s) => connected.has(s.id));
    if (next) room.hostId = next.id;
    // Nobody else is online: a host who left entirely is replaced by the next seat, if any.
    else if (!this.seat(room.hostId)) room.hostId = others[0]?.id ?? '';
  }

  private resetDeadline(): void {
    const room = this.requireRoom();
    if (!room.game) return;
    const seat = this.seat(current(room.game).id);
    const afk = !!seat && (seat.afkStrikes >= AFK_STRIKES || seat.left);
    room.deadline = Date.now() + (afk ? AFK_TURN_MS : room.settings.turnSeconds * 1000);
  }

  private async scheduleAlarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const times: number[] = [];
    if (room.status === 'playing' && room.deadline !== null) times.push(room.deadline);
    if (room.status === 'playing' && room.matchEndsAt) times.push(room.matchEndsAt);
    if (room.endVote) times.push(room.endVote.expiresAt);
    if (this.connectedIds().size === 0) {
      room.emptySince ??= Date.now();
      times.push(room.emptySince + EMPTY_ROOM_TTL_MS);
    } else {
      room.emptySince = null;
      // Bots only play while someone is watching.
      if (room.status === 'playing' && room.botAt) times.push(room.botAt);
      if (room.status === 'playing' && room.botCatch?.at) times.push(room.botCatch.at);
    }
    if (times.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...times));
  }

  // --- Bots -------------------------------------------------------------------

  /** Times the next bot move and decides whether a bot will catch a player who forgot UNO. */
  private planBots(turnChanged: boolean): void {
    const room = this.requireRoom();
    const game = room.game;
    if (room.status !== 'playing' || !game) {
      room.botAt = null;
      room.botCatch = null;
      return;
    }

    const level = this.seat(current(game).id)?.bot;
    if (!level) room.botAt = null;
    else if (turnChanged || !room.botAt) {
      const { base, spread } = BOT_THINK[level];
      // Picking a colour or a swap right after its own card is quick, as is drawing again.
      const quick = game.phase.kind === 'chooseColor' || game.phase.kind === 'chooseSwapTarget' || !turnChanged;
      room.botAt = Date.now() + (quick ? 700 : base + Math.random() * spread);
    }

    if (room.botCatch && !this.forgotUno(room.botCatch.targetId)) room.botCatch = null;
    if (room.botCatch) return;
    const target = game.players.find((p) => !this.seat(p.id)?.bot && this.forgotUno(p.id));
    const order: BotLevel[] = ['hard', 'normal', 'easy'];
    const catcher = game.players
      .filter((p) => p.status === 'active' && this.seat(p.id)?.bot)
      .map((p) => this.seat(p.id) as Seat)
      .sort((a, b) => order.indexOf(a.bot as BotLevel) - order.indexOf(b.bot as BotLevel))[0];
    if (!target || !catcher) return;
    const { chance, delayMs } = BOT_CATCH[catcher.bot as BotLevel];
    room.botCatch = {
      botId: catcher.id,
      targetId: target.id,
      at: Math.random() < chance ? Date.now() + delayMs : null,
    };
  }

  private forgotUno(playerId: string): boolean {
    const p = this.room?.game?.players.find((x) => x.id === playerId);
    return !!p && p.status === 'active' && p.hand.length === 1 && !p.calledUno;
  }

  private botMove(): void {
    const room = this.requireRoom();
    room.botAt = null;
    const game = room.game;
    if (!game) return;
    const seat = this.seat(current(game).id);
    if (!seat?.bot) return;
    const action = botAction(game, seat.id, seat.bot, Math.random);
    if (!action) return;
    try {
      this.runAction(seat.id, action);
    } catch (e) {
      // Shouldn't happen, but a stuck bot would stall the table: let the timeout rules move it on.
      console.error('bot move failed', e);
      this.runAction(seat.id, { type: 'timeout' });
    }
    const me = room.game?.players.find((p) => p.id === seat.id);
    if (room.status === 'playing' && me && this.forgotUno(me.id) && Math.random() < BOT_UNO_CHANCE[seat.bot]) {
      this.runAction(seat.id, { type: 'callUno' });
    }
  }

  private botCatchUno(): void {
    const room = this.requireRoom();
    const c = room.botCatch;
    if (!c) return;
    room.botCatch = { ...c, at: null };
    const bot = room.game?.players.find((p) => p.id === c.botId);
    if (bot?.status !== 'active' || !this.forgotUno(c.targetId)) return;
    try {
      this.runAction(c.botId, { type: 'catchUno', targetId: c.targetId });
    } catch (e) {
      console.error('bot catch failed', e);
    }
  }

  /** Bots react to what just happened to them: a sulk, a gloat, or something thrown back. */
  private botReactions(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'played' && drawValue(e.card) > 0) {
        this.lastDrawBy = e.playerId;
        const bot = this.seat(e.playerId);
        if (bot?.bot && drawValue(e.card) >= 6 && Math.random() < 0.4) this.botEmote(bot, { emoji: '😈' });
      } else if (e.type === 'drew' && e.count >= 4) {
        const bot = this.seat(e.playerId);
        if (bot?.bot && this.lastDrawBy && this.lastDrawBy !== bot.id) this.botAnnoyed(bot, this.lastDrawBy, 0.5);
      } else if (e.type === 'unoCaught') {
        const bot = this.seat(e.playerId);
        if (bot?.bot) this.botAnnoyed(bot, e.byId, 0.7);
      } else if (e.type === 'handsSwapped') {
        const bot = this.seat(e.b);
        if (bot?.bot) this.botAnnoyed(bot, e.a, 0.5);
      } else if (e.type === 'won') {
        const bot = this.seat(e.playerId);
        if (bot?.bot) this.botEmote(bot, { emoji: Math.random() < 0.5 ? '😎' : '😈' });
      }
    }
  }

  /** A bot hit by someone: sometimes throws something back, otherwise sometimes sulks. */
  private botAnnoyed(bot: Seat, byId: string, chance: number): void {
    if (byId === bot.id || !this.seat(byId)) return;
    if (Math.random() < chance) {
      const item = BOT_AMMO[Math.floor(Math.random() * BOT_AMMO.length)] as Throwable;
      this.botEmote(bot, { targetId: byId, item });
    } else if (Math.random() < 0.5) {
      const sulks: Reaction[] = ['😡', '🤬', '😭', '😱'];
      this.botEmote(bot, { emoji: sulks[Math.floor(Math.random() * sulks.length)] as Reaction });
    }
  }

  /** Sends a bot's throw or reaction after a short, human-looking pause. */
  private botEmote(bot: Seat, what: { emoji: Reaction } | { targetId: string; item: Throwable }): void {
    const now = Date.now();
    if (now - (this.lastBotEmote.get(bot.id) ?? 0) < BOT_EMOTE_GAP_MS) return;
    this.lastBotEmote.set(bot.id, now);
    setTimeout(
      () => {
        if (!this.seat(bot.id)) return;
        const msg: ServerMessage =
          'emoji' in what
            ? { type: 'reaction', playerId: bot.id, emoji: what.emoji }
            : { type: 'throw', fromId: bot.id, targetId: what.targetId, item: what.item };
        if ('targetId' in what && !this.seat(what.targetId)) return;
        for (const ws of this.ctx.getWebSockets()) this.send(ws, msg);
      },
      700 + Math.random() * 900,
    );
  }

  // --- Views and sending ------------------------------------------------------

  private roomView(exclude?: WebSocket): RoomView {
    const room = this.requireRoom();
    const connected = this.connectedIds(exclude);
    return {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      settings: { ...room.settings, matchMinutes: room.settings.matchMinutes ?? 0 },
      players: this.seated().map((s) => ({
        id: s.id,
        name: s.name,
        connected: !!s.bot || connected.has(s.id),
        afk: s.afkStrikes >= AFK_STRIKES,
        ready: !!s.ready,
        wins: s.wins ?? 0,
        bot: s.bot ?? null,
      })),
      spectators: this.ctx.getWebSockets().filter((ws) => ws !== exclude && !this.attachment(ws).playerId).length,
      matchEndsAt: room.status === 'playing' ? (room.matchEndsAt ?? null) : null,
      endVote: room.endVote ?? null,
      gamesPlayed: room.gamesPlayed ?? 0,
    };
  }

  private broadcastRoom(exclude?: WebSocket): void {
    const msg: ServerMessage = { type: 'room:state', room: this.roomView(exclude) };
    for (const ws of this.ctx.getWebSockets()) if (ws !== exclude) this.send(ws, msg);
  }

  private broadcastGame(events: GameEvent[]): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (events.length > 0) this.send(ws, { type: 'game:events', events });
      this.sendGame(ws, this.attachment(ws).playerId);
    }
  }

  private sendGame(ws: WebSocket, playerId: string | null): void {
    const room = this.requireRoom();
    if (!room.game) return;
    this.send(ws, {
      type: 'game:state',
      game: playerView(room.game, playerId),
      stateVersion: room.stateVersion,
      deadline: room.status === 'playing' ? room.deadline : null,
    });
  }

  private reply(ws: WebSocket, requestId: string | undefined, error?: ErrorInfo): void {
    if (requestId) {
      this.send(ws, error ? { type: 'ack', requestId, ok: false, error } : { type: 'ack', requestId, ok: true });
    } else if (error) {
      this.send(ws, { type: 'error', error });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closing; its close handler cleans up.
    }
  }

  // --- Helpers ---------------------------------------------------------------

  private bind(ws: WebSocket, seat: Seat): void {
    const room = this.requireRoom();
    ws.serializeAttachment({ playerId: seat.id } satisfies SocketAttachment);
    room.emptySince = null;
    this.send(ws, { type: 'welcome', playerId: seat.id, playerToken: seat.token, roomCode: room.code });
    this.send(ws, { type: 'chat:history', messages: room.chat ?? [] });
    this.sendGame(ws, seat.id);
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const r = this.rate.get(ws);
    if (!r || now - r.windowStart >= 1000) {
      this.rate.set(ws, { windowStart: now, count: 1 });
      return true;
    }
    r.count++;
    return r.count <= RATE_LIMIT_PER_SECOND;
  }

  private attachment(ws: WebSocket): SocketAttachment {
    return (ws.deserializeAttachment() as SocketAttachment | null) ?? { playerId: null };
  }

  private socketsFor(playerId: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => this.attachment(ws).playerId === playerId);
  }

  private connectedIds(exclude?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const id = this.attachment(ws).playerId;
      if (id) ids.add(id);
    }
    return ids;
  }

  private seated(): Seat[] {
    return this.requireRoom().seats.filter((s) => !s.left);
  }

  private seat(id: string | null): Seat | undefined {
    return id ? this.room?.seats.find((s) => s.id === id && !s.left) : undefined;
  }

  private requireRoom(): RoomRecord {
    if (!this.room) throw new RoomError('no_room', 'This room has closed');
    return this.room;
  }

  private requireSeat(id: string | null): Seat {
    const seat = this.seat(id);
    if (!seat) throw new RoomError('not_seated', 'Join the room first');
    return seat;
  }

  private requireHost(id: string | null): void {
    if (!id || this.requireRoom().hostId !== id) throw new RoomError('not_host', 'Only the host can do that');
  }

  private save(): void {
    if (!this.room) return;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room (id, data) VALUES (1, ?)', JSON.stringify(this.room));
  }
}

function turnKey(s: GameState): string {
  return `${s.turn}:${s.currentIndex}:${s.phase.kind}`;
}

function toAction(msg: ClientMessage): Action {
  switch (msg.type) {
    case 'game:play':
      return { type: 'play', cardId: msg.payload.cardId };
    case 'game:draw':
      return { type: 'draw' };
    case 'game:chooseColor':
      return { type: 'chooseColor', color: msg.payload.color };
    case 'game:chooseSwap':
      return { type: 'chooseSwap', targetId: msg.payload.targetId };
    case 'game:rouletteColor':
      return { type: 'rouletteColor', color: msg.payload.color };
    case 'game:callUno':
      return { type: 'callUno' };
    case 'game:catchUno':
      return { type: 'catchUno', targetId: msg.payload.targetId };
    default:
      throw new RoomError('bad_message', `Unsupported message ${msg.type}`);
  }
}
