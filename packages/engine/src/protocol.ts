import type { Color, GameEvent } from './types';
import type { BotLevel } from './bot';
import type { PlayerView } from './view';

/** Wire format: every message is `{ type, requestId?, payload }` as JSON text. */
export type ClientMessage = { requestId?: string } & (
  | { type: 'room:join'; payload: { name: string } }
  | { type: 'room:rejoin'; payload: { playerToken: string } }
  | { type: 'room:leave'; payload: Record<string, never> }
  | { type: 'room:rename'; payload: { name: string } }
  | { type: 'room:kick'; payload: { playerId: string } }
  | { type: 'room:addBot'; payload: { level: BotLevel } }
  | { type: 'room:setBot'; payload: { playerId: string; level: BotLevel } }
  | { type: 'room:settings'; payload: { turnSeconds?: number; matchMinutes?: number } }
  | { type: 'game:start'; payload: Record<string, never> }
  | { type: 'game:play'; payload: { cardId: string; stateVersion: number } }
  | { type: 'game:draw'; payload: { stateVersion: number } }
  | { type: 'game:chooseColor'; payload: { color: Color } }
  | { type: 'game:chooseSwap'; payload: { targetId: string } }
  | { type: 'game:rouletteColor'; payload: { color: Color } }
  | { type: 'game:callUno'; payload: Record<string, never> }
  | { type: 'game:catchUno'; payload: { targetId: string } }
  | { type: 'room:lobby'; payload: Record<string, never> }
  | { type: 'room:resetScores'; payload: Record<string, never> }
  | { type: 'room:public'; payload: { public: boolean } }
  | { type: 'room:ready'; payload: { ready: boolean } }
  | { type: 'room:react'; payload: { emoji: Reaction } }
  | { type: 'game:endVote'; payload: { outcome: EndOutcome } }
  | { type: 'game:vote'; payload: { agree: boolean } }
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
  /** Match time limit in minutes; 0 means no limit. */
  matchMinutes: number;
}

export interface RoomPlayerView {
  id: string;
  name: string;
  connected: boolean;
  afk: boolean;
  /** Ready for the next game. The host starts it, so their own flag is ignored. */
  ready: boolean;
  /** Games won in this room. */
  wins: number;
  /** A computer player's difficulty, or null for a person. */
  bot: BotLevel | null;
}

export interface RoomView {
  code: string;
  hostId: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: RoomPlayerView[];
  /** Connections watching without a seat. */
  spectators: number;
  /** When the running game's match clock runs out (server time in ms), or null without a limit. */
  matchEndsAt: number | null;
  /** A running vote to end the game early, if any. */
  endVote: EndVote | null;
  /** Games finished in this room since it opened or the scores were reset. */
  gamesPlayed: number;
  /** Listed for Quick play and the open rooms list. */
  public: boolean;
  /** When a bot joins a Quick play room nobody else has joined yet (server time in ms), or null. */
  autoBotAt: number | null;
}

/** A public room waiting for players, as the home screen lists it. */
export interface OpenRoom {
  code: string;
  /** The host's name. */
  host: string;
  players: number;
  bots: number;
  createdAt: number;
}

/** A Quick play room with one person in it gets a bot after this long. */
export const AUTO_BOT_MS = 30_000;

/** "finish": score the game now (fewest cards wins). "cancel": no winner, back to the lobby. */
export type EndOutcome = 'finish' | 'cancel';

export interface EndVote {
  byId: string;
  outcome: EndOutcome;
  /** Players still in the game, who are the ones voting. */
  voterIds: string[];
  yesIds: string[];
  noIds: string[];
  /** Server time in ms when the vote lapses. */
  expiresAt: number;
}

/** How long players have to answer a vote to end the game. */
export const END_VOTE_MS = 30_000;
/** Minimum gap between the end of one vote and the start of the next. */
export const END_VOTE_COOLDOWN_MS = 15_000;

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
  /** A one-off message for everyone, shown as a toast. */
  | { type: 'notice'; text: string }
  | { type: 'error'; error: ErrorInfo };

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
/** Computer players a room may have. */
export const MAX_BOTS = 2;
export const DEFAULT_TURN_SECONDS = 30;
export const TURN_SECONDS_OPTIONS = [15, 30, 45, 60, 90] as const;
export const AFK_STRIKES = 3;
export const MATCH_MINUTES_OPTIONS = [0, 5, 7, 8, 10, 15, 20] as const;

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
  'egg', 'bomb', 'rose', 'poop',
  'pie', 'angryShoe', 'brick', 'firecracker',
  'kiss', 'cake', 'sock', 'glove',
  'pizza', 'chili', 'angryStick', 'balloon',
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
