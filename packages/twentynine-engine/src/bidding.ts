import { TnBidState } from "@poker/shared-types";

export const TN_MIN_BID = 16;
export const TN_MAX_BID = 28;

export function createBidState(firstToAct: number): TnBidState {
  return {
    highestBid: null,
    bidderSeatIndex: null,
    passedSeatIndexes: [],
    turnSeatIndex: firstToAct,
    history: [],
  };
}

/**
 * Validates a bid against the current bid state. Rules:
 * - integer within 16..28
 * - strictly higher than the current highest bid
 */
export function validateBid(bids: TnBidState, bid: number): void {
  if (!Number.isInteger(bid) || bid < TN_MIN_BID || bid > TN_MAX_BID) {
    throw new Error(`bid must be an integer between ${TN_MIN_BID} and ${TN_MAX_BID}`);
  }
  if (bids.highestBid !== null && bid <= bids.highestBid) {
    throw new Error(`bid must be strictly higher than the current highest bid (${bids.highestBid})`);
  }
}

/** Seats still allowed to act in bidding (never passed). */
export function activeBidders(bids: TnBidState, allSeatIndexes: number[]): number[] {
  return allSeatIndexes.filter((s) => !bids.passedSeatIndexes.includes(s));
}

/**
 * Anti-clockwise next seat that has NOT passed, starting from `from`.
 * Returns null when every seat has passed.
 */
export function nextActiveBidder(
  bids: TnBidState,
  from: number,
  allSeatIndexes: number[]
): number | null {
  let cursor = from;
  for (let i = 0; i < 4; i++) {
    if (!bids.passedSeatIndexes.includes(cursor)) return cursor;
    cursor = (cursor + 3) % 4;
  }
  return null;
}
