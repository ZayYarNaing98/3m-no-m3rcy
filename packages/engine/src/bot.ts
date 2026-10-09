import { drawValue, isWild, MERCY_LIMIT } from './deck';
import { activePlayers, current, legalCardIds } from './engine';
import { COLORS, type Action, type Card, type Color, type GameState, type Player } from './types';

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

/** A random number in [0, 1); the server passes Math.random, tests pass something fixed. */
export type Rand = () => number;

/**
 * The bot's move for the decision in front of it, or null when nothing is waiting on it.
 * It only looks at what a player could see: its own hand, the table, and everyone's card counts.
 *
 * - easy: plays any legal card, often ducks a stack, picks colours at random.
 * - normal: matches colours it holds most of, saves wilds, stacks back, attacks a player close to winning.
 * - hard: also clears its hand with Discard All, saves draw cards for defence, and times 7s and 0s.
 */
export function botAction(state: GameState, botId: string, level: BotLevel, rand: Rand): Action | null {
  if (state.phase.kind === 'roundOver') return null;
  const me = current(state);
  if (me.id !== botId || me.status !== 'active') return null;
  const legal = new Set(legalCardIds(state, botId));
  const playable = me.hand.filter((c) => legal.has(c.id));

  switch (state.phase.kind) {
    case 'chooseColor':
      return { type: 'chooseColor', color: level === 'easy' && rand() < 0.5 ? pick(COLORS, rand) : bestColor(me.hand, rand) };

    case 'rouletteNameColor':
      // Flips stop on the named colour; each is about as likely, so any guess is as good.
      return { type: 'rouletteColor', color: pick(COLORS, rand) };

    case 'chooseSwapTarget': {
      const others = activePlayers(state).filter((p) => p.id !== botId);
      const target = level === 'easy' ? pick(others, rand) : fewest(others);
      return { type: 'chooseSwap', targetId: target.id };
    }

    case 'drawingUntilPlayable':
      return { type: 'play', cardId: state.phase.drawnCardId };

    case 'respondToStack': {
      if (playable.length === 0) return { type: 'draw' };
      const wouldBust = me.hand.length + state.phase.pending >= MERCY_LIMIT;
      // An easy bot sometimes just takes the hit, unless that would knock it out.
      if (level === 'easy' && !wouldBust && rand() < 0.35) return { type: 'draw' };
      // Pass on the smallest card that works, keeping the big ones for later.
      const card = [...playable].sort((a, b) => drawValue(a) - drawValue(b) || Number(isWild(a)) - Number(isWild(b)))[0];
      return { type: 'play', cardId: (card as Card).id };
    }

    case 'awaitingPlay': {
      if (playable.length === 0) return { type: 'draw' };
      if (level === 'easy') return { type: 'play', cardId: pick(playable, rand).id };
      const scored = playable.map((c) => ({ c, score: scoreCard(state, me, c, level) + rand() * 0.5 }));
      scored.sort((a, b) => b.score - a.score);
      return { type: 'play', cardId: (scored[0] as { c: Card }).c.id };
    }
  }
}

/** How likely a bot is to call UNO itself on reaching one card. Missing it lets players catch it. */
export const BOT_UNO_CHANCE: Record<BotLevel, number> = { easy: 0.6, normal: 0.9, hard: 1 };

/** Chance a bot catches a player who forgot UNO, and how long it waits first (ms). */
export const BOT_CATCH: Record<BotLevel, { chance: number; delayMs: number }> = {
  easy: { chance: 0.25, delayMs: 3000 },
  normal: { chance: 0.6, delayMs: 2200 },
  hard: { chance: 0.9, delayMs: 1400 },
};

/** How long a bot "thinks" before a move (ms): a base plus up to `spread` more. */
export const BOT_THINK: Record<BotLevel, { base: number; spread: number }> = {
  easy: { base: 1600, spread: 1000 },
  normal: { base: 1300, spread: 800 },
  hard: { base: 1000, spread: 600 },
};

// ---------------------------------------------------------------------------

function scoreCard(state: GameState, me: Player, card: Card, level: BotLevel): number {
  const next = nextPlayer(state, me);
  const threat = next ? next.hand.length <= 3 : false;
  const colorCount = (color: Color | null) => me.hand.filter((c) => c.color === color).length;
  const k = card.kind;
  let score = 0;

  // Prefer the colour it holds most of, so it keeps having matches.
  if (card.color) score += colorCount(card.color) * 0.6;
  // Wilds are worth keeping for when nothing else fits.
  if (isWild(card)) score -= 4;

  const dv = drawValue(card);
  if (dv > 0) {
    // Hit the next player when they're close to winning; otherwise hard bots hold draw cards back to stack on.
    if (threat) score += 6 + dv / 2;
    else if (level === 'hard') score -= 2 + dv / 4;
  }

  switch (k.type) {
    case 'number':
      score += 1;
      if (level === 'hard' && k.value === 7) {
        const others = activePlayers(state).filter((p) => p.id !== me.id);
        // Swapping only helps when someone holds fewer cards than it will after this play.
        score += fewest(others).hand.length < me.hand.length - 1 ? 5 : -5;
      }
      if (level === 'hard' && k.value === 0) {
        const prev = previousPlayer(state, me);
        score += prev && prev.hand.length < me.hand.length - 1 ? 4 : -4;
      }
      break;
    case 'skip':
    case 'skipEveryone':
      if (threat) score += 4;
      break;
    case 'discardAll':
      // Dumps every card of its colour; best with plenty of them.
      score += level === 'hard' ? colorCount(card.color) * 1.5 : 1;
      break;
    case 'wildColorRoulette':
      if (threat) score += 6;
      break;
  }

  // On the last two cards, get rid of the one that's hardest to play later.
  if (me.hand.length === 2 && isWild(card)) score -= 3;
  return score;
}

function bestColor(hand: Card[], rand: Rand): Color {
  const counts = COLORS.map((color) => hand.filter((c) => c.color === color).length);
  const top = Math.max(...counts);
  if (top === 0) return pick(COLORS, rand);
  return pick(
    COLORS.filter((_, i) => counts[i] === top),
    rand,
  );
}

function fewest(players: Player[]): Player {
  return players.reduce((a, b) => (b.hand.length < a.hand.length ? b : a));
}

function nextPlayer(state: GameState, me: Player): Player | undefined {
  return neighbour(state, me, state.direction);
}

/** The player whose hand passes to this one when a 0 rotates hands. */
function previousPlayer(state: GameState, me: Player): Player | undefined {
  return neighbour(state, me, state.direction === 1 ? -1 : 1);
}

function neighbour(state: GameState, me: Player, step: 1 | -1): Player | undefined {
  const n = state.players.length;
  let i = state.players.indexOf(me);
  for (let k = 0; k < n - 1; k++) {
    i = (i + step + n) % n;
    const p = state.players[i] as Player;
    if (p.status === 'active') return p;
  }
  return undefined;
}

function pick<T>(items: readonly T[], rand: Rand): T {
  return items[Math.floor(rand() * items.length) % items.length] as T;
}
