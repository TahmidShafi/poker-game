import { TnBidState, tnTeamOfSeat } from "@poker/shared-types";

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
 * Validates a bid against the current bid state and the BIDDING SEAT (v2 rules):
 * - integer within 16..28
 * - when YOUR OWN TEAM holds the high bid: strictly higher only
 *   ("partner bids 18 -> other partner may go 19", never equal)
 * - when the OPPOSING team holds it: strictly higher, OR an exact MATCH of
 *   their value — but each value is matchable only once (history must contain
 *   exactly one prior bid of that value; no ping-pong at the same number)
 */
export function validateBid(bids: TnBidState, seatIndex: number, bid: number): void {
  if (!Number.isInteger(bid) || bid < TN_MIN_BID || bid > TN_MAX_BID) {
    throw new Error(`bid must be an integer between ${TN_MIN_BID} and ${TN_MAX_BID}`);
  }
  if (bids.highestBid === null) return; // first bid — both teammates may open

  const holder = bids.bidderSeatIndex;
  if (holder === null) throw new Error("engine bug: high bid without a holder");

  const H = bids.highestBid;
  const myTeam = tnTeamOfSeat(seatIndex);
  const holderTeam = tnTeamOfSeat(holder);

  if (myTeam === holderTeam) {
    if (bid <= H) throw new Error("must be higher than your partner's bid");
    return;
  }

  // Opposing team holds the bid.
  if (bid < H) {
    throw new Error(`bid must be strictly higher than the current highest bid (${H})`);
  }
  if (bid === H) {
    const priorCount = bids.history.filter((h) => h.bid === H).length;
    if (priorCount !== 1) throw new Error("that bid is already matched - go higher or pass");
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
 * opponents holding an unmatched H => H itself is available as a match.
 */
export function minLegalBid(bids: TnBidState, seatIndex: number): number {
  const H = bids.highestBid;
  if (H === null || bids.bidderSeatIndex === null) return TN_MIN_BID;
  if (tnTeamOfSeat(seatIndex) !== tnTeamOfSeat(bids.bidderSeatIndex)) {
    const priorCount = bids.history.filter((h) => h.bid === H).length;
    if (H >= TN_MIN_BID && priorCount === 1) return H; // match available
  }
  return Math.max(TN_MIN_BID, H + 1);
}
