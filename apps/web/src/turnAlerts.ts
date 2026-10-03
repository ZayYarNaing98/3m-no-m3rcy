import type { PlayerView } from '@nomercy/engine';
import { useEffect, useRef } from 'react';
import { playTimeWarning, playYourTurn, soundEnabled } from './sound';

/** Seconds before the turn clock runs out that the warning plays. */
const WARN_BEFORE_MS = 5000;
const FLASH_TITLE = '🔴 Your turn!';

function vibrate(pattern: number[]): void {
  // Vibration follows the sound toggle, so muting keeps the phone fully quiet. iOS Safari has no vibration API.
  if (soundEnabled() && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

/**
 * Nudges the player when the game is waiting on them: a chime and a buzz when their turn starts,
 * a flashing tab title while the page is in the background, and a warning just before they time out.
 */
export function useTurnAlerts(game: PlayerView | null, playerId: string | null, deadline: number | null): void {
  const me = game?.players.find((p) => p.id === playerId);
  const myTurn =
    !!game && !!me && me.status === 'active' && game.currentPlayerId === playerId && game.phase.kind !== 'roundOver';
  const wasMyTurn = useRef(myTurn);

  // Turn start: only on the change from someone else's turn to yours, not on every step within your turn.
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) {
      playYourTurn();
      vibrate([70, 50, 70]);
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  // While it's your turn and the page is hidden, alternate the tab title until you come back.
  useEffect(() => {
    if (!myTurn) return;
    const original = document.title;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
      document.title = original;
    };
    const update = () => {
      if (!document.hidden) return stop();
      if (timer) return;
      let on = false;
      timer = setInterval(() => {
        on = !on;
        document.title = on ? FLASH_TITLE : original;
      }, 1000);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      stop();
    };
  }, [myTurn]);

  // A few seconds before the turn clock runs out, warn once.
  useEffect(() => {
    if (!myTurn || deadline === null) return;
    const wait = deadline - WARN_BEFORE_MS - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      playTimeWarning();
      vibrate([40, 60, 40]);
    }, wait);
    return () => clearTimeout(timer);
  }, [myTurn, deadline]);
}
