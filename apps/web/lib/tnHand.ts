import type { TnCard, TnSuit, YourTnHandPayload } from "@poker/shared-types";

/**
 * 29 Card Game power ranking weights:
 * J (11) = 8 (Highest)
 * 9 (9)  = 7
 * A (14) = 6
 * 10 (10)= 5
 * K (13) = 4
 * Q (12) = 3
 * 8 (8)  = 2
 * 7 (7)  = 1 (Lowest)
 */
export const TN_POWER_RANK_WEIGHT: Record<TnCard["rank"], number> = {
  11: 8, // J
  9: 7,  // 9
  14: 6, // A
  10: 5, // 10
  13: 4, // K
  12: 3, // Q
  8: 2,  // 8
  7: 1,  // 7
};

export const TN_SUIT_DISPLAY_ORDER: Record<TnSuit, number> = {
  SPADES: 0,
  HEARTS: 1,
  CLUBS: 2,
  DIAMONDS: 3,
};

/**
 * Sorts 29 cards grouped by suit and ordered descending by 29 power rank:
 * J > 9 > A > 10 > K > Q > 8 > 7
 */
export function sortTnCards(cards: TnCard[]): TnCard[] {
  return [...cards].sort((a, b) => {
    const suitDiff = (TN_SUIT_DISPLAY_ORDER[a.suit] ?? 99) - (TN_SUIT_DISPLAY_ORDER[b.suit] ?? 99);
    if (suitDiff !== 0) return suitDiff;
    const powerA = TN_POWER_RANK_WEIGHT[a.rank] ?? a.rank;
    const powerB = TN_POWER_RANK_WEIGHT[b.rank] ?? b.rank;
    return powerB - powerA; // descending power
  });
}

/**
 * Client-side accumulation of YOUR_TN_HAND deliveries.
 *
 * The server deals each hand in two batches (4 cards each) and re-delivers
 * private hands on reconnect. Treating every event as a full replacement
 * loses batch 1 the moment batch 2 arrives (the "stuck at 4 cards" bug), so
 * the view must be ACCUMULATED per hand:
 *
 *  - batch 1            -> starts/restarts the hand view (organized by suit + power)
 *  - batch 2 (same hand)-> appends & organizes all 8 cards by suit + power
 *  - FULL_RECONNECT     -> authoritative replacement (organized by suit + power)
 *  - stale deliveries   -> ignored (older handNumber than what we hold)
 *
 * Card identity is (suit, rank) — unique within one 32-card deck — which
 * makes duplicate deliveries naturally idempotent.
 */
export interface AccumulatedHand {
  handNumber: number;
  cards: TnCard[];
}

function keyOf(card: TnCard): string {
  return `${card.suit}:${card.rank}`;
}

function dedupeCards(cards: TnCard[]): TnCard[] {
  const seen = new Set<string>();
  const out: TnCard[] = [];
  for (const card of cards) {
    const key = keyOf(card);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

export function accumulateTnHand(
  prev: AccumulatedHand | null,
  payload: YourTnHandPayload
): AccumulatedHand {
  const incoming = dedupeCards(payload.cards);

  if (payload.batch === "FULL_RECONNECT") {
    return { handNumber: payload.handNumber, cards: sortTnCards(incoming) };
  }

  // Deliveries from an already-retired hand must never mutate the current view.
  if (prev && prev.handNumber > payload.handNumber) return prev;

  if (payload.batch === 1) {
    // Duplicate batch-1 for the tracked hand is idempotent (same 4 cards);
    // any other batch-1 starts/restarts the hand view.
    return { handNumber: payload.handNumber, cards: sortTnCards(incoming) };
  }

  // batch 2
  if (prev && prev.handNumber === payload.handNumber) {
    return { handNumber: prev.handNumber, cards: sortTnCards(dedupeCards([...prev.cards, ...incoming])) };
  }
  // Batch 1 was never received (lost event / mid-hand first contact):
  // keep the half that arrived rather than showing nothing.
  return { handNumber: payload.handNumber, cards: sortTnCards(incoming) };
}
