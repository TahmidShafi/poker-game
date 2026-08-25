import { describe, expect, it } from "vitest";
import { TnCard, TnSuit, TnPhase } from "@poker/shared-types";
import {
  callTrump,
  declareMarriage,
  declareTrump,
  getBidderPrivatePayload,
  lowestLegalCard,
  playCard,
  startHand,
  toPublicTwentyNineState,
  TwentyNineState,
} from "./game";
import { autoPlayHand, cardAt, driveBidding, makeMatch, orderedDeck, slotIndices } from "./testing/helpers";

function started(mode: Parameters<typeof makeMatch>[0] = "REGULAR"): TwentyNineState {
  const state = makeMatch(mode);
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
    const slots = slotIndices(0, 1); // P1 sits at dealing position 2 under order [3,2,1,0]
    expect(state.seats[1]?.batch1).toEqual([
      cardAt(orderedDeck(), slots.b1[0]!),
      cardAt(orderedDeck(), slots.b1[1]!),
      cardAt(orderedDeck(), slots.b1[2]!),
      cardAt(orderedDeck(), slots.b1[3]!),
    ]);
    expect(state.deck).toHaveLength(16);

    driveBidding(state, 3, 17);
    declareTrump(state, 3, "SPADES");
    const all = state.seats.flatMap((s) => [...s.batch1, ...s.batch2]);
    expect(state.seats.every((s) => s.batch2.length === 4)).toBe(true);
    expect(new Set(all.map((x) => `${x.suit}${x.rank}`)).size).toBe(32);
    expect(state.deck).toHaveLength(0);
    // Spot-check documented reference hands.
    expect(state.seats[3]?.hand).toContainEqual(S(11)); // P3 has SJ
    expect(state.seats[2]?.hand).toContainEqual(S(12)); // P2 has SQ
    expect(state.seats[1]?.hand).toContainEqual(S(13)); // P1 has SK
    expect(state.seats[0]?.hand).toContainEqual(S(14)); // P0 has SA
  });
});

describe("REGULAR trump full flow", () => {
  it("runs a scripted hand end-to-end with all invariants", () => {
    const state = started();
    // P3 wins at 17 and declares SPADES (holds S7,SJ).
    driveBidding(state, 3, 17);
    expect(state.bidderSeatIndex).toBe(3);
    expect(state.phase).toBe(TnPhase.TRUMP_SETUP);
    expect(getBidderPrivatePayload(state)).toEqual({ mode: "REGULAR", handNumber: 1 });
    declareTrump(state, 3, "SPADES");
    expect(state.phase).toBe(TnPhase.PLAYING);
    expect(state.actingSeatIndex).toBe(3); // leader = seat after dealer

    // Pre-play public state leaks nothing: no cards anywhere.
    let pub = toPublicTwentyNineState(state);
    const preJson = JSON.stringify(pub);
    expect(preJson).not.toContain('"rank"');
    expect(preJson.toLowerCase()).not.toContain('"hand"');
    expect(pub.trump.state).toBe("HIDDEN");

    // Trick 1 (anti-clockwise 3->2->1->0, forced spade follows): S7,S8,S9,S10.
    playCard(state, 3, S(7));
    playCard(state, 2, S(8));
    playCard(state, 1, S(9));
    playCard(state, 0, S(10));
    expect(state.currentTrick).toHaveLength(0);
    expect(state.tricksWon.B).toBe(1); // S9 (seat 1 = team B) tops S10/S8/S7
    expect(state.capturedPoints.B).toBe(3); // S10=1 + S9=2
    expect(state.ledSeatIndex).toBe(1);
    expect(state.trickNumber).toBe(2);
    expect(toPublicTwentyNineState(state).trump.state).toBe("HIDDEN"); // still secret mid-hand

    // Autoplay remaining tricks with lowest legal cards.
    autoPlayHand(state);

    expect(state.phase === TnPhase.ROUND_SCORED || state.phase === TnPhase.MATCH_OVER).toBe(true);
    expect(state.seats.every((s) => s.hand.length === 0)).toBe(true);
    expect(state.capturedPoints.A + state.capturedPoints.B).toBe(29);
    expect(state.tricksWon.A + state.tricksWon.B).toBe(8);
    expect(state.lastRoundSummary!.captured.A + state.lastRoundSummary!.captured.B).toBe(29);
    expect(state.dealerAdvancePending).toBe(true);

    pub = toPublicTwentyNineState(state);
    expect(JSON.stringify(pub)).not.toContain('"batch1"');
  });

  it("a completed hand advances the dealer anti-clockwise on the next startHand", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrump(state, 3, "SPADES");
    autoPlayHand(state);
    startHand(state);
    expect(state.dealerSeatIndex).toBe(3); // 0 -> 3
    expect(state.roundNumber).toBe(2);
  });

  it("MATCH_OVER when roundsToWin reached", () => {
    const state = makeMatch("REGULAR", 1);
    startHand(state, { deck: orderedDeck() });
    driveBidding(state, 3, 16);
    declareTrump(state, 3, "SPADES");
    autoPlayHand(state);
    expect(state.phase).toBe(TnPhase.MATCH_OVER);
    expect(state.winnerTeam).not.toBeNull();
    expect(state.matchScore[state.winnerTeam!]).toBeGreaterThanOrEqual(1);
  });
});

describe("trump reveal rules during play", () => {
  function callDeck(): TnCard[] {
    // Bidder P1 holds exactly ONE spade (S7) so they are void for the second
    // spade-led trick and can call their own hidden trump (spades).
    const base = orderedDeck();
    const byKey = new Map(base.map((card) => [`${card.suit}${card.rank}`, card]));
    const pick = (suit: TnSuit, rank: TnCard["rank"]): TnCard => {
      const card = byKey.get(`${suit}${rank}`);
      if (!card) throw new Error(`missing ${suit}${rank}`);
      return card;
    };
    const deck: TnCard[] = new Array(32);
    // Slots (dealer 0, order [3,2,1,0]): P3 p0:[0,4,8,12|16,20,24,28],
    // P2 p1:[1,5,9,13|17,21,25,29], P1 p2:[2,6,10,14|18,22,26,30], P0 p3:[3,7,11,15|19,23,27,31]
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
    const state = makeMatch("REGULAR");
    startHand(state, { deck: callDeck() });
    driveBidding(state, 1, 16); // auction starts at seat 3: pass, pass, bid, pass
    declareTrump(state, 1, "SPADES");
    expect(state.actingSeatIndex).toBe(3);

    // T1: P3 leads S8 -> P2 follows S9 -> P1 must follow with their only spade S7 -> P0 follows S10.
    playCard(state, 3, S(8));
    expect(() => callTrump(state, 2)).toThrow(/cannot follow suit/); // P2 holds SK too
    playCard(state, 2, S(9));
    expect(() => callTrump(state, 1)).toThrow(/cannot follow suit/); // P1 still holds S7
    playCard(state, 1, S(7));
    playCard(state, 0, S(10)); // highest spade? S9 wins actually -> see below
    // Winner: S9 (P2, team A, +3 pts: S9=2, S10=1).
    expect(state.tricksWon.A).toBe(1);
    expect(state.capturedPoints.A).toBe(3);
    expect(state.ledSeatIndex).toBe(2);

    // T2: P2 leads SK. Turn reaches P1 who is now VOID in spades.
    playCard(state, 2, S(13));
    expect(toPublicTwentyNineState(state).trump.state).toBe("HIDDEN");
    expect(() => callTrump(state, 1)).not.toThrow(); // void -> legal call on their turn
    expect(state.trumpRevealed).toBe(true);
    expect(toPublicTwentyNineState(state).trump).toEqual({ state: "REVEALED", suit: "SPADES" });
    expect(state.actingSeatIndex).toBe(1); // turn NOT consumed
    expect(state.currentTrick).toHaveLength(1); // no extra card added
  });

  it("rejects out-of-turn, stale and unowned card plays", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrump(state, 3, "SPADES");
    expect(() => playCard(state, 2, S(8))).toThrow(/not your turn/); // P3 acts first
    playCard(state, 3, S(7));
    expect(() => playCard(state, 3, S(11))).toThrow(/not your turn/); // stale actor
    expect(() => playCard(state, 2, S(11))).toThrow(/do not hold/); // P2 holds S8,SQ only
  });

  it("enforces follow-suit server-side regardless of client claims", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrump(state, 3, "DIAMONDS");
    playCard(state, 3, S(7)); // P3 leads S7; P2 holds S8,SQ
    expect(() => playCard(state, 2, { rank: 8, suit: "HEARTS" })).toThrow(/follow suit/);
  });
});

describe("SEVENTH_CARD mode", () => {
  it("resolves trump automatically from the bidder's 3rd second-batch card (no TRUMP_SETUP)", () => {
    const state = makeMatch("SEVENTH_CARD");
    startHand(state, { deck: orderedDeck() });
    driveBidding(state, 2, 18);
    expect(state.phase).toBe(TnPhase.PLAYING);
    const indicator = cardAt(orderedDeck(), slotIndices(0, 2).indicator);
    expect(state.indicatorCard).toEqual(indicator);
    expect(state.trumpSuit).toBe(indicator.suit);
    expect(state.trumpRevealed).toBe(false);
    expect(getBidderPrivatePayload(state)).toEqual({
      mode: "SEVENTH_CARD",
      handNumber: 1,
      indicatorCard: indicator,
    });
    const pub = toPublicTwentyNineState(state);
    expect(pub.trump.state).toBe("HIDDEN");
    expect(JSON.stringify(pub)).not.toContain(indicator.suit); // suit never leaks pre-reveal
  });

  it("cancels and redeals with the SAME dealer when the indicator is a dead single-suit trump", () => {
    // Bidder P2 (p1 slots b1:[1,5,9,13], b2:[17,21,25,29]); indicator idx25 = lone diamond.
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

    const state = makeMatch("SEVENTH_CARD");
    startHand(state, { deck });
    driveBidding(state, 2, 20);
    expect(state.phase).toBe(TnPhase.REDEALING);
    expect(state.dealerSeatIndex).toBe(0); // same dealer on cancelled hand
    expect(state.dealerAdvancePending).toBe(false);
    startHand(state); // redeal
    expect(state.roundNumber).toBe(2);
    expect(state.indicatorCard).toBeNull();
  });
});

describe("JOKER mode", () => {
  it("skips trump setup entirely and never allows CALL_TRUMP", () => {
    const state = makeMatch("JOKER");
    startHand(state, { deck: orderedDeck() });
    driveBidding(state, 3, 19);
    expect(state.phase).toBe(TnPhase.PLAYING);
    expect(state.trumpSuit).toBeNull();
    expect(toPublicTwentyNineState(state).trump).toEqual({ state: "JOKER_MODE" });
    expect(() => callTrump(state, 3)).toThrow(/joker mode has no trump/i);
  });

  it("power ranks decide tricks across suits during scripted play", () => {
    const state = makeMatch("JOKER");
    startHand(state, { deck: orderedDeck() });
    driveBidding(state, 3, 18);
    // T1: S7(P3) -> S8(P2) -> S9(P1, power pri 3) -> S10(P0, power pri 1). S9 wins for A.
    playCard(state, 3, S(7));
    playCard(state, 2, S(8));
    playCard(state, 1, S(9));
    playCard(state, 0, S(10));
    expect(state.tricksWon.B).toBe(1); // S9 winner sits on seat 1 = team B
    expect(state.capturedPoints.B).toBe(3); // S9=2 + S10=1
    expect(state.ledSeatIndex).toBe(1);
  });

  it("a higher-priority power rank beats a lower one regardless of suit", () => {
    const state = makeMatch("JOKER");
    startHand(state, { deck: orderedDeck() });
    driveBidding(state, 3, 18);
    // T1: S7(P3) -> S8(P2) -> SK(P1, not power) -> SA(P0, power pri 2). SA wins for A.
    playCard(state, 3, S(7));
    playCard(state, 2, S(8));
    playCard(state, 1, S(13));
    playCard(state, 0, S(14));
    expect(state.tricksWon.A).toBe(1);
    expect(state.capturedPoints.A).toBe(1); // SA only
    expect(state.ledSeatIndex).toBe(0);
  });
});

describe("MARRIAGE mode", () => {
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

  it("valid K+Q holder reveals the marriage; requirement shifts by -4 for the bidding team", () => {
    const state = makeMatch("MARRIAGE");
    startHand(state, { deck: marriageDeck() });
    driveBidding(state, 2, 18); // auction: P3 pass, P2 bids 18, P1 pass, P0 pass
    expect(state.bidderSeatIndex).toBe(2);
    expect(state.phase).toBe(TnPhase.TRUMP_SETUP);
    expect(getBidderPrivatePayload(state)).toEqual({ mode: "MARRIAGE", handNumber: 1 });
    declareTrump(state, 2, "HEARTS");
    expect(state.phase).toBe(TnPhase.PLAYING);

    // Wrong-suit claim rejected outright:
    expect(() => declareMarriage(state, 2, "SPADES")).toThrow(/not trump/);
    // Valid declaration (P2 holds HK+HQ of hearts):
    expect(() => declareMarriage(state, 2, "HEARTS")).not.toThrow();
    expect(state.marriageDeclaredBy).toBe("A"); // seat 2 -> team A
    expect(state.trumpRevealed).toBe(true);
    expect(toPublicTwentyNineState(state).trump).toEqual({ state: "REVEALED", suit: "HEARTS" });
    // Second claim rejected:
    expect(() => declareMarriage(state, 1, "HEARTS")).toThrow(/already declared/);

    autoPlayHand(state);
    expect(state.lastRoundSummary?.requirement).toBe(14); // bid 18 - 4
    expect(state.lastRoundSummary?.marriageTeam).toBe("A"); // declarer seat 2 = team A
    expect(state.lastRoundSummary!.captured.A + state.lastRoundSummary!.captured.B).toBe(29);
  });

  it("defending-team marriage raises the requirement by 4", () => {
    // Defender P1 (team B) holds CK+CQ of clubs; bidder P2 (team A) declares
    // clubs WITHOUT the combo -> defending marriage -> requirement = bid + 4.
    const base = orderedDeck();
    const byKey = new Map(base.map((card) => [`${card.suit}${card.rank}`, card]));
    const pick = (suit: TnSuit, rank: TnCard["rank"]): TnCard => {
      const card = byKey.get(`${suit}${rank}`);
      if (!card) throw new Error(`missing ${suit}${rank}`);
      return card;
    };
    const deck: TnCard[] = new Array(32);
    // P1 defender (p2 slots [2,6,10,14|18,22,26,30]): club marriage + spades
    deck[2] = pick("CLUBS", 13); // CK
    deck[6] = pick("CLUBS", 12); // CQ
    deck[10] = pick("SPADES", 7);
    deck[14] = pick("SPADES", 8);
    deck[18] = pick("SPADES", 9);
    deck[22] = pick("SPADES", 12);
    deck[26] = pick("SPADES", 11);
    deck[30] = pick("SPADES", 14);
    // P0 (p3 slots [3,7,11,15|19,23,27,31])
    deck[3] = pick("SPADES", 10);
    deck[7] = pick("SPADES", 13);
    deck[11] = pick("HEARTS", 7);
    deck[15] = pick("HEARTS", 8);
    deck[19] = pick("DIAMONDS", 7);
    deck[23] = pick("DIAMONDS", 8);
    deck[27] = pick("HEARTS", 9);
    deck[31] = pick("HEARTS", 14);
    // P2 bidder (p1 slots [1,5,9,13|17,21,25,29]): clubs but NO K/Q combo
    deck[1] = pick("CLUBS", 9);
    deck[5] = pick("CLUBS", 10);
    deck[9] = pick("HEARTS", 11);
    deck[13] = pick("HEARTS", 12);
    deck[17] = pick("HEARTS", 13);
    deck[21] = pick("HEARTS", 10);
    deck[25] = pick("DIAMONDS", 9);
    deck[29] = pick("DIAMONDS", 14);
    // P3 (p0 slots): the four remaining diamonds + four remaining clubs
    deck[0] = pick("DIAMONDS", 10);
    deck[4] = pick("DIAMONDS", 11);
    deck[8] = pick("DIAMONDS", 12);
    deck[12] = pick("DIAMONDS", 13);
    deck[16] = pick("CLUBS", 7);
    deck[20] = pick("CLUBS", 8);
    deck[24] = pick("CLUBS", 11);
    deck[28] = pick("CLUBS", 14);

    const state = makeMatch("MARRIAGE");
    startHand(state, { deck });
    driveBidding(state, 2, 20);
    expect(state.bidderSeatIndex).toBe(2);
    declareTrump(state, 2, "CLUBS");
    // Leader is seat 3; their lowest card is C7 (a club follow exists for all later).
    const p3Hand = state.seats[3]!.hand;
    const lead = [...p3Hand].sort((a, b) => a.rank - b.rank)[0]!;
    playCard(state, 3, lead);
    // Marriage declaration does NOT consume turns - P1 declares while off-turn:
    expect(() => declareMarriage(state, 1, "CLUBS")).not.toThrow();
    expect(state.marriageDeclaredBy).toBe("B"); // seat 1 -> team B (defenders)
    autoPlayHand(state);
    expect(state.lastRoundSummary?.requirement).toBe(24); // 20 + 4 (defending marriage)
  });
});

describe("offline-fallback helper", () => {
  it("lowestLegalCard respects follow-suit and picks minimum normal weight", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrump(state, 3, "SPADES");
    playCard(state, 3, S(7));
    // Acting seat P2 must follow spades: holds S8,SQ -> lowest weight is S8.
    expect(lowestLegalCard(state, 2)).toEqual({ rank: 8, suit: "SPADES" });
  });
});

describe("scoring guard", () => {
  it("throws an ENGINE BUG error if captured totals ever deviate from 29", () => {
    const state = started();
    driveBidding(state, 3, 16);
    declareTrump(state, 3, "SPADES");
    state.capturedPoints.A += 5; // corrupt mid-hand
    let threw = false;
    try {
      autoPlayHand(state);
    } catch (err) {
      threw = /sum to .* expected exactly 29/.test((err as Error).message);
    }
    expect(threw).toBe(true);
  });
});
