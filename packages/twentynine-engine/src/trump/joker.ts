import { TnSuit, TnTrickPlay } from "@poker/shared-types";
import { resolveStandardWinner } from "../ranking";

/**
 * JOKER TRUMP (best-effort default agreed with the project owner):
 * No suit is ever designated trump. Ranks J > 9 > A > 10 act as universal
 * power cards across all suits, in that strict priority order, but ONLY
 * among cards that were legally playable under the normal follow-suit rule
 * (the server already guarantees legality of everything in `plays`).
 * Among non-power cards the highest card of the LED suit wins as usual.
 *
 * Tie-break house rule for equal power ranks (e.g. two Js):
 * 1. a power card of the led suit beats an equal-rank off-suit power card,
 * 2. otherwise the earlier-played equal-rank power card wins.
 *
 * This module is deliberately self-contained so the mechanic can be
 * corrected later without touching Regular / Seventh-card / Marriage logic.
 */

const POWER_PRIORITY: Partial<Record<TnTrickPlay["card"]["rank"], number>> = {
  11: 4, // J — strongest
  9: 3,
  14: 2, // A
  10: 1,
};

export function resolveJokerWinner(plays: TnTrickPlay[], ledSuit: TnSuit): TnTrickPlay {
  let bestPlay: TnTrickPlay | null = null;
  let bestPriority = -1;
  let bestLedSuit = false;

  for (let i = 0; i < plays.length; i++) {
    const play = plays[i];
    if (!play) continue;
    const priority = POWER_PRIORITY[play.card.rank];
    if (priority === undefined) continue;
    const isLed = play.card.suit === ledSuit;
    const better =
      priority > bestPriority ||
      (priority === bestPriority && isLed && !bestLedSuit);
    if (better) {
      bestPriority = priority;
      bestPlay = play;
      bestLedSuit = isLed;
    }
  }

  if (bestPlay) return bestPlay;
  return resolveStandardWinner(plays, ledSuit, null, false);
}

/** Exposed for tests: whether a rank acts as a joker-mode power card. */
export function isPowerRank(rank: TnTrickPlay["card"]["rank"]): boolean {
  return POWER_PRIORITY[rank] !== undefined;
}
