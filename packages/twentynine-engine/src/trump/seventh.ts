import { TnCard } from "@poker/shared-types";

/**
 * SEVENTH_CARD TRUMP.
 * The bid winner's "7th card" is the 3rd card of their SECOND batch of 4;
 * its suit becomes trump automatically (no choice involved).
 */

export function seventhCardIndicator(batch2: TnCard[]): TnCard {
  const indicator = batch2[2];
  if (!indicator || batch2.length !== 4) {
    throw new Error("seventh-card indicator requires a full second batch of 4 cards");
  }
  return indicator;
}

/**
 * Invalid-hand check: among the bidder's OTHER 7 cards (all 4 of batch 1 plus
 * the 3 non-indicator cards of batch 2), at least one must share the
 * indicator's suit. Otherwise the 7th card would be a single dead trump and
 * the hand is cancelled and redealt with the same dealer.
 */
export function isSeventhTrumpValid(batch1: TnCard[], batch2: TnCard[], indicator: TnCard): boolean {
  return [...batch1, ...batch2].some(
    (c) => c.suit === indicator.suit && !(c.suit === indicator.suit && c.rank === indicator.rank)
  );
}

/**
 * Precise variant of the check that counts OTHER copies of the indicator's
 * suit by identity (suit+rank pairs are unique in one deck, so comparing
 * rank+suit equality against the indicator itself is sufficient).
 */
export function countOtherCardsOfSuit(all8: TnCard[], indicator: TnCard): number {
  return all8.filter((c) => c.suit === indicator.suit && c.rank !== indicator.rank).length;
}
