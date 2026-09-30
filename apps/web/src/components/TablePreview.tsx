import { applyAction, createGame, legalCardIds, playerView } from '@nomercy/engine';
import { useGame } from '../store';
import { Game } from './Game';

/** Dev-only page at /table?n=6 that renders the game table with a fake game. */
export function TablePreview() {
  const params = new URLSearchParams(location.search);
  const n = Math.min(10, Math.max(2, Number(params.get('n')) || 6));
  const extra = Math.min(18, Math.max(0, Number(params.get('hand')) || 0));
  const viewer = params.get('spectate') ? null : 'p0';
  const names = ['You', 'Seint', 'zay', 'Mya', 'Ko Ko', 'Thu', 'Aung', 'Hnin', 'Min', 'Su'];
  if (!useGame.getState().game) {
    let state = createGame(
      names.slice(0, n).map((name, i) => ({ id: `p${i}`, name })),
      7,
    );
    // Play a few turns so hands differ in size.
    for (let i = 0; i < 12 && state.phase.kind !== 'roundOver'; i++) {
      const cur = state.players[state.currentIndex]!;
      const legal = legalCardIds(state, cur.id);
      const phase = state.phase.kind;
      const action =
        phase === 'chooseColor'
          ? ({ type: 'chooseColor', color: 'blue' } as const)
          : phase === 'rouletteNameColor'
            ? ({ type: 'rouletteColor', color: 'red' } as const)
            : phase === 'chooseSwapTarget'
              ? ({ type: 'chooseSwap', targetId: state.players.find((p) => p.id !== cur.id && p.status === 'active')!.id } as const)
              : legal.length && phase !== 'respondToStack'
                ? ({ type: 'play', cardId: legal[0]! } as const)
                : ({ type: 'draw' } as const);
      state = applyAction(state, cur.id, action).state;
    }
    // Optionally give "You" extra cards to check big hands.
    if (extra) state = { ...state, players: state.players.map((p, i) => (i === 0 ? { ...p, hand: [...p.hand, ...state.drawPile.slice(0, extra)] } : p)) };
    useGame.setState({
      playerId: viewer,
      game: playerView(state, viewer),
      deadline: Date.now() + 25_000,
      room: {
        code: 'PREV1E',
        hostId: 'p0',
        status: 'playing',
        settings: { turnSeconds: 30 },
        players: names.slice(0, n).map((name, i) => ({ id: `p${i}`, name, connected: i !== 3, afk: false })),
        spectators: Number(params.get('watching')) || 0,
      },
      log: ['Seint played red 4', 'zay drew 2', 'Mya played red Skip'],
    });
  }
  return <Game />;
}
