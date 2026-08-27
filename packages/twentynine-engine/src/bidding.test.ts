import { describe, expect, it } from "vitest";
import { TnPhase } from "@poker/shared-types";
import { TN_MAX_BID, TN_MIN_BID, minLegalBid } from "./bidding";
import { applyBid, startHand, TwentyNineState } from "./game";
import { makeMatch, orderedDeck } from "./testing/helpers";

// Dealer is seat 0 -> anti-clockwise order 0->3->2->1->0 means the seat
// AFTER the dealer is seat 3, and bidding proceeds 3 -> 2 -> 1 -> 0.
// Teams: A = {0, 2}, B = {3, 1}.
function startedMatch(): TwentyNineState {
  const state = makeMatch();
  startHand(state, { deck: orderedDeck() });
  return state;
}

describe("bidding", () => {
  it("opens with the seat after the dealer, anti-clockwise", () => {
    const state = startedMatch();
    expect(state.phase).toBe(TnPhase.BIDDING);
    expect(state.bids?.turnSeatIndex).toBe(3);
    expect(state.actingSeatIndex).toBe(3);
  });

  it("accepts a legal minimum bid and records the high bid", () => {
    const state = startedMatch();
    applyBid(state, 3, TN_MIN_BID);
    expect(state.bids?.highestBid).toBe(16);
    expect(state.bids?.bidderSeatIndex).toBe(3);
    expect(state.bids?.turnSeatIndex).toBe(2); // anti-clockwise next
  });

  it("rejects bids below 16, above 28 and non-integers", () => {
    const state = startedMatch();
    expect(() => applyBid(state, 3, 15)).toThrow(/between 16 and 28/);
    expect(() => applyBid(state, 3, 29)).toThrow(/between 16 and 28/);
    expect(() => applyBid(state, 3, 17.5)).toThrow(/between 16 and 28/);
  });

  it("defender challenged by an opponent gets immediate Stay option (17 over 17 stays 17)", () => {
    const state = startedMatch();
    applyBid(state, 3, 16); // Seat 3 (B) opens with 16 -> Defender is 3, challenger is 2 (A)
    expect(state.bids?.turnSeatIndex).toBe(2);

    applyBid(state, 2, 17); // Seat 2 (A) challenges with 17
    // Turn immediately returns to Defender Seat 3!
    expect(state.bids?.turnSeatIndex).toBe(3);
    expect(minLegalBid(state.bids!, 3)).toBe(17); // Stay option available

    // Seat 3 stays at 17
    applyBid(state, 3, 17);
    expect(state.bids?.highestBid).toBe(17);
    expect(state.bids?.bidderSeatIndex).toBe(3);
    // Turn returns to Challenger Seat 2 (A)
    expect(state.bids?.turnSeatIndex).toBe(2);

    // Seat 2 challenges with 18 -> Turn returns to Seat 3
    applyBid(state, 2, 18);
    expect(state.bids?.turnSeatIndex).toBe(3);

    // Seat 3 passes -> Seat 2 becomes new Defender holding 18!
    applyBid(state, 3);
    expect(state.bids?.bidderSeatIndex).toBe(2);
    expect(state.bids?.highestBid).toBe(18);

    // Next challenger in rotation after Seat 2 is Seat 1 (B)
    expect(state.bids?.turnSeatIndex).toBe(1);

    // Seat 1 challenges Seat 2 with 19 -> Turn returns to Seat 2 (Defender)
    applyBid(state, 1, 19);
    expect(state.bids?.turnSeatIndex).toBe(2);

    // Seat 2 stays at 19 -> Turn returns to Seat 1
    applyBid(state, 2, 19);
    expect(state.bids?.turnSeatIndex).toBe(1);

    // Seat 1 passes -> Next challenger is Seat 0 (A, partner of Seat 2)
    applyBid(state, 1);
    expect(state.bids?.turnSeatIndex).toBe(0);

    // Seat 0 passes -> Seat 2 wins auction at 19!
    applyBid(state, 0);
    expect(state.bidderSeatIndex).toBe(2);
    expect(state.bid).toBe(19);
    expect(state.phase).toBe(TnPhase.TRUMP_SETUP);
  });

  it("partners may raise each other but never equal their own side", () => {
    const state = startedMatch();
    applyBid(state, 3, 18); // Seat 3 (B) holds 18
    applyBid(state, 2); // Seat 2 (A) passes
    // Next challenger is Seat 1 (B, partner of Seat 3)
    expect(state.bids?.turnSeatIndex).toBe(1);
    expect(() => applyBid(state, 1, 18)).toThrow(/partner's bid/);
    applyBid(state, 1, 20); // Partner raises own side -> Partner (Seat 1) becomes Defender!
    expect(state.bids?.highestBid).toBe(20);
    expect(state.bids?.bidderSeatIndex).toBe(1);
    // Next challenger is Seat 0 (A)
    expect(state.bids?.turnSeatIndex).toBe(0);
  });

  it("a pass is permanent for that hand", () => {
    const state = startedMatch();
    applyBid(state, 3); // pass
    expect(state.bids?.passedSeatIndexes).toContain(3);
    applyBid(state, 2, 16);
    expect(state.bids?.turnSeatIndex).toBe(1);
  });

  it("ends the moment exactly one active bidder remains; they win at their own last bid", () => {
    const state = startedMatch();
    applyBid(state, 3, 20);
    applyBid(state, 2);
    applyBid(state, 1);
    expect(state.phase).toBe(TnPhase.BIDDING);
    applyBid(state, 0);
    expect(state.phase).not.toBe(TnPhase.BIDDING);
    expect(state.bidderSeatIndex).toBe(3);
    expect(state.bid).toBe(20);
  });

  it("a lone non-passing player must still choose: their first bid wins immediately", () => {
    const state = startedMatch();
    applyBid(state, 3);
    applyBid(state, 2);
    applyBid(state, 1);
    expect(state.phase).toBe(TnPhase.BIDDING);
    expect(state.bids?.turnSeatIndex).toBe(0);
    applyBid(state, 0, 22);
    expect(state.bidderSeatIndex).toBe(0);
    expect(state.bid).toBe(22);
  });

  it("if all four players pass the hand is cancelled for redeal with the SAME dealer", () => {
    const state = startedMatch();
    applyBid(state, 3);
    applyBid(state, 2);
    applyBid(state, 1);
    applyBid(state, 0);
    expect(state.phase).toBe(TnPhase.REDEALING);
    expect(state.dealerSeatIndex).toBe(0);
    expect(state.dealerAdvancePending).toBe(false);
    expect(state.actingSeatIndex).toBeNull();
  });

  it("redeal keeps the same dealer and does not advance on cancelled hands", () => {
    const fresh = startedMatch();
    applyBid(fresh, 3);
    applyBid(fresh, 2);
    applyBid(fresh, 1);
    applyBid(fresh, 0);
    startHand(fresh);
    expect(fresh.dealerSeatIndex).toBe(0);
    expect(fresh.roundNumber).toBe(2);
    expect(fresh.bids?.turnSeatIndex).toBe(3);
  });
});

describe("minLegalBid (UI mirror)", () => {
  it("no high bid -> floor is the minimum", () => {
    const state = startedMatch();
    expect(minLegalBid(state.bids!, 3)).toBe(16);
  });

  it("defender challenged at H has floor H (Stay available); challenger has H+1", () => {
    const state = startedMatch();
    applyBid(state, 3, 17);
    applyBid(state, 2, 18); // Seat 2 (A) challenges Seat 3 (B) with 18
    // Turn is Seat 3 (Defender)
    expect(minLegalBid(state.bids!, 3)).toBe(18); // Stay available
    applyBid(state, 3, 18); // Seat 3 stays at 18
    // Turn is Seat 2 (Challenger)
    expect(minLegalBid(state.bids!, 2)).toBe(19); // Must go higher
  });
});
