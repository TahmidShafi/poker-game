"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { PlayerAction, PublicGameState, Seat } from "@poker/shared-types";
import { useGame } from "../lib/store";
import { computeLegal, BustedPanel } from "./ActionBar";
import { TimerRing, useCountdown } from "./TimerRing";

/**
 * Mobile action dock — two-state progressive disclosure.
 *
 * Collapsed (default): "YOUR TURN + seconds" line and one row of
 * [FOLD] [CHECK/CALL] [RAISE]. ≈96px tall.
 * Raise: tapping RAISE swaps the bar content for an on-demand raise sheet
 * (stepper / slider / presets incl. ALL-IN / confirm). It overlays the felt
 * bottom edge only while open, then collapses back.
 */

export function MobileActionBar({
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
  const inHand = seat.status === "ACTIVE";
  const legal = useMemo(() => computeLegal(state, seat), [state, seat]);
  const totalMs = (me?.config?.turnTimeSeconds ?? 60) * 1000;
  const remaining = useCountdown(isMyTurn ? turnDeadline : null, isMyTurn);

  const canRaise = legal.actions.includes("BET") || legal.actions.includes("RAISE");
  const callAmount = Math.min(legal.callAmount, seat.coins);

  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo);

  useEffect(() => {
    setRaiseTo(Math.min(legal.minRaiseTo, legal.maxRaiseTo));
  }, [legal.minRaiseTo, legal.maxRaiseTo, isMyTurn]);

  useEffect(() => {
    if (!isMyTurn) setRaiseOpen(false);
  }, [isMyTurn]);

  const clamped = Math.min(Math.max(raiseTo, legal.minRaiseTo), legal.maxRaiseTo);
  const validRaise =
    clamped >= legal.minRaiseTo &&
    clamped <= legal.maxRaiseTo &&
    (clamped > state.currentBet || clamped === legal.maxRaiseTo);

  const presets = useMemo(() => {
    const pot = state.seats.reduce((s, x) => s + x.totalInvestedThisHand, 0);
    const mk = (label: string, v: number) => ({
      label,
      value: Math.min(Math.max(legal.minRaiseTo, Math.floor(v)), legal.maxRaiseTo),
    });
    return [
      mk("25%", legal.minRaiseTo + (pot - state.currentBet) * 0.25),
      mk("50%", legal.minRaiseTo + (pot - state.currentBet) * 0.5),
      mk("75%", legal.minRaiseTo + (pot - state.currentBet) * 0.75),
      mk("POT", state.currentBet + pot),
      mk("ALL-IN", legal.maxRaiseTo),
    ];
  }, [state, legal]);

  const doAct = (a: PlayerAction, amount?: number) => {
    if (a === "BET" || a === "RAISE") {
      if (amount === undefined || amount < legal.minRaiseTo || amount > legal.maxRaiseTo) {
        pushToast(`raise must be ${legal.minRaiseTo}-${legal.maxRaiseTo}`);
        return;
      }
    }
    setRaiseOpen(false);
    act(a, amount);
  };

  // ---------- Busted ----------
  if (seat.status === "BUSTED") return <BustedPanel seat={seat} />;

  // ---------- Not in hand ----------
  if (!inHand) {
    return (
      <div className="rounded-2xl bg-panel px-4 py-2.5 text-center text-xs text-white/50 ring-1 line">
        {seat.status === "SITTING_OUT"
          ? "You'll be dealt in next hand"
          : seat.status === "FOLDED"
          ? "Folded — next hand soon"
          : "Waiting…"}
      </div>
    );
  }

  // ---------- In hand, not my turn ----------
  if (!isMyTurn) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-panel px-3 py-2 ring-1 line">
        <span className="min-w-0 truncate text-xs text-white/55">
          {seat.preAction ? (
            <>
              Queued: <b className="text-sky-300">will {seat.preAction.toLowerCase()}</b>
            </>
          ) : (
            "Waiting for other players…"
          )}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <button
            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ring-1 transition-colors ${
              seat.preAction
                ? "bg-sky-500/25 text-sky-200 ring-sky-400/40"
                : "bg-sky-500/10 text-white/60 ring-white/10"
            }`}
            onClick={() => setPreaction(seat.preAction ? null : "CHECK")}
          >
            Check/Fold ahead
          </button>
          {seat.preAction && (
            <button
              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-white/60 ring-1 ring-white/10"
              onClick={() => setPreaction(null)}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- MY TURN ----------
  const primaryBtn =
    "flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2.5 text-sm font-black uppercase tracking-wide transition-all duration-100 active:scale-95";

  const secs = Math.ceil(remaining / 1000);

  return (
    <div className="relative">
      {raiseOpen && canRaise ? (
        /* ================= RAISE SHEET ================= */
        <div className="rounded-2xl bg-panel p-3 shadow-panel ring-1 line animate-riseFade">
          <div className="flex items-center justify-between pb-1">
            <span className="text-[11px] font-black uppercase tracking-[0.22em] text-gold">
              {state.currentBet === 0 ? "Bet" : "Raise"} To
            </span>
            <div className="flex items-center gap-2 text-[10px] text-white/40 tabnum">
              <span>min {legal.minRaiseTo.toLocaleString()}</span>
              <span>·</span>
              <span>max {legal.maxRaiseTo.toLocaleString()}</span>
            </div>
          </div>

          {/* Stepper */}
          <div className="flex items-center justify-center gap-3">
            <button
              className="grid h-11 w-14 place-items-center rounded-xl bg-white/8 text-2xl font-bold text-gold active:scale-90"
              onClick={() => setRaiseTo((v) => Math.max(legal.minRaiseTo, v - state.bigBlind))}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              className="w-28 bg-transparent text-center text-base font-black text-white tabnum focus:outline-none"
              value={clamped}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setRaiseTo(v);
              }}
            />
            <button
              className="grid h-11 w-14 place-items-center rounded-xl bg-white/8 text-2xl font-bold text-gold active:scale-90"
              onClick={() => setRaiseTo((v) => Math.min(legal.maxRaiseTo, v + state.bigBlind))}
            >
              +
            </button>
          </div>

          {/* Slider */}
          <input
            type="range"
            className="touch-slider"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={Math.max(1, Math.floor(state.bigBlind / 2))}
            value={clamped}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
          />

          {/* Presets */}
          <div className="grid grid-cols-5 gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => setRaiseTo(p.value)}
                className={`rounded-lg px-1 py-1.5 text-[10px] font-black uppercase ring-1 transition-colors ${
                  clamped === p.value
                    ? "bg-violet-600/35 text-violet-100 ring-violet-400/50"
                    : "bg-white/5 text-white/60 ring-white/10 active:bg-white/15"
                } ${p.label === "ALL-IN" ? "text-amber-300" : ""}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Confirm / cancel */}
          <div className="mt-2 flex gap-2">
            <button
              className="w-full rounded-xl bg-violet-600 py-3 text-sm font-black uppercase tracking-wide text-white shadow-[0_4px_0_#4c1d95] transition-all active:scale-[0.98] disabled:opacity-40"
              disabled={!validRaise}
              onClick={() => doAct(state.currentBet === 0 ? "BET" : "RAISE", clamped)}
            >
              Confirm · {clamped.toLocaleString()}
            </button>
            <button
              className="shrink-0 rounded-xl bg-white/6 px-4 text-sm font-bold text-white/60 ring-1 ring-white/10 active:scale-95"
              onClick={() => setRaiseOpen(false)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : (
        /* ================= COLLAPSED DEFAULT BAR ================= */
        <div className="rounded-2xl bg-panel p-2.5 shadow-panel ring-1 line">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-gold">
              Your Turn
            </span>
            <div className="flex items-center gap-1.5">
              <TimerRing remainingMs={remaining} totalMs={totalMs}>
                <div className="grid h-7 w-7 place-items-center rounded-full bg-panel2">
                  <span
                    className={`text-[11px] font-black tabnum ${
                      remaining > 0 && remaining < 5000
                        ? "text-crimson"
                        : remaining > 0 && remaining < 10000
                        ? "text-amber-400"
                        : "text-gold"
                    }`}
                  >
                    {secs}s
                  </span>
                </div>
              </TimerRing>
            </div>
          </div>

          <div className={`grid gap-2 ${canRaise ? "grid-cols-3" : "grid-cols-2"}`}>
            <button
              className={`${primaryBtn} bg-crimson text-white shadow-[0_4px_0_#7f1d1d]`}
              onClick={() => doAct("FOLD")}
            >
              Fold
            </button>

            {legal.actions.includes("CHECK") ? (
              <button
                className={`${primaryBtn} bg-emerald-600 text-white shadow-[0_4px_0_#14532d]`}
                onClick={() => doAct("CHECK")}
              >
                Check
              </button>
            ) : (
              <button
                className={`${primaryBtn} bg-blue-600 text-white shadow-[0_4px_0_#1e3a8a]`}
                onClick={() => doAct("CALL")}
              >
                Call
                <span className="text-[11px] font-bold normal-case tabnum opacity-90">
                  {callAmount.toLocaleString()}
                </span>
              </button>
            )}

            {canRaise ? (
              <button
                className={`${primaryBtn} bg-violet-600 text-white shadow-[0_4px_0_#4c1d95]`}
                onClick={() => setRaiseOpen(true)}
              >
                {state.currentBet === 0 ? "Bet" : "Raise"}
              </button>
            ) : (
              legal.actions.includes("ALL_IN") && (
                <button
                  className={`${primaryBtn} bg-amber-500 text-ink shadow-[0_4px_0_#92400e]`}
                  onClick={() => doAct("ALL_IN")}
                >
                  All-In
                  <span className="text-[11px] font-bold normal-case tabnum opacity-80">
                    {seat.coins.toLocaleString()}
                  </span>
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
