"use client";

import React from "react";

const DENOMS: { v: number; color: string; ring: string }[] = [
  { v: 1000, color: "#D8B36A", ring: "#8a6f42" },
  { v: 500, color: "#7d5ba6", ring: "#4e3769" },
  { v: 100, color: "#2b2b2b", ring: "#111" },
  { v: 25, color: "#1d4e89", ring: "#12335a" },
  { v: 10, color: "#2e77ae", ring: "#1c4c74" },
  { v: 5, color: "#C0392B", ring: "#7e2418" },
  { v: 1, color: "#e5e5e5", ring: "#9a9a9a" },
];

/** Breaks an amount into denominations and renders a small chip stack + label. */
export function ChipStack({
  amount,
  showLabel = true,
  maxChips = 5,
}: {
  amount: number;
  showLabel?: boolean;
  maxChips?: number;
}) {
  if (amount <= 0) return null;
  let rest = Math.floor(amount);
  const chips: typeof DENOMS = [];
  for (const d of DENOMS) {
    while (rest >= d.v && chips.length < maxChips * 2) {
      chips.push(d);
      rest -= d.v;
    }
  }
  const shown = chips.slice(0, maxChips);
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative h-5 w-7">
        {shown.map((c, i) => (
          <span
            key={i}
            className="absolute left-0 rounded-full border-2 animate-popChip"
            style={{
              bottom: i * 3,
              width: 26,
              height: 10,
              background: c.color,
              borderColor: c.ring,
              animationDelay: `${i * 30}ms`,
            }}
          />
        ))}
      </div>
      {showLabel && (
        <span className="text-xs font-semibold text-gold tabnum">{amount.toLocaleString()}</span>
      )}
    </div>
  );
}
