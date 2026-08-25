import { TnSuit } from "@poker/shared-types";

/**
 * SUIT-style trump declaration (integrated per-hand choice): the bid winner
 * freely picks any of the four suits. Validation is shape-only here; secrecy
 * is enforced upstream by the server broadcast layer.
 */
const SUITS: TnSuit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];

export function isValidSuitChoice(suit: TnSuit): boolean {
  return SUITS.includes(suit);
}
