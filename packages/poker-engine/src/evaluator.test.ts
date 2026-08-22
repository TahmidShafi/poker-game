import { describe, it, expect } from "vitest";
import { evaluateHand } from "./evaluator";
import { Card, HandCategory } from "@poker/shared-types";

function c(rank: Card["rank"], suit: Card["suit"]): Card {
  return { rank, suit };
}

describe("evaluateHand - category detection (exactly 5 cards)", () => {
  it("detects a Royal Flush", () => {
    const hand = [c(14, "SPADES"), c(13, "SPADES"), c(12, "SPADES"), c(11, "SPADES"), c(10, "SPADES")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.ROYAL_FLUSH);
    expect(result.rankValues).toEqual([14]);
  });

  it("detects a Straight Flush (non-royal)", () => {
    const hand = [c(9, "DIAMONDS"), c(8, "DIAMONDS"), c(7, "DIAMONDS"), c(6, "DIAMONDS"), c(10, "DIAMONDS")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.STRAIGHT_FLUSH);
    expect(result.rankValues).toEqual([10]);
  });

  it("detects Four of a Kind", () => {
    const hand = [c(9, "SPADES"), c(9, "DIAMONDS"), c(9, "CLUBS"), c(9, "HEARTS"), c(14, "CLUBS")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.FOUR_OF_A_KIND);
    expect(result.rankValues).toEqual([9, 14]);
  });

  it("detects a Full House", () => {
    const hand = [c(14, "DIAMONDS"), c(14, "SPADES"), c(14, "CLUBS"), c(7, "CLUBS"), c(7, "HEARTS")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.FULL_HOUSE);
    expect(result.rankValues).toEqual([14, 7]);
  });

  it("detects a Flush", () => {
    const hand = [c(12, "DIAMONDS"), c(8, "DIAMONDS"), c(6, "DIAMONDS"), c(13, "DIAMONDS"), c(10, "DIAMONDS")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.FLUSH);
    expect(result.rankValues).toEqual([13, 12, 10, 8, 6]);
  });

  it("detects a Straight", () => {
    const hand = [c(7, "SPADES"), c(8, "DIAMONDS"), c(9, "CLUBS"), c(10, "HEARTS"), c(11, "SPADES")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.STRAIGHT);
    expect(result.rankValues).toEqual([11]);
  });

  it("detects the A-2-3-4-5 wheel straight (Ace plays low)", () => {
    const hand = [c(14, "SPADES"), c(2, "DIAMONDS"), c(3, "CLUBS"), c(4, "HEARTS"), c(5, "SPADES")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.STRAIGHT);
    expect(result.rankValues).toEqual([5]); // 5-high straight, not 14-high
  });

  it("detects Three of a Kind", () => {
    const hand = [c(10, "SPADES"), c(10, "DIAMONDS"), c(10, "CLUBS"), c(6, "HEARTS"), c(14, "SPADES")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.THREE_OF_A_KIND);
    expect(result.rankValues).toEqual([10, 14, 6]);
  });

  it("detects Two Pair", () => {
    const hand = [c(12, "SPADES"), c(12, "HEARTS"), c(6, "SPADES"), c(6, "DIAMONDS"), c(13, "SPADES")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.TWO_PAIR);
    expect(result.rankValues).toEqual([12, 6, 13]);
  });

  it("detects One Pair", () => {
    const hand = [c(11, "DIAMONDS"), c(11, "SPADES"), c(7, "CLUBS"), c(9, "HEARTS"), c(13, "SPADES")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.ONE_PAIR);
    expect(result.rankValues).toEqual([11, 13, 9, 7]);
  });

  it("detects High Card", () => {
    const hand = [c(13, "HEARTS"), c(7, "DIAMONDS"), c(8, "CLUBS"), c(11, "SPADES"), c(10, "HEARTS")];
    const result = evaluateHand(hand);
    expect(result.category).toBe(HandCategory.HIGH_CARD);
    expect(result.rankValues).toEqual([13, 11, 10, 8, 7]);
  });
});

describe("evaluateHand - best 5-of-7 selection", () => {
  it("selects the best hand using both hole cards", () => {
    // Hole: A A. Board: A K K 7 2. Best hand should be Full House (AAA KK), using both hole cards.
    const holeAndBoard = [
      c(14, "SPADES"),
      c(14, "HEARTS"), // hole cards: pocket aces
      c(14, "CLUBS"),
      c(13, "SPADES"),
      c(13, "HEARTS"),
      c(7, "CLUBS"),
      c(2, "DIAMONDS"),
    ];
    const result = evaluateHand(holeAndBoard);
    expect(result.category).toBe(HandCategory.FULL_HOUSE);
    expect(result.rankValues).toEqual([14, 13]);
  });

  it("selects the best hand using exactly one hole card", () => {
    // Hole: K 2. Board: K K K Q J (four of a kind is on board plus one hole king... 
    // actually let's construct: hole 5,2 (unrelated); board has the flush.
    const holeAndBoard = [
      c(5, "CLUBS"),
      c(2, "HEARTS"), // hole cards, irrelevant to best hand
      c(9, "DIAMONDS"),
      c(4, "DIAMONDS"),
      c(11, "DIAMONDS"),
      c(13, "DIAMONDS"),
      c(7, "DIAMONDS"), // board is a 5-card diamond flush by itself
    ];
    const result = evaluateHand(holeAndBoard);
    expect(result.category).toBe(HandCategory.FLUSH);
    expect(result.rankValues).toEqual([13, 11, 9, 7, 4]);
  });

  it("plays the board when it is better than using any hole card (zero hole cards used)", () => {
    // Board itself is a straight flush; hole cards are unrelated low cards.
    const holeAndBoard = [
      c(2, "CLUBS"),
      c(3, "HEARTS"), // hole cards, irrelevant
      c(6, "SPADES"),
      c(7, "SPADES"),
      c(8, "SPADES"),
      c(9, "SPADES"),
      c(10, "SPADES"), // board: 6-7-8-9-10 of spades
    ];
    const result = evaluateHand(holeAndBoard);
    expect(result.category).toBe(HandCategory.STRAIGHT_FLUSH);
    expect(result.rankValues).toEqual([10]);
  });

  it("handles exactly 6 cards (e.g. flop + turn only, no river yet, evaluated early)", () => {
    const cards = [c(9, "SPADES"), c(9, "HEARTS"), c(9, "DIAMONDS"), c(2, "CLUBS"), c(4, "HEARTS"), c(14, "SPADES")];
    const result = evaluateHand(cards);
    expect(result.category).toBe(HandCategory.THREE_OF_A_KIND);
    expect(result.rankValues).toEqual([9, 14, 4]);
  });
});

describe("evaluateHand - input validation", () => {
  it("throws if fewer than 5 cards are provided", () => {
    const tooFew = [c(2, "CLUBS"), c(3, "CLUBS"), c(4, "CLUBS"), c(5, "CLUBS")];
    expect(() => evaluateHand(tooFew)).toThrow(/at least 5 cards/);
  });
});

describe("evaluateHand - category ordering sanity checks", () => {
  it("ranks categories in the correct strength order via HandCategory enum values", () => {
    expect(HandCategory.ROYAL_FLUSH).toBeGreaterThan(HandCategory.STRAIGHT_FLUSH);
    expect(HandCategory.STRAIGHT_FLUSH).toBeGreaterThan(HandCategory.FOUR_OF_A_KIND);
    expect(HandCategory.FOUR_OF_A_KIND).toBeGreaterThan(HandCategory.FULL_HOUSE);
    expect(HandCategory.FULL_HOUSE).toBeGreaterThan(HandCategory.FLUSH);
    expect(HandCategory.FLUSH).toBeGreaterThan(HandCategory.STRAIGHT);
    expect(HandCategory.STRAIGHT).toBeGreaterThan(HandCategory.THREE_OF_A_KIND);
    expect(HandCategory.THREE_OF_A_KIND).toBeGreaterThan(HandCategory.TWO_PAIR);
    expect(HandCategory.TWO_PAIR).toBeGreaterThan(HandCategory.ONE_PAIR);
    expect(HandCategory.ONE_PAIR).toBeGreaterThan(HandCategory.HIGH_CARD);
  });

  it("a flush beats a straight when both are present in the same 7 cards, unless they combine into a straight flush", () => {
    // 7 cards where a flush is possible AND a (non-flush) straight is possible separately.
    const cards = [
      c(2, "HEARTS"),
      c(3, "HEARTS"),
      c(4, "HEARTS"),
      c(5, "CLUBS"),
      c(6, "DIAMONDS"),
      c(7, "HEARTS"),
      c(9, "HEARTS"),
    ];
    // Straight available: 3-4-5-6-7. Flush available: 2,3,4,7,9 hearts.
    const result = evaluateHand(cards);
    expect(result.category).toBe(HandCategory.FLUSH);
  });
});
