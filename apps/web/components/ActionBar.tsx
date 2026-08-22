"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { PlayerAction, PublicGameState, Seat } from "@poker/shared-types";
import { useGame } from "../lib/store";
import { ChipStack } from "./ChipStack";

interface Legal {
  actions: PlayerAction[];
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
}

/** Mirrors the engine's legality math for UX only - the server re-validates. */
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
  const { act, setPreaction, pushToast } = useGame();
  const seat = state.seats[mySeat]!;
  const isMyTurn = state.actingSeatIndex === mySeat && seat.status === "ACTIVE";
  const legal = useMemo(() => computeLegal(state, seat), [state, seat]);

  const inHand = seat.status === "ACTIVE";
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo);

  useEffect(() => {
    setRaiseTo(Math.min(legal.minRaiseTo, legal.maxRaiseTo));
  }, [legal.minRaiseTo, legal.maxRaiseTo, isMyTurn]);

  const doAct = (a: PlayerAction, amount?: number) => {
    if (a === "BET" || a === "RAISE") {
      if (amount === undefined || amount < legal.minRaiseTo || amount > legal.maxRaiseTo) {
        pushToast(`raise must be ${legal.minRaiseTo}-${legal.maxRaiseTo}`);
        return;
      }
    }
    act(a, amount);
  };

  // Keyboard shortcuts (desktop): F/C/R/A + arrows nudge raise.
  useEffect(() => {
    if (!isMyTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (k === "f") doAct("FOLD");
      else if (k === "c" && legal.actions.includes("CHECK")) doAct("CHECK");
      else if (k === "c" && legal.actions.includes("CALL")) doAct("CALL");
      else if (k === "r" && legal.actions.includes("RAISE")) doAct("RAISE", raiseTo);
      else if (k === "a") doAct("ALL_IN");
      else if (e.key === "ArrowUp") setRaiseTo((v) => Math.min(legal.maxRaiseTo, v + state.bigBlind));
      else if (e.key === "ArrowDown") setRaiseTo((v) => Math.max(legal.minRaiseTo, v - state.bigBlind));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, legal, raiseTo, state.bigBlind]);

  const presets = useMemo(() => {
    const pot = state.seats.reduce((s, x) => s + x.totalInvestedThisHand, 0);
    const mk = (label: string, v: number) => ({
      label,
      value: Math.min(Math.max(legal.minRaiseTo, Math.floor(v)), legal.maxRaiseTo),
    });
    return [
      mk("min", legal.minRaiseTo),
      mk("⅓ pot", state.currentBet + pot / 3),
      mk("½ pot", state.currentBet + pot / 2),
      mk("pot", state.currentBet + pot),
      mk("max", legal.maxRaiseTo),
    ];
  }, [state, legal]);

  const btn =
    "rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-100 active:scale-95 disabled:opacity-35 disabled:active:scale-100 disabled:cursor-not-allowed";

  if (!inHand) {
    if (seat.status === "BUSTED") return <BustedPanel seat={seat} />;
    return (
      <div className="glass rounded-2xl px-5 py-3 text-center text-sm text-white/50">
        {seat.status === "SITTING_OUT"
          ? "You'll be dealt in on the next hand"
          : seat.status === "FOLDED"
          ? "Hand folded - next one starts soon"
          : "Waiting…"}
      </div>
    );
  }

  if (!isMyTurn) {
    return (
      <div className="glass rounded-2xl p-3 flex items-center justify-between gap-3">
        <span className="text-sm text-white/60">
          {seat.preAction ? (
            <>Queued: <b className="text-sky-300">will {seat.preAction.toLowerCase()}</b></>
          ) : (
            "Waiting for other players…"
          )}
        </span>
        <div className="flex gap-2">
          <button
            className={`${btn} bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/30`}
            onClick={() => setPreaction(seat.preAction === "CHECK" ? null : "CHECK")}
          >
            Check/Fold ahead
          </button>
          <button
            className={`${btn} bg-white/5 text-white/70 ring-1 ring-white/10`}
            onClick={() => setPreaction(null)}
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  const canRaise = legal.actions.includes("BET") || legal.actions.includes("RAISE");
  const raiseLabel = state.currentBet === 0 ? "BET" : "RAISE";

  return (
    <div className="glass rounded-2xl p-3 space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <button className={`${btn} bg-crimson/20 text-red-200 ring-1 ring-crimson/40`} onClick={() => doAct("FOLD")}>
          FOLD <span className="opacity-50 text-[10px]">(F)</span>
        </button>
        {legal.actions.includes("CHECK") && (
          <button className={`${btn} bg-emerald-600/25 text-emerald-200 ring-1 ring-emerald-400/40`} onClick={() => doAct("CHECK")}>
            CHECK <span className="opacity-50 text-[10px]">(C)</span>
          </button>
        )}
        {legal.actions.includes("CALL") && (
          <button className={`${btn} bg-emerald-600/25 text-emerald-200 ring-1 ring-emerald-400/40`} onClick={() => doAct("CALL")}>
            CALL <ChipStack amount={Math.min(legal.callAmount, seat.coins)} showLabel />
          </button>
        )}
        <button className={`${btn} bg-gold/20 text-gold ring-1 ring-gold/40`} onClick={() => doAct("ALL_IN")}>
          ALL-IN <span className="opacity-50 text-[10px]">(A)</span>
        </button>
      </div>

      {canRaise && (
        <div className="space-y-2 rounded-xl bg-black/25 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/50 uppercase tracking-wider font-semibold">
              {raiseLabel} to
            </span>
            <input
              type="number"
              className="w-24 rounded-lg bg-black/40 px-2 py-1 text-right text-gold font-bold tabnum ring-1 ring-white/10"
              value={raiseTo}
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setRaiseTo(v);
              }}
            />
          </div>
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={Math.max(1, Math.floor(state.bigBlind / 2))}
            value={Math.min(Math.max(raiseTo, legal.minRaiseTo), legal.maxRaiseTo)}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            className="w-full accent-[#D8B36A]"
          />
          <div className="flex gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                className="flex-1 rounded-lg bg-white/5 py-1 text-[11px] font-semibold text-white/70 hover:bg-gold/20 hover:text-gold transition-colors"
                onClick={() => setRaiseTo(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            className={`${btn} w-full bg-gold/25 text-gold ring-1 ring-gold/40`}
            onClick={() =>
              doAct(state.currentBet === 0 ? "BET" : "RAISE", Math.min(Math.max(raiseTo, legal.minRaiseTo), legal.maxRaiseTo))
            }
            disabled={
              raiseTo < legal.minRaiseTo ||
              raiseTo > legal.maxRaiseTo ||
              (raiseTo <= state.currentBet && raiseTo !== legal.maxRaiseTo)
            }
          >
            {raiseLabel} TO {Math.min(Math.max(raiseTo, legal.minRaiseTo), legal.maxRaiseTo).toLocaleString()}{" "}
            <span className="opacity-50 text-[10px]">(R)</span>
          </button>
        </div>
      )}

      {turnDeadline && (
        <div className="text-center text-[10px] uppercase tracking-widest text-white/30">
          server-enforced timer running
        </div>
      )}
    </div>
  );
}

function BustedPanel({ seat }: { seat: Seat }) {
  const { requestLoan, state, me } = useGame();
  const [amount, setAmount] = useState(state?.bigBlind ?? 20);
  const [creditor, setCreditor] = useState<number | null>(null);
  const creditors = state!.seats.filter(
    (s) => s.username && s.seatIndex !== seat.seatIndex && s.coins > 0
  );
  const cap = me?.config?.startingCoins ?? 1000;
  const maxFor = (i: number) => Math.min(cap, state!.seats[i]?.coins ?? 0);

  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="text-center">
        <div className="text-crimson font-bold">You're busted!</div>
        <div className="text-xs text-white/50">Request a loan or leave &amp; rebuy from the header.</div>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {creditors.map((c) => (
          <button
            key={c.seatIndex}
            onClick={() => setCreditor(c.seatIndex)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${
              creditor === c.seatIndex
                ? "bg-gold/25 text-gold ring-gold/50"
                : "bg-white/5 text-white/60 ring-white/10"
            }`}
          >
            {c.username} · {c.coins.toLocaleString()}
          </button>
        ))}
      </div>
      {creditor !== null && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="w-24 rounded-lg bg-black/40 px-2 py-1 text-right text-gold font-bold tabnum text-sm ring-1 ring-white/10"
            value={amount}
            min={(state?.bigBlind ?? 20)}
            max={maxFor(creditor)}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <button
            className="rounded-xl bg-gold/25 px-4 py-2 text-sm font-bold text-gold ring-1 ring-gold/40 active:scale-95"
            onClick={() => creditor !== null && requestLoan(creditor, amount)}
          >
            Request loan
          </button>
        </div>
      )}
    </div>
  );
}
