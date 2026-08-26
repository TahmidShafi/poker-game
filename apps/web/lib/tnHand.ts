import type { TnCard, YourTnHandPayload } from "@poker/shared-types";

/**
 * Client-side accumulation of YOUR_TN_HAND deliveries.
 *
 * The server deals each hand in two batches (4 cards each) and re-delivers
 * private hands on reconnect. Treating every event as a full replacement
 * loses batch 1 the moment batch 2 arrives (the "stuck at 4 cards" bug), so
 * the view must be ACCUMULATED per hand:
 *
 *  - batch 1            -> starts/restarts the hand view
 *  - batch 2 (same hand)-> appends only cards not already present
 *  - FULL_RECONNECT     -> authoritative replacement (server's full 8)
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
    return { handNumber: payload.handNumber, cards: incoming };
  }

  // Deliveries from an already-retired hand must never mutate the current view.
  if (prev && prev.handNumber > payload.handNumber) return prev;

  if (payload.batch === 1) {
    // Duplicate batch-1 for the tracked hand is idempotent (same 4 cards);
    // any other batch-1 starts/restarts the hand view.
    return { handNumber: payload.handNumber, cards: incoming };
  }

  // batch 2
  if (prev && prev.handNumber === payload.handNumber) {
    return { handNumber: prev.handNumber, cards: dedupeCards([...prev.cards, ...incoming]) };
  }
  // Batch 1 was never received (lost event / mid-hand first contact):
  // keep the half that arrived rather than showing nothing.
  return { handNumber: payload.handNumber, cards: incoming };
}
