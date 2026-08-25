import { describe, expect, it } from "vitest";
import { createTnDeck, shuffleTnDeck, tnNextSeat, tnSeatsFrom } from "./deck";

describe("32-card deck", () => {
  it("contains exactly the ranks 7,8,9,10,J,Q,K,A in four suits", () => {
    const deck = createTnDeck();
    expect(deck).toHaveLength(32);
    const suits = new Set(deck.map((c) => c.suit));
    expect(suits).toEqual(new Set(["SPADES", "HEARTS", "DIAMONDS", "CLUBS"]));
    for (const suit of suits) {
      const ranks = deck.filter((c) => c.suit === suit).map((c) => c.rank).sort((a, b) => a - b);
      expect(ranks).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    }
  });

  it("has no duplicate cards", () => {
    const deck = createTnDeck();
    const keys = new Set(deck.map((c) => `${c.suit}:${c.rank}`));
    expect(keys.size).toBe(32);
  });

  it("shuffle preserves the exact multiset of cards", () => {
    const deck = createTnDeck();
    const shuffled = shuffleTnDeck(deck);
    expect(shuffled).toHaveLength(32);
    const keyOf = (d: typeof deck) =>
      d.map((c) => `${c.suit}${c.rank}`).sort().join("|");
    expect(keyOf(shuffled)).toBe(keyOf(deck));
    expect(shuffled).not.toBe(deck); // new array
  });

  it("shuffle does not mutate the input", () => {
    const deck = createTnDeck();
    const snapshot = [...deck];
    shuffleTnDeck(deck);
    expect(deck).toEqual(snapshot);
  });
});

describe("anti-clockwise turn order 0->3->2->1->0", () => {
  it("cycles exactly as specified", () => {
    expect(tnNextSeat(0)).toBe(3);
    expect(tnNextSeat(3)).toBe(2);
    expect(tnNextSeat(2)).toBe(1);
    expect(tnNextSeat(1)).toBe(0);
  });

  it("seatsFrom lists a full anti-clockwise cycle from any start", () => {
    expect(tnSeatsFrom(0)).toEqual([0, 3, 2, 1]);
    expect(tnSeatsFrom(2)).toEqual([2, 1, 0, 3]);
  });
});
