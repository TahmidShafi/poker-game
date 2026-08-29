# Multiplayer Card Games Arena — Texas Hold'em & Twenty-Nine (29)

A real-time, server-authoritative multiplayer card games platform built with **Next.js 15**, **Express**, **Socket.IO**, and **PostgreSQL**. Features private rooms for friends with support for two classic games: **No-Limit Texas Hold'em Poker** and **Twenty-Nine (29 / ২৯)** (with Single Player vs AI Bot mode).

> **Disclaimer:** Virtual chips and game points only — **no real-money gambling, no payments, no crypto, no public matchmaking.**

---

## System Architecture

```text
                     ┌──────────────────────────────────────────┐
                     │          Browser Clients (Web)           │
                     │  Next.js 15 (App Router) + React 18 UI   │
                     │         Tailwind CSS + Web Audio         │
                     │          (Deployed on Vercel)            │
                     └────────────────────┬─────────────────────┘
                                          │
                                          │ Socket.IO (WSS Protocol)
                                          │ Bidirectional Typed Events
                                          │
                     ┌────────────────────▼─────────────────────┐
                     │            Game Server (Node)            │
                     │    Express + Socket.IO on Render / VPS   │
                     │                                          │
                     │  • Pure Poker Engine (WSOP / TDA rules)  │
                     │  • Pure 29 Engine (Bidding v2 & Trumps)  │
                     │  • Casual AI Bot Brain for Twenty-Nine   │
                     │  • Room Registry & Authoritative Timers  │
                     │  • Zero-Trust Per-Seat State Serializer  │
                     └────────────────────┬─────────────────────┘
                                          │
                                          │ Prisma ORM 5
                                          │ (Connection Pooling)
                                          │
                     ┌────────────────────▼─────────────────────┐
                     │         PostgreSQL Database              │
                     │       (Render Postgres / Neon)           │
                     │                                          │
                     │  • Player Accounts & Game Sessions       │
                     │  • Hand History & Winner Summaries       │
                     │  • Player-to-Player Loan Ledger          │
                     │  • Leaderboard Statistics Rollups        │
                     └──────────────────────────────────────────┘
```

---

## Games & Features

### 1. No-Limit Texas Hold'em Poker
- **Table Capacity:** 2–10 players per table with automatic game start upon 2+ seated players. Mid-hand joiners wait for the next deal.
- **Strict No-Limit Rules:** Full Raise Rule, under-raise all-in protections, side pot partitioning, split pots, wheel straights (A-2-3-4-5), kicker comparisons, and odd-chip distribution.
- **Server Turn Timers:** Server-authoritative countdown timers with automatic *check-if-possible else fold* on expiration.
- **Pre-Action Dock:** Queue Check/Fold ahead of your active turn for smooth gameplay.
- **Player-to-Player Loans:** Built-in loan ledger with borrow limits, debt tracking, and in-game repayments.
- **Stats & Leaderboard:** Persistent hand records, lifetime statistics, and real-time leaderboards.
- **Security:** Zero-trust hole-card serialization (`serializeForSeat`) — opponents' cards are never broadcast to the browser before showdown.
- **Luxury Casino UI:** Felt textures, leather rail borders, chip physics, celebration animations, desktop oval table, and responsive mobile bottom-sheet views.

### 2. Twenty-Nine (29 / ২৯)
- **Classic 4-Player Partnership:** Teams of two ($A=\{0,2\}$ vs $B=\{1,3\}$) playing in an authentic anti-clockwise cycle ($0 \to 3 \to 2 \to 1 \to 0$).
- **Single Player vs AI Bots:** Jump into a game immediately against three heuristic AI bots running through the identical server-authoritative validation pipeline.
- **32-Card Point System:** 7 through Ace across 4 suits with authentic card ranks:
  $$\text{J (3 pts)} > \text{9 (2 pts)} > \text{A (1 pt)} > \text{10 (1 pt)} > \text{K (0)} > \text{Q (0)} > \text{8 (0)} > \text{7 (0)}$$
  Plus $1\text{ pt}$ for winning the final trick, ensuring strictly $\Sigma = 29\text{ points}$ every round.
- **Bidding v2 Mechanics:**
  - Bids range from 16 to 28.
  - Partner bids require strictly higher amounts.
  - Opponent bids can be matched once or raised.
  - Passing permanently exits the auction.
  - All-pass hands trigger a redeal with the same dealer.
- **4 Trump Selection Modes:**
  1. **Regular Suit:** Bidder secretly selects a trump suit.
  2. **7th Card:** The 3rd card of the bidder's second batch (7th card dealt) is chosen as trump (with automatic redeal on sole-suit dead cards).
  3. **Joker:** Power-rank trick-taking across suits without any trump suit.
  4. **Marriage (Royalty):** Declaring a $\text{K}+\text{Q}$ pair in the trump suit adjusts requirements by $\pm 4\text{ points}$ (bidding team: $\text{bid} - 4$; defending team: $\text{bid} + 4$).
- **Single Hand Challenge:** Bidder can choose to play solo against the two opponents while their partner sits out.
- **Traditional Bangladeshi ScoreCards:** Authentic playing-card face displays with 0–6 pips for round wins, inverted loss cards for opponent wins, and animated score pops.
- **Hidden Trump Reveal:** Trump remains concealed until a player void of the led suit calls for a reveal on their turn.
- **Offline Fallback Timers:** Disconnected players receive a grace-period timer before automatic safe moves (Pass / Lowest Legal Card) are played on their behalf.

---

## Repository & Monorepo Layout

```
poker-game/
├── apps/
│   ├── web/                     # Next.js 15 + React 18 + Tailwind CSS Frontend
│   │   ├── app/                 # Next.js App Router (pages, layout, globals.css)
│   │   ├── components/
│   │   │   ├── poker/           # Poker table oval, mobile table, action bar, loan modals
│   │   │   ├── twentynine/      # 29 table, card fan, trick area, bidding panel, score cards
│   │   │   ├── common/          # Shared components (PlayingCard, avatars, sound triggers)
│   │   │   └── join/            # Lobby, room creator, and game picker controls
│   │   └── lib/                 # Zustand / React state store, socket hooks, Web Audio
│   └── server/                  # Express + Socket.IO Authoritative Game Server
│       └── src/
│           ├── rooms/
│           │   ├── poker/       # Poker room manager, seat serialization, pot tracking
│           │   └── twentynine/  # 29 room manager, botBrain heuristics, trick lifecycle
│           ├── websocket/       # Socket.IO connection handlers & payload validators
│           └── persistence/     # Prisma database writers & queries
├── packages/
│   ├── poker-engine/            # Pure TypeScript Poker Rules (Deck, Evaluator, Pots, Showdown)
│   ├── twentynine-engine/       # Pure TypeScript 29 Rules (Bidding, Trumps, Tricks, Scoring)
│   └── shared-types/            # Shared TypeScript types & WebSocket protocol definitions
├── docs/                        # Specifications & Architecture Documentation
│   ├── poker-engine-specification.md
│   ├── poker-ui-ux-specification.md
│   └── twentynine-resume.md
├── prisma/                      # PostgreSQL schema & migration files
├── docker-compose.yml           # Local PostgreSQL service
└── render.yaml                  # Render deployment blueprint for the game server
```

---

## Local Development & Setup

### Prerequisites
- **Node.js**: v20.0.0 or higher
- **npm**: v10.0.0 or higher
- **PostgreSQL**: Local instance via Docker or a hosted connection string (Neon, Supabase, Render)

### 1. Clone & Install Dependencies
```bash
# Install dependencies across all workspaces
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` in the root directory:
```bash
cp .env.example .env
```
Default configuration values in `.env`:
```env
DATABASE_URL="postgresql://poker:poker@localhost:5432/poker"
PORT=4000
CLIENT_ORIGIN="http://localhost:3000"
FRONTEND_URL="http://localhost:3000"
NEXT_PUBLIC_SERVER_URL="http://localhost:4000"
INITIAL_COINS=1000
SMALL_BLIND=10
BIG_BLIND=20
TURN_TIME_SECONDS=20
EMPTY_ROOM_TTL_MS=300000
```

### 3. Start Local Database (Optional Docker)
If using local Docker PostgreSQL:
```bash
docker compose up -d
```

### 4. Run Migrations & Generate Prisma Client
```bash
npm run prisma:migrate
npm run prisma:generate
```

### 5. Start Development Servers
```bash
npm run dev
```
- **Web Client:** [http://localhost:3000](http://localhost:3000)
- **Game Server:** [http://localhost:4000](http://localhost:4000) (Health check: `/health`)

---

## Testing & Quality Assurance

The codebase includes a comprehensive test suite of **247 automated tests** spanning unit testing of pure engine rules, UI helper calculations, and full multi-client WebSocket integration suites.

```bash
# Run all test suites across all workspaces
npm test

# Run individual workspace test suites
npm run test -w packages/poker-engine       # 111 pure poker rule tests
npm run test -w packages/twentynine-engine   # 64 pure twenty-nine rule tests
npm run test -w apps/web                     # 28 web atom & helper tests
npm run test -w apps/server                  # 44 server socket integration tests
```

### Production Build & Typecheck
Verify strict TypeScript compilation and production bundles across the entire monorepo:
```bash
npm run build
```

---

## Deployment Guide

| Component | Target Platform | Build & Deployment Notes |
| :--- | :--- | :--- |
| **`apps/web`** | **Vercel** | Root directory: `apps/web`. Environment variable: `NEXT_PUBLIC_SERVER_URL=https://<your-render-server>.onrender.com` |
| **`apps/server`** | **Render / VPS** | Blueprint: `render.yaml`. Build command compiles shared packages and server. Start command: `node apps/server/dist/index.js`. |
| **PostgreSQL** | **Render / Neon / Supabase** | Execute `npx prisma migrate deploy` during deployment pipeline. |

### Production Runtime Characteristics
- **Authoritative In-Memory Rooms:** Live table states reside in active server memory for ultra-low latency. Completed hands, player stats, and loan transactions are persisted asynchronously to PostgreSQL.
- **Graceful Lifecycle Sweeper:** Idle rooms with no active connections are automatically cleaned up after 5 minutes (`EMPTY_ROOM_TTL_MS`).
- **Zero-Trust Information Barrier:** Sockets only receive data strictly intended for their seat. Opponents' hole cards and unrevealed trumps are kept solely in server memory.
- **Graceful Shutdown:** `SIGTERM` handlers broadcast table closure notices to connected clients before draining connections.

---

## Documentation & Technical Specs

For in-depth architectural deep-dives, consult the documentation in [`docs/`](file:///d:/poker-game-phase1/poker-game/docs):
- [Texas Hold'em Engine Specification](file:///d:/poker-game-phase1/poker-game/docs/poker-engine-specification.md): Mathematical invariants, pot-splitting algorithms, and tiebreaking.
- [Poker UI/UX Visual Architecture](file:///d:/poker-game-phase1/poker-game/docs/poker-ui-ux-specification.md): Felt coordinate math, responsive sheets, and animation pipelines.
- [Twenty-Nine Implementation Memory](file:///d:/poker-game-phase1/poker-game/docs/twentynine-resume.md): Bidding v2 state machine, trump mechanics, Bangladeshi scorecards, and AI bot integration.

---

## License

This project is private and intended for recreational use among friends. Virtual points only.
