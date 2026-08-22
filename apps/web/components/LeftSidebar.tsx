"use client";

import React, { useState } from "react";
import { useGame } from "../lib/store";

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-panel p-4 ring-1 line shadow-panel">
      <div className="mb-2.5 text-[10px] font-black uppercase tracking-[0.22em] text-white/40">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, gold }: { label: string; value: React.ReactNode; gold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-[3px] text-xs">
      <span className="text-white/50">{label}</span>
      <span className={`font-bold tabnum ${gold ? "text-gold" : "text-white/85"}`}>{value}</span>
    </div>
  );
}

export function LeftSidebar({ onOpenRepay }: { onOpenRepay: () => void }) {
  const { me, state, session } = useGame();
  if (!me) return null;

  const cfg = me.config ?? {
    startingCoins: 1000,
    smallBlind: state?.smallBlind ?? 10,
    bigBlind: state?.bigBlind ?? 20,
    turnTimeSeconds: 20,
  };

  // Loan bookkeeping for MY seat.
  const mySeat = state?.seats[me.seatIndex];
  const debts = Object.entries(mySeat?.debtTo ?? {}).filter(([, v]) => v > 0);
  const outstanding = debts.reduce((s, [, v]) => s + v, 0);
  const creditorName = (seatIdx: number) =>
    state?.seats[seatIdx]?.username ?? `seat ${seatIdx}`;

  const winRate =
    session.handsPlayed > 0
      ? `${((session.handsWon / session.handsPlayed) * 100).toFixed(1)}%`
      : "—";

  return (
    <div className="space-y-3">
      <Panel title="Game Info">
        <Row label="Buy-in (Starting Chips)" value={cfg.startingCoins.toLocaleString()} />
        <Row label="Small Blind" value={cfg.smallBlind.toLocaleString()} />
        <Row label="Big Blind" value={cfg.bigBlind.toLocaleString()} />
        <Row label="Turn Time" value={`${cfg.turnTimeSeconds}s`} gold />
      </Panel>

      <Panel title="Player Stats (You)">
        <Row label="Hands Played" value={session.handsPlayed} />
        <Row label="Hands Won" value={session.handsWon} />
        <Row label="Win Rate" value={winRate} />
        <Row label="Best Hand" value={session.bestHandLabel ?? "—"} gold />
        <Row label="Biggest Pot Won" value={session.biggestPotWon.toLocaleString()} gold />
      </Panel>

      {outstanding > 0 && (
        <Panel title="Loan">
          <div className="mb-1 text-xs font-semibold text-fuchsia-300">
            You have an active loan
          </div>
          {debts.map(([seatStr, amt]) => {
            const idx = Number(seatStr);
            return (
              <Row key={seatStr} label={`Borrowed from: ${creditorName(idx)}`} value={amt.toLocaleString()} />
            );
          })}
          <Row label="Outstanding" value={outstanding.toLocaleString()} gold />
          <button
            onClick={onOpenRepay}
            className="mt-2.5 w-full rounded-xl bg-accent py-2.5 text-sm font-black uppercase tracking-wide text-white shadow-[0_4px_0_#4c1d95] active:scale-[0.98]"
          >
            Repay Loan
          </button>
        </Panel>
      )}
    </div>
  );
}
