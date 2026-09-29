import { MIN_PLAYERS, TURN_SECONDS_OPTIONS } from '@nomercy/engine';
import { useState } from 'react';
import { navigate } from '../App';
import { useGame } from '../store';
import { Avatar } from './Avatar';

export function Lobby() {
  const { room, playerId, send, leave } = useGame();
  const [copied, setCopied] = useState(false);
  if (!room) return null;
  const isHost = room.hostId === playerId;
  const link = `${location.origin}/r/${room.code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the link is visible to copy by hand.
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6">
      <header className="text-center">
        <p className="text-sm text-slate-400">Room code</p>
        <p className="font-mono text-5xl font-black tracking-[0.2em]">{room.code}</p>
        <button className="mt-3 text-sm text-sky-400 underline-offset-4 hover:underline" onClick={copy}>
          {copied ? 'Link copied!' : 'Copy invite link'}
        </button>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-400">Players · {room.players.length}/10</h2>
        <ul className="divide-y divide-white/5 rounded-2xl bg-white/5">
          {room.players.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={p.name} size="sm" online={p.connected} />
              <span className="flex-1 truncate">
                {p.name}
                {p.id === playerId && <span className="text-slate-500"> (you)</span>}
              </span>
              {p.id === room.hostId && <span className="rounded-full bg-amber-400/20 px-2 text-xs text-amber-300">host</span>}
              {isHost && p.id !== playerId && (
                <button className="text-xs text-red-400 hover:underline" onClick={() => send('room:kick', { playerId: p.id })}>
                  Kick
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
        <label htmlFor="turn" className="text-sm">
          Turn timer
        </label>
        <select
          id="turn"
          className="rounded-lg bg-slate-800 px-2 py-1 text-sm disabled:opacity-60"
          disabled={!isHost}
          value={room.settings.turnSeconds}
          onChange={(e) => send('room:settings', { turnSeconds: Number(e.target.value) })}
        >
          {TURN_SECONDS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s} seconds
            </option>
          ))}
        </select>
      </section>

      <div className="mt-auto flex flex-col gap-3">
        {isHost ? (
          <button className="btn-primary" disabled={room.players.length < MIN_PLAYERS} onClick={() => send('game:start')}>
            {room.players.length < MIN_PLAYERS ? 'Waiting for players…' : 'Start game'}
          </button>
        ) : (
          <p className="text-center text-slate-400">Waiting for the host to start…</p>
        )}
        <button
          className="btn-secondary"
          onClick={async () => {
            await leave();
            navigate('/');
          }}
        >
          Leave room
        </button>
      </div>
    </div>
  );
}
