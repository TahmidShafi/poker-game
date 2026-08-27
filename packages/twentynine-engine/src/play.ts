import { TnCard, TnSuit, TnTrickPlay } from "@poker/shared-types";
import { resolveJokerWinner } from "./trump/joker";
import { resolveStandardWinner } from "./ranking";

/**
 * Card-play legality and trick resolution for Twenty-Nine.
 */

/** Follow-suit is mandatory: if the hand holds the led suit, ONLY those cards are legal. */
export function legalCards(hand: TnCard[], ledSuit: TnSuit | null): TnCard[] {
  if (!ledSuit) return [...hand];
  const followers = hand.filter((c) => c.suit === ledSuit);
  return followers.length > 0 ? followers : [...hand];
}

/**
 * CALL_TRUMP availability: only while trump is hidden (suit modes), and only
 * for a player who cannot follow the led suit. Never in joker mode. Revealing
 * never plays a card — it is a separate public state change.
 */
export interface MoveOptions {
  canCallTrump: boolean;
  canDeclareMarriage: boolean;
}

export function resolveWinner(
  plays: TnTrickPlay[],
  ledSuit: TnSuit,
  opts: { jokerMode: boolean; trumpSuit: TnSuit | null; trumpRevealed: boolean }
): TnTrickPlay {
  if (plays.length !== 4) {
    throw new Error(`resolveWinner: expected 4 plays, got ${plays.length}`);
  }
  if (opts.jokerMode && opts.trumpRevealed) return resolveJokerWinner(plays, ledSuit);
  return resolveStandardWinner(plays, ledSuit, opts.trumpSuit, opts.trumpRevealed);
}
