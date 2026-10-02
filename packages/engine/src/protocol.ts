import type { Color, GameEvent } from './types';
import type { PlayerView } from './view';

/** Wire format: every message is `{ type, requestId?, payload }` as JSON text. */
export type ClientMessage = { requestId?: string } & (
  | { type: 'room:join'; payload: { name: string } }
  | { type: 'room:rejoin'; payload: { playerToken: string } }
  | { type: 'room:leave'; payload: Record<string, never> }
  | { type: 'room:kick'; payload: { playerId: string } }
  | { type: 'room:settings'; payload: { turnSeconds: number } }
  | { type: 'game:start'; payload: Record<string, never> }
  | { type: 'game:play'; payload: { cardId: string; stateVersion: number } }
  | { type: 'game:draw'; payload: { stateVersion: number } }
  | { type: 'game:chooseColor'; payload: { color: Color } }
  | { type: 'game:chooseSwap'; payload: { targetId: string } }
  | { type: 'game:rouletteColor'; payload: { color: Color } }
  | { type: 'game:callUno'; payload: Record<string, never> }
  | { type: 'game:catchUno'; payload: { targetId: string } }
  | { type: 'room:lobby'; payload: Record<string, never> }
  | { type: 'room:ready'; payload: { ready: boolean } }
  | { type: 'room:react'; payload: { emoji: Reaction } }
  | { type: 'room:throw'; payload: { targetId: string; item: Throwable } }
  | { type: 'room:chat'; payload: { text: string } }
);

export type ClientMessageType = ClientMessage['type'];

export interface ErrorInfo {
  code: string;
  message: string;
}

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface RoomSettings {
  turnSeconds: number;
}

export interface RoomPlayerView {
  id: string;
  name: string;
  connected: boolean;
  afk: boolean;
  /** Ready for the next game. The host starts it, so their own flag is ignored. */
  ready: boolean;
}

export interface RoomView {
  code: string;
  hostId: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: RoomPlayerView[];
  /** Connections watching without a seat. */
  spectators: number;
}

export type ServerMessage =
  | { type: 'ack'; requestId: string; ok: true }
  | { type: 'ack'; requestId: string; ok: false; error: ErrorInfo }
  | { type: 'welcome'; playerId: string; playerToken: string; roomCode: string }
  | { type: 'room:state'; room: RoomView }
  | { type: 'game:state'; game: PlayerView; stateVersion: number; deadline: number | null }
  | { type: 'game:events'; events: GameEvent[] }
  | { type: 'reaction'; playerId: string; emoji: Reaction }
  | { type: 'throw'; fromId: string; targetId: string; item: Throwable }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat:history'; messages: ChatMessage[] }
  | { type: 'error'; error: ErrorInfo };

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const DEFAULT_TURN_SECONDS = 30;
export const TURN_SECONDS_OPTIONS = [15, 30, 45, 60, 90] as const;
export const AFK_STRIKES = 3;

/** Emoji players can send to the table. The server only relays these. */
export const REACTIONS = [
  '😂', '🤣', '😎', '😏',
  '😱', '😭', '😡', '🤬',
  '😈', '💀', '🤡', '🔥',
  '👏', '🙏', '👍', '👎',
] as const;
export type Reaction = (typeof REACTIONS)[number];
/** Minimum gap between one player's reactions. */
export const REACTION_COOLDOWN_MS = 600;

/** Things players can throw at each other. The server only relays these. */
export const THROWABLES = [
  'shoe', 'stone', 'hammer', 'tomato',
  'egg', 'bomb', 'rose', 'water',
  'poop', 'pie', 'fish', 'banana',
  'brick', 'firecracker', 'kiss', 'cake',
] as const;
export type Throwable = (typeof THROWABLES)[number];
/** Minimum gap between one player's throws. */
export const THROW_COOLDOWN_MS = 1500;

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  /** Server time in ms. */
  at: number;
}

export const CHAT_MAX_LENGTH = 200;
/** Messages a room keeps so reconnecting players see the conversation. */
export const CHAT_HISTORY = 50;
/** Minimum gap between one player's chat messages. */
export const CHAT_COOLDOWN_MS = 800;
