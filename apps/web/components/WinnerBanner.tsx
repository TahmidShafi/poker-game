"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { ShowdownResult } from "@poker/shared-types";
import { describeHand } from "@poker/shared-types";
import { PlayingCard } from "./PlayingCard";
import { useGame } from "../lib/store";
import { SeatAvatar } from "./SeatAvatar";

/**
 * Showdown overlay: each revealed player with their rich hand name,
 * the exact five cards that form the hand, and the amount won.
 */
export function WinnerBanner({
  results,
  onClose,
}: {
  results: ShowdownResult[];
  onClose: () => void;
}) {
  const { state } = useGame();
  const grouped = useMemo(() => {
    // Group by seat so split-pot winners show one combined row.
    const map = new Map<number, { username: string; total: number; hand: ShowdownResult["hand"] | null }>();
    for (const r of results) {
      const cur = map.get(r.seatIndex);
      if (cur) {
        cur.total += r.amountWon;
      } else {
        map.set(r.seatIndex, { username: r.username, total: r.amountWon, hand: r.hand ?? null });
      }
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [results]);

  return (
    <div className="fixed inset-x-0 top-20 z-40 flex justify-center px-4">
      <div className="w-full max-w-md rounded-3xl bg-panel p-4 shadow-panel ring-1 line animate-riseFade" role="status">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-widest text-gold">Showdown</h3>
          <button className="text-xs text-white/50 hover:text-white" onClick={onClose}>
            dismiss
          </button>
        </div>
        <ul className="space-y-2.5">
          {grouped.map(([seatIndex, info]) => (
            <li key={seatIndex} className="rounded-2xl bg-white/[0.05] p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 font-bold">
                  <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15">
                    <SeatAvatar
                      username={info.username}
                      avatar={state?.seats[seatIndex]?.avatar}
                    />
                  </span>
                  {info.username}
                </span>
                <span className="text-gold font-bold tabnum">+{info.total.toLocaleString()}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-300/90">
                  {info.hand ? describeHand(info.hand) : "won without showdown"}
                </span>
              </div>
              {info.hand && (
                <div className="mt-1.5 flex gap-0.5">
                  {info.hand.bestFive.map((c, i) => (
                    <PlayingCard key={i} card={c} size="xs" animate="flip" delay={i * 70} />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
