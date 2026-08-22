import { describe, expect, it } from "vitest";
import {
  applyAction,
  computeUncalledRefund,
  getLegalActions,
  isBettingRoundComplete,
} from "./betting";
import { mkRound, mkSeat } from "./testing/helpers";

describe("getLegalActions", () => {
  it("no outstanding bet: FOLD/CHECK/BET/ALL_IN with min bet = big blind", () => {
    const state = mkRound([mkSeat(0, { coins: 1000 })], { minRaiseIncrement: 100 });
    const res = getLegalActions(state);
    expect(res.legalActions).toEqual(["FOLD", "CHECK", "BET", "ALL_IN"]);
    expect(res.callAmount).toBe(0);
    expect(res.minRaiseTo).toBe(100);
    expect(res.maxRaiseTo).toBe(1000);
  });

  it("outstanding bet: FOLD/CALL/RAISE/ALL_IN and correct call amount", () => {
    const state = mkRound(
      [mkSeat(0, { coins: 1000, bet: 200, invested: 200 }), mkSeat(1, { coins: 800 })],
      { currentBet: 200, minRaiseIncrement: 200, actingSeatIndex: 1 }
    );
    const res = getLegalActions(state);
    expect(res.legalActions).toEqual(["FOLD", "CALL", "RAISE", "ALL_IN"]);
    expect(res.callAmount).toBe(200);
    expect(res.minRaiseTo).toBe(400);
    expect(res.maxRaiseTo).toBe(800); // caller's own stack
  });

  it("RAISE is illegal when chips only cover the call", () => {
    const seat = mkSeat(0, { coins: 150, bet: 50 });
    const state = mkRound([seat], { currentBet: 200, minRaiseIncrement: 200 });
    const res = getLegalActions(state);
    expect(res.legalActions).not.toContain("RAISE");
    expect(res.legalActions).toContain("CALL");
    expect(res.legalActions).toContain("ALL_IN");
  });

  it("short stack gets minRaiseTo clamped to its all-in amount", () => {
    const state = mkRound(
      [mkSeat(0, { coins: 120 })],
      { currentBet: 200, minRaiseIncrement: 200 }
    );
    const res = getLegalActions(state);
    expect(res.minRaiseTo).toBe(120); // clamped to maxRaiseTo (all-in)
    expect(res.maxRaiseTo).toBe(120);
    expect(res.callAmount).toBe(200);
  });

  it("throws when the acting seat cannot act", () => {
    const state = mkRound([mkSeat(0, { status: "FOLDED" })]);
    expect(() => getLegalActions(state)).toThrow(/cannot act/);
  });
});

describe("applyAction validation", () => {
  it("rejects out-of-turn actions", () => {
    const state = mkRound([mkSeat(0), mkSeat(1)], { actingSeatIndex: 1 });
    expect(() => applyAction(state, 0, "CHECK")).toThrow(/out-of-turn/i);
  });

  it("rejects CHECK when there is a bet to call", () => {
    const state = mkRound(
      [mkSeat(0, { coins: 500 }), mkSeat(1, { bet: 100, invested: 100, status: "ACTIVE" })],
      { currentBet: 100 }
    );
    expect(() => applyAction(state, 0, "CHECK")).toThrow(/illegal action CHECK/i);
  });

  it("rejects BET below minimum or above stack", () => {
    const base = [mkSeat(0, { coins: 1000 })];
    const s1 = mkRound(base, { minRaiseIncrement: 100 });
    expect(() => applyAction(s1, 0, "BET", 99)).toThrow(/minimum open bet is 100/);
    const s2 = mkRound(base.map((s) => ({ ...s })), { minRaiseIncrement: 100 });
    expect(() => applyAction(s2, 0, "BET", 1001)).toThrow(/at most 1000/);
  });

  it("rejects RAISE below the unclamped minimum unless it is an exact all-in", () => {
    const tiny = [
      mkSeat(0, { coins: 250 }),
      mkSeat(1, { bet: 200, invested: 200, coins: 3000 }),
    ];
    const s = mkRound(tiny, { currentBet: 200, minRaiseIncrement: 200 });
    // 300 exceeds the clamped display minimum (250) but is below the true
    // full-raise target (400) and is not an exact all-in -> rejected.
    expect(() => applyAction(s, 0, "RAISE", 300)).toThrow(/minimum raise-to is 400/);
  });

  it("rejects a raise above the stack even when above the minimum", () => {
    const seats = [mkSeat(0, { coins: 1000 }), mkSeat(1, { bet: 200, invested: 200, coins: 9000 })];
    const s = mkRound(seats, { currentBet: 200, minRaiseIncrement: 200 });
    expect(() => applyAction(s, 0, "RAISE", 1001)).toThrow(/at most 1000/);
  });

  it("allows an exact all-in raise below minimum (short raise)", () => {
    const seats = [
      mkSeat(0, { coins: 350 }),
      mkSeat(1, { bet: 200, invested: 200, coins: 3000 }),
    ];
    const s = mkRound(seats, { currentBet: 200, minRaiseIncrement: 200 });
    const res = applyAction(s, 0, "RAISE", 350);
    const raiser = res.newState.seats[0]!;
    expect(raiser.status).toBe("ALL_IN");
    expect(raiser.coins).toBe(0);
    expect(res.newState.currentBet).toBe(350);
    expect(res.newState.minRaiseIncrement).toBe(200); // short raise: unchanged
  });

  it("rejects a raise that does not exceed the current bet", () => {
    const seats = [
      mkSeat(0, { coins: 1000 }),
      mkSeat(1, { bet: 400, invested: 400, coins: 5000, status: "ACTIVE" }),
    ];
    const s = mkRound(seats, { currentBet: 400, minRaiseIncrement: 200 });
    expect(() => applyAction(s, 0, "RAISE", 400)).toThrow(/must exceed/);
  });
});

describe("applyAction effects", () => {
  it("FOLD marks folded and completes round when one player remains", () => {
    const seats = [
      mkSeat(0, { coins: 500, status: "ACTIVE" }),
      mkSeat(1, { coins: 500, status: "ACTIVE" }),
      mkSeat(2, { coins: 500, status: "FOLDED" }),
    ];
    const s = mkRound(seats, { actingSeatIndex: 1, actedThisRound: [true, false, true] });
    const res = applyAction(s, 1, "FOLD");
    expect(res.newState.seats[1]!.status).toBe("FOLDED");
    expect(res.roundComplete).toBe(true);
    expect(res.nextActingSeatIndex).toBeNull();
  });

  it("CALL for less than the bet goes all-in", () => {
    const seats = [
      mkSeat(0, { coins: 60 }),
      mkSeat(1, { coins: 5000, bet: 500, invested: 500, status: "ACTIVE" }),
    ];
    const s = mkRound(seats, { currentBet: 500, minRaiseIncrement: 500 });
    const res = applyAction(s, 0, "CALL");
    const caller = res.newState.seats[0]!;
    expect(caller.coins).toBe(0);
    expect(caller.status).toBe("ALL_IN");
    expect(caller.currentBetThisRound).toBe(60);
    expect(caller.totalInvestedThisHand).toBe(60);
  });

  it("opening BET sets increment and reopens action (clears other actors)", () => {
    const seats = [
      mkSeat(0, { coins: 2000, status: "ACTIVE" }),
      mkSeat(1, { coins: 2000, status: "ACTIVE" }),
      mkSeat(2, { coins: 2000, status: "ACTIVE" }),
    ];
    const acted = Array.from({ length: 10 }, (_, i) => i === 1 || i === 2);
    const s = mkRound(seats, { actingSeatIndex: 0, actedThisRound: acted });
    const res = applyAction(s, 0, "BET", 300);
    expect(res.newState.currentBet).toBe(300);
    expect(res.newState.minRaiseIncrement).toBe(300);
    expect(res.newState.actedThisRound[0]).toBe(true);
    expect(res.newState.actedThisRound[1]).toBe(false);
    expect(res.newState.actedThisRound[2]).toBe(false);
    expect(res.nextActingSeatIndex).toBe(1);
  });

  it("min-raise chain: 100 BB -> open 200 -> min raise 400 -> min raise 600", () => {
    let seats = [
      mkSeat(0, { coins: 5000, status: "ACTIVE" }),
      mkSeat(1, { coins: 5000, status: "ACTIVE" }),
      mkSeat(2, { coins: 5000, status: "ACTIVE" }),
    ];
    // A opens 200
    let s = mkRound(seats, { actingSeatIndex: 0, minRaiseIncrement: 100 });
    let res = applyAction(s, 0, "BET", 200);
    expect(res.newState.minRaiseIncrement).toBe(200);

    // B min-raises to 400 (currentBet 200 + increment 200)
    seats = res.newState.seats;
    s = { ...res.newState, actingSeatIndex: res.nextActingSeatIndex! };
    expect(getLegalActions(s).minRaiseTo).toBe(400);
    res = applyAction(s, 1, "RAISE", 400);
    expect(res.newState.minRaiseIncrement).toBe(200);

    // C min-raises to 600 (currentBet 400 + increment 200)
    seats = res.newState.seats;
    s = { ...res.newState, actingSeatIndex: res.nextActingSeatIndex! };
    expect(getLegalActions(s).minRaiseTo).toBe(600);
  });

  it("short all-in raise does not update the increment and does not reopen action", () => {
    // All three have called 200 (all acted). B then short all-in raises to 350.
    const seats = [
      mkSeat(0, { coins: 3000, bet: 200, invested: 200 }),
      mkSeat(1, { coins: 150, bet: 200, invested: 200 }),
      mkSeat(2, { coins: 3000, bet: 200, invested: 200 }),
    ];
    const s = mkRound(seats, {
      currentBet: 200,
      minRaiseIncrement: 200,
      actingSeatIndex: 1,
      actedThisRound: [true, true, true],
    });
    const res = applyAction(s, 1, "ALL_IN"); // 150 more -> 350 total, short of 400

    expect(res.newState.currentBet).toBe(350);
    expect(res.newState.minRaiseIncrement).toBe(200); // unchanged by short raise
    expect(res.newState.actedThisRound[0]).toBe(true); // A NOT reopened
    expect(res.newState.actedThisRound[2]).toBe(true); // C NOT reopened
    expect(res.newState.mayRaise[0]).toBe(false); // A may not re-raise
    expect(res.newState.mayRaise[2]).toBe(false); // C may not re-raise
    expect(res.roundComplete).toBe(false);

    // C acts next: may call the 150 shortfall or fold - RAISE is illegal.
    expect(res.nextActingSeatIndex).toBe(2);
    const forC = { ...res.newState, actingSeatIndex: res.nextActingSeatIndex! };
    const cLegal = getLegalActions(forC);
    expect(cLegal.callAmount).toBe(150);
    expect(cLegal.legalActions).not.toContain("RAISE");
    expect(cLegal.legalActions).toContain("ALL_IN");

    // C's ALL_IN is capped at the call (no sneaky raise past the short stack).
    const cAllIn = applyAction(forC, 2, "ALL_IN");
    expect(cAllIn.newState.seats[2]!.currentBetThisRound).toBe(350);
    expect(cAllIn.newState.currentBet).toBe(350);

    // A then faces the same 150 shortfall with no raise option.
    const forA = { ...cAllIn.newState, actingSeatIndex: cAllIn.nextActingSeatIndex! };
    const aLegal = getLegalActions(forA);
    expect(forA.actingSeatIndex).toBe(0);
    expect(aLegal.callAmount).toBe(150);
    expect(aLegal.legalActions).not.toContain("RAISE");
  });

  it("ALL_IN as a full raise updates the increment and reopens action", () => {
    const seats = [
      mkSeat(0, { coins: 700 }),
      mkSeat(1, { bet: 200, invested: 200, coins: 5000 }),
    ];
    const s = mkRound(seats, {
      currentBet: 200,
      minRaiseIncrement: 200,
      actedThisRound: [false, true],
    });
    const res = applyAction(s, 0, "ALL_IN");
    expect(res.newState.currentBet).toBe(700);
    expect(res.newState.minRaiseIncrement).toBe(500);
    expect(res.newState.actedThisRound[1]).toBe(false);
  });

  it("ALL_IN that just calls does not touch the current bet", () => {
    const seats = [
      mkSeat(0, { coins: 120, status: "ACTIVE" }),
      mkSeat(1, { bet: 500, invested: 500, coins: 9000, status: "ACTIVE" }),
    ];
    const s = mkRound(seats, { currentBet: 500, minRaiseIncrement: 500 });
    const res = applyAction(s, 0, "ALL_IN");
    expect(res.newState.currentBet).toBe(500);
    expect(res.newState.seats[0]!.status).toBe("ALL_IN");
    expect(res.newState.seats[0]!.currentBetThisRound).toBe(120);
  });
});

describe("round completion & turn order", () => {
  it("big-blind option keeps the round incomplete until BB acts", () => {
    const seats = [
      mkSeat(0, { bet: 100, invested: 100, coins: 9900 }), // SB limped (acted)
      mkSeat(1, { bet: 100, invested: 100, coins: 9900 }), // BB (option, not acted)
    ];
    const s = mkRound(seats, {
      currentBet: 100,
      minRaiseIncrement: 100,
      actingSeatIndex: 1,
      actedThisRound: [true, false],
    });
    expect(isBettingRoundComplete(s)).toBe(false);
    const afterCheck = applyAction(s, 1, "CHECK");
    expect(afterCheck.roundComplete).toBe(true);
  });

  it("next actor skips folded and all-in seats and wraps the table", () => {
    const seats = [
      mkSeat(0, { status: "FOLDED" }),
      mkSeat(1, { status: "ALL_IN", bet: 100, invested: 100 }),
      mkSeat(2, { status: "SITTING_OUT" }),
      mkSeat(3, { status: "ACTIVE" }),
      mkSeat(4, { status: "EMPTY" }),
      mkSeat(5, { status: "ACTIVE" }),
    ];
    const s = mkRound(seats, { actingSeatIndex: 5, currentBet: 100, minRaiseIncrement: 100 });
    const res = applyAction(s, 5, "CALL"); // matches -> moves on
    expect(res.roundComplete).toBe(false);
    expect(res.nextActingSeatIndex).toBe(3);
  });

  it("is complete when every actor matched and acted", () => {
    const seats = [
      mkSeat(0, { bet: 100, invested: 100, coins: 9900, status: "ACTIVE" }),
      mkSeat(1, { bet: 100, invested: 100, coins: 9900, status: "ACTIVE" }),
      mkSeat(2, { status: "FOLDED", invested: 40 }),
    ];
    const s = mkRound(seats, {
      currentBet: 100,
      actedThisRound: [true, true, true],
    });
    expect(isBettingRoundComplete(s)).toBe(true);
  });
});

describe("computeUncalledRefund", () => {
  it("refunds the top bettor's excess above the second-highest bet", () => {
    const seats = [
      mkSeat(0, { bet: 500, invested: 500 }),
      mkSeat(1, { bet: 200, invested: 200 }),
      mkSeat(2, { bet: 0 }),
    ];
    expect(computeUncalledRefund(seats, 500)).toEqual({ seatIndex: 0, amount: 300 });
  });

  it("a folded player's earlier match blocks any refund", () => {
    const seats = [
      mkSeat(0, { bet: 500, invested: 500 }),
      mkSeat(1, { bet: 500, invested: 500, status: "FOLDED" }),
    ];
    expect(computeUncalledRefund(seats, 500)).toBeNull();
  });

  it("no refund when bets are fully matched", () => {
    const seats = [
      mkSeat(0, { bet: 300, invested: 300 }),
      mkSeat(1, { bet: 300, invested: 300 }),
    ];
    expect(computeUncalledRefund(seats, 300)).toBeNull();
  });
});
