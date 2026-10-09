import { describe, expect, it } from 'vitest';
import {
  applyAction,
  botAction,
  BOT_LEVELS,
  createGame,
  current,
  DECK_SIZE,
  nextRandom,
  type BotLevel,
  type GameState,
} from '../src';
import { cardId, makeState, totalCards } from './helpers';

const R = 'red' as const;
const B = 'blue' as const;
const Y = 'yellow' as const;
const half = () => 0.5;

describe('bot decisions', () => {
  it('stacks back with its smallest legal draw card, or takes the stack', () => {
    const s = makeState({
      hands: [[[Y, 'number', 1]], [[R, 'draw4'], [null, 'wildDraw10'], [B, 'number', 2]]],
      top: [R, 'draw2'],
      current: 1,
      phase: { kind: 'respondToStack', pending: 2, minValue: 2 },
    });
    for (const level of ['normal', 'hard'] as const) {
      expect(botAction(s, 'p1', level, half)).toEqual({ type: 'play', cardId: cardId(s, 1, 'draw4', R) });
    }
    const none = makeState({
      hands: [[[Y, 'number', 1]], [[B, 'number', 2]]],
      top: [R, 'draw2'],
      current: 1,
      phase: { kind: 'respondToStack', pending: 2, minValue: 2 },
    });
    expect(botAction(none, 'p1', 'hard', half)).toEqual({ type: 'draw' });
  });

  it('plays a matching card before a wild, and draws with nothing to play', () => {
    const s = makeState({
      hands: [
        [[null, 'wildDraw6'], [R, 'number', 3], [B, 'number', 9]],
        [[Y, 'number', 1], [Y, 'number', 2], [Y, 'number', 3], [Y, 'number', 4], [Y, 'number', 5]],
      ],
      top: [R, 'number', 5],
    });
    expect(botAction(s, 'p0', 'normal', half)).toEqual({ type: 'play', cardId: cardId(s, 0, 'number', R, 3) });
    const stuck = makeState({ hands: [[[B, 'number', 9]], [[Y, 'number', 1]]], top: [R, 'number', 5] });
    expect(botAction(stuck, 'p0', 'easy', half)).toEqual({ type: 'draw' });
  });

  it('hits a player close to winning with a draw card', () => {
    const s = makeState({
      hands: [
        [[R, 'number', 3], [R, 'draw2'], [R, 'number', 4]],
        [[Y, 'number', 1], [Y, 'number', 2]],
      ],
      top: [R, 'number', 5],
    });
    expect(botAction(s, 'p0', 'hard', half)).toEqual({ type: 'play', cardId: cardId(s, 0, 'draw2', R) });
  });

  it('names the colour it holds most of and swaps with the smallest hand', () => {
    const s = makeState({
      hands: [[[B, 'number', 1], [B, 'number', 2], [R, 'number', 3]], [[Y, 'number', 1]], [[Y, 'number', 2], [Y, 'number', 3]]],
      top: [null, 'wildDraw6'],
      activeColor: R,
      phase: { kind: 'chooseColor', cardId: 'x' },
    });
    expect(botAction(s, 'p0', 'normal', half)).toEqual({ type: 'chooseColor', color: B });
    const swap: GameState = { ...s, phase: { kind: 'chooseSwapTarget' } };
    expect(botAction(swap, 'p0', 'hard', half)).toEqual({ type: 'chooseSwap', targetId: 'p1' });
  });

  it('does nothing when it is not its decision', () => {
    const s = makeState({ hands: [[[R, 'number', 3]], [[Y, 'number', 1]]], top: [R, 'number', 5] });
    expect(botAction(s, 'p1', 'normal', half)).toBeNull();
  });
});

describe('bot-only games', () => {
  it('bots of every level only make legal moves and finish their games', () => {
    for (let g = 0; g < 150; g++) {
      const n = 2 + (g % 4);
      const levels: BotLevel[] = Array.from({ length: n }, (_, i) => BOT_LEVELS[(g + i) % 3] as BotLevel);
      let s = createGame(
        Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
        g * 104729 + 3,
      );
      let seed = g + 7;
      const rand = () => {
        let r: number;
        [r, seed] = nextRandom(seed);
        return r;
      };
      let steps = 0;
      for (; steps < 20_000 && s.phase.kind !== 'roundOver'; steps++) {
        const p = current(s);
        const action = botAction(s, p.id, levels[Number(p.id.slice(1))] as BotLevel, rand);
        expect(action).not.toBeNull();
        s = applyAction(s, p.id, action!).state;
        const me = s.players.find((x) => x.id === p.id)!;
        if (s.phase.kind !== 'roundOver' && me.status === 'active' && me.hand.length === 1 && !me.calledUno) {
          s = applyAction(s, p.id, { type: 'callUno' }).state;
        }
        expect(totalCards(s)).toBe(DECK_SIZE);
      }
      expect(s.phase.kind).toBe('roundOver');
    }
  });
});
