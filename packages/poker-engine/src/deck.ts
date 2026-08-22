import { Card, Rank, Suit } from "@poker/shared-types";

const ALL_SUITS: Suit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];
const ALL_RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/**
 * Returns a fresh, ordered (unshuffled) standard 52-card deck.
 * Always 4 suits x 13 ranks, no jokers, no duplicates.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Returns a new array containing the same cards as `deck`, shuffled using
 * the Fisher-Yates algorithm. Does not mutate the input array.
 *
 * Note: this uses Math.random(), which is NOT cryptographically secure.
 * That's an acceptable tradeoff for a casual game among friends with
 * virtual coins. If this were ever used for real-money play, this must
 * be swapped for a CSPRNG (e.g. Node's crypto.randomInt) instead.
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Removes and returns the top `count` cards from the deck (mutates deck
 * in place via splice, matching how a real deck is dealt from). Throws if
 * fewer than `count` cards remain, since silently dealing a short hand
 * would be a serious correctness bug in a poker engine.
 */
export function dealCards(deck: Card[], count: number): Card[] {
  if (count < 0) {
    throw new Error(`dealCards: count must be non-negative, got ${count}`);
  }
  if (count > deck.length) {
    throw new Error(
      `dealCards: cannot deal ${count} cards, only ${deck.length} remain in the deck`
    );
  }
  return deck.splice(0, count);
}
