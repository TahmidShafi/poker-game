import { EvaluatedHand, Pot, Seat } from "@poker/shared-types";
import { compareHands } from "./comparison";
import { evaluateHand } from "./evaluator";
import { TableState } from "./game";
import { calculatePots, splitPot } from "./pots";
import { computeUncalledRefund, isInHand } from "./betting";

export interface PotAward {
  potIndex: number;
  potAmount: number;
  winners: {
    seatIndex: number;
    username: string | null;
    amount: number;
    hand: EvaluatedHand; // null only if the pot was won without a showdown
  }[];
}

export interface ShowdownOutcome {
  seats: Seat[]; // post-payout seat copies
  pots: Pot[]; // real side pots as awarded
  awards: PotAward[];
}

function cloneSeats(t: TableState): Seat[] {
  return t.seats.map((s) => ({ ...s }));
}

/**
 * Full showdown: builds side pots from investments, finds each pot's
 * winner(s), splits ties with odd chips clockwise of the button, and pays.
 * Chip conservation: total payout across all pots equals the pot exactly,
 * and no seat's balance decreases.
 */
export function resolveShowdown(t: TableState): ShowdownOutcome {
  const seats = cloneSeats(t);
  const pots = calculatePots(seats);
  const dealerIdx = t.dealerSeatIndex ?? 0;

  const hands = new Map<number, EvaluatedHand>();
  for (const s of seats) {
    if (isInHand(s) && s.holeCards && s.holeCards.length === 2 && t.communityCards.length >= 3) {
      hands.set(s.seatIndex, evaluateHand([...s.holeCards, ...t.communityCards]));
    }
  }

  const awards: PotAward[] = [];
  pots.forEach((pot, potIndex) => {
    const eligibleHands = pot.eligibleSeatIndexes
      .map((idx) => ({ idx, hand: hands.get(idx) }))
      .filter((e): e is { idx: number; hand: EvaluatedHand } => e.hand !== undefined);
    if (eligibleHands.length === 0) return;

    let best = eligibleHands[0]!.hand;
    for (const e of eligibleHands.slice(1)) {
      if (compareHands(e.hand, best) > 0) best = e.hand;
    }
    const winnerIdxs = eligibleHands.filter((e) => compareHands(e.hand, best) === 0).map((e) => e.idx);

    const shares = splitPot(pot.amount, winnerIdxs, dealerIdx, seats.length);
    for (const share of shares) {
      seats[share.seatIndex]!.coins += share.amount;
    }
    awards.push({
      potIndex,
      potAmount: pot.amount,
      winners: shares.map((share) => ({
        seatIndex: share.seatIndex,
        username: seats[share.seatIndex]!.username,
        amount: share.amount,
        hand: hands.get(share.seatIndex)!,
      })),
    });
  });

  return { seats, pots, awards };
}

/**
 * Everyone else folded: the sole remaining player takes everything on the
 * table WITHOUT showing cards. Any uncalled excess in their current bet is
 * refunded first, then all outstanding round bets sweep into the pot and
 * the whole pot goes to them.
 */
export function finishByFoldWin(
  t: TableState
): { seats: Seat[]; winnerSeatIndex: number; amountWon: number } {
  const seats = cloneSeats(t);
  const winner = seats.filter(isInHand)[0];
  if (!winner || seats.filter(isInHand).length !== 1) {
    throw new Error("finishByFoldWin requires exactly one player still in hand");
  }

  // Refund any uncalled portion of the winner's live bet.
  const refund = computeUncalledRefund(seats, t.currentBet);
  if (refund) {
    const s = seats[refund.seatIndex]!;
    const amount = Math.min(refund.amount, s.currentBetThisRound);
    s.currentBetThisRound -= amount;
    s.totalInvestedThisHand -= amount;
    s.coins += amount;
  }

  let amountWon = t.pot;
  for (const s of seats) {
    amountWon += s.currentBetThisRound;
    s.currentBetThisRound = 0;
  }
  winner.coins += amountWon;

  return { seats, winnerSeatIndex: winner.seatIndex, amountWon };
}
