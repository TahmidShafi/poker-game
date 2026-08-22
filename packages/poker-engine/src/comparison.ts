import { EvaluatedHand } from "@poker/shared-types";

/**
 * Compares two evaluated hands.
 * Returns:
 *   > 0 if handA wins
 *   < 0 if handB wins
 *   0   if exactly tied (split pot)
 *
 * Category is compared first (a Flush always beats a Straight regardless of
 * rankValues). If categories match, rankValues are compared element-by-element
 * in order of significance (e.g. for Two Pair: [highPair, lowPair, kicker]) -
 * the first differing element decides the winner.
 *
 * Both hands must have been produced by evaluateHand() (Phase 3), so their
 * rankValues arrays are always the same length for a given category.
 */
export function compareHands(handA: EvaluatedHand, handB: EvaluatedHand): number {
  if (handA.category !== handB.category) {
    return handA.category - handB.category;
  }

  const length = Math.max(handA.rankValues.length, handB.rankValues.length);
  for (let i = 0; i < length; i++) {
    const a = handA.rankValues[i] ?? 0;
    const b = handB.rankValues[i] ?? 0;
    if (a !== b) {
      return a - b;
    }
  }

  return 0;
}
