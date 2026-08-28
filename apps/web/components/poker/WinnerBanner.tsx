"use client";

import React, { useMemo } from "react";
import type { ShowdownResult } from "@poker/shared-types";
import { describeHand } from "@poker/shared-types";
import { PlayingCard } from "../common/PlayingCard";
import { useGame } from "../../lib/store";
import { SeatAvatar } from "../common/SeatAvatar";

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

  if (grouped.length === 0) return null;

  return (
    <div className="fixed inset-x-0 top-16 z-40 flex justify-center px-4 pointer-events-auto">
      <div className="w-full max-w-md rounded-3xl bg-panel/95 backdrop-blur p-4 shadow-panel ring-1 line animate-riseFade" role="status">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🏆</span>
            <h3 className="text-xs font-black uppercase tracking-widest text-gold">Showdown Results</h3>
          </div>
          <button
            className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/60 hover:bg-white/20 hover:text-white transition-colors"
            onClick={onClose}
          >
            ✕ Dismiss
          </button>
        </div>

        <ul className="space-y-2">
          {grouped.map(([seatIndex, info]) => (
            <li key={seatIndex} className="rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-bold text-sm">
                  <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15">
                    <SeatAvatar
                      username={info.username}
                      avatar={state?.seats[seatIndex]?.avatar}
                    />
                  </span>
                  {info.username}
                </span>
                {info.total > 0 && (
                  <span className="text-sm font-black text-gold tabnum bg-gold/15 px-2 py-0.5 rounded-lg ring-1 ring-gold/30">
                    +{info.total.toLocaleString()}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-300">
                  {info.hand ? describeHand(info.hand) : "Won uncontested"}
                </span>
              </div>
              {info.hand && info.hand.bestFive && (
                <div className="mt-2 flex gap-1 justify-start">
                  {info.hand.bestFive.map((c, i) => (
                    <PlayingCard key={i} card={c} size="xs" animate="flip" delay={i * 80} />
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
