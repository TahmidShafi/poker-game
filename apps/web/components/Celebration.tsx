"use client";

import React from "react";
import type { CelebrationView } from "../lib/store";

/**
 * Full-screen golden takeover for monster hands (Royal Flush / Quads).
 * Purely visual, pointer-transparent, auto-dismissed by the store timer.
 */
export function Celebration({
  celebration,
  onDone,
}: {
  celebration: CelebrationView | null;
  onDone: () => void;
}) {
  if (!celebration) return null;

  const isRoyal = celebration.kind === "royal";
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[65] grid place-items-center animate-riseFade"
      role="status"
      onClick={onDone}
    >
      {/* radial gold flash */}
      <div
        className="absolute inset-0"
        style={{
          background: isRoyal
            ? "radial-gradient(ellipse at center, rgba(240,199,94,0.32) 0%, rgba(240,199,94,0.10) 45%, transparent 75%)"
            : "radial-gradient(ellipse at center, rgba(139,92,246,0.26) 0%, rgba(139,92,246,0.08) 45%, transparent 75%)",
        }}
      />
      <div className="relative text-center">
        <div className="text-[11px] font-black uppercase tracking-[0.5em] text-white/70 drop-shadow">
          {isRoyal ? "★ legendary ★" : "monster hand"}
        </div>
        <div
          className={`mt-1 text-4xl font-black uppercase leading-none tracking-wide drop-shadow-[0_4px_18px_rgba(0,0,0,0.8)] dt:text-6xl ${
            isRoyal ? "text-gold" : "text-violet-300"
          }`}
        >
          {celebration.label}
        </div>
        <div className="mx-auto mt-3 h-[3px] w-40 rounded-full bg-gradient-to-r from-transparent via-gold to-transparent" />
      </div>
    </div>
  );
}
