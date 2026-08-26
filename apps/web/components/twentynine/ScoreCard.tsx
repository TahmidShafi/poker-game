"use client";

import React from "react";
import { TN_SUIT_SYMBOLS, type TnSuit } from "@poker/shared-types";

/**
 * Traditional Bangladeshi 29 score card.
 *
 * Each team keeps a pair of real playing-card-styled counters:
 *   Team A -> ♥ (round wins)  + ♠ upside-down (round losses)
 *   Team B -> ♦ (round wins)  + ♣ upside-down (round losses)
 *
 * The count is drawn as AUTHENTIC suit pips in the layout of a real card
 * face (1 = centre, 2 = vertical pair, 3 = diagonal, 4 = corners,
 * 5 = corners + centre, 6 = two columns of three). Bottom-half pips are
 * rotated like on a genuine deck. Zero shows a blank face.
 */

const PIP_LAYOUTS: Record<number, Array<{ top: string; left: string; flip?: boolean }>> = {
  0: [],
  1: [{ top: "50%", left: "50%" }],
  2: [
    { top: "18%", left: "50%" },
    { top: "82%", left: "50%", flip: true },
  ],
  3: [
    { top: "16%", left: "50%" },
    { top: "50%", left: "50%" },
    { top: "84%", left: "50%", flip: true },
  ],
  4: [
    { top: "18%", left: "28%" },
    { top: "18%", left: "72%", flip: true },
    { top: "82%", left: "28%" },
    { top: "82%", left: "72%", flip: true },
  ],
  5: [
    { top: "18%", left: "28%" },
    { top: "18%", left: "72%", flip: true },
    { top: "50%", left: "50%" },
    { top: "82%", left: "28%" },
    { top: "82%", left: "72%", flip: true },
  ],
  6: [
    { top: "16%", left: "28%" },
    { top: "50%", left: "28%" },
    { top: "84%", left: "28%", flip: true },
    { top: "16%", left: "72%", flip: true },
    { top: "50%", left: "72%" },
    { top: "84%", left: "72%", flip: true },
  ],
};

export function ScoreCard({
  count,
  suit,
  inverted = false,
  size = 92,
  highlight = false,
  animKey,
}: {
  /** 0..6 */
  count: number;
  suit: TnSuit;
  /** Renders every pip and label upside-down (the black loss side). */
  inverted?: boolean;
  /** Pixel width of the card. */
  size?: number;
  /** Match-point glow when a team reaches the target. */
  highlight?: boolean;
  /** Changing this key re-triggers the pop animation after each round. */
  animKey?: number;
}) {
  const clamped = Math.max(0, Math.min(6, Math.round(count)));
  const red = suit === "HEARTS" || suit === "DIAMONDS";
  const glyph = TN_SUIT_SYMBOLS[suit];
  const pips = PIP_LAYOUTS[clamped] ?? [];

  return (
    <div
      key={animKey}
      className={`relative select-none overflow-hidden rounded-xl bg-gradient-to-br from-white via-white to-stone-200 shadow-card transition-transform ${
        red ? "text-crimson" : "text-ink"
      } ${highlight ? "ring-2 ring-gold shadow-glowGold" : "ring-1 ring-black/10"} animate-scorePop`}
      style={{
        width: size,
        height: Math.round(size * 1.42),
        // Inverted cards (loss side) flip as ONE unit — no per-pip math.
        transform: inverted ? "rotate(180deg)" : undefined,
      }}
      aria-label={`${clamped} ${suit}`}
    >
      {/* corner indices, both corners like a real card */}
      <div className="absolute left-1 top-0.5 font-bold leading-none" style={{ fontSize: size * 0.15 }}>
        {clamped}
        <div className="text-[0.85em]">{glyph}</div>
      </div>
      <div className="absolute bottom-0.5 right-1 rotate-180 font-bold leading-none" style={{ fontSize: size * 0.15 }}>
        {clamped}
        <div className="text-[0.85em]">{glyph}</div>
      </div>

      {/* pips — bottom-half pips rotate like a genuine deck face */}
      {pips.map((p, i) => (
        <span
          key={i}
          className="absolute leading-none"
          style={{
            top: p.top,
            left: p.left,
            fontSize: size * (clamped >= 4 ? 0.26 : 0.32),
            transform: `translate(-50%,-50%)${p.flip ? " rotate(180deg)" : ""}`,
          }}
        >
          {glyph}
        </span>
      ))}

      {clamped === 0 && (
        <span className="absolute inset-0 grid place-items-center text-stone-300" style={{ fontSize: size * 0.2 }}>
          —
        </span>
      )}

      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-black/10" />
    </div>
  );
}

/** Small caption chip above each team's card pair. */
export function ScorePairCaption({
  team,
  label,
  mine,
}: {
  team: "A" | "B";
  label: string;
  mine?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
        team === "A" ? "bg-gold/15 text-gold" : "bg-violet-400/15 text-violet-300"
      } ${mine ? "ring-1 ring-gold/60" : ""}`}
    >
      {label}
    </span>
  );
}
