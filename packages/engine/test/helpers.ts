import { buildDeck, type Card, type CardType, type Color, type GameState, type Phase } from '../src';

type Spec = [color: Color | null, type: CardType, value?: number];

/** Builds a hand-crafted game state from a full deck so card counts stay at 168. */
export function makeState(opts: {
  hands: Spec[][];
  top: Spec;
  activeColor?: Color;
  current?: number;
  direction?: 1 | -1;
  phase?: Phase;
  /** Cards to place on top of the draw pile, first drawn first. */
  drawTop?: Spec[];
}): GameState {
  const pool = buildDeck();
  const take = ([color, type, value]: Spec): Card => {
    const i = pool.findIndex(
      (c) => c.color === color && c.kind.type === type && (value === undefined || (c.kind.type === 'number' && c.kind.value === value)),
    );
    if (i < 0) throw new Error(`No card left for ${color} ${type} ${value ?? ''}`);
    return pool.splice(i, 1)[0] as Card;
  };

  const players = opts.hands.map((h, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    hand: h.map(take),
    status: 'active' as const,
    calledUno: false,
  }));
  const top = take(opts.top);
  const drawTop = (opts.drawTop ?? []).map(take);
  // Draw pile pops from the end, so reverse the requested order.
  const drawPile = [...pool, ...drawTop.reverse()];

  return {
    rngState: 42,
    drawPile,
    discardPile: [top],
    players,
    currentIndex: opts.current ?? 0,
    direction: opts.direction ?? 1,
    activeColor: opts.activeColor ?? (top.color as Color),
    phase: opts.phase ?? { kind: 'awaitingPlay' },
    carriedStack: 0,
    eliminationOrder: [],
    turn: 1,
  };
}

export function cardId(state: GameState, player: number, type: CardType, color?: Color | null, value?: number): string {
  const p = state.players[player];
  const c = p?.hand.find(
    (x) =>
      x.kind.type === type &&
      (color === undefined || x.color === color) &&
      (value === undefined || (x.kind.type === 'number' && x.kind.value === value)),
  );
  if (!c) throw new Error(`P${player} has no ${color ?? ''} ${type} ${value ?? ''}`);
  return c.id;
}

export function totalCards(s: GameState): number {
  return s.drawPile.length + s.discardPile.length + s.players.reduce((n, p) => n + p.hand.length, 0);
}
