import { describe, expect, it } from "vitest";
import type { TnCard, YourTnHandPayload } from "@poker/shared-types";
import { accumulateTnHand, type AccumulatedHand } from "./tnHand";

const c = (rank: TnCard["rank"], suit: TnCard["suit"]): TnCard => ({ rank, suit });

const B1: TnCard[] = [c(7, "SPADES"), c(8, "SPADES"), c(9, "SPADES"), c(10, "SPADES")];
const B2: TnCard[] = [c(11, "SPADES"), c(12, "SPADES"), c(13, "SPADES"), c(14, "SPADES")];

const batch = (handNumber: number, n: 1 | 2, cards: TnCard[]): YourTnHandPayload => ({
  handNumber,
  batch: n,
  cards,
});

function acc(
  prev: AccumulatedHand | null,
  payload: YourTnHandPayload
): AccumulatedHand {
  return accumulateTnHand(prev, payload);
}

describe("accumulateTnHand (YOUR_TN_HAND state machine)", () => {
  it("batch 1 starts a fresh hand view with exactly its 4 cards", () => {
    const next = acc(null, batch(1, 1, B1));
    expect(next.handNumber).toBe(1);
    expect(next.cards).toEqual(B1);
    expect(next.cards).toHaveLength(4);
  });

  it("batch 2 of the same hand accumulates to 8 unique cards (THE BUG: replace lost batch 1)", () => {
    const afterB1 = acc(null, batch(1, 1, B1));
    const afterB2 = acc(afterB1, batch(1, 2, B2));
    expect(afterB2.cards).toHaveLength(8);
    expect(new Set(afterB2.cards.map((x) => `${x.suit}${x.rank}`)).size).toBe(8);
    expect(afterB2.cards.slice(0, 4)).toEqual(B1);
    expect(afterB2.cards.slice(4)).toEqual(B2);
  });

  it("a duplicate batch 2 delivery is idempotent (stays 8)", () => {
    let hand = acc(null, batch(1, 1, B1));
    hand = acc(hand, batch(1, 2, B2));
    hand = acc(hand, batch(1, 2, [...B2].reverse()));
    expect(hand.cards).toHaveLength(8);
  });

  it("a duplicate batch 1 delivery is idempotent (stays 4)", () => {
    let hand = acc(null, batch(1, 1, B1));
    hand = acc(hand, batch(1, 1, B1));
    expect(hand.cards).toEqual(B1);
    expect(hand.cards).toHaveLength(4);
  });

  it("FULL_RECONNECT replaces the whole hand authoritatively", () => {
    let hand = acc(null, batch(1, 1, B1));
    hand = acc(hand, batch(1, 2, B2));
    const reconnected = acc(hand, {
      handNumber: 1,
      batch: "FULL_RECONNECT",
      cards: [B2[1]!, B1[0]!, B2[3]!, B1[2]!, B2[0]!, B1[1]!, B2[2]!, B1[3]!],
    });
    expect(reconnected.cards).toHaveLength(8);
    expect(reconnected.cards[0]).toEqual(B2[1]);
  });

  it("batch 2 for a hand whose batch 1 was never received is kept (partial view beats none)", () => {
    const next = acc(null, batch(3, 2, B2));
    expect(next.handNumber).toBe(3);
    expect(next.cards).toEqual(B2);
  });

  it("stale batch 1 for an already-retired hand is ignored", () => {
    let hand = acc(null, batch(5, 1, B1));
    hand = acc(hand, batch(5, 2, B2));
    const stale = acc(hand, batch(4, 1, [c(7, "CLUBS"), c(8, "CLUBS"), c(9, "CLUBS"), c(10, "CLUBS")]));
    expect(stale).toBe(hand);
  });

  it("stale batch 2 for an already-retired hand is ignored", () => {
    let hand = acc(null, batch(5, 1, B1));
    hand = acc(hand, batch(5, 2, B2));
    const stale = acc(hand, batch(4, 2, [c(11, "CLUBS"), c(12, "CLUBS"), c(13, "CLUBS"), c(14, "CLUBS")]));
    expect(stale).toBe(hand);
  });

  it("a new hand's batch 1 replaces the previous hand's accumulated 8", () => {
    let hand = acc(null, batch(1, 1, B1));
    hand = acc(hand, batch(1, 2, B2));
    const hearts: TnCard[] = [c(7, "HEARTS"), c(8, "HEARTS"), c(9, "HEARTS"), c(10, "HEARTS")];
    hand = acc(hand, batch(2, 1, hearts));
    expect(hand.handNumber).toBe(2);
    expect(hand.cards).toEqual(hearts);
    expect(hand.cards).toHaveLength(4);
  });

  it("preserves deal order across both batches (batch1 order then batch2 order)", () => {
    let hand = acc(null, batch(1, 1, [B1[3]!, B1[2]!, B1[1]!, B1[0]!]));
    hand = acc(hand, batch(1, 2, [B2[2]!, B2[0]!, B2[3]!, B2[1]!]));
    expect(hand.cards.map((x) => x.rank)).toEqual([10, 9, 8, 7, 13, 11, 14, 12]);
  });

  it("FULL_RECONNECT mid-hand sets exact remaining cards (e.g. 7, 5, 0 remaining)", () => {
    let hand = acc(null, batch(1, 1, B1));
    hand = acc(hand, batch(1, 2, B2));
    expect(hand.cards).toHaveLength(8);

    // Mid-hand resync with 7 remaining cards
    const resync7 = acc(hand, {
      handNumber: 1,
      batch: "FULL_RECONNECT",
      cards: [B1[0]!, B1[1]!, B1[2]!, B2[0]!, B2[1]!, B2[2]!, B2[3]!],
    });
    expect(resync7.cards).toHaveLength(7);

    // Resync with 0 remaining cards at trick 8 end
    const resync0 = acc(resync7, {
      handNumber: 1,
      batch: "FULL_RECONNECT",
      cards: [],
    });
    expect(resync0.cards).toHaveLength(0);
  });
});
