import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io, Socket } from "socket.io-client";
import { AddressInfo } from "net";
import type {
  ClientToServerEvents,
  PublicTwentyNineState,
  RoomAck,
  ServerToClientEvents,
  TnCard,
  TnSuit,
} from "@poker/shared-types";
import { createPokerServer, PokerServer } from "../index";
import { TwentyNineGameManager } from "../rooms/twentynine/twentyNineManager";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const BASE_LIMITS = {
  minStartingCoins: 50,
  maxStartingCoins: 1_000_000,
  maxBigBlind: 10_000,
  minTurnSeconds: 5,
  maxTurnSeconds: 120,
  maxRooms: 200,
  emptyRoomTtlMs: 3_600_000,
  loanRequestTtlMs: 600,
  debtCeilingMultiple: 2,
  autoStartDelayMs: 250,
  disconnectGraceMs: 60_000,
  tnOfflineFallbackSeconds: 120,
  tnConnectedTurnSeconds: 25,
};

let ps: PokerServer;
let port: number;

beforeEach(async () => {
  ps = createPokerServer({ limits: { ...BASE_LIMITS } });
  await new Promise<void>((resolve) => {
    ps.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  port = (ps.httpServer.address() as AddressInfo).port;
});

afterEach(() => {
  ps.close();
});

function connect(): ClientSocket {
  return io(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false });
}

interface LogEntry {
  ev: string;
  at: number;
  data: unknown;
}

const WATCHED = [
  "TN_STATE",
  "YOUR_TN_HAND",
  "TN_BIDDER_PRIVATE",
  "TN_TRUMP_REVEALED",
  "TN_TRICK_RESOLVED",
  "TN_ROUND_FINISHED",
  "TN_MATCH_FINISHED",
  "ACTION_REJECTED",
  "PLAYER_REMOVED",
] as const;

/** Raw-payload recorder: the basis of the hidden-information audit. */
function recorder(socket: ClientSocket): LogEntry[] {
  const log: LogEntry[] = [];
  for (const ev of WATCHED) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on(ev, ((data: any) => log.push({ ev, at: Date.now(), data })) as never);
  }
  return log;
}

function latestState(log: LogEntry[]): PublicTwentyNineState {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.ev === "TN_STATE") return e.data as PublicTwentyNineState;
  }
  throw new Error("no TN_STATE yet");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function emitAck(
  socket: ClientSocket,
  event: "CREATE_ROOM" | "JOIN_ROOM" | "RECONNECT",
  payload: Record<string, unknown>
): Promise<RoomAck> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).emit(event, payload, (r: RoomAck) => resolve(r));
  });
}

interface Seat {
  seatIndex: number;
  socket: ClientSocket;
  log: LogEntry[];
  token: string;
  name: string;
  isBot?: boolean;
}

/**
 * Boots a 4-player TWENTY_NINE room (no settings — integrated mechanics) and
 * returns per-seat recorders indexed by actual seat assignment.
 */
async function makeTnRoom(vsBots = false): Promise<{ seats: Seat[]; code: string }> {
  const creator = connect();
  const creatorLog = recorder(creator);
  const ack = await emitAck(creator, "CREATE_ROOM", {
    username: "P0",
    startingCoins: 1000,
    gameType: "TWENTY_NINE",
    vsBots,
  });
  expect(ack.ok).toBe(true);
  expect(ack.gameType).toBe("TWENTY_NINE");
  const code = ack.roomCode!;

  const seats: Seat[] = [];
  seats[ack.seatIndex!] = { seatIndex: ack.seatIndex!, socket: creator, log: creatorLog, token: ack.sessionToken!, name: "P0" };

  if (!vsBots) {
    for (let i = 1; i < 4; i++) {
      const s = connect();
      const log = recorder(s);
      const j = await emitAck(s, "JOIN_ROOM", { username: `P${i}`, roomCode: code });
      expect(j.ok).toBe(true);
      seats[j.seatIndex!] = { seatIndex: j.seatIndex!, socket: s, log, token: j.sessionToken!, name: `P${i}` };
    }
  }
  return { seats, code };
}

/** Waits until predicate over the seat's latest state passes (with timeout). */
async function waitFor(
  seat: Seat | null,
  getState: () => PublicTwentyNineState | null,
  pred: (s: PublicTwentyNineState) => boolean,
  timeoutMs = 8000
): Promise<PublicTwentyNineState> {
  void seat;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = getState();
    if (s && pred(s)) return s;
    if (Date.now() > deadline) throw new Error(`waitFor timeout`);
    await sleep(40);
  }
}

function latestOf(log: LogEntry[] | undefined): PublicTwentyNineState | null {
  if (!log) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i]!.ev === "TN_STATE") return log[i]!.data as PublicTwentyNineState;
  }
  return null;
}

function myCardsOf(seat: Seat, handNumber?: number): TnCard[] {
  const cards: TnCard[] = [];
  for (const e of seat.log) {
    if (e.ev !== "YOUR_TN_HAND") continue;
    const d = e.data as { cards: TnCard[]; handNumber?: number };
    if (handNumber !== undefined && d.handNumber !== handNumber) continue;
    for (const c of d.cards) {
      if (!cards.some((x) => x.suit === c.suit && x.rank === c.rank)) cards.push(c);
    }
  }
  return cards;
}

/** Cards delivered for ONE deal batch (1 or 2) of the CURRENT log. */
function batchCardsOf(seat: Seat, batch: 1 | 2): TnCard[] {
  const out: TnCard[] = [];
  for (const e of seat.log) {
    if (e.ev !== "YOUR_TN_HAND") continue;
    const d = e.data as { batch: number | string; cards: TnCard[] };
    if (d.batch !== batch) continue;
    for (const c of d.cards) {
      if (!out.some((x) => x.suit === c.suit && x.rank === c.rank)) out.push(c);
    }
  }
  return out;
}

/** Generic condition poller for event-log driven assertions. */
async function pollUntil(
  fn: () => boolean,
  timeoutMs = 8000,
  label = "condition"
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error(`pollUntil timeout: ${label}`);
    await sleep(40);
  }
}

/** Anti-clockwise successor, for dealer-rotation assertions. */
const tnNext = (seat: number): number => (seat + 3) % 4;

/**
 * Deterministic auction: the first acting seat bids `bid`, everyone else
 * passes. Resolves once the phase reaches TRUMP_SETUP; returns the bidder.
 */
async function simpleAuctionToTrumpSetup(seats: Seat[], bid = 16): Promise<number> {
  let bidderSeat: number | null = null;
  const deadline = Date.now() + 20000;
  for (;;) {
    const st = latestOf(seats[0]!.log);
    if (!st || st.phase === "WAITING_FOR_PLAYERS") {
      await sleep(40);
      continue;
    }
    if (st.phase === "TRUMP_SETUP") {
      const bidder = st.bids?.bidderSeatIndex;
      if (bidder == null) throw new Error("simpleAuction: no bidder recorded");
      return bidder;
    }
    if (st.phase !== "BIDDING") throw new Error(`simpleAuction: unexpected phase ${st.phase}`);
    if (Date.now() > deadline) throw new Error("simpleAuction: timeout");
    const turn = st.bids?.turnSeatIndex;
    if (turn == null) continue;
    const s = seats.find((x) => x.seatIndex === turn);
    if (!s) {
      await sleep(40);
      continue;
    }
    if (bidderSeat === null) {
      bidderSeat = turn;
      s.socket.emit("GAME29_BID", { bid });
    } else {
      s.socket.emit("GAME29_BID", {}); // pass
    }
    const histLen = st.bids!.history.length;
    await waitFor(
      s,
      () => latestOf(s.log),
      (s2) => s2.phase !== "BIDDING" || s2.bids === null || s2.bids.history.length > histLen,
      3000
    ).catch(() => null);
  }
}

async function skipSingleHandForAll(
  seats: { seatIndex: number; socket: Socket; log?: LogEntry[] }[]
): Promise<void> {
  const connected = seats.find((s) => s.socket.connected) ?? seats[0];
  if (!connected || !connected.log) return;

  await waitFor(
    null,
    () => latestOf(connected.log!),
    (st) => st.phase === "SINGLE_HAND_DECISION" || st.phase === "PLAYING",
    8000
  ).catch(() => null);

  for (let guard = 0; guard < 25; guard++) {
    const st = latestOf(connected.log!);
    if (!st || st.phase !== "SINGLE_HAND_DECISION") break;
    const turn = st.actingSeatIndex;
    if (turn !== null) {
      const s = seats.find((x) => x.seatIndex === turn);
      if (s && s.socket.connected) {
        s.socket.emit("GAME29_SINGLE_HAND_DECISION", { declare: false });
      }
    }
    await sleep(80);
  }
}

function legalMirror(hand: TnCard[], trick: PublicTwentyNineState["trick"]): TnCard[] {
  if (trick.length === 0) return hand;
  const led = trick[0]!.card.suit;
  const followers = hand.filter((c) => c.suit === led);
  return followers.length > 0 ? followers : hand;
}

function dominantSuit(hand: TnCard[]): TnSuit {
  const counts = new Map<string, number>();
  for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  let best = "SPADES";
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best as TnSuit;
}

function lastStateAt(log: LogEntry[]): number {
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i]!.ev === "TN_STATE") return log[i]!.at;
  }
  return 0;
}
type HumanSeat = { seat: Seat; spent: Set<string>; cool?: number };

/**
 * Plays an ENTIRE auction+hand adaptively for HUMAN seats (deck order is
 * server-random). Bots act themselves. The bid winner applies `trumpChoice`
 * when provided, otherwise declares their dominant suit.
 */
async function playFullHand(
  humans: HumanSeat[],
  opts: { trumpChoice?: "SEVENTH_CARD" | "JOKER" } = {}
): Promise<void> {
  const anyLog = (): LogEntry[] => humans[0]!.seat.log;

  await waitFor(null, () => latestOf(anyLog()), (st) =>
    st.phase === "BIDDING" || st.phase === "TRUMP_SETUP" || st.phase === "PLAYING"
  );

  // --- Auction ---
  // The first acting seat becomes the OPENER (bids 17, then persists via the
  // v2 legal floor: match-or-exceed against opponents, strictly-higher vs own
  // side, conceding/passing above 26 so the auction always terminates).
  // Every other HUMAN passes on their turns; bots decide for themselves.
  let openerSeat: number | null = null;
  const auctionDeadline = Date.now() + 60000;
  const teamOf = (x: number) => (x % 2 === 0 ? "A" : "B");
  for (;;) {
    if (Date.now() > auctionDeadline) throw new Error("auction did not terminate");
    const st = latestOf(anyLog());
    if (!st || st.phase !== "BIDDING") break;
    const turn = st.bids?.turnSeatIndex;
    if (turn == null) break;

    const me = humans.find((h) => h.seat.seatIndex === turn);
    if (!me) {
      await sleep(60); // bot thinking
      continue;
    }
    if ((me.cool ?? 0) > Date.now()) {
      await sleep(40); // previous action still in flight
      continue;
    }
    // Decide only on the LATEST snapshot; if a newer one lands mid-decision
    // we skip and re-read next tick (prevents bids against stale holders).
    const decidedAt = lastStateAt(me.seat.log);

    if (openerSeat === null) {
      openerSeat = turn;
      me.cool = Date.now() + 1100;
      me.seat.socket.emit("GAME29_BID", { bid: 17 });
    } else if (turn === openerSeat) {
      const bids = st.bids!;
      const H = bids.highestBid!;
      let v: number | null;
      if (bids.bidderSeatIndex === turn && bids.challengerSeatIndex !== null && bids.challengerSeatIndex !== turn) {
        v = H; // Defender Stay
      } else if (bids.bidderSeatIndex !== null && bids.bidderSeatIndex % 2 === turn % 2) {
        v = 99; // Partner holds highest bid -> pass
      } else {
        v = Math.max(16, H + 1);
      }
      if (v > 26) {
        // freshness gate before conceding a pass too
        if (lastStateAt(me.seat.log) !== decidedAt) continue;
        me.cool = Date.now() + 1100;
        me.seat.socket.emit("GAME29_BID", {}); // concede
      } else {
        if (lastStateAt(me.seat.log) !== decidedAt) continue;
        me.cool = Date.now() + 1100;
        me.seat.socket.emit("GAME29_BID", { bid: v });
      }
    } else {
      // freshness gate: a newer snapshot arrived while deciding -> re-read
      if (lastStateAt(me.seat.log) !== decidedAt) continue;
      me.cool = Date.now() + 1100;
      me.seat.socket.emit("GAME29_BID", {}); // non-opener passes
    }

    const historyLen = st.bids!.history.length;
    await waitFor(
      me.seat,
      () => latestOf(me.seat.log),
      (s2) =>
        s2.phase !== "BIDDING" ||
        s2.bids === null ||
        s2.bids.history.length > historyLen,
      4000
    ).catch(() => null);
  }

  // --- Trump setup ---
  const st = await waitFor(null, () => latestOf(anyLog()), (s2) => s2.phase !== "BIDDING");
  if (st.phase === "TRUMP_SETUP") {
    const bidderSeat = st.bids!.bidderSeatIndex!;
    const me = humans.find((h) => h.seat.seatIndex === bidderSeat);
    if (me) {
      const hand = myCardsOf(me.seat, st.roundNumber);
      const choice =
        opts.trumpChoice ?? dominantSuit(hand.length >= 8 ? hand : hand.slice(0, 4));
      me.seat.socket.emit("GAME29_DECLARE_TRUMP", { choice });
    }
  }
  await waitFor(null, () => latestOf(anyLog()), (s2) => s2.phase !== "TRUMP_SETUP", 5000);
  if (latestOf(anyLog())!.phase === "REDEALING") {
    throw new Error("hand was redealt - caller should retry");
  }

  // --- Single Hand Decision ---
  for (let shGuard = 0; shGuard < 30; shGuard++) {
    const current = latestOf(anyLog());
    if (!current || current.phase !== "SINGLE_HAND_DECISION") break;
    const acting = current.actingSeatIndex;
    if (acting !== null) {
      const h = humans.find((x) => x.seat.seatIndex === acting);
      if (h) {
        h.seat.socket.emit("GAME29_SINGLE_HAND_DECISION", { declare: false });
      }
    }
    await sleep(60);
  }

  // --- Tricks ---
    let safety = 0;
    const playDeadline = Date.now() + 120000;
    for (;;) {
      safety++;
      if (Date.now() > playDeadline) throw new Error("trick play did not terminate");

      // Round-scoped finish check: TN_ROUND_FINISHED events accumulate in the
      // log across hands, so only an event for the CURRENT round counts.
      const currentRound = latestOf(anyLog())!.roundNumber;
      const finished = humans.some((h) =>
        h.seat.log.some(
          (e) =>
            e.ev === "TN_ROUND_FINISHED" &&
            ((e.data as { summary: { roundNumber: number } }).summary.roundNumber === currentRound)
        )
      );
      if (finished) {
      for (const h of humans) {
        await waitFor(h.seat, () => latestOf(h.seat.log), (st2) => st2.phase === "ROUND_SCORED" || st2.phase === "MATCH_OVER");
      }
      return;
    }

    for (const h of humans) {
      const cs = latestOf(h.seat.log);
      if (!cs) continue;
      for (const p of cs.trick) {
        if (p.seatIndex === h.seat.seatIndex) h.spent.add(`${p.card.rank}${p.card.suit}`);
      }
    }

    let acted = false;
    for (const h of humans) {
      if ((h.cool ?? 0) > Date.now()) continue;
      const cs = latestOf(h.seat.log);
      if (!cs || cs.phase !== "PLAYING") continue;
      if (cs.actingSeatIndex !== h.seat.seatIndex) continue;
      const remaining = myCardsOf(h.seat, cs.roundNumber).filter((c) => !h.spent.has(`${c.rank}${c.suit}`));
      const legal = legalMirror(remaining, cs.trick);
      if (legal.length === 0) continue;
      const low = legal.reduce((m, c) => (c.rank < m.rank ? c : m));
      h.spent.add(`${low.rank}${low.suit}`);
      h.cool = Date.now() + 1100;
      const prevActing = cs.actingSeatIndex;
      const prevLen = cs.trick.length;
      h.seat.socket.emit("GAME29_PLAY_CARD", { card: low });
      // Settle: wait until our action is reflected so we never double-fire
      // on a stale snapshot (that would log spurious ACTION_REJECTEDs).
      await waitFor(
        null,
        () => latestOf(h.seat.log),
        (s2) =>
          s2.phase !== "PLAYING" ||
          s2.actingSeatIndex !== prevActing ||
          s2.trick.length !== prevLen,
        4000
      ).catch(() => null);
      acted = true;
      break;
    }
    if (!acted) await sleep(30);
  }
}

describe("twenty-nine: multiplayer integration", () => {
  it(
    "SUIT choice: full hand with hidden-trump security audit on raw payloads",
    async () => {
      const { seats } = await makeTnRoom(false);
      const humans = seats.map((seat) => ({ seat, spent: new Set<string>() }));
      await playFullHand(humans);

      // ---- Card integrity: each client got exactly its own 8 unique cards.
      const hands = seats.map((s) => myCardsOf(s));
      for (const h of hands) expect(h).toHaveLength(8);
      const keys = new Set(hands.flat().map((c) => `${c.suit}${c.rank}`));
      expect(keys.size).toBe(32);

      // ---- Bidder privacy: CHOOSE_TRUMP prompt went ONLY to the bidder.
      const prompted = seats.filter((s) =>
        s.log.some((e) => e.ev === "TN_BIDDER_PRIVATE" && (e.data as { kind?: string }).kind === "CHOOSE_TRUMP")
      );
      expect(prompted).toHaveLength(1);

      // ---- Trump reveal ordering per non-bidder client.
      const anyRevealGlobally = seats.some((s) => s.log.some((e) => e.ev === "TN_TRUMP_REVEALED"));
      let revealedSuit: string | null = null;
      const bidderSeat = seats.find((s) =>
        s.log.some((e) => e.ev === "TN_BIDDER_PRIVATE")
      )!.seatIndex;
      for (const s of seats) {
        if (s.seatIndex === bidderSeat) continue;
        let revealSeenAt = Infinity;
        for (const e of s.log) {
          if (e.ev === "TN_TRUMP_REVEALED") {
            revealSeenAt = Math.min(revealSeenAt, e.at);
            const d = e.data as { suit: string };
            revealedSuit ??= d.suit;
            expect(d.suit).toBe(revealedSuit);
          }
          if (e.ev === "TN_STATE") {
            const st = e.data as PublicTwentyNineState;
            if (st.trump.state === "REVEALED") {
              expect(e.at).toBeGreaterThanOrEqual(revealSeenAt);
              revealedSuit ??= st.trump.suit;
              expect(st.trump.suit).toBe(revealedSuit);
            }
          }
        }
        for (const e of s.log.filter((e) => e.at < revealSeenAt && e.ev === "TN_STATE")) {
          expect(["NOT_SET", "HIDDEN"]).toContain((e.data as PublicTwentyNineState).trump.state);
        }
      }
      if (anyRevealGlobally) expect(revealedSuit).not.toBeNull();
      else {
        for (const s of seats)
          for (const e of s.log)
            if (e.ev === "TN_STATE")
              expect(["NOT_SET", "HIDDEN", "JOKER_MODE"]).toContain(
                (e.data as PublicTwentyNineState).trump.state
              );
      }

      // ---- Trick integrity: tricks x 4 unique cards; Σ <= 29.
      const tricks = seats[0]!.log.filter((e) => e.ev === "TN_TRICK_RESOLVED");
      expect(tricks.length).toBeGreaterThanOrEqual(1);
      expect(tricks.length).toBeLessThanOrEqual(8);
      const playedKeys = new Set<string>();
      for (const t of tricks) {
        const d = t.data as { plays: { card: TnCard }[] };
        expect(d.plays).toHaveLength(4);
        for (const p of d.plays) playedKeys.add(`${p.card.suit}${p.card.rank}`);
      }
      expect(playedKeys.size).toBe(tricks.length * 4);

      const fin = seats[0]!.log.find((e) => e.ev === "TN_ROUND_FINISHED")!;
      const summary = (fin.data as { summary: { captured: { A: number; B: number }; requirement: number; bid: number } }).summary;
      expect(summary.captured.A + summary.captured.B).toBeLessThanOrEqual(29);
      expect(summary.captured.A + summary.captured.B).toBeGreaterThan(0);
    },
    45000
  );

  it("rejects out-of-turn plays and duplicate actions", async () => {
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");

    const wrongTurn = seats.find((s) => s.seatIndex !== latestState(seats[0]!.log).bids?.turnSeatIndex)!;
    wrongTurn.socket.emit("GAME29_PLAY_CARD", { card: { rank: 7, suit: "SPADES" } });

    const deadline = Date.now() + 3000;
    let rejected = false;
    while (Date.now() < deadline) {
      if (wrongTurn.log.some((e) => e.ev === "ACTION_REJECTED")) {
        rejected = true;
        break;
      }
      await sleep(30);
    }
    expect(rejected).toBe(true);
  });

  it(
    "SEVENTH_CARD choice: completes a hand (tolerating redeals)",
    async () => {
      const { seats } = await makeTnRoom(false);
      const humans = seats.map((seat) => ({ seat, spent: new Set<string>() }));
      for (let attempt = 0; attempt < 5; attempt++) {
        const st = latestState(seats[0]!.log);
        if (st.phase === "ROUND_SCORED" || st.phase === "MATCH_OVER") break;
        try {
          await playFullHand(humans, { trumpChoice: "SEVENTH_CARD" });
          break;
        } catch (err) {
          if (/redealt/.test((err as Error).message)) continue;
          throw err;
        }
      }
      const final = latestState(seats[0]!.log);
      expect(["ROUND_SCORED", "MATCH_OVER"]).toContain(final.phase);
      expect(final.trumpStyle).toBe("SEVENTH_CARD");
      // Indicator privacy: only the bidder saw it.
      const seers = seats.filter((s) =>
        s.log.some(
          (e) => e.ev === "TN_BIDDER_PRIVATE" && (e.data as { kind?: string }).kind === "SEVENTH_INDICATOR"
        )
      );
      expect(seers).toHaveLength(1);
    },
    60000
  );

  it(
    "JOKER choice: power-rank hand completes without any suit",
    async () => {
      const { seats } = await makeTnRoom(false);
      const humans = seats.map((seat) => ({ seat, spent: new Set<string>() }));
      await playFullHand(humans, { trumpChoice: "JOKER" });
      const st = latestState(seats[0]!.log);
      expect(["ROUND_SCORED", "MATCH_OVER"]).toContain(st.phase);
      expect(st.trumpStyle).toBe("JOKER");
      for (const s of seats) {
        expect(s.log.some((e) => e.ev === "TN_BIDDER_PRIVATE" && (e.data as { kind?: string }).kind === "SEVENTH_INDICATOR")).toBe(false);
        for (const e of s.log) {
          if (e.ev === "TN_STATE" && (e.data as PublicTwentyNineState).phase !== "WAITING_FOR_PLAYERS") {
            const tv = (e.data as PublicTwentyNineState).trump.state;
            expect(["NOT_SET", "HIDDEN", "JOKER_MODE"]).toContain(tv);
          }
        }
      }
    },
    45000
  );

  it(
    "marriage: ±4 requirement math holds whenever K+Q is declared",
    async () => {
      const { seats } = await makeTnRoom(false);
      const humans = seats.map((seat) => ({ seat, spent: new Set<string>() }));
      await playFullHand(humans);
      const fin = seats[0]!.log.find((e) => e.ev === "TN_ROUND_FINISHED")!;
      const summary = (fin.data as { summary: { captured: { A: number; B: number }; marriageTeam: string | null; bid: number; requirement: number } }).summary;
      expect(summary.captured.A + summary.captured.B).toBeLessThanOrEqual(29);
      expect(summary.captured.A + summary.captured.B).toBeGreaterThan(0);
      if (summary.marriageTeam === null) {
        expect(summary.requirement).toBe(summary.bid);
      } else {
        expect([Math.max(16, summary.bid - 4), summary.bid + 4]).toContain(summary.requirement);
      }
    },
    45000
  );

  it(
    "offline fallback: disconnected seat's bidding turn auto-PASSES after the grace window",
    async () => {
      ps.close();
      ps = createPokerServer({ limits: { ...BASE_LIMITS, tnOfflineFallbackSeconds: 1 } });
      await new Promise<void>((resolve) => {
        ps.httpServer.listen(0, "127.0.0.1", () => resolve());
      });
      port = (ps.httpServer.address() as AddressInfo).port;

      const mk = (): ClientSocket => io(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false });
      const logs: LogEntry[][] = [[], [], [], []];
      const socks: ClientSocket[] = [mk(), mk(), mk(), mk()];
      socks.forEach((s, i) => {
        for (const ev of WATCHED) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          s.on(ev, ((d: any) => logs[i]!.push({ ev, at: Date.now(), data: d })) as never);
        }
      });
      const ack0 = await emitAck(socks[0]!, "CREATE_ROOM", {
        username: "P0",
        startingCoins: 1000,
        gameType: "TWENTY_NINE",
      });
      expect(ack0.ok).toBe(true);
      const code = ack0.roomCode!;
      for (let i = 1; i < 4; i++) {
        const ack = await emitAck(socks[i]!, "JOIN_ROOM", { username: `P${i}`, roomCode: code });
        expect(ack.ok).toBe(true);
      }
      const deadline = Date.now() + 6000;
      let started = false;
      while (Date.now() < deadline) {
        const st = latestOf(logs[0]!);
        if (st?.phase === "BIDDING") {
          started = true;
          break;
        }
        await sleep(40);
      }
      expect(started).toBe(true);

      const turnSeat = latestState(logs[0]!).bids!.turnSeatIndex!;
      socks[turnSeat]!.disconnect();

      const passDeadline = Date.now() + 5000;
      let autoPassed = false;
      while (Date.now() < passDeadline) {
        const st = latestOf(logs[(turnSeat + 3) % 4]!);
        if (st?.bids?.passedSeatIndexes.includes(turnSeat)) {
          autoPassed = true;
          break;
        }
        await sleep(50);
      }
      expect(autoPassed).toBe(true);
    },
    30000
  );

  it(
    "single player vs BOTS: table auto-fills, bots play legally, round completes",
    async () => {
      const { seats } = await makeTnRoom(true);
      // Only the creator owns a socket; verify the table auto-filled via state.
      expect(seats.filter(Boolean)).toHaveLength(1);
      const pre = await waitFor(null, () => latestOf(seats[0]!.log), (s) => s.seats.every((x) => x.username !== null), 6000);
      const botViews = pre.seats.filter((s) => /^Bot /.test(s.username ?? ""));
      expect(botViews).toHaveLength(3);

      const humans = seats.slice(0, 1).map((seat) => ({ seat, spent: new Set<string>() }));
      for (let attempt = 0; attempt < 5; attempt++) {
        const st = latestState(seats[0]!.log);
        if (st.phase === "ROUND_SCORED" || st.phase === "MATCH_OVER") break;
        try {
          await playFullHand(humans);
          break;
        } catch (err) {
          if (/redealt/.test((err as Error).message)) continue;
          throw err;
        }
      }

      const st = latestState(seats[0]!.log);
      expect(["ROUND_SCORED", "MATCH_OVER"]).toContain(st.phase);
      // The human never received anyone else's cards.
      expect(myCardsOf(seats[0]!).length).toBeLessThanOrEqual(8);
      // No SUBSTANTIVE illegal actions anywhere. Bid-auction races between
      // the test driver and thinking bots may legitimately bounce ("must be
      // strictly higher" / "already matched" / "partner's bid") — those are
      // driver artifacts, not rule violations. Anything else must be zero.
      const rejects = seats[0]!.log
        .filter((e) => e.ev === "ACTION_REJECTED")
        .map((e) => JSON.stringify(e.data));
      const benign = rejects.filter((r) =>
        /strictly higher|already matched|partner's bid/.test(r)
      );
      expect(rejects.length - benign.length, `rejections: ${rejects.join(" | ")}`).toBe(0);
      expect(benign.length).toBeLessThanOrEqual(3);
      // Trick stream intact.
      const tricks = seats[0]!.log.filter((e) => e.ev === "TN_TRICK_RESOLVED");
      expect(tricks.length).toBeGreaterThanOrEqual(1);
      expect(tricks.length).toBeLessThanOrEqual(8);
    },
    120000
  );

  it(
    "bot filling: 3 real players + 1 bot fills remaining seat and starts match",
    async () => {
      const s0 = connect();
      const s1 = connect();
      const s2 = connect();
      const log0 = recorder(s0);

      const ack0 = await emitAck(s0, "CREATE_ROOM", {
        username: "Player1",
        startingCoins: 1000,
        gameType: "TWENTY_NINE",
      });
      expect(ack0.ok).toBe(true);
      const code = ack0.roomCode!;

      const ack1 = await emitAck(s1, "JOIN_ROOM", { username: "Player2", roomCode: code });
      expect(ack1.ok).toBe(true);
      const ack2 = await emitAck(s2, "JOIN_ROOM", { username: "Player3", roomCode: code });
      expect(ack2.ok).toBe(true);

      // Verify currently 3 players in WAITING_FOR_PLAYERS
      const mid = await waitFor(null, () => latestOf(log0), (s) => s.seats.filter((x) => x.username !== null).length === 3, 4000);
      expect(mid.phase).toBe("WAITING_FOR_PLAYERS");

      // Player 1 requests filling the remaining seat with bots
      s0.emit("GAME29_FILL_BOTS");

      // Verify all 4 seats are full and the 4th is a bot
      const started = await waitFor(null, () => latestOf(log0), (s) => s.seats.every((x) => x.username !== null), 4000);
      const bots = started.seats.filter((s) => s.isBot || /^Bot /.test(s.username ?? ""));
      expect(bots).toHaveLength(1);

      // Auto start transitions to BIDDING
      const bidding = await waitFor(null, () => latestOf(log0), (s) => s.phase === "BIDDING", 6000);
      expect(bidding.phase).toBe("BIDDING");

      s0.disconnect();
      s1.disconnect();
      s2.disconnect();
    },
    20000
  );

  it(
    "SINGLE HAND mode: declaration plays solo, partner sits out with isInactive flag",
    async () => {
      const { seats } = await makeTnRoom(false);
      const humans = seats.map((seat) => ({ seat, spent: new Set<string>() }));
      
      // Simple auction to TRUMP_SETUP
      const bidder = await simpleAuctionToTrumpSetup(seats);
      const bidderHuman = humans.find((h) => h.seat.seatIndex === bidder)!;
      bidderHuman.seat.socket.emit("GAME29_DECLARE_TRUMP", { choice: "HEARTS" });

      // Wait for SINGLE_HAND_DECISION
      const shState = await waitFor(
        null,
        () => latestOf(seats[0]!.log),
        (st) => st.phase === "SINGLE_HAND_DECISION",
        5000
      );
      expect(shState.phase).toBe("SINGLE_HAND_DECISION");

      // Acting seat declares single hand
      const actingSeat = shState.actingSeatIndex!;
      const declaringHuman = humans.find((h) => h.seat.seatIndex === actingSeat)!;
      declaringHuman.seat.socket.emit("GAME29_SINGLE_HAND_DECISION", { declare: true });

      // Wait for PLAYING phase with isSingleHand: true
      const playState = await waitFor(
        null,
        () => latestOf(seats[0]!.log),
        (st) => st.phase === "PLAYING" && st.isSingleHand === true,
        5000
      );
      expect(playState.isSingleHand).toBe(true);
      expect(playState.singleHandSeatIndex).toBe(actingSeat);
      const inactivePartner = (actingSeat + 2) % 4;
      expect(playState.seats[inactivePartner]!.isInactive).toBe(true);
    },
    30000
  );
});

// ============================================================================
// STABILITY & SECOND-DEAL REGRESSION SUITE
// Locks the critical flow (bid -> trump -> second deal -> play), the server
// invariants around it, and the Part-2 audit behaviours (races, reconnects,
// room cleanup, full-match playthrough).
// ============================================================================

function serverHandOf(code: string, seatIndex: number): string[] {
  const match = (
    ps.registry.get(code)! as unknown as { match: { seats: { hand: TnCard[] }[] } }
  ).match;
  return match.seats[seatIndex]!.hand.map((c) => `${c.suit}${c.rank}`);
}

describe("twenty-nine: second deal & core-flow regression", () => {
  it(
    "second deal: 4+4 per player, batch 2 only after trump, PLAYING requires 8-card hands, 32 unique cards",
    async () => {
      const { seats, code } = await makeTnRoom(false);
      await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
      await pollUntil(() => seats.every((s) => batchCardsOf(s, 1).length === 4), 8000, "batch 1 = 4 per seat");

      // Deterministic auction into trump setup.
      const bidder = await simpleAuctionToTrumpSetup(seats);
      const bidderSeat = seats.find((s) => s.seatIndex === bidder)!;

      // Only the bidder was prompted; nobody has batch 2 before trump is set.
      const prompted = seats.filter((s) =>
        s.log.some((e) => e.ev === "TN_BIDDER_PRIVATE" && (e.data as { kind?: string }).kind === "CHOOSE_TRUMP")
      );
      expect(prompted.map((s) => s.seatIndex)).toEqual([bidder]);
      for (const s of seats) expect(batchCardsOf(s, 2)).toHaveLength(0);
      expect(latestOf(seats[0]!.log)!.phase).toBe("TRUMP_SETUP");

      // Bid winner declares the dominant suit of their own first batch.
      bidderSeat.socket.emit("GAME29_DECLARE_TRUMP", { choice: dominantSuit(batchCardsOf(bidderSeat, 1)) });
      await skipSingleHandForAll(seats);

      await pollUntil(() => latestOf(seats[0]!.log)!.phase === "PLAYING", 6000, "phase PLAYING");
      await pollUntil(() => seats.every((s) => batchCardsOf(s, 2).length === 4), 8000, "batch 2 = 4 per seat");

      // 4 + 4 per seat; across all four clients the whole deck is accounted
      // for exactly once (no duplicates, no missing cards).
      const all = new Set<string>();
      for (const s of seats) {
        const b1 = batchCardsOf(s, 1);
        const b2 = batchCardsOf(s, 2);
        expect(b1).toHaveLength(4);
        expect(b2).toHaveLength(4);
        for (const c of [...b1, ...b2]) all.add(`${c.suit}${c.rank}`);
      }
      expect(all.size).toBe(32);

      // Server truth: every seated hand verifiably holds 8 cards in PLAYING.
      const match = (
        ps.registry.get(code)! as unknown as {
          match: { seats: { username: string | null; hand: TnCard[] }[] };
        }
      ).match;
      for (const seat of match.seats) {
        if (seat.username === null) continue;
        expect(seat.hand).toHaveLength(8);
      }

      // Ordering: batch 2 never arrived after the first PLAYING snapshot.
      for (const s of seats) {
        const firstPlaying = s.log.find(
          (e) => e.ev === "TN_STATE" && (e.data as PublicTwentyNineState).phase === "PLAYING"
        );
        const lastBatch2 = [...s.log]
          .reverse()
          .find((e) => e.ev === "YOUR_TN_HAND" && (e.data as { batch: number | string }).batch === 2);
        expect(firstPlaying).toBeDefined();
        expect(lastBatch2).toBeDefined();
        expect(lastBatch2!.at).toBeLessThanOrEqual(firstPlaying!.at);
      }
    },
    30000
  );

  it("only the bid winner can act during trump selection; the room stays healthy afterwards", async () => {
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    const bidder = await simpleAuctionToTrumpSetup(seats);
    const impostor = seats.find((s) => s.seatIndex !== bidder)!;

    impostor.socket.emit("GAME29_DECLARE_TRUMP", { choice: "SPADES" });
    await pollUntil(() => impostor.log.some((e) => e.ev === "ACTION_REJECTED"), 3000, "impostor rejected");
    expect(latestOf(seats[0]!.log)!.phase).toBe("TRUMP_SETUP");

    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll(seats);
    await pollUntil(() => latestOf(seats[0]!.log)!.phase === "PLAYING", 6000, "playing after valid declare");
  }, 20000);

  it(
    "bid winner disconnect during TRUMP_SETUP: fallback auto-declares and the hand proceeds",
    async () => {
      ps.close();
      ps = createPokerServer({ limits: { ...BASE_LIMITS, tnOfflineFallbackSeconds: 1 } });
      await new Promise<void>((resolve) => {
        ps.httpServer.listen(0, "127.0.0.1", () => resolve());
      });
      port = (ps.httpServer.address() as AddressInfo).port;

      const { seats } = await makeTnRoom(false);
      await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
      const bidder = await simpleAuctionToTrumpSetup(seats);
      const bidderSeat = seats.find((s) => s.seatIndex === bidder)!;
      const surviving = seats.find((s) => s.seatIndex !== bidder)!;

      bidderSeat.socket.disconnect();
      await skipSingleHandForAll(seats.filter((s) => s.seatIndex !== bidder));
      await pollUntil(() => latestOf(surviving.log)!.phase === "PLAYING", 12000, "fallback reached PLAYING");

      const st = latestOf(surviving.log)!;
      expect(st.trumpStyle).toBe("SUIT"); // dominant-suit auto-declare
      expect(st.trump.state).toBe("HIDDEN"); // the fallback never reveals trump
      for (const s of seats) {
        if (s.seatIndex === bidder) continue;
        expect(batchCardsOf(s, 2)).toHaveLength(4); // second deal still flows
        expect(s.log.some((e) => e.ev === "TN_TRUMP_REVEALED")).toBe(false);
      }
    },
    30000
  );
});

describe("twenty-nine: race & reconnect stability", () => {
  it("double-submitted play card resolves to exactly one accept and one clean reject", async () => {
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    const bidder = await simpleAuctionToTrumpSetup(seats);
    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll(seats);
    await pollUntil(() => latestOf(seats[0]!.log)!.phase === "PLAYING", 6000, "playing");

    const st = latestOf(seats[0]!.log)!;
    const leader = seats.find((s) => s.seatIndex === st.actingSeatIndex)!;
    const card = batchCardsOf(leader, 1)[0]!; // leading: every card is legal
    leader.socket.emit("GAME29_PLAY_CARD", { card });
    leader.socket.emit("GAME29_PLAY_CARD", { card });

    await pollUntil(() => latestOf(seats[0]!.log)!.trick.length === 1, 4000, "trick grew by exactly one");
    await sleep(300); // let the duplicate submission settle
    expect(leader.log.filter((e) => e.ev === "ACTION_REJECTED")).toHaveLength(1);
    expect(latestOf(seats[0]!.log)!.trick).toHaveLength(1);
  }, 20000);

  it("reconnect matrix: mid-bidding restore keeps seat, hand and phase", async () => {
    const { seats, code } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    await pollUntil(() => seats.every((s) => batchCardsOf(s, 1).length === 4), 8000, "batch1");
    const victim = seats[2]!;
    const phaseBefore = latestOf(victim.log)!.phase;
    victim.socket.disconnect();

    const re = connect();
    const log = recorder(re);
    const ack = await emitAck(re, "RECONNECT", { sessionToken: victim.token });
    expect(ack.ok).toBe(true);
    expect(ack.seatIndex).toBe(victim.seatIndex);
    expect(ack.gameType).toBe("TWENTY_NINE");

    await pollUntil(() => log.some((e) => e.ev === "YOUR_TN_HAND"), 5000, "hand redelivered");
    const hands = log.filter((e) => e.ev === "YOUR_TN_HAND");
    expect(hands).toHaveLength(1); // exactly one authoritative FULL_RECONNECT
    expect((hands[0]!.data as { batch: string }).batch).toBe("FULL_RECONNECT");
    expect((hands[0]!.data as { cards: TnCard[] }).cards).toHaveLength(4);

    // Privacy: every card this client has EVER received belongs to their own hand.
    const mine = serverHandOf(code, victim.seatIndex);
    for (const e of log) {
      if (e.ev !== "YOUR_TN_HAND") continue;
      for (const c of (e.data as { cards: TnCard[] }).cards) {
        expect(mine).toContain(`${c.suit}${c.rank}`);
      }
    }
    expect(latestOf(log)!.phase).toBe(phaseBefore);
    re.disconnect();
  }, 20000);

  it("reconnect matrix: trump-setup restore leaves the room actionable", async () => {
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    const bidder = await simpleAuctionToTrumpSetup(seats);
    const victim = seats.find((s) => s.seatIndex !== bidder)!;
    victim.socket.disconnect();

    const re = connect();
    const log = recorder(re);
    const ack = await emitAck(re, "RECONNECT", { sessionToken: victim.token });
    expect(ack.ok).toBe(true);
    await pollUntil(() => log.some((e) => e.ev === "YOUR_TN_HAND"), 5000, "hand");
    expect(latestOf(log)!.phase).toBe("TRUMP_SETUP");
    expect((log.find((e) => e.ev === "YOUR_TN_HAND")!.data as { cards: TnCard[] }).cards).toHaveLength(4);

    // Room is still actionable: the real bidder completes trump.
    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll([
      ...seats.filter((s) => s.seatIndex !== victim.seatIndex),
      { seatIndex: victim.seatIndex, socket: re, log },
    ]);
    await pollUntil(() => latestOf(log)!.phase === "PLAYING", 8000, "playing");
    re.disconnect();
  }, 20000);

  it("reconnect matrix: mid-trick restore delivers the full 8-card hand", async () => {
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    const bidder = await simpleAuctionToTrumpSetup(seats);
    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll(seats);
    await pollUntil(() => latestOf(seats[0]!.log)!.phase === "PLAYING", 6000, "playing");

    const leader = seats.find((s) => s.seatIndex === latestOf(seats[0]!.log)!.actingSeatIndex)!;
    leader.socket.emit("GAME29_PLAY_CARD", { card: batchCardsOf(leader, 1)[0]! });
    await pollUntil(() => latestOf(seats[0]!.log)!.trick.length === 1, 4000, "trick started");

    // Disconnect someone who is NOT acting (no offline-fallback interference).
    const st = latestOf(seats[0]!.log)!;
    const victim = seats.find((s) => s.seatIndex !== st.actingSeatIndex)!;
    victim.socket.disconnect();

    const re = connect();
    const log = recorder(re);
    const ack = await emitAck(re, "RECONNECT", { sessionToken: victim.token });
    expect(ack.ok).toBe(true);
    await pollUntil(() => log.some((e) => e.ev === "YOUR_TN_HAND"), 5000, "hand");
    expect((log.find((e) => e.ev === "YOUR_TN_HAND")!.data as { cards: TnCard[] }).cards).toHaveLength(8);
    expect(latestOf(log)!.phase).toBe("PLAYING");
    expect(latestOf(log)!.trick).toHaveLength(1);
    re.disconnect();
  }, 20000);

  it("GAME29_SYNC_HAND: client requests hand sync and receives current authoritative remaining cards", async () => {
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");

    // Client requests hand sync explicitly (simulating missed deal / slow connection)
    const client = seats[0]!;
    const initialHandCount = client.log.filter((e) => e.ev === "YOUR_TN_HAND").length;
    client.socket.emit("GAME29_SYNC_HAND");

    await pollUntil(
      () => client.log.filter((e) => e.ev === "YOUR_TN_HAND").length > initialHandCount,
      4000,
      "sync hand received"
    );

    const latestHandEvent = client.log.filter((e) => e.ev === "YOUR_TN_HAND").slice(-1)[0]!;
    expect(latestHandEvent.data).toMatchObject({
      batch: "FULL_RECONNECT",
    });
    expect((latestHandEvent.data as { cards: TnCard[] }).cards).toHaveLength(4);
  }, 20000);

  it("GAME29_SYNC_HAND: mid-hand sync returns only remaining unplayed cards", async () => {
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    const bidder = await simpleAuctionToTrumpSetup(seats);
    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll(seats);
    await pollUntil(() => latestOf(seats[0]!.log)!.phase === "PLAYING", 6000, "playing");

    // Leader plays 1 card from their 8
    const leader = seats.find((s) => s.seatIndex === latestOf(seats[0]!.log)!.actingSeatIndex)!;
    const cardToPlay = batchCardsOf(leader, 1)[0]!;
    leader.socket.emit("GAME29_PLAY_CARD", { card: cardToPlay });
    await pollUntil(() => latestOf(seats[0]!.log)!.trick.length === 1, 4000, "trick started");

    // Leader now asks for GAME29_SYNC_HAND
    const beforeCount = leader.log.filter((e) => e.ev === "YOUR_TN_HAND").length;
    leader.socket.emit("GAME29_SYNC_HAND");

    await pollUntil(
      () => leader.log.filter((e) => e.ev === "YOUR_TN_HAND").length > beforeCount,
      4000,
      "synced hand received"
    );

    const syncedHand = leader.log.filter((e) => e.ev === "YOUR_TN_HAND").slice(-1)[0]!;
    const cards = (syncedHand.data as { cards: TnCard[] }).cards;
    // Exactly 7 cards remaining (1 card played)
    expect(cards).toHaveLength(7);
    // Played card is not present in remaining hand
    expect(cards.some((c) => c.suit === cardToPlay.suit && c.rank === cardToPlay.rank)).toBe(false);
  }, 20000);

  it("join & create room returns tnState in ack and delivers initial 4 cards immediately", async () => {
    // 1. Single player with bots creation
    const s0 = connect();
    const l0 = recorder(s0);
    const ack0 = await emitAck(s0, "CREATE_ROOM", {
      username: "Player0",
      startingCoins: 1000,
      gameType: "TWENTY_NINE",
      vsBots: true,
    });
    expect(ack0.ok).toBe(true);
    expect(ack0.tnState).toBeDefined();
    expect(ack0.tnState!.seats).toHaveLength(4);

    // Initial 4 cards should be delivered directly upon startHand
    await pollUntil(() => l0.some((e) => e.ev === "YOUR_TN_HAND"), 6000, "hand received");
    const hand0 = l0.find((e) => e.ev === "YOUR_TN_HAND")!.data as { cards: TnCard[]; batch: number | string };
    expect(hand0.cards).toHaveLength(4);
    s0.disconnect();

    // 2. Joining an active room
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");

    // Fresh joiner joining by username to reconnect / join table
    const sJoin = connect();
    const lJoin = recorder(sJoin);
    const victim = seats[2]!;
    const ackJoin = await emitAck(sJoin, "JOIN_ROOM", {
      username: `Seat${victim.seatIndex}`,
      roomCode: latestOf(victim.log)!.roomCode ?? "",
      sessionToken: victim.token,
    });
    expect(ackJoin.ok).toBe(true);
    expect(ackJoin.tnState).toBeDefined();
    expect(ackJoin.tnState!.phase).toBe("BIDDING");

    // Cards should arrive on the newly joined socket immediately
    await pollUntil(() => lJoin.some((e) => e.ev === "YOUR_TN_HAND"), 5000, "join hand received");
    const joinHand = lJoin.find((e) => e.ev === "YOUR_TN_HAND")!.data as { cards: TnCard[] };
    expect(joinHand.cards).toHaveLength(4);
    sJoin.disconnect();
  }, 20000);
});

describe("twenty-nine: room lifecycle & leaks", () => {
  it(
    "abandoned rooms (human and bot-filled) are swept and destroyed",
    async () => {
      ps.close();
      ps = createPokerServer({ limits: { ...BASE_LIMITS, emptyRoomTtlMs: 400 } });
      await new Promise<void>((resolve) => {
        ps.httpServer.listen(0, "127.0.0.1", () => resolve());
      });
      port = (ps.httpServer.address() as AddressInfo).port;

      const human = await makeTnRoom(false);
      const bots = await makeTnRoom(true);
      const hRoom = ps.registry.get(human.code)!;
      const bRoom = ps.registry.get(bots.code)!;
      expect(hRoom).toBeDefined();
      expect(bRoom).toBeDefined();

      for (const s of human.seats) s.socket.disconnect();
      for (const s of bots.seats) s.socket.disconnect();
      await pollUntil(
        () => hRoom.lastActivityAt() === 0 && bRoom.lastActivityAt() === 0,
        4000,
        "activity zeroed"
      );
      await sleep(500); // outlive the TTL measured from creation

      (ps.registry as unknown as { sweep: () => void }).sweep();
      expect(ps.registry.get(human.code)).toBeUndefined();
      expect(ps.registry.get(bots.code)).toBeUndefined();
      expect(hRoom.isDestroyed()).toBe(true);
      expect(bRoom.isDestroyed()).toBe(true);
    },
    20000
  );
});

describe("twenty-nine: multiplayer reliability & turn resilience", () => {
  it("disconnect during trick play: offline fallback executes legal card and advances turn", async () => {
    ps.close();
    ps = createPokerServer({ limits: { ...BASE_LIMITS, tnOfflineFallbackSeconds: 1 } });
    await new Promise<void>((resolve) => {
      ps.httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (ps.httpServer.address() as AddressInfo).port;

    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    const bidder = await simpleAuctionToTrumpSetup(seats);
    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll(seats);
    await pollUntil(() => latestOf(seats[0]!.log)!.phase === "PLAYING", 6000, "playing");

    const actingBefore = latestOf(seats[0]!.log)!.actingSeatIndex!;
    const actingSeat = seats.find((s) => s.seatIndex === actingBefore)!;

    // Disconnect the active player on their turn
    actingSeat.socket.disconnect();

    // Fallback should execute within ~2s and play a card
    const observer = seats.find((s) => s.seatIndex !== actingBefore)!;
    await pollUntil(
      () => latestOf(observer.log)!.trick.length === 1 || latestOf(observer.log)!.actingSeatIndex !== actingBefore,
      6000,
      "turn fallback executed"
    );

    const st = latestOf(observer.log)!;
    expect(st.actingSeatIndex).not.toBe(actingBefore);
    expect(st.trick.some((p) => p.seatIndex === actingBefore)).toBe(true);
  }, 25000);

  it("reconnect before fallback executes: fallback cancelled and player acts manually", async () => {
    ps.close();
    // 3 seconds offline grace window
    ps = createPokerServer({ limits: { ...BASE_LIMITS, tnOfflineFallbackSeconds: 3, tnConnectedTurnSeconds: 20 } });
    await new Promise<void>((resolve) => {
      ps.httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (ps.httpServer.address() as AddressInfo).port;

    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    const bidder = await simpleAuctionToTrumpSetup(seats);
    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll(seats);
    await pollUntil(() => latestOf(seats[0]!.log)!.phase === "PLAYING", 6000, "playing");

    const actingBefore = latestOf(seats[0]!.log)!.actingSeatIndex!;
    const actingSeat = seats.find((s) => s.seatIndex === actingBefore)!;

    // Disconnect active player
    actingSeat.socket.disconnect();
    await sleep(200);

    // Reconnect on new socket before 3s window expires
    const re = connect();
    const reLog = recorder(re);
    const ack = await emitAck(re, "RECONNECT", { sessionToken: actingSeat.token });
    expect(ack.ok).toBe(true);
    expect(ack.seatIndex).toBe(actingBefore);

    // Verify player is connected and can play manually
    await pollUntil(() => reLog.some((e) => e.ev === "YOUR_TN_HAND"), 4000, "hand received");
    const hand = (reLog.find((e) => e.ev === "YOUR_TN_HAND")!.data as { cards: TnCard[] }).cards;
    expect(hand).toHaveLength(8);

    re.emit("GAME29_PLAY_CARD", { card: hand[0]! });

    const observer = seats.find((s) => s.seatIndex !== actingBefore)!;
    await pollUntil(
      () => latestOf(observer.log)!.trick.length === 1 && latestOf(observer.log)!.actingSeatIndex !== actingBefore,
      6000,
      "manual play accepted"
    );

    re.disconnect();
  }, 25000);

  it("connected inactive player: active turn timeout executes fallback after inactivity window", async () => {
    ps.close();
    // 1 second connected turn timeout
    ps = createPokerServer({ limits: { ...BASE_LIMITS, tnOfflineFallbackSeconds: 10, tnConnectedTurnSeconds: 1 } });
    await new Promise<void>((resolve) => {
      ps.httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (ps.httpServer.address() as AddressInfo).port;

    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");
    const bidder = await simpleAuctionToTrumpSetup(seats);
    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll(seats);
    await pollUntil(() => latestOf(seats[0]!.log)!.phase === "PLAYING", 6000, "playing");

    const actingBefore = latestOf(seats[0]!.log)!.actingSeatIndex!;
    // Player remains connected but does NOT send any move
    const observer = seats.find((s) => s.seatIndex !== actingBefore)!;
    await pollUntil(
      () => latestOf(observer.log)!.trick.length === 1 || latestOf(observer.log)!.actingSeatIndex !== actingBefore,
      6000,
      "inactivity fallback executed"
    );

    const st = latestOf(observer.log)!;
    expect(st.actingSeatIndex).not.toBe(actingBefore);
    expect(st.trick.some((p) => p.seatIndex === actingBefore)).toBe(true);
  }, 25000);

  it("missed batch delivery when offline: syncHandDeliveries preserves unreached batch and restores on reconnect", async () => {
    ps.close();
    ps = createPokerServer({ limits: { ...BASE_LIMITS, tnOfflineFallbackSeconds: 1 } });
    await new Promise<void>((resolve) => {
      ps.httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (ps.httpServer.address() as AddressInfo).port;

    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");

    // Seat 3 disconnects during bidding
    const seat3 = seats[3]!;
    seat3.socket.disconnect();

    // Remaining players complete bidding and declare trump (which deals batch 2)
    const bidder = await simpleAuctionToTrumpSetup(seats.slice(0, 3));
    seats.find((s) => s.seatIndex === bidder)!.socket.emit("GAME29_DECLARE_TRUMP", { choice: "JOKER" });
    await skipSingleHandForAll(seats.slice(0, 3));

    // Seat 3 reconnects
    const re = connect();
    const reLog = recorder(re);
    const ack = await emitAck(re, "RECONNECT", { sessionToken: seat3.token });
    expect(ack.ok).toBe(true);
    expect(ack.seatIndex).toBe(3);

    // Full 8 cards must be delivered via FULL_RECONNECT snapshot
    await pollUntil(() => reLog.some((e) => e.ev === "YOUR_TN_HAND"), 5000, "cards received on reconnect");
    const hand = (reLog.find((e) => e.ev === "YOUR_TN_HAND")!.data as { cards: TnCard[] }).cards;
    expect(hand).toHaveLength(8);

    re.disconnect();
  }, 25000);

  it("rapid disconnect and reconnect race: room remains stable, seat restored, single action resolved", async () => {
    const { seats } = await makeTnRoom(false);
    await waitFor(seats[0]!, () => latestOf(seats[0]!.log), (st) => st.phase === "BIDDING");

    const victim = seats[1]!;
    // Rapidly disconnect and reconnect 3 times in a row
    for (let cycle = 0; cycle < 3; cycle++) {
      victim.socket.disconnect();
      await sleep(30);
      const re = connect();
      const reLog = recorder(re);
      const ack = await emitAck(re, "RECONNECT", { sessionToken: victim.token });
      expect(ack.ok).toBe(true);
      expect(ack.seatIndex).toBe(1);
      victim.socket = re;
      victim.log = reLog;
    }

    // Verify room is still alive and in BIDDING
    const st = latestOf(victim.log)!;
    expect(st.phase).toBe("BIDDING");
    expect(st.seats[1]!.status).toBe("SEATED");
  }, 25000);
});

describe("twenty-nine: full match playthrough", () => {
  it(
    "multiple hands incl. a forced redeal: dealer rotation, score accumulation, match finish",
    async () => {
      const { seats, code } = await makeTnRoom(false);
      type MatchProbe = {
        roundsToWin: number;
        dealerSeatIndex: number;
        matchScore: { A: number; B: number };
      };
      const probe = () =>
        (ps.registry.get(code)! as unknown as { match: MatchProbe }).match;
      probe().roundsToWin = 2; // test-only seam: keep the match short

      const dealerByRound = new Map<number, number>();
      let sawRedeal = false;
      const deadline = Date.now() + 240000;

      for (;;) {
        if (Date.now() > deadline) throw new Error("match playthrough timed out");
        const st = latestOf(seats[0]!.log);
        if (!st) {
          await sleep(50);
          continue;
        }
        if (st.roundNumber >= 1 && st.dealerSeatIndex !== null) {
          dealerByRound.set(st.roundNumber, st.dealerSeatIndex);
        }
        if (st.phase === "MATCH_OVER") break;

        if (st.phase === "REDEALING") {
          sawRedeal = true;
          await sleep(100);
          continue;
        }
        if (st.phase === "BIDDING" && st.roundNumber === 2 && !sawRedeal) {
          // Force the all-pass path exactly once: pass on every turn.
          const turn = st.bids?.turnSeatIndex;
          const s = seats.find((x) => x.seatIndex === turn);
          if (s) {
            s.socket.emit("GAME29_BID", {});
            await sleep(120);
          } else {
            await sleep(40);
          }
          continue;
        }
        if (st.phase === "BIDDING" || st.phase === "TRUMP_SETUP" || st.phase === "PLAYING") {
          try {
            await playFullHand(seats.map((seat) => ({ seat, spent: new Set<string>() })));
          } catch (err) {
            if (!/redealt/.test((err as Error).message)) throw err;
          }
          continue;
        }
        await sleep(80); // ROUND_SCORED etc. — auto-start fires shortly
      }

      // --- match outcome ---
      const finished = seats[0]!.log.find((e) => e.ev === "TN_MATCH_FINISHED");
      expect(finished).toBeDefined();
      const { winnerTeam, finalScore } = finished!.data as {
        winnerTeam: "A" | "B";
        finalScore: { A: number; B: number };
      };
      const loser = winnerTeam === "A" ? "B" : "A";
      expect(finalScore[winnerTeam] >= 2 || finalScore[loser] <= -2).toBe(true);
      expect(probe().matchScore[winnerTeam]).toBe(finalScore[winnerTeam]);
      expect(sawRedeal).toBe(true);

      // --- dealer rotation across rounds ---
      // Round 1 completed -> round 2 advances the button. Round 2 was the
      // forced all-pass redeal -> round 3 keeps the SAME dealer. Completed
      // rounds afterwards advance again.
      const rounds = [...dealerByRound.keys()].sort((a, b) => a - b);
      expect(rounds[0]).toBe(1);
      expect(dealerByRound.get(2)).toBe(tnNext(dealerByRound.get(1)!));
      expect(dealerByRound.get(3)).toBe(dealerByRound.get(2));
      for (let i = 3; i < rounds.length; i++) {
        expect(dealerByRound.get(rounds[i]!)).toBe(tnNext(dealerByRound.get(rounds[i - 1]!)!));
      }
    },
    300000
  );
});

describe("twenty-nine: lobby seat lifecycle & host seat management", () => {
  it("1. player leaves lobby -> seat immediately FREE and available", async () => {
    const creator = connect();
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    expect(ack.ok).toBe(true);
    const roomCode = ack.roomCode!;

    const p2 = connect();
    const join2 = await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });
    expect(join2.ok).toBe(true);

    const room = ps.registry.get(roomCode) as TwentyNineGameManager;
    expect(room.match.seats[1]!.username).toBe("Player2");

    // Player 2 leaves lobby voluntarily
    p2.emit("LEAVE_ROOM");
    await new Promise((r) => setTimeout(r, 100));

    expect(room.match.seats[1]!.username).toBeNull();
    expect(room.publicState().seats[1]!.status).toBe("EMPTY");

    creator.disconnect();
    p2.disconnect();
  });

  it("2. player disconnects in lobby -> seat immediately FREE without waiting grace period", async () => {
    const creator = connect();
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    const roomCode = ack.roomCode!;

    const p2 = connect();
    await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });

    const room = ps.registry.get(roomCode) as TwentyNineGameManager;
    expect(room.match.seats[1]!.username).toBe("Player2");

    // Player 2 drops connection in lobby
    p2.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    expect(room.match.seats[1]!.username).toBeNull();
    expect(room.publicState().seats[1]!.status).toBe("EMPTY");

    creator.disconnect();
  });

  it("3. another player can immediately occupy the seat freed by disconnect", async () => {
    const creator = connect();
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    const roomCode = ack.roomCode!;

    const p2 = connect();
    await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });
    p2.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const p3 = connect();
    const join3 = await emitAck(p3, "JOIN_ROOM", { roomCode, username: "Player3" });
    expect(join3.ok).toBe(true);
    expect(join3.seatIndex).toBe(1);

    const room = ps.registry.get(roomCode) as TwentyNineGameManager;
    expect(room.match.seats[1]!.username).toBe("Player3");

    creator.disconnect();
    p3.disconnect();
  });

  it("4. disconnected player can rejoin using the same room code into available seat", async () => {
    const creator = connect();
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    const roomCode = ack.roomCode!;

    const p2 = connect();
    await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });
    p2.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const p2Re = connect();
    const joinRe = await emitAck(p2Re, "JOIN_ROOM", { roomCode, username: "Player2" });
    expect(joinRe.ok).toBe(true);
    expect(joinRe.seatIndex).toBe(1);

    creator.disconnect();
    p2Re.disconnect();
  });

  it("5. host can remove a player from the lobby", async () => {
    const creator = connect();
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    const roomCode = ack.roomCode!;

    const p2 = connect();
    const p2Log = recorder(p2);
    await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });

    const room = ps.registry.get(roomCode) as TwentyNineGameManager;
    expect(room.match.seats[1]!.username).toBe("Player2");

    creator.emit("REMOVE_PLAYER", { targetSeatIndex: 1 });
    await pollUntil(() => p2Log.some((e) => e.ev === "PLAYER_REMOVED"), 4000, "player removed");

    expect(room.match.seats[1]!.username).toBeNull();
    expect(room.publicState().seats[1]!.status).toBe("EMPTY");

    creator.disconnect();
    p2.disconnect();
  });

  it("6. non-host cannot remove another player", async () => {
    const creator = connect();
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    const roomCode = ack.roomCode!;

    const p2 = connect();
    const p2Log = recorder(p2);
    await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });

    const p3 = connect();
    await emitAck(p3, "JOIN_ROOM", { roomCode, username: "Player3" });

    p2.emit("REMOVE_PLAYER", { targetSeatIndex: 2 });
    await pollUntil(() => p2Log.some((e) => e.ev === "ACTION_REJECTED"), 4000, "action rejected");

    const room = ps.registry.get(roomCode) as TwentyNineGameManager;
    expect(room.match.seats[2]!.username).toBe("Player3");

    creator.disconnect();
    p2.disconnect();
    p3.disconnect();
  });

  it("7. host cannot remove themselves", async () => {
    const creator = connect();
    const creatorLog = recorder(creator);
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    const roomCode = ack.roomCode!;

    creator.emit("REMOVE_PLAYER", { targetSeatIndex: 0 });
    await pollUntil(() => creatorLog.some((e) => e.ev === "ACTION_REJECTED"), 4000, "action rejected");

    const room = ps.registry.get(roomCode) as TwentyNineGameManager;
    expect(room.match.seats[0]!.username).toBe("HostPlayer");

    creator.disconnect();
  });

  it("8. host remains host after another player leaves lobby", async () => {
    const creator = connect();
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    const roomCode = ack.roomCode!;

    const p2 = connect();
    await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });
    p2.emit("LEAVE_ROOM");
    await new Promise((r) => setTimeout(r, 100));

    const room = ps.registry.get(roomCode) as TwentyNineGameManager;
    expect(room.hostSeatIndex()).toBe(0);
    expect(room.publicState().hostSeatIndex).toBe(0);

    creator.disconnect();
    p2.disconnect();
  });

  it("9. rapid lobby disconnect/reconnect race condition", async () => {
    const creator = connect();
    const ack = await emitAck(creator, "CREATE_ROOM", {
      username: "HostPlayer",
      gameType: "TWENTY_NINE",
      startingCoins: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 15,
    });
    const roomCode = ack.roomCode!;

    const p2 = connect();
    await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });
    p2.disconnect();

    const p2New = connect();
    const rejoin = await emitAck(p2New, "JOIN_ROOM", { roomCode, username: "Player2" });
    expect(rejoin.ok).toBe(true);

    const room = ps.registry.get(roomCode) as TwentyNineGameManager;
    expect(room.match.seats[1]!.username).toBe("Player2");

    creator.disconnect();
    p2New.disconnect();
  });

  describe("host player removal, presence & monotonic fallback safeguards", () => {
    it("host removes a player in the lobby, immediately freeing the seat", async () => {
      const host = connect();
      const hostAck = await emitAck(host, "CREATE_ROOM", {
        username: "HostAlice",
        gameType: "TWENTY_NINE",
        startingCoins: 1000,
      });
      const roomCode = hostAck.roomCode!;

      const p2 = connect();
      const p2Logs = recorder(p2);
      await emitAck(p2, "JOIN_ROOM", { roomCode, username: "PlayerBob" });

      const room = ps.registry.get(roomCode) as TwentyNineGameManager;
      expect(room.match.seats[1]?.username).toBe("PlayerBob");

      // Host removes PlayerBob (seat 1)
      host.emit("REMOVE_PLAYER", { targetSeatIndex: 1 });
      await sleep(100);

      // Seat 1 is now free
      expect(room.match.seats[1]?.username).toBeNull();

      // Target player received PLAYER_REMOVED
      const removedEvent = p2Logs.find((e) => e.ev === "PLAYER_REMOVED");
      expect(removedEvent).toBeDefined();

      // Another player can now take seat 1
      const p3 = connect();
      const p3Ack = await emitAck(p3, "JOIN_ROOM", { roomCode, username: "PlayerCharlie" });
      expect(p3Ack.ok).toBe(true);
      expect(p3Ack.seatIndex).toBe(1);

      host.disconnect();
      p2.disconnect();
      p3.disconnect();
    });

    it("host removes a player during an active hand: converted to bot, bot acts and game continues", async () => {
      const sockets = [connect(), connect(), connect(), connect()];
      const hostAck = await emitAck(sockets[0]!, "CREATE_ROOM", {
        username: "Host1",
        gameType: "TWENTY_NINE",
        startingCoins: 1000,
      });
      const roomCode = hostAck.roomCode!;

      for (let i = 1; i < 4; i++) {
        await emitAck(sockets[i]!, "JOIN_ROOM", { roomCode, username: `Player${i + 1}` });
      }

      const room = ps.registry.get(roomCode) as TwentyNineGameManager;
      // Wait for hand to start
      await sleep(400);
      expect(room.match.phase).toBe("BIDDING");

      // Host removes Player 2 (seat 1) during active bidding
      sockets[0]!.emit("REMOVE_PLAYER", { targetSeatIndex: 1 });
      await sleep(150);

      // Seat 1 is converted to a bot
      expect(room.match.seats[1]?.isBot).toBe(true);
      expect(room.match.seats[1]?.connected).toBe(true);

      // If it is bot's turn to bid, bot will automatically act
      if (room.match.actingSeatIndex === 1) {
        await sleep(400);
        expect(room.match.actingSeatIndex).not.toBe(1);
      }

      for (const s of sockets) s.disconnect();
    });

    it("non-host cannot remove players and host cannot remove self", async () => {
      const host = connect();
      const hostAck = await emitAck(host, "CREATE_ROOM", {
        username: "HostAlpha",
        gameType: "TWENTY_NINE",
        startingCoins: 1000,
      });
      const roomCode = hostAck.roomCode!;

      const p2 = connect();
      const p2Logs = recorder(p2);
      await emitAck(p2, "JOIN_ROOM", { roomCode, username: "GuestBeta" });

      const hostLogs = recorder(host);

      // Non-host attempts to remove host
      p2.emit("REMOVE_PLAYER", { targetSeatIndex: 0 });
      await sleep(100);
      const rejNonHost = p2Logs.find((e) => e.ev === "ACTION_REJECTED");
      expect(rejNonHost).toBeDefined();

      // Host attempts to remove self
      host.emit("REMOVE_PLAYER", { targetSeatIndex: 0 });
      await sleep(100);
      const rejHostSelf = hostLogs.find((e) => e.ev === "ACTION_REJECTED");
      expect(rejHostSelf).toBeDefined();

      host.disconnect();
      p2.disconnect();
    });

    it("stale socket in socketIds is pruned when client rejoins with same username", async () => {
      const host = connect();
      const hostAck = await emitAck(host, "CREATE_ROOM", {
        username: "Host1",
        gameType: "TWENTY_NINE",
        startingCoins: 1000,
      });
      const roomCode = hostAck.roomCode!;

      const p2 = connect();
      await emitAck(p2, "JOIN_ROOM", { roomCode, username: "Player2" });

      const room = ps.registry.get(roomCode) as TwentyNineGameManager;
      const rec = [...room["players"].values()].find((p) => p.username === "Player2")!;
      expect(rec.socketIds.size).toBe(1);

      // Simulate dead socket: inject a fake dead socket ID into rec.socketIds
      rec.socketIds.add("dead-socket-xyz-999");
      expect(rec.socketIds.size).toBe(2);

      // Disconnect p2 (real socket)
      p2.disconnect();
      await sleep(50);

      // Now rec.socketIds still has "dead-socket-xyz-999" (simulating unannounced drop)
      expect(rec.socketIds.has("dead-socket-xyz-999")).toBe(true);

      // Client connects with new socket and rejoins using same roomCode + username "Player2"
      const p2New = connect();
      const rejoin = await emitAck(p2New, "JOIN_ROOM", { roomCode, username: "Player2" });
      expect(rejoin.ok).toBe(true);
      expect(rejoin.seatIndex).toBe(1);

      // Stale socket was pruned, new socket attached
      expect(rec.socketIds.has("dead-socket-xyz-999")).toBe(false);
      expect(rec.socketIds.has(p2New.id!)).toBe(true);

      host.disconnect();
      p2New.disconnect();
    });

    it("old socket disconnect event arriving after new socket attaches does not disconnect the new socket", async () => {
      const host = connect();
      const hostAck = await emitAck(host, "CREATE_ROOM", {
        username: "Host1",
        gameType: "TWENTY_NINE",
        startingCoins: 1000,
      });
      const roomCode = hostAck.roomCode!;

      const s1 = connect();
      const s1Ack = await emitAck(s1, "JOIN_ROOM", { roomCode, username: "MultiTabUser" });
      expect(s1Ack.ok).toBe(true);

      const room = ps.registry.get(roomCode) as TwentyNineGameManager;
      const rec = [...room["players"].values()].find((p) => p.username === "MultiTabUser")!;
      expect(rec.socketIds.size).toBe(1);

      // S2 connects and attaches with sessionToken
      const s2 = connect();
      const s2Ack = await emitAck(s2, "RECONNECT", { sessionToken: s1Ack.sessionToken! });
      expect(s2Ack.ok).toBe(true);
      expect(rec.socketIds.size).toBe(2);

      // Now S1 disconnects later
      s1.disconnect();
      await sleep(100);

      // S2 is still attached and player is still connected
      expect(rec.socketIds.size).toBe(1);
      expect(rec.socketIds.has(s2.id!)).toBe(true);
      expect(room.match.seats[1]?.connected).toBe(true);

      host.disconnect();
      s2.disconnect();
    });

    it("multiple broadcasts during an active turn do not reset the monotonic fallback deadline", async () => {
      const sockets = [connect(), connect(), connect(), connect()];
      const hostAck = await emitAck(sockets[0]!, "CREATE_ROOM", {
        username: "Host1",
        gameType: "TWENTY_NINE",
        startingCoins: 1000,
      });
      const roomCode = hostAck.roomCode!;

      for (let i = 1; i < 4; i++) {
        await emitAck(sockets[i]!, "JOIN_ROOM", { roomCode, username: `Player${i + 1}` });
      }

      const room = ps.registry.get(roomCode) as TwentyNineGameManager;
      await sleep(400);
      expect(room.match.phase).toBe("BIDDING");

      const initialDeadline = room["fallbackDeadline"];
      expect(initialDeadline).toBeGreaterThan(0);

      // Trigger multiple intermediate broadcasts / syncs
      room.broadcastState();
      room.broadcastState();
      room.broadcastState();

      // Deadline must remain identical (not pushed into the future)
      expect(room["fallbackDeadline"]).toBe(initialDeadline);

      for (const s of sockets) s.disconnect();
    });
  });
});
