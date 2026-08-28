"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { PlayerAction, PublicGameState, Seat } from "@poker/shared-types";
import { useGame } from "../../lib/store";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { ChipStack } from "./ChipStack";
import { TimerRing, useCountdown } from "./TimerRing";

interface Legal {
  actions: PlayerAction[];
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
}

/** Mirrors the engine's legality math for UX only — the server re-validates. */
export function computeLegal(state: PublicGameState, seat: Seat): Legal {
  const callAmount = Math.max(0, state.currentBet - seat.currentBetThisRound);
  const maxRaiseTo = seat.currentBetThisRound + seat.coins;
  const actions: PlayerAction[] = ["FOLD"];
  if (callAmount === 0) {
    actions.push("CHECK");
    if (seat.coins > 0) actions.push("BET");
  } else {
    actions.push("CALL");
    if (seat.coins > callAmount) actions.push("RAISE");
  }
  if (seat.coins > 0) actions.push("ALL_IN");
  const fullMin =
    state.currentBet === 0 ? state.minRaiseIncrement : state.currentBet + state.minRaiseIncrement;
  return { actions, callAmount, minRaiseTo: Math.min(fullMin, maxRaiseTo), maxRaiseTo };
}

export function ActionBar({
  state,
  mySeat,
  turnDeadline,
}: {
  state: PublicGameState;
  mySeat: number;
  turnDeadline: number | null;
}) {
  const { act, setPreaction, pushToast, me } = useGame();
  const seat = state.seats[mySeat]!;
  const isMyTurn = state.actingSeatIndex === mySeat && seat.status === "ACTIVE";
  const legal = useMemo(() => computeLegal(state, seat), [state, seat]);
  const inHand = seat.status === "ACTIVE";
  const turnTimeMs = (me?.config?.turnTimeSeconds ?? 60) * 1000;
  const remaining = useCountdown(isMyTurn ? turnDeadline : null, isMyTurn);

  const [raiseInput, setRaiseInput] = useState<string>(String(legal.minRaiseTo));

  useEffect(() => {
    setRaiseInput(String(Math.min(legal.minRaiseTo, legal.maxRaiseTo)));
  }, [legal.minRaiseTo, legal.maxRaiseTo, isMyTurn]);

  const parsedRaise = Number(raiseInput) || legal.minRaiseTo;
  const clampedRaise = Math.min(Math.max(parsedRaise, legal.minRaiseTo), legal.maxRaiseTo);

  const doAct = (a: PlayerAction, amount?: number) => {
    if (a === "BET" || a === "RAISE") {
      const target = amount ?? clampedRaise;
      if (target < legal.minRaiseTo || target > legal.maxRaiseTo) {
        pushToast(`amount must be ${legal.minRaiseTo}-${legal.maxRaiseTo}`);
        return;
      }
      act(a, target);
      return;
    }
    act(a, amount);
  };

  // Keyboard shortcuts: F/C/R/A + arrows nudge raise by one big blind.
  const isDesktopViewport = useMediaQuery("(min-width: 768px) and (min-height: 520px)");
  useEffect(() => {
    if (!isMyTurn || !isDesktopViewport) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (k === "f") doAct("FOLD");
      else if (k === "c" && legal.actions.includes("CHECK")) doAct("CHECK");
      else if (k === "c" && legal.actions.includes("CALL")) doAct("CALL");
      else if (k === "r" && (legal.actions.includes("RAISE") || legal.actions.includes("BET"))) {
        doAct(state.currentBet === 0 ? "BET" : "RAISE", clampedRaise);
      } else if (k === "a" && legal.actions.includes("ALL_IN")) doAct("ALL_IN");
      else if (e.key === "ArrowUp") {
        setRaiseInput((v) => String(Math.min(legal.maxRaiseTo, (Number(v) || legal.minRaiseTo) + state.bigBlind)));
      } else if (e.key === "ArrowDown") {
        setRaiseInput((v) => String(Math.max(legal.minRaiseTo, (Number(v) || legal.minRaiseTo) - state.bigBlind)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMyTurn, isDesktopViewport, legal, clampedRaise, state.currentBet, state.bigBlind]);

  const presets = useMemo(() => {
    const potTotal =
      state.pots.reduce((s, p) => s + p.amount, 0) ||
      state.seats.reduce((s, x) => s + x.totalInvestedThisHand, 0);

    const isBet = state.currentBet === 0;
    const mk = (label: string, v: number) => ({
      label,
      value: Math.min(Math.max(legal.minRaiseTo, Math.round(v)), legal.maxRaiseTo),
    });

    if (isBet) {
      return [
        mk("25%", potTotal * 0.25),
        mk("50%", potTotal * 0.5),
        mk("75%", potTotal * 0.75),
        mk("POT", potTotal),
        mk("ALL-IN", legal.maxRaiseTo),
      ];
    }

    // Facing a bet: standard pot-raise formula
    const callAmt = legal.callAmount;
    const potAfterCall = potTotal + callAmt;
    return [
      mk("50%", state.currentBet + potAfterCall * 0.5),
      mk("75%", state.currentBet + potAfterCall * 0.75),
      mk("POT", state.currentBet + potAfterCall),
      mk("ALL-IN", legal.maxRaiseTo),
    ];
  }, [state, legal]);

  const btnBase =
    "flex-1 min-w-[92px] rounded-xl px-3 py-3 text-sm font-black uppercase tracking-wide transition-all duration-100 active:scale-95 disabled:opacity-35 disabled:active:scale-100 disabled:cursor-not-allowed";

  // ---------- Not in hand ----------
  if (!inHand) {
    if (seat.status === "BUSTED") return <BustedPanel seat={seat} />;
    return (
      <div className="rounded-2xl bg-panel px-5 py-4 text-center text-sm text-white/50 ring-1 line shadow-panel">
        {seat.status === "SITTING_OUT"
          ? "You'll be dealt in on the next hand"
          : seat.status === "FOLDED"
          ? "Hand folded — next one starts soon"
          : "Waiting…"}
      </div>
    );
  }

  // ---------- Not my turn ----------
  if (!isMyTurn) {
    return (
      <div className="rounded-2xl bg-panel p-4 ring-1 line flex items-center justify-between gap-3 shadow-panel">
        <span className="text-sm text-white/60">
          {seat.preAction ? (
            <>Queued: <b className="text-sky-300">will {seat.preAction === "CHECK" ? "check/fold" : "fold"}</b></>
          ) : (
            "Waiting for other players…"
          )}
        </span>
        <div className="flex gap-2">
          <button
            className={`rounded-xl px-4 py-2.5 text-sm font-bold ring-1 transition-colors ${
              seat.preAction === "CHECK"
                ? "bg-sky-500/25 text-sky-200 ring-sky-400/50"
                : "bg-sky-500/10 text-sky-200/80 ring-sky-400/20 hover:bg-sky-500/20"
            }`}
            onClick={() => setPreaction(seat.preAction === "CHECK" ? null : "CHECK")}
          >
            Check/Fold ahead
          </button>
          <button
            className={`rounded-xl px-4 py-2.5 text-sm font-bold ring-1 transition-colors ${
              seat.preAction === "FOLD"
                ? "bg-crimson/25 text-red-200 ring-crimson/50"
                : "bg-crimson/10 text-red-200/80 ring-crimson/20 hover:bg-crimson/20"
            }`}
            onClick={() => setPreaction(seat.preAction === "FOLD" ? null : "FOLD")}
          >
            Auto Fold
          </button>
          {seat.preAction && (
            <button
              className="rounded-xl bg-white/5 px-3 py-2.5 text-sm font-bold text-white/60 ring-1 ring-white/10 hover:bg-white/10"
              onClick={() => setPreaction(null)}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- My turn ----------
  const canRaise = legal.actions.includes("BET") || legal.actions.includes("RAISE");
  const isBetting = state.currentBet === 0;

  const stepperBtn =
    "grid h-9 w-9 place-items-center rounded-lg bg-white/8 text-lg font-bold text-gold hover:bg-gold/20 active:scale-90 transition-transform select-none";

  return (
    <div className="rounded-2xl bg-panel ring-1 line p-4 shadow-panel">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        {/* TIME LEFT ring */}
        <div className="mx-auto flex w-[110px] shrink-0 flex-col items-center justify-center gap-1.5 sm:mx-0">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">
            Time Left
          </span>
          <TimerRing remainingMs={remaining} totalMs={turnTimeMs}>
            <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-panel2">
              <span
                className={`text-xl font-black tabnum ${
                  remaining > 0 && remaining < 5000
                    ? "text-crimson animate-pulse"
                    : remaining > 0 && remaining < 10000
                    ? "text-amber-400"
                    : "text-gold"
                }`}
              >
                {remaining > 0 && remaining < 5000 ? (
                  <span className="text-base font-black">!</span>
                ) : remaining > 0 && remaining < 10000 ? (
                  <span className="text-base font-black">⚠</span>
                ) : null}
                {Math.ceil(remaining / 1000)}s
              </span>
            </div>
          </TimerRing>
        </div>

        {/* Buttons + raise controls */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Readouts */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-xs">
            <span className="font-semibold text-white/70">
              <span className="mr-1 text-gold">♥</span> Call Amount:{" "}
              <b className="text-gold tabnum">{Math.min(legal.callAmount, seat.coins).toLocaleString()}</b>
            </span>
            {canRaise && (
              <span className="text-white/65">
                Min {isBetting ? "Bet" : "Raise"}: <b className="text-white/80 tabnum">{legal.minRaiseTo.toLocaleString()}</b>
                <span className="mx-2">|</span>
                Max: <b className="text-white/80 tabnum">{legal.maxRaiseTo.toLocaleString()}</b>
              </span>
            )}
          </div>

          {/* Primary action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              className={`${btnBase} bg-crimson text-white shadow-[0_4px_0_#7f1d1d] hover:brightness-110`}
              onClick={() => doAct("FOLD")}
            >
              <span className="mr-1">✕</span> Fold
            </button>

            {legal.actions.includes("CHECK") && (
              <button
                className={`${btnBase} bg-emerald-600 text-white shadow-[0_4px_0_#14532d] hover:brightness-110`}
                onClick={() => doAct("CHECK")}
              >
                <span className="mr-1">✓</span> Check
              </button>
            )}

            {legal.actions.includes("CALL") && (
              <button
                className={`${btnBase} bg-blue-600 text-white shadow-[0_4px_0_#1e3a8a] hover:brightness-110`}
                onClick={() => doAct("CALL")}
              >
                Call
                <div className="text-[11px] font-bold normal-case tabnum opacity-90">
                  {Math.min(legal.callAmount, seat.coins).toLocaleString()}
                </div>
              </button>
            )}

            {canRaise && (
              <div className="flex min-w-[150px] flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-panel2 px-3 py-1.5 ring-1 line">
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gold">
                  {isBetting ? "Bet Amount" : "Raise To"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className={stepperBtn}
                    onClick={() =>
                      setRaiseInput(String(Math.max(legal.minRaiseTo, clampedRaise - state.bigBlind)))
                    }
                  >
                    −
                  </button>
                  <input
                    type="number"
                    className="w-20 bg-transparent text-right text-lg font-black text-white tabnum focus:outline-none"
                    value={raiseInput}
                    onBlur={() => setRaiseInput(String(clampedRaise))}
                    onChange={(e) => setRaiseInput(e.target.value)}
                  />
                  <button
                    className={stepperBtn}
                    onClick={() =>
                      setRaiseInput(String(Math.min(legal.maxRaiseTo, clampedRaise + state.bigBlind)))
                    }
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            <button
              className={`${btnBase} bg-amber-500 text-ink shadow-[0_4px_0_#92400e] hover:brightness-110`}
              onClick={() => doAct("ALL_IN")}
            >
              All-In
              <div className="text-[11px] font-bold normal-case tabnum opacity-80">
                {seat.coins.toLocaleString()}
              </div>
            </button>
          </div>

          {/* Slider & Presets */}
          {canRaise && (
            <>
              <input
                type="range"
                min={legal.minRaiseTo}
                max={legal.maxRaiseTo}
                step={Math.max(1, Math.floor(state.bigBlind / 2))}
                value={clampedRaise}
                onChange={(e) => setRaiseInput(e.target.value)}
                className="w-full accent-violet-500"
              />

              {/* Presets */}
              <div className="flex flex-wrap justify-end gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setRaiseInput(String(p.value))}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ring-1 transition-colors ${
                      clampedRaise === p.value
                        ? "bg-violet-600/35 text-violet-200 ring-violet-400/50"
                        : "bg-white/5 text-white/60 ring-white/10 hover:bg-white/10"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Confirm Bet / Raise Button */}
              <button
                className="w-full rounded-xl bg-violet-600 py-2.5 text-sm font-black uppercase tracking-wide text-white shadow-[0_4px_0_#4c1d95] transition-all active:scale-[0.99] hover:brightness-110 disabled:opacity-40"
                disabled={
                  clampedRaise < legal.minRaiseTo ||
                  clampedRaise > legal.maxRaiseTo ||
                  (clampedRaise <= state.currentBet && clampedRaise !== legal.maxRaiseTo)
                }
                onClick={() =>
                  doAct(
                    isBetting ? "BET" : "RAISE",
                    clampedRaise
                  )
                }
              >
                {isBetting ? "Bet" : "Raise to"}{" "}
                <span className="tabnum">{clampedRaise.toLocaleString()}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {turnDeadline && (
        <div className="mt-2 text-center text-[9px] uppercase tracking-[0.25em] text-white/25">
          server-enforced timer
        </div>
      )}
    </div>
  );
}

export function BustedPanel({ seat }: { seat: Seat }) {
  const { requestLoan, state, me } = useGame();
  const [amount, setAmount] = useState(state?.bigBlind ?? 20);
  const [creditor, setCreditor] = useState<number | null>(null);
  const creditors = (state?.seats ?? []).filter(
    (s) => s.username && s.seatIndex !== seat.seatIndex && s.coins > 0
  );
  const cap = me?.config?.startingCoins ?? 1000;
  const maxFor = (i: number) => Math.min(cap, state?.seats[i]?.coins ?? 0);

  return (
    <div className="rounded-2xl bg-panel p-5 ring-1 line space-y-3 shadow-panel">
      <div className="text-center">
        <div className="font-black uppercase tracking-wide text-crimson">You&apos;re busted</div>
        <div className="text-xs text-white/50">
          Borrow chips from another player, or leave &amp; rebuy from the header menu.
        </div>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {creditors.map((c) => (
          <button
            key={c.seatIndex}
            onClick={() => setCreditor(c.seatIndex)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${
              creditor === c.seatIndex
                ? "bg-accent/25 text-violet-200 ring-accent/50"
                : "bg-white/5 text-white/60 ring-white/10 hover:bg-white/10"
            }`}
          >
            {c.username} · {c.coins.toLocaleString()}
          </button>
        ))}
      </div>
      {creditor !== null && (
        <div className="flex items-center justify-center gap-2">
          <input
            type="number"
            className="w-28 rounded-lg bg-black/40 px-2 py-1.5 text-right text-sm font-bold text-gold tabnum ring-1 ring-white/10 focus:outline-none"
            value={amount}
            min={state?.bigBlind ?? 20}
            max={maxFor(creditor)}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <button
            className="rounded-xl bg-accent px-5 py-2 text-sm font-black uppercase tracking-wide text-white shadow-[0_4px_0_#4c1d95] active:scale-95 hover:brightness-110"
            onClick={() => creditor !== null && requestLoan(creditor, amount)}
          >
            Request loan
          </button>
        </div>
      )}
    </div>
  );
}

void ChipStack;
