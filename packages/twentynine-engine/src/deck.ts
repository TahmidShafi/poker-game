import { TnCard, TnRank, TnSuit } from "@poker/shared-types";

const ALL_SUITS: TnSuit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];
const ALL_RANKS: TnRank[] = [7, 8, 9, 10, 11, 12, 13, 14];

/**
 * Fresh, ordered (unshuffled) 32-card Twenty-Nine deck:
 * 7,8,9,10,J,Q,K,A in all four suits. Always 32 cards, no duplicates.
 */
export function createTnDeck(): TnCard[] {
  const deck: TnCard[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle into a new array; input untouched.
 * Math.random() is an accepted tradeoff for casual virtual-chip play
 * (same policy as the poker engine).
 */
export function shuffleTnDeck(deck: TnCard[]): TnCard[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Anti-clockwise turn order is exactly 0 -> 3 -> 2 -> 1 -> 0. */
export function tnNextSeat(seatIndex: number): number {
  return (seatIndex + 3) % 4;
}

export function tnNextActiveSeat(seatIndex: number, inactiveSeatIndex?: number | null): number {
  let next = tnNextSeat(seatIndex);
  if (inactiveSeatIndex !== null && inactiveSeatIndex !== undefined && next === inactiveSeatIndex) {
    next = tnNextSeat(next);
  }
  return next;
}

export function tnSeatsFrom(startSeatIndex: number): number[] {
  return [startSeatIndex, tnNextSeat(startSeatIndex), tnNextSeat(tnNextSeat(startSeatIndex)), tnNextSeat(tnNextSeat(tnNextSeat(startSeatIndex)))];
}
