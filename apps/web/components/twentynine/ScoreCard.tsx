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

function SixScoreCard({
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
}

export function PhysicalScoreBoard({
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
  const positiveSuit: TnSuit =
    team === "my" ? "HEARTS" : "DIAMONDS";

  const negativeSuit: TnSuit =
    team === "my" ? "SPADES" : "CLUBS";

  const absoluteScore = Math.min(6, Math.abs(score));

  /**
   * At score 0, default to positive card,
   * but everything is completely covered.
   */
  const activeSuit =
    score < 0 ? negativeSuit : positiveSuit;

  return (
    <div
      className="relative w-7 h-10 sm:w-14 sm:h-20 shrink-0 pointer-events-none"
    >
      {/* ONE underlying 6 score card */}
      <SixScoreCard
        suit={activeSuit}
        score={absoluteScore}
      />

      {/* ONE moving cover card with luxury art */}
      <div
        className="absolute inset-0 z-10 rounded-md sm:rounded-xl
          transition-transform duration-700 ease-out shadow-card overflow-hidden ring-1 ring-black/20"
        style={{
          transform:
            scoreCoverPositions[absoluteScore],
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
  );
}
