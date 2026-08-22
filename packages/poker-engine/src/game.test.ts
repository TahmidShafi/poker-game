import { describe, expect, it } from "vitest";
import { GamePhase } from "@poker/shared-types";
import {
  advancePhase,
  countInHand,
  createTable,
  eligibleForHand,
  endBettingRound,
  MAX_SEATS,
  rotateDealer,
  startHand,
  TableState,
} from "./game";
import { mkSeat } from "./testing/helpers";

function tableWithPlayers(
  specs: { seatIndex: number; coins: number; status?: TableState["seats"][number]["status"] }[],
  blinds = { smallBlind: 50, bigBlind: 100 }
): TableState {
  const t = createTable(blinds);
  for (const spec of specs) {
    t.seats[spec.seatIndex] = {
      ...mkSeat(spec.seatIndex, { coins: spec.coins, status: spec.status ?? "SITTING_OUT" }),
    };
  }
  return t;
}

describe("createTable", () => {
  it("starts waiting with 10 empty seats and sane defaults", () => {
    const t = createTable({ smallBlind: 10, bigBlind: 20 });
    expect(t.phase).toBe(GamePhase.WAITING_FOR_PLAYERS);
    expect(t.seats).toHaveLength(MAX_SEATS);
    expect(t.handNumber).toBe(0);
    expect(t.dealerSeatIndex).toBeNull();
  });

  it("rejects invalid blinds", () => {
    expect(() => createTable({ smallBlind: 0, bigBlind: 20 })).toThrow(/smallBlind/);
    expect(() => createTable({ smallBlind: 30, bigBlind: 20 })).toThrow(/bigBlind/);
    expect(() => createTable({ smallBlind: 10.5, bigBlind: 20 })).toThrow(/smallBlind/);
  });
});

describe("rotateDealer", () => {
  it("first rotation picks the lowest occupied seat", () => {
    const t = tableWithPlayers([{ seatIndex: 5, coins: 100 }, { seatIndex: 2, coins: 100 }]);
    const rotated = rotateDealer(t);
    expect(rotated.dealerSeatIndex).toBe(2);
    expect(rotated.seats[2]!.isDealer).toBe(true);
  });

  it("subsequent rotations skip empty seats and wrap", () => {
    let t = tableWithPlayers([
      { seatIndex: 0, coins: 100 },
      { seatIndex: 3, coins: 100 },
      { seatIndex: 7, coins: 100 },
    ]);
    t = rotateDealer(t); // -> 0
    t = rotateDealer(t); // -> 3
    expect(t.dealerSeatIndex).toBe(3);
    t = rotateDealer(t); // -> 7
    t = rotateDealer(t); // wraps -> 0
    expect(t.dealerSeatIndex).toBe(0);
  });
});

describe("startHand - heads-up", () => {
  it("button is the small blind and acts first pre-flop", () => {
    let t = tableWithPlayers([{ seatIndex: 2, coins: 1000 }, { seatIndex: 6, coins: 1000 }]);
    t = startHand(t);
    expect(t.phase).toBe(GamePhase.PRE_FLOP);
    expect(t.dealerSeatIndex).toBe(2);
    expect(t.seats[2]!.isSmallBlind).toBe(true);
    expect(t.seats[2]!.isBigBlind).toBe(false);
    expect(t.seats[6]!.isBigBlind).toBe(true);
    expect(t.seats[2]!.currentBetThisRound).toBe(50);
    expect(t.seats[6]!.currentBetThisRound).toBe(100);
    expect(t.currentBet).toBe(100);
    expect(t.actingSeatIndex).toBe(2); // button/SB first heads-up
  });

  it("deals exactly 2 hole cards to each player and shrinks the deck", () => {
    let t = tableWithPlayers([{ seatIndex: 1, coins: 1000 }, { seatIndex: 4, coins: 1000 }]);
    t = startHand(t);
    expect(t.seats[1]!.holeCards).toHaveLength(2);
    expect(t.seats[4]!.holeCards).toHaveLength(2);
    expect(t.deck).toHaveLength(52 - 4);
  });

  it("post-flop the non-button acts first heads-up", () => {
    let t = tableWithPlayers([{ seatIndex: 2, coins: 1000 }, { seatIndex: 6, coins: 1000 }]);
    t = startHand(t);
    t = endBettingRound(t);
    t = advancePhase(t);
    expect(t.phase).toBe(GamePhase.FLOP);
    expect(t.communityCards).toHaveLength(3);
    expect(t.actingSeatIndex).toBe(6); // BB/non-button
  });
});

describe("startHand - 3+ players", () => {
  it("blinds are SB then BB clockwise of the button; UTG acts first", () => {
    let t = tableWithPlayers([
      { seatIndex: 0, coins: 1000 },
      { seatIndex: 3, coins: 1000 },
      { seatIndex: 7, coins: 1000 },
    ]);
    t = startHand(t); // dealer -> seat 0
    expect(t.dealerSeatIndex).toBe(0);
    expect(t.seats[3]!.isSmallBlind).toBe(true);
    expect(t.seats[7]!.isBigBlind).toBe(true);
    expect(t.actingSeatIndex).toBe(0); // first eligible after BB wraps to button's seat 0? No:
    // UTG is the seat AFTER the BB (7) -> wraps to 0.
  });

  it("short big blind posts everything but currentBet stays the full BB", () => {
    let t = tableWithPlayers([
      { seatIndex: 0, coins: 1000 },
      { seatIndex: 1, coins: 1000 },
      { seatIndex: 2, coins: 30 }, // will be BB, short
    ]);
    t = startHand(t); // dealer -> 0, SB -> 1, BB -> 2
    expect(t.seats[2]!.currentBetThisRound).toBe(30);
    expect(t.seats[2]!.status).toBe("ALL_IN");
    expect(t.currentBet).toBe(100);
    expect(t.actingSeatIndex).toBe(0);
  });

  it("promotes SITTING_OUT players and never deals BUSTED or chipless seats", () => {
    let t = tableWithPlayers([
      { seatIndex: 0, coins: 1000 },
      { seatIndex: 1, coins: 1000, status: "SITTING_OUT" },
      { seatIndex: 2, coins: 0 },
      { seatIndex: 3, coins: 500, status: "BUSTED" },
    ]);
    t = startHand(t);
    expect(t.seats[0]!.status).toBe("ACTIVE");
    expect(t.seats[1]!.status).toBe("ACTIVE");
    expect(t.seats[1]!.holeCards).toHaveLength(2);
    expect(t.seats[2]!.status).toBe("SITTING_OUT");
    expect(t.seats[2]!.holeCards).toBeNull();
    expect(t.seats[3]!.status).toBe("BUSTED");
    expect(eligibleForHand(t)).toHaveLength(2);
  });

  it("refuses to start with fewer than 2 eligible players", () => {
    const t = tableWithPlayers([{ seatIndex: 0, coins: 1000 }, { seatIndex: 1, coins: 0 }]);
    expect(() => startHand(t)).toThrow(/fewer than 2/);
  });
});

describe("advancePhase & endBettingRound", () => {
  it("deals flop(3), turn(1), river(1) in order", () => {
    let t = tableWithPlayers([
      { seatIndex: 0, coins: 5000 },
      { seatIndex: 1, coins: 5000 },
      { seatIndex: 2, coins: 5000 },
    ]);
    t = startHand(t);
    t = endBettingRound(t);
    t = advancePhase(t);
    expect(t.phase).toBe(GamePhase.FLOP);
    expect(t.communityCards).toHaveLength(3);

    t = endBettingRound(t);
    t = advancePhase(t);
    expect(t.phase).toBe(GamePhase.TURN);
    expect(t.communityCards).toHaveLength(4);

    t = endBettingRound(t);
    t = advancePhase(t);
    expect(t.phase).toBe(GamePhase.RIVER);
    expect(t.communityCards).toHaveLength(5);
  });

  it("post-flop first actor is the first ACTIVE seat clockwise of the button", () => {
    let t = tableWithPlayers([
      { seatIndex: 1, coins: 5000, status: "SITTING_OUT" },
      { seatIndex: 2, coins: 5000, status: "SITTING_OUT" },
      { seatIndex: 5, coins: 5000, status: "SITTING_OUT" },
    ]);
    t = startHand(t); // dealer 1, SB 2, BB 5
    t = endBettingRound(t);
    t = advancePhase(t);
    expect(t.actingSeatIndex).toBe(2); // first ACTIVE clockwise after the button
  });

  it("endBettingRound sweeps bets into the pot and refunds uncalled excess", () => {
    const t = createTable({ smallBlind: 50, bigBlind: 100 });
    const seats = [
      mkSeat(0, { coins: 4500, bet: 500, invested: 500 }), // opened 500
      mkSeat(1, { coins: 4800, bet: 200, invested: 200 }), // called 200 only
      mkSeat(2, { coins: 4900, bet: 100, invested: 100 }),
    ];
    t.seats = seats;
    t.currentBet = 500;

    const closed = endBettingRound(t);
    expect(closed.seats[0]!.coins).toBe(4800); // 300 uncalled refunded
    expect(closed.pot).toBe(500); // 200 + 200 + 100 swept
    expect(closed.seats.every((s) => s.currentBetThisRound === 0)).toBe(true);
    expect(closed.currentBet).toBe(0);
    expect(closed.minRaiseIncrement).toBe(closed.bigBlind);
    expect(closed.actingSeatIndex).toBeNull();
  });

  it("countInHand counts only non-folded dealt-in players", () => {
    let t = tableWithPlayers([
      { seatIndex: 0, coins: 1000 },
      { seatIndex: 1, coins: 1000 },
      { seatIndex: 2, coins: 1000 },
    ]);
    t = startHand(t);
    expect(countInHand(t)).toBe(3);
    t.seats[2]!.status = "FOLDED";
    expect(countInHand(t)).toBe(2);
  });
});
