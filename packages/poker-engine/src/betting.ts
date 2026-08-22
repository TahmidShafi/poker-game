import { PlayerAction, Seat } from "@poker/shared-types";

/**
 * State needed to reason about one betting round. `actedThisRound` is
 * parallel to `seats`: true once that seat has voluntarily acted since the
 * last full bet/raise (blinds do NOT count as acting - this is what gives
 * the big blind their option pre-flop).
 */
export interface BettingRoundState {
  seats: Seat[];
  currentBet: number;
  minRaiseIncrement: number; // size of the last FULL bet/raise; a new raise must reach currentBet + this
  actingSeatIndex: number;
  actedThisRound: boolean[];
  /**
   * Parallel to seats: false = this seat already acted since the last FULL
   * bet/raise and was NOT reopened (a short all-in raise happened), so they
   * may only call the shortfall or fold - not raise again.
   */
  mayRaise: boolean[];
}

export interface LegalActionsResult {
  legalActions: PlayerAction[];
  callAmount: number; // coins required to call (0 if check is legal)
  minRaiseTo: number; // minimum legal total bet/raise-TO for this seat
  maxRaiseTo: number; // seat's entire stack committed this round (no-limit cap)
}

export interface AppliedActionResult {
  newState: BettingRoundState;
  roundComplete: boolean;
  nextActingSeatIndex: number | null; // null once the round is complete
  uncalledReturnedTo?: { seatIndex: number; amount: number };
}

/** Seat can still take actions in the current round. */
export function canAct(seat: Seat): boolean {
  return seat.status === "ACTIVE";
}

/** Seat is still eligible to win the hand (dealt in, not folded). */
export function isInHand(seat: Seat): boolean {
  return seat.status === "ACTIVE" || seat.status === "ALL_IN";
}

function fail(message: string): never {
  throw new Error(message);
}

function getActingSeat(state: BettingRoundState): Seat {
  const seat = state.seats[state.actingSeatIndex];
  if (!seat || !canAct(seat)) {
    fail(`seat ${state.actingSeatIndex} cannot act right now`);
  }
  return seat;
}

/**
 * Determines which actions are legal for the seat currently to act,
 * and the min/max legal bet-to/raise-to amounts.
 * Amounts are always "total this round" (raise-TO, never raise-BY).
 */
export function getLegalActions(state: BettingRoundState): LegalActionsResult {
  const seat = getActingSeat(state);
  const callAmount = Math.max(0, state.currentBet - seat.currentBetThisRound);
  const maxRaiseTo = seat.currentBetThisRound + seat.coins;

  const legalActions: PlayerAction[] = ["FOLD"];
  if (callAmount === 0) {
    legalActions.push("CHECK");
    if (seat.coins > 0) legalActions.push("BET");
  } else {
    legalActions.push("CALL");
    // Raising requires chips beyond merely calling AND a reopened action
    // slot (a short all-in raise by someone else does not reopen).
    if (seat.coins > callAmount && state.mayRaise[state.actingSeatIndex]) {
      legalActions.push("RAISE");
    }
  }
  if (seat.coins > 0) legalActions.push("ALL_IN");

  const fullMin =
    state.currentBet === 0
      ? state.minRaiseIncrement
      : state.currentBet + state.minRaiseIncrement;
  const minRaiseTo = Math.min(fullMin, maxRaiseTo);

  return { legalActions, callAmount, minRaiseTo, maxRaiseTo };
}

function advanceToNextActor(state: BettingRoundState): number | null {
  const total = state.seats.length;
  for (let step = 1; step <= total; step++) {
    const idx = (state.actingSeatIndex + step) % total;
    const seat = state.seats[idx]!;
    if (
      canAct(seat) &&
      (!state.actedThisRound[idx] || seat.currentBetThisRound < state.currentBet)
    ) {
      return idx;
    }
  }
  return null;
}

/**
 * True when no further action can/must happen this round:
 * everyone dealt in has folded/all-in, or every remaining actor has matched
 * the current bet AND acted since the last aggressive action (big-blind
 * option falls out of the actedThisRound bookkeeping).
 */
export function isBettingRoundComplete(state: BettingRoundState): boolean {
  const inHandSeats = state.seats.filter(isInHand);
  if (inHandSeats.length <= 1) return true;
  const actors = state.seats.filter(canAct);
  if (actors.length === 0) return true;
  return actors.every(
    (s) =>
      s.currentBetThisRound === state.currentBet && state.actedThisRound[s.seatIndex]
  );
}

/**
 * The top bettor's excess above the second-highest bet this round was never
 * called and must be refunded when the round closes. Folded players' bets
 * still count as "matching" - money they already committed stays contested.
 */
export function computeUncalledRefund(
  seats: Seat[],
  currentBet: number
): { seatIndex: number; amount: number } | null {
  let top = -1;
  let second = -1;
  let topSeat = -1;
  for (const s of seats) {
    const b = s.currentBetThisRound;
    if (b > top) {
      second = top;
      top = b;
      topSeat = s.seatIndex;
    } else if (b > second) {
      second = b;
    }
  }
  void currentBet;
  if (top > 0 && top > second) {
    return { seatIndex: topSeat, amount: top - second };
  }
  return null;
}

/**
 * Validates and applies a player action to the betting round state.
 * Throws a descriptive error on anything illegal (out-of-turn, illegal
 * check/call/raise, over-betting, short amounts) so callers can translate
 * it into an ACTION_REJECTED instead of crashing.
 *
 * Rules implemented:
 *  - FOLD/CHECK/CALL/BET/RAISE/ALL_IN with raise-TO semantics.
 *  - A raise must reach currentBet + minRaiseIncrement UNLESS it puts the
 *    raiser all-in ("short all-in raise"): then it is allowed but does NOT
 *    update the increment and does NOT reopen action for players who
 *    already acted (they may only call the shortfall or fold).
 *  - ALL_IN pays everything; if it exceeds the current bet by at least a
 *    full raise it behaves like a normal raise (increment updated, others
 *    reopened); otherwise treated like a call-all-in or short raise.
 *  - Acting clears the actor's preAction queue responsibility from the
 *    caller - this function only mutates chip/bet/status fields.
 */
export function applyAction(
  state: BettingRoundState,
  seatIndex: number,
  action: PlayerAction,
  amount?: number
): AppliedActionResult {
  if (seatIndex !== state.actingSeatIndex) {
    fail(`out-of-turn action from seat ${seatIndex}; acting seat is ${state.actingSeatIndex}`);
  }
  const legal = getLegalActions(state);
  if (!legal.legalActions.includes(action)) {
    fail(`illegal action ${action} (legal now: ${legal.legalActions.join(",")})`);
  }

  const seats = state.seats.map((s) => ({ ...s }));
  const actedThisRound = [...state.actedThisRound];
  const mayRaise = [...state.mayRaise];
  let nextCurrentBet = state.currentBet;
  let nextMinRaiseIncrement = state.minRaiseIncrement;
  const seat = seats[seatIndex]!;

  // Full aggression reopens raising for everyone else; a short all-in raise
  // strips the raise option only from those who had already acted.
  const reopenOthers = (full: boolean) => {
    for (const s of seats) {
      if (s.seatIndex === seatIndex) continue;
      if (!canAct(s)) continue;
      if (full) {
        mayRaise[s.seatIndex] = true;
        actedThisRound[s.seatIndex] = false;
      } else if (actedThisRound[s.seatIndex]) {
        mayRaise[s.seatIndex] = false;
      }
    }
  };

  switch (action) {
    case "FOLD": {
      seat.status = "FOLDED";
      break;
    }
    case "CHECK": {
      break; // legality already verified callAmount === 0
    }
    case "CALL": {
      const pay = Math.min(legal.callAmount, seat.coins);
      seat.coins -= pay;
      seat.currentBetThisRound += pay;
      seat.totalInvestedThisHand += pay;
      if (seat.coins === 0) seat.status = "ALL_IN";
      break;
    }
    case "BET": {
      if (amount === undefined) fail("amount is required for BET");
      validateChipAmount(amount);
      if (amount < legal.minRaiseTo) {
        fail(`minimum open bet is ${legal.minRaiseTo}, got ${amount}`);
      }
      if (amount > legal.maxRaiseTo) {
        fail(`cannot bet ${amount}; at most ${legal.maxRaiseTo} available`);
      }
      commitChips(seat, amount - seat.currentBetThisRound);
      if (seat.coins === 0) seat.status = "ALL_IN";
      nextCurrentBet = amount;
      nextMinRaiseIncrement = amount; // opening bet sets the raise size
      reopenOthers(true);
      break;
    }
    case "RAISE": {
      if (amount === undefined) fail("amount is required for RAISE");
      validateChipAmount(amount);
      // Use the UNCLAMPED full minimum to detect a short all-in raise;
      // getLegalActions() clamps minRaiseTo down to maxRaiseTo, which would
      // otherwise disguise short raises as legal full raises.
      const fullMinRaiseTo = state.currentBet + state.minRaiseIncrement;
      const isAllInShort = amount === legal.maxRaiseTo && amount < fullMinRaiseTo;
      if (amount <= state.currentBet) {
        fail(`a raise must exceed the current bet of ${state.currentBet}`);
      }
      if (amount < fullMinRaiseTo && !isAllInShort) {
        fail(`minimum raise-to is ${fullMinRaiseTo}, got ${amount}`);
      }
      if (amount > legal.maxRaiseTo) {
        fail(`cannot raise to ${amount}; at most ${legal.maxRaiseTo} available`);
      }
      commitChips(seat, amount - seat.currentBetThisRound);
      if (seat.coins === 0) seat.status = "ALL_IN";
      nextCurrentBet = amount;
      if (!isAllInShort) {
        // Full raise: update increment and reopen action for everyone else.
        nextMinRaiseIncrement = amount - state.currentBet;
        reopenOthers(true);
      } else {
        reopenOthers(false);
      }
      break;
    }
    case "ALL_IN": {
      // If this seat was not reopened (short all-in by someone else), going
      // "all-in" is capped at calling the shortfall - it must not sneak in
      // an illegal raise.
      let pay = seat.coins;
      if (
        state.currentBet > 0 &&
        !state.mayRaise[seatIndex] &&
        seat.currentBetThisRound + pay > state.currentBet
      ) {
        pay = Math.max(0, state.currentBet - seat.currentBetThisRound);
      }
      commitChips(seat, pay);
      seat.status = "ALL_IN";
      const newTotal = seat.currentBetThisRound;
      if (newTotal > state.currentBet) {
        const previousBet = state.currentBet;
        if (previousBet === 0) {
          nextMinRaiseIncrement = newTotal;
          reopenOthers(true);
        } else if (newTotal >= previousBet + state.minRaiseIncrement) {
          nextMinRaiseIncrement = newTotal - previousBet;
          reopenOthers(true);
        } else {
          // Short all-in over the top: no increment change, no reopen.
          reopenOthers(false);
        }
        nextCurrentBet = newTotal;
      }
      break;
    }
  }

  actedThisRound[seatIndex] = true;
  const newState: BettingRoundState = {
    seats,
    currentBet: nextCurrentBet,
    minRaiseIncrement: nextMinRaiseIncrement,
    actingSeatIndex: seatIndex,
    actedThisRound,
    mayRaise,
  };

  const roundComplete = isBettingRoundComplete(newState);
  const nextActingSeatIndex = roundComplete ? null : advanceToNextActor(newState);
  if (nextActingSeatIndex !== null) newState.actingSeatIndex = nextActingSeatIndex;

  return { newState, roundComplete, nextActingSeatIndex };
}

function commitChips(seat: Seat, pay: number): void {
  if (pay < 0 || pay > seat.coins) {
    fail(`cannot commit ${pay} chips; seat has ${seat.coins}`);
  }
  seat.coins -= pay;
  seat.currentBetThisRound += pay;
  seat.totalInvestedThisHand += pay;
}

function validateChipAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    fail(`chip amount must be a positive integer, got ${amount}`);
  }
}
