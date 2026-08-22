import {
  Card,
  GamePhase,
  Pot,
  PublicGameState,
  Seat,
} from "@poker/shared-types";
import { createDeck, dealCards, shuffleDeck } from "./deck";
import { canAct, computeUncalledRefund, isInHand } from "./betting";

export const MAX_SEATS = 10;

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
}

/**
 * Full server-side table state. Extends what is broadcast with the private
 * deck, collected pot and betting bookkeeping. Never serialize this whole
 * object to clients - use toPublicGameState() + per-seat hole-card stripping.
 */
export interface TableState {
  seats: Seat[]; // fixed length MAX_SEATS
  phase: GamePhase;
  handNumber: number;
  dealerSeatIndex: number | null; // button position; persists across hands
  deck: Card[]; // private: remaining undealt cards for the current hand
  communityCards: Card[];
  pot: number; // chips collected into the pot so far this hand
  pots: Pot[]; // running display during hand; replaced by real side pots at showdown
  currentBet: number;
  minRaiseIncrement: number;
  actingSeatIndex: number | null;
  actedThisRound: boolean[];
  mayRaise: boolean[];
  smallBlind: number;
  bigBlind: number;
  lastAction: { seatIndex: number; action: import("@poker/shared-types").PlayerAction; amount?: number } | null;
}

export function createEmptySeat(seatIndex: number): Seat {
  return {
    seatIndex,
    playerId: null,
    username: null,
    coins: 0,
    currentBetThisRound: 0,
    totalInvestedThisHand: 0,
    status: "EMPTY",
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    holeCards: null,
    preAction: null,
    debtTo: undefined,
  };
}

export function createTable(config: TableConfig): TableState {
  if (!Number.isInteger(config.smallBlind) || config.smallBlind <= 0) {
    throw new Error(`smallBlind must be a positive integer, got ${config.smallBlind}`);
  }
  if (!Number.isInteger(config.bigBlind) || config.bigBlind <= config.smallBlind) {
    throw new Error(`bigBlind must be an integer >= smallBlind, got ${config.bigBlind}`);
  }
  return {
    seats: Array.from({ length: MAX_SEATS }, (_, i) => createEmptySeat(i)),
    phase: GamePhase.WAITING_FOR_PLAYERS,
    handNumber: 0,
    dealerSeatIndex: null,
    deck: [],
    communityCards: [],
    pot: 0,
    pots: [{ amount: 0, eligibleSeatIndexes: [] }],
    currentBet: 0,
    minRaiseIncrement: config.bigBlind,
    actingSeatIndex: null,
    actedThisRound: Array.from({ length: MAX_SEATS }, () => false),
  mayRaise: Array.from({ length: MAX_SEATS }, () => true),
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    lastAction: null,
  };
}

/** Broadcast-safe snapshot. Hole cards are stripped later per seat by the server. */
export function toPublicGameState(
  t: TableState,
  extras?: { gameId?: string; roomCode?: string; turnDeadline?: number | null }
): PublicGameState {
  return {
    gameId: extras?.gameId ?? "",
    roomCode: extras?.roomCode,
    phase: t.phase,
    seats: t.seats.map((s) => ({ ...s })),
    communityCards: [...t.communityCards],
    pots: t.pots.map((p) => ({ amount: p.amount, eligibleSeatIndexes: [...p.eligibleSeatIndexes] })),
    currentBet: t.currentBet,
    minRaiseIncrement: t.minRaiseIncrement,
    actingSeatIndex: t.actingSeatIndex,
    dealerSeatIndex: t.dealerSeatIndex,
    turnDeadline: extras?.turnDeadline ?? null,
    smallBlind: t.smallBlind,
    bigBlind: t.bigBlind,
    handNumber: t.handNumber,
    lastAction: t.lastAction ? { ...t.lastAction } : null,
  };
}

export function occupiedSeats(t: TableState): Seat[] {
  return t.seats.filter((s) => s.playerId !== null);
}

/**
 * Seats that can be dealt into a hand: someone is sitting there, they have
 * chips, and they are not busted. SITTING_OUT players ARE eligible - late
 * joiners are promoted when the next hand starts.
 */
export function eligibleForHand(t: TableState): Seat[] {
  return t.seats.filter(
    (s) =>
      s.playerId !== null &&
      s.coins > 0 &&
      s.status !== "BUSTED" &&
      s.status !== "EMPTY"
  );
}

function nextEligibleFrom(t: TableState, startIndex: number): Seat {
  const eligible = new Set(eligibleForHand(t).map((s) => s.seatIndex));
  for (let step = 1; step <= MAX_SEATS; step++) {
    const idx = (((startIndex + step) % MAX_SEATS) + MAX_SEATS) % MAX_SEATS;
    if (eligible.has(idx)) return t.seats[idx]!;
  }
  throw new Error("no eligible seat found after index " + startIndex);
}

/**
 * Advances the dealer button to the next OCCUPIED seat, clockwise.
 * V1 simplification (documented): no dead-button/dead-blind tracking -
 * the button simply moves to the next occupied seat each hand.
 */
export function rotateDealer(state: TableState): TableState {
  const t = cloneTable(state);
  for (const s of t.seats) s.isDealer = false;

  const occupied = occupiedSeats(t);
  if (occupied.length === 0) {
    t.dealerSeatIndex = null;
    return t;
  }

  let target: Seat;
  if (t.dealerSeatIndex === null) {
    // First-ever hand: button starts at the lowest occupied seat.
    target = occupied.reduce((min, s) => (s.seatIndex < min.seatIndex ? s : min));
  } else {
    const occupiedSet = new Set(occupied.map((s) => s.seatIndex));
    let idx = t.dealerSeatIndex;
    do {
      idx = (idx + 1) % MAX_SEATS;
    } while (!occupiedSet.has(idx));
    target = t.seats[idx]!;
  }
  target.isDealer = true;
  t.dealerSeatIndex = target.seatIndex;
  return t;
}

function postBlind(t: TableState, seat: Seat, blindAmount: number): void {
  const pay = Math.min(blindAmount, seat.coins);
  seat.coins -= pay;
  seat.currentBetThisRound += pay;
  seat.totalInvestedThisHand += pay;
  if (seat.coins === 0 && seat.status === "ACTIVE") seat.status = "ALL_IN";
}

/**
 * Starts a new hand. Assumes the caller verified >=2 eligible players.
 * Order: rotate button -> normalize statuses -> post blinds -> deal ->
 * set first actor -> PRE_FLOP. Heads-up: the BUTTON is the SMALL BLIND and
 * acts first pre-flop; post-flop the non-button acts first.
 */
export function startHand(state: TableState): TableState {
  let t = rotateDealer(state);

  // Normalize statuses for the new hand.
  for (const s of t.seats) {
    s.isSmallBlind = false;
    s.isBigBlind = false;
    s.holeCards = null;
    s.currentBetThisRound = 0;
    s.totalInvestedThisHand = 0;
    if (s.playerId === null || s.coins <= 0) continue;
    if (s.status === "BUSTED") continue;
    s.status = "ACTIVE"; // promotes SITTING_OUT / FOLDED / ALL_IN leftovers
  }

  const eligible = eligibleForHand(t);
  if (eligible.length < 2) {
    throw new Error("cannot start a hand with fewer than 2 eligible players");
  }

  t.handNumber += 1;
  t.phase = GamePhase.PRE_FLOP;
  t.deck = shuffleDeck(createDeck());
  t.communityCards = [];
  t.pot = 0;
  t.pots = [{ amount: 0, eligibleSeatIndexes: [] }];
  t.currentBet = 0;
  t.minRaiseIncrement = t.bigBlind;
  t.actedThisRound = Array.from({ length: MAX_SEATS }, () => false);
  t.mayRaise = Array.from({ length: MAX_SEATS }, () => true);
  t.lastAction = null;

  const headsUp = eligible.length === 2;
  const dealerIdx = t.dealerSeatIndex!;
  const dealerSeat = t.seats[dealerIdx]!;

  let sbSeat: Seat;
  let bbSeat: Seat;
  if (headsUp) {
    sbSeat = dealerSeat;
    bbSeat = nextEligibleFrom(t, dealerIdx);
  } else {
    sbSeat = nextEligibleFrom(t, dealerIdx);
    bbSeat = nextEligibleFrom(t, sbSeat.seatIndex);
  }
  sbSeat.isSmallBlind = true;
  bbSeat.isBigBlind = true;
  postBlind(t, sbSeat, t.smallBlind);
  postBlind(t, bbSeat, t.bigBlind);
  // The required bet is always the full big blind, even if the poster was short.
  t.currentBet = t.bigBlind;

  // Deal two cards per player, one card per pass, starting at the small blind.
  const dealOrder: Seat[] = [sbSeat];
  let idx = sbSeat.seatIndex;
  for (let i = 1; i < eligible.length; i++) {
    const s = nextEligibleFrom(t, idx);
    idx = s.seatIndex;
    dealOrder.push(s);
  }
  for (const s of dealOrder) s.holeCards = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const s of dealOrder) {
      s.holeCards!.push(dealCards(t.deck, 1)[0]!);
    }
  }

  // First to act pre-flop: heads-up starts with the button/SB; otherwise
  // the seat after the BB. If that seat is already all-in from a short
  // blind, scan clockwise for the first player who can still act.
  const preferred = headsUp ? dealerIdx : nextEligibleFrom(t, bbSeat.seatIndex).seatIndex;
  t.actingSeatIndex = firstActiveFrom(t, preferred);
  return t;
}

/** First seat clockwise from `startIndex` (inclusive) with status ACTIVE, or null. */
function firstActiveFrom(t: TableState, startIndex: number): number | null {
  for (let step = 0; step < MAX_SEATS; step++) {
    const idx = (startIndex + step) % MAX_SEATS;
    if (t.seats[idx]!.status === "ACTIVE") return idx;
  }
  return null;
}

/**
 * Closes the current betting round: refunds any uncalled excess to the top
 * bettor, sweeps all round bets into the pot, resets per-round bookkeeping.
 */
export function endBettingRound(state: TableState): TableState {
  const t = cloneTable(state);
  const refund = computeUncalledRefund(t.seats, t.currentBet);
  if (refund) {
    const seat = t.seats[refund.seatIndex]!;
    const amount = Math.min(refund.amount, seat.currentBetThisRound);
    seat.currentBetThisRound -= amount;
    seat.totalInvestedThisHand -= amount;
    seat.coins += amount;
  }
  for (const s of t.seats) {
    t.pot += s.currentBetThisRound;
    s.currentBetThisRound = 0;
  }
  t.currentBet = 0;
  t.minRaiseIncrement = t.bigBlind;
  t.actingSeatIndex = null;
  t.actedThisRound = Array.from({ length: MAX_SEATS }, () => false);
  t.mayRaise = Array.from({ length: MAX_SEATS }, () => true);
  t.pots = [{ amount: t.pot, eligibleSeatIndexes: [] }];
  return t;
}

/**
 * Deals the next street's community cards and sets up the next betting
 * round. Assumes endBettingRound() already ran. PRE_FLOP->FLOP deals 3,
 * FLOP->TURN and TURN->RIVER deal 1. First to act post-flop is the first
 * ACTIVE seat clockwise of the button.
 */
export function advancePhase(state: TableState): TableState {
  const t = cloneTable(state);

  switch (t.phase) {
    case GamePhase.PRE_FLOP:
      t.communityCards.push(...dealCards(t.deck, 3));
      t.phase = GamePhase.FLOP;
      break;
    case GamePhase.FLOP:
      t.communityCards.push(...dealCards(t.deck, 1));
      t.phase = GamePhase.TURN;
      break;
    case GamePhase.TURN:
      t.communityCards.push(...dealCards(t.deck, 1));
      t.phase = GamePhase.RIVER;
      break;
    default:
      throw new Error(`advancePhase called in phase ${t.phase}`);
  }

  // First actor on the new street.
  const dealerIdx = t.dealerSeatIndex ?? -1;
  let actor: number | null = null;
  for (let step = 1; step <= MAX_SEATS; step++) {
    const idx = (dealerIdx + step) % MAX_SEATS;
    const seat = t.seats[idx]!;
    if (canAct(seat)) {
      actor = idx;
      break;
    }
  }
  t.actingSeatIndex = actor;
  return t;
}

/** Number of seats still eligible to win (not folded/busted). */
export function countInHand(t: TableState): number {
  return t.seats.filter(isInHand).length;
}

function cloneTable(t: TableState): TableState {
  return {
    ...t,
    seats: t.seats.map((s) => ({ ...s })),
    deck: [...t.deck],
    communityCards: [...t.communityCards],
    pots: t.pots.map((p) => ({ amount: p.amount, eligibleSeatIndexes: [...p.eligibleSeatIndexes] })),
    actedThisRound: [...t.actedThisRound],
    mayRaise: [...t.mayRaise],
    lastAction: t.lastAction ? { ...t.lastAction } : null,
  };
}
