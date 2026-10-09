import type { Card as CardT, Throwable } from '@nomercy/engine';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  playCardDraw,
  playCardPlay,
  playEliminated,
  playReaction,
  playReverse,
  playRoundWon,
  playSkip,
  playStackGrew,
  playThrow,
  playUnoCall,
  playUnoCaught,
  playWild,
} from '../sound';
import {
  DRAW_GAP_MS,
  FLIGHT_MS,
  MAX_FLIGHTS_PER_DRAW,
  REVEAL_GAP_MS,
  REVEAL_MS,
  revealedCards,
  scheduleEvents,
} from '../fxTiming';
import { useGame } from '../store';
import { THROW_FLIGHT_MS, THROWABLE_INFO } from '../throwables';
import { Card, CardBack } from './Card';

/**
 * Animation layer for the game table. It listens to server event batches and
 * flies cards between on-screen anchors marked with `data-anchor`:
 * "draw", "discard", "hand", and "seat:<playerId>" for each opponent.
 * It also plays throwables between seats, in the game and in the lobby.
 */

interface Flight {
  id: number;
  from: DOMRect;
  to: DOMRect;
  card?: CardT;
  delay: number;
  /** Colour Roulette: the card rises face-up, pauses so everyone sees it, then goes to the player. */
  reveal?: boolean;
}

interface Float {
  id: number;
  at: DOMRect;
  text: string;
  tone: 'bad' | 'good' | 'info' | 'emoji' | 'chat';
  delay: number;
}

interface ThrowFx {
  id: number;
  /** Null when the thrower isn't on screen: the item just lands. */
  from: DOMRect | null;
  to: DOMRect;
  item: Throwable;
  targetId: string;
  /** The item hits you: the whole screen jolts. */
  atMe: boolean;
}

/** Size of a flying card: matches the md card (w-16, 2:3). */
const CARD_W = 64;
const CARD_H = 96;

let nextId = 1;

function anchorRect(name: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(name)}"]`);
  return el ? el.getBoundingClientRect() : null;
}

function cardRect(cardId: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`);
  return el ? el.getBoundingClientRect() : null;
}

/** A player's spot: your hand while you hold one, otherwise your seat on the table or in the lobby. */
function playerRect(id: string, me: string | null): DOMRect | null {
  return (id === me ? anchorRect('hand') : null) ?? anchorRect(`seat:${id}`);
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TableFx() {
  const fx = useGame((s) => s.fx);
  const playerId = useGame((s) => s.playerId);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [floats, setFloats] = useState<Float[]>([]);
  const [throws, setThrows] = useState<ThrowFx[]>([]);
  const thrown = useGame((s) => s.thrown);
  const lastThrown = useRef(thrown?.seq ?? 0);

  // Something thrown at a player flies from the thrower's seat to theirs.
  useEffect(() => {
    if (!thrown || thrown.seq === lastThrown.current) return;
    lastThrown.current = thrown.seq;
    const to = playerRect(thrown.targetId, playerId);
    if (!to) return;
    const from = reducedMotion() ? null : playerRect(thrown.fromId, playerId);
    playThrow(THROWABLE_INFO[thrown.item].impact, thrown.item, from ? THROW_FLIGHT_MS : 0);
    setThrows((t) => [
      ...t,
      { id: nextId++, from, to, item: thrown.item, targetId: thrown.targetId, atMe: thrown.targetId === playerId },
    ]);
  }, [thrown, playerId]);
  const lastSeq = useRef(fx.seq);
  const reaction = useGame((s) => s.reaction);
  const lastChat = useGame((s) => s.chat.at(-1));
  const lastChatId = useRef(lastChat?.id);

  // New chat messages pop up as a speech bubble over the sender.
  useEffect(() => {
    if (!lastChat || lastChat.id === lastChatId.current) return;
    lastChatId.current = lastChat.id;
    // History arriving after a refresh shouldn't replay as a bubble.
    if (Date.now() - lastChat.at > 5000) return;
    const at =
      (lastChat.playerId === playerId ? anchorRect('hand') : anchorRect(`seat:${lastChat.playerId}`)) ??
      anchorRect('reactions');
    if (!at) return;
    const text = lastChat.text.length > 60 ? `${lastChat.text.slice(0, 57)}…` : lastChat.text;
    setFloats((f) => [...f, { id: nextId++, at, text, tone: 'chat', delay: 0 }]);
  }, [lastChat, playerId]);
  const lastReaction = useRef(reaction?.seq ?? 0);

  // Emoji reactions float up over the sender (or the emoji bar for your own if you have no hand).
  useEffect(() => {
    if (!reaction || reaction.seq === lastReaction.current) return;
    lastReaction.current = reaction.seq;
    playReaction(reaction.emoji);
    const at =
      (reaction.playerId === playerId ? anchorRect('hand') : anchorRect(`seat:${reaction.playerId}`)) ??
      anchorRect('reactions');
    if (!at) return;
    // Nudge sideways a little so rapid reactions don't stack exactly on top of each other.
    const jitter = ((reaction.seq * 37) % 60) - 30;
    const shifted = new DOMRect(at.x + jitter, at.y, at.width, at.height);
    setFloats((f) => [...f, { id: nextId++, at: shifted, text: reaction.emoji, tone: 'emoji', delay: 0 }]);
  }, [reaction, playerId]);

  useEffect(() => {
    if (fx.seq === lastSeq.current) return;
    lastSeq.current = fx.seq;

    const seatOf = (id: string) => anchorRect(id === playerId ? 'hand' : `seat:${id}`);
    const newFlights: Flight[] = [];
    const newFloats: Float[] = [];
    // Shared with the store, which holds back the next table state until eliminations and wins are shown.
    const { at } = scheduleEvents(fx.events);

    fx.events.forEach((e, index) => {
      const t = at[index] ?? 0;
      const float = (rect: DOMRect | null, text: string, tone: Float['tone'], delay = t) => {
        if (rect) newFloats.push({ id: nextId++, at: rect, text, tone, delay });
      };

      switch (e.type) {
        case 'played': {
          const from = (e.playerId === playerId ? cardRect(e.card.id) : null) ?? seatOf(e.playerId);
          const to = anchorRect('discard');
          if (from && to) newFlights.push({ id: nextId++, from, to, card: e.card, delay: t });
          // Slap as the flying card lands on the pile, with a magic shimmer for wilds.
          playCardPlay(t + FLIGHT_MS * 0.85);
          if (e.card.color === null) playWild(t + FLIGHT_MS * 0.85 + 30);
          break;
        }
        case 'stackGrew':
          // Lands just after the draw card's slap.
          playStackGrew(e.total, t + FLIGHT_MS * 0.85 + 60);
          break;
        case 'rouletteFlip': {
          if (e.count <= 0) break;
          // Show the flipped cards face-up one by one. For long runs, show the first few and the match.
          const cards = revealedCards(e.cards);
          const from = anchorRect('draw');
          const to = seatOf(e.playerId);
          cards.forEach((card, i) => {
            playCardDraw(t + i * REVEAL_GAP_MS);
            if (from && to) newFlights.push({ id: nextId++, from, to, card, delay: t + i * REVEAL_GAP_MS, reveal: true });
          });
          float(to, `+${e.count}`, 'bad', t + cards.length * REVEAL_GAP_MS + 400);
          break;
        }
        case 'drew': {
          if (e.count <= 0) break;
          const shown = Math.min(e.count, MAX_FLIGHTS_PER_DRAW);
          const from = anchorRect('draw');
          const to = seatOf(e.playerId);
          for (let i = 0; i < shown; i++) {
            // One flick per card, timed to the card leaving the pile.
            playCardDraw(t + i * DRAW_GAP_MS);
            if (from && to) newFlights.push({ id: nextId++, from, to, delay: t + i * DRAW_GAP_MS });
          }
          float(to, `+${e.count}`, 'bad', t + 150);
          break;
        }
        case 'skipped':
          // Just after the card that caused it lands; Skip Everyone skips more than one player.
          // A two-player Reverse also skips: let the reverse sound go first.
          playSkip(
            e.playerIds.length > 1,
            t + FLIGHT_MS * 0.85 + 60 + (fx.events.some((x) => x.type === 'reversed') ? 380 : 0),
          );
          for (const id of e.playerIds) float(seatOf(id), 'Skipped', 'info');
          break;
        case 'handsSwapped':
          float(seatOf(e.a), 'Swap!', 'info');
          float(seatOf(e.b), 'Swap!', 'info');
          break;
        case 'handsRotated':
          float(anchorRect('discard'), 'Hands passed!', 'info');
          break;
        case 'reversed':
          playReverse(t + FLIGHT_MS * 0.85 + 60);
          float(anchorRect('discard'), 'Reverse!', 'info');
          break;
        case 'unoCalled':
          playUnoCall(t);
          float(seatOf(e.playerId), 'UNO!', 'good');
          break;
        case 'unoCaught':
          playUnoCaught(t);
          float(seatOf(e.playerId), 'Caught!', 'bad');
          break;
        case 'eliminated':
          // Scheduled after the cards that caused it have landed.
          playEliminated(t);
          float(seatOf(e.playerId), 'OUT!', 'bad');
          break;
        case 'timeUp':
          float(anchorRect('discard'), "Time's up!", 'bad');
          break;
        case 'endedByVote':
          float(anchorRect('discard'), 'Game over!', 'bad');
          break;
        case 'won':
          playRoundWon(t);
          float(seatOf(e.playerId), 'Winner!', 'good');
          break;
      }
    });

    // Sounds still play with reduced motion; only the movement is skipped.
    if (reducedMotion()) return;
    if (newFlights.length) setFlights((f) => [...f, ...newFlights]);
    if (newFloats.length) setFloats((f) => [...f, ...newFloats]);
  }, [fx, playerId]);

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" aria-hidden="true">
      {flights.map((f) => (
        <FlyingCard key={f.id} flight={f} onDone={() => setFlights((all) => all.filter((x) => x.id !== f.id))} />
      ))}
      {throws.map((t) => (
        <ThrownItem key={t.id} fx={t} onDone={() => setThrows((all) => all.filter((x) => x.id !== t.id))} />
      ))}
      {floats.map((f) => (
        <FloatingText key={f.id} float={f} onDone={() => setFloats((all) => all.filter((x) => x.id !== f.id))} />
      ))}
    </div>
  );
}

function FlyingCard({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { from, to, card, delay, reveal } = flight;

  // Each flight animates once, from the rects captured when it was created.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fromScale = Math.min(from.width / CARD_W, 1.2) || 0.6;
    const toScale = Math.min(to.width / CARD_W, 1.5);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    // Played cards land almost straight; drawn cards spin a little on the way.
    const spin = card ? -6 : dx > 0 ? 18 : -18;
    // Roulette reveal: lift out of the pile face-up, hold so it can be read, then fly to the player.
    const keyframes: Keyframe[] | null = reveal
      ? [
          { transform: 'translate(0, 0) scale(0.9)', opacity: 1 },
          { transform: 'translate(0, -70px) scale(1.25)', opacity: 1, offset: 0.3 },
          { transform: 'translate(0, -70px) scale(1.25)', opacity: 1, offset: 0.6 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.55) rotate(${dx > 0 ? 12 : -12}deg)`, opacity: 0.35 },
        ]
      : null;
    const anim = el.animate(keyframes ??
      [
        { transform: `translate(0, 0) scale(${card ? fromScale : 0.9}) rotate(0deg)`, opacity: 1 },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) scale(${card ? 1.15 : 0.95}) rotate(${spin / 2}deg)`,
          opacity: 1,
          offset: 0.5,
        },
        {
          transform: `translate(${dx}px, ${dy}px) scale(${card ? toScale : 0.55}) rotate(${spin}deg)`,
          opacity: card ? 1 : 0.2,
        },
      ],
      { duration: reveal ? REVEAL_MS : FLIGHT_MS, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
    );
    anim.finished.then(onDone, () => {});
    return () => anim.cancel();
  }, []);

  return (
    <div
      ref={ref}
      className="absolute"
      style={{
        left: from.left + from.width / 2 - CARD_W / 2,
        top: from.top + from.height / 2 - CARD_H / 2,
        width: CARD_W,
        opacity: 0,
      }}
    >
      {card ? <Card card={card} size="md" /> : <CardBack size="md" />}
    </div>
  );
}

const TONES: Record<Float['tone'], string> = {
  bad: 'bg-red-600 text-white',
  good: 'bg-yellow-400 text-slate-900',
  info: 'bg-slate-100 text-slate-900',
  emoji: 'bg-transparent text-5xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]',
  chat: 'max-w-56 truncate rounded-2xl rounded-bl-sm bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 shadow-xl',
};

function FloatingText({ float, onDone }: { float: Float; onDone: () => void }) {
  const { at, text, tone, delay } = float;
  return (
    <span
      className={`absolute whitespace-nowrap ${tone === 'chat' ? 'animate-bubble' : 'animate-float-up rounded-full'} ${
        tone === 'emoji' || tone === 'chat' ? '' : 'px-3 py-1 text-sm font-black shadow-xl'
      } ${TONES[tone]}`}
      style={{ left: at.left + at.width / 2, top: at.top + Math.min(at.height, 60) / 2, animationDelay: `${delay}ms` }}
      onAnimationEnd={onDone}
    >
      {text}
    </span>
  );
}

/** One sprite of an impact: what it shows and how it moves, relative to the target's centre. */
interface Sprite {
  text: string;
  size: number;
  keyframes: Keyframe[];
  duration: number;
}

/** A stink cloud drifting up and a fly buzzing round the target, for dirty things. */
function stinkSprites(): Sprite[] {
  return [
    {
      text: '💨',
      size: 40,
      duration: 1800,
      keyframes: [
        { transform: 'translate(0, 0) scale(0.5)', opacity: 0 },
        { transform: 'translate(-6px, -18px) scale(1.2)', opacity: 0.9, offset: 0.3 },
        { transform: 'translate(8px, -40px) scale(1.5)', opacity: 0.7, offset: 0.7 },
        { transform: 'translate(0, -60px) scale(1.7)', opacity: 0 },
      ],
    },
    {
      // Loops round the target's head a couple of times, then flies off.
      text: '🪰',
      size: 22,
      duration: 2000,
      keyframes: [
        { transform: 'translate(-24px, -10px)', opacity: 0 },
        { transform: 'translate(0, -30px)', opacity: 1, offset: 0.1 },
        { transform: 'translate(24px, -10px)', opacity: 1, offset: 0.25 },
        { transform: 'translate(0, 10px)', opacity: 1, offset: 0.4 },
        { transform: 'translate(-24px, -12px)', opacity: 1, offset: 0.55 },
        { transform: 'translate(0, -32px)', opacity: 1, offset: 0.7 },
        { transform: 'translate(22px, -12px)', opacity: 1, offset: 0.85 },
        { transform: 'translate(60px, -50px)', opacity: 0 },
      ],
    },
  ];
}

function impactSprites(item: Throwable, still: boolean): Sprite[] {
  const info = THROWABLE_INFO[item];
  // Reduced motion: just fade the result in and out where it lands.
  if (still) {
    const fade = [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }];
    return [{ text: info.splat ?? (info.impact === 'love' ? '❤️' : '💥'), size: 44, keyframes: fade, duration: 1400 }];
  }
  switch (info.impact) {
    case 'bonk':
      return [
        ...(info.stinky ? stinkSprites() : []),
        {
          text: '💥',
          size: 48,
          duration: 650,
          keyframes: [
            { transform: 'scale(0.3)', opacity: 1 },
            { transform: 'scale(1.4)', opacity: 1, offset: 0.35 },
            { transform: 'scale(1.1)', opacity: 0 },
          ],
        },
        {
          // The item bounces off and drops away.
          text: info.emoji,
          size: 34,
          duration: 700,
          keyframes: [
            { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
            { transform: 'translate(26px, -26px) rotate(140deg)', opacity: 1, offset: 0.35 },
            { transform: 'translate(46px, 50px) rotate(320deg)', opacity: 0 },
          ],
        },
      ];
    case 'splat':
      return [
        {
          text: info.splat ?? info.emoji,
          size: 46,
          duration: 1900,
          keyframes: [
            { transform: 'scale(0.4, 0.4)', opacity: 1 },
            { transform: 'scale(1.7, 0.75)', opacity: 1, offset: 0.12 },
            { transform: 'scale(1.5, 0.85)', opacity: 0.95, offset: 0.75 },
            { transform: 'translate(0, 14px) scale(1.5, 0.85)', opacity: 0 },
          ],
        },
      ];
    case 'boom':
      return [
        {
          text: '💥',
          size: 64,
          duration: 800,
          keyframes: [
            { transform: 'scale(0.2)', opacity: 1 },
            { transform: 'scale(2.1)', opacity: 1, offset: 0.4 },
            { transform: 'scale(2.4)', opacity: 0 },
          ],
        },
        {
          text: '💨',
          size: 40,
          duration: 1000,
          keyframes: [
            { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
            { transform: 'translate(0, -20px) scale(1.4)', opacity: 0.9, offset: 0.4 },
            { transform: 'translate(0, -50px) scale(1.8)', opacity: 0 },
          ],
        },
      ];
    case 'love':
      return [-26, 0, 26].map((dx, i) => ({
        text: '❤️',
        size: 26 + (i === 1 ? 8 : 0),
        duration: 1100 + i * 120,
        keyframes: [
          { transform: 'translate(0, 0) scale(0.3)', opacity: 0 },
          { transform: `translate(${dx * 0.5}px, -16px) scale(1.1)`, opacity: 1, offset: 0.3 },
          { transform: `translate(${dx}px, -64px) scale(0.9)`, opacity: 0 },
        ],
      }));
  }
}

/** A throwable flying in an arc between two seats, then its impact on the target. */
function ThrownItem({ fx, onDone }: { fx: ThrowFx; onDone: () => void }) {
  const flier = useRef<HTMLSpanElement>(null);
  const sprites = useRef<(HTMLSpanElement | null)[]>([]);
  const [landed, setLanded] = useState(!fx.from);
  const still = reducedMotion();
  const list = impactSprites(fx.item, still);
  const info = THROWABLE_INFO[fx.item];
  const cx = fx.to.left + fx.to.width / 2;
  const cy = fx.to.top + Math.min(fx.to.height, 80) / 2;

  // Flight: an arc that peaks above both seats, spinning end over end (a rose just drifts).
  useLayoutEffect(() => {
    const el = flier.current;
    const { from } = fx;
    if (!el || !from) return;
    const dx = cx - (from.left + from.width / 2);
    const dy = cy - (from.top + Math.min(from.height, 80) / 2);
    const lift = Math.min(160, 60 + Math.hypot(dx, dy) * 0.25);
    // A photo just tilts on the way, so the face stays readable.
    const spin = info.impact === 'love' ? 30 : info.image ? (dx >= 0 ? 20 : -20) : dx >= 0 ? 720 : -720;
    const anim = el.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg) scale(0.8)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) rotate(${spin / 2}deg) scale(1.25)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(1)` },
      ],
      { duration: THROW_FLIGHT_MS, easing: 'cubic-bezier(.35,.1,.45,1)', fill: 'both' },
    );
    anim.finished.then(() => setLanded(true), () => {});
    return () => anim.cancel();
  }, []);

  // Impact: the target's seat (or the whole screen, if it's you) shakes, and the hit plays out.
  useLayoutEffect(() => {
    if (!landed) return;
    if (!still && info.impact !== 'love') {
      const hard = info.impact === 'boom' ? 9 : 5;
      const shake = (el: Element | null, px: number) =>
        el?.animate(
          [0, -px, px, -px * 0.6, px * 0.6, 0].map((x) => ({ transform: `translateX(${x}px)` })),
          { duration: 380, easing: 'ease-out' },
        );
      if (fx.atMe) shake(document.getElementById('root'), hard * 0.6);
      else shake(document.querySelector(`[data-anchor="${CSS.escape(`seat:${fx.targetId}`)}"]`), hard);
    }
    const anims = list.map((s, i) => sprites.current[i]?.animate(s.keyframes, { duration: s.duration, fill: 'both' }));
    Promise.all(anims.map((a) => a?.finished)).then(onDone, () => {});
    return () => anims.forEach((a) => a?.cancel());
  }, [landed]);

  return (
    <>
      {fx.from && !landed && (
        <span
          ref={flier}
          className="absolute -translate-x-1/2 -translate-y-1/2 text-4xl leading-none drop-shadow-[0_6px_10px_rgba(0,0,0,0.55)]"
          style={{ left: fx.from.left + fx.from.width / 2, top: fx.from.top + Math.min(fx.from.height, 80) / 2 }}
        >
          {info.image ? (
            <img src={info.image} alt="" className="size-16 rounded-2xl object-cover ring-2 ring-white" draggable={false} />
          ) : (
            info.emoji
          )}
        </span>
      )}
      {landed &&
        list.map((s, i) => (
          <span
            key={i}
            className="absolute leading-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
            // Centre each sprite on the target; its keyframes move it from there.
            style={{ left: cx - s.size / 2, top: cy - s.size / 2, width: s.size, height: s.size, fontSize: s.size * 0.85, textAlign: 'center' }}
          >
            <span
              ref={(el) => {
                sprites.current[i] = el;
              }}
              className="inline-block"
              style={{ opacity: 0 }}
            >
              {s.text}
            </span>
          </span>
        ))}
    </>
  );
}
