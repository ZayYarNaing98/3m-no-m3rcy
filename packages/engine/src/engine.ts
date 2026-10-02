import { buildDeck, drawValue, HAND_SIZE, isWild, MERCY_LIMIT, sameSymbol } from './deck';
import { nextRandom, shuffleInPlace } from './rng';
import {
  COLORS,
  EngineError,
  type Action,
  type Card,
  type Color,
  type GameEvent,
  type GameState,
  type Phase,
  type Player,
  type StackValue,
  type StepResult,
} from './types';

export interface SeatInput {
  id: string;
  name: string;
}

/** Deals a new round. `seed` makes the shuffle and first player deterministic. */
export function createGame(seats: SeatInput[], seed: number): GameState {
  if (seats.length < 2 || seats.length > 10) {
    throw new EngineError('bad_player_count', 'A game needs 2 to 10 players');
  }
  const drawPile = buildDeck();
  let rngState = shuffleInPlace(drawPile, seed);

  // Seats are shuffled so every game starts from a different table order.
  const order = [...seats];
  rngState = shuffleInPlace(order, rngState);
  const players: Player[] = order.map((s) => ({
    id: s.id,
    name: s.name,
    hand: [],
    status: 'active',
    calledUno: false,
  }));
  for (let i = 0; i < HAND_SIZE; i++) {
    for (const p of players) p.hand.push(drawPile.pop() as Card);
  }

  // Start on a number card; anything else goes to the bottom of the pile.
  let first = drawPile.pop() as Card;
  while (first.kind.type !== 'number') {
    drawPile.unshift(first);
    first = drawPile.pop() as Card;
  }

  let r: number;
  [r, rngState] = nextRandom(rngState);

  return {
    rngState,
    drawPile,
    discardPile: [first],
    players,
    currentIndex: Math.floor(r * players.length),
    direction: 1,
    activeColor: first.color as Color,
    phase: { kind: 'awaitingPlay' },
    carriedStack: 0,
    eliminationOrder: [],
    turn: 1,
  };
}

/** Applies one action for `playerId`. Pure: the input state is not modified. */
export function applyAction(state: GameState, playerId: string, action: Action): StepResult {
  const s = cloneState(state);
  const events: GameEvent[] = [];
  const ctx: Ctx = { s, events };

  if (s.phase.kind === 'roundOver') throw new EngineError('round_over', 'The round is over');

  const actor = s.players.find((p) => p.id === playerId);
  if (!actor) throw new EngineError('unknown_player', 'Unknown player');
  if (actor.status !== 'active') throw new EngineError('not_active', 'You are out of this round');

  switch (action.type) {
    case 'callUno':
      callUno(ctx, actor);
      break;
    case 'catchUno':
      catchUno(ctx, actor, action.targetId);
      break;
    case 'forfeit':
      forfeit(ctx, actor);
      break;
    default: {
      if (current(s).id !== playerId) throw new EngineError('not_your_turn', 'It is not your turn');
      decide(ctx, action);
    }
  }
  return { state: s, events };
}

/** Card ids the player may play right now (empty when it is not their play decision). */
export function legalCardIds(state: GameState, playerId: string): string[] {
  const p = current(state);
  if (p.id !== playerId) return [];
  switch (state.phase.kind) {
    case 'awaitingPlay':
      return p.hand.filter((c) => canPlayNormally(state, c)).map((c) => c.id);
    case 'drawingUntilPlayable':
      return [state.phase.drawnCardId];
    case 'respondToStack': {
      const min = state.phase.minValue;
      return p.hand.filter((c) => canStack(state, c, min)).map((c) => c.id);
    }
    default:
      return [];
  }
}

export function topCard(state: GameState): Card {
  return state.discardPile[state.discardPile.length - 1] as Card;
}

export function current(state: GameState): Player {
  return state.players[state.currentIndex] as Player;
}

export function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.status === 'active');
}

// ---------------------------------------------------------------------------

/** Cards are never mutated, so copying the containers is enough. */
function cloneState(state: GameState): GameState {
  return {
    ...state,
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    players: state.players.map((p) => ({ ...p, hand: [...p.hand] })),
    phase: { ...state.phase },
    eliminationOrder: [...state.eliminationOrder],
  };
}

interface Ctx {
  s: GameState;
  events: GameEvent[];
}

function decide(ctx: Ctx, action: Action): void {
  const { s } = ctx;
  const phase = s.phase;
  switch (action.type) {
    case 'play':
      return play(ctx, action.cardId);
    case 'draw':
      if (phase.kind === 'awaitingPlay') return drawSingle(ctx);
      if (phase.kind === 'respondToStack') return takeStack(ctx);
      throw new EngineError('bad_phase', 'You cannot draw now');
    case 'chooseColor':
      if (phase.kind !== 'chooseColor') throw new EngineError('bad_phase', 'No colour to choose');
      return chooseColor(ctx, action.color);
    case 'chooseSwap':
      if (phase.kind !== 'chooseSwapTarget') throw new EngineError('bad_phase', 'No swap to choose');
      return chooseSwap(ctx, action.targetId);
    case 'rouletteColor':
      if (phase.kind !== 'rouletteNameColor') throw new EngineError('bad_phase', 'No roulette to resolve');
      return roulette(ctx, action.color);
    case 'timeout':
      return timeout(ctx);
    default:
      throw new EngineError('bad_action', 'Unknown action');
  }
}

function play(ctx: Ctx, cardId: string): void {
  const { s, events } = ctx;
  const p = current(s);
  const phase = s.phase;
  const card = p.hand.find((c) => c.id === cardId);
  if (!card) throw new EngineError('no_such_card', 'You do not hold that card');

  let carried = 0;
  if (phase.kind === 'awaitingPlay') {
    if (!canPlayNormally(s, card)) throw new EngineError('illegal_card', 'That card does not match');
  } else if (phase.kind === 'drawingUntilPlayable') {
    if (card.id !== phase.drawnCardId) throw new EngineError('illegal_card', 'You must play the card you drew');
  } else if (phase.kind === 'respondToStack') {
    if (!canStack(s, card, phase.minValue)) {
      throw new EngineError(
        'illegal_card',
        `Stack a ${s.activeColor} or wild draw card of +${phase.minValue} or more, or take the stack`,
      );
    }
    carried = phase.pending;
  } else {
    throw new EngineError('bad_phase', 'You cannot play a card now');
  }

  p.hand = p.hand.filter((c) => c.id !== card.id);
  s.discardPile.push(card);
  if (card.color) s.activeColor = card.color;
  if (p.hand.length > 1) p.calledUno = false;
  events.push({ type: 'played', playerId: p.id, card });

  if (p.hand.length === 0) return declareWinner(ctx, p);

  // Colour Roulette is the one wild whose player doesn't pick: the next player names the colour.
  if (isWild(card) && card.kind.type !== 'wildColorRoulette') {
    s.carriedStack = carried;
    s.phase = { kind: 'chooseColor', cardId: card.id };
    return;
  }
  resolveEffect(ctx, card, carried);
}

function chooseColor(ctx: Ctx, color: Color): void {
  const { s, events } = ctx;
  if (!COLORS.includes(color)) throw new EngineError('bad_color', 'Unknown colour');
  s.activeColor = color;
  events.push({ type: 'colorChosen', playerId: current(s).id, color });
  const carried = s.carriedStack;
  s.carriedStack = 0;
  resolveEffect(ctx, topCard(s), carried);
}

/** Runs a card's effect after it is on the discard pile (and its colour is known). */
function resolveEffect(ctx: Ctx, card: Card, carried: number): void {
  const { s, events } = ctx;
  const p = current(s);
  const k = card.kind;

  switch (k.type) {
    case 'number':
      if (k.value === 7) {
        s.phase = { kind: 'chooseSwapTarget' };
        return;
      }
      if (k.value === 0) {
        rotateHands(ctx);
        checkMercy(ctx);
      }
      return endTurn(ctx);

    case 'skip':
      return endTurn(ctx, 1);

    case 'reverse':
      s.direction = s.direction === 1 ? -1 : 1;
      events.push({ type: 'reversed', direction: s.direction });
      // With two players a Reverse acts as a Skip.
      return endTurn(ctx, activePlayers(s).length === 2 ? 1 : 0);

    case 'wildReverseDraw4':
      s.direction = s.direction === 1 ? -1 : 1;
      events.push({ type: 'reversed', direction: s.direction });
      return startStack(ctx, carried + 4, 4);
    case 'draw2':
      return startStack(ctx, carried + 2, 2);
    case 'draw4':
      return startStack(ctx, carried + 4, 4);
    case 'wildDraw6':
      return startStack(ctx, carried + 6, 6);
    case 'wildDraw10':
      return startStack(ctx, carried + 10, 10);

    case 'discardAll': {
      const color = card.color as Color;
      const matching = p.hand.filter((c) => c.color === color);
      p.hand = p.hand.filter((c) => c.color !== color);
      // Keep the played card on top.
      s.discardPile.splice(s.discardPile.length - 1, 0, ...matching);
      events.push({ type: 'discardedAll', playerId: p.id, color, count: matching.length });
      if (p.hand.length === 0) return declareWinner(ctx, p);
      if (p.hand.length > 1) p.calledUno = false;
      return endTurn(ctx);
    }

    case 'skipEveryone':
      events.push({ type: 'skipped', playerIds: activePlayers(s).filter((o) => o.id !== p.id).map((o) => o.id) });
      s.phase = { kind: 'awaitingPlay' };
      s.turn++;
      return;

    case 'wildColorRoulette': {
      s.currentIndex = nextActiveIndex(s, s.currentIndex, 1);
      s.phase = { kind: 'rouletteNameColor' };
      return;
    }
  }
}

function startStack(ctx: Ctx, total: number, minValue: StackValue): void {
  const { s, events } = ctx;
  events.push({ type: 'stackGrew', total });
  s.currentIndex = nextActiveIndex(s, s.currentIndex, 1);
  s.phase = { kind: 'respondToStack', pending: total, minValue };
  s.turn++;
}

function takeStack(ctx: Ctx): void {
  const { s } = ctx;
  if (s.phase.kind !== 'respondToStack') return;
  giveCards(ctx, current(s), s.phase.pending);
  checkMercy(ctx);
  endTurn(ctx);
}

/**
 * Draw tapped: one card, and the turn stays with the player. They can play any legal card or
 * draw again; the turn only moves on when they play, hit the Mercy limit, or the deck runs dry.
 */
function drawSingle(ctx: Ctx): void {
  const { s } = ctx;
  const p = current(s);
  const count = giveCards(ctx, p, 1);
  checkMercy(ctx);
  if (s.phase.kind === 'roundOver') return;
  if (p.status !== 'active' || count === 0) endTurn(ctx);
}

/** A timed-out player draws until something is playable, then keeps it (see `timeout`). */
function drawUntilPlayable(ctx: Ctx): void {
  const { s, events } = ctx;
  const p = current(s);
  let count = 0;
  let found: Card | null = null;
  for (;;) {
    const c = drawOne(ctx);
    if (!c) break;
    p.hand.push(c);
    count++;
    if (canPlayNormally(s, c)) {
      found = c;
      break;
    }
  }
  if (p.hand.length > 2) p.calledUno = false;
  events.push({ type: 'drew', playerId: p.id, count });
  checkMercy(ctx);
  if (s.phase.kind === 'roundOver') return;
  if (found && p.status === 'active') {
    s.phase = { kind: 'drawingUntilPlayable', drawnCardId: found.id };
    return;
  }
  endTurn(ctx);
}

function chooseSwap(ctx: Ctx, targetId: string): void {
  const { s, events } = ctx;
  const p = current(s);
  const target = s.players.find((o) => o.id === targetId);
  if (!target || target.id === p.id || target.status !== 'active') {
    throw new EngineError('bad_target', 'Pick another player who is still in');
  }
  [p.hand, target.hand] = [target.hand, p.hand];
  p.calledUno = true;
  target.calledUno = true;
  events.push({ type: 'handsSwapped', a: p.id, b: target.id });
  checkMercy(ctx);
  endTurn(ctx);
}

function rotateHands(ctx: Ctx): void {
  const { s, events } = ctx;
  // Walk seats in play direction; each active player passes their hand to the next active player.
  const order: Player[] = [];
  let i = s.currentIndex;
  for (let n = 0; n < activePlayers(s).length; n++) {
    order.push(s.players[i] as Player);
    i = nextActiveIndex(s, i, 1);
  }
  const hands = order.map((p) => p.hand);
  order.forEach((p, idx) => {
    p.hand = hands[(idx - 1 + order.length) % order.length] as Card[];
    p.calledUno = true;
  });
  events.push({ type: 'handsRotated', direction: s.direction });
}

function roulette(ctx: Ctx, color: Color): void {
  const { s, events } = ctx;
  if (!COLORS.includes(color)) throw new EngineError('bad_color', 'Unknown colour');
  const p = current(s);
  // The named colour becomes the colour in play.
  s.activeColor = color;
  events.push({ type: 'colorChosen', playerId: p.id, color });
  const flipped: Card[] = [];
  for (;;) {
    const c = drawOne(ctx);
    if (!c) break;
    p.hand.push(c);
    flipped.push(c);
    // Wild cards have no colour, so they never stop the roulette.
    if (c.color === color) break;
  }
  if (p.hand.length > 2) p.calledUno = false;
  events.push({ type: 'rouletteFlip', playerId: p.id, color, count: flipped.length, cards: flipped });
  checkMercy(ctx);
  // The roulette victim loses their turn.
  endTurn(ctx);
}

function callUno(ctx: Ctx, p: Player): void {
  if (p.hand.length > 2) throw new EngineError('too_many_cards', 'Call UNO with two cards or fewer');
  p.calledUno = true;
  ctx.events.push({ type: 'unoCalled', playerId: p.id });
}

function catchUno(ctx: Ctx, by: Player, targetId: string): void {
  const target = ctx.s.players.find((o) => o.id === targetId);
  if (!target || target.status !== 'active' || target.id === by.id) {
    throw new EngineError('bad_target', 'Nobody to catch');
  }
  if (target.hand.length !== 1 || target.calledUno) {
    throw new EngineError('not_catchable', 'That player is safe');
  }
  giveCards(ctx, target, 2);
  ctx.events.push({ type: 'unoCaught', playerId: target.id, byId: by.id });
  checkMercy(ctx);
}

function timeout(ctx: Ctx): void {
  const { s, events } = ctx;
  const p = current(s);
  events.push({ type: 'timedOut', playerId: p.id });
  switch (s.phase.kind) {
    case 'awaitingPlay':
      drawUntilPlayable(ctx);
      // Timed-out players keep the drawn card instead of playing it.
      if ((s.phase as Phase).kind === 'drawingUntilPlayable') endTurn(ctx);
      return;
    case 'drawingUntilPlayable':
      return endTurn(ctx);
    case 'respondToStack':
      return takeStack(ctx);
    case 'chooseColor':
      return chooseColor(ctx, mostHeldColor(p));
    case 'chooseSwapTarget': {
      const others = activePlayers(s).filter((o) => o.id !== p.id);
      return chooseSwap(ctx, (pick(ctx, others) as Player).id);
    }
    case 'rouletteNameColor':
      return roulette(ctx, pick(ctx, [...COLORS]) as Color);
  }
}

function forfeit(ctx: Ctx, p: Player): void {
  const { s, events } = ctx;
  const isCurrent = current(s).id === p.id;
  const phase = s.phase.kind;

  // Resolve a half-finished card effect first so the table is left consistent.
  if (isCurrent && (phase === 'chooseColor' || phase === 'chooseSwapTarget')) timeout(ctx);
  if (s.phase.kind === 'roundOver' || p.status !== 'active') return;

  const stillCurrent = current(s).id === p.id;
  eliminate(ctx, p);
  events.push({ type: 'forfeited', playerId: p.id });
  if (checkLastStanding(ctx)) return;
  if (!stillCurrent) return;

  if (s.phase.kind === 'respondToStack') {
    // The stack passes to the next player.
    s.currentIndex = nextActiveIndex(s, s.currentIndex, 1);
  } else {
    endTurn(ctx);
  }
}

// ---------------------------------------------------------------------------

function canPlayNormally(s: GameState, card: Card): boolean {
  if (isWild(card)) return true;
  if (card.color === s.activeColor) return true;
  return sameSymbol(card, topCard(s));
}

/**
 * A draw card can go on a stack when it is worth at least the minimum and, like any play,
 * it is wild, matches the colour in play, or is the same card as the top one (blue +4 on red +4).
 */
function canStack(s: GameState, card: Card, minValue: number): boolean {
  return drawValue(card) >= minValue && canPlayNormally(s, card);
}

function endTurn(ctx: Ctx, skip = 0): void {
  const { s, events } = ctx;
  if (s.phase.kind === 'roundOver') return;
  if (skip > 0) {
    const skipped: string[] = [];
    let i = s.currentIndex;
    for (let n = 0; n < skip; n++) {
      i = nextActiveIndex(s, i, 1);
      skipped.push((s.players[i] as Player).id);
    }
    events.push({ type: 'skipped', playerIds: skipped });
  }
  s.currentIndex = nextActiveIndex(s, s.currentIndex, 1 + skip);
  s.phase = { kind: 'awaitingPlay' };
  s.turn++;
}

function nextActiveIndex(s: GameState, from: number, steps: number): number {
  const n = s.players.length;
  let i = from;
  for (let k = 0; k < steps; k++) {
    for (let guard = 0; guard < n; guard++) {
      i = (i + s.direction + n) % n;
      if ((s.players[i] as Player).status === 'active') break;
    }
  }
  return i;
}

function drawOne(ctx: Ctx): Card | null {
  const { s, events } = ctx;
  if (s.drawPile.length === 0) {
    const top = s.discardPile.pop() as Card;
    const rest = s.discardPile;
    if (rest.length > 0) {
      s.rngState = shuffleInPlace(rest, s.rngState);
      s.drawPile = rest;
      events.push({ type: 'reshuffled', count: rest.length });
    }
    s.discardPile = [top];
  }
  return s.drawPile.pop() ?? null;
}

function giveCards(ctx: Ctx, p: Player, n: number): number {
  let count = 0;
  for (let i = 0; i < n; i++) {
    const c = drawOne(ctx);
    if (!c) break;
    p.hand.push(c);
    count++;
  }
  if (p.hand.length > 2) p.calledUno = false;
  ctx.events.push({ type: 'drew', playerId: p.id, count });
  return count;
}

/** Eliminates every active player at or over the Mercy limit. */
function checkMercy(ctx: Ctx): void {
  const { s, events } = ctx;
  for (const p of s.players) {
    if (p.status === 'active' && p.hand.length >= MERCY_LIMIT) {
      const cardCount = p.hand.length;
      eliminate(ctx, p);
      events.push({ type: 'eliminated', playerId: p.id, cardCount });
    }
  }
  checkLastStanding(ctx);
}

function eliminate(ctx: Ctx, p: Player): void {
  const { s } = ctx;
  s.drawPile.unshift(...p.hand);
  p.hand = [];
  p.status = 'eliminated';
  p.calledUno = false;
  s.eliminationOrder.push(p.id);
}

function checkLastStanding(ctx: Ctx): boolean {
  const left = activePlayers(ctx.s);
  if (left.length === 1) {
    declareWinner(ctx, left[0] as Player);
    return true;
  }
  return false;
}

function declareWinner(ctx: Ctx, p: Player): void {
  p.status = 'won';
  ctx.s.phase = { kind: 'roundOver', winnerId: p.id };
  ctx.events.push({ type: 'won', playerId: p.id });
}

function mostHeldColor(p: Player): Color {
  const counts = new Map<Color, number>();
  for (const c of p.hand) if (c.color) counts.set(c.color, (counts.get(c.color) ?? 0) + 1);
  let best: Color = 'red';
  let bestN = -1;
  for (const color of COLORS) {
    const n = counts.get(color) ?? 0;
    if (n > bestN) [best, bestN] = [color, n];
  }
  return best;
}

function pick<T>(ctx: Ctx, items: T[]): T | undefined {
  let r: number;
  [r, ctx.s.rngState] = nextRandom(ctx.s.rngState);
  return items[Math.floor(r * items.length)];
}
