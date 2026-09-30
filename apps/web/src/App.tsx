import { useEffect, useState } from 'react';
import { CardGallery } from './components/CardGallery';
import { Game } from './components/Game';
import { Home } from './components/Home';
import { JoinForm } from './components/JoinForm';
import { Lobby } from './components/Lobby';
import { TablePreview } from './components/TablePreview';
import { useGame } from './store';

const ROOM_PATH = /^\/r\/([A-Za-z0-9]{6})\/?$/;

function roomFromPath(): string | null {
  const m = location.pathname.match(ROOM_PATH);
  return m ? (m[1] as string).toUpperCase() : null;
}

export function navigate(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const [code, setCode] = useState(roomFromPath);
  useEffect(() => {
    const onPop = () => setCode(roomFromPath());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  if (import.meta.env.DEV && location.pathname === '/cards') return <CardGallery />;
  if (import.meta.env.DEV && location.pathname === '/table') return <TablePreview />;

  return (
    <>
      {code ? <RoomScreen code={code} /> : <Home />}
      <Toast />
    </>
  );
}

function RoomScreen({ code }: { code: string }) {
  const { conn, ready, playerId, room, game, closedReason, connect } = useGame();

  useEffect(() => {
    connect(code);
  }, [code, connect]);

  if (closedReason) {
    return (
      <Centered>
        <p className="text-lg">{closedReason}</p>
        <button className="btn-secondary mt-6" onClick={() => navigate('/')}>
          Back home
        </button>
      </Centered>
    );
  }
  if (!room || !ready) {
    return (
      <Centered>
        <p className="animate-pulse text-slate-400">{conn === 'connecting' ? 'Connecting…' : 'Loading room…'}</p>
      </Centered>
    );
  }
  if (!playerId) {
    if (room.status !== 'lobby') {
      return (
        <Centered>
          <p className="text-lg">This game has already started.</p>
          <button className="btn-secondary mt-6" onClick={() => navigate('/')}>
            Back home
          </button>
        </Centered>
      );
    }
    return <JoinForm room={room} />;
  }
  if (room.status === 'lobby' || !game) return <Lobby />;
  return <Game />;
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">{children}</div>;
}

function Toast() {
  const toast = useGame((s) => s.toast);
  const conn = useGame((s) => s.conn);
  const code = useGame((s) => s.code);
  const message = toast ?? (code && conn === 'connecting' ? 'Reconnecting…' : null);
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="rounded-full bg-slate-800/95 px-4 py-2 text-sm shadow-lg ring-1 ring-white/10">{message}</div>
    </div>
  );
}
