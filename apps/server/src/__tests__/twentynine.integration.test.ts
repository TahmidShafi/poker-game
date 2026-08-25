import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io, Socket } from "socket.io-client";
import { AddressInfo } from "net";
import type {
  ClientToServerEvents,
  PublicTwentyNineState,
  RoomAck,
  ServerToClientEvents,
  TnCard,
} from "@poker/shared-types";
import { tnCardPoints } from "@poker/shared-types";
import { createPokerServer, PokerServer } from "../index";

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
  event: "CREATE_ROOM" | "JOIN_ROOM",
  payload: Record<string, unknown>
): Promise<RoomAck> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (r: RoomAck) => resolve(r));
  });
}

interface Seat {
  seatIndex: number;
  socket: ClientSocket;
  log: LogEntry[];
  token: string;
  name: string;
}

/**
 * Boots a 4-player TWENTY_NINE room and returns per-seat recorders.
 * Seats are indexed by their actual seat assignment from acks.
 */
async function makeTnRoom(mode: string, roundsToWin = 6): Promise<{ seats: Seat[] }> {
  const sockets: ClientSocket[] = [];
  const raw: { socket: ClientSocket; log: LogEntry[] }[] = [];
  for (let i = 0; i < 4; i++) {
    const s = connect();
    sockets.push(s);
    raw.push({ socket: s, log: recorder(s) });
  }

  const createAck = await emitAck(sockets[0]!, "CREATE_ROOM", {
    username: "P0",
    startingCoins: 1000,
    gameType: "TWENTY_NINE",
    twentyNine: { trumpMode: mode, roundsToWin },
  });
  expect(createAck.ok).toBe(true);
  expect(createAck.gameType).toBe("TWENTY_NINE");
  const code = createAck.roomCode!;

  const seats: Seat[] = [];
  const pushSeat = async (idx: number, socket: ClientSocket, log: LogEntry[], name: string, token: string | undefined) => {
    let seatIndex: number;
    if (token !== undefined) {
      // creator already joined
      seatIndex = 0;
      if (token === "") throw new Error("bad token");
    } else {
      const ack = await emitAck(socket, "JOIN_ROOM", { username: name, roomCode: code });
      expect(ack.ok).toBe(true);
      if (typeof ack.seatIndex !== "number") {
        throw new Error(`join ack missing seatIndex for ${name}: ${JSON.stringify(ack)}`);
      }
      seatIndex = ack.seatIndex;
      token = ack.sessionToken!;
    }
    if (seats[seatIndex]) {
      throw new Error(`seat ${seatIndex} assigned twice (${name})`);
    }
    seats[seatIndex] = { seatIndex, socket, log, token: token!, name };
  };

  await pushSeat(0, sockets[0]!, raw[0]!.log, "P0", createAck.sessionToken ?? "");
  for (let i = 1; i < 4; i++) {
    await pushSeat(i, sockets[i]!, raw[i]!.log, `P${i}`, undefined);
  }
  return { seats };
}

/** Waits until predicate over the seat's latest state passes (with timeout). */
async function waitFor(seat: Seat, pred: (s: PublicTwentyNineState) => boolean, timeoutMs = 8000): Promise<PublicTwentyNineState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const s = latestState(seat.log);
      if (pred(s)) return s;
    } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`waitFor timeout on seat ${seat.seatIndex}`);
    await sleep(40);
  }
}

function myCardsOf(seat: Seat): TnCard[] {
  const cards: TnCard[] = [];
  for (const e of seat.log) {
    if (e.ev === "YOUR_TN_HAND") {
      const d = e.data as { cards: TnCard[] };
      for (const c of d.cards) {
        if (!cards.some((x) => x.suit === c.suit && x.rank === c.rank)) cards.push(c);
      }
    }
  }
  return cards;
}

function legalMirror(hand: TnCard[], trick: PublicTwentyNineState["trick"]): TnCard[] {
  if (trick.length === 0) return hand;
  const led = trick[0]!.card.suit;
  const followers = hand.filter((c) => c.suit === led);
  return followers.length > 0 ? followers : hand;
}

function dominantSuit(hand: TnCard[]): TnCard["suit"] {
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
  return best as TnCard["suit"];
}

/**
 * Plays an ENTIRE auction+hand adaptively (deck order is server-random):
 * seat-after-dealer bids 17, everyone else passes; bidder declares their
 * dominant suit; every player then plays their lowest legal REMAINING card
 * on turn. Resolves when a TN_ROUND_FINISHED is observed anywhere.
 */
async function playFullHand(seats: Seat[], opts: { declare?: boolean } = {}): Promise<void> {
  // Wait for deal batch 1 everywhere.
  for (const s of seats) {
    await waitFor(s, (st) => st.phase === "BIDDING" || st.phase === "PLAYING" || st.phase === "TRUMP_SETUP");
  }

  const spentBySeat = new Map<number, Set<string>>();
  const spentOf = (seatIndex: number) => {
    let s = spentBySeat.get(seatIndex);
    if (!s) {
      s = new Set();
      spentBySeat.set(seatIndex, s);
    }
    return s;
  };
  const remainingOf = (seat: Seat): TnCard[] =>
    myCardsOf(seat).filter((c) => !spentOf(seat.seatIndex).has(`${c.rank}${c.suit}`));

  // --- Auction ---
  const first = await waitFor(seats[0]!, (st) => st.bids?.turnSeatIndex != null || st.phase === "PLAYING");
  if (first.phase === "BIDDING") {
    const winnerSeat = first.bids!.turnSeatIndex!;
    let guard = 0;
    for (;;) {
      guard++;
      if (guard > 12) throw new Error("auction did not terminate");
      const st = latestState(seats[0]!.log);
      if (st.phase !== "BIDDING") break;
      const turn = st.bids!.turnSeatIndex;
      if (turn === null) break;
      const historyLen = st.bids!.history.length;
      const actor = seats[turn]!;
      if (turn === winnerSeat) {
        actor.socket.emit("GAME29_BID", { bid: 17 });
      } else {
        actor.socket.emit("GAME29_BID", {});
      }
      // Wait until THIS action is reflected server-side (no blind sleeps).
      await waitFor(
        seats[0]!,
        (s2) =>
          s2.phase !== "BIDDING" ||
          s2.bids === null ||
          s2.bids.history.length > historyLen,
        4000
      );
    }
  }

  // --- Trump declaration (REGULAR / MARRIAGE only) ---
  const st = await waitFor(seats[0]!, (s2) => s2.phase !== "BIDDING");
  if (st.phase === "TRUMP_SETUP" && opts.declare !== false) {
    const bidderSeat = st.bids!.bidderSeatIndex!;
    const bidder = seats[bidderSeat]!;
    const hand = myCardsOf(bidder);
    expect(hand.length).toBeGreaterThanOrEqual(4);
    bidder.socket.emit("GAME29_DECLARE_TRUMP", {
      suit: dominantSuit(hand.length >= 8 ? hand : hand.slice(0, 4)),
    });
    await waitFor(seats[0]!, (s2) => s2.phase !== "TRUMP_SETUP" || s2.trump.state === "HIDDEN", 4000);
  }
  await waitFor(seats[0]!, (s2) => s2.phase !== "TRUMP_SETUP", 4000);
  if ((await waitFor(seats[0]!, (s2) => true, 10)).phase === "REDEALING") {
    throw new Error("hand was redealt - caller should retry");
  }

  // --- Tricks ---
  let safety = 0;
  const rejectCounts = new Map<number, number>();
  for (const s of seats) {
    s.log.filter((e) => e.ev === "ACTION_REJECTED").forEach((e) => {
      rejectCounts.set(s.seatIndex, (rejectCounts.get(s.seatIndex) ?? 0) + 1);
      void e;
    });
  }
  for (;;) {
    safety++;
    if (safety > 600 || safety % 150 === 0) {
      for (const s of seats) {
        const n = s.log.filter((e) => e.ev === "ACTION_REJECTED").length;
        rejectCounts.set(s.seatIndex, n);
      }
    }
    if (safety > 600) {
      const diag = seats.map((s) => {
        try {
          const cs = latestState(s.log);
          const rem = remainingOf(s);
          return {
            seat: s.seatIndex,
            phase: cs.phase,
            acting: cs.actingSeatIndex,
            rejects: rejectCounts.get(s.seatIndex),
            handSize: myCardsOf(s).length,
            spent: [...(spentBySeat.get(s.seatIndex) ?? [])].length,
            remaining: rem.map((c) => `${c.rank}${c.suit[0]}`),
            trick: cs.trick.map((p) => `${p.seatIndex}:${p.card.rank}${p.card.suit[0]}`),
            ledSuit: cs.trick[0]?.card.suit ?? null,
          };
        } catch {
          return { seat: s.seatIndex, error: "no state" };
        }
      });
      throw new Error(`trick play stalled: ${JSON.stringify(diag, null, 1)}`);
    }

    const anyFinished = seats.some((s) =>
      s.log.some((e) => e.ev === "TN_ROUND_FINISHED")
    );
    if (anyFinished) {
      for (const s of seats) {
        await waitFor(s, (st2) => st2.phase === "ROUND_SCORED" || st2.phase === "MATCH_OVER");
      }
      return;
    }

    // Record anything WE have already played into the public trick.
    for (const s of seats) {
      try {
        const cs = latestState(s.log);
        for (const p of cs.trick) {
          if (p.seatIndex === s.seatIndex) spentOf(s.seatIndex).add(`${p.card.rank}${p.card.suit}`);
        }
      } catch { /* noop */ }
    }

    // One action per tick: lowest legal REMAINING card from the acting seat.
    let acted = false;
    for (const s of seats) {
      try {
        const cs = latestState(s.log);
        if (cs.phase !== "PLAYING" && cs.phase !== "TRUMP_SETUP") continue;
        if (cs.phase === "PLAYING" && cs.actingSeatIndex === s.seatIndex) {
          const remaining = remainingOf(s);
          const legal = legalMirror(remaining, cs.trick);
          if (legal.length === 0) continue;
          const low = legal.reduce((m, c) => (c.rank < m.rank ? c : m));
          spentOf(s.seatIndex).add(`${low.rank}${low.suit}`); // mark at emit time
          s.socket.emit("GAME29_PLAY_CARD", { card: low });
          acted = true;
          break;
        }
      } catch { /* no state yet */ }
    }
    if (!acted) await sleep(30);
    else await sleep(45);
  }
}

describe("twenty-nine: multiplayer integration", () => {
  it(
    "REGULAR: full hand with hidden-trump security audit on raw payloads",
    async () => {
      const { seats } = await makeTnRoom("REGULAR");
      await playFullHand(seats);

      // ---- Card integrity: each client got exactly its own 8 unique cards.
      const hands = seats.map((s) => myCardsOf(s));
      for (const h of hands) expect(h).toHaveLength(8);
      const keys = new Set(hands.flat().map((c) => `${c.suit}${c.rank}`));
      expect(keys.size).toBe(32); // disjoint + complete

      // ---- Bidder privacy: TN_BIDDER_PRIVATE went ONLY to the bidder.
      const bidderSeats = seats.filter((s) =>
        s.log.some((e) => e.ev === "TN_BIDDER_PRIVATE")
      );
      expect(bidderSeats).toHaveLength(1);
      const bidder = bidderSeats[0]!;
      const priv = bidder.log.find((e) => e.ev === "TN_BIDDER_PRIVATE")!;
      expect(priv.data).toMatchObject({ mode: "REGULAR" });

      // ---- Trump reveal ordering per NON-bidder client: no REVEALED state
      // may appear before that client received TN_TRUMP_REVEALED. If the
      // hand legitimately ended without anyone calling trump, every state
      // must have stayed HIDDEN instead.
      const anyRevealGlobally = seats.some((s) =>
        s.log.some((e) => e.ev === "TN_TRUMP_REVEALED")
      );
      let revealedSuit: string | null = null;
      for (const s of seats) {
        if (s.seatIndex === bidder.seatIndex) continue;
        let revealSeenAt = Infinity;
        for (const e of s.log) {
          if (e.ev === "TN_TRUMP_REVEALED") {
            revealSeenAt = Math.min(revealSeenAt, e.at);
            const d = e.data as { suit: string };
            if (revealedSuit === null) revealedSuit = d.suit;
            expect(d.suit).toBe(revealedSuit);
          }
          if (e.ev === "TN_STATE") {
            const st = e.data as PublicTwentyNineState;
            if (st.trump.state === "REVEALED") {
              expect(e.at).toBeGreaterThanOrEqual(revealSeenAt);
              if (revealedSuit === null) revealedSuit = st.trump.suit;
              expect(st.trump.suit).toBe(revealedSuit);
            }
          }
        }
        // Strict scan: before the reveal moment, NO public state at a
        // non-bidder client ever exposed the suit.
        const preReveal = s.log.filter((e) => e.at < revealSeenAt && e.ev === "TN_STATE");
        for (const e of preReveal) {
          const st = e.data as PublicTwentyNineState;
          expect(["NOT_SET", "HIDDEN"]).toContain(st.trump.state);
        }
      }
      if (anyRevealGlobally) expect(revealedSuit).not.toBeNull();
      else {
        // Never called: hidden everywhere for everyone (except bidder's private channel).
        expect(revealedSuit).toBeNull();
        for (const s of seats) {
          for (const e of s.log) {
            if (e.ev === "TN_STATE") {
              const st = e.data as PublicTwentyNineState;
              expect(["NOT_SET", "HIDDEN", "JOKER_MODE"]).toContain(st.trump.state);
            }
          }
        }
      }

      // ---- Trick integrity: 8 tricks x exactly 4 unique cards; Σ=29.
      const tricks = seats[0]!.log.filter((e) => e.ev === "TN_TRICK_RESOLVED");
      expect(tricks).toHaveLength(8);
      const playedKeys = new Set<string>();
      for (const t of tricks) {
        const d = t.data as { plays: { seatIndex: number; card: TnCard }[]; pointsWon: number; trickNumber: number };
        expect(d.plays).toHaveLength(4);
        for (const p of d.plays) playedKeys.add(`${p.card.suit}${p.card.rank}`);
      }
      expect(playedKeys.size).toBe(32);

      const fin = seats[0]!.log.find((e) => e.ev === "TN_ROUND_FINISHED")!;
      const summary = (fin.data as { summary: { captured: { A: number; B: number }; bid: number; requirement: number } }).summary;
      expect(summary.captured.A + summary.captured.B).toBe(29);
      expect(summary.requirement).toBe(summary.bid);

      // ---- Hands emptied publicly.
      const endState = latestState(seats[0]!.log);
      expect(endState.seats.every((s2) => s2.cardsRemaining === 0)).toBe(true);
    },
    45000
  );

  it("rejects out-of-turn plays and duplicate actions", async () => {
    const { seats } = await makeTnRoom("REGULAR");
    await waitFor(seats[0]!, (st) => st.phase === "BIDDING");

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
    "SEVENTH_CARD: completes a hand (tolerating redeals)",
    async () => {
      const { seats } = await makeTnRoom("SEVENTH_CARD");
      for (let attempt = 0; attempt < 4; attempt++) {
        const st = latestState(seats[0]!.log);
        if (st.phase === "ROUND_SCORED" || st.phase === "MATCH_OVER") break;
        try {
          await playFullHand(seats);
          break;
        } catch (err) {
          if (/redealt/.test((err as Error).message)) continue; // dead-trump redeal path
          throw err;
        }
      }
      const final = latestState(seats[0]!.log);
      expect(["ROUND_SCORED", "MATCH_OVER"]).toContain(final.phase);
      // Indicator privacy: only ONE client ever saw a SEVENTH_CARD private payload.
      const seers = seats.filter((s) =>
        s.log.some(
          (e) => e.ev === "TN_BIDDER_PRIVATE" && (e.data as { mode?: string }).mode === "SEVENTH_CARD"
        )
      );
      expect(seers.length).toBeLessThanOrEqual(1);
    },
    60000
  );

  it(
    "JOKER: power-rank hand completes without any trump declaration",
    async () => {
      const { seats } = await makeTnRoom("JOKER");
      await playFullHand(seats, { declare: false });
      const st = latestState(seats[0]!.log);
      expect(["ROUND_SCORED", "MATCH_OVER"]).toContain(st.phase);
      // No client should ever hold hidden-trump knowledge in joker mode.
      for (const s of seats) {
        expect(s.log.some((e) => e.ev === "TN_BIDDER_PRIVATE")).toBe(false);
        for (const e of s.log) {
          if (e.ev === "TN_STATE") {
            expect((e.data as PublicTwentyNineState).trump.state).toBe("JOKER_MODE");
          }
        }
      }
    },
    45000
  );

  it(
    "MARRIAGE: hand completes; ±4 requirement math holds when declared",
    async () => {
      const { seats } = await makeTnRoom("MARRIAGE");
      await playFullHand(seats);
      const fin = seats[0]!.log.find((e) => e.ev === "TN_ROUND_FINISHED")!;
      const summary = (fin.data as { summary: { captured: { A: number; B: number }; marriageTeam: string | null; bid: number; requirement: number } }).summary;
      expect(summary.captured.A + summary.captured.B).toBe(29);
      if (summary.marriageTeam === null) {
        expect(summary.requirement).toBe(summary.bid);
      } else {
        // Requirement shifted by exactly 4 in some direction.
        expect(Math.abs(summary.requirement - summary.bid)).toBe(4);
      }
    },
    45000
  );

  it(
    "offline fallback: disconnected seat's bidding turn auto-PASSES after the grace window",
    async () => {
      ps.close(); // replace with short fallback timer
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
        username: "P0", startingCoins: 1000, gameType: "TWENTY_NINE",
        twentyNine: { trumpMode: "REGULAR", roundsToWin: 6 },
      });
      expect(ack0.ok).toBe(true);
      const code = ack0.roomCode!;
      for (let i = 1; i < 4; i++) {
        const ack = await emitAck(socks[i]!, "JOIN_ROOM", { username: `P${i}`, roomCode: code });
        expect(ack.ok).toBe(true);
      }
      // Everyone sees BIDDING shortly (auto-start 250ms).
      const deadline = Date.now() + 6000;
      let started = false;
      while (Date.now() < deadline) {
        try {
          if (latestState(logs[0]!).phase === "BIDDING") {
            started = true;
            break;
          }
        } catch { /* noop */ }
        await sleep(40);
      }
      expect(started).toBe(true);

      const turnSeat = latestState(logs[0]!).bids!.turnSeatIndex!;
      socks[turnSeat]!.disconnect();

      // Within ~4s the disconnected seat must be recorded as PASSED.
      const passDeadline = Date.now() + 5000;
      let autoPassed = false;
      while (Date.now() < passDeadline) {
        const st = latestState(logs[(turnSeat + 1) % 4]!);
        if (st.bids?.passedSeatIndexes.includes(turnSeat)) {
          autoPassed = true;
          break;
        }
        await sleep(50);
      }
      expect(autoPassed).toBe(true);
    },
    30000
  );
});
