import type { Throwable } from '@nomercy/engine';

export type Impact = 'bonk' | 'splat' | 'boom' | 'love';

/** How each throwable looks in the menu, in flight, and when it lands. */
export const THROWABLE_INFO: Record<
  Throwable,
  {
    emoji: string;
    label: string;
    impact: Impact;
    splat?: string;
    /** Leaves a stink cloud and a fly behind. */
    stinky?: boolean;
  }
> = {
  shoe: { emoji: '🥾', label: 'Dirty shoe', impact: 'bonk', stinky: true },
  stone: { emoji: '🪨', label: 'Stone', impact: 'bonk' },
  hammer: { emoji: '🔨', label: 'Hammer', impact: 'bonk' },
  tomato: { emoji: '🍅', label: 'Tomato', impact: 'splat', splat: '🍅' },
  egg: { emoji: '🥚', label: 'Egg', impact: 'splat', splat: '🍳' },
  bomb: { emoji: '💣', label: 'Bomb', impact: 'boom' },
  rose: { emoji: '🌹', label: 'Rose', impact: 'love' },
  poop: { emoji: '💩', label: 'Poop', impact: 'splat', splat: '💩' },
  pie: { emoji: '🥧', label: 'Pie', impact: 'splat', splat: '🥧' },
  brick: { emoji: '🧱', label: 'Brick', impact: 'bonk' },
  firecracker: { emoji: '🧨', label: 'Firecracker', impact: 'boom' },
  kiss: { emoji: '💋', label: 'Kiss', impact: 'love' },
  cake: { emoji: '🎂', label: 'Cake', impact: 'splat', splat: '🎂' },
  sock: { emoji: '🧦', label: 'Sock', impact: 'bonk' },
  glove: { emoji: '🥊', label: 'Punch', impact: 'bonk' },
  pizza: { emoji: '🍕', label: 'Pizza', impact: 'splat', splat: '🍕' },
  chili: { emoji: '🌶️', label: 'Chili', impact: 'boom' },
  balloon: { emoji: '🎈', label: 'Balloon', impact: 'boom' },
};

/** How long a throw is in the air, in ms. */
export const THROW_FLIGHT_MS = 700;
