import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGame } from '../src/store';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: { requestId: string; type: string }[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

const latest = () => FakeSocket.instances.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'https:', host: 'example.test' });
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  useGame.getState().disconnect();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('room connection recovery', () => {
  it('settles requests when leaving, even if the old close event arrives later', async () => {
    useGame.getState().connect('ABCDEF');
    latest().open();
    const old = latest();
    old.close = () => { old.readyState = 3; };
    const request = useGame.getState().send('room:chat', { text: 'Hi' });
    useGame.getState().disconnect();
    await expect(request).resolves.toMatchObject({ ok: false, error: { code: 'closed' } });
    old.onclose?.({ code: 1000 });
    expect(useGame.getState().conn).toBe('idle');
  });

  it('ignores messages and open events from a previous room', () => {
    useGame.getState().connect('ABCDEF');
    const old = latest();
    useGame.getState().connect('UVWXYZ');
    old.open();
    old.message({ type: 'welcome', roomCode: 'ABCDEF', playerId: 'old', playerToken: 'token' });
    expect(useGame.getState().conn).toBe('connecting');
    expect(useGame.getState().playerId).toBeNull();
  });

  it('times out an unanswered move without automatically resending it', async () => {
    useGame.getState().connect('ABCDEF');
    latest().open();
    const request = useGame.getState().send('game:draw');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(request).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(latest().sent).toHaveLength(1);
  });

  it('clears the request timeout when an acknowledgement arrives', async () => {
    useGame.getState().connect('ABCDEF');
    latest().open();
    const request = useGame.getState().send('game:draw');
    latest().message({ type: 'ack', requestId: latest().sent[0]!.requestId, ok: true });
    await expect(request).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets the player reconnect immediately without leaving a scheduled retry', async () => {
    useGame.getState().connect('ABCDEF');
    latest().open();
    latest().close();
    useGame.getState().reconnect();
    expect(FakeSocket.instances).toHaveLength(2);
    latest().open();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(useGame.getState().ready).toBe(true);
  });

  it('preserves the saved seat if restoring it times out', async () => {
    localStorage.setItem('nomercy:seat:ABCDEF', JSON.stringify({ token: 'saved', name: 'Player' }));
    useGame.getState().connect('ABCDEF');
    latest().open();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(localStorage.getItem('nomercy:seat:ABCDEF')).toContain('saved');
    expect(useGame.getState().ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.instances).toHaveLength(2);
    latest().open();
    latest().message({ type: 'welcome', roomCode: 'ABCDEF', playerId: 'restored', playerToken: 'saved' });
    latest().message({ type: 'ack', requestId: latest().sent[0]!.requestId, ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(useGame.getState().playerId).toBe('restored');
    expect(useGame.getState().ready).toBe(true);
  });
});
