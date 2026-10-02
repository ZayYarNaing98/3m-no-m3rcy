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

- Stacking accepts a draw card of equal or higher value (+2 ≤ +4 ≤ +6 ≤ +10) that could also be played normally: a wild draw card, a coloured one in the colour in play, or the same card as the top one (blue +4 on red +4).
- The first discard is always a number card.
- Colour Roulette: the player who plays it doesn't pick a colour. The next player names one, flips until it appears, keeps every flipped card, and loses their turn; the named colour becomes the colour in play.
- Draw takes one card per tap, even when holding a playable card. The turn stays with you: play any legal card or draw again (the 25-card Mercy limit still applies).
- Match time (optional, set by the host: 5–20 minutes): when the clock runs out the game ends; the player with the fewest cards wins, ties go to the fewest card points (numbers at face value, coloured actions 20, wilds 50), then the earlier seat. A pending stack is dropped.
- Ending early: any player still in can start a vote to either finish now (scored like the match clock) or cancel (no winner, back to the lobby). It passes when more than half of the players still in agree within 30 seconds; eliminated players and spectators don't vote.
- A timed-out player draws until playable but keeps the card; after 3 timeouts in a row their turns shrink to 3 seconds.
