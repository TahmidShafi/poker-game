"use client";

import React from "react";

/**
 * Authoritative-count card back for opponent hands.
 * Same patterned back as PlayingCard's faceDown, sized independently so
 * opponents can render compact overlapping fans/stacks of any count 0..8.
 */
export function CardBack({
  size = "sm",
  className = "",
}: {
  /** xs = 20x30 (side stacks) · sm = 26x38 (top fans) · md = 54x76 (score panels) */
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const dims =
    size === "md"
      ? "w-[54px] h-[76px] rounded-lg"
      : size === "sm"
      ? "w-[26px] h-[38px] rounded-md"
      : "w-5 h-[30px] rounded-[5px]";
  return (
    <div
      className={`${dims} relative shrink-0 overflow-hidden border border-white/15 shadow-sm ${className}`}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(45deg,#123c5a 0 6px,#0e2f47 6px 12px), radial-gradient(circle at 50% 50%, #1b4d70, #0b2438)",
        }}
      />
      <div className="absolute inset-[2px] rounded-[inherit] border border-gold/40" />
    </div>
  );
}
