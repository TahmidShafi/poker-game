import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  HandFinishedSummary,
  Pot,
  PublicGameState,
  RoomConfig,
  ServerToClientEvents,
  ShowdownResult,
} from "@poker/shared-types";
import { GamePhase, PlayerAction } from "@poker/shared-types";
import {
  BettingRoundState,
  applyAction,
  canAct,
  getLegalActions,
  isBettingRoundComplete,
  isInHand,
} from "@poker/engine";
import {
  MAX_SEATS,
  TableState,
  countInHand,
  createEmptySeat,
  createTable,
  eligibleForHand,
  endBettingRound,
  advancePhase,
  finishByFoldWin,
  resolveShowdown,
  startHand,
} from "@poker/engine";
import { randomBytes, randomUUID } from "crypto";
import { ServerConfig } from "../../config";
import { serializeForSeat } from "./serialize";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export interface HandFinishedHookPayload {
  summary: HandFinishedSummary & { roomCode: string };
  communityCards: string[];
  seats: { username: string | null; coins: number; seatIndex: number }[];
}

export interface GameManagerHooks {
  onHandFinished?: (data: HandFinishedHookPayload) => void;
  onRoomClosed?: (roomCode: string) => void;
  onLoanEvent?: (roomCode: string, fromName: string, toName: string, amount: number, kind: "LOAN" | "REPAY") => void;
}

interface PendingLoan {
  requestId: string;
  debtorSeatIndex: number;
  creditorSeatIndex: number;
  amount: number;
  timer: NodeJS.Timeout;
}

interface PlayerRecord {
  playerId: string;
  username: string;
  seatIndex: number;
  sessionToken: string;
  socketIds: Set<string>;
  lastSeen: number;
  /** Avatar picture index chosen at join (1-10). */
  avatar?: number;
}

/**
 * One private room = one poker table. Owns all live state in memory and is
 * the ONLY authority for dealing, betting, timing, showdown and payouts.
 */
export class GameManager {
  readonly roomCode: string;
  readonly config: RoomConfig;
  readonly gameType = "POKER" as const;
  table: TableState;
  private readonly io: IO;
  private readonly limits: ServerConfig["limits"];
  private readonly hooks: GameManagerHooks;

  private players = new Map<string, PlayerRecord>(); // playerId -> record
  private seatToPlayer = new Map<number, string>();
  private turnTimer: NodeJS.Timeout | null = null;
  private turnDeadline = 0;
  private nextHandDeadline = 0;
  private autoStartTimer: NodeJS.Timeout | null = null;
  private pendingLoans = new Map<string, PendingLoan>();
  private pendingSeatRemovals = new Set<number>();
  private disconnectedSeats = new Set<number>();
  private disconnectTimers = new Map<number, NodeJS.Timeout>();
  private destroyed = false;
  private autoStartEnabled = true;
  private readonly createdAt = Date.now();

  /** Millis since epoch when the room was created. */
  creationTime(): number {
    return this.createdAt;
  }

  getTurnDeadline(): number {
    return this.turnDeadline;
  }

  getNextHandDeadline(): number {
    return this.nextHandDeadline;
  }

  getDisconnectedSeats(): Set<number> {
    return this.disconnectedSeats;
  }

  constructor(
    io: IO,
    roomCode: string,
    config: RoomConfig,
    limits: ServerConfig["limits"],
    hooks: GameManagerHooks = {}
  ) {
    this.io = io;
    this.roomCode = roomCode;
    this.config = config;
    this.limits = limits;
    this.hooks = hooks;
    this.table = createTable({ smallBlind: config.smallBlind, bigBlind: config.bigBlind });
  }

  // ------------------------------------------------------------------ room

  destroy(): void {
    this.destroyed = true;
    this.clearTurnTimer();
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    for (const loan of this.pendingLoans.values()) clearTimeout(loan.timer);
    this.pendingLoans.clear();
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
    this.hooks.onRoomClosed?.(this.roomCode);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Test/integration seam: pins the table between hands so assertions are
   * deterministic. Production never calls this.
   */
  disableAutoStart(): void {
    this.autoStartEnabled = false;
    this.nextHandDeadline = 0;
    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
    }
  }

  /** Timestamp of the last moment any socket was attached to the room. */
  lastActivityAt(): number {
    let latest = 0;
    for (const p of this.players.values()) {
      if (p.socketIds.size > 0 && p.lastSeen > latest) latest = p.lastSeen;
    }
    return latest;
  }

  // --------------------------------------------------------------- joining

  join(
    username: string,
    opts: { sessionToken?: string; socketId: string; avatar?: number }
  ): { ok: true; seatIndex: number; playerId: string; sessionToken: string } | { ok: false; error: string } {
    if (this.destroyed) return { ok: false, error: "room no longer exists" };
    const name = username.trim();
    if (name.length < 1 || name.length > 16) {
      return { ok: false, error: "username must be 1-16 characters" };
    }

    // 1. Reconnect / rejoin path by session token.
    if (opts.sessionToken) {
      const rec = this.findByToken(opts.sessionToken);
      if (rec) {
        rec.socketIds.add(opts.socketId);
        rec.lastSeen = Date.now();
        this.disconnectedSeats.delete(rec.seatIndex);
        const timer = this.disconnectTimers.get(rec.seatIndex);
        if (timer) {
          clearTimeout(timer);
          this.disconnectTimers.delete(rec.seatIndex);
        }
        const seat = this.table.seats[rec.seatIndex]!;
        if (seat.status === "DISCONNECTED") seat.status = "ACTIVE";
        // Busted player rejoining with their token = rebuy at stored config.
        if (seat.status === "BUSTED") {
          seat.coins = this.config.startingCoins;
          seat.status = "SITTING_OUT";
        }
        if (opts.avatar !== undefined) {
          rec.avatar = opts.avatar;
          seat.avatar = opts.avatar;
        }
        if (seat.holeCards && seat.holeCards.length === 2) {
          this.io.to(opts.socketId).emit("YOUR_HOLE_CARDS", seat.holeCards.map((c) => ({ ...c })));
        }
        this.broadcastState();
        this.io.to(this.socketRoom()).emit("PLAYER_RECONNECTED", {
          seatIndex: rec.seatIndex,
          username: rec.username,
        });
        return { ok: true, seatIndex: rec.seatIndex, playerId: rec.playerId, sessionToken: rec.sessionToken };
      }
      // If token not found in this room, fall through to match by username or assign seat.
    }

    // 2. Fresh join or re-attaching to existing seat by username.
    for (const rec of this.players.values()) {
      if (rec.username.toLowerCase() === name.toLowerCase()) {
        const seat = this.table.seats[rec.seatIndex]!;
        const isDisconnected =
          seat.status === "DISCONNECTED" ||
          this.disconnectedSeats.has(rec.seatIndex) ||
          rec.socketIds.size === 0;

        if (isDisconnected || opts.sessionToken === rec.sessionToken) {
          rec.socketIds.add(opts.socketId);
          rec.lastSeen = Date.now();
          this.disconnectedSeats.delete(rec.seatIndex);
          const timer = this.disconnectTimers.get(rec.seatIndex);
          if (timer) {
            clearTimeout(timer);
            this.disconnectTimers.delete(rec.seatIndex);
          }
          if (seat.status === "DISCONNECTED") seat.status = "ACTIVE";
          if (seat.status === "BUSTED") {
            seat.coins = this.config.startingCoins;
            seat.status = "SITTING_OUT";
          }
          if (opts.avatar !== undefined) {
            rec.avatar = opts.avatar;
            seat.avatar = opts.avatar;
          }
          if (seat.holeCards && seat.holeCards.length === 2) {
            this.io.to(opts.socketId).emit("YOUR_HOLE_CARDS", seat.holeCards.map((c) => ({ ...c })));
          }
          this.broadcastState();
          this.io.to(this.socketRoom()).emit("PLAYER_RECONNECTED", {
            seatIndex: rec.seatIndex,
            username: rec.username,
          });
          return { ok: true, seatIndex: rec.seatIndex, playerId: rec.playerId, sessionToken: rec.sessionToken };
        }
        return { ok: false, error: `username "${rec.username}" is already taken in this room` };
      }
    }
    const seat = this.firstEmptySeat();
    if (seat === null) return { ok: false, error: "room is full (10 players)" };

    const playerId = randomUUID();
    const sessionToken = randomBytes(24).toString("hex");
    const record: PlayerRecord = {
      playerId,
      username: name,
      seatIndex: seat.seatIndex,
      sessionToken,
      socketIds: new Set([opts.socketId]),
      lastSeen: Date.now(),
      avatar: opts.avatar,
    };
    this.players.set(playerId, record);
    this.seatToPlayer.set(seat.seatIndex, playerId);

    seat.playerId = playerId;
    seat.username = name;
    seat.avatar = opts.avatar;
    seat.coins = this.config.startingCoins;
    seat.status = "SITTING_OUT"; // waits for the next hand if one is running
    seat.preAction = null;
    seat.debtTo = undefined;

    this.io.to(this.socketRoom()).emit("PLAYER_JOINED", {
      seatIndex: seat.seatIndex,
      username: name,
    });
    this.broadcastState();
    this.maybeScheduleAutoStart();
    return { ok: true, seatIndex: seat.seatIndex, playerId, sessionToken };
  }

  attachSocket(playerId: string, socketId: string): void {
    const rec = this.players.get(playerId);
    if (!rec) return;
    rec.socketIds.add(socketId);
    rec.lastSeen = Date.now();
    this.disconnectedSeats.delete(rec.seatIndex);
    const timer = this.disconnectTimers.get(rec.seatIndex);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(rec.seatIndex);
    }
    const seat = this.table.seats[rec.seatIndex]!;
    if (seat.status === "DISCONNECTED") seat.status = "ACTIVE";
    if (seat.status === "BUSTED" && !this.isHandRunning()) {
      seat.coins = this.config.startingCoins;
      seat.status = "SITTING_OUT";
    }
    if (seat.holeCards && seat.holeCards.length === 2) {
      this.io.to(socketId).emit("YOUR_HOLE_CARDS", seat.holeCards.map((c) => ({ ...c })));
    }
    this.broadcastState();
    this.io.to(this.socketRoom()).emit("PLAYER_RECONNECTED", {
      seatIndex: rec.seatIndex,
      username: rec.username,
    });
  }

  findByToken(token: string): PlayerRecord | undefined {
    for (const rec of this.players.values()) {
      if (rec.sessionToken === token) return rec;
    }
    return undefined;
  }

  findPlayerBySocket(socketId: string): PlayerRecord | undefined {
    for (const rec of this.players.values()) {
      if (rec.socketIds.has(socketId)) return rec;
    }
    return undefined;
  }

  disconnectSocket(socketId: string): void {
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return;
    rec.socketIds.delete(socketId);
    rec.lastSeen = Date.now();
    if (rec.socketIds.size > 0) return; // other tabs still connected

    this.disconnectedSeats.add(rec.seatIndex);
    const seat = this.table.seats[rec.seatIndex]!;
    if (seat.status === "ACTIVE" && !this.isHandRunning()) {
      seat.status = "DISCONNECTED"; // between hands
    }

    // Start 20-second disconnect grace period
    const existing = this.disconnectTimers.get(rec.seatIndex);
    if (existing) clearTimeout(existing);

    const graceMs = 20000;
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(rec.seatIndex);
      this.onDisconnectGraceExpired(rec.seatIndex);
    }, graceMs);
    this.disconnectTimers.set(rec.seatIndex, timer);

    this.broadcastState();
  }

  private onDisconnectGraceExpired(seatIndex: number): void {
    if (this.destroyed) return;
    const { table } = this;
    if (table.actingSeatIndex === seatIndex && this.isHandRunning()) {
      this.onTurnTimeout();
    }
  }

  leave(socketId: string): void {
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return;
    rec.socketIds.delete(socketId);
    // Cancel any pending loan requests involving the departing player
    for (const [id, loan] of this.pendingLoans) {
      if (loan.debtorSeatIndex === rec.seatIndex || loan.creditorSeatIndex === rec.seatIndex) {
        clearTimeout(loan.timer);
        this.pendingLoans.delete(id);
        this.io.to(this.socketRoom()).emit("LOAN_RESOLVED", { requestId: id, approved: false, reason: "player left" });
      }
    }
    const seat = this.table.seats[rec.seatIndex]!;
    if (isInHand(seat) && seat.status !== "BUSTED") {
      // Fold them now; free the seat when the hand ends.
      if (seat.status === "ACTIVE") this.forceFold(rec.seatIndex, "left the table");
      this.pendingSeatRemovals.add(rec.seatIndex);
      // An ALL_IN player who leaves is still owed pots - keep ALL_IN so
      // calculatePots()/resolveShowdown() stay correct (seat frees at hand end).
      if (seat.status !== "ALL_IN" && seat.status !== "FOLDED") {
        seat.status = "DISCONNECTED";
      }
    } else {
      this.freeSeat(rec.seatIndex);
    }
    this.players.delete(rec.playerId);
    this.seatToPlayer.delete(rec.seatIndex);
    this.io.to(this.socketRoom()).emit("PLAYER_LEFT", { seatIndex: rec.seatIndex });
    this.broadcastState();
    this.maybeScheduleAutoStart();
  }

  private freeSeat(seatIndex: number): void {
    const seat = this.table.seats[seatIndex]!;
    const fresh = createEmptySeat(seatIndex);
    fresh.isDealer = seat.isDealer;
    this.table.seats[seatIndex] = fresh;
    this.seatToPlayer.delete(seatIndex);
    // Purge any debts owed to the vacated seat so subsequent occupants don't receive them
    const key = String(seatIndex);
    for (const s of this.table.seats) {
      if (s.debtTo && s.debtTo[key] !== undefined) {
        delete s.debtTo[key];
      }
    }
  }

  private firstEmptySeat() {
    for (const s of this.table.seats) {
      if (s.playerId === null) return s;
    }
    return null;
  }

  // --------------------------------------------------------------- actions

  playerAction(socketId: string, payload: { action: PlayerAction; amount?: number }): void {
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return this.reject(socketId, "you are not seated in a room");
    const { table } = this;
    if (
      table.phase !== GamePhase.PRE_FLOP &&
      table.phase !== GamePhase.FLOP &&
      table.phase !== GamePhase.TURN &&
      table.phase !== GamePhase.RIVER
    ) {
      return this.reject(socketId, "no betting round is running");
    }
    if (table.actingSeatIndex !== rec.seatIndex) {
      return this.reject(socketId, "not your turn");
    }
    const seat = table.seats[rec.seatIndex]!;
    if (!canAct(seat)) return this.reject(socketId, "you cannot act right now");

    const legal = getLegalActions(toRound(table));
    if (!legal.legalActions.includes(payload.action)) {
      return this.reject(socketId, `illegal action ${payload.action} right now`);
    }
    if (payload.action === "BET" || payload.action === "RAISE") {
      // The engine throws on a missing amount; reject here instead so the
      // exception can never escape through the socket handler.
      if (payload.amount === undefined) {
        return this.reject(socketId, `${payload.action} requires an amount`);
      }
      const amt = payload.amount;
      if (!Number.isInteger(amt) || amt <= 0) {
        return this.reject(socketId, "amount must be a positive integer");
      }
      if (amt < legal.minRaiseTo && !(amt === legal.maxRaiseTo)) {
        return this.reject(socketId, `minimum is ${legal.minRaiseTo}`);
      }
      if (amt > legal.maxRaiseTo) {
        return this.reject(socketId, `at most ${legal.maxRaiseTo} available`);
      }
    }

    try {
      this.applyAndAdvance(payload.action, payload.amount);
    } catch (err) {
      // Defense in depth: any engine rejection becomes a clean protocol
      // error instead of an uncaught exception in the socket handler.
      return this.reject(socketId, `action rejected: ${(err as Error).message}`);
    }
    this.io.to(this.socketRoom()).emit("ACTION_ACCEPTED", {
      seatIndex: rec.seatIndex,
      action: payload.action,
      amount: payload.amount,
    });
  }

  setPreaction(socketId: string, action: "CHECK" | "FOLD" | null): void {
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return;
    const seat = this.table.seats[rec.seatIndex]!;
    if (this.table.actingSeatIndex === rec.seatIndex) {
      return this.reject(socketId, "it is your turn - act directly");
    }
    if (!canAct(seat)) return this.reject(socketId, "you are not in the current hand");
    seat.preAction = action;
    this.io.to(this.socketRoom()).emit("PREACTION_SET", { seatIndex: rec.seatIndex, preAction: action });
    this.broadcastState();
  }

  /**
   * Consumes a seat's queued pre-action and returns the concrete action:
   * CHECK means check-if-free, otherwise fold. The caller is responsible
   * for broadcasting ACTION_ACCEPTED and driving applyAndAdvance.
   */
  private consumePreaction(seatIndex: number): PlayerAction {
    const seat = this.table.seats[seatIndex]!;
    const intent = seat.preAction;
    seat.preAction = null;
    const legal = getLegalActions(toRound(this.table));
    return intent === "FOLD" || legal.callAmount > 0 ? "FOLD" : "CHECK";
  }

  private forceFold(seatIndex: number, _reason?: string): void {
    const { table } = this;
    const seat = table.seats[seatIndex]!;
    if (seat.status !== "ACTIVE") return;

    if (table.actingSeatIndex === seatIndex) {
      // Their turn: go through the normal engine path (advances streets).
      this.applyAndAdvance("FOLD");
      return;
    }
    // Not their turn: fold them in place, then close the street if that
    // leaves nothing left to do (e.g. everyone else folded/all-in).
    seat.status = "FOLDED";
    seat.preAction = null;
    if (isBettingRoundComplete(toRound(table))) {
      this.closeStreet();
      return;
    }
    // The folded seat may have been holding up an owed shortfall - nothing
    // further needed here; the live turn continues on its timer.
    this.broadcastState();
  }

  /**
   * Core mutation path shared by live actions, pre-actions and timeouts.
   * Applies the action to the table, then drives streets/showdown/payout.
   */
  private applyAndAdvance(action: PlayerAction, amount?: number): void {
    const { table } = this;
    const actingIdx = table.actingSeatIndex!;
    const res = applyAction(toRound(table), actingIdx, action, amount);

    table.seats = res.newState.seats;
    table.currentBet = res.newState.currentBet;
    table.minRaiseIncrement = res.newState.minRaiseIncrement;
    table.actedThisRound = res.newState.actedThisRound;
    table.mayRaise = res.newState.mayRaise;
    table.actingSeatIndex = res.nextActingSeatIndex ?? null;
    table.lastAction = { seatIndex: actingIdx, action, amount };

    const actor = table.seats[actingIdx]!;
    actor.preAction = null; // consumed

    if (res.roundComplete) {
      this.closeStreet();
      return;
    }

    // Pre-action of the NEXT actor executes immediately (check/fold ahead).
    const next = table.actingSeatIndex !== null ? table.seats[table.actingSeatIndex]! : null;
    if (next?.preAction) {
      const act = this.consumePreaction(next.seatIndex);
      this.broadcastState();
      this.io.to(this.socketRoom()).emit("ACTION_ACCEPTED", {
        seatIndex: next.seatIndex,
        action: act,
      });
      this.applyAndAdvance(act);
      return;
    }

    this.startTurnTimer();
    this.broadcastState();
  }

  /** Betting round ended: sweep, then showdown / fold-win / next street. */
  private closeStreet(): void {
    this.clearTurnTimer();
    this.table = endBettingRound(this.table);
    const table = this.table;
    table.pots = [{ amount: table.pot, eligibleSeatIndexes: [] }];

    if (countInHand(table) <= 1) {
      this.finishFoldWin();
      return;
    }
    if (table.phase === GamePhase.RIVER) {
      this.finishShowdown();
      return;
    }

    this.table = advancePhase(this.table);
    this.io.to(this.socketRoom()).emit("COMMUNITY_CARDS", { cards: [...this.table.communityCards] });

    // Deal through streets with no live actors (run-out when everyone all-in).
    let safety = 0;
    while (
      this.table.actingSeatIndex === null &&
      this.table.phase !== GamePhase.RIVER &&
      safety++ < 5
    ) {
      this.table = advancePhase(this.table);
      this.io.to(this.socketRoom()).emit("COMMUNITY_CARDS", { cards: [...this.table.communityCards] });
    }
    if (this.table.actingSeatIndex !== null && canAct(this.table.seats[this.table.actingSeatIndex]!)) {
      const actor = this.table.seats[this.table.actingSeatIndex]!;
      if (actor.preAction) {
        // Queued check/fold-ahead applies on street transitions too.
        const seatIdx = actor.seatIndex;
        const act = this.consumePreaction(seatIdx);
        this.broadcastState();
        this.io.to(this.socketRoom()).emit("ACTION_ACCEPTED", { seatIndex: seatIdx, action: act });
        this.applyAndAdvance(act);
        return;
      }
      this.startTurnTimer();
    } else if (this.table.phase === GamePhase.RIVER || countInHand(this.table) <= 1) {
      if (this.table.phase === GamePhase.RIVER) {
        this.finishShowdown();
        return;
      }
    }
    this.broadcastState();
  }

  private finishFoldWin(): void {
    const res = finishByFoldWin(this.table);
    const table = this.table;
    table.seats = res.seats;
    table.pot = 0;
    table.phase = GamePhase.PAYOUT;
    table.actingSeatIndex = null;
    this.io.to(this.socketRoom()).emit("SHOWDOWN", { results: [] });
    const summary = this.closeHand(
      [
        {
          seatIndex: res.winnerSeatIndex,
          username: table.seats[res.winnerSeatIndex]!.username ?? "?",
          amount: res.amountWon,
        },
      ],
      [{ amount: res.amountWon, eligibleSeatIndexes: [res.winnerSeatIndex] }]
    );
    this.io.to(this.socketRoom()).emit("HAND_FINISHED", summary);
    this.hooks.onHandFinished?.({
      summary: { ...summary, roomCode: this.roomCode },
      communityCards: table.communityCards.map((c) => `${c.rank}${c.suit[0]}`),
      seats: table.seats.filter((s) => s.username).map((s) => ({ username: s.username, coins: s.coins, seatIndex: s.seatIndex })),
    });
    this.afterHandSettled();
  }

  private finishShowdown(): void {
    const table = this.table;
    table.phase = GamePhase.SHOWDOWN;
    const out = resolveShowdown(table);
    table.seats = out.seats;
    table.pots = out.pots;

    const results: ShowdownResult[] = [];
    for (const award of out.awards) {
      for (const w of award.winners) {
        results.push({
          seatIndex: w.seatIndex,
          username: w.username ?? "?",
          hand: w.hand,
          amountWon: w.amount,
          potIndex: award.potIndex,
        });
      }
    }
    this.io.to(this.socketRoom()).emit("SHOWDOWN", { results });
    this.broadcastState(); // hole cards now public

    const flat = results.map((r) => ({ seatIndex: r.seatIndex, username: r.username, amount: r.amountWon }));
    const summary = this.closeHand(flat, out.pots);
    summary.results = results;
    this.io.to(this.socketRoom()).emit("HAND_FINISHED", summary);
    this.hooks.onHandFinished?.({
      summary: { ...summary, roomCode: this.roomCode },
      communityCards: table.communityCards.map((c) => `${c.rank}${c.suit[0]}`),
      seats: table.seats.filter((s) => s.username).map((s) => ({ username: s.username, coins: s.coins, seatIndex: s.seatIndex })),
    });
    this.afterHandSettled();
  }

  /** Marks busts, frees pending-leave seats, resets to waiting, auto-starts. */
  private closeHand(
    awards: HandFinishedSummary["awards"],
    finalPots: Pot[]
  ): HandFinishedSummary {
    const { table } = this;
    const bustedSeats: number[] = [];
    for (const s of table.seats) {
      if (isInHand(s) && s.coins === 0) {
        s.status = "BUSTED";
        bustedSeats.push(s.seatIndex);
      }
      s.holeCards = null;
      s.totalInvestedThisHand = 0;
      s.currentBetThisRound = 0;
      // Queued intents must never leak into the next hand.
      s.preAction = null;
    }
    for (const idx of this.pendingSeatRemovals) this.freeSeat(idx);
    this.pendingSeatRemovals.clear();

    table.phase = GamePhase.NEXT_HAND;
    table.actingSeatIndex = null;
    table.currentBet = 0;
    table.pot = 0;
    table.pots = [{ amount: 0, eligibleSeatIndexes: [] }];
    table.lastAction = null;

    return {
      handNumber: table.handNumber,
      pots: finalPots.map((p) => ({ amount: p.amount, eligibleSeatIndexes: [...p.eligibleSeatIndexes] })),
      awards,
      bustedSeats,
    };
  }

  private afterHandSettled(): void {
    if (this.destroyed) return;
    this.broadcastState();
    this.maybeScheduleAutoStart();
  }

  private maybeScheduleAutoStart(): void {
    if (this.destroyed || !this.autoStartEnabled) return;
    const { table } = this;
    if (table.phase !== GamePhase.WAITING_FOR_PLAYERS && table.phase !== GamePhase.NEXT_HAND) return;
    if (eligibleForHand(table).length < 2) {
      this.nextHandDeadline = 0;
      return;
    }
    if (this.autoStartTimer) return; // already scheduled
    this.nextHandDeadline = Date.now() + this.limits.autoStartDelayMs;
    this.broadcastState();
    this.autoStartTimer = setTimeout(() => {
      this.autoStartTimer = null;
      this.nextHandDeadline = 0;
      this.autoStart();
    }, this.limits.autoStartDelayMs);
  }

  private autoStart(): void {
    if (this.destroyed || !this.autoStartEnabled) return;
    if (this.isHandRunning()) return;
    if (eligibleForHand(this.table).length < 2) return;
    try {
      this.table = startHand(this.table);
      const table = this.table;
      this.io.to(this.socketRoom()).emit("HAND_STARTED", {
        handNumber: table.handNumber,
        dealerSeatIndex: table.dealerSeatIndex!,
      });
      // Private hole cards to each connected, dealt-in player.
      for (const rec of this.players.values()) {
        const seat = table.seats[rec.seatIndex]!;
        if (seat.holeCards && seat.holeCards.length === 2) {
          for (const sid of rec.socketIds) {
            this.io.to(sid).emit("YOUR_HOLE_CARDS", seat.holeCards.map((c) => ({ ...c })));
          }
        }
      }
      // Execute any queued pre-action for the first actor.
      const first = table.actingSeatIndex !== null ? table.seats[table.actingSeatIndex]! : null;
      if (first?.preAction) {
        const seatIdx = first.seatIndex;
        const act = this.consumePreaction(seatIdx);
        this.broadcastState();
        this.io.to(this.socketRoom()).emit("ACTION_ACCEPTED", { seatIndex: seatIdx, action: act });
        this.applyAndAdvance(act);
        return;
      }
      this.startTurnTimer();
      this.broadcastState();
    } catch (err) {
      // Should be unreachable (caller checks eligibility) - never crash the room.
      this.io.to(this.socketRoom()).emit("ERROR", { message: `could not start hand: ${(err as Error).message}` });
    }
  }

  private startTurnTimer(): void {
    this.clearTurnTimer();
    const { table } = this;
    if (table.actingSeatIndex === null) return;
    this.turnDeadline = Date.now() + this.config.turnTimeSeconds * 1000;
    this.io.to(this.socketRoom()).emit("TURN_CHANGED", {
      seatIndex: table.actingSeatIndex,
      deadline: this.turnDeadline,
    });
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      this.onTurnTimeout();
    }, this.config.turnTimeSeconds * 1000 + 250); // small grace for latency
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  /** Server-authoritative timeout: check if legal, otherwise fold. */
  private onTurnTimeout(): void {
    if (this.destroyed) return;
    const { table } = this;
    if (table.actingSeatIndex === null) return;
    const seat = table.seats[table.actingSeatIndex]!;
    if (!canAct(seat)) return;
    const legal = getLegalActions(toRound(table));
    const action: PlayerAction = legal.legalActions.includes("CHECK") ? "CHECK" : "FOLD";
    this.io.to(this.socketRoom()).emit("ACTION_ACCEPTED", {
      seatIndex: seat.seatIndex,
      action,
    });
    this.applyAndAdvance(action);
  }

  // ----------------------------------------------------------------- loans

  requestLoan(socketId: string, creditorSeatIndex: number, amount: number): void {
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return this.reject(socketId, "you are not seated in a room");
    const { table } = this;
    if (this.isHandRunning()) return this.reject(socketId, "loans are only possible between hands");
    const debtor = table.seats[rec.seatIndex]!;
    if (debtor.coins !== 0 || debtor.status !== "BUSTED") {
      return this.reject(socketId, "only busted players can request loans");
    }
    const creditor = table.seats[creditorSeatIndex];
    if (!creditor || creditor.playerId === null || creditor.playerId === debtor.playerId) {
      return this.reject(socketId, "invalid lender");
    }
    if (!Number.isInteger(amount) || amount < this.config.bigBlind || amount > this.config.startingCoins) {
      return this.reject(socketId, `amount must be between ${this.config.bigBlind} and ${this.config.startingCoins}`);
    }
    if (creditor.coins < amount) return this.reject(socketId, "lender cannot afford that amount");
    const owed = this.totalDebtOf(debtor);
    const ceiling = this.config.startingCoins * this.limits.debtCeilingMultiple;
    if (owed + amount > ceiling) {
      return this.reject(socketId, `debt ceiling is ${ceiling}`);
    }
    for (const [id, loan] of this.pendingLoans) {
      if (loan.debtorSeatIndex === rec.seatIndex) {
        clearTimeout(loan.timer);
        this.pendingLoans.delete(id);
        this.io.to(this.socketRoom()).emit("LOAN_RESOLVED", { requestId: id, approved: false, reason: "superseded" });
      }
    }

    const requestId = randomUUID();
    const timer = setTimeout(() => {
      this.pendingLoans.delete(requestId);
      this.io.to(this.socketRoom()).emit("LOAN_RESOLVED", { requestId, approved: false, reason: "expired" });
      this.broadcastState();
    }, this.limits.loanRequestTtlMs);
    this.pendingLoans.set(requestId, {
      requestId,
      debtorSeatIndex: rec.seatIndex,
      creditorSeatIndex,
      amount,
      timer,
    });
    this.io.to(this.socketRoom()).emit("LOAN_REQUESTED", {
      requestId,
      debtorSeatIndex: rec.seatIndex,
      debtorUsername: debtor.username ?? "?",
      creditorSeatIndex,
      amount,
      deadline: Date.now() + this.limits.loanRequestTtlMs,
    });
  }

  respondLoan(socketId: string, requestId: string, approve: boolean): void {
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return;
    const loan = this.pendingLoans.get(requestId);
    if (!loan) return this.reject(socketId, "no such loan request");
    if (loan.creditorSeatIndex !== rec.seatIndex) {
      return this.reject(socketId, "you are not the lender for this request");
    }
    this.pendingLoans.delete(requestId);
    clearTimeout(loan.timer);

    if (!approve) {
      this.io.to(this.socketRoom()).emit("LOAN_RESOLVED", { requestId, approved: false, reason: "declined" });
      this.broadcastState();
      return;
    }
    const creditor = this.table.seats[loan.creditorSeatIndex];
    const debtor = this.table.seats[loan.debtorSeatIndex];
    if (!creditor || creditor.playerId === null || !debtor || debtor.playerId === null) {
      this.io.to(this.socketRoom()).emit("LOAN_RESOLVED", { requestId, approved: false, reason: "player left" });
      return;
    }
    if (creditor.coins < loan.amount) {
      this.io.to(this.socketRoom()).emit("LOAN_RESOLVED", { requestId, approved: false, reason: "lender cannot afford it" });
      return;
    }
    creditor.coins -= loan.amount;
    debtor.coins += loan.amount;
    debtor.status = "SITTING_OUT"; // back with chips; joins next hand
    debtor.debtTo = debtor.debtTo ?? {};
    const key = String(loan.creditorSeatIndex);
    debtor.debtTo[key] = (debtor.debtTo[key] ?? 0) + loan.amount;

    this.io.to(this.socketRoom()).emit("LOAN_RESOLVED", { requestId, approved: true });
    this.hooks.onLoanEvent?.(
      this.roomCode,
      creditor.username ?? "?",
      debtor.username ?? "?",
      loan.amount,
      "LOAN"
    );
    this.broadcastState();
    this.maybeScheduleAutoStart();
  }

  repayLoan(socketId: string, creditorSeatIndex: number, amount: number): void {
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return this.reject(socketId, "you are not seated in a room");
    if (this.isHandRunning()) return this.reject(socketId, "repay between hands");
    const debtor = this.table.seats[rec.seatIndex]!;
    const key = String(creditorSeatIndex);
    const owed = debtor.debtTo?.[key] ?? 0;
    if (owed <= 0) return this.reject(socketId, "no debt to that player");
    if (!Number.isInteger(amount) || amount <= 0 || amount > owed) {
      return this.reject(socketId, `amount must be 1-${owed}`);
    }
    if (debtor.coins < amount) return this.reject(socketId, "not enough chips");
    const creditor = this.table.seats[creditorSeatIndex];
    if (!creditor || creditor.playerId === null) {
      return this.reject(socketId, "that player is not seated");
    }
    debtor.coins -= amount;
    creditor.coins += amount;
    debtor.debtTo![key] = owed - amount;
    if (debtor.debtTo![key] === 0) delete debtor.debtTo![key];
    this.io.to(this.socketRoom()).emit("LOAN_REPAID", {
      debtorSeatIndex: rec.seatIndex,
      creditorSeatIndex,
      amount,
    });
    this.hooks.onLoanEvent?.(
      this.roomCode,
      debtor.username ?? "?",
      creditor.username ?? "?",
      amount,
      "REPAY"
    );
    this.broadcastState();
  }

  private totalDebtOf(seat: { debtTo?: Record<string, number> }): number {
    return Object.values(seat.debtTo ?? {}).reduce((a, b) => a + b, 0);
  }

  private isHandRunning(): boolean {
    const p = this.table.phase;
    return (
      p === GamePhase.PRE_FLOP || p === GamePhase.FLOP || p === GamePhase.TURN || p === GamePhase.RIVER
    );
  }

  // ------------------------------------------------------------- broadcast

  socketRoom(): string {
    return `room:${this.roomCode}`;
  }

  broadcastState(): void {
    if (this.destroyed) return;
    // One authoritative snapshot per event; per-seat serialization happens
    // in serialize.ts before delivery - other players' hole cards are
    // stripped server-side and never reach the browser pre-showdown.
    for (const [, sio] of this.io.of("/").sockets) {
      const rec = this.findPlayerBySocket(sio.id);
      if (!rec) continue; // not a member of this room
      const state = serializeForSeat(
        this.table,
        this.roomCode,
        rec.seatIndex,
        this.turnDeadline,
        this.nextHandDeadline,
        this.disconnectedSeats
      );
      sio.emit("GAME_STATE", state);
    }
  }

  publicStateForSeat(seatIndex: number): PublicGameState {
    return serializeForSeat(
      this.table,
      this.roomCode,
      seatIndex,
      this.turnDeadline,
      this.nextHandDeadline,
      this.disconnectedSeats
    );
  }

  reject(socketId: string, reason: string): void {
    this.io.to(socketId).emit("ACTION_REJECTED", { reason });
  }
}

/** Table -> BettingRoundState adapter for the pure engine. */
export function toRound(table: TableState): BettingRoundState {
  return {
    seats: table.seats,
    currentBet: table.currentBet,
    minRaiseIncrement: table.minRaiseIncrement,
    actingSeatIndex: table.actingSeatIndex!,
    actedThisRound: table.actedThisRound,
    mayRaise: table.mayRaise,
  };
}
