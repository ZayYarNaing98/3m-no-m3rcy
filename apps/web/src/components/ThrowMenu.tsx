import { THROWABLES } from '@nomercy/engine';
import { useEffect, useRef } from 'react';
import { useGame } from '../store';
import { THROWABLE_INFO } from '../throwables';

export interface ThrowTarget {
  id: string;
  name: string;
  /** Where the tapped seat is on screen, to place the menu next to it. */
  rect: DOMRect;
}

const MENU_W = 232;
const MENU_H = 270;
const GAP = 8;

/** A small popover of things to throw at another player, opened by tapping their seat. */
export function ThrowMenu({ target, onCatch, onClose }: { target: ThrowTarget; onCatch?: () => void; onClose: () => void }) {
  const throwAt = useGame((s) => s.throwAt);
  const box = useRef<HTMLDivElement>(null);

  // Close on a tap outside the menu or on Escape.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('pointerdown', onDown);
      removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Below the seat when it fits, otherwise above; always inside the screen.
  const { rect } = target;
  const height = MENU_H + (onCatch ? 44 : 0);
  const below = rect.bottom + GAP + height <= innerHeight;
  const top = below ? rect.bottom + GAP : Math.max(GAP, rect.top - GAP - height);
  const left = Math.min(Math.max(GAP, rect.left + rect.width / 2 - MENU_W / 2), innerWidth - MENU_W - GAP);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Throw something at ${target.name}`}
      className="fixed z-40 rounded-2xl bg-raised-2 p-2 shadow-2xl ring-1 ring-line"
      style={{ top, left, width: MENU_W }}
    >
      {onCatch && (
        <button
          className="mb-2 w-full rounded-xl bg-red-600 py-2 text-sm font-black text-white shadow-lg hover:bg-red-500"
          onClick={() => {
            onCatch();
            onClose();
          }}
        >
          Catch UNO! +2
        </button>
      )}
      <p className="truncate px-1 pb-1.5 text-xs font-semibold text-muted">Throw at {target.name}</p>
      <div className="grid grid-cols-4 gap-1">
        {THROWABLES.map((item) => {
          const info = THROWABLE_INFO[item];
          return (
            <button
              key={item}
              className="flex flex-col items-center rounded-xl py-1.5 transition hover:bg-surface-2 active:scale-90"
              onClick={() => {
                void throwAt(target.id, item);
                onClose();
              }}
              aria-label={`Throw ${info.label.toLowerCase()}`}
            >
              <span className="text-2xl leading-none">{info.emoji}</span>
              <span className="mt-1 max-w-full truncate text-[0.6rem] text-fg/80">{info.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Reads the on-screen box of the seat a tap came from. */
export function seatRectOf(el: Element): DOMRect {
  return (el.closest('[data-anchor]') ?? el).getBoundingClientRect();
}
