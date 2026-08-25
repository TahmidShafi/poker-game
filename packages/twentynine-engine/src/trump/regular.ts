import { TnSuit } from "@poker/shared-types";
import { TnTrumpMode } from "@poker/shared-types";

/**
 * REGULAR TRUMP: the bid winner freely chooses any of the four suits.
 * The choice is validated for shape only; every suit is always legal.
 * Secrecy is enforced upstream (server broadcast layer) — this module
 * intentionally knows nothing about sockets or visibility.
 */
export function validateRegularTrumpChoice(mode: TnTrumpMode, suit: TnSuit): void {
  if (mode !== "REGULAR" && mode !== "MARRIAGE") {
    throw new Error("trump declaration is only available in REGULAR or MARRIAGE mode");
  }
  if (!["SPADES", "HEARTS", "DIAMONDS", "CLUBS"].includes(suit)) {
    throw new Error("invalid trump suit");
  }
}
