import { describe, it, expect } from "vitest";
import { compareHands } from "./comparison";
import { evaluateHand } from "./evaluator";
import { Card } from "@poker/shared-types";

function c(rank: Card["rank"], suit: Card["suit"]): Card {
  return { rank, suit };
}

describe("compareHands - different categories", () => {
  it("a Flush beats a Straight regardless of rankValues", () => {
    const flush = evaluateHand([c(2, "HEARTS"), c(5, "HEARTS"), c(7, "HEARTS"), c(9, "HEARTS"), c(11, "HEARTS")]);
    const straight = evaluateHand([c(10, "SPADES"), c(11, "CLUBS"), c(12, "DIAMONDS"), c(13, "HEARTS"), c(14, "SPADES")]);
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
    expect(compareHands(straight, flush)).toBeLessThan(0);
  });

  it("Four of a Kind beats a Full House", () => {
    const quads = evaluateHand([c(2, "SPADES"), c(2, "HEARTS"), c(2, "DIAMONDS"), c(2, "CLUBS"), c(14, "SPADES")]);
    const fullHouse = evaluateHand([c(14, "SPADES"), c(14, "HEARTS"), c(14, "DIAMONDS"), c(13, "CLUBS"), c(13, "HEARTS")]);
    expect(compareHands(quads, fullHouse)).toBeGreaterThan(0);
  });
});

describe("compareHands - pair vs pair (spec example)", () => {
  it("Player A (AA-K kicker) beats Player B (AA-Q kicker)", () => {
    const playerA = evaluateHand([c(14, "SPADES"), c(14, "HEARTS"), c(13, "CLUBS"), c(8, "DIAMONDS"), c(5, "SPADES")]);
    const playerB = evaluateHand([c(14, "DIAMONDS"), c(14, "CLUBS"), c(12, "SPADES"), c(8, "DIAMONDS"), c(5, "SPADES")]);
    expect(compareHands(playerA, playerB)).toBeGreaterThan(0);
  });
});

describe("compareHands - two pair", () => {
  it("compares highest pair first", () => {
    const higherTopPair = evaluateHand([c(13, "SPADES"), c(13, "HEARTS"), c(4, "CLUBS"), c(4, "DIAMONDS"), c(9, "SPADES")]);
    const lowerTopPair = evaluateHand([c(11, "SPADES"), c(11, "HEARTS"), c(10, "CLUBS"), c(10, "DIAMONDS"), c(14, "SPADES")]);
    expect(compareHands(higherTopPair, lowerTopPair)).toBeGreaterThan(0);
  });

  it("falls back to second pair when top pair ties", () => {
    const higherSecondPair = evaluateHand([c(13, "SPADES"), c(13, "HEARTS"), c(9, "CLUBS"), c(9, "DIAMONDS"), c(2, "SPADES")]);
    const lowerSecondPair = evaluateHand([c(13, "CLUBS"), c(13, "DIAMONDS"), c(6, "CLUBS"), c(6, "HEARTS"), c(2, "SPADES")]);
    expect(compareHands(higherSecondPair, lowerSecondPair)).toBeGreaterThan(0);
  });

  it("falls back to kicker when both pairs tie", () => {
    const higherKicker = evaluateHand([c(13, "SPADES"), c(13, "HEARTS"), c(9, "CLUBS"), c(9, "DIAMONDS"), c(11, "SPADES")]);
    const lowerKicker = evaluateHand([c(13, "CLUBS"), c(13, "DIAMONDS"), c(9, "SPADES"), c(9, "HEARTS"), c(4, "CLUBS")]);
    expect(compareHands(higherKicker, lowerKicker)).toBeGreaterThan(0);
  });
});

describe("compareHands - full house", () => {
  it("compares the three-of-a-kind rank first", () => {
    const higherTrips = evaluateHand([c(9, "SPADES"), c(9, "HEARTS"), c(9, "DIAMONDS"), c(2, "CLUBS"), c(2, "SPADES")]);
    const lowerTrips = evaluateHand([c(8, "SPADES"), c(8, "HEARTS"), c(8, "DIAMONDS"), c(14, "CLUBS"), c(14, "SPADES")]);
    expect(compareHands(higherTrips, lowerTrips)).toBeGreaterThan(0);
  });

  it("falls back to the pair rank when trips tie (impossible with one 5-card hand, but validated at rankValues level)", () => {
    const higherPair = evaluateHand([c(9, "SPADES"), c(9, "HEARTS"), c(9, "DIAMONDS"), c(8, "CLUBS"), c(8, "SPADES")]);
    const lowerPair = evaluateHand([c(9, "CLUBS"), c(9, "DIAMONDS"), c(9, "SPADES"), c(4, "CLUBS"), c(4, "HEARTS")]);
    expect(compareHands(higherPair, lowerPair)).toBeGreaterThan(0);
  });
});

describe("compareHands - four of a kind kicker", () => {
  it("compares kicker when quad rank ties (evaluated via 7-card hands sharing board quads)", () => {
    const higherKicker = evaluateHand([c(9, "SPADES"), c(9, "HEARTS"), c(9, "DIAMONDS"), c(9, "CLUBS"), c(14, "SPADES")]);
    const lowerKicker = evaluateHand([c(9, "SPADES"), c(9, "HEARTS"), c(9, "DIAMONDS"), c(9, "CLUBS"), c(2, "SPADES")]);
    expect(compareHands(higherKicker, lowerKicker)).toBeGreaterThan(0);
  });
});

describe("compareHands - straight", () => {
  it("compares by highest card", () => {
    const higherStraight = evaluateHand([c(8, "SPADES"), c(9, "HEARTS"), c(10, "CLUBS"), c(11, "DIAMONDS"), c(12, "SPADES")]);
    const lowerStraight = evaluateHand([c(4, "SPADES"), c(5, "HEARTS"), c(6, "CLUBS"), c(7, "DIAMONDS"), c(8, "SPADES")]);
    expect(compareHands(higherStraight, lowerStraight)).toBeGreaterThan(0);
  });

  it("the wheel (5-high) loses to a 6-high straight", () => {
    const wheel = evaluateHand([c(14, "SPADES"), c(2, "HEARTS"), c(3, "CLUBS"), c(4, "DIAMONDS"), c(5, "SPADES")]);
    const sixHigh = evaluateHand([c(2, "SPADES"), c(3, "HEARTS"), c(4, "CLUBS"), c(5, "DIAMONDS"), c(6, "SPADES")]);
    expect(compareHands(wheel, sixHigh)).toBeLessThan(0);
  });
});

describe("compareHands - flush", () => {
  it("compares cards from highest to lowest", () => {
    const higherFlush = evaluateHand([c(14, "HEARTS"), c(10, "HEARTS"), c(8, "HEARTS"), c(6, "HEARTS"), c(2, "HEARTS")]);
    const lowerFlush = evaluateHand([c(13, "SPADES"), c(11, "SPADES"), c(9, "SPADES"), c(7, "SPADES"), c(3, "SPADES")]);
    expect(compareHands(higherFlush, lowerFlush)).toBeGreaterThan(0);
  });

  it("falls back to lower cards when the top card ties", () => {
    const higherSecond = evaluateHand([c(13, "HEARTS"), c(11, "HEARTS"), c(8, "HEARTS"), c(6, "HEARTS"), c(2, "HEARTS")]);
    const lowerSecond = evaluateHand([c(13, "SPADES"), c(9, "SPADES"), c(8, "SPADES"), c(6, "SPADES"), c(2, "SPADES")]);
    expect(compareHands(higherSecond, lowerSecond)).toBeGreaterThan(0);
  });
});

describe("compareHands - high card", () => {
  it("compares highest card, then next highest, and so on", () => {
    const handA = evaluateHand([c(14, "SPADES"), c(11, "HEARTS"), c(8, "CLUBS"), c(6, "DIAMONDS"), c(3, "SPADES")]);
    const handB = evaluateHand([c(14, "HEARTS"), c(11, "CLUBS"), c(8, "DIAMONDS"), c(6, "SPADES"), c(2, "HEARTS")]);
    // Both A,J,8,6 tie; final card 3 vs 2 decides it.
    expect(compareHands(handA, handB)).toBeGreaterThan(0);
  });
});

describe("compareHands - exact ties", () => {
  it("returns 0 for identical hands using different suits (chop pot scenario)", () => {
    const handA = evaluateHand([c(13, "SPADES"), c(13, "CLUBS"), c(9, "HEARTS"), c(6, "DIAMONDS"), c(2, "SPADES")]);
    const handB = evaluateHand([c(13, "HEARTS"), c(13, "DIAMONDS"), c(9, "SPADES"), c(6, "CLUBS"), c(2, "HEARTS")]);
    expect(compareHands(handA, handB)).toBe(0);
  });

  it("returns 0 when two players play the same board (zero hole cards used by either)", () => {
    const board = [c(14, "SPADES"), c(13, "SPADES"), c(12, "SPADES"), c(11, "SPADES"), c(10, "SPADES")];
    const playerA = evaluateHand([...board, c(2, "CLUBS"), c(3, "HEARTS")]);
    const playerB = evaluateHand([...board, c(4, "DIAMONDS"), c(5, "CLUBS")]);
    expect(compareHands(playerA, playerB)).toBe(0);
  });

  it("compareHands is anti-symmetric: swapping arguments negates the result", () => {
    const handA = evaluateHand([c(14, "SPADES"), c(14, "HEARTS"), c(13, "CLUBS"), c(8, "DIAMONDS"), c(5, "SPADES")]);
    const handB = evaluateHand([c(14, "DIAMONDS"), c(14, "CLUBS"), c(12, "SPADES"), c(8, "DIAMONDS"), c(5, "SPADES")]);
    expect(compareHands(handA, handB)).toBe(-compareHands(handB, handA));
  });
});
