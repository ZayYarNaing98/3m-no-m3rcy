import { newRoomCode } from './matchmaker';

export { Matchmaker } from './matchmaker';
export { Room } from './room';

const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

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

    if (url.pathname === '/api/quickplay' && request.method === 'POST') {
      const code = await env.MATCHMAKER.getByName('global').quickPlay();
      if (code) return Response.json({ code });
      return Response.json({ error: 'Could not find or make a room' }, { status: 503 });
    }

    if (url.pathname === '/api/open-rooms' && request.method === 'GET') {
      return Response.json({ rooms: await env.MATCHMAKER.getByName('global').list() });
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
