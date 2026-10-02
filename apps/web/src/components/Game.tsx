import { COLORS, MERCY_LIMIT, REACTIONS, sortHand, type Color, type EndOutcome, type EndVote, type PlayerView, type PublicPlayer } from '@nomercy/engine';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { navigate } from '../App';
import { setSoundEnabled, soundEnabled } from '../sound';
import { useGame } from '../store';
import { useForceDark } from '../theme';
import { Avatar } from './Avatar';
import { Card, CardBack, COLOR_BG, COLOR_RING } from './Card';
import { ChatButton, ChatPanel } from './Chat';
import { TableFx } from './TableFx';
import { seatRectOf, ThrowMenu, type ThrowTarget } from './ThrowMenu';

export function Game() {
  const { game, room, playerId, stateVersion, deadline, log, send } = useGame();
  // The table is always dark; light mode is only for the screens around a game.
  useForceDark();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // The table version the player already answered a picker for. Pickers hide as soon as a choice
  // is tapped, instead of waiting for the next table state (which may be held while an
  // elimination plays out).
  const [answeredVersion, setAnsweredVersion] = useState<number | null>(null);
  const [throwTarget, setThrowTarget] = useState<ThrowTarget | null>(null);
  if (!game || !room) return null;

  const me = game.players.find((p) => p.id === playerId);
  const current = game.players.find((p) => p.id === game.currentPlayerId) as PublicPlayer;
  const myTurn = game.currentPlayerId === playerId && me?.status === 'active';
  const phase = game.phase;
  const legal = new Set(game.legalCardIds);
  const canDraw = myTurn && (phase.kind === 'awaitingPlay' || phase.kind === 'respondToStack');
  const finished = phase.kind === 'roundOver' || room.status === 'finished';

  const play = (cardId: string) => send('game:play', { cardId, stateVersion });
  const draw = () => send('game:draw', { stateVersion });
  const showPicker = myTurn && answeredVersion !== stateVersion;
  const canCatchSeat = (p: PublicPlayer) => me?.status === 'active' && p.status === 'active' && p.cardCount === 1 && !p.calledUno;
  // Seated players can throw things at anyone else still in the room; spectators can't.
  const inRoom = new Set(room.players.map((p) => p.id));
  const onSeatTap = me ? (target: ThrowTarget) => inRoom.has(target.id) && setThrowTarget(target) : undefined;
  const throwTargetPlayer = throwTarget && game.players.find((p) => p.id === throwTarget.id);
  // Close the picker straight away; bring it back if the server rejects the choice.
  const answer = (type: string, payload: object) => {
    setAnsweredVersion(stateVersion);
    void send(type, payload).then((ack) => {
      if (!ack.ok) setAnsweredVersion(null);
    });
  };

  // Seat order starting after me, so opponents read clockwise.
  const myIndex = game.players.findIndex((p) => p.id === playerId);
  const opponents = [...game.players.slice(myIndex + 1), ...game.players.slice(0, Math.max(myIndex, 0))];

  // Spectators have no seat: they just disconnect, nothing is forfeited.
  const stopWatching = () => {
    useGame.getState().disconnect();
    navigate('/');
  };

  return (
    // Exactly one screen tall: the table flexes to fill what the header, status and hand leave.
    <div className="mx-auto flex h-dvh max-w-5xl flex-col gap-2 overflow-hidden p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:gap-3 sm:p-3">
      <div className="flex flex-none items-center justify-between gap-2 text-sm">
        <RoomCodeChip code={room.code} />
        <span className="flex items-center gap-2">
          <SoundToggle />
          {room.spectators > 0 && (
            <span
              className="rounded-full bg-white/10 px-2.5 py-1.5 font-semibold text-slate-100 ring-1 ring-white/15"
              title={`${room.spectators} watching`}
              aria-label={`${room.spectators} watching`}
            >
              👀 <span className="tabular-nums">{room.spectators}</span>
            </span>
          )}
          {room.matchEndsAt && !finished && <MatchClock endsAt={room.matchEndsAt} />}
          <span className="rounded-full bg-white/10 px-3 py-1.5 font-semibold text-slate-100 ring-1 ring-white/15">
            Turn <span className="tabular-nums">{game.turn}</span>
          </span>
          {!finished && me?.status === 'active' && !room.endVote && (
            <button
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 font-bold text-slate-100 ring-1 ring-white/15 transition hover:bg-white/20 active:scale-[0.97] sm:px-3.5"
              onClick={() => setConfirmEnd(true)}
              aria-label="End game"
              title="End game"
            >
              <span aria-hidden="true">🏁</span>
              <span className="hidden sm:inline">End game</span>
            </button>
          )}
          {!finished && (
            <button
              className="flex items-center gap-1.5 rounded-full bg-red-600/15 px-2.5 py-1.5 font-bold text-red-300 ring-1 ring-red-500/60 transition hover:bg-red-600 hover:text-white active:scale-[0.97] sm:px-3.5"
              onClick={me ? () => setConfirmLeave(true) : stopWatching}
              aria-label={me ? 'Leave game' : 'Stop watching'}
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 14l4-4-4-4M16 10H8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="hidden sm:inline">{me ? 'Leave game' : 'Stop watching'}</span>
            </button>
          )}
        </span>
      </div>

      <PokerTable
        game={game}
        opponents={opponents}
        me={me}
        onCatch={(id) => send('game:catchUno', { targetId: id })}
        canCatch={me?.status === 'active'}
        canDraw={canDraw}
        onDraw={draw}
        deadline={finished ? null : deadline}
        onSeatTap={onSeatTap}
      />

      <StatusLine game={game} myTurn={myTurn} current={current} isMe={(id) => id === playerId} />

      {log.length > 0 && (
        <p className="flex-none truncate text-center text-xs font-semibold text-slate-200 sm:hidden [@media(max-height:820px)]:block">
          {log.at(-1)}
        </p>
      )}
      {log.length > 0 && (
        <ul
          className="mx-auto hidden w-full max-w-md flex-none space-y-1 rounded-2xl bg-white/5 px-4 py-2.5 text-center text-sm ring-1 ring-white/10 sm:block [@media(max-height:820px)]:hidden"
          aria-live="polite"
        >
          {log.slice(-3).map((line, i, shown) => (
            <li
              key={`${log.length}-${i}`}
              className={i === shown.length - 1 ? 'font-semibold text-white' : 'text-slate-300'}
            >
              {line}
            </li>
          ))}
        </ul>
      )}

      <div className="flex-none">
        {me && me.status === 'active' ? (
          <MyHand
            game={game}
            me={me}
            legal={legal}
            myTurn={myTurn}
            onPlay={play}
            onDraw={draw}
            onUno={() => send('game:callUno')}
          />
        ) : (
          <div className="flex items-center justify-center gap-3 px-2 py-4 text-center text-sm text-slate-400 sm:py-6 sm:text-base">
            <p>
              {me?.status === 'eliminated'
                ? "You're out — no mercy. Watch the carnage."
                : "👀 You're watching. Everyone's cards stay hidden."}
            </p>
            {me && <ReactionPicker />}
            {me && <ChatButton />}
          </div>
        )}
      </div>

      {showPicker && phase.kind === 'chooseColor' && (
        <ColorSheet title="Choose a colour" onPick={(color) => answer('game:chooseColor', { color })} />
      )}
      {showPicker && phase.kind === 'rouletteNameColor' && (
        <ColorSheet
          title="Colour Roulette! Name a colour"
          subtitle="You flip cards until that colour shows up and keep them all. Your colour then becomes the colour in play."
          onPick={(color) => answer('game:rouletteColor', { color })}
        />
      )}
      {showPicker && phase.kind === 'chooseSwapTarget' && (
        <SwapSheet
          players={game.players.filter((p) => p.status === 'active' && p.id !== playerId)}
          onPick={(id) => answer('game:chooseSwap', { targetId: id })}
        />
      )}
      {throwTarget && !finished && (
        <ThrowMenu
          target={throwTarget}
          onCatch={
            throwTargetPlayer && canCatchSeat(throwTargetPlayer)
              ? () => send('game:catchUno', { targetId: throwTarget.id })
              : undefined
          }
          onClose={() => setThrowTarget(null)}
        />
      )}
      {finished && <Results game={game} isHost={room.hostId === playerId} />}
      {room.endVote && !finished && <VoteBanner vote={room.endVote} game={game} />}
      {confirmEnd && !finished && !room.endVote && (
        <EndSheet
          voters={game.players.filter((p) => p.status === 'active').length}
          onPick={(outcome) => {
            setConfirmEnd(false);
            void send('game:endVote', { outcome });
          }}
          onCancel={() => setConfirmEnd(false)}
        />
      )}
      {confirmLeave && !finished && (
        <LeaveSheet forfeits={me?.status === 'active'} onCancel={() => setConfirmLeave(false)} />
      )}
      <TableFx />
      <ChatPanel />
    </div>
  );
}

/** A smiley toggle that opens a small emoji panel above it. */
/** Match countdown chip; turns red and pulses for the last minute. */
function MatchClock({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(Date.now);
  const warned = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const urgent = left <= 60;
  useEffect(() => {
    if (urgent && left > 0 && !warned.current) {
      warned.current = true;
      useGame.getState().showToast('⏱ 1 minute left!');
    }
  }, [urgent, left]);
  return (
    <span
      className={`rounded-full px-3 py-1.5 font-semibold tabular-nums ring-1 ${
        urgent ? 'animate-pulse bg-red-600/25 text-red-200 ring-red-500/70' : 'bg-white/10 text-slate-100 ring-white/15'
      }`}
      aria-label={`${Math.floor(left / 60)} minutes ${left % 60} seconds left in the match`}
    >
      ⏱ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </span>
  );
}

function ReactionPicker() {
  const react = useGame((s) => s.react);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close on a click outside the picker or on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('pointerdown', onDown);
      removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative" data-anchor="reactions">
      <button
        className={`flex h-7 w-7 items-center justify-center rounded-full text-base transition ${
          open ? 'bg-white/25 ring-1 ring-white/40' : 'bg-white/10 hover:bg-white/20'
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'Close reactions' : 'Send a reaction'}
        title="Reactions"
      >
        {open ? '✕' : '😊'}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Send a reaction"
          className="absolute right-0 bottom-full z-20 mb-2 grid w-max grid-cols-4 gap-1 rounded-2xl bg-slate-800 p-2 shadow-2xl ring-1 ring-white/15"
        >
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition hover:scale-125 hover:bg-white/10 active:scale-95"
              onClick={() => react(emoji)}
              aria-label={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SoundToggle() {
  const [on, setOn] = useState(soundEnabled);
  return (
    <button
      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-base ring-1 ring-white/15 transition hover:bg-white/15"
      onClick={() => {
        setSoundEnabled(!on);
        setOn(!on);
      }}
      aria-pressed={on}
      aria-label={on ? 'Mute sound' : 'Unmute sound'}
      title={on ? 'Sound on' : 'Sound off'}
    >
      {on ? '🔊' : '🔇'}
    </button>
  );
}

function RoomCodeChip({ code }: { code: string }) {
  const showToast = useGame((s) => s.showToast);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/r/${code}`);
      showToast('Invite link copied');
    } catch {
      showToast(`Room code: ${code}`);
    }
  }
  return (
    <button
      className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15 transition hover:bg-white/15"
      onClick={copy}
      title="Copy invite link"
    >
      <span className="hidden text-slate-400 sm:inline">Room</span>
      <span className="font-mono font-bold tracking-widest text-slate-100">{code}</span>
      <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="7" y="7" width="9" height="9" rx="2" />
        <path d="M13 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
      </svg>
    </button>
  );
}

function EndSheet({
  voters,
  onPick,
  onCancel,
}: {
  voters: number;
  onPick: (outcome: EndOutcome) => void;
  onCancel: () => void;
}) {
  const needed = Math.floor(voters / 2) + 1;
  return (
    <Sheet
      title="End this game?"
      subtitle={`This starts a vote: ${needed} of the ${voters} players still in need to agree within 30 seconds. Your vote counts as yes.`}
    >
      <div className="flex flex-col gap-2">
        <button className="btn-primary text-left" onClick={() => onPick('finish')}>
          🏁 Finish now
          <span className="block text-xs font-normal opacity-90">Fewest cards wins, then fewest card points</span>
        </button>
        <button className="btn-secondary text-left" onClick={() => onPick('cancel')}>
          ✖ Cancel game
          <span className="block text-xs font-normal text-slate-400">No winner, everyone goes back to the lobby</span>
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          Keep playing
        </button>
      </div>
    </Sheet>
  );
}

/** A running vote to end the game: who asked, the tally, a countdown, and buttons for players who haven't voted. */
function VoteBanner({ vote, game }: { vote: EndVote; game: PlayerView }) {
  const { playerId, send } = useGame();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const name = (id: string) => (id === playerId ? 'You' : (game.players.find((p) => p.id === id)?.name ?? 'Someone'));
  const left = Math.max(0, Math.ceil((vote.expiresAt - now) / 1000));
  const needed = Math.floor(vote.voterIds.length / 2) + 1;
  const canVote =
    !!playerId && vote.voterIds.includes(playerId) && !vote.yesIds.includes(playerId) && !vote.noIds.includes(playerId);
  const mine = playerId && vote.yesIds.includes(playerId) ? '✅' : playerId && vote.noIds.includes(playerId) ? '❌' : null;

  return (
    <div className="fixed inset-x-0 top-14 z-30 flex justify-center px-3">
      <div
        role="status"
        className="w-full max-w-sm rounded-2xl bg-slate-900/95 p-3 text-sm shadow-2xl ring-1 ring-amber-300/60"
      >
        <p className="font-bold">
          {vote.outcome === 'finish' ? '🏁' : '✖'} {name(vote.byId)} {vote.byId === playerId ? 'want' : 'wants'} to{' '}
          {vote.outcome === 'finish' ? 'end the game' : 'cancel the game'}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          {vote.outcome === 'finish' ? 'Fewest cards wins.' : 'No winner, back to the lobby.'} {vote.yesIds.length}/{needed}{' '}
          needed · <span className="tabular-nums">{left}s</span>
        </p>
        {canVote ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="rounded-xl bg-emerald-600 py-1.5 font-bold text-white hover:bg-emerald-500" onClick={() => send('game:vote', { agree: true })}>
              ✅ Agree
            </button>
            <button className="rounded-xl bg-white/10 py-1.5 font-bold hover:bg-white/20" onClick={() => send('game:vote', { agree: false })}>
              ❌ Keep playing
            </button>
          </div>
        ) : (
          mine && <p className="mt-1 text-xs text-slate-300">You voted {mine}</p>
        )}
      </div>
    </div>
  );
}

function LeaveSheet({ forfeits, onCancel }: { forfeits: boolean; onCancel: () => void }) {
  const leave = useGame((s) => s.leave);
  return (
    <Sheet
      title="Leave the game?"
      subtitle={forfeits ? 'You forfeit this round and your cards go back into the deck.' : 'You give up your seat in this room.'}
    >
      <div className="flex flex-col gap-2">
        <button
          className="btn-danger"
          onClick={async () => {
            await leave();
            navigate('/');
          }}
        >
          Leave game
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          Keep playing
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Poker-style oval table: a padded rail around green felt, opponents seated
 * around the top of the oval in play order (clockwise from your left), a fan of
 * face-down cards in front of each, the piles in the middle and you at the bottom.
 */
function PokerTable({
  game,
  opponents,
  me,
  onCatch,
  canCatch,
  canDraw,
  onDraw,
  deadline,
  onSeatTap,
}: {
  game: PlayerView;
  opponents: PublicPlayer[];
  me: PublicPlayer | undefined;
  onCatch: (id: string) => void;
  canCatch: boolean;
  canDraw: boolean;
  onDraw: () => void;
  deadline: number | null;
  /** Tapping an opponent's avatar opens the throw menu. */
  onSeatTap?: (target: ThrowTarget) => void;
}) {
  const room = useGame((s) => s.room);
  const connected = new Map(room?.players.map((p) => [p.id, p.connected]) ?? []);
  const wide = useWide();

  // Measure the space the table gets and fit the oval into it.
  const box = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSpace({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  let ovalW = 0;
  let ovalH = 0;
  if (space) {
    if (wide) {
      // A wide oval, between 1.6:1 and 2.2:1.
      ovalW = Math.min(space.w, space.h * 2.2);
      ovalH = Math.min(space.h, ovalW / 1.6);
    } else {
      // Full width on phones, as tall as fits (up to about 3:5).
      ovalW = space.w;
      ovalH = Math.min(space.h, space.w / 0.62);
    }
  }

  // Short tables, and busy phone tables, use compact seats (and on phones more of the rail).
  const compact = ovalH > 0 && (ovalH < 300 || (!wide && opponents.length > 5));
  const angles = seatAngles(opponents.length, ovalH ? ovalW / ovalH : 2, compact && !wide ? 58 : 35);
  const fanSize = opponents.length > 6 ? 3 : 5;
  const onRail = (i: number, rx: number, ry: number) => ({
    left: `${50 + rx * Math.cos(angles[i] ?? 0)}%`,
    top: `${50 - ry * Math.sin(angles[i] ?? 0)}%`,
  });

  return (
    // Padding leaves room for seats that hang over the rail.
    <div className="min-h-0 flex-1 px-10 pt-10 pb-5 sm:px-16 sm:pt-12 sm:pb-6">
      <div ref={box} className="relative h-full w-full">
        {space && ovalH > 0 && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: ovalW, height: ovalH }}
          >
            {/* Rail */}
            <div className="absolute inset-0 rounded-[50%] bg-gradient-to-b from-zinc-600 via-zinc-800 to-zinc-950 shadow-[0_24px_60px_rgba(0,0,0,0.65)] ring-1 ring-white/10" />
            {/* Felt */}
            <div className="absolute inset-[12px] rounded-[50%] bg-[radial-gradient(ellipse_at_center,#24a055_0%,#177a40_55%,#0d4f29_100%)] shadow-[inset_0_0_60px_rgba(0,0,0,0.55)] sm:inset-[18px]" />
            {/* Inner line */}
            <div className="absolute inset-[11%] rounded-[50%] border-2 border-white/10" />

            {/* Face-down fans in front of each opponent (hidden on phones and small tables to keep the centre clear) */}
            {opponents.map((p, i) =>
              !compact && p.status === 'active' && p.cardCount > 0 ? (
                <div
                  key={`fan-${p.id}`}
                  className="absolute hidden -translate-x-1/2 -translate-y-1/2 sm:flex"
                  style={onRail(i, 36, 33)}
                  aria-hidden="true"
                >
                  {Array.from({ length: Math.min(p.cardCount, fanSize) }, (_, j) => (
                    <div
                      key={j}
                      className="-ml-3 first:ml-0"
                      style={{ transform: `rotate(${(j - (Math.min(p.cardCount, fanSize) - 1) / 2) * 12}deg)` }}
                    >
                      <CardBack size="xs" />
                    </div>
                  ))}
                </div>
              ) : null,
            )}

            {/* Centre piles */}
            <div className="absolute inset-0 flex items-center justify-center">
              <TableCenter game={game} canDraw={canDraw} onDraw={onDraw} deadline={deadline} />
            </div>

            {/* Opponent seats on the rail */}
            {opponents.map((p, i) => (
              <div key={p.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={onRail(i, wide ? 50 : 53, 49)}>
                <Seat
                  player={p}
                  isTurn={p.id === game.currentPlayerId && p.status === 'active'}
                  online={connected.get(p.id) ?? false}
                  catchable={canCatch && p.status === 'active' && p.cardCount === 1 && !p.calledUno}
                  onCatch={() => onCatch(p.id)}
                  onTap={onSeatTap && ((rect) => onSeatTap({ id: p.id, name: p.name, rect }))}
                  compact={compact}
                />
              </div>
            ))}

            {/* You, at the bottom of the rail */}
            {me && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2">
                <div
                  data-anchor={`seat:${me.id}`}
                  className="flex items-center gap-2 rounded-full bg-zinc-900/95 py-1 pr-3 pl-1 whitespace-nowrap shadow-lg ring-1 ring-white/15">
                  <Avatar
                    name={me.name}
                    size="sm"
                    active={me.id === game.currentPlayerId && me.status === 'active'}
                    dimmed={me.status === 'eliminated'}
                  />
                  <span className="text-sm font-bold">You</span>
                  <span className="text-xs text-slate-400">{me.cardCount} cards</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** True on screens at least 640px wide (Tailwind's `sm`). */
function useWide(): boolean {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/**
 * Angles (radians) for k seats spaced evenly by distance along the rail, from
 * bottom-left over the top to bottom-right, leaving the bottom for you.
 * Even spacing by angle would bunch seats on the steep ends of the oval.
 */
function seatAngles(k: number, aspect: number, belowSides: number): number[] {
  // The arc runs from `belowSides` degrees under the left end, over the top, to the same under the right.
  const start = ((180 + belowSides) * Math.PI) / 180;
  const end = (-belowSides * Math.PI) / 180;
  const steps = 360;
  const ts: number[] = [];
  const lengths: number[] = [0];
  for (let j = 0; j <= steps; j++) ts.push(start + ((end - start) * j) / steps);
  for (let j = 1; j <= steps; j++) {
    const a = ts[j - 1] as number;
    const b = ts[j] as number;
    const dx = aspect * (Math.cos(b) - Math.cos(a));
    const dy = Math.sin(b) - Math.sin(a);
    lengths.push((lengths[j - 1] as number) + Math.hypot(dx, dy));
  }
  const total = lengths.at(-1) as number;
  return Array.from({ length: k }, (_, i) => {
    const target = (total * (i + 1)) / (k + 1);
    const j = lengths.findIndex((l) => l >= target);
    return ts.at(Math.max(j, 0)) as number;
  });
}

function Seat({
  player: p,
  isTurn,
  online,
  catchable,
  onCatch,
  onTap,
  compact,
}: {
  player: PublicPlayer;
  isTurn: boolean;
  online: boolean;
  catchable: boolean;
  onCatch: () => void;
  onTap?: (rect: DOMRect) => void;
  /** Avatar with a count badge and a small name, for crowded phone tables. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        data-anchor={`seat:${p.id}`}
        className={`flex w-14 flex-col items-center ${p.status !== 'active' ? 'opacity-60' : ''}`}
      >
        <SeatTap name={p.name} onTap={onTap}>
          <Avatar name={p.name} size="sm" online={online} active={isTurn} dimmed={p.status === 'eliminated'} />
          <span
            className={`absolute -right-2 -bottom-1 rounded-full px-1 text-[0.6rem] font-black ring-2 ring-slate-900 ${
              p.status !== 'active'
                ? 'bg-red-600 text-white'
                : p.cardCount >= 20
                  ? 'bg-red-500 text-white'
                  : 'bg-white text-slate-900'
            }`}
          >
            {p.status === 'won' ? 'WON' : p.status === 'eliminated' ? 'OUT' : p.cardCount}
          </span>
        </SeatTap>
        <div
          className={`mt-1 max-w-full truncate rounded px-1 text-[0.65rem] font-bold ${
            isTurn ? 'bg-amber-300 text-slate-900' : 'bg-zinc-900/90'
          }`}
        >
          {p.name}
        </div>
        {p.status === 'active' && p.calledUno && p.cardCount <= 2 && (
          <div className="text-[0.6rem] font-black text-yellow-300">UNO!</div>
        )}
        {catchable && (
          <button className="mt-0.5 rounded bg-red-600 px-1 text-[0.6rem] font-bold" onClick={onCatch}>
            Catch!
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-anchor={`seat:${p.id}`}
      className={`flex w-20 flex-col items-center sm:w-24 ${p.status !== 'active' ? 'opacity-60' : ''}`}
    >
      <SeatTap name={p.name} onTap={onTap}>
        <Avatar name={p.name} size="md" online={online} active={isTurn} dimmed={p.status === 'eliminated'} />
      </SeatTap>
      <div
        className={`-mt-2 w-full rounded-lg px-2 pt-2.5 pb-1.5 text-center shadow-lg ring-1 ${
          isTurn ? 'bg-zinc-900 ring-amber-300' : 'bg-zinc-900/95 ring-white/15'
        }`}
      >
        <div className="truncate text-xs font-bold">{p.name}</div>
        {p.status === 'active' ? (
          <>
            <div className="flex items-center justify-center gap-1 text-[0.7rem] text-slate-300">
              <span>{p.cardCount} cards</span>
              {p.calledUno && p.cardCount <= 2 && <span className="font-black text-yellow-300">UNO!</span>}
            </div>
            <MercyBar count={p.cardCount} />
          </>
        ) : (
          <div className={`text-[0.7rem] font-black ${p.status === 'won' ? 'text-amber-300' : 'text-red-400'}`}>
            {p.status === 'won' ? 'WON' : 'OUT'}
          </div>
        )}
      </div>
      {catchable && (
        <button
          className="mt-1 w-full rounded-md bg-red-600 py-0.5 text-xs font-bold shadow-lg hover:bg-red-500"
          onClick={onCatch}
        >
          Catch! +2
        </button>
      )}
    </div>
  );
}

/** Wraps a seat's avatar: tapping it opens the throw menu, when throwing is allowed. */
function SeatTap({ name, onTap, children }: { name: string; onTap?: (rect: DOMRect) => void; children: React.ReactNode }) {
  if (!onTap) return <div className="relative">{children}</div>;
  return (
    <button
      className="relative rounded-full transition active:scale-90"
      onClick={(e) => onTap(seatRectOf(e.currentTarget))}
      aria-label={`Throw something at ${name}`}
      title={`Throw something at ${name}`}
    >
      {children}
    </button>
  );
}

function MercyBar({ count }: { count: number }) {
  const pct = Math.min(100, (count / MERCY_LIMIT) * 100);
  const color = count >= 20 ? 'bg-red-500' : count >= 13 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div
      className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={MERCY_LIMIT}
      aria-valuenow={count}
      aria-label="Cards toward the 25-card limit"
    >
      <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function TableCenter({
  game,
  canDraw,
  onDraw,
  deadline,
}: {
  game: PlayerView;
  canDraw: boolean;
  onDraw: () => void;
  deadline: number | null;
}) {
  const stack = game.phase.kind === 'respondToStack' ? game.phase.pending : 0;
  return (
    <div className="flex items-center justify-center gap-3 sm:gap-8">
      <button
        data-anchor="draw"
        className={`rounded-2xl transition ${canDraw ? 'hover:-translate-y-1' : 'cursor-default opacity-80'}`}
        onClick={canDraw ? onDraw : undefined}
        aria-label={`Draw pile, ${game.drawPileCount} cards`}
      >
        <CardBack size="table" />
        <span className="mt-1 block text-xs font-semibold text-emerald-100/80">{game.drawPileCount} left</span>
      </button>

      <div className="relative flex flex-col items-center">
        <div data-anchor="discard" className={`rounded-2xl p-1 ring-4 transition-shadow sm:rounded-3xl sm:p-1.5 ${COLOR_RING[game.activeColor]}`}>
          {/* Keyed by card so each newly played card lands with an animation. */}
          <div key={game.topCard.id} className={game.turn > 1 ? 'animate-land' : ''}>
            <Card card={game.topCard} size="table" wildColor={game.topCard.color ? undefined : game.activeColor} />
          </div>
        </div>
        {stack > 0 && (
          <span className="absolute -top-3 -right-4 animate-bounce rounded-full bg-red-600 px-2.5 py-1 text-sm font-black shadow-lg">
            +{stack}
          </span>
        )}
        <span className="mt-1 text-xs font-semibold text-emerald-100/80 capitalize">{game.activeColor}</span>
      </div>

      <div className="flex flex-col items-center gap-2 text-emerald-100/80">
        <span className="text-3xl" aria-label={game.direction === 1 ? 'Clockwise' : 'Counter-clockwise'}>
          {game.direction === 1 ? '↻' : '↺'}
        </span>
        <Timer deadline={deadline} />
      </div>
    </div>
  );
}

function Timer({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return <span className="h-10 w-10" />;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span
      className={`flex h-10 w-10 items-center justify-center rounded-full font-mono text-sm ring-2 ${
        left <= 5 ? 'text-red-400 ring-red-500' : 'ring-white/20'
      }`}
      aria-label={`${left} seconds left`}
    >
      {left}
    </span>
  );
}

function StatusLine({
  game,
  myTurn,
  current,
  isMe,
}: {
  game: PlayerView;
  myTurn: boolean;
  current: PublicPlayer;
  isMe: (id: string) => boolean;
}) {
  const phase = game.phase;
  let text: string;
  if (phase.kind === 'roundOver') text = '';
  else if (myTurn) {
    switch (phase.kind) {
      case 'awaitingPlay':
        text = game.legalCardIds.length ? 'Your turn — play a card or draw' : 'Your turn — no match, draw until you get one';
        break;
      case 'drawingUntilPlayable':
        text = 'Play the card you drew';
        break;
      case 'respondToStack':
        text = `Stack a ${game.activeColor} or wild +${phase.minValue} or higher, or take all ${phase.pending}`;
        break;
      default:
        text = 'Your move';
    }
  } else {
    const who = isMe(current.id) ? 'You' : current.name;
    text =
      phase.kind === 'respondToStack'
        ? `${who} faces +${phase.pending}…`
        : phase.kind === 'rouletteNameColor'
          ? `${who} is naming a colour for the roulette…`
          : `Waiting for ${who}…`;
  }
  return (
    <div className="flex min-h-8 flex-none justify-center sm:min-h-11">
      {text && (
        <p
          className={`rounded-full px-4 py-1.5 text-center text-sm font-bold ring-1 sm:px-5 sm:py-2 sm:text-lg ${
            myTurn ? 'bg-amber-400/15 text-amber-300 ring-amber-400/50' : 'bg-white/10 text-slate-100 ring-white/15'
          }`}
        >
          {text}
        </p>
      )}
    </div>
  );
}

function MyHand({
  game,
  me,
  legal,
  myTurn,
  onPlay,
  onDraw,
  onUno,
}: {
  game: PlayerView;
  me: PublicPlayer;
  legal: Set<string>;
  myTurn: boolean;
  onPlay: (id: string) => void;
  onDraw: () => void;
  onUno: () => void;
}) {
  const wide = useWide();
  const fanned = !wide && game.hand.length > 7;
  const phase = game.phase;
  const stacked = myTurn && phase.kind === 'respondToStack';
  const drawn = phase.kind === 'drawingUntilPlayable' ? phase.drawnCardId : undefined;
  const canUno = game.hand.length <= 2 && !me.calledUno;
  const hand = sortHand(game.hand);

  // Cards that weren't in the hand last render get a deal-in animation.
  const seen = useRef<Set<string> | null>(null);
  const previous = seen.current;
  const fresh = previous ? hand.filter((c) => !previous.has(c.id)).map((c) => c.id) : [];
  useEffect(() => {
    seen.current = new Set(game.hand.map((c) => c.id));
  });

  return (
    <div className="rounded-3xl bg-white/5 p-2 sm:p-3">
      <div className="mb-1 flex items-center gap-2 text-sm sm:mb-2">
        <Avatar name={me.name} size="sm" active={myTurn} />
        <span className="font-semibold">You · {game.hand.length} cards</span>
        <div className="flex-1">
          <MercyBar count={game.hand.length} />
        </div>
        <button
          className={`rounded-full px-3 py-1 text-xs font-black ${
            canUno ? 'bg-yellow-400 text-slate-900 hover:bg-yellow-300' : 'bg-white/10 text-slate-500'
          }`}
          disabled={!canUno}
          onClick={onUno}
        >
          UNO!
        </button>
        <ReactionPicker />
        <ChatButton />
      </div>

      <div data-anchor="hand" className="max-h-[30dvh] overflow-y-auto pt-3 pb-1 sm:max-h-[34dvh]">
        {/* Wrap onto more rows instead of scrolling; row gap leaves room for raised cards.
            Big hands on phones overlap like a fan so more fit per row. */}
        <div className={`flex flex-wrap justify-center gap-y-3 ${fanned ? 'pl-4' : 'gap-x-1.5'}`}>
          {hand.map((c) => {
            const dealIndex = fresh.indexOf(c.id);
            return (
              <span
                key={c.id}
                data-card-id={c.id}
                className={`${dealIndex >= 0 ? 'animate-deal' : ''} ${fanned ? '-ml-4' : ''}`}
                style={dealIndex >= 0 ? { animationDelay: `${200 + Math.min(dealIndex, 8) * 70}ms` } : undefined}
              >
                <Card
                  card={c}
                  playable={myTurn ? legal.has(c.id) : undefined}
                  onClick={myTurn && legal.has(c.id) ? () => onPlay(c.id) : undefined}
                  size={game.hand.length > 15 || (!wide && game.hand.length > 6) ? 'sm' : 'md'}
                />
              </span>
            );
          })}
        </div>
      </div>

      {myTurn && (phase.kind === 'awaitingPlay' || stacked) && (
        <button className={`mt-2 w-full py-2 sm:mt-3 sm:py-3 ${stacked ? 'btn-danger' : 'btn-secondary'}`} onClick={onDraw}>
          {stacked ? `Take +${phase.kind === 'respondToStack' ? phase.pending : 0}` : 'Draw'}
        </button>
      )}
      {drawn && myTurn && <p className="mt-2 text-center text-xs text-slate-400">The raised card is the one you drew.</p>}
    </div>
  );
}

function ColorSheet({ title, subtitle, onPick }: { title: string; subtitle?: string; onPick: (c: Color) => void }) {
  return (
    <Sheet title={title} subtitle={subtitle} peek>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-3">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`h-14 rounded-2xl text-base font-bold capitalize shadow-lg ring-2 ring-white/70 hover:scale-[1.03] sm:h-20 sm:text-lg ${COLOR_BG[c]}`}
            onClick={() => onPick(c)}
          >
            {c}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function SwapSheet({ players, onPick }: { players: PublicPlayer[]; onPick: (id: string) => void }) {
  return (
    <Sheet title="Swap hands with…" subtitle="You played a 7. Pick a player to trade your whole hand with." peek>
      <div className="flex flex-col gap-2">
        {players.map((p) => (
          <button key={p.id} className="btn-secondary flex items-center gap-3" onClick={() => onPick(p.id)}>
            <Avatar name={p.name} size="sm" />
            <span className="flex-1 text-left">{p.name}</span>
            <span className="text-slate-400">{p.cardCount} cards</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function Sheet({
  title,
  subtitle,
  peek,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Mid-turn choices: on phones, sit at the top with a light backdrop so your hand stays visible below. */
  peek?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`fixed inset-0 z-40 flex justify-center p-3 sm:items-center sm:bg-black/60 ${
        peek ? 'items-start bg-black/25 pt-[max(env(safe-area-inset-top),0.75rem)]' : 'items-end bg-black/60'
      }`}
    >
      <div
        role="dialog"
        aria-label={title}
        className={`w-full max-w-sm rounded-3xl bg-slate-900 shadow-2xl ring-1 ring-white/10 ${peek ? 'p-4 sm:p-5' : 'p-5'}`}
      >
        <h2 className={`font-bold ${peek ? 'text-base sm:text-lg' : 'text-lg'}`}>{title}</h2>
        {subtitle && <p className={`mt-1 text-slate-400 ${peek ? 'text-xs sm:text-sm' : 'text-sm'}`}>{subtitle}</p>}
        <div className={peek ? 'mt-3 sm:mt-4' : 'mt-4'}>{children}</div>
      </div>
    </div>
  );
}

function Results({ game, isHost }: { game: PlayerView; isHost: boolean }) {
  const { send, leave, playerId } = useGame();
  const seated = game.players.some((p) => p.id === playerId);
  const winnerId = game.phase.kind === 'roundOver' ? game.phase.winnerId : undefined;
  // Set when the match clock ran out: ranked by cards, then card points.
  const early = game.phase.kind === 'roundOver' ? game.phase.early : undefined;
  const points = early?.points;
  const winner = game.players.find((p) => p.id === winnerId);
  const name = (id: string) => (id === playerId ? 'You' : (game.players.find((p) => p.id === id)?.name ?? '?'));
  const others = game.players.filter((p) => p.id !== winnerId && !game.eliminationOrder.includes(p.id));
  const ranking = [
    ...(winner ? [winner.id] : []),
    ...others.sort((a, b) => a.cardCount - b.cardCount || (points?.[a.id] ?? 0) - (points?.[b.id] ?? 0)).map((p) => p.id),
    ...[...game.eliminationOrder].reverse(),
  ];

  return (
    <Sheet
      title={`${early ? (early.reason === 'time' ? "⏱ Time's up! " : '🏁 Ended by vote! ') : ''}${winner ? `${name(winner.id)} ${winner.id === playerId ? 'win' : 'wins'}!` : 'Round over'}`}
      subtitle={points ? 'Fewest cards wins; a tie goes to the fewest card points.' : undefined}
    >
      <ol className="space-y-1 text-sm">
        {ranking.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5">
            <span className="w-4 text-slate-400">{i + 1}</span>
            <Avatar name={game.players.find((p) => p.id === id)?.name ?? '?'} size="xs" />
            <span className="flex-1">{name(id)}</span>
            <span className="text-slate-400">
              {game.eliminationOrder.includes(id)
                ? 'eliminated'
                : points
                  ? `${game.players.find((p) => p.id === id)?.cardCount} cards · ${points[id] ?? 0} pts`
                  : i === 0
                    ? 'winner'
                    : `${game.players.find((p) => p.id === id)?.cardCount} cards`}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-col gap-2">
        {seated && (
          <button
            className="btn-primary"
            // The host takes the whole room back, reopening it to new players; others just go wait there.
            onClick={() => (isHost ? send('room:lobby') : useGame.getState().setLobbyView(true))}
          >
            Return to lobby
          </button>
        )}
        <button
          className="btn-secondary"
          onClick={async () => {
            // Spectators have no seat to give up; they just disconnect.
            if (seated) await leave();
            else useGame.getState().disconnect();
            navigate('/');
          }}
        >
          {seated ? 'Leave' : 'Stop watching'}
        </button>
      </div>
    </Sheet>
  );
}
