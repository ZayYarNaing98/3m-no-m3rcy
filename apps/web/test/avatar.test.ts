import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadAvatar, saveAvatar } from '../src/avatar';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('remembers an avatar for future rooms', () => {
  expect(loadAvatar()).toBeUndefined();
  saveAvatar({ icon: '🐼', color: 'blue' });
  expect(loadAvatar()).toEqual({ icon: '🐼', color: 'blue' });
});

it.each(['broken json', 'null', '{"icon":"unknown","color":"red"}', '{"icon":"🐼","color":"unknown"}'])(
  'falls back safely for invalid saved data: %s', (value) => {
    localStorage.setItem('nomercy:avatar', value);
    expect(loadAvatar()).toBeUndefined();
  },
);

it('works when browser storage is unavailable', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('Unavailable'); },
    setItem: () => { throw new Error('Unavailable'); },
  });
  expect(loadAvatar()).toBeUndefined();
  expect(() => saveAvatar({ icon: 'initials', color: 'green' })).not.toThrow();
});
