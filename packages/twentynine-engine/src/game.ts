import {
  PublicTwentyNineState,
  TnBidderPrivatePayload,
  TnBidState,
  TnCard,
  tnCardPoints,
  isTnTrumpChoice,
  TnPhase,
  tnTeamOfSeat,
  TnTeam,
  TnTeamTotals,
  TnSeatView,
  TnSuit,
  TnTrumpChoice,
  TnTrumpStyle,
  TnTrumpView,
  TnTrickPlay,
} from "@poker/shared-types";
import { createTnDeck, shuffleTnDeck, tnNextSeat, tnNextActiveSeat } from "./deck";
import { activeBidders, createBidState, nextActiveBidder, validateBid, canStay, TN_MAX_BID } from "./bidding";
import { legalCards, resolveWinner } from "./play";
import { TN_RANK_WEIGHT } from "./ranking";
import { isSeventhTrumpValid, seventhCardIndicator } from "./trump/seventh";
import { holdsMarriage, marriageAdjustedRequirement } from "./trump/marriage";

export const TN_SEAT_COUNT = 4;
export const TN_HAND_SIZE = 8;
export const TN_TRICKS_PER_HAND = 8;
/** The traditional target: first team to six round-wins takes the match. */
export const TN_DEFAULT_ROUNDS_TO_WIN = 6;

/**
 * Server-side per-seat record. Hands/batches are PRIVATE — never broadcast.
 */
export interface TnEngineSeat {
  seatIndex: number;
  username: string | null;
  avatar?: number;
  connected: boolean;
  hand: TnCard[];
  batch1: TnCard[];
  batch2: TnCard[];
  isBot?: boolean;
}

/**
 * Full server-side match state. NEVER serialize this whole object to clients
 * — use toPublicTwentyNineState() plus the single-socket private payloads.
 */
export interface TwentyNineState {
  gameId: string;
  phase: TnPhase;
  roundsToWin: number;
  seats: TnEngineSeat[]; // fixed length 4
  dealerSeatIndex: number; // first dealer is seat 0
  /** Set when a hand completes normally; startHand() consumes it to rotate the dealer. */
  dealerAdvancePending: boolean;
  roundNumber: number; // increments at every deal (including redeals)
  deck: TnCard[];
  bids: TnBidState | null;
  bidderSeatIndex: number | null;
  bid: number | null;
  /** How THIS hand's trump is established — chosen by the bidder at setup. */
  trumpStyle: TnTrumpStyle | null;
  trumpSuit: TnSuit | null; // hidden truth; null in JOKER hands / pre-choice
  trumpSet: boolean;
  trumpRevealed: boolean;
  indicatorCard: TnCard | null; // seventh-card hands only
  marriageDeclaredBy: TnTeam | null;
  currentTrick: TnTrickPlay[];
  ledSeatIndex: number | null;
  trickNumber: number; // 1..8 during PLAYING
  tricksWon: TnTeamTotals;
  capturedPoints: TnTeamTotals;
  matchScore: TnTeamTotals;
  roundHistory: TnTeam[];
  winnerTeam: TnTeam | null;
  lastRoundSummary: PublicTwentyNineState["lastRoundSummary"];
  actingSeatIndex: number | null;
  lastMove: PublicTwentyNineState["lastMove"];
  // ---- Single Hand Mode ----
  isSingleHand: boolean;
  singleHandSeatIndex: number | null;
  inactiveSeatIndex: number | null;
  singleHandSkippedCount: number;
}

export type TnSeatRef = { seatIndex: number; username?: string; avatar?: number };

export interface CreateMatchOptions {
  gameId: string;
  /** Universally 6; overridable only for tests/determinism. */
  roundsToWin?: number;
  seats: TnSeatRef[];
}

function emptyTotals(): TnTeamTotals {
  return { A: 0, B: 0 };
}

function emptySeat(seatIndex: number): TnEngineSeat {
  return { seatIndex, username: null, connected: false, hand: [], batch1: [], batch2: [] };
}

/**
 * Creates a match shell. All four seats are filled in later by the room
 * manager (players and/or bots); rules start once everyone is seated.
 */
export function createMatch(opts: CreateMatchOptions): TwentyNineState {
  const roundsToWin = opts.roundsToWin ?? TN_DEFAULT_ROUNDS_TO_WIN;
  if (!Number.isInteger(roundsToWin) || roundsToWin < 1 || roundsToWin > 15) {
    throw new Error(`roundsToWin must be an integer between 1 and 15`);
  }
  const state: TwentyNineState = {
    gameId: opts.gameId,
    phase: TnPhase.WAITING_FOR_PLAYERS,
    roundsToWin,
    seats: Array.from({ length: TN_SEAT_COUNT }, (_, i) => emptySeat(i)),
    dealerSeatIndex: 0,
    dealerAdvancePending: false,
    roundNumber: 0,
    deck: [],
    bids: null,
    bidderSeatIndex: null,
    bid: null,
    trumpStyle: null,
    trumpSuit: null,
    trumpSet: false,
    trumpRevealed: false,
    indicatorCard: null,
    marriageDeclaredBy: null,
    currentTrick: [],
    ledSeatIndex: null,
    trickNumber: 0,
    tricksWon: emptyTotals(),
    capturedPoints: emptyTotals(),
    matchScore: emptyTotals(),
    roundHistory: [],
    winnerTeam: null,
    lastRoundSummary: null,
    actingSeatIndex: null,
    lastMove: null,
    isSingleHand: false,
    singleHandSeatIndex: null,
    inactiveSeatIndex: null,
    singleHandSkippedCount: 0,
  };
  for (const ref of opts.seats) {
    if (!Number.isInteger(ref.seatIndex) || ref.seatIndex < 0 || ref.seatIndex >= TN_SEAT_COUNT) {
      throw new Error(`invalid seat index ${ref.seatIndex}`);
    }
    const seat = state.seats[ref.seatIndex];
    if (!seat) throw new Error(`missing seat ${ref.seatIndex}`);
    if (seat.username !== null) throw new Error(`seat ${ref.seatIndex} assigned twice`);
    seat.username = ref.username ?? `Player ${ref.seatIndex + 1}`;
    seat.avatar = ref.avatar;
    seat.connected = true;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Hand lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts a new hand: rotates the dealer IF the previous hand completed
 * normally, reshuffles and deals batch 1 (4 cards each), then opens bidding.
 * Redealt hands (all-pass / invalid seventh-card) keep the same dealer
 * because dealerAdvancePending was never set for them.
 * `opts.deck` injects a specific 32-card order (tests/determinism only).
 */
export function startHand(state: TwentyNineState, opts?: { deck?: TnCard[] }): void {
  requireAllSeated(state);
  if (state.dealerAdvancePending) {
    state.dealerSeatIndex = tnNextSeat(state.dealerSeatIndex);
    state.dealerAdvancePending = false;
  }
  resetHand(state, opts?.deck);
  dealBatch1(state);
  openBidding(state);
}

function validatedDeck(deck: TnCard[]): TnCard[] {
  if (deck.length !== 32) throw new Error(`deck override must contain 32 cards, got ${deck.length}`);
  const seen = new Set<string>();
  for (const c of deck) {
    const key = `${c.suit}:${c.rank}`;
    if (seen.has(key)) throw new Error(`deck override contains duplicate ${key}`);
    seen.add(key);
  }
  return [...deck];
}

function requireAllSeated(state: TwentyNineState): void {
  for (const seat of state.seats) {
    if (seat.username === null) throw new Error("all four seats must be filled before starting");
  }
}

function resetHand(state: TwentyNineState, deckOverride?: TnCard[]): void {
  state.roundNumber += 1;
  state.deck = deckOverride ? validatedDeck(deckOverride) : shuffleTnDeck(createTnDeck());
  for (const seat of state.seats) {
    seat.hand = [];
    seat.batch1 = [];
    seat.batch2 = [];
  }
  state.bids = null;
  state.bidderSeatIndex = null;
  state.bid = null;
  state.trumpStyle = null;
  state.trumpSuit = null;
  state.trumpSet = false;
  state.trumpRevealed = false;
  state.indicatorCard = null;
  state.marriageDeclaredBy = null;
  state.currentTrick = [];
  state.ledSeatIndex = null;
  state.trickNumber = 0;
  state.tricksWon = emptyTotals();
  state.capturedPoints = emptyTotals();
  state.actingSeatIndex = null;
  state.lastMove = null;
  state.isSingleHand = false;
  state.singleHandSeatIndex = null;
  state.inactiveSeatIndex = null;
  state.singleHandSkippedCount = 0;
}

/** Deals batch 1: four passes of one card each, anti-clockwise from the seat after the dealer. */
function dealBatch1(state: TwentyNineState): void {
  const order = seatOrderFrom(tnNextSeat(state.dealerSeatIndex));
  for (let pass = 0; pass < 4; pass++) {
    for (const seatIndex of order) {
      giveTopCard(state, seatIndex, "batch1");
    }
  }
  state.phase = TnPhase.DEALING_BATCH_1;
}

/** Deals batch 2 exactly like batch 1. */
function dealBatch2(state: TwentyNineState): void {
  const order = seatOrderFrom(tnNextSeat(state.dealerSeatIndex));
  for (let pass = 0; pass < 4; pass++) {
    for (const seatIndex of order) {
      giveTopCard(state, seatIndex, "batch2");
    }
  }
  state.phase = TnPhase.DEALING_BATCH_2;
}

function seatOrderFrom(start: number): number[] {
  return [start, tnNextSeat(start), tnNextSeat(tnNextSeat(start)), tnNextSeat(tnNextSeat(tnNextSeat(start)))];
}

function giveTopCard(state: TwentyNineState, seatIndex: number, target: "batch1" | "batch2"): void {
  const card = state.deck.shift();
  if (!card) throw new Error("deck exhausted while dealing — engine bug");
  const seat = state.seats[seatIndex];
  if (!seat) throw new Error(`missing seat ${seatIndex}`);
  seat[target].push(card);
  seat.hand.push(card);
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

function openBidding(state: TwentyNineState): void {
  // Bidding starts from the player after the dealer, anti-clockwise.
  const first = tnNextSeat(state.dealerSeatIndex);
  state.bids = createBidState(first);
  state.phase = TnPhase.BIDDING;
  state.actingSeatIndex = first;
}

/**
 * Applies a bid or pass (v2 rules):
 * - first bid any 16..28; pass = permanently out of this hand's auction
 * - when YOUR OWN TEAM holds the high bid you may only go strictly higher
 * - when the OPPOSING team holds it you may go higher OR exactly MATCH their
 *   value — but each value can be matched only once (no ping-pong)
 * Ends the auction the moment exactly one non-passed player remains (they win
 * at their own last bid). If ALL FOUR pass, the hand is cancelled and flagged
 * for redeal with the SAME dealer.
 */
export function applyBid(state: TwentyNineState, seatIndex: number, bid?: number): void {
  if (state.phase !== TnPhase.BIDDING) throw new Error("not in the bidding phase");
  const bids = state.bids;
  if (!bids) throw new Error("bid state missing — engine bug");
  if (seatIndex !== bids.turnSeatIndex || seatIndex !== state.actingSeatIndex) {
    throw new Error("not your turn to bid");
  }
  if (bids.passedSeatIndexes.includes(seatIndex)) throw new Error("you already passed this hand");

  const allSeats = [0, 1, 2, 3];

  if (bid === undefined) {
    // ------------------- PASS -------------------
    bids.passedSeatIndexes.push(seatIndex);
    bids.history.push({ seatIndex });
    state.lastMove = { seatIndex, kind: "PASS" };

    const active = activeBidders(bids, allSeats);
    if (active.length === 0) {
      cancelForRedeal(state);
      return;
    }

    // If nobody has bid yet (opening pass):
    if (bids.bidderSeatIndex === null) {
      const nextOpener = nextActiveBidder(bids, tnNextSeat(seatIndex), allSeats);
      if (nextOpener === null) {
        cancelForRedeal(state);
        return;
      }
      bids.turnSeatIndex = nextOpener;
      state.actingSeatIndex = nextOpener;
      return;
    }

    const D = bids.bidderSeatIndex;

    // Case: DEFENDER passes in response to a challenge
    if (seatIndex === D) {
      const newD = bids.challengerSeatIndex;
      if (newD === null || newD === undefined) {
        throw new Error("engine bug: defender passed without an active challenger");
      }
      bids.bidderSeatIndex = newD;
      bids.challengerSeatIndex = null;

      const remaining = activeBidders(bids, allSeats);
      if (remaining.length === 1 && remaining[0] === newD) {
        winBidding(state, newD, bids.highestBid!);
        return;
      }

      // Next challenger in table order after newD
      const nextC = nextActiveBidder(bids, tnNextSeat(newD), allSeats);
      if (nextC === null || nextC === newD) {
        winBidding(state, newD, bids.highestBid!);
        return;
      }
      bids.challengerSeatIndex = nextC;
      bids.turnSeatIndex = nextC;
      state.actingSeatIndex = nextC;
      return;
    }

    // Case: CHALLENGER passes
    if (seatIndex === bids.challengerSeatIndex) {
      bids.challengerSeatIndex = null;

      const remaining = activeBidders(bids, allSeats);
      if (remaining.length === 1 && remaining[0] === D) {
        winBidding(state, D, bids.highestBid!);
        return;
      }

      // Next challenger in table order after the passed challenger
      const nextC = nextActiveBidder(bids, tnNextSeat(seatIndex), allSeats);
      if (nextC === null || nextC === D) {
        winBidding(state, D, bids.highestBid!);
        return;
      }
      bids.challengerSeatIndex = nextC;
      bids.turnSeatIndex = nextC;
      state.actingSeatIndex = nextC;
      return;
    }

    // Fallback for any other pass
    const next = nextActiveBidder(bids, tnNextSeat(seatIndex), allSeats);
    if (next === null || next === D) {
      winBidding(state, D, bids.highestBid!);
      return;
    }
    bids.turnSeatIndex = next;
    state.actingSeatIndex = next;
    return;
  }

  // ------------------- BID (or STAY) -------------------
  validateBid(bids, seatIndex, bid);

  // Case 1: First opening bid of the round
  if (bids.highestBid === null) {
    bids.highestBid = bid;
    bids.bidderSeatIndex = seatIndex;
    bids.history.push({ seatIndex, bid });
    state.lastMove = { seatIndex, kind: "BID", bid };

    const nextC = nextActiveBidder(bids, tnNextSeat(seatIndex), allSeats);
    if (nextC === null || nextC === seatIndex) {
      winBidding(state, seatIndex, bid);
      return;
    }
    bids.challengerSeatIndex = nextC;
    bids.turnSeatIndex = nextC;
    state.actingSeatIndex = nextC;
    return;
  }

  const D = bids.bidderSeatIndex!;
  const H = bids.highestBid;

  // Case 2: Defender responds to challenge
  if (seatIndex === D) {
    const isStay = bid === H;
    bids.history.push({ seatIndex, bid, isStay });
    state.lastMove = { seatIndex, kind: "BID", bid };
    if (!isStay) {
      bids.highestBid = bid;
    }

    // If max bid 28 was matched by defender, challenger cannot bid higher
    if (bids.highestBid >= TN_MAX_BID) {
      winBidding(state, D, bids.highestBid);
      return;
    }

    // Turn goes back to the Challenger
    const C = bids.challengerSeatIndex;
    if (C === null || C === undefined || bids.passedSeatIndexes.includes(C)) {
      const nextC = nextActiveBidder(bids, tnNextSeat(D), allSeats);
      if (nextC === null || nextC === D) {
        winBidding(state, D, bids.highestBid);
        return;
      }
      bids.challengerSeatIndex = nextC;
      bids.turnSeatIndex = nextC;
      state.actingSeatIndex = nextC;
    } else {
      bids.turnSeatIndex = C;
      state.actingSeatIndex = C;
    }
    return;
  }

  // Case 3: Teammate raises
  const sameSide = tnTeamOfSeat(seatIndex) === tnTeamOfSeat(D);
  if (sameSide) {
    bids.highestBid = bid;
    bids.bidderSeatIndex = seatIndex;
    bids.challengerSeatIndex = null;
    bids.history.push({ seatIndex, bid });
    state.lastMove = { seatIndex, kind: "BID", bid };

    const nextC = nextActiveBidder(bids, tnNextSeat(seatIndex), allSeats);
    if (nextC === null || nextC === seatIndex) {
      winBidding(state, seatIndex, bid);
      return;
    }
    bids.challengerSeatIndex = nextC;
    bids.turnSeatIndex = nextC;
    state.actingSeatIndex = nextC;
    return;
  }

  // Case 4: Opponent challenger challenges Defender D
  bids.highestBid = bid;
  bids.challengerSeatIndex = seatIndex;
  bids.history.push({ seatIndex, bid });
  state.lastMove = { seatIndex, kind: "BID", bid };

  // Turn immediately returns to Defender D to Stay / Raise / Pass!
  bids.turnSeatIndex = D;
  state.actingSeatIndex = D;
}

function winBidding(state: TwentyNineState, winner: number, bid: number): void {
  state.bidderSeatIndex = winner;
  state.bid = bid;
  enterTrumpSetup(state);
}

function cancelForRedeal(state: TwentyNineState): void {
  // Same dealer stays; dealerAdvancePending remains untouched.
  state.phase = TnPhase.REDEALING;
  state.actingSeatIndex = null;
  if (state.bids) state.bids.turnSeatIndex = null;
  state.lastMove = null;
}

// ---------------------------------------------------------------------------
// Trump setup — the bid winner integrates the mechanics by CHOOSING one
// ---------------------------------------------------------------------------

function enterTrumpSetup(state: TwentyNineState): void {
  // Every hand: the bid winner decides how trump is established.
  state.phase = TnPhase.TRUMP_SETUP;
  state.actingSeatIndex = state.bidderSeatIndex;
}

/**
 * The bid winner's decision: declare a hidden suit, take the automatic
 * seventh card, or play a joker hand (no suit). Dispatches into the same
 * isolated mechanic modules as before.
 */
export function declareTrumpPlan(
  state: TwentyNineState,
  seatIndex: number,
  choice: TnTrumpChoice
): void {
  if (state.phase !== TnPhase.TRUMP_SETUP) throw new Error("not waiting for a trump declaration");
  if (seatIndex !== state.bidderSeatIndex) throw new Error("only the bid winner may declare trump");
  if (!isTnTrumpChoice(choice)) throw new Error("invalid trump choice");

  if (choice === "JOKER") {
    state.trumpStyle = "JOKER";
    state.trumpSet = true; // no suit exists
    state.lastMove = { seatIndex, kind: "TRUMP_DECLARED" };
    beginPlayAfterTrump(state);
    return;
  }

  if (choice === "SEVENTH_CARD") {
    // Trump depends on the bidder's full 8 cards: deal the second batch,
    // resolve the fixed indicator automatically, validate the hand.
    state.trumpStyle = "SEVENTH_CARD";
    dealBatch2(state);
    resolveSeventhTrump(state);
    return;
  }

  // A suit declaration — hidden regular trump; K+Q marriage potential applies.
  const suit = choice as TnSuit;
  state.trumpStyle = "SUIT";
  state.trumpSuit = suit;
  state.trumpSet = true;
  state.lastMove = { seatIndex, kind: "TRUMP_DECLARED" };
  beginPlayAfterTrump(state);
}

/** Verifies all strict deal invariants before play proceeds. */
export function assertPlayingInvariants(state: TwentyNineState): void {
  let totalCards = 0;
  const allKeys = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const seat = state.seats[i];
    if (!seat) throw new Error(`Invariant failed: seat ${i} is missing`);
    if (seat.batch1.length !== 4) {
      throw new Error(`Invariant failed: seat ${i} batch1 length is ${seat.batch1.length}, expected 4`);
    }
    if (seat.batch2.length !== 4) {
      throw new Error(`Invariant failed: seat ${i} batch2 length is ${seat.batch2.length}, expected 4`);
    }
    if (seat.hand.length !== 8) {
      throw new Error(`Invariant failed: seat ${i} hand length is ${seat.hand.length}, expected 8`);
    }
    const seatKeys = new Set<string>();
    for (const card of seat.hand) {
      const key = `${card.suit}:${card.rank}`;
      if (seatKeys.has(key)) {
        throw new Error(`Invariant failed: duplicate card ${key} within seat ${i}`);
      }
      seatKeys.add(key);
      if (allKeys.has(key)) {
        throw new Error(`Invariant failed: card ${key} dealt to multiple seats`);
      }
      allKeys.add(key);
      totalCards++;
    }
  }
  if (totalCards !== 32) {
    throw new Error(`Invariant failed: total distributed cards = ${totalCards}, expected 32`);
  }
}

/** Automatic SEVENTH_CARD resolution incl. invalid-hand redeal check. */
function resolveSeventhTrump(state: TwentyNineState): void {
  const bidder = state.bidderSeatIndex;
  if (bidder === null) throw new Error("engine bug: no bidder for seventh-card hand");
  const seat = state.seats[bidder];
  if (!seat) throw new Error("engine bug: missing bidder seat");
  const indicator = seventhCardIndicator(seat.batch2);
  state.indicatorCard = indicator;
  const valid = isSeventhTrumpValid(seat.batch1, seat.batch2, indicator);
  if (!valid) {
    cancelForRedeal(state);
    return;
  }
  state.trumpSuit = indicator.suit;
  state.trumpSet = true;
  // All 8 cards remain in bidder's hand; indicatorCard records the trump indicator
  beginPlayAfterTrump(state);
}

function restoreSeventhCardIfLocked(_state: TwentyNineState): void {
  // No-op: all 8 cards remain in hand permanently
}

function countOtherOfSuit(all8: TnCard[], indicator: TnCard): number {
  return all8.filter((c) => c.suit === indicator.suit && c.rank !== indicator.rank).length;
}

function beginPlayAfterTrump(state: TwentyNineState): void {
  // Every style needs the second batch before play; SEVENTH_CARD already
  // dealt it during resolution.
  if (state.seats.every((s) => s.batch2.length === 0)) {
    dealBatch2(state); // sets phase DEALING_BATCH_2
  }
  // Transition to Single Hand decision phase (anti-clockwise from the seat after dealer)
  state.phase = TnPhase.SINGLE_HAND_DECISION;
  state.singleHandSkippedCount = 0;
  const first = tnNextSeat(state.dealerSeatIndex);
  state.actingSeatIndex = first;
  assertPlayingInvariants(state);
}

export function respondSingleHand(
  state: TwentyNineState,
  seatIndex: number,
  declare: boolean
): void {
  if (state.phase !== TnPhase.SINGLE_HAND_DECISION) {
    throw new Error("not in the single-hand decision phase");
  }
  if (state.actingSeatIndex !== seatIndex) {
    throw new Error("not your turn to decide single-hand");
  }

  if (declare) {
    state.isSingleHand = true;
    state.singleHandSeatIndex = seatIndex;
    state.inactiveSeatIndex = (seatIndex + 2) % TN_SEAT_COUNT; // partner sits out
    // No trump is used in Single Hand
    state.trumpStyle = null;
    state.trumpSet = false;
    state.trumpRevealed = false;
    state.trumpSuit = null;
    state.indicatorCard = null;
    state.marriageDeclaredBy = null;

    // Single Hand player leads Trick 1
    state.phase = TnPhase.PLAYING;
    state.ledSeatIndex = seatIndex;
    state.actingSeatIndex = seatIndex;
    state.trickNumber = 1;
    state.lastMove = { seatIndex, kind: "DECLARE_SINGLE_HAND" };
    assertPlayingInvariants(state);
    return;
  }

  // Skipped Single Hand
  state.lastMove = { seatIndex, kind: "SKIP_SINGLE_HAND" };
  state.singleHandSkippedCount += 1;
  if (state.singleHandSkippedCount >= TN_SEAT_COUNT) {
    // All 4 players passed on Single Hand -> start standard play
    const leader = tnNextSeat(state.dealerSeatIndex);
    state.phase = TnPhase.PLAYING;
    state.ledSeatIndex = leader;
    state.actingSeatIndex = leader;
    state.trickNumber = 1;
    assertPlayingInvariants(state);
  } else {
    // Advance to next player anti-clockwise
    state.actingSeatIndex = tnNextSeat(seatIndex);
  }
}

/**
 * Private info destined for the bid winner ONLY (server routes it to that
 * one socket): the choose-trump prompt, then the seventh-card indicator if
 * they picked that style.
 */
export function getBidderPrivatePayload(state: TwentyNineState): TnBidderPrivatePayload | null {
  const handNumber = state.roundNumber;
  if (state.phase === TnPhase.TRUMP_SETUP && !state.trumpSet) {
    return { kind: "CHOOSE_TRUMP", handNumber };
  }
  if (
    !state.isSingleHand &&
    state.trumpStyle === "SEVENTH_CARD" &&
    state.indicatorCard &&
    !state.trumpRevealed
  ) {
    return { kind: "SEVENTH_INDICATOR", handNumber, indicatorCard: state.indicatorCard };
  }
  if (
    !state.isSingleHand &&
    state.trumpStyle === "SUIT" &&
    state.trumpSuit &&
    !state.trumpRevealed
  ) {
    return { kind: "SUIT_DECLARED", handNumber, suit: state.trumpSuit };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

/**
 * Automatically activates marriage (K+Q of active trump suit) upon trump reveal
 * if any player currently holds BOTH King and Queen in their remaining hand.
 *
 * Rules:
 * - Only activates when trump is revealed.
 * - If one of K or Q was already played before trump was revealed, it is no
 *   longer in seat.hand, so holdsMarriage returns false and marriage cannot happen.
 * - Adjusts requirement by ±4 points (bidding team: bid - 4, min 16; defending team: bid + 4).
 */
export function autoActivateMarriageIfHeld(state: TwentyNineState): boolean {
  if (state.isSingleHand) return false;
  if (state.marriageDeclaredBy !== null) return false;
  if (state.trumpStyle === "JOKER") return false;
  if (!state.trumpRevealed || !state.trumpSuit) return false;

  for (let i = 0; i < 4; i++) {
    const seat = state.seats[i];
    if (seat && holdsMarriage(seat.hand, state.trumpSuit)) {
      state.marriageDeclaredBy = tnTeamOfSeat(i);
      return true;
    }
  }
  return false;
}

/** Reveal hidden trump. Only on your turn, only while void in the led suit; never consumes the turn. */
export function callTrump(state: TwentyNineState, seatIndex: number): void {
  if (state.isSingleHand) throw new Error("trump cannot be used during single hand");
  if (state.phase !== TnPhase.PLAYING) throw new Error("not in the playing phase");
  if (state.actingSeatIndex !== seatIndex) throw new Error("not your turn");
  if (!state.trumpSet) throw new Error("trump has not been determined yet");
  if (state.trumpRevealed) throw new Error("trump is already revealed");
  if (state.currentTrick.length === 0) throw new Error("cannot call trump before a card is led");
  const ledSuit = ledSuitOf(state);
  const hand = handOf(state, seatIndex);
  if (hand.some((c) => c.suit === ledSuit)) {
    throw new Error("you can only call trump when you cannot follow suit");
  }
  state.trumpRevealed = true;
  restoreSeventhCardIfLocked(state);
  autoActivateMarriageIfHeld(state);
  state.lastMove = { seatIndex, kind: "CALL_TRUMP" };
}

/** Declare a marriage: caller must hold K+Q of the ACTIVE trump suit. Reveals trump. */
export function declareMarriage(state: TwentyNineState, seatIndex: number, suit: TnSuit): void {
  if (state.isSingleHand) throw new Error("marriages cannot be declared during single hand");
  if (state.phase !== TnPhase.PLAYING) throw new Error("marriage can only be declared during play");
  if (state.marriageDeclaredBy !== null) throw new Error("marriage already declared this round");
  if (state.trumpStyle === "JOKER") throw new Error("joker hands have no suit for marriages");
  if (!state.trumpSet || !state.trumpSuit) throw new Error("trump not determined yet");
  if (suit !== state.trumpSuit) {
    throw new Error("that suit is not trump - invalid marriage claim");
  }
  const hand = handOf(state, seatIndex);
  if (!holdsMarriage(hand, suit)) {
    throw new Error("you do not hold the King and Queen required for that marriage");
  }
  state.marriageDeclaredBy = tnTeamOfSeat(seatIndex);
  state.trumpRevealed = true; // marriage reveal makes trump public
  restoreSeventhCardIfLocked(state);
  state.lastMove = { seatIndex, kind: "DECLARE_MARRIAGE" };
}

function handOf(state: TwentyNineState, seatIndex: number): TnCard[] {
  const seat = state.seats[seatIndex];
  if (!seat) throw new Error(`missing seat ${seatIndex}`);
  return seat.hand;
}

function ledSuitOf(state: TwentyNineState): TnSuit {
  const led = state.currentTrick[0];
  if (!led) throw new Error("no card led yet — engine bug");
  return led.card.suit;
}

/** Plays a card into the current trick. Follow-suit enforced; auto-resolves complete tricks. */
export function playCard(state: TwentyNineState, seatIndex: number, card: TnCard): void {
  if (state.phase !== TnPhase.PLAYING) throw new Error("not in the playing phase");
  if (state.actingSeatIndex !== seatIndex) throw new Error("not your turn");
  if (state.isSingleHand && state.inactiveSeatIndex === seatIndex) {
    throw new Error("partner is sitting out during single hand");
  }
  const seat = state.seats[seatIndex];
  if (!seat) throw new Error(`missing seat ${seatIndex}`);
  const owned = seat.hand.find((c) => c.suit === card.suit && c.rank === card.rank);
  if (!owned) throw new Error("you do not hold that card");
  const legal = legalCards(seat.hand, state.currentTrick.length > 0 ? ledSuitOf(state) : null);
  if (!legal.some((c) => c.suit === card.suit && c.rank === card.rank)) {
    throw new Error("must follow suit");
  }

  const beforeLen = seat.hand.length;
  seat.hand = seat.hand.filter((c) => !(c.suit === card.suit && c.rank === card.rank));
  const afterLen = seat.hand.length;
  if (process.env.NODE_ENV !== "test" || process.env.TN_DEBUG === "1") {
    console.log(
      `[CARD_REMOVE ${state.gameId}] seat=${seatIndex} card=${card.suit}:${card.rank} reason=PLAY_CARD ` +
        `phase=${state.phase} round=${state.roundNumber} handLenBefore=${beforeLen} handLenAfter=${afterLen} ` +
        `b1=${seat.batch1.length} b2=${seat.batch2.length}`
    );
  }
  state.currentTrick.push({ seatIndex, card });
  state.lastMove = { seatIndex, kind: "PLAY", card };

  const requiredPlays = state.isSingleHand ? 3 : 4;
  if (state.currentTrick.length < requiredPlays) {
    state.actingSeatIndex = tnNextActiveSeat(seatIndex, state.inactiveSeatIndex);
    return;
  }
  completeTrick(state);
}

function completeTrick(state: TwentyNineState): void {
  const plays = [...state.currentTrick];
  const ledPlay = plays[0];
  if (!ledPlay) throw new Error("engine bug: completing an empty trick");
  const winner = resolveWinner(plays, ledPlay.card.suit, {
    jokerMode: state.trumpStyle === "JOKER",
    trumpSuit: state.isSingleHand ? null : state.trumpSuit,
    trumpRevealed: state.isSingleHand ? false : state.trumpRevealed,
  });

  let points = plays.reduce((sum, p) => sum + tnCardPoints(p.card), 0);
  const winnerTeam = tnTeamOfSeat(winner.seatIndex);

  if (state.trickNumber === TN_TRICKS_PER_HAND) {
    points += 1; // last-trick bonus -> grand total becomes 29
  }
  state.capturedPoints[winnerTeam] += points;
  state.tricksWon[winnerTeam] += 1;
  state.currentTrick = [];

  // Single Hand scoring and early-end logic
  if (state.isSingleHand && state.singleHandSeatIndex !== null) {
    if (winner.seatIndex !== state.singleHandSeatIndex) {
      // Lost even one trick -> immediate failure, opponent gets +3 points
      finishHand(state, { scorePoints: 3, endReason: "SINGLE_HAND_FAIL" });
      return;
    }
    // Single Hand player won this trick
    if (state.trickNumber === TN_TRICKS_PER_HAND) {
      // Won all 8 tricks -> +3 points to Single Hand player's team
      finishHand(state, { scorePoints: 3, endReason: "SINGLE_HAND_WIN" });
      return;
    }
    state.trickNumber += 1;
    state.ledSeatIndex = winner.seatIndex;
    state.actingSeatIndex = winner.seatIndex;
    return;
  }

  const bidder = state.bidderSeatIndex;
  if (bidder === null || state.bid === null) {
    throw new Error("engine bug: finishing without a bid");
  }
  const biddingTeam = tnTeamOfSeat(bidder);
  const defendingTeam = otherTeam(biddingTeam);
  const requirement = marriageAdjustedRequirement(state.bid, state.marriageDeclaredBy, biddingTeam);

  // 1. If all 8 tricks have been completed:
  if (state.trickNumber === TN_TRICKS_PER_HAND) {
    if (state.tricksWon[biddingTeam] === 8) {
      finishHand(state, { scorePoints: 2, endReason: "FULL_BOARD" });
    } else {
      finishHand(state, { scorePoints: 1, endReason: "NORMAL" });
    }
    return;
  }

  // 2. Early round completion (tricks 1..7):
  // Check A: Bidder reached the required points:
  // If the bidding team already captured >= requirement, they win the round.
  // However, if defenders have won 0 tricks, the bidding team can still achieve Full Board (8 tricks = 2 pts).
  // Therefore, the round ends early only when Full Board is no longer possible (defenders won >= 1 trick).
  if (state.capturedPoints[biddingTeam] >= requirement) {
    const fullBoardPossible = state.tricksWon[defendingTeam] === 0;
    if (!fullBoardPossible) {
      finishHand(state, { scorePoints: 1, endReason: "EARLY_BID_REACHED" });
      return;
    }
  }

  // Check B: Defenders defeated the bidder:
  // If defenders have captured > (29 - requirement), bidder cannot reach the requirement.
  if (state.capturedPoints[defendingTeam] > 29 - requirement) {
    finishHand(state, { scorePoints: 1, endReason: "EARLY_DEFEAT" });
    return;
  }
  
  state.trickNumber += 1;
  state.ledSeatIndex = winner.seatIndex; // winner leads next
  state.actingSeatIndex = winner.seatIndex;

  // If entering the 8th (final) trick and 7th card was never called/revealed,
  // it must automatically be revealed and returned to bidder's hand for the final trick.
  if (state.trickNumber === TN_TRICKS_PER_HAND && !state.trumpRevealed && state.trumpStyle === "SEVENTH_CARD") {
    state.trumpRevealed = true;
    restoreSeventhCardIfLocked(state);
    autoActivateMarriageIfHeld(state);
  }
}

// ---------------------------------------------------------------------------
// Scoring & match end
// ---------------------------------------------------------------------------

function finishHand(
  state: TwentyNineState,
  options?: {
    scorePoints?: number;
    endReason?: "NORMAL" | "EARLY_BID_REACHED" | "EARLY_DEFEAT" | "FULL_BOARD" | "SINGLE_HAND_WIN" | "SINGLE_HAND_FAIL";
  }
): void {
  const totals = state.capturedPoints;
  const endReason = options?.endReason ?? "NORMAL";
  const scorePoints = options?.scorePoints ?? 1;

  if (state.isSingleHand && state.singleHandSeatIndex !== null) {
    const singleHandTeam = tnTeamOfSeat(state.singleHandSeatIndex);
    const opponentTeam = otherTeam(singleHandTeam);
    const roundWinner = endReason === "SINGLE_HAND_WIN" ? singleHandTeam : opponentTeam;

    if (endReason === "SINGLE_HAND_WIN") {
      state.matchScore[singleHandTeam] += scorePoints;
    } else {
      state.matchScore[singleHandTeam] -= scorePoints;
    }

    state.roundHistory.push(roundWinner);
    state.dealerAdvancePending = true;
    state.ledSeatIndex = null;
    state.actingSeatIndex = null;

    state.lastRoundSummary = {
      roundNumber: state.roundNumber,
      bid: state.bid ?? 16,
      bidderSeatIndex: state.singleHandSeatIndex,
      biddingTeam: singleHandTeam,
      requirement: 0,
      captured: { A: totals.A, B: totals.B },
      winnerTeam: roundWinner,
      marriageTeam: null,
      matchScoreAfter: { A: state.matchScore.A, B: state.matchScore.B },
      trumpStyle: null,
      scoreAwarded: endReason === "SINGLE_HAND_WIN" ? scorePoints : -scorePoints,
      endReason,
      isSingleHand: true,
      singleHandSeatIndex: state.singleHandSeatIndex,
    };

    if (
      state.matchScore[roundWinner] >= state.roundsToWin ||
      state.matchScore[singleHandTeam] <= -state.roundsToWin
    ) {
      state.winnerTeam =
        state.matchScore[roundWinner] >= state.roundsToWin
          ? roundWinner
          : opponentTeam;
      state.phase = TnPhase.MATCH_OVER;
    } else {
      state.phase = TnPhase.ROUND_SCORED;
    }
    return;
  }

  if (endReason === "NORMAL" && totals.A + totals.B !== 29) {
    // Hard invariant from the ruleset: normally completed hands ALWAYS sum to 29.
    throw new Error(
      `ENGINE BUG: captured points sum to ${totals.A + totals.B}, expected exactly 29`
    );
  }
  
  const bidder = state.bidderSeatIndex;
  if (bidder === null || state.bid === null) throw new Error("engine bug: finishing without a bid");
  const biddingTeam = tnTeamOfSeat(bidder);
  const defendingTeam = otherTeam(biddingTeam);
  const requirement = marriageAdjustedRequirement(state.bid, state.marriageDeclaredBy, biddingTeam);
  
  let roundWinner: TnTeam;
  let bidderWon: boolean;
  if (endReason === "EARLY_DEFEAT") {
    roundWinner = defendingTeam;
    bidderWon = false;
  } else {
    bidderWon = totals[biddingTeam] >= requirement;
    roundWinner = bidderWon ? biddingTeam : defendingTeam;
  }
  
  if (bidderWon) {
    state.matchScore[biddingTeam] += scorePoints;
  } else {
    state.matchScore[biddingTeam] -= scorePoints;
  }

  state.roundHistory.push(roundWinner);
  state.dealerAdvancePending = true;
  state.ledSeatIndex = null;
  state.actingSeatIndex = null;
  
  state.lastRoundSummary = {
    roundNumber: state.roundNumber,
    bid: state.bid,
    bidderSeatIndex: bidder,
    biddingTeam,
    requirement,
    captured: { A: totals.A, B: totals.B },
    winnerTeam: roundWinner,
    marriageTeam: state.marriageDeclaredBy,
    matchScoreAfter: { A: state.matchScore.A, B: state.matchScore.B },
    trumpStyle: state.trumpStyle ?? "SUIT",
    scoreAwarded: bidderWon ? scorePoints : -scorePoints,
    endReason,
    isSingleHand: false,
    singleHandSeatIndex: null,
  };

  if (
    state.matchScore.A >= state.roundsToWin ||
    state.matchScore.B <= -state.roundsToWin
  ) {
    state.winnerTeam = "A";
    state.phase = TnPhase.MATCH_OVER;
  } else if (
    state.matchScore.B >= state.roundsToWin ||
    state.matchScore.A <= -state.roundsToWin
  ) {
    state.winnerTeam = "B";
    state.phase = TnPhase.MATCH_OVER;
  } else {
    state.phase = TnPhase.ROUND_SCORED;
  }
}

export function otherTeam(team: TnTeam): TnTeam {
  return team === "A" ? "B" : "A";
}

// ---------------------------------------------------------------------------
// Legality surface shared with the web client mirror + integration tests
// ---------------------------------------------------------------------------

export interface SeatMoveOptions {
  legalCards: TnCard[];
  canCallTrump: boolean;
  canDeclareMarriage: boolean;
}

export function moveOptionsForSeat(state: TwentyNineState, seatIndex: number): SeatMoveOptions {
  if (state.phase !== TnPhase.PLAYING || state.actingSeatIndex !== seatIndex) {
    return { legalCards: [], canCallTrump: false, canDeclareMarriage: false };
  }
  if (state.isSingleHand && state.inactiveSeatIndex === seatIndex) {
    return { legalCards: [], canCallTrump: false, canDeclareMarriage: false };
  }
  const hand = handOf(state, seatIndex);
  const led = state.currentTrick.length > 0 ? ledSuitOf(state) : null;
  const canCallTrump =
    !state.isSingleHand &&
    state.trumpSet &&
    !state.trumpRevealed &&
    state.currentTrick.length > 0 &&
    !hand.some((c) => c.suit === led);
  // Marriage is automatically triggered on trump reveal rather than manually declared.
  const canDeclareMarriage = false;
  return { legalCards: legalCards(hand, led), canCallTrump, canDeclareMarriage };
}

/** Lowest-ranked legal card by normal ranking — used for offline-fallback autoplay + bots. */
export function lowestLegalCard(state: TwentyNineState, seatIndex: number): TnCard | null {
  const { legalCards: legal } = moveOptionsForSeat(state, seatIndex);
  if (legal.length === 0) return null;
  return legal.reduce((low, c) => (TN_RANK_WEIGHT[c.rank] < TN_RANK_WEIGHT[low.rank] ? c : low));
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** Broadcast-safe public snapshot. Contains NO hands, NO hidden suit, NO deck. */
export function toPublicTwentyNineState(
  state: TwentyNineState,
  extras?: { roomCode?: string; hostSeatIndex?: number | null }
): PublicTwentyNineState {
  const trumpView: TnTrumpView =
    state.isSingleHand || state.trumpStyle === null
      ? { state: "NOT_SET" }
      : !state.trumpRevealed
        ? { state: "HIDDEN" }
        : state.trumpStyle === "JOKER"
          ? { state: "JOKER_MODE" }
          : { state: "REVEALED", suit: state.trumpSuit as TnSuit, card: state.indicatorCard ?? undefined };

  const seats: TnSeatView[] = state.seats.map((s) => ({
    seatIndex: s.seatIndex,
    username: s.username,
    avatar: s.avatar,
    team: tnTeamOfSeat(s.seatIndex),
    status: s.username === null ? "EMPTY" : s.connected ? "SEATED" : "DISCONNECTED",
    cardsRemaining: s.hand.length,
    isInactive: state.isSingleHand ? s.seatIndex === state.inactiveSeatIndex : false,
    isBot: s.isBot,
  }));

  return {
    gameType: "TWENTY_NINE",
    gameId: state.gameId,
    roomCode: extras?.roomCode,
    phase: state.phase,
    seats,
    dealerSeatIndex: state.dealerSeatIndex,
    trumpStyle: state.trumpStyle,
    trump: trumpView,
    bid: state.bid,
    bidderSeatIndex: state.bidderSeatIndex,
    marriageDeclaredBy: state.marriageDeclaredBy,
    bids: state.bids
      ? {
          highestBid: state.bids.highestBid,
          bidderSeatIndex: state.bids.bidderSeatIndex,
          passedSeatIndexes: [...state.bids.passedSeatIndexes],
          turnSeatIndex: state.bids.turnSeatIndex,
          history: state.bids.history.map((h) => ({ ...h })),
        }
      : null,
    trick: state.currentTrick.map((p) => ({ seatIndex: p.seatIndex, card: { ...p.card } })),
    ledSeatIndex: state.ledSeatIndex,
    tricksWon: { ...state.tricksWon },
    capturedPoints: { ...state.capturedPoints },
    roundNumber: state.roundNumber,
    matchScore: { ...state.matchScore },
    roundHistory: [...state.roundHistory],
    roundsToWin: state.roundsToWin,
    winnerTeam: state.winnerTeam,
    lastRoundSummary: state.lastRoundSummary ? { ...state.lastRoundSummary } : null,
    actingSeatIndex: state.actingSeatIndex,
    offlineFallback: null, // server fills this when an offline seat's turn is pending
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    isSingleHand: state.isSingleHand,
    singleHandSeatIndex: state.singleHandSeatIndex,
    inactiveSeatIndex: state.inactiveSeatIndex,
    hostSeatIndex: extras?.hostSeatIndex ?? null,
  };
}
