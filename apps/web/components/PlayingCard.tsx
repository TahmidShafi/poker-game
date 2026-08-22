"use client";

import React from "react";
import type { Card, Rank, Suit } from "@poker/shared-types";
import { RANK_LABELS } from "@poker/shared-types";

const SUIT_GLYPH: Record<Suit, string> = {
  SPADES: "\u2660",
  HEARTS: "\u2665",
  DIAMONDS: "\u2666",
  CLUBS: "\u2663",
};

export const SIZES = {
  xs: "w-8 h-11 text-[10px] rounded-md",
  sm: "w-11 h-16 text-sm rounded-lg",
  md: "w-14 h-20 text-base rounded-xl",
  lg: "w-[clamp(52px,9vw,76px)] h-[clamp(74px,13vw,108px)] text-lg rounded-xl",
} as const;

export type CardSize = keyof typeof SIZES;

function isRed(suit: Suit): boolean {
  return suit === "HEARTS" || suit === "DIAMONDS";
}

interface PlayingCardProps {
  card?: Card | null;
  faceDown?: boolean;
  size?: CardSize;
  /** stagger for deal/flip animations (ms) */
  delay?: number;
  animate?: "deal" | "flip" | "none";
  className?: string;
}

/**
 * Premium card: off-white gradient face, corner indices both corners,
 * oversized center pip; patterned back. Pure DOM/CSS - crisp at any DPI.
 */
export function PlayingCard({
  card,
  faceDown = false,
  size = "md",
  delay = 0,
  animate = "none",
  className = "",
}: PlayingCardProps) {
  const base = `${SIZES[size]} relative select-none shadow-card transition-transform duration-150 ${className}`;
  const style: React.CSSProperties =
    animate === "deal"
      ? { animationDelay: `${delay}ms` }
      : { animationDelay: `${delay}ms` };

  if (faceDown || !card) {
    return (
      <div
        style={style}
        className={`${base} border border-white/15 overflow-hidden ${animate === "flip" ? "animate-flipY" : animate === "deal" ? "animate-dealIn" : ""}`}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(45deg,#123c5a 0 6px,#0e2f47 6px 12px), radial-gradient(circle at 50% 50%, #1b4d70, #0b2438)",
          }}
        />
        <div className="absolute inset-[3px] rounded-[inherit] border border-gold/40" />
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-gold/80 font-bold tracking-widest text-[0.7em]">P</span>
        </div>
      </div>
    );
  }

  const red = isRed(card.suit);
  const glyph = SUIT_GLYPH[card.suit];
  return (
    <div
      style={style}
      className={`${base} bg-gradient-to-br from-white via-white to-stone-200 ${red ? "text-crimson" : "text-ink"} ${animate === "flip" ? "animate-flipY" : animate === "deal" ? "animate-dealIn" : ""}`}
    >
      <div className="absolute top-0.5 left-1 leading-none font-bold">
        {RANK_LABELS[card.rank as Rank]}
        <div className="text-[0.85em]">{glyph}</div>
      </div>
      <div className="absolute bottom-0.5 right-1 leading-none font-bold rotate-180">
        {RANK_LABELS[card.rank as Rank]}
        <div className="text-[0.85em]">{glyph}</div>
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <span className="opacity-90" style={{ fontSize: "1.7em" }}>
          {glyph}
        </span>
      </div>
      <div className="absolute inset-0 rounded-[inherit] ring-1 ring-black/10 pointer-events-none" />
    </div>
  );
}
