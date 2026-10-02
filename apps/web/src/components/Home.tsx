import { useState } from 'react';
import { navigate } from '../App';
import { HeroBanner } from './HeroBanner';
import { ThemeToggle } from './ThemeToggle';

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) throw new Error();
      const { code } = (await res.json()) as { code: string };
      navigate(`/r/${code}`);
    } catch {
      setError('Could not create a room. Try again.');
    } finally {
      setBusy(false);
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

      <button className="btn-primary" onClick={create} disabled={busy}>
        {busy ? 'Creating…' : 'Create a room'}
      </button>

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
    </div>
  );
}
