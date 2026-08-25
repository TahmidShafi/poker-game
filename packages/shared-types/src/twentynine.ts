// =============================================================================
// TWENTY-NINE (29) PROTOCOL — deliberately independent of the poker types.
// No type in this file may import from ./card, ./game, ./hand or ./events.
// The public state below must NEVER carry: other players' hands, the hidden
// trump suit (pre-reveal), deck order or future cards. Hands travel only via
// the private YOUR_TN_HAND / TN_BIDDER_PRIVATE events, one socket at a time.
//
// All four traditional trump mechanics are INTEGRATED into gameplay: there is
// no room-level mode. Each hand, the bid winner chooses how to set trump —
// declare a suit, take the automatic 7th card, or go Joker (no suit).
// =============================================================================

// ---- Cards ------------------------------------------------------------------

export type TnSuit = "SPADES" | "HEARTS" | "DIAMONDS" | "CLUBS";

/** 32-card deck ranks only: 7,8,9,10,J,Q,K,A. */
export type TnRank = 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface TnCard {
  suit: TnSuit;
  rank: TnRank;
}

export const TN_RANK_LABELS: Record<TnRank, string> = {
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export const TN_SUIT_SYMBOLS: Record<TnSuit, string> = {
  SPADES: "\u2660",
  HEARTS: "\u2665",
  DIAMONDS: "\u2666",
  CLUBS: "\u2663",
};

/** Card points: J=3, 9=2, A=1, 10=1; K/Q/8/7 = 0. Exactly 7 per suit, 28 total. */
export function tnCardPoints(card: TnCard): number {
  switch (card.rank) {
    case 11:
      return 3; // J
    case 9:
      return 2; // 9
    case 14:
      return 1; // A
    case 10:
      return 1; // 10
    default:
      return 0;
  }
}

export function tnCardsEqual(a: TnCard, b: TnCard): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function tnCardToString(card: TnCard): string {
  return `${TN_RANK_LABELS[card.rank]}${TN_SUIT_SYMBOLS[card.suit]}`;
}

// ---- Game type ----------------------------------------------------------------

export type GameType = "POKER" | "TWENTY_NINE";

/**
 * How trump is established for the CURRENT hand — chosen by the bid winner
 * at trump setup (there is no room-level mode):
 *  - SUIT: bidder declares a hidden suit (marriage K+Q bonus applies to it)
 *  - SEVENTH_CARD: automatic — suit of the fixed 3rd card of the bidder's
 *    second batch (redeal if it is their sole card of that suit)
 *  - JOKER: no suit; J > 9 > A > 10 are universal power ranks
 */
export type TnTrumpStyle = "SUIT" | "SEVENTH_CARD" | "JOKER";

/** What the bid winner may pick at trump setup. */
export type TnTrumpChoice = TnSuit | TnTrumpStyle;

export function isTnTrumpChoice(v: unknown): v is TnTrumpChoice {
  if (v === "SEVENTH_CARD" || v === "JOKER") return true;
  return typeof v === "string" && ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"].includes(v);
}

// ---- Seats & teams ------------------------------------------------------------

export type TnTeam = "A" | "B";

/** Team A owns seats 0 and 2; Team B owns seats 1 and 3. */
export function tnTeamOfSeat(seatIndex: number): TnTeam {
  return seatIndex % 2 === 0 ? "A" : "B";
}

export type TnSeatStatus = "EMPTY" | "SEATED" | "DISCONNECTED";

/** Public view of one seat — contains no card information, ever. */
export interface TnSeatView {
  seatIndex: number;
  username: string | null;
  avatar?: number;
  team: TnTeam;
  status: TnSeatStatus;
  /** Public knowledge in trick-taking: everyone sees played cards, so remaining card count is derivable/public. */
  cardsRemaining: number;
}

// ---- Phases -------------------------------------------------------------------

/**
 * Lifecycle of one 29 room.
 * REDEALING is the cancelled-hand path (all-pass bidding or invalid seventh-
 * card trump): cards are collected, reshuffled and redealt with the SAME
 * dealer — the dealer only advances after a hand completes normally.
 */
export enum TnPhase {
  WAITING_FOR_PLAYERS = "WAITING_FOR_PLAYERS",
  DEALING_BATCH_1 = "DEALING_BATCH_1",
  BIDDING = "BIDDING",
  TRUMP_SETUP = "TRUMP_SETUP", // bid winner chooses style (+suit when SUIT)
  DEALING_BATCH_2 = "DEALING_BATCH_2",
  PLAYING = "PLAYING",
  ROUND_SCORED = "ROUND_SCORED", // round summary on screen before next deal
  MATCH_OVER = "MATCH_OVER",
  REDEALING = "REDEALING",
}

// ---- Bidding ------------------------------------------------------------------

export interface TnBidState {
  highestBid: number | null;
  bidderSeatIndex: number | null;
  /** Seats that passed are permanently out of this hand's bidding. */
  passedSeatIndexes: number[];
  /** Seat whose turn it is to bid/pass right now. */
  turnSeatIndex: number | null;
  /** Chronological log for UI display (and match-once tie legality). */
  history: { seatIndex: number; bid?: number }[];
}

// ---- Tricks & play ------------------------------------------------------------

export interface TnTrickPlay {
  seatIndex: number;
  card: TnCard;
}

export interface TnTeamTotals {
  A: number;
  B: number;
}

// ---- Trump visibility -----------------------------------------------------------

/**
 * What ANY given client may know about trump. The hidden suit exists ONLY in
 * server memory and in the bidder's private channel — never here pre-reveal.
 */
export type TnTrumpView =
  | { state: "NOT_SET" }
  | { state: "HIDDEN" }
  | { state: "REVEALED"; suit: TnSuit }
  | { state: "JOKER_MODE" }; // joker hand: no suit by design

// ---- Round summary -------------------------------------------------------------

export interface TnRoundSummary {
  roundNumber: number;
  bid: number;
  bidderSeatIndex: number;
  biddingTeam: TnTeam;
  requirement: number; // bid ± marriage adjustment
  captured: TnTeamTotals; // always sums to exactly 29
  winnerTeam: TnTeam;
  /** Team that declared a valid marriage this round, if any. */
  marriageTeam: TnTeam | null;
  matchScoreAfter: TnTeamTotals;
  trumpStyle: TnTrumpStyle;
}

// ---- Turn timing (offline fallback only) ----------------------------------------

/**
 * Connected players NEVER have deadlines. This appears only while a
 * DISCONNECTED seat's turn is pending: if they do not reconnect before
 * `deadline` (server epoch-ms) the server auto-plays for them
 * (bidding → pass, card play → lowest legal card). Bots never appear here.
 */
export interface TnOfflineFallback {
  seatIndex: number;
  deadline: number;
}

// ---- Moves feed (UX flash) -------------------------------------------------------

export type TnMoveKind =
  | "BID"
  | "PASS"
  | "TRUMP_DECLARED"
  | "CALL_TRUMP"
  | "DECLARE_MARRIAGE"
  | "PLAY";

export interface TnLastMove {
  seatIndex: number;
  kind: TnMoveKind;
  bid?: number;
  card?: TnCard;
}

// ---- Public state ---------------------------------------------------------------

/**
 * Everything a client may know about a 29 room. Broadcast per-seat (avatars,
 * usernames are global; nothing else differs between seats except that the
 * acting/disconnected-fallback fields are identical for all viewers).
 * Contains NO hands, NO hidden suit, NO deck.
 */
export interface PublicTwentyNineState {
  gameType: "TWENTY_NINE";
  gameId: string;
  roomCode?: string;
  phase: TnPhase;
  seats: TnSeatView[]; // always length 4
  dealerSeatIndex: number | null;
  /**
   * How THIS hand's trump is being established — null until the bid winner
   * picks at TRUMP_SETUP. Replaces the old room-level mode.
   */
  trumpStyle: TnTrumpStyle | null;
  trump: TnTrumpView;
  /** Set once any side validly declares a K+Q marriage on the active suit. */
  marriageDeclaredBy: TnTeam | null;
  bids: TnBidState | null; // non-null during BIDDING/REDEALING-from-bids
  trick: TnTrickPlay[]; // current trick's plays, in play order
  ledSeatIndex: number | null; // who leads the current trick
  tricksWon: TnTeamTotals;
  capturedPoints: TnTeamTotals; // running card-point totals (public info)
  roundNumber: number;
  matchScore: TnTeamTotals;
  roundsToWin: number; // universally 6
  winnerTeam: TnTeam | null; // set when MATCH_OVER
  lastRoundSummary: TnRoundSummary | null;
  actingSeatIndex: number | null;
  offlineFallback: TnOfflineFallback | null;
  lastMove: TnLastMove | null;
}

// ---- Private payloads (single-socket) ---------------------------------------------

/** YOUR_TN_HAND — sent to exactly one seat per deal batch / reconnect. */
export interface YourTnHandPayload {
  handNumber: number;
  batch: 1 | 2 | "FULL_RECONNECT";
  cards: TnCard[];
}

/**
 * TN_BIDDER_PRIVATE — sent to the bid winner only.
 * CHOOSE_TRUMP: your call — pick a suit / 7th card / joker.
 * SEVENTH_INDICATOR: sent AFTER they chose the seventh-card option; carries
 * the indicator card so they know which suit became trump (it stays in their
 * hand and cannot be played until revealed via CALL_TRUMP).
 */
export type TnBidderPrivatePayload =
  | { kind: "CHOOSE_TRUMP"; handNumber: number }
  | { kind: "SEVENTH_INDICATOR"; handNumber: number; indicatorCard: TnCard };

// ---- Client -> Server moves ---------------------------------------------------------

/** Omitting `bid` means PASS (permanent for this hand). */
export interface TnBidPayload {
  bid?: number;
}

/**
 * The bid winner's trump-setup decision: a suit (hidden regular trump with
 * marriage potential), the automatic 7th card, or a joker hand.
 */
export interface TnDeclareTrumpPayload {
  choice: TnTrumpChoice;
}

/** Reveal the hidden trump (caller must be void in the led suit; server validates). */
export interface TnCallTrumpPayload {
  // intentionally empty — identity comes from the authenticated socket
}

/**
 * Declare a marriage (K+Q of `suit` currently held by the declaring side;
 * server verifies possession AND that `suit` is the active hand's trump suit).
 */
export interface TnDeclareMarriagePayload {
  suit: TnSuit;
}

export interface TnPlayCardPayload {
  card: TnCard;
}
