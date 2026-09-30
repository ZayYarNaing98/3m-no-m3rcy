import {
  CHAT_HISTORY,
  type ChatMessage,
  type ErrorInfo,
  type GameEvent,
  type PlayerView,
  type Reaction,
  type RoomView,
  type ServerMessage,
} from '@nomercy/engine';
import { create } from 'zustand';
import { describeEvent } from './events';
import { scheduleEvents } from './fxTiming';

type Conn = 'idle' | 'connecting' | 'open' | 'closed';
type Ack = { ok: true } | { ok: false; error: ErrorInfo };

interface SavedSeat {
  token: string;
  name: string;
}

interface State {
  code: string | null;
  conn: Conn;
  /** True once we know whether our saved token still owns a seat. */
  ready: boolean;
  playerId: string | null;
  room: RoomView | null;
  game: PlayerView | null;
  stateVersion: number;
  deadline: number | null;
  log: string[];
  /** Latest batch of game events, for animations. `seq` changes on every batch. */
  fx: { seq: number; events: GameEvent[] };
  /** Latest emoji reaction from anyone at the table. */
  reaction: { seq: number; playerId: string; emoji: Reaction } | null;
  chat: ChatMessage[];
  chatOpen: boolean;
  /** Messages from others that arrived while the chat panel was closed. */
  chatUnread: number;
  toast: string | null;
  closedReason: string | null;

  connect(code: string): void;
  disconnect(): void;
  send(type: string, payload?: object): Promise<Ack>;
  join(name: string): Promise<Ack>;
  leave(): Promise<void>;
  react(emoji: Reaction): Promise<Ack>;
  sendChat(text: string): Promise<Ack>;
  setChatOpen(open: boolean): void;
  showToast(message: string): void;
}

const seatKey = (code: string) => `nomercy:seat:${code}`;
export const NAME_KEY = 'nomercy:name';

export function loadSeat(code: string): SavedSeat | null {
  try {
    const raw = localStorage.getItem(seatKey(code));
    return raw ? (JSON.parse(raw) as SavedSeat) : null;
  } catch {
    return null;
  }
}

function saveSeat(code: string, seat: SavedSeat | null) {
  try {
    if (seat) localStorage.setItem(seatKey(code), JSON.stringify(seat));
    else localStorage.removeItem(seatKey(code));
  } catch {
    // Storage unavailable (private mode); the seat just won't survive a refresh.
  }
}

let socket: WebSocket | null = null;
let intentionalClose = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let requestSeq = 0;
const pending = new Map<string, (ack: Ack) => void>();
let pendingName = '';

export const useGame = create<State>((set, get) => ({
  code: null,
  conn: 'idle',
  ready: false,
  playerId: null,
  room: null,
  game: null,
  stateVersion: 0,
  deadline: null,
  log: [],
  fx: { seq: 0, events: [] },
  reaction: null,
  chat: [],
  chatOpen: false,
  chatUnread: 0,
  toast: null,
  closedReason: null,

  connect(code) {
    clearTimeout(retryTimer);
    if (socket && get().code === code && get().conn !== 'closed') return;
    socket?.close();
    intentionalClose = false;
    set({ code, conn: 'connecting', closedReason: null, ...(get().code !== code ? freshRoom() : {}) });

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
    socket = ws;

    ws.onopen = async () => {
      retry = 0;
      set({ conn: 'open' });
      const seat = loadSeat(code);
      if (!seat) {
        set({ ready: true });
        return;
      }
      const ack = await get().send('room:rejoin', { playerToken: seat.token });
      if (!ack.ok) {
        saveSeat(code, null);
        set({ playerId: null });
      }
      set({ ready: true });
    };

    ws.onmessage = (e) => handleMessage(JSON.parse(e.data as string) as ServerMessage);

    ws.onclose = (e) => {
      if (socket !== ws) return;
      socket = null;
      for (const resolve of pending.values()) resolve({ ok: false, error: { code: 'closed', message: 'Disconnected' } });
      pending.clear();
      if (e.code === 4001) {
        saveSeat(code, null);
        set({ conn: 'closed', playerId: null, closedReason: 'The host removed you from the room.' });
        return;
      }
      if (e.code === 4000) {
        set({ conn: 'closed', closedReason: 'This room is open in another tab.' });
        return;
      }
      if (intentionalClose) {
        set({ conn: 'closed' });
        return;
      }
      set({ conn: 'connecting' });
      const delay = Math.min(10_000, 500 * 2 ** retry++);
      retryTimer = setTimeout(() => get().connect(code), delay);
    };
  },

  disconnect() {
    intentionalClose = true;
    clearTimeout(retryTimer);
    socket?.close();
    socket = null;
    set({ code: null, conn: 'idle', ...freshRoom() });
  },

  send(type, payload = {}) {
    return new Promise<Ack>((resolve) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, error: { code: 'offline', message: 'Not connected' } });
        return;
      }
      const requestId = `q${++requestSeq}`;
      pending.set(requestId, resolve);
      socket.send(JSON.stringify({ type, requestId, payload }));
    }).then((ack) => {
      if (!ack.ok && ack.error.code !== 'closed') get().showToast(ack.error.message);
      return ack;
    });
  },

  async join(name) {
    pendingName = name;
    return get().send('room:join', { name });
  },

  async leave() {
    const code = get().code;
    await get().send('room:leave');
    if (code) saveSeat(code, null);
    get().disconnect();
  },

  react(emoji) {
    return get().send('room:react', { emoji });
  },

  sendChat(text) {
    return get().send('room:chat', { text });
  },

  setChatOpen(open) {
    set(open ? { chatOpen: true, chatUnread: 0 } : { chatOpen: false });
  },

  showToast(message) {
    clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 3000);
  },
}));

// Table state (game and room) can be held back briefly so an elimination or a
// win plays out on screen before seats change and the results sheet appears.
let holdUntil = 0;
let held: Partial<State> | null = null;
let holdTimer: ReturnType<typeof setTimeout> | undefined;

function setTable(update: Partial<State>) {
  const wait = holdUntil - Date.now();
  if (wait <= 0) {
    useGame.setState(update);
    return;
  }
  held = { ...held, ...update };
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    const pending = held;
    held = null;
    if (pending) useGame.setState(pending);
  }, wait);
}

function clearHold() {
  holdUntil = 0;
  held = null;
  clearTimeout(holdTimer);
}

function holdForClimax(events: GameEvent[]) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { climax } = scheduleEvents(events);
  if (climax === null) return;
  // A win also gets time for "Winner!" and the fanfare before the results sheet.
  const extra = events.some((e) => e.type === 'won') ? 900 : 50;
  holdUntil = Math.max(holdUntil, Date.now() + climax + extra);
}

function freshRoom() {
  clearHold();
  return {
    ready: false,
    playerId: null,
    room: null,
    game: null,
    stateVersion: 0,
    deadline: null,
    log: [],
    chat: [],
    chatOpen: false,
    chatUnread: 0,
  };
}

function handleMessage(msg: ServerMessage) {
  const { getState: get, setState: set } = useGame;
  switch (msg.type) {
    case 'ack': {
      const resolve = pending.get(msg.requestId);
      pending.delete(msg.requestId);
      resolve?.(msg.ok ? { ok: true } : { ok: false, error: msg.error });
      break;
    }
    case 'welcome': {
      const prev = loadSeat(msg.roomCode);
      saveSeat(msg.roomCode, { token: msg.playerToken, name: prev?.name ?? pendingName });
      set({ playerId: msg.playerId });
      break;
    }
    case 'room:state':
      setTable({ room: msg.room });
      break;
    case 'game:state':
      setTable({ game: msg.game, stateVersion: msg.stateVersion, deadline: msg.deadline });
      break;
    case 'game:events': {
      // "Out" and "won" lines wait for their moment on screen, like the table does.
      const { at } = scheduleEvents(msg.events);
      const climaxes: GameEvent[] = msg.events.filter((e) => e.type === 'eliminated' || e.type === 'won');
      appendLog(msg.events.filter((e) => !climaxes.includes(e)));
      for (const e of climaxes) setTimeout(() => appendLog([e]), at[msg.events.indexOf(e)] ?? 0);
      set({ fx: { seq: get().fx.seq + 1, events: msg.events } });
      holdForClimax(msg.events);
      break;
    }
    case 'chat:history':
      set({ chat: msg.messages });
      break;
    case 'chat': {
      const { chat, chatOpen, chatUnread, playerId } = get();
      const mine = msg.message.playerId === playerId;
      set({
        chat: [...chat, msg.message].slice(-CHAT_HISTORY),
        chatUnread: chatOpen || mine ? chatUnread : chatUnread + 1,
      });
      break;
    }
    case 'reaction':
      set({ reaction: { seq: (get().reaction?.seq ?? 0) + 1, playerId: msg.playerId, emoji: msg.emoji } });
      break;
    case 'error':
      get().showToast(msg.error.message);
      break;
  }
}

function appendLog(events: GameEvent[]) {
  const { game, playerId, log } = useGame.getState();
  const names = new Map(game?.players.map((p) => [p.id, p.id === playerId ? 'You' : p.name]) ?? []);
  const lines = events.map((e) => describeEvent(e, (id) => names.get(id) ?? 'Someone')).filter((l): l is string => !!l);
  useGame.setState({ log: [...log, ...lines].slice(-40) });
}
