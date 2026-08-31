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
  TnTrumpChoice,
} from "@poker/shared-types";
import { isTnTrumpChoice } from "@poker/shared-types";
import { tnCardPoints, tnTeamOfSeat } from "@poker/shared-types";
import {
  applyBid,
  callTrump,
  createMatch,
  declareMarriage,
  declareTrumpPlan,
  getBidderPrivatePayload,
  lowestLegalCard,
  playCard,
  resolveWinner,
  respondSingleHand,
  startHand,
  toPublicTwentyNineState,
  TwentyNineState,
} from "@poker/twentynine-engine";
import { randomBytes, randomUUID } from "crypto";
import type { RoomLike, JoinOpts, JoinResult, RoomPlayerRef } from "../roomLike";
import type { ServerConfig } from "../../config";
import { chooseTrumpStyle, decideBidding, decidePlay } from "./botBrain";

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
  /** Server-side bot seat (single-player mode); never owns a socket. */
  isBot?: boolean;
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
 * Deterministic dominant suit of a set of cards (ties broken by fixed suit
 * order). Used by the offline fallback to auto-declare trump for an absent
 * bid winner — computed server-side from their own cards, so the choice
 * never leaks anything to other clients.
 */
function dominantSuit(cards: TnCard[]): TnSuit {
  const counts = new Map<TnSuit, number>();
  for (const card of cards) counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1);
  let best: TnSuit = "SPADES";
  let bestN = -1;
  for (const suit of VALID_SUITS) {
    const n = counts.get(suit) ?? 0;
    if (n > bestN) {
      best = suit;
      bestN = n;
    }
  }
  return best;
}

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

  /** Single-player mode: three server-side bots fill the remaining seats. */
  private readonly vsBots: boolean;

  private readonly io: IO;
  private readonly limits: ServerConfig["limits"];
  private readonly hooks: TnManagerHooks;

  private players = new Map<string, TnPlayerRecord>();
  private destroyed = false;
  private autoStartEnabled = true;
  private autoStartTimer: NodeJS.Timeout | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private fallbackDeadline = 0;
  private botTimer: NodeJS.Timeout | null = null;
  /** `${roundNumber}` -> set of batch numbers already delivered per seat. */
  private deliveredBatches = new Map<number, Set<string>>();
  private lastBidderPrivateKey: string | null = null;
  private pendingSeatRemovals = new Set<number>();
  private readonly createdAt = Date.now();

  creationTime(): number {
    return this.createdAt;
  }

  constructor(
    io: IO,
    roomCode: string,
    config: RoomConfig,
    limits: ServerConfig["limits"],
    hooks: TnManagerHooks = {},
    opts: { vsBots?: boolean } = {}
  ) {
    this.io = io;
    this.roomCode = roomCode;
    this.config = config;
    this.limits = limits;
    this.hooks = hooks;
    this.vsBots = !!opts.vsBots;
    this.match = createMatch({
      gameId: roomCode,
      seats: [],
    });
  }

  // ------------------------------------------------------------------ room

  destroy(): void {
    this.destroyed = true;
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    this.autoStartTimer = null;
    this.clearFallbackTimer();
    this.clearBotTimer();
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

    // 1. Reconnect / rejoin by session token if valid for this room.
    if (opts.sessionToken) {
      const rec = this.findByToken(opts.sessionToken);
      if (rec) {
        rec.socketIds.add(opts.socketId);
        rec.lastSeen = Date.now();
        const seat = this.match.seats[rec.seatIndex];
        if (seat) seat.connected = true;
        if (opts.avatar !== undefined) {
          rec.avatar = opts.avatar;
          if (seat) seat.avatar = opts.avatar;
        }
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
      // If token not found in this room, fall through to match by username or allocate new seat.
    }

    // 2. Fresh join or re-attaching to existing seat by username.
    for (const rec of this.players.values()) {
      if (rec.username.toLowerCase() === name.toLowerCase()) {
        const seat = this.match.seats[rec.seatIndex];
        const isDisconnected = !seat || !seat.connected || rec.socketIds.size === 0;

        if (isDisconnected || opts.sessionToken === rec.sessionToken) {
          rec.socketIds.add(opts.socketId);
          rec.lastSeen = Date.now();
          if (seat) seat.connected = true;
          if (opts.avatar !== undefined) {
            rec.avatar = opts.avatar;
            if (seat) seat.avatar = opts.avatar;
          }
          this.deliveredBatches.delete(this.match.roundNumber);
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
    if (process.env.NODE_ENV !== "test" || process.env.TN_DEBUG === "1") {
      console.log(`[TN_SYNC ${this.roomCode}] player joined: ${name} (seat ${seatIndex}, socket ${opts.socketId})`);
    }
    if (this.vsBots) {
      this.fillBots(); // single-player mode: complete the table instantly
    }
    if (seat.hand.length > 0) {
      this.sendPrivateSnapshot(record, opts.socketId);
    }
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
    if (process.env.NODE_ENV !== "test" || process.env.TN_DEBUG === "1") {
      console.log(`[TN_SYNC ${this.roomCode}] socket attached: ${socketId} for ${rec.username} (seat ${rec.seatIndex})`);
    }
    // RECONNECT/multi-tab attach: re-deliver this seat's private state
    // (full current hand + bidder channel) — the public broadcast alone
    // carries no hands, so without this a reconnected client has no cards.
    this.sendPrivateSnapshot(rec, socketId);
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
    if (this.isRoundRunning()) {
      // Keep hand cards intact so fallback/bot moves can legally finish the active round
      this.pendingSeatRemovals.add(rec.seatIndex);
      const seat = this.match.seats[rec.seatIndex];
      if (seat) {
        seat.connected = false;
        seat.username = `${rec.username} (Left)`;
      }
    } else {
      this.freeSeat(rec.seatIndex);
    }
    this.players.delete(rec.playerId);
    this.io.to(this.socketRoom()).emit("PLAYER_LEFT", { seatIndex: rec.seatIndex });
    this.clearFallbackTimer(); // re-armed by broadcastState if still applicable
    this.broadcastState();
    this.maybeScheduleAutoStart();
  }

  private isRoundRunning(): boolean {
    const phase = this.match.phase;
    return (
      phase === "BIDDING" ||
      phase === "TRUMP_SETUP" ||
      phase === "SINGLE_HAND_DECISION" ||
      phase === "PLAYING" ||
      phase === "DEALING_BATCH_1" ||
      phase === "DEALING_BATCH_2"
    );
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

  game29DeclareTrump(socketId: string, choice: TnTrumpChoice): void {
    this.move(socketId, (seatIndex) => {
      if (!isTnTrumpChoice(choice)) throw new Error("invalid trump choice");
      declareTrumpPlan(this.match, seatIndex, choice);
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

  game29SingleHandDecision(socketId: string, declare: boolean): void {
    this.move(socketId, (seatIndex) => {
      respondSingleHand(this.match, seatIndex, declare);
    });
  }

  game29FillBots(socketId: string): void {
    if (this.destroyed) return;
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return this.reject(socketId, "you are not in this room");
    if (this.match.phase !== "WAITING_FOR_PLAYERS") {
      return this.reject(socketId, "cannot fill bots once game has started");
    }
    this.fillBots();
    this.broadcastState();
    this.maybeScheduleAutoStart();
  }

  game29SyncHand(socketId: string): void {
    if (this.destroyed) return;
    const rec = this.findPlayerBySocket(socketId);
    if (!rec) return this.reject(socketId, "you are not in this room");
    if (process.env.NODE_ENV !== "test" || process.env.TN_DEBUG === "1") {
      console.log(
        `[TN_SYNC ${this.roomCode}] GAME29_SYNC_HAND requested by socket ${socketId} (seat ${rec.seatIndex}, ${rec.username})`
      );
    }
    rec.socketIds.add(socketId);
    this.sendPrivateSnapshot(rec, socketId);
    const pub = toPublicTwentyNineState(this.match, { roomCode: this.roomCode });
    if (this.fallbackDeadline > 0 && this.match.actingSeatIndex !== null) {
      const actingRec = [...this.players.values()].find((r) => r.seatIndex === this.match.actingSeatIndex);
      const isOffline = !actingRec || (!actingRec.isBot && actingRec.socketIds.size === 0);
      if (isOffline) {
        pub.offlineFallback = {
          seatIndex: this.match.actingSeatIndex,
          deadline: this.fallbackDeadline,
        };
      }
    }
    this.io.to(socketId).emit("TN_STATE", pub);
  }

  game29PlayCard(socketId: string, card: TnCard): void {
    this.move(
      socketId,
      (seatIndex) => {
        // Belt-and-braces invariant: PLAYING may never accept a card unless
        // the second deal verifiably completed for everyone. The engine
        // guarantees this (batch 2 is dealt before PLAYING begins); this
        // guard turns any future regression into a clean rejection.
        // NOTE: batch1/batch2 are immutable once dealt, so they remain the
        // stable "fully dealt" proof even as `hand` shrinks during play.
        this.assertFullyDealt();
        playCard(this.match, seatIndex, card);
      },
      { playedCard: card }
    );
  }

  private assertFullyDealt(): void {
    for (const seat of this.match.seats) {
      if (seat.username === null) continue;
      if (seat.batch1.length !== 4 || seat.batch2.length !== 4) {
        throw new Error("hand is not fully dealt yet - cannot play a card");
      }
    }
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

    if (process.env.TN_DEBUG === "1") {
      console.log(
        `[tn ${this.roomCode}] move ok seat=${rec.seatIndex} phase=${this.match.phase} acting=${this.match.actingSeatIndex} ` +
          `hands=[${this.match.seats.map((s) => s.hand.length).join(",")}] deck=${this.match.deck.length}`
      );
    }

    // A failure in the derived-event pipeline must never skip the broadcast
    // (that would leave every client staring at a stale state) — log it and
    // still deliver the authoritative snapshot.
    try {
      if (ctx.playedCard) {
        this.emitCompletedTrick(snap, rec.seatIndex, ctx.playedCard);
      }
      this.emitDerivedEvents(snap, rec.seatIndex);
      this.syncHandDeliveries();
      this.maybeScheduleAutoStart();
    } catch (err) {
      console.error(`[tn ${this.roomCode}] post-move pipeline failed:`, (err as Error).message);
    }
    this.broadcastState();
  }

  /** If THIS card completed a trick, announce the resolution. */
  private emitCompletedTrick(
    snap: MoveSnapshot,
    actorSeatIndex: number,
    played: TnCard
  ): void {
    const expectedSnapLength = this.match.isSingleHand ? 2 : 3;
    if (!(snap.trick.length === expectedSnapLength && this.match.currentTrick.length === 0)) return;
    const plays = [...snap.trick, { seatIndex: actorSeatIndex, card: played }];
    this.emitTrickResolved(plays, snap.trumpRevealed, snap.trickNumber);
  }
  /**
   * Emits every public side-effect derivable from comparing the pre-move
   * snapshot with the current state: trick resolution, trump reveal and
   * round/match completion. Used by BOTH live moves and offline fallbacks.
   */
  private emitDerivedEvents(snap: MoveSnapshot, actorSeatIndex: number): void {
    if (!snap.trumpRevealed && this.match.trumpRevealed) {
      if (this.match.trumpSuit) {
        this.io.to(this.socketRoom()).emit("TN_TRUMP_REVEALED", {
          suit: this.match.trumpSuit,
          revealedBySeatIndex: actorSeatIndex,
        });
      }
      // If 7th card was locked, sync the bidder's restored hand snapshot
      if (this.match.trumpStyle === "SEVENTH_CARD" && this.match.bidderSeatIndex !== null) {
        const bidderRec = [...this.players.values()].find((r) => r.seatIndex === this.match.bidderSeatIndex);
        if (bidderRec) {
          this.sendPrivateSnapshot(bidderRec);
        }
      }
    }
    const nowPhase = this.match.phase;
    const finished =
      (nowPhase === "ROUND_SCORED" || nowPhase === "MATCH_OVER") &&
      snap.phase !== "ROUND_SCORED" &&
      snap.phase !== "MATCH_OVER";
    if (finished) {
      for (const idx of this.pendingSeatRemovals) {
        this.freeSeat(idx);
      }
      this.pendingSeatRemovals.clear();
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
    const requiredPlays = this.match.isSingleHand ? 3 : 4;
    if (plays.length !== requiredPlays) return;
    const ledSuit = plays[0]!.card.suit;
    const winner = resolveWinner(plays, ledSuit, {
      jokerMode: this.match.trumpStyle === "JOKER",
      trumpSuit: this.match.isSingleHand ? null : this.match.trumpSuit,
      // Resolution used the reveal state AT PLAY TIME of the final card.
      trumpRevealed: this.match.isSingleHand ? false : trumpWasRevealed,
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
      if (rec.isBot) continue;

      if (seat.batch1.length === 4 && !sent.has(`${rec.seatIndex}:1`)) {
        if (rec.socketIds.size > 0) {
          sent.add(`${rec.seatIndex}:1`);
          if (process.env.NODE_ENV !== "test" || process.env.TN_DEBUG === "1") {
            console.log(
              `[TN_SYNC ${this.roomCode}] emitting batch 1 to seat ${rec.seatIndex} (${rec.username}): 4 cards across ${rec.socketIds.size} sockets`
            );
          }
          this.emitToPlayer(rec, "YOUR_TN_HAND", {
            handNumber: round,
            batch: 1,
            cards: seat.batch1.map((c) => ({ ...c })),
          });
        }
      }
      if (seat.batch2.length === 4 && !sent.has(`${rec.seatIndex}:2`)) {
        if (rec.socketIds.size > 0) {
          sent.add(`${rec.seatIndex}:2`);
          const isBidderSeventhLocked =
            rec.seatIndex === this.match.bidderSeatIndex &&
            this.match.trumpStyle === "SEVENTH_CARD" &&
            !this.match.trumpRevealed &&
            this.match.indicatorCard;

          const cardsToSend = isBidderSeventhLocked
            ? seat.batch2.filter(
                (c) => !(c.suit === this.match.indicatorCard!.suit && c.rank === this.match.indicatorCard!.rank)
              )
            : seat.batch2;

          if (process.env.NODE_ENV !== "test" || process.env.TN_DEBUG === "1") {
            console.log(
              `[TN_SYNC ${this.roomCode}] emitting batch 2 to seat ${rec.seatIndex} (${rec.username}): ${cardsToSend.length} cards across ${rec.socketIds.size} sockets`
            );
          }
          this.emitToPlayer(rec, "YOUR_TN_HAND", {
            handNumber: round,
            batch: 2,
            cards: cardsToSend.map((c) => ({ ...c })),
          });
        }
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
    const bidder = this.match.bidderSeatIndex;
    if (bidder === null) return;
    const rec = [...this.players.values()].find((r) => r.seatIndex === bidder);
    if (!rec) return;
    this.emitToPlayer(rec, "TN_BIDDER_PRIVATE", payload);
    // Mark as delivered only after the emit attempt — a failed/absent target
    // must be retried on the next broadcast, not silently swallowed.
    this.lastBidderPrivateKey = key;
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

  sendPrivateSnapshot(rec: TnPlayerRecord, targetSocketId?: string): void {
    const seat = this.match.seats[rec.seatIndex];
    if (!seat) return;

    const isBidderSeventhLocked =
      rec.seatIndex === this.match.bidderSeatIndex &&
      this.match.trumpStyle === "SEVENTH_CARD" &&
      !this.match.trumpRevealed &&
      this.match.indicatorCard;

    const cardsToSend = isBidderSeventhLocked
      ? seat.hand.filter(
          (c) => !(c.suit === this.match.indicatorCard!.suit && c.rank === this.match.indicatorCard!.rank)
        )
      : seat.hand;

    if (process.env.NODE_ENV !== "test" || process.env.TN_DEBUG === "1") {
      console.log(
        `[TN_SYNC ${this.roomCode}] sending authoritative hand snapshot to seat ${rec.seatIndex} (${rec.username}): ${cardsToSend.length} cards (batch FULL_RECONNECT) across ${rec.socketIds.size} sockets`
      );
    }
    const payload = {
      handNumber: this.match.roundNumber,
      batch: "FULL_RECONNECT" as const,
      cards: cardsToSend.map((c) => ({ ...c })),
    };
    if (targetSocketId) {
      this.io.to(targetSocketId).emit("YOUR_TN_HAND", payload);
    } else {
      this.emitToPlayer(rec, "YOUR_TN_HAND", payload);
    }

    // Re-evaluate the bidder channel for THIS reconnecting/syncing player only.
    const bidder = this.match.bidderSeatIndex;
    if (bidder === rec.seatIndex) {
      const bidderPayload = getBidderPrivatePayload(this.match);
      if (bidderPayload) {
        if (targetSocketId) {
          this.io.to(targetSocketId).emit("TN_BIDDER_PRIVATE", bidderPayload);
        } else {
          this.emitToPlayer(rec, "TN_BIDDER_PRIVATE", bidderPayload);
        }
      }
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
    if (this.pendingSeatRemovals.size > 0) {
      for (const idx of this.pendingSeatRemovals) {
        this.freeSeat(idx);
      }
      this.pendingSeatRemovals.clear();
    }
    if (!this.allSeated()) return;
    const phase = this.match.phase;
    if (phase !== "WAITING_FOR_PLAYERS" && phase !== "ROUND_SCORED" && phase !== "REDEALING") return;
    try {
      startHand(this.match);
      this.lastBidderPrivateKey = null;
      this.syncHandDeliveries();
      if (process.env.TN_DEBUG === "1") {
        console.log(
          `[tn ${this.roomCode}] hand started round=${this.match.roundNumber} dealer=${this.match.dealerSeatIndex} ` +
            `hands=[${this.match.seats.map((s) => s.hand.length).join(",")}] deck=${this.match.deck.length}`
        );
      }
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

  private clearBotTimer(): void {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  private armFallbackIfNeeded(): void {
    this.clearFallbackTimer();
    if (this.destroyed) return;
    const phase = this.match.phase;
    // TRUMP_SETUP is included: a disconnected BID WINNER must never deadlock
    // the room (nobody else may act in this phase and no other timer runs).
    if (phase !== "BIDDING" && phase !== "TRUMP_SETUP" && phase !== "SINGLE_HAND_DECISION" && phase !== "PLAYING") return;
    const acting = this.match.actingSeatIndex;
    if (acting === null) return;
    const rec = [...this.players.values()].find((r) => r.seatIndex === acting);
    if (rec?.isBot) return; // bots arm their own think-delay timer instead

    const offline = !rec || rec.socketIds.size === 0;
    const seconds = offline
      ? Math.max(1, this.limits.tnOfflineFallbackSeconds)
      : Math.max(1, this.limits.tnConnectedTurnSeconds ?? 25);

    this.fallbackDeadline = Date.now() + seconds * 1000;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      this.fireOfflineFallback();
    }, seconds * 1000 + 250);
  }

  /**
   * Auto-acts for an offline or unresponsive player: bidding -> PASS, trump setup ->
   * dominant suit of their own first batch (server-side, leaks nothing),
   * single hand -> skip, card play -> lowest legal card.
   */
  private fireOfflineFallback(): void {
    if (this.destroyed) return;
    const phase = this.match.phase;
    const acting = this.match.actingSeatIndex;
    if (
      acting === null ||
      (phase !== "BIDDING" && phase !== "TRUMP_SETUP" && phase !== "SINGLE_HAND_DECISION" && phase !== "PLAYING")
    ) {
      return;
    }
    const snap = Snapshot.of(this.match);
    try {
      console.log(`[tn ${this.roomCode}] turn fallback fires for seat ${acting} (${phase})`);
      if (phase === "BIDDING") {
        applyBid(this.match, acting); // pass
      } else if (phase === "TRUMP_SETUP") {
        const seat = this.match.seats[acting];
        declareTrumpPlan(this.match, acting, dominantSuit(seat?.batch1 ?? []));
      } else if (phase === "SINGLE_HAND_DECISION") {
        respondSingleHand(this.match, acting, false);
      } else {
        const card = lowestLegalCard(this.match, acting);
        if (!card) {
          throw new Error(
            `no legal card for turn fallback (seat ${acting}, phase ${phase}, hand: ${this.match.seats[acting]?.hand.length ?? 0})`
          );
        }
        playCard(this.match, acting, card);
        this.emitCompletedTrick(snap, acting, card);
      }
      this.emitDerivedEvents(snap, acting);
      this.syncHandDeliveries();
      this.maybeScheduleAutoStart();
      this.broadcastState();
    } catch (err) {
      console.error(`[tn ${this.roomCode}] turn fallback failed (seat ${acting}, phase ${phase}):`, (err as Error).message);
      // Guarantee error recovery: broadcast current state so clients are updated and re-arm timer if needed
      this.broadcastState();
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
      seat.connected = !!rec && (rec.isBot || rec.socketIds.size > 0);
    }
    this.armFallbackIfNeeded();
    this.armBotIfNeeded();
    try {
      this.syncBidderPrivate();
    } catch (err) {
      // A private-channel failure must never block the public broadcast.
      console.error(`[tn ${this.roomCode}] bidder private sync failed:`, (err as Error).message);
    }

    const pub = toPublicTwentyNineState(this.match, { roomCode: this.roomCode });
    if (this.fallbackDeadline > 0 && this.match.actingSeatIndex !== null) {
      const actingRec = [...this.players.values()].find((r) => r.seatIndex === this.match.actingSeatIndex);
      const isOffline = !actingRec || (!actingRec.isBot && actingRec.socketIds.size === 0);
      if (isOffline) {
        pub.offlineFallback = {
          seatIndex: this.match.actingSeatIndex,
          deadline: this.fallbackDeadline,
        };
      }
    }
    this.io.to(this.socketRoom()).emit("TN_STATE", pub);
    for (const [, sio] of this.io.of("/").sockets) {
      const rec = this.findPlayerBySocket(sio.id);
      if (!rec) continue;
      sio.emit("TN_STATE", pub);
    }
  }

  // ------------------------------------------------------------------ bots

  /**
   * Fills every empty seat with a named bot. Bots are plain player records with
   * no socket — they act through performBotMove() below.
   */
  fillBots(): void {
    const NAMES = ["Bot Rana", "Bot Mithu", "Bot Shapan", "Bot Karim", "Bot Jamal", "Bot Tumpa", "Bot Sohel"];
    const AVATARS = [8, 4, 6, 2, 7, 5, 9];
    const existingNames = new Set([...this.players.values()].map((p) => p.username));
    const availableNames = NAMES.filter((name) => !existingNames.has(name));

    let n = 0;
    for (let i = 0; i < 4; i++) {
      const seat = this.match.seats[i];
      if (!seat || seat.username !== null) continue;
      const name = availableNames.length > 0 ? availableNames[n % availableNames.length]! : `Bot ${i + 1}`;
      seat.username = name;
      seat.avatar = AVATARS[(n + i) % AVATARS.length]!;
      seat.connected = true;
      seat.isBot = true;
      const record: TnPlayerRecord = {
        playerId: randomUUID(),
        username: name,
        seatIndex: i,
        sessionToken: randomBytes(12).toString("hex"),
        socketIds: new Set<string>(),
        lastSeen: Date.now(),
        avatar: seat.avatar,
        isBot: true,
      };
      this.players.set(record.playerId, record);
      n++;
      this.io.to(this.socketRoom()).emit("PLAYER_JOINED", { seatIndex: i, username: name });
    }
  }

  /** Arms (or rearms) the bot think-delay whenever it is a bot's turn. */
  private armBotIfNeeded(): void {
    this.clearBotTimer();
    if (this.destroyed) return;
    const phase = this.match.phase;
    if (phase !== "BIDDING" && phase !== "TRUMP_SETUP" && phase !== "SINGLE_HAND_DECISION" && phase !== "PLAYING") return;
    const acting = this.match.actingSeatIndex;
    if (acting === null) return;
    const rec = [...this.players.values()].find((r) => r.seatIndex === acting);
    if (!rec?.isBot) return; // humans drive themselves; empty seats use offline fallback
    // Human-like think delay, deterministic-ish per round/seat.
    let delay =
      process.env.NODE_ENV === "test"
        ? 80 + ((this.match.roundNumber * 37 + acting * 13) % 100)
        : 650 + ((this.match.roundNumber * 37 + acting * 13) % 500);

    // Give the frontend time to play the trick resolution sweep animation
    // (or initial card deal) before the bot throws the first card of a trick.
    if (phase === "PLAYING" && this.match.currentTrick.length === 0) {
      delay += process.env.NODE_ENV === "test" ? 50 : 2500;
    }

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.performBotMove(acting);
    }, delay);
    if (typeof this.botTimer.unref === "function") this.botTimer.unref();
  }

  /** Applies the bot brain's decision through the same pipeline as humans. */
  private performBotMove(seatIndex: number): void {
    if (this.destroyed) return;
    const phase = this.match.phase;
    if (phase !== "BIDDING" && phase !== "TRUMP_SETUP" && phase !== "SINGLE_HAND_DECISION" && phase !== "PLAYING") return;
    if (this.match.actingSeatIndex !== seatIndex) return; // stale tick
    try {
      const snap = Snapshot.of(this.match);
      let playedCard: TnCard | null = null;

      if (phase === "BIDDING") {
        const d = decideBidding(this.match, seatIndex);
        if (d.kind === "BID") applyBid(this.match, seatIndex, d.bid);
        else applyBid(this.match, seatIndex); // pass
      } else if (phase === "TRUMP_SETUP") {
        declareTrumpPlan(this.match, seatIndex, chooseTrumpStyle(this.match, seatIndex));
      } else if (phase === "SINGLE_HAND_DECISION") {
        respondSingleHand(this.match, seatIndex, false);
      } else {
        const d = decidePlay(this.match, seatIndex);
        if (!d) return;
        if (d.kind === "MARRIAGE") {
          declareMarriage(this.match, seatIndex, d.suit);
        } else if (d.kind === "CALL_TRUMP") {
          callTrump(this.match, seatIndex);
        } else if (d.kind === "PLAY") {
          playedCard = d.card;
          playCard(this.match, seatIndex, d.card);
        }
      }

      if (playedCard) this.emitCompletedTrick(snap, seatIndex, playedCard);
      this.emitDerivedEvents(snap, seatIndex);
      this.syncHandDeliveries();
      this.maybeScheduleAutoStart();
      this.broadcastState();
    } catch (err) {
      console.error(`[tn ${this.roomCode}] bot move failed (seat ${seatIndex}):`, (err as Error).message);
      // Never let one bad decision wedge the table - broadcast keeps others in sync.
      this.broadcastState();
    }
  }
}
