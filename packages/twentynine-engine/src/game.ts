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
import { createTnDeck, shuffleTnDeck, tnNextSeat } from "./deck";
import { activeBidders, createBidState, nextActiveBidder, validateBid } from "./bidding";
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
  winnerTeam: TnTeam | null;
  lastRoundSummary: PublicTwentyNineState["lastRoundSummary"];
  actingSeatIndex: number | null;
  lastMove: PublicTwentyNineState["lastMove"];
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
    winnerTeam: null,
    lastRoundSummary: null,
    actingSeatIndex: null,
    lastMove: null,
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

  if (bid === undefined) {
    bids.history.push({ seatIndex });
    bids.passedSeatIndexes.push(seatIndex);
    state.lastMove = { seatIndex, kind: "PASS" };
  } else {
    validateBid(bids, seatIndex, bid);
    bids.highestBid = bid;
    bids.bidderSeatIndex = seatIndex;
    bids.history.push({ seatIndex, bid });
    state.lastMove = { seatIndex, kind: "BID", bid };
  }

  const allSeats = [0, 1, 2, 3];
  const active = activeBidders(bids, allSeats);

  if (active.length === 0) {
    cancelForRedeal(state);
    return;
  }

  if (active.length === 1 && bids.highestBid !== null) {
    const winner = active[0];
    if (winner === undefined) throw new Error("engine bug: empty winner");
    if (winner !== bids.bidderSeatIndex) {
      throw new Error("engine bug: last remaining bidder never placed a bid");
    }
    winBidding(state, winner, bids.highestBid);
    return;
  }

  const next = nextActiveBidder(bids, tnNextSeat(seatIndex), allSeats);
  if (next === null) {
    cancelForRedeal(state);
    return;
  }
  bids.turnSeatIndex = next;
  state.actingSeatIndex = next;
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

/** Automatic SEVENTH_CARD resolution incl. invalid-hand redeal check. */
function resolveSeventhTrump(state: TwentyNineState): void {
  const bidder = state.bidderSeatIndex;
  if (bidder === null) throw new Error("engine bug: no bidder for seventh-card hand");
  const seat = state.seats[bidder];
  if (!seat) throw new Error("engine bug: missing bidder seat");
  const indicator = seventhCardIndicator(seat.batch2);
  state.indicatorCard = indicator;
  const valid =
    isSeventhTrumpValid(seat.batch1, seat.batch2, indicator) &&
    countOtherOfSuit([...seat.batch1, ...seat.batch2], indicator) > 0;
  if (!valid) {
    cancelForRedeal(state);
    return;
  }
  state.trumpSuit = indicator.suit;
  state.trumpSet = true;
  beginPlayAfterTrump(state);
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
  // First trick led by the player after the dealer (anti-clockwise),
  // matching the bidding start convention.
  const leader = tnNextSeat(state.dealerSeatIndex);
  state.phase = TnPhase.PLAYING;
  state.ledSeatIndex = leader;
  state.actingSeatIndex = leader;
  state.trickNumber = 1;
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
    state.trumpStyle === "SEVENTH_CARD" &&
    state.indicatorCard &&
    !state.trumpRevealed
  ) {
    return { kind: "SEVENTH_INDICATOR", handNumber, indicatorCard: state.indicatorCard };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

/** Reveal hidden trump. Only on your turn, only while void in the led suit; never consumes the turn. */
export function callTrump(state: TwentyNineState, seatIndex: number): void {
  if (state.phase !== TnPhase.PLAYING) throw new Error("not in the playing phase");
  if (state.actingSeatIndex !== seatIndex) throw new Error("not your turn");
  if (state.trumpStyle === "JOKER") throw new Error("joker hands have no trump to reveal");
  if (!state.trumpSet) throw new Error("trump has not been determined yet");
  if (state.trumpRevealed) throw new Error("trump is already revealed");
  if (state.currentTrick.length === 0) throw new Error("cannot call trump before a card is led");
  const ledSuit = ledSuitOf(state);
  const hand = handOf(state, seatIndex);
  if (hand.some((c) => c.suit === ledSuit)) {
    throw new Error("you can only call trump when you cannot follow suit");
  }
  state.trumpRevealed = true;
  state.lastMove = { seatIndex, kind: "CALL_TRUMP" };
}

/** Declare a marriage: caller must hold K+Q of the ACTIVE trump suit. Reveals trump. */
export function declareMarriage(state: TwentyNineState, seatIndex: number, suit: TnSuit): void {
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
  const seat = state.seats[seatIndex];
  if (!seat) throw new Error(`missing seat ${seatIndex}`);
  const owned = seat.hand.find((c) => c.suit === card.suit && c.rank === card.rank);
  if (!owned) throw new Error("you do not hold that card");
  const legal = legalCards(seat.hand, state.currentTrick.length > 0 ? ledSuitOf(state) : null);
  if (!legal.some((c) => c.suit === card.suit && c.rank === card.rank)) {
    throw new Error("must follow suit");
  }

  seat.hand = seat.hand.filter((c) => !(c.suit === card.suit && c.rank === card.rank));
  state.currentTrick.push({ seatIndex, card });
  state.lastMove = { seatIndex, kind: "PLAY", card };

  if (state.currentTrick.length < 4) {
    state.actingSeatIndex = tnNextSeat(seatIndex);
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
    trumpSuit: state.trumpSuit,
    trumpRevealed: state.trumpRevealed,
  });

  let points = plays.reduce((sum, p) => sum + tnCardPoints(p.card), 0);
  const winnerTeam = tnTeamOfSeat(winner.seatIndex);

  if (state.trickNumber === TN_TRICKS_PER_HAND) {
    points += 1; // last-trick bonus -> grand total becomes 29
  }
  state.capturedPoints[winnerTeam] += points;
  state.tricksWon[winnerTeam] += 1;
  state.currentTrick = [];

  if (state.trickNumber === TN_TRICKS_PER_HAND) {
    finishHand(state);
    return;
  }
  state.trickNumber += 1;
  state.ledSeatIndex = winner.seatIndex; // winner leads next
  state.actingSeatIndex = winner.seatIndex;
}

// ---------------------------------------------------------------------------
// Scoring & match end
// ---------------------------------------------------------------------------

function finishHand(state: TwentyNineState): void {
  const totals = state.capturedPoints;
  if (totals.A + totals.B !== 29) {
    // Hard invariant from the ruleset: completed hands ALWAYS sum to 29.
    throw new Error(
      `ENGINE BUG: captured points sum to ${totals.A + totals.B}, expected exactly 29`
    );
  }
  const bidder = state.bidderSeatIndex;
  if (bidder === null || state.bid === null) throw new Error("engine bug: finishing without a bid");
  const biddingTeam = tnTeamOfSeat(bidder);
  const requirement = marriageAdjustedRequirement(state.bid, state.marriageDeclaredBy, biddingTeam);
  const made = totals[biddingTeam] >= requirement;
  const roundWinner: TnTeam = made ? biddingTeam : otherTeam(biddingTeam);
  state.matchScore[roundWinner] += 1;
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
  };

  if (state.matchScore[roundWinner] >= state.roundsToWin) {
    state.winnerTeam = roundWinner;
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
  const hand = handOf(state, seatIndex);
  const led = state.currentTrick.length > 0 ? ledSuitOf(state) : null;
  const canCallTrump =
    state.trumpStyle !== "JOKER" &&
    state.trumpSet &&
    !state.trumpRevealed &&
    state.currentTrick.length > 0 &&
    !hand.some((c) => c.suit === led);
  const canDeclareMarriage =
    state.marriageDeclaredBy === null &&
    !!state.trumpSuit &&
    holdsMarriage(hand, state.trumpSuit);
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
  extras?: { roomCode?: string }
): PublicTwentyNineState {
  const trumpView: TnTrumpView =
    state.trumpStyle === null
      ? { state: "NOT_SET" }
      : state.trumpStyle === "JOKER"
        ? { state: "JOKER_MODE" }
        : state.trumpRevealed
          ? { state: "REVEALED", suit: state.trumpSuit as TnSuit }
          : { state: "HIDDEN" };

  const seats: TnSeatView[] = state.seats.map((s) => ({
    seatIndex: s.seatIndex,
    username: s.username,
    avatar: s.avatar,
    team: tnTeamOfSeat(s.seatIndex),
    status: s.username === null ? "EMPTY" : s.connected ? "SEATED" : "DISCONNECTED",
    cardsRemaining: s.hand.length,
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
    roundsToWin: state.roundsToWin,
    winnerTeam: state.winnerTeam,
    lastRoundSummary: state.lastRoundSummary ? { ...state.lastRoundSummary } : null,
    actingSeatIndex: state.actingSeatIndex,
    offlineFallback: null, // server fills this when an offline seat's turn is pending
    lastMove: state.lastMove ? { ...state.lastMove } : null,
  };
}
