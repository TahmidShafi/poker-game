import { Card } from "./card";

export enum HandCategory {
  HIGH_CARD = 0,
  ONE_PAIR = 1,
  TWO_PAIR = 2,
  THREE_OF_A_KIND = 3,
  STRAIGHT = 4,
  FLUSH = 5,
  FULL_HOUSE = 6,
  FOUR_OF_A_KIND = 7,
  STRAIGHT_FLUSH = 8,
  ROYAL_FLUSH = 9,
}

/**
 * Result of evaluating the best 5-card hand out of a player's available cards.
 * `rankValues` is a tie-break tuple, ordered from most to least significant
 * (e.g. for two pair: [highPairRank, lowPairRank, kickerRank]).
 * Comparing two EvaluatedHands: first compare `category`, then compare
 * `rankValues` element by element.
 */
export interface EvaluatedHand {
  category: HandCategory;
  rankValues: number[];
  bestFive: Card[];
}

const SINGULAR: Record<number, string> = {
  2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven",
  8: "Eight", 9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace",
};

function plural(rank: number): string {
  return rank === 6 ? "Sixes" : `${SINGULAR[rank] ?? rank}s`;
}

/**
 * Rich, presentation-ready hand name, e.g.
 *   "Two Pair, Kings & Nines" · "Aces full of Sevens" · "Ace-high".
 * Shared by the showdown UI and server-side stats so naming stays identical.
 */
export function describeHand(hand: EvaluatedHand): string {
  const rv = hand.rankValues;
  switch (hand.category) {
    case HandCategory.ROYAL_FLUSH:
      return "Royal Flush";
    case HandCategory.STRAIGHT_FLUSH:
      return rv[0] === 5 ? "Wheel (5-high straight flush)" : `${SINGULAR[rv[0]!]}-high straight flush`;
    case HandCategory.FOUR_OF_A_KIND:
      return `Quad ${plural(rv[0]!)}`;
    case HandCategory.FULL_HOUSE:
      return `${plural(rv[0]!)} full of ${plural(rv[1]!)}`;
    case HandCategory.FLUSH:
      return `${SINGULAR[rv[0]!]}-high flush`;
    case HandCategory.STRAIGHT:
      return rv[0] === 5 ? "Wheel (5-high straight)" : `${SINGULAR[rv[0]!]}-high straight`;
    case HandCategory.THREE_OF_A_KIND:
      return `Trip ${plural(rv[0]!)}`;
    case HandCategory.TWO_PAIR:
      return `Two Pair, ${plural(rv[0]!)} & ${plural(rv[1]!)}`;
    case HandCategory.ONE_PAIR:
      return `Pair of ${plural(rv[0]!)}`;
    default:
      return `${SINGULAR[rv[0]!] ?? rv[0]}-high`;
  }
}
