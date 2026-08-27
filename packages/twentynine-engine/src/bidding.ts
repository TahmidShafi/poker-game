import { TnBidState, tnTeamOfSeat } from "@poker/shared-types";

export const TN_MIN_BID = 16;
export const TN_MAX_BID = 28;

export function createBidState(firstToAct: number): TnBidState {
  return {
    highestBid: null,
    bidderSeatIndex: null,
    challengerSeatIndex: null,
    passedSeatIndexes: [],
    turnSeatIndex: firstToAct,
    history: [],
  };
}

/** Check if seatIndex is the Defender responding to a challenge with a Stay option. */
export function canStay(bids: TnBidState, seatIndex: number): boolean {
  const H = bids.highestBid;
  if (H === null || bids.bidderSeatIndex === null) return false;
  return (
    seatIndex === bids.bidderSeatIndex &&
    bids.challengerSeatIndex !== null &&
    bids.challengerSeatIndex !== undefined &&
    bids.challengerSeatIndex !== seatIndex &&
    H <= TN_MAX_BID
  );
}

/**
 * Validates a bid in the 29 bidding duel:
 * - integer within 16..28
 * - when you are the Defender challenged with H: minimum bid is H (Stay)
 * - otherwise: strictly higher than the current highest bid H
 */
export function validateBid(bids: TnBidState, seatIndex: number, bid: number): void {
  if (!Number.isInteger(bid) || bid < TN_MIN_BID || bid > TN_MAX_BID) {
    throw new Error(`bid must be an integer between ${TN_MIN_BID} and ${TN_MAX_BID}`);
  }
  if (bids.highestBid === null) return; // opening bid

  const H = bids.highestBid;
  const holder = bids.bidderSeatIndex;
  if (holder === null) throw new Error("engine bug: high bid without a holder");

  // Defender responding to challenge with a Stay
  if (canStay(bids, seatIndex)) {
    if (bid < H) throw new Error(`bid cannot be lower than the current challenge (${H})`);
    return;
  }

  // Everyone else must bid strictly higher than H
  if (bid <= H) {
    if (tnTeamOfSeat(seatIndex) === tnTeamOfSeat(holder)) {
      throw new Error("must be higher than your partner's bid");
    }
    throw new Error(`bid must be strictly higher than the current highest bid (${H})`);
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

/**
 * Lowest legal bid value for `seatIndex` right now (UI mirror of validateBid):
 * Defender challenged at H => H itself is available as a Stay.
 */
export function minLegalBid(bids: TnBidState, seatIndex: number): number {
  const H = bids.highestBid;
  if (H === null || bids.bidderSeatIndex === null) return TN_MIN_BID;
  if (canStay(bids, seatIndex)) return H;
  return Math.min(TN_MAX_BID, H + 1);
}
