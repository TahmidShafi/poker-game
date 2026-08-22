export type Suit = "SPADES" | "HEARTS" | "DIAMONDS" | "CLUBS";

// Numeric rank value: 2-14 (Ace = 14 high, evaluator handles the A-2-3-4-5 wheel case separately)
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const RANK_LABELS: Record<Rank, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  SPADES: "\u2660",
  HEARTS: "\u2665",
  DIAMONDS: "\u2666",
  CLUBS: "\u2663",
};

export function cardToString(card: Card): string {
  return `${RANK_LABELS[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}
