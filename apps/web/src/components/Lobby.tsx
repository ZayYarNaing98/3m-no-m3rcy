import { BOT_LEVELS, MATCH_MINUTES_OPTIONS, MAX_BOTS, MAX_PLAYERS, MIN_PLAYERS, TURN_SECONDS_OPTIONS, type BotLevel } from '@nomercy/engine';
import { useEffect, useRef, useState } from 'react';
import { navigate } from '../App';
import { useGame } from '../store';
import { Avatar } from './Avatar';
import { ChatButton, ChatPanel } from './Chat';
import { isLeader } from '../scoreboard';
import { TableFx } from './TableFx';
import { ThemeToggle } from './ThemeToggle';
import { seatRectOf, ThrowMenu, type ThrowTarget } from './ThrowMenu';

const LEVEL_LABEL: Record<BotLevel, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

export function Lobby() {
  const { room, playerId, send, leave } = useGame();
  const [copied, setCopied] = useState(false);
  const [throwTarget, setThrowTarget] = useState<ThrowTarget | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [botLevel, setBotLevel] = useState<BotLevel>('normal');
  if (!room) return null;
  const isHost = room.hostId === playerId;
  const me = room.players.find((p) => p.id === playerId);
  const guests = room.players.filter((p) => p.id !== room.hostId);
  const readyCount = guests.filter((p) => p.ready).length;
  const allReady = readyCount === guests.length;
  const botCount = room.players.filter((p) => p.bot).length;
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

      {room.public && room.players.length === 1 && <WaitingBanner autoBotAt={room.autoBotAt} />}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted">
            Players · {room.players.length}/10
            {room.gamesPlayed > 0 && (
              <span className="font-normal">
                {' '}
                · 🎮 {room.gamesPlayed} {room.gamesPlayed === 1 ? 'game' : 'games'}
              </span>
            )}
          </h2>
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
              {p.id === playerId && editingName && room.status === 'lobby' ? (
                <NameEditor current={p.name} onDone={() => setEditingName(false)} />
              ) : (
                <span className="flex min-w-0 flex-1 items-center">
                  <span className="truncate">{p.name}</span>
                  {p.id === playerId && <span className="shrink-0 whitespace-pre text-subtle"> (you)</span>}
                  {p.id === playerId && room.status === 'lobby' && (
                    <button
                      className="ml-1 shrink-0 rounded-full px-1 text-sm opacity-70 transition hover:opacity-100 active:scale-90"
                      onClick={() => setEditingName(true)}
                      aria-label="Change your name"
                      title="Change your name"
                    >
                      ✏️
                    </button>
                  )}
                  {isLeader(room, p.id) && (
                    <span className="ml-1 shrink-0" title="Most wins" aria-label="Most wins">
                      👑
                    </span>
                  )}
                </span>
              )}
              {room.gamesPlayed > 0 && (
                <span className="text-xs font-semibold text-muted tabular-nums" title={`${p.wins} wins`}>
                  🏆{p.wins}
                </span>
              )}
              {p.id === room.hostId ? (
                <span className="rounded-full bg-amber-400/20 px-2 text-xs text-amber-300 light:text-amber-700">host</span>
              ) : p.bot && isHost ? (
                <select
                  className="rounded-full bg-sky-400/20 px-2 text-base text-sky-300 outline-none sm:text-xs light:text-sky-700"
                  value={p.bot}
                  onChange={(e) => send('room:setBot', { playerId: p.id, level: e.target.value })}
                  aria-label={`${p.name}'s level`}
                >
                  {BOT_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABEL[l]}
                    </option>
                  ))}
                </select>
              ) : p.bot ? (
                <span className="rounded-full bg-sky-400/20 px-2 text-xs text-sky-300 light:text-sky-700">{LEVEL_LABEL[p.bot]}</span>
              ) : p.ready ? (
                <span className="rounded-full bg-emerald-400/20 px-2 text-xs text-emerald-300 light:text-emerald-700">ready</span>
              ) : (
                <span className="rounded-full bg-surface-2 px-2 text-xs text-muted">not ready</span>
              )}
              {isHost && p.id !== playerId && (
                <button className="text-xs text-red-400 light:text-red-600 hover:underline" onClick={() => send('room:kick', { playerId: p.id })}>
                  {p.bot ? 'Remove' : 'Kick'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {isHost && (
          <div className="mt-2 flex items-center gap-2">
            <button
              className="btn-secondary flex-1 py-2 text-sm"
              disabled={botCount >= MAX_BOTS || room.players.length >= MAX_PLAYERS}
              onClick={() => send('room:addBot', { level: botLevel })}
            >
              🤖 {botCount >= MAX_BOTS ? `Bots full (${MAX_BOTS}/${MAX_BOTS})` : 'Add bot'}
            </button>
            <div role="radiogroup" aria-label="Bot level" className="inline-flex rounded-full bg-surface-2 p-0.5 text-xs">
              {BOT_LEVELS.map((l) => (
                <button
                  key={l}
                  role="radio"
                  aria-checked={botLevel === l}
                  className={`rounded-full px-2.5 py-1.5 font-semibold transition ${
                    botLevel === l ? 'bg-raised text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
                  }`}
                  onClick={() => setBotLevel(l)}
                >
                  {LEVEL_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
        )}
        {room.players.length > 1 && (
          <p className="mt-2 text-center text-xs text-subtle">Tap someone's avatar to throw something at them 🥾🍅</p>
        )}
        {isHost && room.gamesPlayed > 0 && (
          <div className="mt-1 text-center">
            {/* Two taps instead of a browser confirm dialog. */}
            <button
              className={`text-xs underline-offset-4 hover:underline ${confirmReset ? 'font-bold text-red-400 light:text-red-600' : 'text-subtle'}`}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true);
                  setTimeout(() => setConfirmReset(false), 3000);
                  return;
                }
                setConfirmReset(false);
                void send('room:resetScores');
              }}
            >
              {confirmReset ? 'Tap again to reset all scores' : 'Reset scores'}
            </button>
          </div>
        )}
      </section>

      <section className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 light:shadow-md light:ring-1 light:ring-line">
        <div>
          <p className="text-sm">🌍 Public room</p>
          <p className="text-xs text-subtle">
            {room.public ? 'Anyone can join from Quick play and Open rooms' : 'Only people with the code or link can join'}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={room.public}
          aria-label="Public room"
          disabled={!isHost}
          onClick={() => send('room:public', { public: !room.public })}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60 ${room.public ? 'bg-emerald-500' : 'bg-surface-3'}`}
        >
          <span
            className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${room.public ? 'translate-x-5' : ''}`}
          />
        </button>
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

/** Inline editor for your own name: Enter or ✓ saves, Escape or tapping away cancels. */
function NameEditor({ current, onDone }: { current: string; onDone: () => void }) {
  const rename = useGame((s) => s.rename);
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!form.current?.contains(e.target as Node)) onDone();
    };
    addEventListener('pointerdown', onDown);
    return () => removeEventListener('pointerdown', onDown);
  }, [onDone]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === current) return onDone();
    setBusy(true);
    const ack = await rename(n);
    setBusy(false);
    // On an error (name taken) the store shows a toast and the editor stays open to try again.
    if (ack.ok) onDone();
  }

  return (
    <form ref={form} onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1">
      <input
        className="min-w-0 flex-1 rounded-lg bg-surface-2 px-2 py-1 text-base outline-none ring-sky-400 focus:ring-2"
        value={name}
        maxLength={20}
        autoFocus
        enterKeyHint="done"
        aria-label="Your name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-sm font-bold text-white disabled:opacity-50"
        aria-label="Save name"
      >
        ✓
      </button>
    </form>
  );
}

/** Shown while you're alone in a public room: others can find it, and Quick play rooms get a bot soon. */
function WaitingBanner({ autoBotAt }: { autoBotAt: number | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!autoBotAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [autoBotAt]);
  const left = autoBotAt ? Math.max(0, Math.ceil((autoBotAt - now) / 1000)) : null;

  return (
    <div className="-mb-2 flex items-center gap-3 rounded-2xl bg-sky-500/15 px-4 py-3 text-sm ring-1 ring-sky-400/30">
      <span className="animate-pulse text-xl" aria-hidden="true">
        🔎
      </span>
      <div>
        <p className="font-semibold">Looking for players…</p>
        <p className="text-xs text-muted">
          {left !== null && left > 0 ? `A bot joins in ${left}s if nobody comes. ` : ''}You can also add bots and start now.
        </p>
      </div>
    </div>
  );
}
