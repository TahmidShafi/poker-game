# Hold'em Club — real-time multiplayer Texas Hold'em

A private-room, real-time No-Limit Texas Hold'em game for friends. Virtual chips
only — **no real-money gambling, no payments, no crypto, no tournaments.**

```text
browser (Next.js on Vercel)
   ↓  Socket.IO (WSS)
game server (Node + TypeScript on Render)  ← authoritative: deck, dealing,
   ↓                                          betting, pots, timers, payouts
PostgreSQL (Render / Neon)  ← users, game sessions, hand history, stats, loans
```

## Features

- Private rooms: create with a 6-character code, friends join by code
- 2–10 players per table, auto-start at 2+, mid-hand joiners wait one hand
- Full No-Limit Hold'em: blinds, min-raise rules, side pots, split pots,
  wheel (A-2-3-4-5), kickers, showdown with best-5-of-7 evaluation
- Server-authoritative turn timer (check-if-possible else fold on expiry)
- Pre-action: queue check/fold ahead of your turn
- Player-to-player loans with debt tracking, ceilings and repayments
- Hand history, player statistics and a leaderboard (PostgreSQL)
- Hidden-card security: opponents' cards never reach your browser
- Responsive premium UI (desktop → mobile bottom-sheet layouts)

## Repository layout

```
apps/web            Next.js 15 + React 18 + Tailwind (deploys to Vercel)
  components/poker      Hold'em table UI (desktop oval + mobile table, actions, sidebars)
  components/twentynine Twenty-Nine table UI (bidding, trump, tricks, score cards)
  components/common     Shared pieces (playing cards, avatars) used by both games
  components/join       Lobby: create / join screens for both game types
apps/server         Express + Socket.IO game server (deploys to Render)
  src/rooms/poker       Authoritative Hold'em room manager (+ per-seat serialization)
  src/rooms/twentynine  Twenty-Nine room manager + bot brain
packages/poker-engine     Pure TS poker rules (deck, evaluator, betting, pots,
                          table lifecycle, showdown) — no I/O, fully tested
packages/twentynine-engine Pure TS Twenty-Nine rules (bidding v2, hidden trump,
                           tricks, marriage) — no I/O, fully tested
packages/shared-types     Shared TS types incl. the socket event protocol
prisma/             Schema + migrations (PostgreSQL)
render.yaml         Render blueprint for the game server
docker-compose.yml  Local Postgres (optional)
```

## Local setup

Prereqs: Node 20+, and Postgres (Docker, or a free Neon/Supabase/Render URL).

```bash
# 1. install everything (npm workspaces)
npm install

# 2. configure environment
cp .env.example .env        # then edit DATABASE_URL etc.

# 3. start local Postgres (skip if using a hosted URL)
docker compose up -d

# 4. create schema + generate the client
npm run prisma:migrate      # dev migration (interactive)
npm run prisma:generate

# 5. run everything (server :4000, web :3000)
npm run dev
```

Open http://localhost:3000 — create a room, share the 6-char code, play.

### Tests

```bash
npm test        # engine unit tests + server socket-integration tests
npm run build   # typechecks + builds every workspace
```

The integration suite boots the real server on an ephemeral port and drives
it with socket.io-client: room lifecycle, actions, timers, reconnect,
hidden-card leaks, loans and chip-conservation invariants.

## Deployment

| Piece | Where | Notes |
|---|---|---|
| `apps/web` | **Vercel** | Root directory `apps/web`. Env: `NEXT_PUBLIC_SERVER_URL=https://<your-render-app>.onrender.com` |
| `apps/server` | **Render** | Blueprint in `render.yaml` (or manual web service). Build/start commands inside. Env: `CLIENT_ORIGIN=https://<your-app>.vercel.app`, `DATABASE_URL`, optional blind/coin/timer defaults |
| Postgres | **Render Postgres / Neon** | Paste the connection string into `DATABASE_URL` |

One-time on the database: `npx prisma migrate deploy` (Render shell or locally
against the production URL).

### Production behaviour

- Server binds `0.0.0.0:$PORT`, exposes `/health`, CORS restricted to
  `CLIENT_ORIGIN` (comma-separated list supported), WSS via Render's proxy.
- Graceful `SIGTERM` shutdown: closes all rooms, drains sockets, exits.
- **V1 caveat:** live tables live in this process's memory. A restart or
  deploy ends all active rooms (players are returned to the lobby; history,
  stats and loans already persisted survive). Do not run multiple instances.
- Idle rooms with no connected players are deleted after 5 minutes.

## Architecture notes

- The poker engine is a **pure, framework-free package** — no sockets, no DB —
  so every rule is unit-testable in isolation (111 tests incl. a randomized
  chip-conservation soak).
- The server is the **single authority**: it owns the deck, shuffling, deal,
  turn order, betting validation, timers, pots and payouts. The client only
  *requests* actions; every request is re-validated server-side and illegal
  ones get `ACTION_REJECTED`.
- `serializeForSeat()` is the only place hole-card visibility is decided.
  Before showdown every broadcast strips all seats' cards except the
  recipient's own — hidden data is never sent and "hidden with CSS".
- Live state stays in memory; only completed hands, stats and loan ledger
  rows hit PostgreSQL.

## V1 non-goals

Multiple tables per room · tournaments · matchmaking · spectator mode ·
real money · Redis / multi-instance state.
