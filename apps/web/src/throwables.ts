import type { Throwable } from '@nomercy/engine';

export type Impact = 'bonk' | 'splat' | 'boom' | 'love';

/** How each throwable looks in the menu, in flight, and when it lands. */
export const THROWABLE_INFO: Record<Throwable, { emoji: string; label: string; impact: Impact; splat?: string }> = {
  shoe: { emoji: '👟', label: 'Shoe', impact: 'bonk' },
  stone: { emoji: '🪨', label: 'Stone', impact: 'bonk' },
  hammer: { emoji: '🔨', label: 'Hammer', impact: 'bonk' },
  tomato: { emoji: '🍅', label: 'Tomato', impact: 'splat', splat: '🍅' },
  egg: { emoji: '🥚', label: 'Egg', impact: 'splat', splat: '🍳' },
  bomb: { emoji: '💣', label: 'Bomb', impact: 'boom' },
  rose: { emoji: '🌹', label: 'Rose', impact: 'love' },
  water: { emoji: '💧', label: 'Water', impact: 'splat', splat: '💦' },
  poop: { emoji: '💩', label: 'Poop', impact: 'splat', splat: '💩' },
  pie: { emoji: '🥧', label: 'Pie', impact: 'splat', splat: '🥧' },
  fish: { emoji: '🐟', label: 'Fish', impact: 'bonk' },
  banana: { emoji: '🍌', label: 'Banana', impact: 'bonk' },
  brick: { emoji: '🧱', label: 'Brick', impact: 'bonk' },
  firecracker: { emoji: '🧨', label: 'Firecracker', impact: 'boom' },
  kiss: { emoji: '💋', label: 'Kiss', impact: 'love' },
  cake: { emoji: '🎂', label: 'Cake', impact: 'splat', splat: '🎂' },
};

/** How long a throw is in the air, in ms. */
export const THROW_FLIGHT_MS = 700;
