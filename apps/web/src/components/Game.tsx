import { COLORS, MERCY_LIMIT, type Color, type PlayerView, type PublicPlayer } from '@nomercy/engine';
import { useEffect, useState } from 'react';
import { navigate } from '../App';
import { useGame } from '../store';
import { Card, CardBack, COLOR_BG, COLOR_RING } from './Card';

export function Game() {
  const { game, room, playerId, stateVersion, deadline, log, send } = useGame();
  const [confirmLeave, setConfirmLeave] = useState(false);
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

  // Seat order starting after me, so opponents read clockwise.
  const myIndex = game.players.findIndex((p) => p.id === playerId);
  const opponents = [...game.players.slice(myIndex + 1), ...game.players.slice(0, Math.max(myIndex, 0))];

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-3 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="font-mono">{room.code}</span>
        <span className="flex items-center gap-3">
          <span>Turn {game.turn}</span>
          {!finished && (
            <button
              className="rounded-full bg-white/10 px-3 py-1 font-semibold text-slate-200 hover:bg-white/15"
              onClick={() => setConfirmLeave(true)}
            >
              Leave
            </button>
          )}
        </span>
      </div>

      <Opponents
        players={opponents}
        game={game}
        onCatch={(id) => send('game:catchUno', { targetId: id })}
        canCatch={me?.status === 'active'}
      />

      <Table game={game} canDraw={canDraw} onDraw={draw} deadline={finished ? null : deadline} />

      <StatusLine game={game} myTurn={myTurn} current={current} isMe={(id) => id === playerId} />

      <ul className="mx-auto w-full max-w-md space-y-0.5 text-center text-xs text-slate-500" aria-live="polite">
        {log.slice(-3).map((line, i) => (
          <li key={`${log.length}-${i}`} className={i === Math.min(log.length, 3) - 1 ? 'text-slate-300' : ''}>
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-auto">
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
          <p className="py-6 text-center text-slate-400">
            {me?.status === 'eliminated' ? "You're out — no mercy. Watch the carnage." : 'Spectating'}
          </p>
        )}
      </div>

      {myTurn && phase.kind === 'chooseColor' && (
        <ColorSheet title="Choose a colour" onPick={(color) => send('game:chooseColor', { color })} />
      )}
      {myTurn && phase.kind === 'rouletteNameColor' && (
        <ColorSheet
          title="Colour Roulette! Name a colour"
          subtitle="You flip cards until that colour shows up, and keep them all."
          onPick={(color) => send('game:rouletteColor', { color })}
        />
      )}
      {myTurn && phase.kind === 'chooseSwapTarget' && (
        <SwapSheet
          players={game.players.filter((p) => p.status === 'active' && p.id !== playerId)}
          onPick={(id) => send('game:chooseSwap', { targetId: id })}
        />
      )}
      {finished && <Results game={game} isHost={room.hostId === playerId} />}
      {confirmLeave && !finished && (
        <LeaveSheet forfeits={me?.status === 'active'} onCancel={() => setConfirmLeave(false)} />
      )}
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

function Opponents({
  players,
  game,
  onCatch,
  canCatch,
}: {
  players: PublicPlayer[];
  game: PlayerView;
  onCatch: (id: string) => void;
  canCatch: boolean;
}) {
  const room = useGame((s) => s.room);
  const connected = new Map(room?.players.map((p) => [p.id, p.connected]) ?? []);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {players.map((p) => {
        const isTurn = p.id === game.currentPlayerId && p.status === 'active';
        const catchable = canCatch && p.status === 'active' && p.cardCount === 1 && !p.calledUno;
        return (
          <div
            key={p.id}
            className={`min-w-28 rounded-xl px-3 py-2 text-sm transition ${
              isTurn ? 'bg-white/15 ring-2 ring-amber-300' : 'bg-white/5'
            } ${p.status !== 'active' ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${connected.get(p.id) ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              <span className="flex-1 truncate font-semibold">{p.name}</span>
              {p.status === 'eliminated' && <span className="text-xs text-red-400">OUT</span>}
              {p.status === 'won' && <span className="text-xs text-amber-300">WON</span>}
            </div>
            {p.status === 'active' && (
              <>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-300">
                  <span>{p.cardCount} cards</span>
                  {p.calledUno && p.cardCount <= 2 && <span className="font-bold text-yellow-300">UNO!</span>}
                </div>
                <MercyBar count={p.cardCount} />
                {catchable && (
                  <button
                    className="mt-1.5 w-full rounded-md bg-red-600 py-0.5 text-xs font-bold hover:bg-red-500"
                    onClick={() => onCatch(p.id)}
                  >
                    Catch! +2
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
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

function Table({
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
    <div className="flex items-center justify-center gap-6 py-4 sm:gap-10">
      <button
        className={`rounded-2xl transition ${canDraw ? 'hover:-translate-y-1' : 'cursor-default opacity-80'}`}
        onClick={canDraw ? onDraw : undefined}
        aria-label={`Draw pile, ${game.drawPileCount} cards`}
      >
        <CardBack size="lg" />
        <span className="mt-1 block text-xs text-slate-400">{game.drawPileCount} left</span>
      </button>

      <div className="relative flex flex-col items-center">
        <div className={`rounded-3xl p-1.5 ring-4 ${COLOR_RING[game.activeColor]}`}>
          <Card card={game.topCard} size="lg" wildColor={game.topCard.color ? undefined : game.activeColor} />
        </div>
        {stack > 0 && (
          <span className="absolute -top-3 -right-4 animate-bounce rounded-full bg-red-600 px-2.5 py-1 text-sm font-black shadow-lg">
            +{stack}
          </span>
        )}
        <span className="mt-1 text-xs text-slate-400 capitalize">{game.activeColor}</span>
      </div>

      <div className="flex flex-col items-center gap-2 text-slate-400">
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
        text = `Stack a +${phase.minValue} or higher, or take all ${phase.pending}`;
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
    <p className={`min-h-6 text-center font-semibold ${myTurn ? 'text-amber-300' : 'text-slate-300'}`}>{text}</p>
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
  const phase = game.phase;
  const stacked = myTurn && phase.kind === 'respondToStack';
  const drawn = phase.kind === 'drawingUntilPlayable' ? phase.drawnCardId : undefined;
  const canUno = game.hand.length <= 2 && !me.calledUno;

  return (
    <div className="rounded-3xl bg-white/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
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
      </div>

      <div className="-mx-3 overflow-x-auto px-3 pt-3 pb-1">
        <div className="flex w-max gap-1.5">
          {game.hand.map((c) => (
            <Card
              key={c.id}
              card={c}
              playable={myTurn ? legal.has(c.id) : undefined}
              onClick={myTurn && legal.has(c.id) ? () => onPlay(c.id) : undefined}
              size={game.hand.length > 15 ? 'sm' : 'md'}
            />
          ))}
        </div>
      </div>

      {myTurn && (phase.kind === 'awaitingPlay' || stacked) && (
        <button className={`mt-3 w-full ${stacked ? 'btn-danger' : 'btn-secondary'}`} onClick={onDraw}>
          {stacked ? `Take +${phase.kind === 'respondToStack' ? phase.pending : 0}` : 'Draw'}
        </button>
      )}
      {drawn && myTurn && <p className="mt-2 text-center text-xs text-slate-400">The raised card is the one you drew.</p>}
    </div>
  );
}

function ColorSheet({ title, subtitle, onPick }: { title: string; subtitle?: string; onPick: (c: Color) => void }) {
  return (
    <Sheet title={title} subtitle={subtitle}>
      <div className="grid grid-cols-2 gap-3">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`h-20 rounded-2xl text-lg font-bold capitalize shadow-lg ring-2 ring-white/70 hover:scale-[1.03] ${COLOR_BG[c]}`}
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
    <Sheet title="Swap hands with…" subtitle="You played a 7. Pick a player to trade your whole hand with.">
      <div className="flex flex-col gap-2">
        {players.map((p) => (
          <button key={p.id} className="btn-secondary flex justify-between" onClick={() => onPick(p.id)}>
            <span>{p.name}</span>
            <span className="text-slate-400">{p.cardCount} cards</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function Sheet({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <div role="dialog" aria-label={title} className="w-full max-w-sm rounded-3xl bg-slate-900 p-5 shadow-2xl ring-1 ring-white/10">
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Results({ game, isHost }: { game: PlayerView; isHost: boolean }) {
  const { send, leave, playerId } = useGame();
  const winnerId = game.phase.kind === 'roundOver' ? game.phase.winnerId : undefined;
  const winner = game.players.find((p) => p.id === winnerId);
  const name = (id: string) => (id === playerId ? 'You' : (game.players.find((p) => p.id === id)?.name ?? '?'));
  const others = game.players.filter((p) => p.id !== winnerId && !game.eliminationOrder.includes(p.id));
  const ranking = [
    ...(winner ? [winner.id] : []),
    ...others.sort((a, b) => a.cardCount - b.cardCount).map((p) => p.id),
    ...[...game.eliminationOrder].reverse(),
  ];

  return (
    <Sheet title={winner ? `${name(winner.id)} ${winner.id === playerId ? 'win' : 'wins'}!` : 'Round over'}>
      <ol className="space-y-1 text-sm">
        {ranking.map((id, i) => (
          <li key={id} className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5">
            <span>
              {i + 1}. {name(id)}
            </span>
            <span className="text-slate-400">
              {game.eliminationOrder.includes(id) ? 'eliminated' : i === 0 ? 'winner' : `${game.players.find((p) => p.id === id)?.cardCount} cards`}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-col gap-2">
        {isHost ? (
          <button className="btn-primary" onClick={() => send('game:rematch')}>
            Rematch
          </button>
        ) : (
          <p className="text-center text-sm text-slate-400">Waiting for the host to start a rematch…</p>
        )}
        <button
          className="btn-secondary"
          onClick={async () => {
            await leave();
            navigate('/');
          }}
        >
          Leave
        </button>
      </div>
    </Sheet>
  );
}
