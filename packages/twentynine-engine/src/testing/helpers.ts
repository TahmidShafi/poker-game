import { TnCard, TnPhase } from "@poker/shared-types";
import {
  applyBid,
  createMatch,
  moveOptionsForSeat,
  playCard,
  startHand,
  TwentyNineState,
} from "../game";
import { createTnDeck, tnNextSeat } from "../deck";

export function makeMatch(roundsToWin = 6): TwentyNineState {
  return createMatch({
    gameId: "test-game",
    roundsToWin,
    seats: [0, 1, 2, 3].map((i) => ({ seatIndex: i, username: `P${i}` })),
  });
}

/** Deterministic deck: SPADES(7..A), HEARTS, DIAMONDS, CLUBS. */
export function orderedDeck(): TnCard[] {
  return createTnDeck();
}

/**
 * Slot indices of a seat's cards for a hand dealt anti-clockwise starting
 * after `dealer`: batch1 gets deck[p], deck[p+4], deck[p+8], deck[p+12] and
 * batch2 gets deck[16+p], deck[20+p], deck[24+p], deck[28+p], where p is the
 * seat's position in the dealing order.
 */
export function slotIndices(dealer: number, seatIndex: number) {
  const order = [
    tnNextSeat(dealer),
    tnNextSeat(tnNextSeat(dealer)),
    tnNextSeat(tnNextSeat(tnNextSeat(dealer))),
    dealer,
  ];
  const p = order.indexOf(seatIndex);
  if (p < 0) throw new Error(`seat ${seatIndex} not in dealing order`);
  return {
    b1: [p, p + 4, p + 8, p + 12],
    b2: [16 + p, 20 + p, 24 + p, 28 + p],
    indicator: 24 + p,
    orderPosition: p,
  };
}

export function cardAt(deck: TnCard[], index: number): TnCard {
  const c = deck[index];
  if (!c) throw new Error(`no card at ${index}`);
  return c;
}

/**
 * Drives the auction until `winnerSeat` wins at exactly `bid`:
 * every other seat passes; the winner bids once.
 */
export function driveBidding(state: TwentyNineState, winnerSeat: number, bid: number): void {
  let steps = 0;
  while (state.phase === TnPhase.BIDDING) {
    steps++;
    if (steps > 24) throw new Error("driveBidding did not terminate");
    const turn = state.bids?.turnSeatIndex;
    if (turn === undefined || turn === null) throw new Error("no bidding turn");
    if (turn === winnerSeat) {
      applyBid(state, turn, bid);
    } else {
      applyBid(state, turn); // pass
    }
  }
}

/** Autoplays tricks with the lowest legal card each turn until the hand leaves PLAYING. */
export function autoPlayHand(state: TwentyNineState): void {
  let guard = 0;
  while (state.phase === TnPhase.PLAYING) {
    guard++;
    if (guard > 64) throw new Error("autoPlayHand did not terminate");
    const acting = state.actingSeatIndex;
    if (acting === null) throw new Error("no acting seat during PLAYING");
    const opts = moveOptionsForSeat(state, acting);
    const low = opts.legalCards.reduce((min, c) => (c.rank < min.rank ? c : min));
    playCard(state, acting, low);
  }
}
