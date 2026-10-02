import { describe, expect, it } from 'vitest';
import {
  applyAction,
  buildDeck,
  endByTime,
  createGame,
  DECK_SIZE,
  EngineError,
  legalCardIds,
  playerView,
  sortHand,
  type GameState,
} from '../src';
import { cardId, makeState, totalCards } from './helpers';

const R = 'red' as const;
const B = 'blue' as const;
const G = 'green' as const;
const Y = 'yellow' as const;

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}`);
}

describe('deck', () => {
  it('has 168 cards with the No Mercy composition', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    const count = (t: string) => deck.filter((c) => c.kind.type === t).length;
    expect(count('number')).toBe(80);
    expect(count('skip')).toBe(12);
    expect(count('reverse')).toBe(12);
    expect(count('draw2')).toBe(12);
    expect(count('draw4')).toBe(8);
    expect(count('discardAll')).toBe(12);
    expect(count('skipEveryone')).toBe(8);
    expect(count('wildReverseDraw4')).toBe(8);
    expect(count('wildDraw6')).toBe(4);
    expect(count('wildDraw10')).toBe(4);
    expect(count('wildColorRoulette')).toBe(8);
    expect(new Set(deck.map((c) => c.id)).size).toBe(DECK_SIZE);
  });
});

describe('sortHand', () => {
  it('puts wild cards first, then groups each colour with numbers before actions', () => {
    const { players } = makeState({
      hands: [
        [[B, 'reverse'], [null, 'wildDraw6'], [R, 'draw2'], [Y, 'draw2'], [Y, 'skip'], [R, 'number', 7], [R, 'draw4'], [R, 'number', 2]],
      ],
      top: [G, 'number', 5],
    });
    const label = (c: { color: string | null; kind: { type: string; value?: number } }) =>
      `${c.color ?? 'wild'} ${c.kind.type}${c.kind.value !== undefined ? ` ${c.kind.value}` : ''}`;
    expect(sortHand(players[0]!.hand).map(label)).toEqual([
      'wild wildDraw6',
      'red number 2',
      'red number 7',
      'red draw2',
      'red draw4',
      'yellow skip',
      'yellow draw2',
      'blue reverse',
    ]);
  });
});

describe('createGame', () => {
  it('seats players in a shuffled order that varies by seed', () => {
    const seats = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, name: `P${i}` }));
    const orders = new Set([1, 2, 3, 4, 5].map((seed) => createGame(seats, seed).players.map((p) => p.id).join()));
    expect(orders.size).toBeGreaterThan(1);
    for (const o of orders) expect(o.split(',').sort()).toEqual(seats.map((s) => s.id));
  });

  it('deals 7 each, starts on a number card, and is deterministic by seed', () => {
    const seats = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}` }));
    const a = createGame(seats, 123);
    const b = createGame(seats, 123);
    expect(a).toEqual(b);
    expect(a.players.every((p) => p.hand.length === 7)).toBe(true);
    expect(a.discardPile[0]?.kind.type).toBe('number');
    expect(totalCards(a)).toBe(DECK_SIZE);
  });

  it('rejects fewer than 2 players', () => {
    expectCode(() => createGame([{ id: 'a', name: 'A' }], 1), 'bad_player_count');
  });
});

describe('basic play', () => {
  it('allows matching colour or number and rejects others', () => {
    const s = makeState({
      hands: [[[R, 'number', 3], [B, 'number', 5], [G, 'number', 9]], [[Y, 'number', 1]]],
      top: [R, 'number', 5],
    });
    const legal = legalCardIds(s, 'p0');
    expect(legal).toContain(cardId(s, 0, 'number', R, 3));
    expect(legal).toContain(cardId(s, 0, 'number', B, 5));
    expect(legal).not.toContain(cardId(s, 0, 'number', G, 9));
    expectCode(() => applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'number', G, 9) }), 'illegal_card');
  });

  it('rejects actions out of turn', () => {
    const s = makeState({ hands: [[[R, 'number', 3]], [[R, 'number', 4]]], top: [R, 'number', 5] });
    expectCode(() => applyAction(s, 'p1', { type: 'draw' }), 'not_your_turn');
  });

  it('draws one card per tap and keeps the turn until a card is played', () => {
    let s = makeState({
      hands: [[[G, 'number', 9], [R, 'number', 8]], [[Y, 'number', 1], [Y, 'number', 2]]],
      top: [R, 'number', 5],
      drawTop: [[B, 'number', 1], [R, 'number', 7]],
    });
    // Drawing is allowed even while holding a playable card.
    let r = applyAction(s, 'p0', { type: 'draw' });
    expect(r.events).toContainEqual({ type: 'drew', playerId: 'p0', count: 1 });
    s = r.state;
    expect(s.phase.kind).toBe('awaitingPlay');
    expect(s.players[s.currentIndex]?.id).toBe('p0');
    expect(s.players[0]?.hand).toHaveLength(3);

    r = applyAction(s, 'p0', { type: 'draw' });
    s = r.state;
    expect(s.players[0]?.hand).toHaveLength(4);
    expect(s.players[s.currentIndex]?.id).toBe('p0');

    // Any legal card can be played, not only the one just drawn.
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'number', R, 8) }).state;
    expect(s.players[s.currentIndex]?.id).toBe('p1');
  });

  it('a timed-out player still draws until playable and keeps the card', () => {
    const s = makeState({
      hands: [[[G, 'number', 9], [G, 'number', 8]], [[Y, 'number', 1], [Y, 'number', 2]]],
      top: [R, 'number', 5],
      drawTop: [[B, 'number', 1], [Y, 'number', 2], [R, 'number', 7]],
    });
    const { state, events } = applyAction(s, 'p0', { type: 'timeout' });
    expect(events).toContainEqual({ type: 'drew', playerId: 'p0', count: 3 });
    expect(state.players[0]?.hand).toHaveLength(5);
    expect(state.players[state.currentIndex]?.id).toBe('p1');
  });

  it('wins when the last card is played', () => {
    const s = makeState({ hands: [[[R, 'number', 3]], [[Y, 'number', 1]]], top: [R, 'number', 5] });
    const { state } = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'number', R, 3) });
    expect(state.phase).toEqual({ kind: 'roundOver', winnerId: 'p0' });
  });
});

describe('action cards', () => {
  const three = (extra: Parameters<typeof makeState>[0]['hands'][number]) =>
    makeState({
      hands: [[...extra, [G, 'number', 1]], [[Y, 'number', 1], [Y, 'number', 2]], [[B, 'number', 1], [B, 'number', 2]]],
      top: [R, 'number', 5],
    });

  it('skip skips the next player', () => {
    const s = three([[R, 'skip']]);
    const { state } = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'skip') });
    expect(state.currentIndex).toBe(2);
  });

  it('reverse flips direction', () => {
    const s = three([[R, 'reverse']]);
    const { state } = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'reverse') });
    expect(state.direction).toBe(-1);
    expect(state.currentIndex).toBe(2);
  });

  it('reverse acts as skip with two players', () => {
    const s = makeState({
      hands: [[[R, 'reverse'], [G, 'number', 1]], [[Y, 'number', 1]]],
      top: [R, 'number', 5],
    });
    const { state } = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'reverse') });
    expect(state.currentIndex).toBe(0);
  });

  it('skip everyone gives the same player another turn', () => {
    const s = three([[R, 'skipEveryone']]);
    const { state } = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'skipEveryone') });
    expect(state.currentIndex).toBe(0);
    expect(state.phase.kind).toBe('awaitingPlay');
  });

  it('discard all removes every card of that colour', () => {
    const s = makeState({
      hands: [[[R, 'discardAll'], [R, 'number', 1], [R, 'number', 2], [G, 'number', 1]], [[Y, 'number', 1]]],
      top: [R, 'number', 5],
    });
    const { state, events } = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'discardAll') });
    expect(state.players[0]?.hand.map((c) => c.color)).toEqual([G]);
    expect(state.discardPile.at(-1)?.kind.type).toBe('discardAll');
    expect(events).toContainEqual({ type: 'discardedAll', playerId: 'p0', color: R, count: 2 });
    expect(totalCards(state)).toBe(DECK_SIZE);
  });

  it('discard all can win the round', () => {
    const s = makeState({
      hands: [[[R, 'discardAll'], [R, 'number', 1]], [[Y, 'number', 1]]],
      top: [R, 'number', 5],
    });
    const { state } = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'discardAll') });
    expect(state.phase).toEqual({ kind: 'roundOver', winnerId: 'p0' });
  });
});

describe('stacking', () => {
  it('stacks equal or higher draw cards and the last player takes the total', () => {
    let s: GameState = makeState({
      hands: [
        [[R, 'draw2'], [R, 'number', 1]],
        [[R, 'draw4'], [B, 'number', 1]],
        [[null, 'wildDraw6'], [G, 'number', 1]],
        [[Y, 'number', 9], [Y, 'number', 8]],
      ],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'draw2') }).state;
    expect(s.phase).toEqual({ kind: 'respondToStack', pending: 2, minValue: 2 });
    expect(s.currentIndex).toBe(1);

    s = applyAction(s, 'p1', { type: 'play', cardId: cardId(s, 1, 'draw4') }).state;
    expect(s.phase).toEqual({ kind: 'respondToStack', pending: 6, minValue: 4 });

    s = applyAction(s, 'p2', { type: 'play', cardId: cardId(s, 2, 'wildDraw6') }).state;
    expect(s.phase.kind).toBe('chooseColor');
    s = applyAction(s, 'p2', { type: 'chooseColor', color: G }).state;
    expect(s.phase).toEqual({ kind: 'respondToStack', pending: 12, minValue: 6 });
    expect(s.currentIndex).toBe(3);

    const r = applyAction(s, 'p3', { type: 'draw' });
    expect(r.state.players[3]?.hand).toHaveLength(14);
    expect(r.state.currentIndex).toBe(0);
    expect(r.state.phase.kind).toBe('awaitingPlay');
  });

  it('only stacks coloured draw cards in the colour in play or on the same card', () => {
    // Two players: the Wild Reverse +4 still passes the stack to p1.
    let s: GameState = makeState({
      hands: [
        [[null, 'wildReverseDraw4'], [R, 'number', 1]],
        [[R, 'draw4'], [Y, 'draw4'], [null, 'wildDraw6'], [B, 'draw2'], [G, 'number', 1]],
      ],
      top: [Y, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'wildReverseDraw4') }).state;
    s = applyAction(s, 'p0', { type: 'chooseColor', color: Y }).state;
    expect(s.phase).toMatchObject({ kind: 'respondToStack', minValue: 4 });
    expect(s.players[s.currentIndex]?.id).toBe('p1');

    // Yellow is in play: the yellow +4 and the wild +6 can stack, the red +4 and the +2 can't.
    const hand = s.players[1]!.hand;
    const legal = legalCardIds(s, 'p1').map((id) => hand.find((c) => c.id === id)!);
    expect(legal.map((c) => `${c.color ?? 'wild'} ${c.kind.type}`).sort()).toEqual(['wild wildDraw6', 'yellow draw4']);
    const redDraw4 = hand.find((c) => c.color === R && c.kind.type === 'draw4')!;
    expectCode(() => applyAction(s, 'p1', { type: 'play', cardId: redDraw4.id }), 'illegal_card');

    // Same card, different colour: blue +4 stacks on red +4.
    let t: GameState = makeState({
      hands: [
        [[R, 'draw4'], [R, 'number', 1]],
        [[B, 'draw4'], [B, 'number', 1]],
      ],
      top: [R, 'number', 5],
    });
    t = applyAction(t, 'p0', { type: 'play', cardId: cardId(t, 0, 'draw4') }).state;
    t = applyAction(t, 'p1', { type: 'play', cardId: cardId(t, 1, 'draw4') }).state;
    expect(t.phase).toMatchObject({ kind: 'respondToStack', pending: 8 });
  });

  it('rejects stacking a lower draw card', () => {
    let s: GameState = makeState({
      hands: [[[R, 'draw4'], [R, 'number', 1]], [[R, 'draw2'], [B, 'number', 1]]],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'draw4') }).state;
    expect(legalCardIds(s, 'p1')).toEqual([]);
    expectCode(() => applyAction(s, 'p1', { type: 'play', cardId: cardId(s, 1, 'draw2') }), 'illegal_card');
  });

  it('wild reverse draw 4 reverses before passing the penalty', () => {
    let s: GameState = makeState({
      hands: [[[null, 'wildReverseDraw4'], [R, 'number', 1]], [[Y, 'number', 1]], [[B, 'number', 1]]],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'wildReverseDraw4') }).state;
    s = applyAction(s, 'p0', { type: 'chooseColor', color: B }).state;
    expect(s.direction).toBe(-1);
    expect(s.currentIndex).toBe(2);
    expect(s.phase).toEqual({ kind: 'respondToStack', pending: 4, minValue: 4 });
    expect(s.activeColor).toBe(B);
  });
});

describe('mercy rule', () => {
  it('eliminates a player who reaches 25 cards and the last one standing wins', () => {
    const big: Parameters<typeof makeState>[0]['hands'][number] = [];
    for (let v = 0; v <= 9; v++) big.push([Y, 'number', v], [G, 'number', v]);
    big.push([B, 'number', 1], [B, 'number', 2]); // 22 cards
    let s: GameState = makeState({
      hands: [[[null, 'wildDraw10'], [R, 'number', 1]], big],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'wildDraw10') }).state;
    s = applyAction(s, 'p0', { type: 'chooseColor', color: R }).state;
    const r = applyAction(s, 'p1', { type: 'draw' });
    expect(r.events).toContainEqual({ type: 'eliminated', playerId: 'p1', cardCount: 32 });
    expect(r.state.phase).toEqual({ kind: 'roundOver', winnerId: 'p0' });
    expect(totalCards(r.state)).toBe(DECK_SIZE);
  });
});

describe('7-0 rule', () => {
  it('7 swaps hands with the chosen player', () => {
    let s: GameState = makeState({
      hands: [[[R, 'number', 7], [R, 'number', 1]], [[Y, 'number', 1], [Y, 'number', 2], [Y, 'number', 3]], [[B, 'number', 1]]],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'number', R, 7) }).state;
    expectCode(() => applyAction(s, 'p0', { type: 'chooseSwap', targetId: 'p0' }), 'bad_target');
    s = applyAction(s, 'p0', { type: 'chooseSwap', targetId: 'p1' }).state;
    expect(s.players[0]?.hand).toHaveLength(3);
    expect(s.players[1]?.hand).toHaveLength(1);
    expect(s.currentIndex).toBe(1);
  });

  it('0 passes every hand one seat in the play direction', () => {
    const s = makeState({
      hands: [[[R, 'number', 0], [R, 'number', 1]], [[Y, 'number', 1], [Y, 'number', 2]], [[B, 'number', 1], [B, 'number', 2], [B, 'number', 3]]],
      top: [R, 'number', 5],
    });
    const { state } = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'number', R, 0) });
    // p0 had 1 card left after playing; it goes to p1. p2's 3 cards go to p0.
    expect(state.players[1]?.hand).toHaveLength(1);
    expect(state.players[2]?.hand).toHaveLength(2);
    expect(state.players[0]?.hand).toHaveLength(3);
  });
});

describe('colour roulette', () => {
  it('next player names a colour and flips until it appears, then loses their turn', () => {
    let s: GameState = makeState({
      hands: [[[null, 'wildColorRoulette'], [R, 'number', 1]], [[Y, 'number', 1]], [[B, 'number', 1]]],
      top: [R, 'number', 5],
      drawTop: [[R, 'number', 2], [G, 'number', 3], [B, 'number', 4]],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'wildColorRoulette') }).state;
    // The player who played it does not pick a colour; the next player names it.
    expect(s.phase.kind).toBe('rouletteNameColor');
    expect(s.currentIndex).toBe(1);
    expectCode(() => applyAction(s, 'p0', { type: 'chooseColor', color: R }), 'not_your_turn');
    const r = applyAction(s, 'p1', { type: 'rouletteColor', color: B });
    expect(r.events).toContainEqual({ type: 'colorChosen', playerId: 'p1', color: B });
    const flip = r.events.find((e) => e.type === 'rouletteFlip');
    expect(flip).toMatchObject({ playerId: 'p1', color: B, count: 3 });
    // The flipped cards are revealed, ending on the named colour.
    expect(flip?.type === 'rouletteFlip' && flip.cards.map((c) => c.color)).toEqual([R, G, B]);
    expect(r.state.players[1]?.hand).toHaveLength(4);
    expect(r.state.activeColor).toBe(B);
    expect(r.state.currentIndex).toBe(2);
  });
});

describe('UNO call', () => {
  it('a player caught with one card and no call draws 2', () => {
    let s: GameState = makeState({
      hands: [[[R, 'number', 3], [R, 'number', 4]], [[Y, 'number', 1]]],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'number', R, 3) }).state;
    const r = applyAction(s, 'p1', { type: 'catchUno', targetId: 'p0' });
    expect(r.state.players[0]?.hand).toHaveLength(3);
  });

  it('a player who called UNO is safe', () => {
    let s: GameState = makeState({
      hands: [[[R, 'number', 3], [R, 'number', 4]], [[Y, 'number', 1]]],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'callUno' }).state;
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'number', R, 3) }).state;
    expectCode(() => applyAction(s, 'p1', { type: 'catchUno', targetId: 'p0' }), 'not_catchable');
  });
});

describe('timeouts and forfeits', () => {
  it('timeout on a stack takes the stack', () => {
    let s: GameState = makeState({
      hands: [[[R, 'draw2'], [R, 'number', 1]], [[Y, 'number', 1]]],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'draw2') }).state;
    const r = applyAction(s, 'p1', { type: 'timeout' });
    expect(r.state.players[1]?.hand).toHaveLength(3);
    expect(r.state.currentIndex).toBe(0);
  });

  it('timeout while choosing a colour picks the most-held colour', () => {
    let s: GameState = makeState({
      hands: [[[null, 'wildDraw6'], [B, 'number', 1], [B, 'number', 2], [R, 'number', 1]], [[Y, 'number', 1]]],
      top: [R, 'number', 5],
    });
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'wildDraw6') }).state;
    const r = applyAction(s, 'p0', { type: 'timeout' });
    expect(r.state.activeColor).toBe(B);
  });

  it('forfeit by the current player moves the turn on', () => {
    const s = makeState({
      hands: [[[R, 'number', 1]], [[Y, 'number', 1]], [[B, 'number', 1]]],
      top: [R, 'number', 5],
    });
    const r = applyAction(s, 'p0', { type: 'forfeit' });
    expect(r.state.players[0]?.status).toBe('eliminated');
    expect(r.state.currentIndex).toBe(1);
    expect(totalCards(r.state)).toBe(DECK_SIZE);
  });
});

describe('playerView', () => {
  it('hides other hands', () => {
    const s = makeState({ hands: [[[R, 'number', 1]], [[Y, 'number', 1], [Y, 'number', 2]]], top: [R, 'number', 5] });
    const v = playerView(s, 'p0');
    expect(v.hand).toHaveLength(1);
    expect(v.players[1]?.cardCount).toBe(2);
    expect(JSON.stringify(v)).not.toContain(s.players[1]?.hand[0]?.id + '"');
  });
});

describe('match clock', () => {
  it('fewest cards wins when time is up', () => {
    const s = makeState({
      hands: [
        [[R, 'number', 1], [R, 'number', 2], [R, 'number', 3]],
        [[null, 'wildDraw10'], [B, 'number', 9]],
        [[Y, 'number', 1], [Y, 'number', 2], [Y, 'number', 3], [Y, 'number', 4]],
      ],
      top: [G, 'number', 5],
    });
    const { state, events } = endByTime(s);
    expect(events.map((e) => e.type)).toEqual(['timeUp', 'won']);
    expect(state.phase).toEqual({ kind: 'roundOver', winnerId: 'p1', timeUp: { points: { p0: 6, p1: 59, p2: 10 } } });
    expect(state.players[1]?.status).toBe('won');
  });

  it('breaks a tie on cards with the lowest card points, then the earlier seat', () => {
    const s = makeState({
      hands: [
        [[null, 'wildDraw6'], [R, 'number', 1]],
        [[B, 'skip'], [B, 'number', 2]],
        [[G, 'number', 9], [G, 'number', 8]],
      ],
      top: [Y, 'number', 5],
    });
    // p0 = 51, p1 = 22, p2 = 17 points: p2 wins.
    expect(endByTime(s).state.phase).toMatchObject({ winnerId: 'p2' });

    const tied = makeState({
      hands: [[[R, 'number', 4]], [[B, 'number', 4]]],
      top: [Y, 'number', 5],
    });
    expect(endByTime(tied).state.phase).toMatchObject({ winnerId: 'p0' });
  });

  it('ignores eliminated players and drops a pending stack', () => {
    let s = makeState({
      hands: [
        [[R, 'draw4'], [R, 'number', 1], [R, 'number', 2]],
        [[B, 'number', 1], [B, 'number', 2], [B, 'number', 3], [B, 'number', 4]],
        [[G, 'number', 1]],
      ],
      top: [R, 'number', 5],
    });
    s = { ...s, players: s.players.map((p) => (p.id === 'p2' ? { ...p, status: 'eliminated' as const } : p)) };
    s = applyAction(s, 'p0', { type: 'play', cardId: cardId(s, 0, 'draw4') }).state;
    expect(s.phase.kind).toBe('respondToStack');
    const { state } = endByTime(s);
    expect(state.phase).toMatchObject({ kind: 'roundOver', winnerId: 'p0' });
    expect(state.players[1]?.hand).toHaveLength(4);
  });
});
