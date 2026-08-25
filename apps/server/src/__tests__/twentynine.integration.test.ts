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
  isBot?: boolean;
}

/**
 * Boots a 4-player TWENTY_NINE room (no settings — integrated mechanics) and
 * returns per-seat recorders indexed by actual seat assignment.
 */
async function makeTnRoom(vsBots = false): Promise<{ seats: Seat[] }> {
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
  return { seats };
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
      if (teamOf(turn) === teamOf(bids.bidderSeatIndex!)) {
        v = Math.max(16, H + 1);
      } else {
        const priorMatches = bids.history.filter((h) => h.bid === H).length;
        v = priorMatches === 1 ? H : H + 1;
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
      const hand = myCardsOf(me.seat);
      const choice =
        opts.trumpChoice ?? dominantSuit(hand.length >= 8 ? hand : hand.slice(0, 4));
      me.seat.socket.emit("GAME29_DECLARE_TRUMP", { choice });
    }
  }
  await waitFor(null, () => latestOf(anyLog()), (s2) => s2.phase !== "TRUMP_SETUP", 5000);
  if (latestOf(anyLog())!.phase === "REDEALING") {
    throw new Error("hand was redealt - caller should retry");
  }

  // --- Tricks ---
  let safety = 0;
  const playDeadline = Date.now() + 120000;
  for (;;) {
    safety++;
    if (Date.now() > playDeadline) throw new Error("trick play did not terminate");

    const finished = humans.some((h) => h.seat.log.some((e) => e.ev === "TN_ROUND_FINISHED"));
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
      const remaining = myCardsOf(h.seat).filter((c) => !h.spent.has(`${c.rank}${c.suit}`));
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

      // ---- Trick integrity: 8 tricks x 4 unique cards; Σ=29.
      const tricks = seats[0]!.log.filter((e) => e.ev === "TN_TRICK_RESOLVED");
      expect(tricks).toHaveLength(8);
      const playedKeys = new Set<string>();
      for (const t of tricks) {
        const d = t.data as { plays: { card: TnCard }[] };
        expect(d.plays).toHaveLength(4);
        for (const p of d.plays) playedKeys.add(`${p.card.suit}${p.card.rank}`);
      }
      expect(playedKeys.size).toBe(32);

      const fin = seats[0]!.log.find((e) => e.ev === "TN_ROUND_FINISHED")!;
      const summary = (fin.data as { summary: { captured: { A: number; B: number }; requirement: number; bid: number } }).summary;
      expect(summary.captured.A + summary.captured.B).toBe(29);

      const endState = latestState(seats[0]!.log);
      expect(endState.seats.every((s2) => s2.cardsRemaining === 0)).toBe(true);
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
            expect(["NOT_SET", "JOKER_MODE"]).toContain(tv);
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
      expect(summary.captured.A + summary.captured.B).toBe(29);
      if (summary.marriageTeam === null) expect(summary.requirement).toBe(summary.bid);
      else expect(Math.abs(summary.requirement - summary.bid)).toBe(4);
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
      expect(tricks).toHaveLength(8);
    },
    90000
  );
});
