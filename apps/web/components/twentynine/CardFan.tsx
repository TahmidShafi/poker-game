"use client";

import React from "react";

/**
 * Fan geometry helpers shared by the local hand and opponent back-fans.
 *
 * The local player's cards form a natural arc: edge cards rotate outward and
 * dip slightly, middle cards sit nearly straight — transform-origin is
 * bottom center so cards pivot like they're held in a hand.
 */

export interface FanEntry {
  style: React.CSSProperties;
}

/**
 * Rotation/arc/overlap for card `i` of `n`.
 * @param totalRotation max spread in degrees across the whole fan
 * @param overlap fraction (0-1) of card width hidden by the next card
 */
export function fanCardStyle(
  i: number,
  n: number,
  opts: { totalRotation?: number; overlap?: number; lift?: number } = {}
): React.CSSProperties {
  const { totalRotation = 30, overlap = 0.42, lift = 26 } = opts;
  const safeN = Math.max(n, 1);
  const t = safeN === 1 ? 0.5 : i / (safeN - 1); // 0..1 across the fan
  const rot = -totalRotation / 2 + totalRotation * t;
  // Edge cards dip below the arc centre.
  const arc = Math.abs(rot) / (totalRotation / 2 || 1) * lift;
  return {
    transformOrigin: "bottom center",
    transform: `rotate(${rot.toFixed(2)}deg) translateY(${arc.toFixed(1)}px)`,
    marginLeft: i === 0 ? 0 : `-${Math.round(overlap * 100)}%`,
    zIndex: 10 + i,
  };
}

/** Simple overlapping row container for opponent back-fans. */
export function BackFan({
  children,
  vertical = false,
  overlapPx = 10,
  className = "",
}: {
  children: React.ReactNode;
  vertical?: boolean;
  overlapPx?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex ${vertical ? "flex-col" : "flex-row"} items-center ${className}`}
      style={vertical ? { gap: 0 } : { gap: 0 }}
    >
      {React.Children.map(children, (child, i) => (
        <div
          style={
            i === 0
              ? undefined
              : vertical
                ? { marginTop: -overlapPx }
                : { marginLeft: -overlapPx }
          }
        >
          {child}
        </div>
      ))}
    </div>
  );
}
