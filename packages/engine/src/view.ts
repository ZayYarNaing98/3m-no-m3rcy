import { current, legalCardIds, topCard } from './engine';
import type { Card, Color, GameState, PlayerStatus, StackValue } from './types';

export type PublicPhase =
  | { kind: 'awaitingPlay' }
  | { kind: 'drawingUntilPlayable'; drawnCardId?: string }
  | { kind: 'respondToStack'; pending: number; minValue: StackValue }
  | { kind: 'chooseColor' }
  | { kind: 'chooseSwapTarget' }
  | { kind: 'rouletteNameColor' }
  | { kind: 'roundOver'; winnerId: string; timeUp?: { points: Record<string, number> } };

export interface PublicPlayer {
  id: string;
  name: string;
  cardCount: number;
  status: PlayerStatus;
  calledUno: boolean;
}

/** What one player is allowed to see: their own hand, everyone else as counts. */
export interface PlayerView {
  youId: string | null;
  hand: Card[];
  legalCardIds: string[];
  players: PublicPlayer[];
  currentPlayerId: string;
  topCard: Card;
  activeColor: Color;
  direction: 1 | -1;
  phase: PublicPhase;
  drawPileCount: number;
  discardCount: number;
  turn: number;
  eliminationOrder: string[];
}

export function playerView(state: GameState, viewerId: string | null): PlayerView {
  const me = viewerId ? state.players.find((p) => p.id === viewerId) : undefined;
  const cur = current(state);
  const phase = state.phase;
  let publicPhase: PublicPhase;
  switch (phase.kind) {
    case 'drawingUntilPlayable':
      publicPhase = cur.id === viewerId ? phase : { kind: 'drawingUntilPlayable' };
      break;
    case 'chooseColor':
      publicPhase = { kind: 'chooseColor' };
      break;
    default:
      publicPhase = phase;
  }

  return {
    youId: me?.id ?? null,
    hand: me ? me.hand : [],
    legalCardIds: me ? legalCardIds(state, me.id) : [],
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand.length,
      status: p.status,
      calledUno: p.calledUno,
    })),
    currentPlayerId: cur.id,
    topCard: topCard(state),
    activeColor: state.activeColor,
    direction: state.direction,
    phase: publicPhase,
    drawPileCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    turn: state.turn,
    eliminationOrder: state.eliminationOrder,
  };
}
