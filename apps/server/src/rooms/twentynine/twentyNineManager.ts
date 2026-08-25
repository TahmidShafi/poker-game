import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  PublicTwentyNineState,
  RoomConfig,
  ServerToClientEvents,
  TnCard,
  TnBidderPrivatePayload,
  TnRoundSummary,
  TnSeatView,
  TnSuit,
  TwentyNineRoomSettings,
} from "@poker/shared-types";
import {
  applyBid,
  callTrump,
  createMatch,
  declareMarriage,
  declareTrump,
  getBidderPrivatePayload,
  lowestLegalCard,
  playCard,
  resolveWinner,
  startHand,
  toPublicTwentyNineState,
  TwentyNineState,
} from "@poker/twentynine-engine";
import { tnCardPoints, tnTeamOfSeat } from "@poker/shared-types";
import { randomBytes, randomUUID } from "crypto";
import type { RoomLike, JoinOpts, JoinResult, RoomPlayerRef } from "../roomLike";
import type { ServerConfig } from "../../config";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export interface TnRoundFinishedHookPayload {
  roomCode: string;
  summary: TnRoundSummary;
  players: { seatIndex: number; username: string | null; team: "A" | "B" }[];
}

export interface TnManagerHooks {
  onRoundFinished?: (data: TnRoundFinishedHookPayload) => void;
  onRoomClosed?: (roomCode: string) => void;
}

interface TnPlayerRecord extends RoomPlayerRef {
  socketIds: Set<string>;
  lastSeen: number;
  avatar?: number;
}

/** Pre-move values needed to detect and describe public side effects. */
interface MoveSnapshot {
  phase: PublicTwentyNineState["phase"];
  trick: { seatIndex: number; card: TnCard }[];
  trickNumber: number;
  trumpRevealed: boolean;
}

const Snapshot = {
  of(state: TwentyNineState): MoveSnapshot {
    return {
      phase: state.phase,
      trick: state.currentTrick.map((p) => ({ seatIndex: p.seatIndex, card: { ...p.card } })),
      trickNumber: state.trickNumber,
      trumpRevealed: state.trumpRevealed,
    };
  },
};

const VALID_SUITS: TnSuit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];

/**
 * One private room = one Twenty-Nine table (exactly 4 seats, fixed teams
 * A={0,2} / B={1,3}). The ONLY authority for dealing, bidding, trump,
 * tricks and scoring. Hidden information policy lives here: hands and the
 * hidden trump suit NEVER enter the public broadcast - they travel only via
 * single-socket private payloads below.
 */
export class TwentyNineGameManager implements RoomLike {
  readonly roomCode: string;
  readonly config: RoomConfig;
  readonly gameType = "TWENTY_NINE" as const;
  match: TwentyNineState;

  private readonly io: IO;
  private readonly limits: ServerConfig["limits"];
  private readonly hooks: TnManagerHooks;

  private players = new Map<string, TnPlayerRecord>();
  private destroyed = false;
  private autoStartEnabled = true;
  private autoStartTimer: NodeJS.Timeout | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private fallbackDeadline = 0;
  /** `${roundNumber}` -> set of batch numbers already delivered per seat. */
  private deliveredBatches = new Map<number, Set<string>>();
  private lastBidderPrivateKey: string | null = null;
  private readonly createdAt = Date.now();

  creationTime(): number {
    return this.createdAt;
  }

  constructor(
    io: IO,
    roomCode: string,
    config: RoomConfig,
    limits: ServerConfig["limits"],
    hooks: TnManagerHooks = {}
  ) {
    this.io = io;
    this.roomCode = roomCode;
    this.config = config;
    this.limits = limits;
    this.hooks = hooks;
    const settings: TwentyNineRoomSettings =
      config.twentyNine ?? { trumpMode: "REGULAR", roundsToWin: 6 };
    this.match = createMatch({
      gameId: roomCode,
      settings,
      seats: [],
    });
  }

  // ------------------------------------------------------------------ room

  destroy(): void {
    this.destroyed = true;
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    this.autoStartTimer = null;
    this.clearFallbackTimer();
    this.hooks.onRoomClosed?.(this.roomCode);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  disableAutoStart(): void {
    this.autoStartEnabled = false;
    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
    }
  }

  lastActivityAt(): number {
    let latest = 0;
    for (const p of this.players.values()) {
      if (p.socketIds.size > 0 && p.lastSeen > latest) latest = p.lastSeen;
    }
    return latest;
  }

  socketRoom(): string {
    return `room:${this.roomCode}`;
  }

  /** Test seam: the live public state. */
  publicState(): PublicTwentyNineState {
    return toPublicTwentyNineState(this.match, { roomCode: this.roomCode });
  }

  // --------------------------------------------------------------- joining

  join(username: string, opts: JoinOpts): JoinResult {
    if (this.destroyed) return { ok: false, error: "room no longer exists" };
    const name = username.trim();
    if (name.length < 1 || name.length > 16) {
      return { ok: false, error: "username must be 1-16 characters" };
    }

    // Reconnect / rejoin by session token.
    if (opts.sessionToken) {
      const rec = this.findByToken(opts.sessionToken);
      if (!rec) return { ok: false, error: "session not found in this room" };
      rec.socketIds.add(opts.socketId);
      rec.lastSeen = Date.now();
      const seat = this.match.seats[rec.seatIndex];
      if (seat) seat.connected = true;
      this.deliveredBatches.delete(this.match.roundNumber); // force re-delivery below
      this.sendPrivateSnapshot(rec);
      this.broadcastState();
      this.io.to(this.socketRoom()).emit("PLAYER_RECONNECTED", {
        seatIndex: rec.seatIndex,
        username: rec.username,
      });
      return {
        ok: true,
        seatIndex: rec.seatIndex,
        playerId: rec.playerId,
        sessionToken: rec.sessionToken,
      };
    }

    // Fresh join.
    for (const rec of this.players.values()) {
      if (rec.username.toLowerCase() === name.toLowerCase()) {
        return { ok: false, error: `username "${rec.username}" is already taken in this room` };
      }
    }
    const seatIndex = this.firstEmptySeat();
    if (seatIndex === null) return { ok: false, error: "room is full (4 players)" };

    const playerId = randomUUID();
    const sessionToken = randomBytes(24).toString("hex");
    const record: TnPlayerRecord = {
      playerId,
      username: name,
      seatIndex,
      sessionToken,
      socketIds: new Set([opts.socketId]),
      lastSeen: Date.now(),
      avatar: opts.avatar,
    };
    this.players.set(playerId, record);

    const seat = this.match.seats[seatIndex];
    if (!seat) return { ok: false, error: "invalid seat" };
    seat.username = name;
    seat.avatar = opts.avatar;
    seat.connected = true;

    this.io.to(this.socketRoom()).emit("PLAYER_JOINED", { seatIndex, username: name });
    this.broadcastState();
    this.maybeScheduleAutoStart();
    return { ok: true, seatIndex, playerId, sessionToken };
  }

  attachSocket(playerId: string, socketId: string): void {
    const rec = this.players.get(playerId);
    if (!rec) return;
    rec.socketIds.add(socketId);
    rec.lastSeen = Date.now();
    const seat = this.match.seats[rec.seatIndex];
    if (seat) seat.connected = true;
    this.broadcastState();
  }

  findByToken(token: string): TnPlayerRecord | undefined {
    for (const rec of this.players.values()) {
      if (rec.sessionToken === token) return rec;
    }
    return undefined;
  }

  findPlayerBySocket(socketId: string): TnPlayerRecord | undefined {
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
    const seat = this.match.seats[rec.seatIndex];
    if (seat) seat.connected = false;
    // Seat stays RESERVED; cards stay hidden; the offline-fallback timer
    // (armed inside broadcastState) keeps the table moving on their turn.
    this.broadcastState();
  }

  leave(socketId: string): void {
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return;
    rec.socketIds.delete(socketId);
    this.freeSeat(rec.seatIndex);
    this.players.delete(rec.playerId);
    this.io.to(this.socketRoom()).emit("PLAYER_LEFT", { seatIndex: rec.seatIndex });
    this.clearFallbackTimer(); // re-armed by broadcastState if still applicable
    this.broadcastState();
    this.maybeScheduleAutoStart();
  }

  private freeSeat(seatIndex: number): void {
    const seat = this.match.seats[seatIndex];
    if (!seat) return;
    seat.username = null;
    seat.avatar = undefined;
    seat.connected = false;
    seat.hand = [];
    seat.batch1 = [];
    seat.batch2 = [];
  }

  private firstEmptySeat(): number | null {
    for (let i = 0; i < 4; i++) {
      const seat = this.match.seats[i];
      if (seat && seat.username === null) return i;
    }
    return null;
  }

  // --------------------------------------------------------------- moves

  game29Bid(socketId: string, bid: number | undefined): void {
    this.move(socketId, (seatIndex) => {
      applyBid(this.match, seatIndex, bid);
    });
  }

  game29DeclareTrump(socketId: string, suit: TnSuit): void {
    this.move(socketId, (seatIndex) => {
      declareTrump(this.match, seatIndex, suit);
    });
  }

  game29CallTrump(socketId: string): void {
    this.move(socketId, (seatIndex) => {
      callTrump(this.match, seatIndex);
    });
  }

  game29DeclareMarriage(socketId: string, suit: TnSuit): void {
    this.move(socketId, (seatIndex) => {
      declareMarriage(this.match, seatIndex, suit);
    });
  }

  game29PlayCard(socketId: string, card: TnCard): void {
    this.move(
      socketId,
      (seatIndex) => {
        playCard(this.match, seatIndex, card);
      },
      { playedCard: card }
    );
  }

  /**
   * Shared mutation path: resolves the seat from the socket, snapshots what
   * side-effect detectors need, applies the engine transition (any throw is
   * logged + converted to ACTION_REJECTED), then broadcasts derived events.
   */
  private move(
    socketId: string,
    fn: (seatIndex: number) => void,
    ctx: { playedCard?: TnCard } = {}
  ): void {
    if (this.destroyed) return;
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return this.reject(socketId, "you are not seated in a room");

    const snap = Snapshot.of(this.match);
    try {
      fn(rec.seatIndex);
    } catch (err) {
      console.log(`[tn ${this.roomCode}] rejected move by seat ${rec.seatIndex}: ${(err as Error).message}`);
      return this.reject(socketId, (err as Error).message);
    }

    if (ctx.playedCard) {
      this.emitCompletedTrick(snap, rec.seatIndex, ctx.playedCard);
    }
    this.emitDerivedEvents(snap, rec.seatIndex);
    this.syncHandDeliveries();
    this.maybeScheduleAutoStart();
    this.broadcastState();
  }

  /** If THIS card completed a trick, announce the resolution. */
  private emitCompletedTrick(
    snap: MoveSnapshot,
    actorSeatIndex: number,
    played: TnCard
  ): void {
    // Completed = the snapshot held the first three plays and the trick has
    // since been cleared (works for tricks 1-7 AND the final 8th).
    if (!(snap.trick.length === 3 && this.match.currentTrick.length === 0)) return;
    const plays = [...snap.trick, { seatIndex: actorSeatIndex, card: played }];
    this.emitTrickResolved(plays, snap.trumpRevealed, snap.trickNumber);
  }
  /**
   * Emits every public side-effect derivable from comparing the pre-move
   * snapshot with the current state: trick resolution, trump reveal and
   * round/match completion. Used by BOTH live moves and offline fallbacks.
   */
  private emitDerivedEvents(snap: MoveSnapshot, actorSeatIndex: number): void {
    if (!snap.trumpRevealed && this.match.trumpRevealed && this.match.trumpSuit) {
      this.io.to(this.socketRoom()).emit("TN_TRUMP_REVEALED", {
        suit: this.match.trumpSuit,
        revealedBySeatIndex: actorSeatIndex,
      });
    }
    const nowPhase = this.match.phase;
    const finished =
      (nowPhase === "ROUND_SCORED" || nowPhase === "MATCH_OVER") &&
      snap.phase !== "ROUND_SCORED" &&
      snap.phase !== "MATCH_OVER";
    if (finished) {
      const summary = this.match.lastRoundSummary!;
      this.io.to(this.socketRoom()).emit("TN_ROUND_FINISHED", { summary });
      this.hooks.onRoundFinished?.({
        roomCode: this.roomCode,
        summary,
        players: this.match.seats.map((s) => ({
          seatIndex: s.seatIndex,
          username: s.username,
          team: tnTeamOfSeat(s.seatIndex),
        })),
      });
      if (nowPhase === "MATCH_OVER" && this.match.winnerTeam) {
        this.io.to(this.socketRoom()).emit("TN_MATCH_FINISHED", {
          winnerTeam: this.match.winnerTeam,
          finalScore: { ...this.match.matchScore },
        });
      }
    }
  }

  /** Emits TN_TRICK_RESOLVED by re-resolving the completed trick deterministically. */
  private emitTrickResolved(
    plays: { seatIndex: number; card: TnCard }[],
    trumpWasRevealed: boolean,
    trickNumberThatJustEnded: number
  ): void {
    if (plays.length !== 4) return;
    const ledSuit = plays[0]!.card.suit;
    const winner = resolveWinner(plays, ledSuit, {
      jokerMode: this.match.trumpMode === "JOKER",
      trumpSuit: this.match.trumpSuit,
      // Resolution used the reveal state AT PLAY TIME of the final card.
      trumpRevealed: trumpWasRevealed,
    });
    let points = plays.reduce((sum, p) => sum + tnCardPoints(p.card), 0);
    if (trickNumberThatJustEnded === 8) points += 1; // last-trick bonus
    this.io.to(this.socketRoom()).emit("TN_TRICK_RESOLVED", {
      trickNumber: trickNumberThatJustEnded,
      plays,
      winnerSeatIndex: winner.seatIndex,
      winnerTeam: tnTeamOfSeat(winner.seatIndex),
      pointsWon: points,
    });
  }

  /**
   * Delivers every not-yet-delivered hand batch for connected seats.
   * Cards travel ONLY here - one socket at a time, own cards only.
   */
  private syncHandDeliveries(): void {
    const round = this.match.roundNumber;
    let sent = this.deliveredBatches.get(round);
    if (!sent) {
      sent = new Set();
      this.deliveredBatches.set(round, sent);
    }
    for (const rec of this.players.values()) {
      const seat = this.match.seats[rec.seatIndex];
      if (!seat || seat.username === null) continue;
      if (seat.batch1.length === 4 && !sent.has(`${rec.seatIndex}:1`)) {
        sent.add(`${rec.seatIndex}:1`);
        this.emitToPlayer(rec, "YOUR_TN_HAND", {
          handNumber: round,
          batch: 1,
          cards: seat.batch1.map((c) => ({ ...c })),
        });
      }
      if (seat.batch2.length === 4 && !sent.has(`${rec.seatIndex}:2`)) {
        sent.add(`${rec.seatIndex}:2`);
        this.emitToPlayer(rec, "YOUR_TN_HAND", {
          handNumber: round,
          batch: 2,
          cards: seat.batch2.map((c) => ({ ...c })),
        });
      }
    }
    // Prune old rounds to bound memory.
    if (this.deliveredBatches.size > 4) {
      const keys = [...this.deliveredBatches.keys()].sort((a, b) => a - b);
      while (keys.length > 4) {
        const k = keys.shift();
        if (k === undefined) break;
        this.deliveredBatches.delete(k);
      }
    }
  }

  /** Bidder-only channel: hidden trump knowledge travels ONLY through here. */
  private syncBidderPrivate(): void {
    const payload = getBidderPrivatePayload(this.match);
    if (!payload) {
      this.lastBidderPrivateKey = null;
      return;
    }
    const key = `${payload.handNumber}:${JSON.stringify(payload)}`;
    if (key === this.lastBidderPrivateKey) return;
    this.lastBidderPrivateKey = key;
    const bidder = this.match.bidderSeatIndex;
    if (bidder === null) return;
    const rec = [...this.players.values()].find((r) => r.seatIndex === bidder);
    if (!rec) return;
    this.emitToPlayer(rec, "TN_BIDDER_PRIVATE", payload);
  }

  private emitToPlayer<E extends keyof ServerToClientEvents>(
    rec: TnPlayerRecord,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0]
  ): void {
    for (const sid of rec.socketIds) {
      const target = this.io.to(sid);
      const emit = target.emit.bind(target) as unknown as (
        ev: E,
        p: Parameters<ServerToClientEvents[E]>[0]
      ) => void;
      emit(event, payload);
    }
  }

  private sendPrivateSnapshot(rec: TnPlayerRecord): void {
    const seat = this.match.seats[rec.seatIndex];
    if (!seat) return;
    if (seat.hand.length > 0) {
      this.emitToPlayer(rec, "YOUR_TN_HAND", {
        handNumber: this.match.roundNumber,
        batch: "FULL_RECONNECT",
        cards: seat.hand.map((c) => ({ ...c })),
      });
    }
    // Re-evaluate the bidder channel for THIS reconnecting player only.
    const bidder = this.match.bidderSeatIndex;
    if (bidder === rec.seatIndex) {
      const payload = getBidderPrivatePayload(this.match);
      if (payload) this.emitToPlayer(rec, "TN_BIDDER_PRIVATE", payload);
    }
  }

  // ----------------------------------------------------------- lifecycle

  private seatedCount(): number {
    return this.match.seats.filter((s) => s.username !== null).length;
  }

  private allSeated(): boolean {
    return this.seatedCount() === 4;
  }

  private maybeScheduleAutoStart(): void {
    if (this.destroyed || !this.autoStartEnabled) return;
    const phase = this.match.phase;
    const canDeal =
      phase === "WAITING_FOR_PLAYERS" ||
      phase === "ROUND_SCORED" ||
      phase === "REDEALING";
    if (!canDeal) return;
    if (!this.allSeated()) {
      if (this.autoStartTimer) {
        clearTimeout(this.autoStartTimer);
        this.autoStartTimer = null;
      }
      return;
    }
    if (this.autoStartTimer) return; // already scheduled
    this.autoStartTimer = setTimeout(() => {
      this.autoStartTimer = null;
      this.autoStart();
    }, this.limits.autoStartDelayMs);
  }

  private autoStart(): void {
    if (this.destroyed || !this.autoStartEnabled) return;
    if (!this.allSeated()) return;
    const phase = this.match.phase;
    if (phase !== "WAITING_FOR_PLAYERS" && phase !== "ROUND_SCORED" && phase !== "REDEALING") return;
    try {
      startHand(this.match);
      this.lastBidderPrivateKey = null;
      this.syncHandDeliveries();
      this.broadcastState();
    } catch (err) {
      this.io.to(this.socketRoom()).emit("ERROR", {
        message: `could not start hand: ${(err as Error).message}`,
      });
    }
  }

  // ---------------------------------------------- offline fallback timing

  private clearFallbackTimer(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.fallbackDeadline = 0;
  }

  private armFallbackIfNeeded(): void {
    this.clearFallbackTimer();
    if (this.destroyed) return;
    const phase = this.match.phase;
    if (phase !== "BIDDING" && phase !== "PLAYING") return;
    const acting = this.match.actingSeatIndex;
    if (acting === null) return;
    const rec = [...this.players.values()].find((r) => r.seatIndex === acting);
    const offline = !rec || rec.socketIds.size === 0;
    if (!offline) return;
    const seconds = Math.max(1, this.limits.tnOfflineFallbackSeconds);
    this.fallbackDeadline = Date.now() + seconds * 1000;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      this.fireOfflineFallback();
    }, seconds * 1000 + 250);
  }

  /** Auto-acts for a disconnected player: bid -> PASS, card -> lowest legal. */
  private fireOfflineFallback(): void {
    if (this.destroyed) return;
    const phase = this.match.phase;
    const acting = this.match.actingSeatIndex;
    if (acting === null || (phase !== "BIDDING" && phase !== "PLAYING")) return;
    const rec = [...this.players.values()].find((r) => r.seatIndex === acting);
    if (rec && rec.socketIds.size > 0) return; // they came back
    const snap = Snapshot.of(this.match);
    try {
      console.log(`[tn ${this.roomCode}] offline fallback fires for seat ${acting} (${phase})`);
      if (phase === "BIDDING") {
        applyBid(this.match, acting); // pass
      } else {
        const card = lowestLegalCard(this.match, acting);
        if (!card) throw new Error("no legal card for offline fallback");
        playCard(this.match, acting, card);
        this.emitCompletedTrick(snap, acting, card);
      }
      this.emitDerivedEvents(snap, acting);
      this.syncHandDeliveries();
      this.broadcastState();
    } catch (err) {
      console.error(`[tn ${this.roomCode}] offline fallback failed:`, (err as Error).message);
    }
  }

  // ------------------------------------------------------------- broadcast

  reject(socketId: string, reason: string): void {
    this.io.to(socketId).emit("ACTION_REJECTED", { reason });
  }

  /**
   * Broadcasts the authoritative public snapshot. The public state contains
   * NO hands, NO hidden trump suit and NO deck by construction, so one
   * identical object goes to every member socket. Private knowledge travels
   * exclusively through syncHandDeliveries()/syncBidderPrivate().
   */
  broadcastState(): void {
    if (this.destroyed) return;
    // Refresh connectivity flags so seat statuses are accurate.
    for (let i = 0; i < 4; i++) {
      const seat = this.match.seats[i];
      if (!seat || seat.username === null) continue;
      const rec = [...this.players.values()].find((r) => r.seatIndex === i);
      seat.connected = !!rec && rec.socketIds.size > 0;
    }
    this.armFallbackIfNeeded();
    this.syncBidderPrivate();

    const pub = toPublicTwentyNineState(this.match, { roomCode: this.roomCode });
    if (this.fallbackDeadline > 0 && this.match.actingSeatIndex !== null) {
      pub.offlineFallback = {
        seatIndex: this.match.actingSeatIndex,
        deadline: this.fallbackDeadline,
      };
    }
    for (const [, sio] of this.io.of("/").sockets) {
      const rec = this.findPlayerBySocket(sio.id);
      if (!rec) continue;
      sio.emit("TN_STATE", pub);
    }
  }
}
