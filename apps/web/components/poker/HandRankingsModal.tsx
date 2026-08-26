"use client";

import React, { useState } from "react";
import type { Card } from "@poker/shared-types";
import { PlayingCard } from "../common/PlayingCard";

interface RankingRow {
  name: string;
  desc: string;
  cards: Card[];
}

function c(rank: Card["rank"], suit: Card["suit"]): Card {
  return { rank, suit };
}

const S = "SPADES", H = "HEARTS", D = "DIAMONDS", C = "CLUBS";

const RANKINGS: RankingRow[] = [
  { name: "1 · Royal Flush", desc: "A-K-Q-J-10, all one suit. The best hand.", cards: [c(14,S), c(13,S), c(12,S), c(11,S), c(10,S)] },
  { name: "2 · Straight Flush", desc: "Five consecutive cards of one suit.", cards: [c(9,H), c(8,H), c(7,H), c(6,H), c(5,H)] },
  { name: "3 · Four of a Kind", desc: "All four cards of one rank + kicker.", cards: [c(9,D), c(9,C), c(9,H), c(9,S), c(14,C)] },
  { name: "4 · Full House", desc: "Three of a kind plus a pair.", cards: [c(14,D), c(14,S), c(14,C), c(7,C), c(7,H)] },
  { name: "5 · Flush", desc: "Any five cards of one suit.", cards: [c(13,D), c(11,D), c(8,D), c(6,D), c(3,D)] },
  { name: "6 · Straight", desc: "Five consecutive ranks, suits mixed.", cards: [c(10,S), c(9,D), c(8,C), c(7,H), c(6,S)] },
  { name: "7 · Three of a Kind", desc: "Three equal-ranked cards.", cards: [c(10,S), c(10,D), c(10,C), c(6,H), c(4,S)] },
  { name: "8 · Two Pair", desc: "Two different pairs + kicker.", cards: [c(13,S), c(13,D), c(9,H), c(9,C), c(2,S)] },
  { name: "9 · One Pair", desc: "One pair + three kickers.", cards: [c(12,S), c(12,D), c(8,C), c(5,H), c(3,S)] },
  { name: "10 · High Card", desc: "No combination - the highest card plays.", cards: [c(14,C), c(12,H), c(9,S), c(6,D), c(2,C)] },
];

/**
 * Hand-rankings help. Purely informational: static data only, no engine or
 * socket usage. Modal on desktop, bottom-sheet on mobile.
 */
export function HandRankingsModal({ onClose }: { onClose: () => void }) {
  const [mounted] = useState(true);
  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-label="Hand rankings help"
    >
      <div
        className="glass max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl p-5 sm:m-6 sm:rounded-3xl animate-riseFade"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-xl font-bold text-gold">Hand Rankings</h2>
          <button
            className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/70 hover:bg-white/20"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 rounded-2xl bg-gold/10 p-3 text-xs leading-relaxed text-white/80 ring-1 ring-gold/25">
          <p>
            Your final hand is the <b>best 5-card combination</b> out of your 2 hole
            cards + the 5 community cards (7 available). You may use both, one — or
            neither — of your hole cards.
          </p>
          <p className="mt-1.5">
            <b>The wheel:</b> A-2-3-4-5 is a straight — the Ace plays <i>low</i>, making it
            the lowest (5-high) straight.
          </p>
        </div>

        <ul className="space-y-2.5">
          {RANKINGS.map((r) => (
            <li key={r.name} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3">
              <div className="flex gap-0.5">
                {r.cards.map((card, i) => (
                  <PlayingCard key={i} card={card} size="xs" />
                ))}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold">{r.name}</div>
                <div className="text-[11px] text-white/55">{r.desc}</div>
              </div>
            </li>
          ))}
        </ul>

        <button
          className="mt-4 w-full rounded-xl bg-gold/25 py-2.5 text-sm font-bold text-gold ring-1 ring-gold/40 active:scale-[0.99]"
          onClick={onClose}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
