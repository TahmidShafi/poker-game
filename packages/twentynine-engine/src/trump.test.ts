import { describe, expect, it } from "vitest";
import { TnCard, TnSuit } from "@poker/shared-types";
import { holdsMarriage, marriageAdjustedRequirement, MARRIAGE_BONUS } from "./trump/marriage";
import { countOtherCardsOfSuit, isSeventhTrumpValid, seventhCardIndicator } from "./trump/seventh";
import { isPowerRank } from "./trump/joker";

const c = (rank: TnCard["rank"], suit: TnSuit): TnCard => ({ rank, suit });

describe("seventh-card trump", () => {
  it("indicator is exactly the 3rd card of the second batch", () => {
    const batch2 = [c(7, "SPADES"), c(8, "HEARTS"), c(9, "DIAMONDS"), c(10, "CLUBS")];
    expect(seventhCardIndicator(batch2)).toEqual(c(9, "DIAMONDS"));
  });

  it("rejects a short second batch", () => {
    expect(() => seventhCardIndicator([c(7, "SPADES")])).toThrow(/second batch/);
  });

  it("valid when at least one OTHER card shares the indicator suit", () => {
    const batch1 = [c(14, "SPADES"), c(13, "HEARTS"), c(12, "DIAMONDS"), c(11, "CLUBS")];
    const batch2 = [c(8, "HEARTS"), c(7, "CLUBS"), c(9, "DIAMONDS"), c(7, "SPADES")];
    const indicator = seventhCardIndicator(batch2); // 9 diamonds
    expect(isSeventhTrumpValid(batch1, batch2, indicator)).toBe(true);
    expect(countOtherCardsOfSuit([...batch1, ...batch2], indicator)).toBe(1); // Q diamonds
  });

  it("invalid when the indicator is the bidder's ONLY card of that suit (dead trump)", () => {
    const batch1 = [c(14, "SPADES"), c(13, "HEARTS"), c(12, "CLUBS"), c(11, "SPADES")];
    const batch2 = [c(8, "HEARTS"), c(7, "CLUBS"), c(9, "DIAMONDS"), c(7, "SPADES")];
    const indicator = c(9, "DIAMONDS");
    expect(countOtherCardsOfSuit([...batch1, ...batch2], indicator)).toBe(0);
    expect(isSeventhTrumpValid(batch1, batch2, indicator)).toBe(false);
  });

  it("another card of the same RANK but different suit does not validate", () => {
    const batch1 = [c(9, "SPADES"), c(13, "HEARTS"), c(12, "CLUBS"), c(11, "SPADES")];
    const batch2 = [c(8, "HEARTS"), c(7, "CLUBS"), c(9, "DIAMONDS"), c(7, "SPADES")];
    expect(countOtherCardsOfSuit([...batch1, ...batch2], c(9, "DIAMONDS"))).toBe(0);
  });
});

describe("marriage trump", () => {
  it("detects K+Q possession per suit", () => {
    const hand = [c(13, "HEARTS"), c(12, "HEARTS"), c(14, "SPADES")];
    expect(holdsMarriage(hand, "HEARTS")).toBe(true);
    expect(holdsMarriage(hand, "SPADES")).toBe(false);
  });

  it("K alone or Q alone is not a marriage", () => {
    expect(holdsMarriage([c(13, "CLUBS"), c(10, "CLUBS")], "CLUBS")).toBe(false);
    expect(holdsMarriage([c(12, "CLUBS"), c(10, "CLUBS")], "CLUBS")).toBe(false);
  });

  it("bonus is exactly +4", () => {
    expect(MARRIAGE_BONUS).toBe(4);
  });

  it("bidding team marriage lowers the requirement by 4 (floor at 16)", () => {
    expect(marriageAdjustedRequirement(20, "A", "A")).toBe(16);
    expect(marriageAdjustedRequirement(19, "B", "B")).toBe(16);
    expect(marriageAdjustedRequirement(18, "B", "B")).toBe(16);
    expect(marriageAdjustedRequirement(17, "B", "B")).toBe(16);
    expect(marriageAdjustedRequirement(16, "B", "B")).toBe(16);
    expect(marriageAdjustedRequirement(24, "A", "A")).toBe(20);
  });

  it("defending team marriage raises the requirement by 4", () => {
    expect(marriageAdjustedRequirement(20, "B", "A")).toBe(24);
    expect(marriageAdjustedRequirement(28, "A", "B")).toBe(32);
  });

  it("no marriage leaves the bid untouched", () => {
    expect(marriageAdjustedRequirement(22, null, "A")).toBe(22);
  });
});

describe("joker power ranks", () => {
  it("exactly J, 9, A, 10 are power ranks", () => {
    expect(isPowerRank(11)).toBe(true);
    expect(isPowerRank(9)).toBe(true);
    expect(isPowerRank(14)).toBe(true);
    expect(isPowerRank(10)).toBe(true);
    expect(isPowerRank(13)).toBe(false);
    expect(isPowerRank(12)).toBe(false);
    expect(isPowerRank(8)).toBe(false);
    expect(isPowerRank(7)).toBe(false);
  });
});
