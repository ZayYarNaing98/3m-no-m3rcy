import { AVATAR_COLORS, type PlayerAvatar } from '@nomercy/engine';
import { useGame } from '../store';

export const AVATAR_GRADIENTS: Record<PlayerAvatar['color'], string> = {
  red: 'from-rose-500 to-red-700',
  orange: 'from-amber-400 to-orange-600',
  green: 'from-lime-400 to-emerald-600',
  teal: 'from-teal-400 to-cyan-700',
  blue: 'from-sky-400 to-blue-700',
  violet: 'from-indigo-400 to-violet-700',
  purple: 'from-fuchsia-400 to-purple-700',
  pink: 'from-pink-400 to-rose-600',
};

const SIZES = {
  xs: 'h-6 w-6 text-[0.65rem]',
  sm: 'h-8 w-8 text-sm',
  md: 'h-11 w-11 text-lg',
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function defaultAvatar(name: string): PlayerAvatar {
  return { icon: 'initials', color: AVATAR_COLORS[hash(name.toLowerCase()) % AVATAR_COLORS.length]! };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]] : [name.trim()];
  return letters
    .map((w) => Array.from(w ?? '')[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function Avatar({
  name,
  playerId,
  avatar,
  size = 'sm',
  online,
  active,
  dimmed,
}: {
  name: string;
  playerId?: string;
  /** Explicit appearance for previews; otherwise look up the player's room choice. */
  avatar?: PlayerAvatar;
  size?: keyof typeof SIZES;
  /** Shows a green/grey presence dot when defined. */
  online?: boolean;
  /** Highlights the player whose turn it is. */
  active?: boolean;
  dimmed?: boolean;
}) {
  const roomAvatar = useGame((s) => playerId ? s.room?.players.find((p) => p.id === playerId)?.avatar : undefined);
  const appearance = avatar ?? roomAvatar ?? defaultAvatar(name);
  const gradient = AVATAR_GRADIENTS[appearance.color];
  return (
    <span className={`relative inline-flex shrink-0 ${dimmed ? 'opacity-50 grayscale' : ''}`} aria-hidden="true">
      <span
        className={`flex items-center justify-center rounded-full bg-gradient-to-br font-black text-white shadow-md ring-2 ${gradient} ${SIZES[size]} ${
          active ? 'animate-turn ring-amber-300' : 'ring-white/20'
        }`}
      >
        {appearance.icon === 'initials' ? initials(name) || '?' : appearance.icon}
      </span>
      {online !== undefined && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-raised ${
            online ? 'bg-emerald-400' : 'bg-slate-500'
          }`}
        />
      )}
    </span>
  );
}
