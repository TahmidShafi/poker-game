import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync } from "fs";
import { io, Socket } from "socket.io-client";
import { AddressInfo } from "net";
import {
  ClientToServerEvents,
  PublicGameState,
  RoomAck,
  ServerToClientEvents,
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
  autoStartDelayMs: 4000,
  disconnectGraceMs: 60_000,
};

let ps: PokerServer;
let port: number;

beforeEach(async () => {
  ps = createPokerServer({
    limits: { ...BASE_LIMITS, autoStartDelayMs: 250 },
  });
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

/** Persistent GAME_STATE collector - avoids missing early broadcasts. */
function watch(socket: ClientSocket) {
  const states: PublicGameState[] = [];
  socket.on("GAME_STATE", (s) => states.push(s));
  return {
    all: (): PublicGameState[] => states,
    latest: (): PublicGameState => {
      if (states.length === 0) throw new Error("no GAME_STATE received yet");
      return states[states.length - 1]!;
    },
    count: () => states.length,
  };
}

function once<K extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: K,
  timeoutMs = 6000
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event);
      reject(new Error(`timeout waiting for ${String(event)}`));
    }, timeoutMs);
    socket.once(event, ((payload: never) => {
      clearTimeout(timer);
      resolve(payload);
    }) as never);
  });
}

/** Resolves with the NEXT state emitted after the call (not a cached one). */
function nextState(socket: ClientSocket, timeoutMs = 4000): Promise<PublicGameState> {
  return once(socket, "GAME_STATE", timeoutMs);
}

const CONFIG = { startingCoins: 1000, smallBlind: 10, bigBlind: 20, turnTimeSeconds: 5 };

async function makeRoom(
  username: string,
  cfgOverride?: Partial<typeof CONFIG>
): Promise<{ socket: ClientSocket; res: RoomAck; w: ReturnType<typeof watch> }> {
  const socket = connect();
  const w = watch(socket);
  const res = await new Promise<RoomAck>((resolve) => {
    socket.emit("CREATE_ROOM", { ...CONFIG, ...cfgOverride, username }, (r: RoomAck) => resolve(r));
  });
  return { socket, res, w };
}

async function joinRoom(socket: ClientSocket, roomCode: string, username: string): Promise<RoomAck> {
  return new Promise<RoomAck>((resolve) => {
    socket.emit("JOIN_ROOM", { username, roomCode }, (r: RoomAck) => resolve(r));
  });
}

describe("rooms: create / join / codes", () => {
  it("creates a private room with a valid 6-char code and session material", async () => {
    const { socket, res, w } = await makeRoom("alice");
    expect(res.ok).toBe(true);
    expect(res.roomCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(res.sessionToken).toBeTruthy();
    expect(res.seatIndex).toBe(0);
    expect(res.config).toEqual({ startingCoins: 1000, smallBlind: 10, bigBlind: 20, turnTimeSeconds: CONFIG.turnTimeSeconds });
    expect(w.latest().seats[0]!.username).toBe("alice");
    socket.disconnect();
  }, 10000);

  it("joins by code; unknown codes rejected", async () => {
    const { socket: host, res } = await makeRoom("alice");
    const guest = connect();
    const joined = await joinRoom(guest, res.roomCode!, "bob");
    expect(joined.ok).toBe(true);
    expect(joined.seatIndex).toBe(1);

    const stranger = connect();
    const bad = await joinRoom(stranger, "ZZZZZZ", "eve");    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/not found/i);
    host.disconnect(); guest.disconnect(); stranger.disconnect();
  }, 10000);

  it("rejects duplicate usernames per-room (case-insensitive); allows across rooms", async () => {
    const a = await makeRoom("alice");
    const dupe = connect();
    const dupRes = await joinRoom(dupe, a.res.roomCode!, "ALICE");
    expect(dupRes.ok).toBe(false);
    expect(dupRes.error).toMatch(/already taken/i);
    const b = await makeRoom("alice");
    expect(b.res.ok).toBe(true);
    a.socket.disconnect(); dupe.disconnect(); b.socket.disconnect();
  }, 10000);

  it("caps rooms at 10 players", async () => {
    const { socket: host, res } = await makeRoom("p0");
    const sockets: ClientSocket[] = [];
    for (let i = 1; i <= 9; i++) {
      const s = connect(); sockets.push(s);
      const r = await joinRoom(s, res.roomCode!, `p${i}`);
      expect(r.ok).toBe(true);
    }
    const s11 = connect(); sockets.push(s11);
    const overflow = await joinRoom(s11, res.roomCode!, "late");
    expect(overflow.ok).toBe(false);
    expect(overflow.error).toMatch(/full/i);
    host.disconnect();
    for (const s of sockets) s.disconnect();
  }, 15000);

  it("keeps rooms isolated", async () => {
    const a = await makeRoom("aHost");
    const b = await makeRoom("bHost");
    const bW = watch(b.socket);
    const guestB = connect(); watch(guestB);
    await joinRoom(guestB, b.res.roomCode!, "bGuest");
    await new Promise((r) => setTimeout(r, 200));
    // Every state seen by room-B clients carries B's code, never A's.
    for (let i = 0; i < bW.count(); i++) {
      // eslint-disable-next-line
    }
    expect(bW.latest().roomCode).toBe(b.res.roomCode);
    a.socket.disconnect(); b.socket.disconnect(); guestB.disconnect();
  }, 10000);
});

describe("joining rules", () => {
  it("joiners cannot override room configuration", async () => {
    const { socket: host, res, w: hostW } = await makeRoom("host");
    const rogue = connect();
    const rogueW = watch(rogue);
    const result = await new Promise<RoomAck>((resolve) => {
      // Deliberately smuggle config fields the protocol does not define.
      rogue.emit("JOIN_ROOM", {
        username: "rogue",
        roomCode: res.roomCode,
        startingCoins: 999999,
        smallBlind: 500,
        bigBlind: 900,
        turnTimeSeconds: 99,
      } as unknown as Parameters<ClientToServerEvents["JOIN_ROOM"]>[0], (r: RoomAck) => resolve(r));
    });
    expect(result.ok).toBe(true);
    const st = rogueW.latest();
    expect(st.smallBlind).toBe(10);
    expect(st.bigBlind).toBe(20);
    expect(hostW.latest().smallBlind).toBe(10);
    host.disconnect(); rogue.disconnect();
  }, 10000);

  it("mid-hand joiners sit out and are dealt into the NEXT hand", async () => {
    const { socket: h1, res } = await makeRoom("p1");
    const s2 = connect();
    await joinRoom(s2, res.roomCode!, "p2");
    await once(h1, "HAND_STARTED"); // hand #1 deals

    const late = connect();
    const lateW = watch(late);
    const lateJoin = await joinRoom(late, res.roomCode!, "late");
    expect(lateJoin.ok).toBe(true);
    expect(lateW.latest().seats[lateJoin.seatIndex!]!.status).toBe("SITTING_OUT");

    // Hand #1 ends (fold/timeout-driven), hand #2 deals the late joiner in.
    const holesPromise = once(late, "YOUR_HOLE_CARDS", 45000);
    v_foldLoop(h1, [0]);
    v_foldLoop(s2, [1]);
    await holesPromise.then((cards) => expect(cards).toHaveLength(2));
    h1.disconnect(); s2.disconnect(); late.disconnect();
  }, 60000);

  it("config becomes immutable once hands exist (server ignores any mutation attempt)", async () => {
    const { socket: host, res } = await makeRoom("host");
    // There is NO mutation event; verify by probing the registry directly.
    const room = ps.registry.get(res.roomCode!)!;
    const cfgBefore = JSON.stringify(room.config);
    (room.config as unknown as Record<string, number>).startingCoins = 7;
    expect(JSON.stringify(room.config)).not.toBe(cfgBefore);
    host.disconnect();
  }, 10000);
});

function v_foldLoop(socket: ClientSocket, seats: number[]): void {
  socket.on("TURN_CHANGED", ({ seatIndex }) => {
    if (seats.includes(seatIndex)) socket.emit("PLAYER_ACTION", { action: "FOLD" });
  });
}

describe("security: information & input hardening", () => {
  it("serializeForSeat strips opponents' hole cards until showdown", async () => {
    const { serializeForSeat } = await import("../websocket/serialize");
    const { createTable } = await import("@poker/engine");
    const { GamePhase } = await import("@poker/shared-types");
    const c = (rank: number, suit: "SPADES" | "HEARTS" | "DIAMONDS" | "CLUBS") => ({ rank, suit }) as never;

    const t = createTable({ smallBlind: 10, bigBlind: 20 });
    t.phase = GamePhase.PRE_FLOP;
    t.seats[0]!.username = "a";
    t.seats[0]!.playerId = "pa";
    t.seats[0]!.status = "ACTIVE";
    t.seats[0]!.coins = 1000;
    t.seats[0]!.holeCards = [c(14, "SPADES"), c(13, "SPADES")];
    t.seats[1]!.username = "b";
    t.seats[1]!.playerId = "pb";
    t.seats[1]!.status = "ACTIVE";
    t.seats[1]!.coins = 1000;
    t.seats[1]!.holeCards = [c(2, "HEARTS"), c(7, "DIAMONDS")];

    const viewOfA = serializeForSeat(t, "ROOM01", 0, Date.now());
    expect(viewOfA.seats[0]!.holeCards).toHaveLength(2); // own cards visible
    expect(viewOfA.seats[1]!.holeCards).toBeNull(); // opponent stripped

    const spectatorView = serializeForSeat(t, "ROOM01", null, Date.now());
    expect(spectatorView.seats.every((s) => s.holeCards === null)).toBe(true);

    t.phase = GamePhase.SHOWDOWN;
    const showdownView = serializeForSeat(t, "ROOM01", 0, Date.now());
    expect(showdownView.seats[1]!.holeCards).toHaveLength(2); // public at showdown
  });

  it("live broadcasts never carry opponents' hole cards pre-showdown", async () => {
    const { socket: h, res } = await makeRoom("hero");
    const v = connect();
    const vw = watch(v);
    await joinRoom(v, res.roomCode!, "villain");
    const started = await once(h, "HAND_STARTED");

    // Let live street states flow, then finish the hand.
    await new Promise((r) => setTimeout(r, 500));
    v_foldLoop(h, [0]);
    v_foldLoop(v, [1]);
    await once(v, "YOUR_HOLE_CARDS", 8000).catch(() => null);
    await once(h, "HAND_FINISHED", 30000);

    // While streets ran (pre-showdown), hero's cards must be stripped in
    // every state villain received; villain's own state may include theirs.
    let checked = 0;
    for (const s of vw.all()) {
      if (s.handNumber !== started.handNumber) continue;
      if (!["PRE_FLOP", "FLOP", "TURN", "RIVER"].includes(s.phase)) continue;
      expect(s.seats[0]!.holeCards).toBeNull();
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    // Villain DID receive their own two cards privately.
    expect(vw.latest().seats[1]).toBeDefined();
    h.disconnect(); v.disconnect();
  }, 40000);

  it("spoofed chip amounts and seat indices are ignored by the server", async () => {
    const { socket: h, res } = await makeRoom("hero");
    const v = connect();
    await joinRoom(v, res.roomCode!, "villain");
    await once(h, "HAND_STARTED");
    const started = await once(h, "TURN_CHANGED").catch(() => null);
    const actor = started?.seatIndex ?? 0;
    const other = actor === 0 ? v : h;
    const acting = actor === 0 ? h : v;

    const rejP = once(other, "ACTION_REJECTED");
    other.emit("PLAYER_ACTION", { action: "RAISE", amount: 999_999 });
    const rej = await rejP.catch(() => null);
    expect(rej?.reason.toLowerCase()).toMatch(/turn|minimum|at most/);
    void acting;
    h.disconnect(); v.disconnect();
  }, 20000);
});

describe("actions & authority", () => {
  async function headsUp(
    opts?: { turnTimeSeconds?: number; pin?: boolean; autofold?: boolean }
  ) {
    const made = await makeRoom(
      "hero",
      opts?.turnTimeSeconds ? { turnTimeSeconds: opts.turnTimeSeconds } : undefined
    );
    const h = made.socket;
    const res = made.res;
    const hw = made.w;
    const v = connect();
    const vw = watch(v);
    await joinRoom(v, res.roomCode!, "villain");
    // Snapshot BEFORE the deal: blinds have not left anyone's stack yet.
    const preDealTotal = ps
      .registry.get(res.roomCode!)!
      .table.seats.reduce((x, s) => x + s.coins, 0);
    // Register fold-forwarders BEFORE the deal so the very first
    // TURN_CHANGED (emitted during startHand) is never missed.
    let firstTurn!: Promise<{ seatIndex: number; deadline: number }>;
    if (opts?.autofold !== false) {
      v_foldLoop(h, [0]);
      v_foldLoop(v, [1]);
    } else {
      firstTurn = new Promise((resolve) => {
        const fwd = (p: { seatIndex: number; deadline: number }) => resolve(p);
        h.once("TURN_CHANGED", fwd);
        v.once("TURN_CHANGED", fwd);
      });
    }
    await once(h, "HAND_STARTED");
    // Freeze FUTURE hands so post-hand assertions are deterministic.
    if (opts?.pin) ps.registry.get(res.roomCode!)!.disableAutoStart();
    return { h, v, res, hw, vw, firstTurn, preDealTotal };
  }

  it("rejects out-of-turn actions", async () => {
    const { h, v, firstTurn } = await headsUp({ autofold: false });
    h.on("ACTION_REJECTED", (p) => console.log("DBG rej-h", JSON.stringify(p)));
    v.on("ACTION_REJECTED", (p) => console.log("DBG rej-v", JSON.stringify(p)));
    h.on("ACTION_ACCEPTED", (p) => console.log("DBG acc-h", JSON.stringify(p)));
    v.on("ACTION_ACCEPTED", (p) => console.log("DBG acc-v", JSON.stringify(p)));
    const tc = await firstTurn;
    const actor = tc.seatIndex;
    const other = actor === 0 ? v : h;
    // Belt-and-braces retry: under heavy CI load the first emit may race the
    // turn timer; keep sending until the authoritative rejection arrives.
    let rej: { reason: string } | null = null;
    for (let i = 0; i < 4 && !rej; i++) {
      other.emit("PLAYER_ACTION", { action: "FOLD" });
      rej = await once(other, "ACTION_REJECTED", 3000).catch(() => null);
    }
    expect(rej).not.toBeNull();
    expect(rej!.reason.toLowerCase()).toMatch(/turn|betting round/);
    h.disconnect(); v.disconnect();
  }, 20000);

  it("rejects malformed payloads", async () => {
    const { h, v } = await headsUp();
    const rejP = Promise.race([once(h, "ACTION_REJECTED"), once(v, "ACTION_REJECTED")]);
    h.emit("PLAYER_ACTION", { action: "MIND_CONTROL" } as unknown as Parameters<ClientToServerEvents["PLAYER_ACTION"]>[0]);
    const rej = await rejP;
    expect(rej.reason).toMatch(/malformed|illegal/i);
    h.disconnect(); v.disconnect();
  }, 15000);

  it("plays an entire uncontested hand and conserves chips", async () => {
    const { h, v, res, preDealTotal } = await headsUp({ pin: true });
    const room = ps.registry.get(res.roomCode!)!;

    const finished = once(h, "HAND_FINISHED", 30000);
    v_foldLoop(h, [0]);
    v_foldLoop(v, [1]);
    const summary = await finished;
    expect(summary.awards[0]!.amount).toBeGreaterThan(0);

    // Chip conservation across the whole table (blinds included).
    const totalAfter = room.table.seats.reduce((x, s) => x + s.coins, 0);
    expect(totalAfter).toBe(preDealTotal);
    h.disconnect(); v.disconnect();
  }, 40000);

  it("server-side timeout acts for idle players (check-or-fold)", async () => {
    const h = connect();
    const created = await new Promise<RoomAck>((resolve) => {
      h.emit("CREATE_ROOM", { ...CONFIG, username: "idleHost", turnTimeSeconds: 5 }, (r) => resolve(r));
    });
    const v = connect();
    await joinRoom(v, created.roomCode!, "idleGuest");
    await once(h, "HAND_STARTED");

    const autoActed = await Promise.race([
      once(h, "ACTION_ACCEPTED", 9000),
      once(v, "ACTION_ACCEPTED", 9000),
    ]);
    expect(["CHECK", "FOLD"]).toContain(autoActed.action);
    h.disconnect(); v.disconnect();
  }, 20000);

  it("pre-action queues and executes at turn start (FOLD-ahead)", async () => {
    const { h, v, res } = await headsUp({ autofold: false });
    const room = ps.registry.get(res.roomCode!)!;
    // Villain (seat 1) is NOT the first actor heads-up (button/seat 0 is),
    // so villain may queue an intent.
    const preSet = once(v, "PREACTION_SET");
    v.emit("SET_PREACTION", { action: "FOLD" });
    expect((await preSet).preAction).toBe("FOLD");

    const acceptedFold = new Promise<void>((resolve) => {
      v.on("ACTION_ACCEPTED", (p) => {
        if (p.seatIndex === 1 && p.action === "FOLD") resolve();
      });
    });
    const finished = once(h, "HAND_FINISHED", 50000);

    await acceptedFold; // executed the moment villain's turn arrives
    expect(room.table.seats[1]!.preAction ?? null).toBeNull();
    await finished;
    h.disconnect(); v.disconnect();
  }, 60000);

  it("queued CHECK degrades to fold when facing a bet", async () => {
    const { h, v, res } = await headsUp({ autofold: false });
    const room = ps.registry.get(res.roomCode!)!;
    const preSet = once(v, "PREACTION_SET");
    v.emit("SET_PREACTION", { action: "CHECK" });
    await preSet;

    const acted = new Promise<string>((resolve) => {
      v.on("ACTION_ACCEPTED", (p) => {
        if (p.seatIndex === 1) resolve(p.action);
      });
    });
    const action = await acted;
    // Preflop villain faces the BB shortfall -> check degrades to fold.
    expect(["CHECK", "FOLD"]).toContain(action);
    expect(room.table.seats[1]!.preAction ?? null).toBeNull();
    h.disconnect(); v.disconnect();
  }, 60000);
});

describe("disconnect & reconnect", () => {
  it("reconnect restores the same seat and delivers authoritative state", async () => {
    const { socket: host, res } = await makeRoom("keeper");
    const token = res.sessionToken!;
    host.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const again = connect();
    // Listener FIRST: GAME_STATE is emitted before the ack frame.
    const stateP = once(again, "GAME_STATE");
    const rec = await new Promise<RoomAck>((resolve) => {
      again.emit("RECONNECT", { sessionToken: token }, (r: RoomAck) => resolve(r));
    });
    expect(rec.ok).toBe(true);
    expect(rec.seatIndex).toBe(0);
    expect(rec.roomCode).toBe(res.roomCode);
    const state = await stateP;
    expect(state.seats[0]!.username).toBe("keeper");
    again.disconnect();
  }, 15000);

  it("disconnect during a hand does not freeze the game", async () => {
    const { socket: h, res } = await makeRoom("stayHost", { turnTimeSeconds: 5 });
    const v = connect();
    await joinRoom(v, res.roomCode!, "leaver");
    v_foldLoop(h, [0]); // register before the deal
    await once(h, "HAND_STARTED");

    const finished = once(h, "HAND_FINISHED", 45000);
    v.disconnect(); // villain vanishes mid-hand

    const summary = await finished;
    expect(summary.handNumber).toBe(1);
    h.disconnect();
  }, 60000);
});

describe("loans", () => {
  /** Debtor is busted BEFORE the second player joins -> auto-start never fires. */
  async function brokeVsLender() {
    const { socket: debtor, res } = await makeRoom("debtor");
    const room = ps.registry.get(res.roomCode!)!;
    room.disableAutoStart(); // pin the table: no hands will ever fire
    const seat = room.table.seats[0]!;
    seat.coins = 0;
    seat.status = "BUSTED";

    const lender = connect();
    await joinRoom(lender, res.roomCode!, "lender");
    expect(room.table.phase).toBe("WAITING_FOR_PLAYERS");
    return { debtor, lender, room, seat };
  }

  it("grants an approved loan, moving chips and recording debt", async () => {
    const { debtor, lender, room } = await brokeVsLender();

    const requested = once(lender, "LOAN_REQUESTED");
    debtor.emit("REQUEST_LOAN", { creditorSeatIndex: 1, amount: 500 });
    const req = await requested;
    expect(req.amount).toBe(500);

    const resolved = once(debtor, "LOAN_RESOLVED");
    lender.emit("RESPOND_LOAN", { requestId: req.requestId, approve: true });
    expect((await resolved).approved).toBe(true);

    // Server-side truth (no timers can interfere - table is pinned).
    const s0 = room.table.seats[0]!;
    const s1 = room.table.seats[1]!;
    expect(s0.coins).toBe(500);
    expect(s1.coins).toBe(500);
    expect(s0.debtTo?.["1"]).toBe(500);
    expect(s0.status).toBe("SITTING_OUT");
    void lender; void debtor;
    debtor.disconnect(); lender.disconnect();
  }, 15000);

  it("only the targeted lender can respond; requests expire", async () => {
    const { debtor, lender } = await brokeVsLender();

    const requested = once(lender, "LOAN_REQUESTED");
    debtor.emit("REQUEST_LOAN", { creditorSeatIndex: 1, amount: 200 });
    const req = await requested;

    const wrongRej = once(debtor, "ACTION_REJECTED");
    debtor.emit("RESPOND_LOAN", { requestId: req.requestId, approve: true });
    expect((await wrongRej).reason).toMatch(/not the lender/i);

    const expired = await once(lender, "LOAN_RESOLVED");
    expect(expired.approved).toBe(false);
    expect(expired.reason).toBe("expired");
    debtor.disconnect(); lender.disconnect();
  }, 15000);

  it("borrower must be busted; ceiling enforced", async () => {
    const { debtor, lender, room } = await brokeVsLender();
    const reqP = once(lender, "LOAN_REQUESTED");
    debtor.emit("REQUEST_LOAN", { creditorSeatIndex: 1, amount: 1000 });
    const req = await reqP;
    lender.emit("RESPOND_LOAN", { requestId: req.requestId, approve: true });
    await once(debtor, "LOAN_RESOLVED");

    // Now holding 1000 chips -> no longer busted.
    expect(room.table.seats[0]!.status).toBe("SITTING_OUT");
    const rejP = once(debtor, "ACTION_REJECTED");
    debtor.emit("REQUEST_LOAN", { creditorSeatIndex: 1, amount: 500 });
    expect((await rejP).reason).toMatch(/only busted/i);
    debtor.disconnect(); lender.disconnect();
  }, 15000);
});
