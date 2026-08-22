import { Card, EvaluatedHand, HandCategory, Rank } from "@poker/shared-types";

/** Generates all k-element combinations of `items`, order preserved within each combo. */
function combinations<T>(items: T[], k: number): T[][] {
  const result: T[][] = [];
  const current: T[] = [];

  function backtrack(start: number): void {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]!);
      backtrack(i + 1);
      current.pop();
    }
  }

  backtrack(0);
  return result;
}

/**
 * Given a set of unique ranks (descending, deduplicated), returns the high
 * card of the best 5-consecutive-rank straight found, or null if none exists.
 * Handles the A-2-3-4-5 wheel (Ace plays low, straight high card is 5).
 */
function findStraightHigh(uniqueRanksDesc: number[]): number | null {
  // Wheel check: A,5,4,3,2 - treat Ace (14) as also being a 1 for this purpose.
  const ranksForWheelCheck = uniqueRanksDesc.includes(14)
    ? [...uniqueRanksDesc, 1]
    : uniqueRanksDesc;

  for (let i = 0; i <= ranksForWheelCheck.length - 5; i++) {
    let isConsecutive = true;
    for (let j = 0; j < 4; j++) {
      if (ranksForWheelCheck[i + j]! - ranksForWheelCheck[i + j + 1]! !== 1) {
        isConsecutive = false;
        break;
      }
    }
    if (isConsecutive) {
      const high = ranksForWheelCheck[i]!;
      // The wheel's "high" card in ranksForWheelCheck is 5 (since sequence is 5,4,3,2,1)
      return high;
    }
  }
  return null;
}

/** Evaluates exactly 5 cards, returning their category and tie-break rank values. */
function evaluateFiveCardHand(cards: Card[]): EvaluatedHand {
  const sortedDesc = [...cards].sort((a, b) => b.rank - a.rank);

  const isFlush = sortedDesc.every((c) => c.suit === sortedDesc[0]!.suit);

  const uniqueRanksDesc = [...new Set(sortedDesc.map((c) => c.rank))].sort((a, b) => b - a);
  const straightHigh = findStraightHigh(uniqueRanksDesc);
  const isStraight = straightHigh !== null;

  const countByRank = new Map<number, number>();
  for (const c of sortedDesc) {
    countByRank.set(c.rank, (countByRank.get(c.rank) ?? 0) + 1);
  }

  // Ranks sorted by (frequency desc, rank desc) - e.g. for full house AAA77
  // this yields [A, 7]; for one pair KK-A-8-3 this yields [K, A, 8, 3].
  const ranksByFrequency = [...countByRank.entries()]
    .sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))
    .map(([rank]) => rank);

  const frequencies = [...countByRank.values()].sort((a, b) => b - a); // e.g. [3,2] for full house

  const orderedForDisplay = (): Card[] => {
    // Present the 5 cards ordered by descending significance; for a wheel
    // straight, the Ace plays low so it's displayed last.
    if (isStraight && straightHigh === 5 && uniqueRanksDesc.includes(14)) {
      const withoutAce = sortedDesc.filter((c) => c.rank !== 14);
      const ace = sortedDesc.find((c) => c.rank === 14)!;
      return [...withoutAce, ace];
    }
    return sortedDesc;
  };

  if (isFlush && isStraight) {
    const category = straightHigh === 14 ? HandCategory.ROYAL_FLUSH : HandCategory.STRAIGHT_FLUSH;
    return { category, rankValues: [straightHigh as number], bestFive: orderedForDisplay() };
  }

  if (frequencies[0] === 4) {
    const quadRank = ranksByFrequency[0]!;
    const kicker = ranksByFrequency[1]!;
    return {
      category: HandCategory.FOUR_OF_A_KIND,
      rankValues: [quadRank, kicker],
      bestFive: sortedDesc,
    };
  }

  if (frequencies[0] === 3 && frequencies[1] === 2) {
    const tripRank = ranksByFrequency[0]!;
    const pairRank = ranksByFrequency[1]!;
    return {
      category: HandCategory.FULL_HOUSE,
      rankValues: [tripRank, pairRank],
      bestFive: sortedDesc,
    };
  }

  if (isFlush) {
    return {
      category: HandCategory.FLUSH,
      rankValues: sortedDesc.map((c) => c.rank),
      bestFive: sortedDesc,
    };
  }

  if (isStraight) {
    return {
      category: HandCategory.STRAIGHT,
      rankValues: [straightHigh as number],
      bestFive: orderedForDisplay(),
    };
  }

  if (frequencies[0] === 3) {
    const tripRank = ranksByFrequency[0]!;
    const kickers = ranksByFrequency.slice(1); // already rank-desc among remaining
    return {
      category: HandCategory.THREE_OF_A_KIND,
      rankValues: [tripRank, ...kickers],
      bestFive: sortedDesc,
    };
  }

  if (frequencies[0] === 2 && frequencies[1] === 2) {
    const [highPair, lowPair] = [ranksByFrequency[0]!, ranksByFrequency[1]!].sort((a, b) => b - a);
    const kicker = ranksByFrequency[2]!;
    return {
      category: HandCategory.TWO_PAIR,
      rankValues: [highPair!, lowPair!, kicker],
      bestFive: sortedDesc,
    };
  }

  if (frequencies[0] === 2) {
    const pairRank = ranksByFrequency[0]!;
    const kickers = ranksByFrequency.slice(1);
    return {
      category: HandCategory.ONE_PAIR,
      rankValues: [pairRank, ...kickers],
      bestFive: sortedDesc,
    };
  }

  return {
    category: HandCategory.HIGH_CARD,
    rankValues: sortedDesc.map((c) => c.rank),
    bestFive: sortedDesc,
  };
}

/** Compares two evaluated hands: category first, then rankValues element-by-element. */
function isBetterOrEqual(a: EvaluatedHand, b: EvaluatedHand): boolean {
  if (a.category !== b.category) return a.category > b.category;
  for (let i = 0; i < Math.max(a.rankValues.length, b.rankValues.length); i++) {
    const av = a.rankValues[i] ?? 0;
    const bv = b.rankValues[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true; // exactly equal
}

/**
 * Given 5, 6, or 7 available cards (hole cards + community cards), returns
 * the best possible 5-card hand and its ranking category + tie-break values.
 * Correctly handles the A-2-3-4-5 wheel straight (Ace plays low) and picking
 * the best 5-card combination out of however many cards are available.
 */
export function evaluateHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error(`evaluateHand: need at least 5 cards, got ${cards.length}`);
  }

  const allFiveCardCombos = combinations(cards, 5);
  let best: EvaluatedHand | null = null;

  for (const combo of allFiveCardCombos) {
    const evaluated = evaluateFiveCardHand(combo);
    if (best === null || isBetterOrEqual(evaluated, best)) {
      best = evaluated;
    }
  }

  return best as EvaluatedHand;
}
