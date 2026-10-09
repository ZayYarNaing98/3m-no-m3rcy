import type { RoomView } from '@nomercy/engine';
import { useEffect, useState } from 'react';
import { NAME_KEY, takeAutoJoin, useGame } from '../store';
import { HeroBanner } from './HeroBanner';

export function JoinForm({ room }: { room: RoomView }) {
  const join = useGame((s) => s.join);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false);

  // Arriving from Quick play or the open rooms list with a saved name: take a seat straight away.
  useEffect(() => {
    const n = name.trim();
    if (!n || !takeAutoJoin(room.code)) return;
    setBusy(true);
    void join(n).finally(() => setBusy(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      // Ignore: name just won't be remembered.
    }
    setBusy(true);
    await join(n);
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 p-6">
      <HeroBanner />
      <p className="mt-2 text-center text-muted">
        Room <span className="font-mono text-fg">{room.code}</span> · {room.players.length}/10 players
      </p>
      <input
        className="input text-center"
        placeholder="Your nickname"
        maxLength={20}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Nickname"
      />
      <button className="btn-primary" disabled={busy || !name.trim()}>
        {busy ? 'Joining…' : 'Take a seat'}
      </button>
    </form>
  );
}
