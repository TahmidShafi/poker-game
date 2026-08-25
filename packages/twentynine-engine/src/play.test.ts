import { describe, expect, it } from "vitest";
import { TnCard, TnSuit, TnTrickPlay } from "@poker/shared-types";
import { legalCards, resolveWinner } from "./play";

const c = (rank: TnCard["rank"], suit: TnSuit): TnCard => ({ rank, suit });
const play = (seatIndex: number, card: TnCard): TnTrickPlay => ({ seatIndex, card });

describe("follow-suit legality", () => {
  it("leading allows every card", () => {
    const hand = [c(11, "SPADES"), c(7, "HEARTS")];
    expect(legalCards(hand, null)).toEqual(hand);
  });

  it("holding the led suit restricts to that suit only", () => {
    const hand = [c(11, "HEARTS"), c(9, "HEARTS"), c(13, "SPADES"), c(7, "CLUBS")];
    expect(legalCards(hand, "HEARTS")).toEqual([c(11, "HEARTS"), c(9, "HEARTS")]);
  });

  it("void in led suit may play anything", () => {
    const hand = [c(13, "SPADES"), c(7, "CLUBS")];
    expect(legalCards(hand, "DIAMONDS")).toEqual(hand);
  });
});

describe("standard trick resolution", () => {
  it("no trump involved: highest of the LED suit wins", () => {
    const plays = [
      play(0, c(14, "HEARTS")),
      play(3, c(11, "HEARTS")),
      play(2, c(13, "SPADES")),
      play(1, c(9, "HEARTS")),
    ];
    const w = resolveWinner(plays, "HEARTS", { jokerMode: false, trumpSuit: null, trumpRevealed: false });
    expect(w.seatIndex).toBe(3); // J hearts
  });

  it("off-suit cards never win when the led suit is represented", () => {
    const plays = [
      play(0, c(7, "DIAMONDS")),
      play(1, c(14, "SPADES")),
      play(2, c(7, "CLUBS")),
      play(3, c(8, "HEARTS")),
    ];
    const w = resolveWinner(plays, "DIAMONDS", { jokerMode: false, trumpSuit: null, trumpRevealed: false });
    expect(w.seatIndex).toBe(0); // only diamond
  });

  it("BEFORE reveal a physical trump has no power (nobody knows it)", () => {
    // Spades are the secret trump; J spade is just a non-club off-suit card.
    const plays = [
      play(0, c(8, "CLUBS")),
      play(1, c(11, "SPADES")),
      play(2, c(7, "DIAMONDS")),
      play(3, c(7, "HEARTS")),
    ];
    const w = resolveWinner(plays, "CLUBS", { jokerMode: false, trumpSuit: "SPADES", trumpRevealed: false });
    expect(w.seatIndex).toBe(0);
  });

  it("AFTER reveal any trump beats non-trump", () => {
    const plays = [
      play(0, c(14, "HEARTS")),
      play(1, c(7, "SPADES")), // lowest trump still beats the ace of hearts
      play(2, c(7, "DIAMONDS")),
      play(3, c(13, "CLUBS")),
    ];
    const w = resolveWinner(plays, "HEARTS", { jokerMode: false, trumpSuit: "SPADES", trumpRevealed: true });
    expect(w.seatIndex).toBe(1);
  });

  it("multiple trumps after reveal: highest-ranked trump wins (J>9>A>10>K>Q>8>7)", () => {
    const plays = [
      play(0, c(9, "SPADES")),
      play(1, c(11, "SPADES")),
      play(2, c(14, "SPADES")),
      play(3, c(10, "SPADES")),
    ];
    const w = resolveWinner(plays, "HEARTS", { jokerMode: false, trumpSuit: "SPADES", trumpRevealed: true });
    expect(w.seatIndex).toBe(1); // J
  });
});

describe("joker-mode trick resolution", () => {
  it("J beats 9 across suits; priority J > 9 > A > 10", () => {
    const plays = [
      play(0, c(9, "HEARTS")),
      play(1, c(11, "CLUBS")),
      play(2, c(14, "SPADES")),
      play(3, c(10, "DIAMONDS")),
    ];
    const w = resolveWinner(plays, "HEARTS", { jokerMode: true, trumpSuit: null, trumpRevealed: false });
    expect(w.seatIndex).toBe(1); // J
  });

  it("without power cards the highest of the led suit wins as normal", () => {
    const plays = [
      play(0, c(13, "HEARTS")),
      play(1, c(8, "SPADES")),
      play(2, c(12, "HEARTS")),
      play(3, c(7, "CLUBS")),
    ];
    const w = resolveWinner(plays, "HEARTS", { jokerMode: true, trumpSuit: null, trumpRevealed: false });
    expect(w.seatIndex).toBe(0); // K hearts (A is a power rank, so K tops here)
  });

  it("equal power ranks tie-break: led suit first, then earlier play", () => {
    const jackLedFirst = [play(0, c(11, "HEARTS")), play(1, c(11, "CLUBS")), play(2, c(7, "DIAMONDS")), play(3, c(8, "SPADES"))];
    expect(
      resolveWinner(jackLedFirst, "HEARTS", { jokerMode: true, trumpSuit: null, trumpRevealed: false }).seatIndex
    ).toBe(0);

    const offsuitJacks = [play(0, c(11, "CLUBS")), play(1, c(11, "SPADES")), play(2, c(7, "DIAMONDS")), play(3, c(8, "HEARTS"))];
    expect(
      resolveWinner(offsuitJacks, "HEARTS", { jokerMode: true, trumpSuit: null, trumpRevealed: false }).seatIndex
    ).toBe(0); // earlier play wins on full ties
  });
});

describe("resolveWinner guards", () => {
  it("requires exactly four plays", () => {
    const plays = [play(0, c(7, "SPADES"))];
    expect(() =>
      resolveWinner(plays, "SPADES", { jokerMode: false, trumpSuit: null, trumpRevealed: false })
    ).toThrow(/expected 4 plays/);
  });
});
