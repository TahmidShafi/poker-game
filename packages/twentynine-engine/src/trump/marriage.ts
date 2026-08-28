import { TnCard, TnSuit } from "@poker/shared-types";

export const MARRIAGE_BONUS = 4;

/**
 * MARRIAGE TRUMP: holding BOTH the King and Queen of a suit.
 * The server must verify against the actual dealt cards that the declaring
 * player genuinely holds both cards of the claimed suit — client claims are
 * never trusted.
 */
export function holdsMarriage(hand: TnCard[], suit: TnSuit): boolean {
  return hand.some((c) => c.suit === suit && c.rank === 13) && // K
         hand.some((c) => c.suit === suit && c.rank === 12);   // Q
}

/**
 * Marriage adjusts the REQUIRED points only (never the captured card
 * points, which always total 29):
 * - bidding team declared  => requirement = Math.max(16, bid - 4)
 * - defending team declared => requirement = bid + 4
 */
export function marriageAdjustedRequirement(
  bid: number,
  declaringTeam: "A" | "B" | null,
  biddingTeam: "A" | "B"
): number {
  if (declaringTeam === null) return bid;
  return declaringTeam === biddingTeam
    ? Math.max(16, bid - MARRIAGE_BONUS)
    : bid + MARRIAGE_BONUS;
}
