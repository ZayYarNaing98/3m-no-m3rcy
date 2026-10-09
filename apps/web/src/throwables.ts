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
    /** A photo shown in the menu and in flight instead of the emoji; the emoji still bounces off on impact. */
    image?: string;
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
  angryShoe: { emoji: '👟', label: 'Angry shoe', impact: 'bonk', image: '/emotes/angry-shoe.webp' },
  brick: { emoji: '🧱', label: 'Brick', impact: 'bonk' },
  firecracker: { emoji: '🧨', label: 'Firecracker', impact: 'boom' },
  kiss: { emoji: '💋', label: 'Kiss', impact: 'love' },
  cake: { emoji: '🎂', label: 'Cake', impact: 'splat', splat: '🎂' },
  sock: { emoji: '🧦', label: 'Sock', impact: 'bonk' },
  glove: { emoji: '🥊', label: 'Punch', impact: 'bonk' },
  pizza: { emoji: '🍕', label: 'Pizza', impact: 'splat', splat: '🍕' },
  chili: { emoji: '🌶️', label: 'Chili', impact: 'boom' },
  angryStick: { emoji: '🪵', label: 'Angry stick', impact: 'bonk', image: '/emotes/angry-stick.webp' },
  balloon: { emoji: '🎈', label: 'Balloon', impact: 'boom' },
};

/** How long a throw is in the air, in ms. */
export const THROW_FLIGHT_MS = 700;

// Fetch the photo emotes up front, so the first one thrown at you isn't blank in flight.
if (typeof Image !== 'undefined') {
  for (const info of Object.values(THROWABLE_INFO)) if (info.image) new Image().src = info.image;
}
