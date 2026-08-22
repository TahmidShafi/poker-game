"use client";

import React, { useEffect, useState } from "react";
import type { PublicGameState } from "@poker/shared-types";
import { useGame } from "../lib/store";

/** Approve/deny prompt for the seated lender; auto-expires server-side. */
export function LoanRequestModal({
  request,
  state,
}: {
  request: NonNullable<ReturnType<typeof useGame>["incomingLoan"]>;
  state: PublicGameState;
}) {
  const { respondLoan } = useGame();
  const [left, setLeft] = useState(request.deadline - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, request.deadline - Date.now())), 250);
    return () => clearInterval(t);
  }, [request.deadline]);
  if (left <= 0) return null;

  const debtor = state.seats[request.debtorSeatIndex];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="glass w-full max-w-sm rounded-3xl p-5 animate-riseFade">
        <h3 className="text-lg font-bold text-gold">Loan request</h3>
        <p className="mt-2 text-sm text-white/75">
          <b>{request.debtorUsername}</b> is busted and asks you for{" "}
          <b className="text-gold tabnum">{request.amount.toLocaleString()}</b> chips.
        </p>
        {debtor?.debtTo?.[String(request.creditorSeatIndex)] && (
          <p className="mt-1 text-xs text-crimson/80">
            they already owe you {debtor.debtTo[String(request.creditorSeatIndex)]}
          </p>
        )}
        <div className="mt-1 text-[11px] text-white/40">
          expires in {Math.ceil(left / 1000)}s
        </div>
        <div className="mt-4 flex gap-2">
          <button
            className="flex-1 rounded-xl bg-emerald-600/30 py-2.5 font-bold text-emerald-200 ring-1 ring-emerald-400/40 active:scale-95"
            onClick={() => respondLoan(request.requestId, true)}
          >
            Lend
          </button>
          <button
            className="flex-1 rounded-xl bg-crimson/25 py-2.5 font-bold text-red-200 ring-1 ring-crimson/40 active:scale-95"
            onClick={() => respondLoan(request.requestId, false)}
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

/** Repay dialog: pick a creditor owed and an amount. */
export function RepayDialog({ state, mySeat, onClose }: { state: PublicGameState; mySeat: number; onClose: () => void }) {
  const { repayLoan } = useGame();
  const me = state.seats[mySeat]!;
  const debts = Object.entries(me.debtTo ?? {}).filter(([, v]) => v > 0);
  const [creditor, setCreditor] = useState<number | null>(
    debts.length === 1 ? Number(debts[0]![0]) : null
  );
  const [amount, setAmount] = useState(0);
  const maxOwed = creditor !== null ? me.debtTo?.[String(creditor)] ?? 0 : 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-sm rounded-3xl p-5 animate-riseFade" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gold">Repay a loan</h3>
        {debts.length === 0 ? (
          <p className="mt-2 text-sm text-white/60">You owe nothing.</p>
        ) : (
          <>
            <div className="mt-3 space-y-2">
              {debts.map(([seatStr, owed]) => {
                const seatIdx = Number(seatStr);
                const c = state.seats[seatIdx];
                return (
                  <button
                    key={seatStr}
                    onClick={() => { setCreditor(seatIdx); setAmount(Math.min(owed, me.coins)); }}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm ring-1 transition-colors ${
                      creditor === seatIdx ? "bg-gold/20 text-gold ring-gold/40" : "bg-white/5 text-white/70 ring-white/10"
                    }`}
                  >
                    {c?.username ?? `seat ${seatIdx}`} — owes{" "}
                    <span className="tabnum">{owed.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
            {creditor !== null && (
              <div className="mt-4 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={maxOwed}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-24 rounded-lg bg-black/40 px-2 py-1 text-right text-gold font-bold tabnum text-sm ring-1 ring-white/10"
                />
                <button
                  disabled={amount <= 0 || amount > Math.min(maxOwed, me.coins)}
                  className="flex-1 rounded-xl bg-gold/25 py-2 text-sm font-bold text-gold ring-1 ring-gold/40 disabled:opacity-40 active:scale-95"
                  onClick={() => repayLoan(creditor, amount)}
                >
                  Repay
                </button>
              </div>
            )}
          </>
        )}
        <button className="mt-4 w-full rounded-xl bg-white/5 py-2 text-sm text-white/60" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
