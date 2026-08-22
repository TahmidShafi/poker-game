import { Pot, Seat } from "@poker/shared-types";
import { isInHand } from "./betting";

/**
 * Given the seats and their total investment this hand, computes the main
 * pot and any side pots (level algorithm):
 *  - Commitment levels are the distinct invested amounts of non-folded
 *    players; each level caps one pot.
 *  - EVERY seat's chips count toward pot amounts (folded players' money
 *    stays in), but folded players are never eligible to win.
 *  - Money above the highest level (possible from a folder who over-bet)
 *    rolls into the topmost pot.
 *  - Adjacent pots with identical eligibility are merged so payouts stay
 *    simple without changing any outcome.
 */
export function calculatePots(seats: Seat[]): Pot[] {
  const contenders = seats.filter((s) => isInHand(s) && s.totalInvestedThisHand > 0);
  if (contenders.length === 0) return [];

  const levels = [...new Set(contenders.map((s) => s.totalInvestedThisHand))].sort(
    (a, b) => a - b
  );

  const pots: Pot[] = [];
  let prevLevel = 0;
  for (const level of levels) {
    let amount = 0;
    for (const s of seats) {
      amount += Math.min(s.totalInvestedThisHand, level) - Math.min(s.totalInvestedThisHand, prevLevel);
    }
    const eligible = contenders
      .filter((s) => s.totalInvestedThisHand >= level)
      .map((s) => s.seatIndex);

    const last = pots[pots.length - 1];
    if (last && sameEligibility(last.eligibleSeatIndexes, eligible)) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligibleSeatIndexes: eligible });
    }
    prevLevel = level;
  }

  // Money above the highest live level (e.g. a folder who over-bet then
  // folded, or uncalled excess already refunded elsewhere) belongs to the
  // topmost pot - it must never vanish.
  let overflow = 0;
  for (const s of seats) {
    overflow += Math.max(0, s.totalInvestedThisHand - prevLevel);
  }
  if (overflow > 0 && pots.length > 0) {
    pots[pots.length - 1]!.amount += overflow;
  }
  return pots;
}

function sameEligibility(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Splits a pot evenly among winners. When the amount does not divide
 * evenly, the remainder is distributed one chip at a time starting from
 * the seat immediately clockwise of the dealer (standard convention).
 */
export function splitPot(
  potAmount: number,
  winnerSeatIndexes: number[],
  dealerSeatIndex: number,
  totalSeats: number
): { seatIndex: number; amount: number }[] {
  if (winnerSeatIndexes.length === 0 || potAmount <= 0) return [];

  const base = Math.floor(potAmount / winnerSeatIndexes.length);
  let remainder = potAmount % winnerSeatIndexes.length;

  // Order winners by clockwise distance starting left of the button.
  const distanceFromButton = (seatIndex: number): number =>
    (((seatIndex - dealerSeatIndex - 1) % totalSeats) + totalSeats) % totalSeats;

  const ordered = [...winnerSeatIndexes].sort(
    (a, b) => distanceFromButton(a) - distanceFromButton(b)
  );

  return ordered.map((seatIndex) => {
    let amount = base;
    if (remainder > 0) {
      amount += 1;
      remainder -= 1;
    }
    return { seatIndex, amount };
  });
}
