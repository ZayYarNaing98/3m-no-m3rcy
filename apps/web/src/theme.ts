import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * Light/dark theme for the screens around a game (home, join, lobby). The game table is
 * always dark: while it is on screen it forces the dark theme, whatever the preference.
 * The theme is applied as `data-theme` on <html>, which switches the colour tokens in index.css.
 */

export type ThemePref = 'auto' | 'light' | 'dark';

const KEY = 'nomercy:theme';
const PAGE_COLOR = { light: '#eef2f7', dark: '#0f172a' };

let pref: ThemePref = readPref();
let forcedDark = 0;
const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function systemLight(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
}

function apply(): void {
  const light = forcedDark === 0 && (pref === 'light' || (pref === 'auto' && systemLight()));
  const theme = light ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAGE_COLOR[theme]);
}

if (typeof window !== 'undefined') {
  apply();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', apply);
}

export function setThemePref(next: ThemePref): void {
  pref = next;
  try {
    if (next === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Storage unavailable; the choice lasts until the page is closed.
  }
  apply();
  for (const l of listeners) l();
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pref,
  );
}

/** Keeps the dark theme on while the calling component is mounted (the game table). */
export function useForceDark(): void {
  useLayoutEffect(() => {
    forcedDark++;
    apply();
    return () => {
      forcedDark--;
      apply();
    };
  }, []);
}
