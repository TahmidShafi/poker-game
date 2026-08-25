import { describe, expect, it } from "vitest";
import { TnPhase } from "@poker/shared-types";
import { TN_MAX_BID, TN_MIN_BID } from "./bidding";
import { applyBid, startHand, TwentyNineState } from "./game";
import { makeMatch, orderedDeck } from "./testing/helpers";

// Dealer is seat 0 -> anti-clockwise order 0->3->2->1->0 means the seat
// AFTER the dealer is seat 3, and play/bidding proceed 3 -> 2 -> 1 -> 0.
function startedMatch(): TwentyNineState {
  const state = makeMatch("REGULAR");
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
    expect(state.actingSeatIndex).toBe(2);
  });

  it("rejects bids below 16, above 28 and non-integers", () => {
    const state = startedMatch();
    expect(() => applyBid(state, 3, 15)).toThrow(/between 16 and 28/);
    expect(() => applyBid(state, 3, 29)).toThrow(/between 16 and 28/);
    expect(() => applyBid(state, 3, 17.5)).toThrow(/between 16 and 28/);
  });

  it("requires strictly higher bids", () => {
    const state = startedMatch();
    applyBid(state, 3, 18);
    expect(() => applyBid(state, 2, 18)).toThrow(/strictly higher/);
    expect(() => applyBid(state, 2, 16)).toThrow(/strictly higher/);
    applyBid(state, 2, 19);
    expect(state.bids?.highestBid).toBe(19);
  });

  it("a pass is permanent for that hand", () => {
    const state = startedMatch();
    applyBid(state, 3); // pass
    expect(state.bids?.passedSeatIndexes).toContain(3);
    applyBid(state, 2, 16);
    applyBid(state, 1, 17);
    // Seat 3's turn will never come again; acting seat is now 0.
    expect(() => applyBid(state, 3, 18)).toThrow(/turn to bid/);
    applyBid(state, 0, 18);
    expect(state.bids?.highestBid).toBe(18);
  });

  it("ends the moment exactly one active bidder remains; they win at their own last bid", () => {
    const state = startedMatch();
    applyBid(state, 3, 20); // P3 bids
    applyBid(state, 2); // pass
    applyBid(state, 1); // pass -> active = {P3, P0}
    expect(state.phase).toBe(TnPhase.BIDDING);
    applyBid(state, 0); // pass -> only P3 active with outstanding 20
    expect(state.phase).not.toBe(TnPhase.BIDDING);
    expect(state.bidderSeatIndex).toBe(3);
    expect(state.bid).toBe(20);
  });

  it("a lone non-passing player must still choose: their first bid wins immediately", () => {
    const state = startedMatch();
    applyBid(state, 3); // pass
    applyBid(state, 2); // pass
    applyBid(state, 1); // pass -> P0 alone but has not bid yet: auction continues
    expect(state.phase).toBe(TnPhase.BIDDING);
    expect(state.bids?.turnSeatIndex).toBe(0);
    applyBid(state, 0, 22);
    expect(state.bidderSeatIndex).toBe(0);
    expect(state.bid).toBe(22);
    expect(state.phase === TnPhase.BIDDING).toBe(false);
  });

  it("if all four players pass the hand is cancelled for redeal with the SAME dealer", () => {
    const state = startedMatch();
    applyBid(state, 3);
    applyBid(state, 2);
    applyBid(state, 1);
    applyBid(state, 0);
    expect(state.phase).toBe(TnPhase.REDEALING);
    expect(state.dealerSeatIndex).toBe(0); // unchanged
    expect(state.dealerAdvancePending).toBe(false);
    expect(state.actingSeatIndex).toBeNull();
  });

  it("redeal keeps the same dealer and does not advance on cancelled hands", () => {
    const fresh = startedMatch();
    applyBid(fresh, 3);
    applyBid(fresh, 2);
    applyBid(fresh, 1);
    applyBid(fresh, 0);
    expect(fresh.phase).toBe(TnPhase.REDEALING);
    startHand(fresh); // redeal
    expect(fresh.dealerSeatIndex).toBe(0); // same dealer
    expect(fresh.roundNumber).toBe(2);
    expect(fresh.phase).toBe(TnPhase.BIDDING);
    expect(fresh.bids?.turnSeatIndex).toBe(3);
  });
});
