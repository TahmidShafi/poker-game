import { TnCard, TnSuit, TnTrickPlay } from "@poker/shared-types";

/**
 * Normal ranking used for trick winners, highest to lowest:
 * J > 9 > A > 10 > K > Q > 8 > 7
 */
export const TN_RANK_WEIGHT: Record<TnCard["rank"], number> = {
  11: 8, // J
  9: 7,
  14: 6, // A
  10: 5,
  13: 4, // K
  12: 3, // Q
  8: 2,
  7: 1,
};

function highestOfSuit(plays: TnTrickPlay[], suit: TnSuit): TnTrickPlay {
  let best = plays[0];
  if (!best) throw new Error("resolveTrickWinner: empty trick");
  let bestWeight = -1;
  for (const play of plays) {
    if (play.card.suit !== suit) continue;
    const w = TN_RANK_WEIGHT[play.card.rank];
    if (w > bestWeight) {
      bestWeight = w;
      best = play;
    }
  }
  return best;
}

/**
 * Standard (non-joker) trick resolution:
 * - Before trump reveal, trump cards have NO special power (nobody knows them)
 *   => highest card of the LED suit wins.
 * - After reveal, any trump beats any non-trump; multiple trumps =>
 *   highest-ranked trump wins.
 * - No trump in play => highest of led suit.
 */
export function resolveStandardWinner(
  plays: TnTrickPlay[],
  ledSuit: TnSuit,
  trumpSuit: TnSuit | null,
  trumpRevealed: boolean
): TnTrickPlay {
  if (plays.length === 0) throw new Error("resolveStandardWinner: no plays");
  if (trumpRevealed && trumpSuit) {
    const trumps = plays.filter((p) => p.card.suit === trumpSuit);
    if (trumps.length > 0) return highestOfSuit(trumps, trumpSuit);
  }
  return highestOfSuit(plays, ledSuit);
}
