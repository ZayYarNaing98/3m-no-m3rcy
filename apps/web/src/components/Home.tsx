import type { OpenRoom } from '@nomercy/engine';
import { useEffect, useState } from 'react';
import { navigate } from '../App';
import { setAutoJoin } from '../store';
import { Avatar } from './Avatar';
import { HeroBanner } from './HeroBanner';
import { ThemeToggle } from './ThemeToggle';

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'quick' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function quickPlay() {
    setBusy('quick');
    setError(null);
    try {
      const res = await fetch('/api/quickplay', { method: 'POST' });
      if (!res.ok) throw new Error();
      const { code } = (await res.json()) as { code: string };
      setAutoJoin(code);
      navigate(`/r/${code}`);
    } catch {
      setError('Could not find a game. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy('create');
    setError(null);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) throw new Error();
      const { code } = (await res.json()) as { code: string };
      navigate(`/r/${code}`);
    } catch {
      setError('Could not create a room. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return setError('Room codes are 6 characters.');
    const res = await fetch(`/api/rooms/${c}`);
    const info = res.ok ? ((await res.json()) as { exists: boolean }) : { exists: false };
    if (!info.exists) return setError('No room with that code.');
    navigate(`/r/${c}`);
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>
      <header className="text-center">
        <HeroBanner />
        <p className="mt-4 text-muted">168 cards. Stack everything. 25 cards and you're out.</p>
      </header>

      <div className="flex flex-col gap-3">
        <button className="btn-primary" onClick={quickPlay} disabled={busy !== null}>
          {busy === 'quick' ? 'Finding a game…' : '⚡ Quick play'}
        </button>
        <button className="btn-secondary" onClick={create} disabled={busy !== null}>
          {busy === 'create' ? 'Creating…' : 'Create a private room'}
        </button>
      </div>

      <form
        onSubmit={join}
        className="flex w-full items-center rounded-2xl bg-surface-2 p-1 ring-sky-400 focus-within:ring-2"
      >
        <input
          className="min-w-0 flex-1 bg-transparent px-4 py-2 font-mono tracking-[0.3em] uppercase outline-none placeholder:text-subtle"
          placeholder="ROOM CODE"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Room code"
        />
        <button
          className="rounded-xl bg-surface-3 px-5 py-2 font-semibold transition hover:bg-surface-3 active:scale-[0.98]"
          type="submit"
        >
          Join
        </button>
      </form>

      {error && <p className="text-center text-sm text-red-400 light:text-red-600">{error}</p>}

      <OpenRooms />
    </div>
  );
}

/** Public rooms waiting for players, refreshed every few seconds. */
function OpenRooms() {
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch('/api/open-rooms');
        if (res.ok && !stop) setRooms(((await res.json()) as { rooms: OpenRoom[] }).rooms);
      } catch {
        // Offline for a moment; keep the last list.
      }
      if (!stop) timer = setTimeout(load, 5000);
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted">🌍 Open rooms</h2>
      {rooms === null ? (
        <p className="animate-pulse text-center text-sm text-subtle">Looking…</p>
      ) : rooms.length === 0 ? (
        <p className="rounded-2xl bg-surface px-4 py-3 text-center text-sm text-subtle light:shadow-md light:ring-1 light:ring-line">
          No open rooms right now. Tap Quick play to start one!
        </p>
      ) : (
        <ul className="divide-y divide-line-soft rounded-2xl bg-surface light:shadow-md light:ring-1 light:ring-line">
          {rooms.map((r) => (
            <li key={r.code} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={r.host || '?'} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.host ? `${r.host}'s room` : 'New room'}</p>
                <p className="text-xs text-muted">
                  {r.players}/10 players{r.bots > 0 && ` · 🤖 ${r.bots}`}
                </p>
              </div>
              <button
                className="rounded-xl bg-surface-3 px-4 py-1.5 text-sm font-semibold transition hover:brightness-110 active:scale-[0.98]"
                onClick={() => {
                  setAutoJoin(r.code);
                  navigate(`/r/${r.code}`);
                }}
              >
                Join
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
