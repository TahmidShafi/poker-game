"use client";

import React from "react";
import {
  TN_SUIT_SYMBOLS,
  type TnSuit,
} from "@poker/shared-types";

import { PlayingCard } from "../common/PlayingCard";

/**
 * Pip positions on a 6 card.
 *
 * Visual order for scoring:
 *
 * 1   2
 * 3   4
 * 5   6
 */
const PIPS_6 = [
  { top: "20%", left: "28%", flip: false },
  { top: "20%", left: "72%", flip: false },

  { top: "50%", left: "28%", flip: false },
  { top: "50%", left: "72%", flip: false },

  { top: "80%", left: "28%", flip: true },
  { top: "80%", left: "72%", flip: true },
];

/**
 * Cover-card animation positions.
 *
 * These are visual positions only.
 * Exact pip visibility is controlled separately by score.
 */
const scoreCoverPositions: Record<number, string> = {
  0: "translate(0%, 0%) rotate(0deg)",
  1: "translate(45%, 35%) rotate(-12deg)",
  2: "translate(0%, 45%) rotate(0deg)",
  3: "translate(45%, 55%) rotate(-12deg)",
  4: "translate(0%, 65%) rotate(0deg)",
  5: "translate(55%, 75%) rotate(-12deg)",
  6: "translate(130%, 10%) rotate(8deg)",
};

const SixScoreCard = React.memo(function SixScoreCard({
  suit,
  score,
}: {
  suit: TnSuit;
  score: number;
}) {
  const red = suit === "HEARTS" || suit === "DIAMONDS";
  const glyph = TN_SUIT_SYMBOLS[suit];
  const visibleScore = Math.max(0, Math.min(6, Math.abs(score)));

  return (
    <div
      className={`absolute inset-0 overflow-hidden rounded-md sm:rounded-xl
        bg-white shadow-card ring-1 ring-black/20
        ${red ? "text-red-600" : "text-slate-900"}`}
    >
      {PIPS_6.map((p, index) => (
        <span
          key={index}
          className="absolute z-[1] text-[10px] sm:text-2xl font-bold leading-none"
          style={{
            top: p.top,
            left: p.left,
            opacity: index < visibleScore ? 1 : 0,
            transform: `translate(-50%, -50%)${
              p.flip ? " rotate(180deg)" : ""
            }`,
            transition: "opacity 250ms ease",
          }}
        >
          {glyph}
        </span>
      ))}
    </div>
  );
});

function PhysicalScoreBoardComponent({
  team,
  score,
}: {
  team: "my" | "opponent";
  score: number;
}) {
  /**
   * My Team:
   * + = Hearts
   * - = Spades
   *
   * Opponent:
   * + = Diamonds
   * - = Clubs
   */
  const isMyTeam = team === "my";
  const positiveSuit: TnSuit = isMyTeam ? "HEARTS" : "DIAMONDS";
  const negativeSuit: TnSuit = isMyTeam ? "SPADES" : "CLUBS";

  const absoluteScore = Math.min(6, Math.abs(score));

  /**
   * At score 0, default to positive card,
   * but everything is completely covered.
   */
  const activeSuit = score < 0 ? negativeSuit : positiveSuit;

  return (
    <div className="flex flex-col items-center gap-0.5 sm:gap-1.5 pointer-events-none select-none">
      {/* Team Label Badge */}
      <div
        className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 sm:px-2.5 sm:py-0.5 backdrop-blur-md border shadow-md ${
          isMyTeam
            ? "bg-emerald-950/85 border-emerald-500/40 text-emerald-300 ring-1 ring-emerald-500/20"
            : "bg-rose-950/85 border-rose-500/40 text-rose-300 ring-1 ring-rose-500/20"
        }`}
      >
        <span
          className={`h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full ${
            isMyTeam
              ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
              : "bg-rose-400 shadow-[0_0_6px_#fb7185]"
          }`}
        />
        <span className="text-[7.5px] sm:text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
          {isMyTeam ? "My Team" : "Opponent"}
        </span>
      </div>

      {/* ONE underlying 6 score card + moving cover card */}
      <div className="relative w-7 h-10 sm:w-14 sm:h-20 shrink-0">
        {/* ONE underlying 6 score card */}
        <SixScoreCard
          suit={activeSuit}
          score={absoluteScore}
        />

        {/* ONE moving cover card with luxury art */}
        <div
          className="absolute inset-0 z-10 rounded-md sm:rounded-xl
            transition-transform duration-700 ease-out shadow-card overflow-hidden ring-1 ring-black/20 transform-gpu will-change-transform"
          style={{
            transform: scoreCoverPositions[absoluteScore],
          }}
        >
          <div
            className="w-full h-full rounded-md sm:rounded-xl bg-cover bg-center border border-amber-300/30"
            style={{
              backgroundImage: "url('/cards/cover_card_back.jpg')",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export const PhysicalScoreBoard = React.memo(PhysicalScoreBoardComponent);
