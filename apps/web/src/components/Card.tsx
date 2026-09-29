import type { Card as CardT, Color } from '@nomercy/engine';
import { cardName } from '../events';

export const COLOR_BG: Record<Color, string> = {
  red: 'bg-red-600',
  yellow: 'bg-yellow-400 text-slate-900',
  green: 'bg-emerald-600',
  blue: 'bg-blue-600',
};

export const COLOR_RING: Record<Color, string> = {
  red: 'ring-red-500',
  yellow: 'ring-yellow-400',
  green: 'ring-emerald-500',
  blue: 'ring-blue-500',
};

function face(card: CardT): { big: string; small?: string } {
  const k = card.kind;
  switch (k.type) {
    case 'number':
      return { big: String(k.value) };
    case 'skip':
      return { big: '⊘', small: 'skip' };
    case 'reverse':
      return { big: '⇄', small: 'reverse' };
    case 'draw2':
      return { big: '+2' };
    case 'draw4':
      return { big: '+4' };
    case 'discardAll':
      return { big: 'ALL', small: 'discard' };
    case 'skipEveryone':
      return { big: '⊘⊘', small: 'skip all' };
    case 'wildReverseDraw4':
      return { big: '+4', small: '⇄ wild' };
    case 'wildDraw6':
      return { big: '+6', small: 'wild' };
    case 'wildDraw10':
      return { big: '+10', small: 'wild' };
    case 'wildColorRoulette':
      return { big: '?', small: 'roulette' };
  }
}

const SIZES = {
  sm: 'h-16 w-11 rounded-lg text-lg',
  md: 'h-24 w-16 rounded-xl text-2xl',
  lg: 'h-32 w-22 rounded-2xl text-4xl',
};

export function Card({
  card,
  size = 'md',
  playable,
  onClick,
  wildColor,
}: {
  card: CardT;
  size?: keyof typeof SIZES;
  playable?: boolean;
  onClick?: () => void;
  /** Colour chosen for a wild on the discard pile. */
  wildColor?: Color;
}) {
  const { big, small } = face(card);
  const bg = card.color
    ? COLOR_BG[card.color]
    : 'bg-[conic-gradient(at_50%_50%,#dc2626_0_25%,#facc15_0_50%,#059669_0_75%,#2563eb_0)]';
  const dim = playable === false ? 'opacity-40 saturate-50' : '';
  const lift = playable ? '-translate-y-2 shadow-[0_0_0_3px_rgba(255,255,255,0.9)]' : '';
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={onClick ? playable === false : undefined}
      aria-label={cardName(card)}
      className={`relative flex shrink-0 flex-col items-center justify-center font-black text-white shadow-lg ring-2 ring-white/80 transition ${SIZES[size]} ${bg} ${dim} ${lift} ${
        wildColor ? `ring-4 ${COLOR_RING[wildColor]}` : ''
      }`}
    >
      <span className={`rounded-full px-1 leading-none ${card.color ? '' : 'bg-slate-900/70 px-2 py-1'}`}>{big}</span>
      {small && size !== 'sm' && (
        <span className="mt-1 rounded bg-black/25 px-1 text-[0.55rem] font-semibold tracking-wide uppercase">{small}</span>
      )}
    </Tag>
  );
}

export function CardBack({ size = 'md', label }: { size?: keyof typeof SIZES; label?: string }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-slate-900 font-black ring-2 ring-white/80 ${SIZES[size]}`}
    >
      <span className="-rotate-12 rounded-full bg-red-600 px-2 text-sm text-yellow-300 italic">{label ?? 'UNO'}</span>
    </div>
  );
}
