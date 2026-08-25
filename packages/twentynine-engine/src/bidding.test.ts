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

  it("opponents may MATCH the current value exactly once (17 over 17 stays 17)", () => {
    const state = startedMatch();
    applyBid(state, 3, 16); // B opens
    applyBid(state, 2, 17); // A raises -> turn is seat 1 (B)
    // Seat 1 (B) faces an opposing single 17 -> matching is LEGAL.
    expect(() => applyBid(state, 1, 17)).not.toThrow();
    expect(state.bids?.highestBid).toBe(17);
    expect(state.bids?.bidderSeatIndex).toBe(1);
    // Seat 0 (A): the 17 is already matched -> must go higher or pass.
    expect(() => applyBid(state, 0, 17)).toThrow(/already matched/);
    applyBid(state, 0); // A passes
    // Seat 3 (B) faces OWN-team holder (seat 1): equality forbidden.
    expect(() => applyBid(state, 3, 17)).toThrow(/partner's bid/);
    applyBid(state, 3, 18); // strictly higher within own team
    applyBid(state, 2, 19); // A steals
    applyBid(state, 1, 19); // fresh single 19 -> B matches once more
    applyBid(state, 3); // B partner passes (rotation reaches seat 3 first)
    applyBid(state, 2); // A passes -> only seat 1 remains
    expect(state.bidderSeatIndex).toBe(1);
    expect(state.bid).toBe(19);
    expect(state.phase).not.toBe(TnPhase.BIDDING);
  });

  it("partners may raise each other but never equal their own side", () => {
    const state = startedMatch();
    applyBid(state, 3, 18); // B holds
    applyBid(state, 2, 19); // A steals
    applyBid(state, 1, 20); // B retakes
    applyBid(state, 0); // A passes -> seat 3 (B, partner of holder) decides
    expect(() => applyBid(state, 3, 20)).toThrow(/partner's bid/); // equal forbidden
    applyBid(state, 3, 21); // strictly higher allowed within own team
    expect(state.bids?.highestBid).toBe(21);
    expect(state.bids?.bidderSeatIndex).toBe(3);
  });

  it("before any high bid exists teammates are free to open and raise", () => {
    const state = startedMatch();
    applyBid(state, 3, 16); // B opens
    applyBid(state, 2); // A passes
    applyBid(state, 1, 17); // B partner raises own side - strictly higher, allowed
    expect(state.bids?.bidderSeatIndex).toBe(1);
    expect(state.bids?.highestBid).toBe(17);
  });

  it("a pass is permanent for that hand", () => {
    const state = startedMatch();
    applyBid(state, 3); // pass
    expect(state.bids?.passedSeatIndexes).toContain(3);
    applyBid(state, 2, 16);
    applyBid(state, 1, 17);
    expect(() => applyBid(state, 3, 18)).toThrow(/turn to bid/);
    applyBid(state, 0, 18);
    expect(state.bids?.highestBid).toBe(18);
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

  it("opponent-held unmatched value -> floor equals H (match available); matched -> H+1", () => {
    const state = startedMatch();
    applyBid(state, 3, 17);
    applyBid(state, 2, 18); // A holds, single 18 in history
    expect(minLegalBid(state.bids!, 3)).toBe(18); // B may match
    applyBid(state, 1, 19); // B retakes higher (strictly above opponent)
    expect(minLegalBid(state.bids!, 2)).toBe(19); // A may match the fresh 19
    applyBid(state, 0, 19); // A matches 19
    expect(minLegalBid(state.bids!, 3)).toBe(20); // matched -> must exceed
  });

  it("own team holding -> floor is strictly higher", () => {
    const state = startedMatch();
    applyBid(state, 3, 17);
    applyBid(state, 2, 18);
    applyBid(state, 1, 19); // B holds via partner seat1... seat1 is B; holder=1
    expect(minLegalBid(state.bids!, 3)).toBe(20); // same team as holder
  });
});
