import { describe, expect, it } from "vitest";
import { TnCard, TnSuit, TnPhase } from "@poker/shared-types";
import {
  callTrump,
  declareMarriage,
  declareTrumpPlan,
  getBidderPrivatePayload,
  lowestLegalCard,
  playCard,
  startHand,
  toPublicTwentyNineState,
  TwentyNineState,
} from "./game";
import { autoPlayHand, cardAt, driveBidding, makeMatch, orderedDeck, slotIndices } from "./testing/helpers";

function started(): TwentyNineState {
  const state = makeMatch();
  startHand(state, { deck: orderedDeck() });
  return state;
}

/*
 * Ordered-deck reference (dealer = 0; anti-clockwise deal order 3->2->1->0):
 *   P3: S7,SJ,H7,HJ | D7,DJ,C7,CJ   (first bidder / first leader)
 *   P2: S8,SQ,H8,HQ | D8,DQ,C8,CQ
 *   P1: S9,SK,H9,HK | D9,DK,C9,CK
 *   P0: S10,SA,H10,HA | D10,DA,C10,CA
 */
const S = (rank: TnCard["rank"]): TnCard => ({ rank, suit: "SPADES" });

describe("dealing integrity", () => {
  it("deals batch 1 anti-clockwise (4 each); batch 2 completes all 32 cards exactly once", () => {
    const state = started();
    expect(state.seats.every((s) => s.batch1.length === 4)).toBe(true);
    expect(state.seats.every((s) => s.batch2.length === 0)).toBe(true);
    const slots = slotIndices(0, 1);
    expect(state.seats[1]?.batch1).toEqual([
      cardAt(orderedDeck(), slots.b1[0]!),
      cardAt(orderedDeck(), slots.b1[1]!),
      cardAt(orderedDeck(), slots.b1[2]!),
      cardAt(orderedDeck(), slots.b1[3]!),
    ]);
    expect(state.deck).toHaveLength(16);

    driveBidding(state, 3, 17);
    declareTrumpPlan(state, 3, "SPADES");
    const all = state.seats.flatMap((s) => [...s.batch1, ...s.batch2]);
    expect(state.seats.every((s) => s.batch2.length === 4)).toBe(true);
    expect(new Set(all.map((x) => `${x.suit}${x.rank}`)).size).toBe(32);
    expect(state.deck).toHaveLength(0);
    expect(state.seats[3]?.hand).toContainEqual(S(11)); // P3 has SJ
    expect(state.seats[2]?.hand).toContainEqual(S(12)); // P2 has SQ
    expect(state.seats[1]?.hand).toContainEqual(S(13)); // P1 has SK
    expect(state.seats[0]?.hand).toContainEqual(S(14)); // P0 has SA
  });
});

describe("SUIT choice: full scripted hand", () => {
  it("runs end-to-end with all invariants and hidden-trump privacy", () => {
    const state = started();
    // P3 wins at 17 and declares SPADES (holds S7,SJ).
    driveBidding(state, 3, 17);
    expect(state.bidderSeatIndex).toBe(3);
    expect(state.phase).toBe(TnPhase.TRUMP_SETUP);
    expect(getBidderPrivatePayload(state)).toEqual({ kind: "CHOOSE_TRUMP", handNumber: 1 });
    declareTrumpPlan(state, 3, "SPADES");
    expect(state.trumpStyle).toBe("SUIT");
    expect(state.phase).toBe(TnPhase.PLAYING);
    expect(state.actingSeatIndex).toBe(3); // leader = seat after dealer

    let pub = toPublicTwentyNineState(state);
    const preJson = JSON.stringify(pub);
    expect(preJson).not.toContain('"rank"');
    expect(preJson.toLowerCase()).not.toContain('"hand"');
    expect(pub.trump.state).toBe("HIDDEN");

    // Trick 1 (forced spade follows): S7,S8,S9,S10 -> S9 wins for B(seat1).
    playCard(state, 3, S(7));
    playCard(state, 2, S(8));
    playCard(state, 1, S(9));
    playCard(state, 0, S(10));
    expect(state.currentTrick).toHaveLength(0);
    expect(state.tricksWon.B).toBe(1);
    expect(state.capturedPoints.B).toBe(3); // S10=1 + S9=2
    expect(state.ledSeatIndex).toBe(1);
    expect(state.trickNumber).toBe(2);

    autoPlayHand(state);

    expect(state.phase === TnPhase.ROUND_SCORED || state.phase === TnPhase.MATCH_OVER).toBe(true);
    expect(state.seats.every((s) => s.hand.length === 0)).toBe(true);
    expect(state.capturedPoints.A + state.capturedPoints.B).toBe(29);
    expect(state.tricksWon.A + state.tricksWon.B).toBe(8);
    expect(state.lastRoundSummary!.captured.A + state.lastRoundSummary!.captured.B).toBe(29);
    expect(state.lastRoundSummary!.trumpStyle).toBe("SUIT");
    expect(state.dealerAdvancePending).toBe(true);
    pub = toPublicTwentyNineState(state);
    expect(pub.trumpStyle).toBe("SUIT");
  });

  it("a completed hand advances the dealer anti-clockwise on the next startHand", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrumpPlan(state, 3, "SPADES");
    autoPlayHand(state);
    startHand(state);
    expect(state.dealerSeatIndex).toBe(3);
    expect(state.roundNumber).toBe(2);
  });

  it("MATCH_OVER when roundsToWin reached", () => {
    const state = makeMatch(1);
    startHand(state, { deck: orderedDeck() });
    driveBidding(state, 3, 16);
    declareTrumpPlan(state, 3, "SPADES");
    autoPlayHand(state);
    expect(state.phase).toBe(TnPhase.MATCH_OVER);
    expect(state.winnerTeam).not.toBeNull();
    expect(state.matchScore[state.winnerTeam!]).toBeGreaterThanOrEqual(1);
  });
});

describe("trump reveal rules during play", () => {
  function callDeck(): TnCard[] {
    // Bidder P1 holds exactly ONE spade (S7) so they are void on the second
    // spade-led trick and can call their own hidden trump.
    const base = orderedDeck();
    const byKey = new Map(base.map((card) => [`${card.suit}${card.rank}`, card]));
    const pick = (suit: TnSuit, rank: TnCard["rank"]): TnCard => {
      const card = byKey.get(`${suit}${rank}`);
      if (!card) throw new Error(`missing ${suit}${rank}`);
      return card;
    };
    const deck: TnCard[] = new Array(32);
    deck[0] = pick("SPADES", 8);
    deck[4] = pick("SPADES", 11);
    deck[8] = pick("HEARTS", 11);
    deck[12] = pick("HEARTS", 13);
    deck[16] = pick("DIAMONDS", 10);
    deck[20] = pick("DIAMONDS", 13);
    deck[24] = pick("CLUBS", 7);
    deck[28] = pick("CLUBS", 11);

    deck[1] = pick("SPADES", 9);
    deck[5] = pick("HEARTS", 12);
    deck[9] = pick("DIAMONDS", 12);
    deck[13] = pick("DIAMONDS", 14);
    deck[17] = pick("SPADES", 13);
    deck[21] = pick("CLUBS", 8);
    deck[25] = pick("CLUBS", 9);
    deck[29] = pick("CLUBS", 12);

    deck[2] = pick("SPADES", 7); // P1's only spade
    deck[6] = pick("HEARTS", 7);
    deck[10] = pick("HEARTS", 8);
    deck[14] = pick("HEARTS", 9);
    deck[18] = pick("DIAMONDS", 7);
    deck[22] = pick("DIAMONDS", 8);
    deck[26] = pick("DIAMONDS", 9);
    deck[30] = pick("DIAMONDS", 11);

    deck[3] = pick("SPADES", 10);
    deck[7] = pick("SPADES", 12);
    deck[11] = pick("SPADES", 14);
    deck[15] = pick("HEARTS", 10);
    deck[19] = pick("HEARTS", 14);
    deck[23] = pick("CLUBS", 10);
    deck[27] = pick("CLUBS", 13);
    deck[31] = pick("CLUBS", 14);
    return deck;
  }

  it("CALL_TRUMP requires your turn + void in led suit; reveal neither plays a card nor moves the turn", () => {
    const state = makeMatch();
    startHand(state, { deck: callDeck() });
    driveBidding(state, 1, 16); // auction starts seat3: pass, pass, bid, pass
    declareTrumpPlan(state, 1, "SPADES");
    expect(state.actingSeatIndex).toBe(3);

    playCard(state, 3, S(8));
    expect(() => callTrump(state, 2)).toThrow(/cannot follow suit/);
    playCard(state, 2, S(9));
    expect(() => callTrump(state, 1)).toThrow(/cannot follow suit/);
    playCard(state, 1, S(7));
    playCard(state, 0, S(10));
    // Winner: S9 (P2, team A, +3 pts).
    expect(state.tricksWon.A).toBe(1);
    expect(state.capturedPoints.A).toBe(3);
    expect(state.ledSeatIndex).toBe(2);

    // T2: P2 leads SK. Turn reaches P1 who is now VOID in spades.
    playCard(state, 2, S(13));
    expect(toPublicTwentyNineState(state).trump.state).toBe("HIDDEN");
    expect(() => callTrump(state, 1)).not.toThrow();
    expect(state.trumpRevealed).toBe(true);
    expect(toPublicTwentyNineState(state).trump).toEqual({ state: "REVEALED", suit: "SPADES" });
    expect(state.actingSeatIndex).toBe(1); // turn NOT consumed
    expect(state.currentTrick).toHaveLength(1); // no extra card added
  });

  it("rejects out-of-turn, stale and unowned card plays", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrumpPlan(state, 3, "SPADES");
    expect(() => playCard(state, 2, S(8))).toThrow(/not your turn/);
    playCard(state, 3, S(7));
    expect(() => playCard(state, 3, S(11))).toThrow(/not your turn/);
    expect(() => playCard(state, 2, S(11))).toThrow(/do not hold/);
  });

  it("enforces follow-suit server-side regardless of client claims", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrumpPlan(state, 3, "DIAMONDS");
    playCard(state, 3, S(7)); // P3 leads S7; P2 holds S8,SQ
    expect(() => playCard(state, 2, { rank: 8, suit: "HEARTS" })).toThrow(/follow suit/);
  });
});

describe("SEVENTH_CARD choice", () => {
  it("resolves trump automatically from the bidder's 3rd second-batch card", () => {
    const state = makeMatch();
    startHand(state, { deck: orderedDeck() });
    driveBidding(state, 2, 18);
    expect(state.phase).toBe(TnPhase.TRUMP_SETUP);
    declareTrumpPlan(state, 2, "SEVENTH_CARD");
    expect(state.phase).toBe(TnPhase.PLAYING);
    expect(state.trumpStyle).toBe("SEVENTH_CARD");
    const indicator = cardAt(orderedDeck(), slotIndices(0, 2).indicator);
    expect(state.indicatorCard).toEqual(indicator);
    expect(state.trumpSuit).toBe(indicator.suit);
    expect(state.trumpRevealed).toBe(false);
    expect(getBidderPrivatePayload(state)).toEqual({
      kind: "SEVENTH_INDICATOR",
      handNumber: 1,
      indicatorCard: indicator,
    });
    const pub = toPublicTwentyNineState(state);
    expect(pub.trump.state).toBe("HIDDEN");
    expect(JSON.stringify(pub)).not.toContain(indicator.suit);
  });

  it("cancels and redeals with the SAME dealer when the indicator is a dead single-suit trump", () => {
    const base = orderedDeck();
    const byKey = new Map(base.map((card) => [`${card.suit}${card.rank}`, card]));
    const pick = (suit: TnSuit, rank: TnCard["rank"]): TnCard => {
      const card = byKey.get(`${suit}${rank}`);
      if (!card) throw new Error(`missing ${suit}${rank}`);
      return card;
    };
    const deck: TnCard[] = new Array(32);
    deck[1] = pick("SPADES", 7);
    deck[5] = pick("SPADES", 8);
    deck[9] = pick("SPADES", 9);
    deck[13] = pick("SPADES", 10);
    deck[17] = pick("SPADES", 11);
    deck[21] = pick("SPADES", 12);
    deck[25] = pick("DIAMONDS", 9); // indicator: bidder's ONLY diamond
    deck[29] = pick("SPADES", 13);
    const used = new Set(deck.filter(Boolean).map((x) => `${x!.suit}${x!.rank}`));
    const rest = orderedDeck().filter((x) => !used.has(`${x.suit}${x.rank}`));
    for (let i = 0; i < 32; i++) if (!deck[i]) deck[i] = rest.shift()!;

    const state = makeMatch();
    startHand(state, { deck });
    driveBidding(state, 2, 20);
    declareTrumpPlan(state, 2, "SEVENTH_CARD");
    expect(state.phase).toBe(TnPhase.REDEALING);
    expect(state.dealerSeatIndex).toBe(0);
    expect(state.dealerAdvancePending).toBe(false);
    startHand(state);
    expect(state.roundNumber).toBe(2);
    expect(state.indicatorCard).toBeNull();
  });
});

describe("JOKER choice", () => {
  it("joker hands have no suit, skip reveal entirely, and resolve power ranks", () => {
    const state = makeMatch();
    startHand(state, { deck: orderedDeck() });
    driveBidding(state, 3, 19);
    expect(state.phase).toBe(TnPhase.TRUMP_SETUP);
    declareTrumpPlan(state, 3, "JOKER");
    expect(state.phase).toBe(TnPhase.PLAYING);
    expect(state.trumpSuit).toBeNull();
    expect(toPublicTwentyNineState(state).trump).toEqual({ state: "JOKER_MODE" });
    expect(() => callTrump(state, 3)).toThrow(/joker hands have no trump/i);

    // T1: S7(P3) -> S8(P2) -> S9(P1, power pri 3) -> S10(P0, pri 1). S9 wins for B.
    playCard(state, 3, S(7));
    playCard(state, 2, S(8));
    playCard(state, 1, S(9));
    playCard(state, 0, S(10));
    expect(state.tricksWon.B).toBe(1);
    expect(state.capturedPoints.B).toBe(3);
    expect(state.ledSeatIndex).toBe(1);

    // Higher-priority power beats lower regardless of suit: A(P0) vs K(P1)?
    // Next trick led by seat 1: SK(P1) -> SA(P0, pri 2 beats nothing here? K not power)
    playCard(state, 1, S(13));
    playCard(state, 0, S(14));
    playCard(state, 3, S(11)); // SJ power pri 4 -> beats the ace
    playCard(state, 2, S(12));
    expect(state.tricksWon.B).toBe(2); // seat 3 again
    expect(state.capturedPoints.B).toBe(7); // prior 3 + SJ=3 + SA=1
    expect(state.ledSeatIndex).toBe(3);
  });
});

describe("marriage (K+Q of the active suit)", () => {
  function marriageDeck(): TnCard[] {
    // Bidder P2 gets HQ+HK plus spade fillers; everyone else shares the rest.
    const base = orderedDeck();
    const byKey = new Map(base.map((card) => [`${card.suit}${card.rank}`, card]));
    const pick = (suit: TnSuit, rank: TnCard["rank"]): TnCard => {
      const card = byKey.get(`${suit}${rank}`);
      if (!card) throw new Error(`missing ${suit}${rank}`);
      return card;
    };
    const deck: TnCard[] = new Array(32);
    deck[1] = pick("HEARTS", 12); // HQ  (P2 slots, p1)
    deck[5] = pick("HEARTS", 13); // HK -> P2 holds the heart marriage
    deck[9] = pick("SPADES", 7);
    deck[13] = pick("SPADES", 8);
    deck[17] = pick("SPADES", 9);
    deck[21] = pick("SPADES", 10);
    deck[25] = pick("SPADES", 11);
    deck[29] = pick("SPADES", 14);
    const used = new Set(deck.filter(Boolean).map((x) => `${x!.suit}${x!.rank}`));
    const rest = orderedDeck().filter((x) => !used.has(`${x.suit}${x.rank}`));
    for (let i = 0; i < 32; i++) if (!deck[i]) deck[i] = rest.shift()!;
    return deck;
  }

  it("valid K+Q holder reveals the marriage; requirement shifts -4 for the bidding team", () => {
    const state = makeMatch();
    startHand(state, { deck: marriageDeck() });
    driveBidding(state, 2, 18); // auction: P3 pass, P2 bids 18, P1 pass, P0 pass
    expect(state.bidderSeatIndex).toBe(2);
    expect(state.phase).toBe(TnPhase.TRUMP_SETUP);
    declareTrumpPlan(state, 2, "HEARTS");
    expect(state.phase).toBe(TnPhase.PLAYING);
    expect(state.trumpStyle).toBe("SUIT");

    expect(() => declareMarriage(state, 2, "SPADES")).toThrow(/not trump/);
    expect(() => declareMarriage(state, 2, "HEARTS")).not.toThrow();
    expect(state.marriageDeclaredBy).toBe("A"); // seat 2 -> team A
    expect(state.trumpRevealed).toBe(true);
    expect(toPublicTwentyNineState(state).trump).toEqual({ state: "REVEALED", suit: "HEARTS" });
    expect(() => declareMarriage(state, 1, "HEARTS")).toThrow(/already declared/);

    autoPlayHand(state);
    expect(state.lastRoundSummary?.requirement).toBe(14); // 18 - 4
    expect(state.lastRoundSummary?.marriageTeam).toBe("A");
    expect(state.lastRoundSummary?.endReason).toBe("EARLY_DEFEAT");
  });

  it("defending-team marriage raises the requirement by 4", () => {
    // Defender P1 (team B) holds CK+CQ; bidder P2 (team A) declares clubs WITHOUT combo.
    const base = orderedDeck();
    const byKey = new Map(base.map((card) => [`${card.suit}${card.rank}`, card]));
    const pick = (suit: TnSuit, rank: TnCard["rank"]): TnCard => {
      const card = byKey.get(`${suit}${rank}`);
      if (!card) throw new Error(`missing ${suit}${rank}`);
      return card;
    };
    const deck: TnCard[] = new Array(32);
    deck[2] = pick("CLUBS", 13); // CK (P1 slots, p2)
    deck[6] = pick("CLUBS", 12); // CQ
    deck[10] = pick("SPADES", 7);
    deck[14] = pick("SPADES", 8);
    deck[18] = pick("SPADES", 9);
    deck[22] = pick("SPADES", 12);
    deck[26] = pick("SPADES", 11);
    deck[30] = pick("SPADES", 14);
    deck[1] = pick("CLUBS", 9);
    deck[5] = pick("CLUBS", 10);
    deck[9] = pick("HEARTS", 11);
    deck[13] = pick("HEARTS", 12);
    deck[17] = pick("HEARTS", 13);
    deck[21] = pick("HEARTS", 10);
    deck[25] = pick("DIAMONDS", 9);
    deck[29] = pick("DIAMONDS", 14);
    deck[3] = pick("SPADES", 10);
    deck[7] = pick("SPADES", 13);
    deck[11] = pick("HEARTS", 7);
    deck[15] = pick("HEARTS", 8);
    deck[19] = pick("DIAMONDS", 7);
    deck[23] = pick("DIAMONDS", 8);
    deck[27] = pick("HEARTS", 9);
    deck[31] = pick("HEARTS", 14);
    deck[0] = pick("DIAMONDS", 10);
    deck[4] = pick("DIAMONDS", 11);
    deck[8] = pick("DIAMONDS", 12);
    deck[12] = pick("DIAMONDS", 13);
    deck[16] = pick("CLUBS", 7);
    deck[20] = pick("CLUBS", 8);
    deck[24] = pick("CLUBS", 11);
    deck[28] = pick("CLUBS", 14);

    const state = makeMatch();
    startHand(state, { deck });
    driveBidding(state, 2, 20);
    expect(state.bidderSeatIndex).toBe(2);
    declareTrumpPlan(state, 2, "CLUBS");
    const p3Hand = state.seats[3]!.hand;
    const lead = [...p3Hand].sort((a, b) => a.rank - b.rank)[0]!;
    playCard(state, 3, lead);
    expect(() => declareMarriage(state, 1, "CLUBS")).not.toThrow(); // defender, off-turn allowed
    expect(state.marriageDeclaredBy).toBe("B"); // seat 1 -> team B
    autoPlayHand(state);
    expect(state.lastRoundSummary?.requirement).toBe(24); // 20 + 4
  });
});

describe("offline-fallback helper", () => {
  it("lowestLegalCard respects follow-suit and picks minimum normal weight", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrumpPlan(state, 3, "SPADES");
    playCard(state, 3, S(7));
    expect(lowestLegalCard(state, 2)).toEqual({ rank: 8, suit: "SPADES" });
  });
});
