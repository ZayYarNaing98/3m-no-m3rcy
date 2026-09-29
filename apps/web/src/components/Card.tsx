import type { Card as CardT, Color } from '@nomercy/engine';
import { useId, type ReactNode } from 'react';
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

/** Card face colours, tuned darker than stock for the No Mercy look. */
const FACE: Record<Color, string> = {
  red: '#d42a20',
  yellow: '#f2c200',
  green: '#2f9a41',
  blue: '#0b6cc0',
};
const WILD_FACE = '#141414';
const INK = '#141414';
const FONT = "'Arial Black', 'Helvetica Neue', Arial, sans-serif";

const SIZES = {
  sm: 'w-11',
  md: 'w-16',
  lg: 'w-24',
};

// Card geometry, in a 100 x 150 viewBox.
const W = 100;
const H = 150;

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
  const dim = playable === false ? 'opacity-45 saturate-50' : '';
  const lift = playable ? '-translate-y-2 drop-shadow-[0_0_6px_rgba(255,255,255,0.8)]' : '';
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={onClick ? playable === false : undefined}
      aria-label={cardName(card)}
      className={`relative block aspect-[2/3] shrink-0 rounded-[10%/6.7%] shadow-lg transition ${SIZES[size]} ${dim} ${lift} ${
        wildColor ? `ring-4 ${COLOR_RING[wildColor]}` : ''
      }`}
    >
      <CardFace card={card} />
    </Tag>
  );
}

function CardFace({ card }: { card: CardT }) {
  const uid = useId().replace(/:/g, '');
  const panel = card.color ? FACE[card.color] : WILD_FACE;
  const glyphFill = card.color ? FACE[card.color] : '#ffffff';
  const clip = `panel-${uid}`;
  const oval = `oval-${uid}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x="6" y="6" width={W - 12} height={H - 12} rx="8" />
        </clipPath>
        <clipPath id={oval}>
          <ellipse cx="50" cy="75" rx="33" ry="58" transform="rotate(28 50 75)" />
        </clipPath>
        <radialGradient id={`shade-${uid}`} cx="50%" cy="45%" r="70%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.35" />
        </radialGradient>
      </defs>

      {/* White border */}
      <rect x="0" y="0" width={W} height={H} rx="10" fill="#fdfdf8" />

      {/* Coloured face with a cracked, darkened edge */}
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="0" width={W} height={H} fill={panel} />
        <Cracks />
        <rect x="0" y="0" width={W} height={H} fill={`url(#shade-${uid})`} />

        {/* Tilted centre oval */}
        {card.color ? (
          <ellipse cx="50" cy="75" rx="33" ry="58" transform="rotate(28 50 75)" fill="#fdfdf8" />
        ) : (
          <g clipPath={`url(#${oval})`}>
            <rect x="0" y="0" width="50" height="75" fill={FACE.red} />
            <rect x="50" y="0" width="50" height="75" fill={FACE.blue} />
            <rect x="0" y="75" width="50" height="75" fill={FACE.yellow} />
            <rect x="50" y="75" width="50" height="75" fill={FACE.green} />
          </g>
        )}
      </g>

      {/* Centre symbol */}
      <g transform="translate(50 75)">
        <Glyph card={card} fill={glyphFill} scale={1} />
      </g>

      {/* Corner indices */}
      <g transform="translate(18 22)">
        <Glyph card={card} fill="#fdfdf8" scale={0.36} corner />
      </g>
      <g transform="translate(82 128) rotate(180)">
        <Glyph card={card} fill="#fdfdf8" scale={0.36} corner />
      </g>
    </svg>
  );
}

/** Faint crack lines across the face. */
function Cracks() {
  return (
    <g fill="none" stroke="#000" strokeOpacity="0.22" strokeWidth="0.8" strokeLinecap="round">
      <path d="M6 30 L18 36 L22 50 L34 54" />
      <path d="M94 20 L84 30 L86 42 L76 48" />
      <path d="M8 118 L20 112 L26 124 L38 128 L44 144" />
      <path d="M94 104 L82 110 L84 124 L72 134" />
      <path d="M22 50 L14 62" />
      <path d="M84 30 L92 38" />
    </g>
  );
}

/** Draws the card's symbol centred on (0, 0). */
function Glyph({ card, fill, scale, corner }: { card: CardT; fill: string; scale: number; corner?: boolean }) {
  const k = card.kind;
  const stroke = INK;
  const sw = corner ? 5 : 3;

  // Shrink long corner labels (+4, +10) so they clear the border.
  const cornerFit = (value: string) => (!corner ? 1 : value.length >= 3 ? 0.78 : value.length === 2 ? 0.8 : 1);
  const text = (value: string, size: number, dy = 0): ReactNode => (
    <text
      x="0"
      y={dy}
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily={FONT}
      fontWeight="900"
      fontStyle="italic"
      fontSize={size * cornerFit(value)}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw * cornerFit(value)}
      paintOrder="stroke"
      strokeLinejoin="round"
    >
      {value}
    </text>
  );

  let body: ReactNode;
  switch (k.type) {
    case 'number':
      body = (
        <>
          {text(String(k.value), 62)}
          {(k.value === 6 || k.value === 9) && (
            <rect x="-13" y="33" width="26" height="5" rx="2" fill={fill} stroke={stroke} strokeWidth={sw * 0.6} />
          )}
        </>
      );
      break;
    case 'skip':
      body = <SkipIcon fill={fill} stroke={stroke} />;
      break;
    case 'skipEveryone':
      body = (
        <>
          <g transform="translate(-9 -9) scale(0.7)">
            <SkipIcon fill={fill} stroke={stroke} />
          </g>
          <g transform="translate(9 9) scale(0.7)">
            <SkipIcon fill={fill} stroke={stroke} />
          </g>
        </>
      );
      break;
    case 'reverse':
      body = <ReverseIcon fill={fill} stroke={stroke} />;
      break;
    case 'draw2':
      body = text('+2', 44);
      break;
    case 'draw4':
      body = text('+4', 44);
      break;
    case 'discardAll':
      body = corner ? text('A', 62) : <DiscardAllIcon fill={fill} stroke={stroke} />;
      break;
    case 'wildReverseDraw4':
      body = corner ? (
        text('+4', 44)
      ) : (
        <>
          {text('+4', 40, -10)}
          <g transform="translate(0 24) scale(0.5)">
            <ReverseIcon fill={fill} stroke={stroke} />
          </g>
        </>
      );
      break;
    case 'wildDraw6':
      body = text('+6', 44);
      break;
    case 'wildDraw10':
      body = text('+10', 36);
      break;
    case 'wildColorRoulette':
      body = corner ? text('?', 62) : <RouletteIcon />;
      break;
  }

  return <g transform={`scale(${scale})`}>{body}</g>;
}

function SkipIcon({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <g strokeLinejoin="round">
      <circle r="24" fill="none" stroke={stroke} strokeWidth="14" />
      <circle r="24" fill="none" stroke={fill} strokeWidth="8" />
      <line x1="-17" y1="17" x2="17" y2="-17" stroke={stroke} strokeWidth="14" strokeLinecap="round" />
      <line x1="-17" y1="17" x2="17" y2="-17" stroke={fill} strokeWidth="8" strokeLinecap="round" />
    </g>
  );
}

function ReverseIcon({ fill, stroke }: { fill: string; stroke: string }) {
  // Two chunky arrows on a diagonal, pointing opposite ways.
  const arrow = 'M-17 -6 L3 -6 L3 -16 L19 0 L3 16 L3 6 L-17 6 Z';
  return (
    <g stroke={stroke} strokeWidth="3.5" strokeLinejoin="round" fill={fill}>
      <path d={arrow} transform="translate(-9 -9) rotate(-45)" />
      <path d={arrow} transform="translate(9 9) rotate(135)" />
    </g>
  );
}

function DiscardAllIcon({ fill, stroke }: { fill: string; stroke: string }) {
  // A fanned stack of three cards.
  return (
    <g stroke={stroke} strokeWidth="3" strokeLinejoin="round">
      <rect x="-22" y="-26" width="26" height="38" rx="4" fill={fill} transform="rotate(-18)" />
      <rect x="-13" y="-22" width="26" height="38" rx="4" fill={fill} />
      <rect x="-4" y="-18" width="26" height="38" rx="4" fill={fill} transform="rotate(18)" />
    </g>
  );
}

function RouletteIcon() {
  // A four-colour wheel with a pointer.
  const seg = (start: number, color: string) => {
    const a0 = (start * Math.PI) / 180;
    const a1 = ((start + 90) * Math.PI) / 180;
    const r = 24;
    return (
      <path
        d={`M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`}
        fill={color}
      />
    );
  };
  return (
    <g>
      <circle r="29" fill={INK} />
      {seg(-90, FACE.red)}
      {seg(0, FACE.blue)}
      {seg(90, FACE.green)}
      {seg(180, FACE.yellow)}
      <circle r="6" fill="#fdfdf8" stroke={INK} strokeWidth="2" />
      <path d="M0 -36 L-6 -24 L6 -24 Z" fill="#fdfdf8" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </g>
  );
}

export function CardBack({ size = 'md' }: { size?: keyof typeof SIZES }) {
  return (
    <div className={`relative block aspect-[2/3] shrink-0 shadow-lg ${SIZES[size]}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" aria-hidden="true">
        <rect x="0" y="0" width={W} height={H} rx="10" fill="#fdfdf8" />
        <rect x="6" y="6" width={W - 12} height={H - 12} rx="8" fill="#8f1510" />
        <Cracks />
        <ellipse cx="50" cy="75" rx="33" ry="58" transform="rotate(28 50 75)" fill={INK} />
        <g transform="rotate(-18 50 75)">
          <text
            x="50"
            y="72"
            textAnchor="middle"
            fontFamily={FONT}
            fontWeight="900"
            fontStyle="italic"
            fontSize="30"
            fill="#f2c200"
            stroke="#d42a20"
            strokeWidth="4"
            paintOrder="stroke"
            strokeLinejoin="round"
          >
            UNO
          </text>
          <text
            x="50"
            y="90"
            textAnchor="middle"
            fontFamily={FONT}
            fontWeight="900"
            fontSize="11"
            fill="#fdfdf8"
            letterSpacing="0.5"
          >
            NO MERCY
          </text>
        </g>
      </svg>
    </div>
  );
}
