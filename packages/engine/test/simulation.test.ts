import { describe, expect, it } from 'vitest';
import {
  activePlayers,
  applyAction,
  COLORS,
  createGame,
  current,
  DECK_SIZE,
  legalCardIds,
  MERCY_LIMIT,
  nextRandom,
  type Action,
  type GameState,
} from '../src';
import { totalCards } from './helpers';

/** Random-but-legal bot: plays a legal card when it can, otherwise draws. */
function botAction(s: GameState, rng: { v: number }): { playerId: string; action: Action } {
  const rand = () => {
    let r: number;
    [r, rng.v] = nextRandom(rng.v);
    return r;
  };
  const p = current(s);
  const color = COLORS[Math.floor(rand() * 4)]!;
  switch (s.phase.kind) {
    case 'chooseColor':
      return { playerId: p.id, action: { type: 'chooseColor', color } };
    case 'rouletteNameColor':
      return { playerId: p.id, action: { type: 'rouletteColor', color } };
    case 'chooseSwapTarget': {
      const others = activePlayers(s).filter((o) => o.id !== p.id);
      return { playerId: p.id, action: { type: 'chooseSwap', targetId: others[Math.floor(rand() * others.length)]!.id } };
    }
    default: {
      if (rand() < 0.03) return { playerId: p.id, action: { type: 'timeout' } };
      const legal = legalCardIds(s, p.id);
      const mustPlay = s.phase.kind === 'drawingUntilPlayable';
      if (legal.length > 0 && (mustPlay || rand() < 0.9)) {
        return { playerId: p.id, action: { type: 'play', cardId: legal[Math.floor(rand() * legal.length)]! } };
      }
      return { playerId: p.id, action: { type: 'draw' } };
    }
  }
}

describe('simulation', () => {
  it('1,000 random games keep invariants and end with exactly one winner', () => {
    let finished = 0;
    for (let g = 0; g < 1000; g++) {
      const n = 2 + (g % 9);
      let s = createGame(
        Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
        g * 7919 + 1,
      );
      const rng = { v: g + 99 };
      for (let step = 0; step < 5000 && s.phase.kind !== 'roundOver'; step++) {
        const { playerId, action } = botAction(s, rng);
        s = applyAction(s, playerId, action).state;

        const where = `game ${g} step ${step}`;
        if (totalCards(s) !== DECK_SIZE) throw new Error(`${where}: card count ${totalCards(s)}`);
        for (const p of s.players) {
          if (p.status === 'active' && p.hand.length >= MERCY_LIMIT) throw new Error(`${where}: ${p.id} over the limit`);
          if (p.status === 'eliminated' && p.hand.length > 0) throw new Error(`${where}: ${p.id} out but holds cards`);
        }
        if (s.phase.kind !== 'roundOver' && current(s).status !== 'active') throw new Error(`${where}: inactive decider`);
      }
      if (s.phase.kind === 'roundOver') {
        finished++;
        expect(s.players.filter((p) => p.status === 'won')).toHaveLength(1);
      }
    }
    // Draw-until-playable can in theory loop, but nearly every game must finish.
    expect(finished).toBeGreaterThan(990);
  }, 60_000);
});
