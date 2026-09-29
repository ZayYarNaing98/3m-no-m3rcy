import { useState } from 'react';
import { navigate } from '../App';

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
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-8 p-6">
      <header className="text-center">
        <h1 className="text-5xl font-black tracking-tight">
          <span className="text-red-500">UNO</span> <span className="text-yellow-400">No</span>{' '}
          <span className="text-blue-400">Mercy</span>
        </h1>
        <p className="mt-3 text-slate-400">168 cards. Stack everything. 25 cards and you're out.</p>
      </header>

      <button className="btn-primary" onClick={create} disabled={busy}>
        {busy ? 'Creating…' : 'Create a room'}
      </button>

      <form onSubmit={join} className="flex gap-2">
        <input
          className="input flex-1 text-center font-mono tracking-[0.3em] uppercase"
          placeholder="CODE"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Room code"
        />
        <button className="btn-secondary" type="submit">
          Join
        </button>
      </form>

      {error && <p className="text-center text-sm text-red-400">{error}</p>}
    </div>
  );
}
