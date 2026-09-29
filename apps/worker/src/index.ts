export { Room } from './room';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newRoomCode();
        if (await env.ROOMS.getByName(code).create(code)) return Response.json({ code });
      }
      return Response.json({ error: 'Could not allocate a room code' }, { status: 503 });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/ws)?$/);
    if (match) {
      const code = (match[1] ?? '').toUpperCase();
      if (!CODE_PATTERN.test(code)) return Response.json({ error: 'Invalid room code' }, { status: 400 });
      const stub = env.ROOMS.getByName(code);

      if (match[2]) {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
        return stub.fetch(request);
      }
      if (request.method === 'GET') return Response.json(await stub.info());
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
