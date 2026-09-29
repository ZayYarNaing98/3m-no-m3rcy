export const COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type Color = (typeof COLORS)[number];

export type NumberValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type CardKind =
  | { type: 'number'; value: NumberValue }
  | { type: 'skip' }
  | { type: 'reverse' }
  | { type: 'draw2' }
  | { type: 'draw4' }
  | { type: 'discardAll' }
  | { type: 'skipEveryone' }
  | { type: 'wildReverseDraw4' }
  | { type: 'wildDraw6' }
  | { type: 'wildDraw10' }
  | { type: 'wildColorRoulette' };

export type CardType = CardKind['type'];

/** `color` is null for wild cards. */
export interface Card {
  id: string;
  color: Color | null;
  kind: CardKind;
}

export type PlayerStatus = 'active' | 'eliminated' | 'won';

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  status: PlayerStatus;
  calledUno: boolean;
}

export type StackValue = 2 | 4 | 6 | 10;

export type Phase =
  | { kind: 'awaitingPlay' }
  | { kind: 'drawingUntilPlayable'; drawnCardId: string }
  | { kind: 'respondToStack'; pending: number; minValue: StackValue }
  | { kind: 'chooseColor'; cardId: string }
  | { kind: 'chooseSwapTarget' }
  | { kind: 'rouletteNameColor' }
  | { kind: 'roundOver'; winnerId: string };

export type PhaseKind = Phase['kind'];

export interface GameState {
  rngState: number;
  drawPile: Card[];
  discardPile: Card[];
  players: Player[];
  /** Index of the player whose decision is pending. */
  currentIndex: number;
  direction: 1 | -1;
  activeColor: Color;
  phase: Phase;
  /** Draw penalty carried into the next respondToStack (set while a Wild draw card awaits its colour). */
  carriedStack: number;
  eliminationOrder: string[];
  turn: number;
}

export type Action =
  | { type: 'play'; cardId: string }
  | { type: 'draw' }
  | { type: 'chooseColor'; color: Color }
  | { type: 'chooseSwap'; targetId: string }
  | { type: 'rouletteColor'; color: Color }
  | { type: 'callUno' }
  | { type: 'catchUno'; targetId: string }
  /** Server-driven: the current decider ran out of time. */
  | { type: 'timeout' }
  /** Server-driven: a player left the game. */
  | { type: 'forfeit' };

export type GameEvent =
  | { type: 'played'; playerId: string; card: Card }
  | { type: 'drew'; playerId: string; count: number }
  | { type: 'stackGrew'; total: number }
  | { type: 'colorChosen'; playerId: string; color: Color }
  | { type: 'reversed'; direction: 1 | -1 }
  | { type: 'skipped'; playerIds: string[] }
  | { type: 'discardedAll'; playerId: string; color: Color; count: number }
  | { type: 'handsSwapped'; a: string; b: string }
  | { type: 'handsRotated'; direction: 1 | -1 }
  | { type: 'rouletteFlip'; playerId: string; color: Color; count: number }
  | { type: 'eliminated'; playerId: string; cardCount: number }
  | { type: 'unoCalled'; playerId: string }
  | { type: 'unoCaught'; playerId: string; byId: string }
  | { type: 'reshuffled'; count: number }
  | { type: 'timedOut'; playerId: string }
  | { type: 'forfeited'; playerId: string }
  | { type: 'won'; playerId: string };

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
