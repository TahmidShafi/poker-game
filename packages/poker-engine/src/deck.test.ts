import { describe, it, expect } from "vitest";
import { createDeck, shuffleDeck, dealCards } from "./deck";
import { Card } from "@poker/shared-types";

function cardKey(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

describe("createDeck", () => {
  it("creates exactly 52 cards", () => {
    expect(createDeck()).toHaveLength(52);
  });

  it("contains no duplicate cards", () => {
    const deck = createDeck();
    const keys = new Set(deck.map(cardKey));
    expect(keys.size).toBe(52);
  });

  it("contains exactly 13 ranks per suit and 4 suits per rank", () => {
    const deck = createDeck();
    const bySuit = new Map<string, number>();
    const byRank = new Map<number, number>();
    for (const card of deck) {
      bySuit.set(card.suit, (bySuit.get(card.suit) ?? 0) + 1);
      byRank.set(card.rank, (byRank.get(card.rank) ?? 0) + 1);
    }
    expect(bySuit.size).toBe(4);
    for (const count of bySuit.values()) expect(count).toBe(13);
    expect(byRank.size).toBe(13);
    for (const count of byRank.values()) expect(count).toBe(4);
  });

  it("returns a fresh array each call (no shared mutable state)", () => {
    const deckA = createDeck();
    const deckB = createDeck();
    deckA.pop();
    expect(deckB).toHaveLength(52);
  });
});

describe("shuffleDeck", () => {
  it("does not mutate the input array", () => {
    const original = createDeck();
    const originalCopy = [...original];
    shuffleDeck(original);
    expect(original).toEqual(originalCopy);
  });

  it("returns the same 52 cards, just reordered (no loss or duplication)", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    expect(shuffled).toHaveLength(52);
    const originalKeys = new Set(deck.map(cardKey));
    const shuffledKeys = new Set(shuffled.map(cardKey));
    expect(shuffledKeys).toEqual(originalKeys);
  });

  it("actually changes the order (extremely unlikely to match original by chance)", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    // Probability of an unchanged 52-card shuffle by chance is ~1/52! - if this
    // ever fails it indicates a real bug, not flakiness.
    expect(shuffled).not.toEqual(deck);
  });

  it("produces different orderings across repeated calls", () => {
    const deck = createDeck();
    const shuffle1 = shuffleDeck(deck);
    const shuffle2 = shuffleDeck(deck);
    expect(shuffle1).not.toEqual(shuffle2);
  });
});

describe("dealCards", () => {
  it("deals the requested number of cards from the top", () => {
    const deck = createDeck();
    const top3 = [deck[0], deck[1], deck[2]];
    const dealt = dealCards(deck, 3);
    expect(dealt).toEqual(top3);
  });

  it("removes dealt cards from the deck (mutates in place)", () => {
    const deck = createDeck();
    dealCards(deck, 5);
    expect(deck).toHaveLength(47);
  });

  it("dealing 0 cards returns an empty array and does not mutate the deck", () => {
    const deck = createDeck();
    const dealt = dealCards(deck, 0);
    expect(dealt).toEqual([]);
    expect(deck).toHaveLength(52);
  });

  it("successive deals never return overlapping cards", () => {
    const deck = createDeck();
    const first = dealCards(deck, 10);
    const second = dealCards(deck, 10);
    const firstKeys = new Set(first.map(cardKey));
    const secondKeys = new Set(second.map(cardKey));
    for (const key of secondKeys) {
      expect(firstKeys.has(key)).toBe(false);
    }
  });

  it("throws when dealing more cards than remain in the deck", () => {
    const deck = createDeck();
    dealCards(deck, 50);
    expect(() => dealCards(deck, 3)).toThrow(/only 2 remain/);
  });

  it("throws on a negative count", () => {
    const deck = createDeck();
    expect(() => dealCards(deck, -1)).toThrow(/non-negative/);
  });

  it("dealing all 52 cards leaves the deck empty", () => {
    const deck = createDeck();
    const all = dealCards(deck, 52);
    expect(all).toHaveLength(52);
    expect(deck).toHaveLength(0);
  });
});
