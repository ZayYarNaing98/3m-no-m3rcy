import { MATCH_MINUTES_OPTIONS, MIN_PLAYERS, TURN_SECONDS_OPTIONS } from '@nomercy/engine';
import { useState } from 'react';
import { navigate } from '../App';
import { useGame } from '../store';
import { Avatar } from './Avatar';
import { ChatButton, ChatPanel } from './Chat';
import { TableFx } from './TableFx';
import { ThemeToggle } from './ThemeToggle';
import { seatRectOf, ThrowMenu, type ThrowTarget } from './ThrowMenu';

export function Lobby() {
  const { room, playerId, send, leave } = useGame();
  const [copied, setCopied] = useState(false);
  const [throwTarget, setThrowTarget] = useState<ThrowTarget | null>(null);
  if (!room) return null;
  const isHost = room.hostId === playerId;
  const me = room.players.find((p) => p.id === playerId);
  const guests = room.players.filter((p) => p.id !== room.hostId);
  const readyCount = guests.filter((p) => p.ready).length;
  const allReady = readyCount === guests.length;
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
      <div className="-mb-4 flex justify-end">
        <ThemeToggle />
      </div>
      <header className="text-center">
        <p className="text-sm text-muted">Room code</p>
        <p className="font-mono text-5xl font-black tracking-[0.2em]">{room.code}</p>
        <button className="mt-3 text-sm text-sky-400 light:text-sky-700 underline-offset-4 hover:underline" onClick={copy}>
          {copied ? 'Link copied!' : 'Copy invite link'}
        </button>
      </header>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted">Players · {room.players.length}/10</h2>
          <ChatButton />
        </div>
        <ul className="divide-y divide-line-soft rounded-2xl bg-surface light:shadow-md light:ring-1 light:ring-line">
          {room.players.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              {p.id === playerId ? (
                <span data-anchor={`seat:${p.id}`} className="rounded-full">
                  <Avatar name={p.name} size="sm" online={p.connected} />
                </span>
              ) : (
                <button
                  data-anchor={`seat:${p.id}`}
                  className="rounded-full transition active:scale-90"
                  onClick={(e) => setThrowTarget({ id: p.id, name: p.name, rect: seatRectOf(e.currentTarget) })}
                  aria-label={`Throw something at ${p.name}`}
                  title={`Throw something at ${p.name}`}
                >
                  <Avatar name={p.name} size="sm" online={p.connected} />
                </button>
              )}
              <span className="flex-1 truncate">
                {p.name}
                {p.id === playerId && <span className="text-subtle"> (you)</span>}
              </span>
              {p.id === room.hostId ? (
                <span className="rounded-full bg-amber-400/20 px-2 text-xs text-amber-300 light:text-amber-700">host</span>
              ) : p.ready ? (
                <span className="rounded-full bg-emerald-400/20 px-2 text-xs text-emerald-300 light:text-emerald-700">ready</span>
              ) : (
                <span className="rounded-full bg-surface-2 px-2 text-xs text-muted">not ready</span>
              )}
              {isHost && p.id !== playerId && (
                <button className="text-xs text-red-400 light:text-red-600 hover:underline" onClick={() => send('room:kick', { playerId: p.id })}>
                  Kick
                </button>
              )}
            </li>
          ))}
        </ul>
        {room.players.length > 1 && (
          <p className="mt-2 text-center text-xs text-subtle">Tap someone's avatar to throw something at them 👟🍅</p>
        )}
      </section>

      <section className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 light:shadow-md light:ring-1 light:ring-line">
        <label htmlFor="turn" className="text-sm">
          Turn timer
        </label>
        <select
          id="turn"
          className="rounded-lg bg-raised-2 px-2 py-1 text-base disabled:opacity-60 sm:text-sm light:bg-surface-2 light:font-semibold"
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
      <section className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 light:shadow-md light:ring-1 light:ring-line">
        <label htmlFor="match" className="text-sm">
          Match time
        </label>
        <select
          id="match"
          className="rounded-lg bg-raised-2 px-2 py-1 text-base disabled:opacity-60 sm:text-sm light:bg-surface-2 light:font-semibold"
          disabled={!isHost}
          value={room.settings.matchMinutes}
          onChange={(e) => send('room:settings', { matchMinutes: Number(e.target.value) })}
        >
          {MATCH_MINUTES_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 0 ? 'No limit' : `${s} minutes`}
            </option>
          ))}
        </select>
      </section>

      <div className="mt-auto flex flex-col gap-3">
        {isHost ? (
          <button
            className="btn-primary"
            disabled={room.players.length < MIN_PLAYERS || !allReady}
            onClick={() => send('game:start')}
          >
            {room.players.length < MIN_PLAYERS
              ? 'Waiting for players…'
              : allReady
                ? 'Start game'
                : `Waiting for everyone to be ready (${readyCount}/${guests.length})`}
          </button>
        ) : (
          <>
            <p className="text-center text-sm text-muted">
              {me?.ready ? 'Waiting for the host to start…' : 'Ready up so the host can start.'}
            </p>
            <button
              className={me?.ready ? 'btn-secondary' : 'btn-primary'}
              onClick={() => send('room:ready', { ready: !me?.ready })}
            >
              {me?.ready ? 'Not ready' : "I'm ready"}
            </button>
          </>
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
      {throwTarget && <ThrowMenu target={throwTarget} onClose={() => setThrowTarget(null)} />}
      <TableFx />
      <ChatPanel />
    </div>
  );
}
