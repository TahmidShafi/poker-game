import { TnCard, tnCardPoints } from "@poker/shared-types";

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
 * Invalid-hand check:
 * In Twenty-Nine, among the bidder's other 7 cards (all 4 of batch 1 plus the 3
 * non-indicator cards of batch 2), the bidder must hold at least one OTHER card
 * of the indicator's suit that has points (tnCardPoints > 0: J=3, 9=2, A=1, 10=1).
 *
 * If the bidder holds NO OTHER cards of that suit, OR if all other cards of that
 * suit held by the bidder are pointless (0-point cards: 7, 8, K, Q), the 7th card
 * trump is invalid and the hand is cancelled and redealt (reshuffled) with the same dealer.
 */
export function isSeventhTrumpValid(batch1: TnCard[], batch2: TnCard[], indicator: TnCard): boolean {
  const otherSameSuit = [...batch1, ...batch2].filter(
    (c) => c.suit === indicator.suit && !(c.suit === indicator.suit && c.rank === indicator.rank)
  );
  return otherSameSuit.some((c) => tnCardPoints(c) > 0);
}

/**
 * Counts OTHER cards of the indicator's suit (excluding the indicator itself).
 */
export function countOtherCardsOfSuit(all8: TnCard[], indicator: TnCard): number {
  return all8.filter(
    (c) => c.suit === indicator.suit && !(c.suit === indicator.suit && c.rank === indicator.rank)
  ).length;
}

/**
 * Counts OTHER scoring/point cards of the indicator's suit (tnCardPoints > 0: J, 9, A, 10).
 */
export function countOtherPointCardsOfSuit(all8: TnCard[], indicator: TnCard): number {
  return all8.filter(
    (c) => c.suit === indicator.suit && !(c.suit === indicator.suit && c.rank === indicator.rank) && tnCardPoints(c) > 0
  ).length;
}
