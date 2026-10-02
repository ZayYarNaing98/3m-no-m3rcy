import { setThemePref, useThemePref, type ThemePref } from '../theme';

const OPTIONS: { value: ThemePref; icon: string; label: string }[] = [
  { value: 'light', icon: '☀️', label: 'Light' },
  { value: 'dark', icon: '🌙', label: 'Dark' },
];

/** Light / Dark switch for the screens outside a game. */
export function ThemeToggle() {
  const pref = useThemePref();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-full bg-surface-2 p-0.5 text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={pref === o.value}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold transition ${
            pref === o.value ? 'bg-raised text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
          }`}
          onClick={() => setThemePref(o.value)}
          title={`${o.label} theme`}
        >
          <span aria-hidden="true">{o.icon}</span>
          {o.label}
        </button>
      ))}
    </div>
  );
}
