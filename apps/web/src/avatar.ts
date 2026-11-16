import { AVATAR_COLORS, AVATAR_ICONS, type PlayerAvatar } from '@nomercy/engine';

const KEY = 'nomercy:avatar';

export function loadAvatar(): PlayerAvatar | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (value && AVATAR_ICONS.includes(value.icon) && AVATAR_COLORS.includes(value.color)) {
      return { icon: value.icon, color: value.color };
    }
  } catch {
    // Missing, invalid, or unavailable storage uses initials as usual.
  }
}

export function saveAvatar(avatar: PlayerAvatar) {
  try {
    localStorage.setItem(KEY, JSON.stringify(avatar));
  } catch {
    // The server still remembers the avatar for this room.
  }
}
