import type { GameEvent } from '@nomercy/engine';

/**
 * Timing for the table animations, shared by the animation layer (to play
 * effects in order) and the store (to hold back the next table state until an
 * elimination or win has been shown, instead of jumping ahead of the cards).
 */

export const FLIGHT_MS = 380;
export const REVEAL_MS = 950;
export const REVEAL_GAP_MS = 260;
export const MAX_REVEALS = 10;
export const DRAW_GAP_MS = 70;
export const MAX_FLIGHTS_PER_DRAW = 6;

/** Gap after the last card lands before an "OUT!" or "Winner!" moment. */
const AFTER_LANDING_MS = 150;

export interface Schedule {
  /** Start time (ms from the batch arriving) of each event's effects. */
  at: number[];
  /** When the batch's elimination or win is shown, if it has one. */
  climax: number | null;
}

export function revealedCards<T>(cards: T[]): T[] {
  return cards.length > MAX_REVEALS ? [...cards.slice(0, MAX_REVEALS - 1), cards.at(-1) as T] : cards;
}

export function scheduleEvents(events: GameEvent[]): Schedule {
  const at: number[] = [];
  let t = 0; // when the next event's effects start
  let landed = 0; // when every card so far has finished flying
  let climax: number | null = null;

  for (const e of events) {
    switch (e.type) {
      case 'played':
        at.push(t);
        landed = Math.max(landed, t + FLIGHT_MS);
        t += 120;
        break;
      case 'drew': {
        at.push(t);
        const shown = Math.min(e.count, MAX_FLIGHTS_PER_DRAW);
        if (shown > 0) {
          landed = Math.max(landed, t + (shown - 1) * DRAW_GAP_MS + FLIGHT_MS);
          t += shown * DRAW_GAP_MS;
        }
        break;
      }
      case 'rouletteFlip': {
        at.push(t);
        const shown = revealedCards(e.cards).length;
        if (shown > 0) {
          landed = Math.max(landed, t + (shown - 1) * REVEAL_GAP_MS + REVEAL_MS);
          t += shown * REVEAL_GAP_MS;
        }
        break;
      }
      case 'eliminated':
      case 'won': {
        // Wait until the cards that caused it have landed.
        const moment = Math.max(t, landed + AFTER_LANDING_MS);
        at.push(moment);
        climax = moment;
        t = moment;
        break;
      }
      default:
        at.push(t);
    }
  }
  return { at, climax };
}
