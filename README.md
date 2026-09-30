# UNO No Mercy

Real-time multiplayer UNO Show 'Em No Mercy for 2–10 players, running on Cloudflare's Free plan.

- `packages/engine` — pure rules engine (168-card deck, stacking, Mercy rule, 7-0, Colour Roulette), shared types and wire protocol.
- `apps/worker` — Cloudflare Worker: serves the client and routes each room code to its own `Room` Durable Object (WebSockets with hibernation, SQLite state, alarms for turn timers).
- `apps/web` — React + Vite + Tailwind client.

## Develop

```sh
npm install

# Terminal 1: API + Durable Objects on http://localhost:8787
npm run dev -w @nomercy/worker

# Terminal 2: client with hot reload on http://localhost:5173 (proxies /api to 8787)
npm run dev:web
```

`npm run dev` builds the client once and serves everything from the Worker on port 8787.

## Test

```sh
npm test          # engine unit tests + 1,000-game simulation, Durable Object tests
npm run typecheck
```

## Deploy

```sh
npx wrangler login   # once
npm run deploy       # builds the client, then wrangler deploy
```

The app is served at `https://em-no-mercy.<your-subdomain>.workers.dev`.

## Rule choices

- Stacking accepts any draw card of equal or higher value (+2 ≤ +4 ≤ +6 ≤ +10), regardless of colour.
- The first discard is always a number card.
- Colour Roulette: the player who plays it doesn't pick a colour. The next player names one, flips until it appears, keeps every flipped card, and loses their turn; the named colour becomes the colour in play.
- A timed-out player draws until playable but keeps the card; after 3 timeouts in a row their turns shrink to 3 seconds.
