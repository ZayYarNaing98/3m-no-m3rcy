import type { Card as CardT } from '@nomercy/engine';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  playCardDraw,
  playCardPlay,
  playEliminated,
  playReaction,
  playRoundWon,
  playStackGrew,
  playUnoCall,
  playUnoCaught,
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
import { Card, CardBack } from './Card';

/**
 * Animation layer for the game table. It listens to server event batches and
 * flies cards between on-screen anchors marked with `data-anchor`:
 * "draw", "discard", "hand", and "seat:<playerId>" for each opponent.
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

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TableFx() {
  const fx = useGame((s) => s.fx);
  const playerId = useGame((s) => s.playerId);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [floats, setFloats] = useState<Float[]>([]);
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
          // Slap as the flying card lands on the pile.
          playCardPlay(t + FLIGHT_MS * 0.85);
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
