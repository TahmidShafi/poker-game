"use client";

import React from "react";
import type { TnSuit } from "@poker/shared-types";
import { TN_SUIT_SYMBOLS } from "@poker/shared-types";
import { useGame } from "../../lib/store";
import { PlayingCard } from "../common/PlayingCard";

const SUIT_DATA: {
  suit: TnSuit;
  name: string;
  bengali: string;
  symbol: string;
  theme: {
    border: string;
    bg: string;
    hoverBg: string;
    hoverBorder: string;
    symbolColor: string;
    glow: string;
  };
}[] = [
  {
    suit: "SPADES",
    name: "Spades",
    bengali: "Shon / Kala",
    symbol: "♠",
    theme: {
      border: "border-slate-700/60",
      bg: "bg-slate-900/60",
      hoverBg: "hover:bg-slate-800/80",
      hoverBorder: "hover:border-gold/70",
      symbolColor: "text-slate-100",
      glow: "hover:shadow-[0_0_20px_rgba(234,179,8,0.2)]",
    },
  },
  {
    suit: "HEARTS",
    name: "Hearts (Love)",
    bengali: "Love / Pan",
    symbol: "♥",
    theme: {
      border: "border-rose-900/50",
      bg: "bg-rose-950/40",
      hoverBg: "hover:bg-rose-900/60",
      hoverBorder: "hover:border-rose-500/80",
      symbolColor: "text-rose-500",
      glow: "hover:shadow-[0_0_20px_rgba(244,63,94,0.3)]",
    },
  },
  {
    suit: "DIAMONDS",
    name: "Diamonds",
    bengali: "Ruiton / It",
    symbol: "♦",
    theme: {
      border: "border-amber-900/50",
      bg: "bg-amber-950/40",
      hoverBg: "hover:bg-amber-900/60",
      hoverBorder: "hover:border-amber-500/80",
      symbolColor: "text-amber-500",
      glow: "hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]",
    },
  },
  {
    suit: "CLUBS",
    name: "Clubs",
    bengali: "Chiri / Harin",
    symbol: "♣",
    theme: {
      border: "border-emerald-900/50",
      bg: "bg-emerald-950/40",
      hoverBg: "hover:bg-emerald-900/60",
      hoverBorder: "hover:border-emerald-500/80",
      symbolColor: "text-emerald-400",
      glow: "hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]",
    },
  },
];

function getCardPoints(rank: number): number {
  if (rank === 11) return 3; // Jack
  if (rank === 9) return 2;  // 9
  if (rank === 14) return 1; // Ace
  if (rank === 10) return 1; // 10
  return 0;
}

function TrumpPickerModalComponent() {
  const { tnState, tnDeclareTrump, me, myTnCards } = useGame();
  if (!tnState) return null;

  const myTurn = tnState.actingSeatIndex === me?.seatIndex;
  if (tnState.phase !== "TRUMP_SETUP" || !myTurn) return null;

  const initialCards = myTnCards ?? [];
  const totalHandPoints = initialCards.reduce((sum, c) => sum + getCardPoints(c.rank), 0);

  // Per-suit counts and points in the player's initial 4 cards
  const suitSummary = {
    SPADES: { count: 0, points: 0 },
    HEARTS: { count: 0, points: 0 },
    DIAMONDS: { count: 0, points: 0 },
    CLUBS: { count: 0, points: 0 },
  };

  for (const c of initialCards) {
    if (c.suit in suitSummary) {
      suitSummary[c.suit].count += 1;
      suitSummary[c.suit].points += getCardPoints(c.rank);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="glass w-full max-w-xl rounded-3xl p-4 sm:p-6 shadow-2xl animate-riseFade border border-gold/35 text-white my-auto max-h-[92dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gold/15 border border-gold/40 text-gold text-[10px] sm:text-[11px] font-black uppercase tracking-wider mb-1">
              <span>👑</span> Bid Winner ({tnState.bid ?? tnState.bids?.highestBid ?? 16} Pts)
            </div>
            <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
              Select Secret Trump <span className="text-xs sm:text-sm font-bold text-white/50">(তুরুপ)</span>
            </h2>
          </div>
          <div className="flex items-center gap-1 bg-black/50 px-2.5 py-1 rounded-xl border border-white/10 text-[10px] sm:text-xs font-bold text-amber-300">
            <span>🔒</span> Secret until called
          </div>
        </div>

        {/* Initial 4 Cards Hand Preview */}
        <div className="mt-3.5 rounded-2xl bg-black/50 border border-white/10 p-3 sm:p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-white/60 flex items-center gap-1.5">
              <span>🃏</span> Your Initial 4 Cards
            </span>
            <span className="text-[10px] sm:text-[11px] font-black text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-400/40">
              ⚡ {totalHandPoints} Points in hand
            </span>
          </div>

          <div className="flex items-center justify-center gap-2 sm:gap-3 py-1">
            {initialCards.map((card, idx) => {
              const pts = getCardPoints(card.rank);
              return (
                <div key={`${card.suit}:${card.rank}:${idx}`} className="flex flex-col items-center gap-1">
                  <div className="transform hover:-translate-y-1 transition-transform">
                    <PlayingCard card={card} size="sm" className="sm:hidden shadow-lg ring-1 ring-white/20" />
                    <PlayingCard card={card} size="md" className="hidden sm:block shadow-lg ring-1 ring-white/20" />
                  </div>
                  <span
                    className={`text-[8px] sm:text-[9px] font-black px-1.5 py-0.2 rounded-full border ${
                      pts > 0
                        ? "bg-gold/20 text-gold border-gold/40"
                        : "bg-white/5 text-white/40 border-white/10"
                    }`}
                  >
                    {pts > 0 ? `${pts} pt${pts > 1 ? "s" : ""}` : "0 pts"}
                  </span>
                </div>
              );
            })}
            {initialCards.length === 0 && (
              <p className="text-xs text-white/40 italic py-2">Dealing cards…</p>
            )}
          </div>
        </div>

        {/* Suit Options Grid */}
        <div className="mt-3.5">
          <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-white/60 mb-2">
            Choose Trump Suit:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
            {SUIT_DATA.map(({ suit, name, bengali, symbol, theme }) => {
              const count = suitSummary[suit].count;
              const points = suitSummary[suit].points;
              const hasCards = count > 0;

              return (
                <button
                  key={suit}
                  onClick={() => tnDeclareTrump(suit)}
                  className={`relative flex flex-col items-center justify-between p-2.5 sm:p-3.5 rounded-2xl border ${theme.border} ${theme.bg} ${theme.hoverBg} ${theme.hoverBorder} ${theme.glow} transition-all duration-200 cursor-pointer active:scale-95 text-center group`}
                >
                  {/* Top suit icon */}
                  <span className={`text-3xl sm:text-4xl leading-none ${theme.symbolColor} group-hover:scale-110 transition-transform`}>
                    {symbol}
                  </span>

                  {/* Name and Bengali label */}
                  <div className="mt-1.5">
                    <span className="block text-xs sm:text-sm font-black tracking-tight text-white">
                      {name}
                    </span>
                    <span className="block text-[8.5px] sm:text-[9.5px] font-bold text-white/50">
                      {bengali}
                    </span>
                  </div>

                  {/* Count badge */}
                  <div className="mt-2 w-full">
                    {hasCards ? (
                      <span className="inline-block w-full py-0.5 px-1 rounded-full bg-gold/15 border border-gold/40 text-[8.5px] sm:text-[9.5px] font-black text-amber-200 truncate">
                        {count} card{count > 1 ? "s" : ""} ({points} pt{points !== 1 ? "s" : ""})
                      </span>
                    ) : (
                      <span className="inline-block w-full py-0.5 px-1 rounded-full bg-white/5 text-[8.5px] sm:text-[9.5px] font-bold text-white/30 truncate">
                        0 in hand
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Alternative Special Trump Modes */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            onClick={() => tnDeclareTrump("SEVENTH_CARD")}
            className="flex items-center gap-2.5 p-2.5 sm:p-3 rounded-2xl bg-gradient-to-r from-violet-950/40 to-slate-900/60 border border-violet-700/40 hover:border-violet-400 hover:from-violet-900/60 transition-all text-left cursor-pointer active:scale-98 group"
          >
            <span className="text-2xl sm:text-3xl">♢</span>
            <div className="flex-1 min-w-0">
              <span className="block text-xs sm:text-sm font-black text-violet-200 group-hover:text-white">
                Mystery 7th Card
              </span>
              <span className="block text-[9px] sm:text-[10px] text-white/50 leading-tight">
                Trump established automatically from your 7th dealt card
              </span>
            </div>
          </button>

          <button
            onClick={() => tnDeclareTrump("JOKER")}
            className="flex items-center gap-2.5 p-2.5 sm:p-3 rounded-2xl bg-gradient-to-r from-indigo-950/40 to-slate-900/60 border border-indigo-700/40 hover:border-indigo-400 hover:from-indigo-900/60 transition-all text-left cursor-pointer active:scale-98 group"
          >
            <span className="text-2xl sm:text-3xl">🃏</span>
            <div className="flex-1 min-w-0">
              <span className="block text-xs sm:text-sm font-black text-indigo-200 group-hover:text-white">
                No-Trump Joker Mode
              </span>
              <span className="block text-[9px] sm:text-[10px] text-white/50 leading-tight">
                No suit trump · Power cards (J &gt; 9 &gt; A &gt; 10) dominate
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export const TrumpPickerModal = React.memo(TrumpPickerModalComponent);

function SeventhCardModalComponent() {
  const { tnState, tnBidderPrivate, me } = useGame();
  const [dismissedRound, setDismissedRound] = React.useState<number | null>(null);

  if (!tnState || !me) return null;
  const isBidder = tnState.bidderSeatIndex === me.seatIndex;
  if (!isBidder) return null;

  if (
    tnBidderPrivate?.kind !== "SEVENTH_INDICATOR" ||
    dismissedRound === tnState.roundNumber ||
    tnState.phase === "ROUND_SCORED" ||
    tnState.phase === "MATCH_OVER"
  ) {
    return null;
  }

  const card = tnBidderPrivate.indicatorCard;
  const isRed = card.suit === "HEARTS" || card.suit === "DIAMONDS";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-md px-4">
      <div className="glass w-full max-w-sm rounded-3xl p-6 text-center shadow-panel animate-riseFade border border-gold/30">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold/15 border border-gold/30 text-gold text-[11px] font-black uppercase tracking-wider mb-3">
          <span>🃏</span> Secret 7th Card Trump
        </div>

        <h2 className="text-xl font-black tracking-tight text-white">
          Your Trump is Set!
        </h2>
        <p className="mt-1 text-xs text-white/60">
          Your 7th card was drawn. It establishes your secret trump suit for this hand:
        </p>

        <div className="my-5 flex flex-col items-center justify-center">
          <div className="relative transform hover:scale-105 transition-transform">
            <PlayingCard card={card} size="lg" className="shadow-2xl ring-2 ring-gold/50" />
            <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-black/90 px-2.5 py-0.5 rounded-full border border-gold/50 text-[9px] font-black text-gold uppercase tracking-wider whitespace-nowrap shadow-md">
              7th Card
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-base font-black">
            <span className={isRed ? "text-crimson" : "text-amber-200"}>
              {card.suit} {TN_SUIT_SYMBOLS[card.suit]}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-white/45 max-w-[240px]">
            Other players cannot see this card until trump is called during the game.
          </p>
        </div>

        <button
          onClick={() => setDismissedRound(tnState.roundNumber)}
          className="w-full rounded-2xl bg-gold py-3 text-sm font-black tracking-wide text-slate-950 shadow-glowGold hover:brightness-105 active:scale-[0.98]"
        >
          Got It, Start Playing
        </button>
      </div>
    </div>
  );
}

export const SeventhCardModal = React.memo(SeventhCardModalComponent);

function RoundBannerComponent() {
  const { tnState, me } = useGame();
  if (!tnState || tnState.phase !== "ROUND_SCORED" || !tnState.lastRoundSummary) return null;
  const summary = tnState.lastRoundSummary;
  const mySeat = me?.seatIndex ?? null;
  const myTeam = mySeat !== null ? (mySeat % 2 === 0 ? "A" : "B") : null;
  const iWon = myTeam !== null && summary.winnerTeam === myTeam;

  let title = iWon ? "Round Won!" : "Round Lost";
  let subtitle = `${summary.captured[summary.winnerTeam]} points captured`;
  let pointsAwardedText = `+${summary.scoreAwarded ?? 1} Match Points`;

  if (summary.endReason === "SINGLE_HAND_WIN") {
    title = iWon ? "👑 SINGLE HAND SUCCESS!" : "👑 OPPONENT SINGLE HAND SUCCESS";
    subtitle = "Single Hand player won all 8 tricks!";
    pointsAwardedText = "+3 Match Points";
  } else if (summary.endReason === "SINGLE_HAND_FAIL") {
    title = iWon ? "🛡️ SINGLE HAND DEFEATED!" : "❌ SINGLE HAND FAILED";
    subtitle = "Single hand attempt failed. Caller's team loses 3 points.";
    pointsAwardedText = iWon ? "Opponent -3 Match Points" : "-3 Match Points";
  } else if (summary.endReason === "FULL_BOARD") {
    title = "🌟 FULL BOARD!";
    subtitle = "All 8 tricks won by bidding team!";
    pointsAwardedText = "+2 Match Points";
  } else if (summary.endReason === "EARLY_BID_REACHED") {
    title = iWon ? "🎯 TARGET REACHED!" : "Round Lost";
    subtitle = `Bidding team reached the requirement of ${summary.requirement} points!`;
    pointsAwardedText = "+1 Match Point";
  } else if (summary.endReason === "EARLY_DEFEAT") {
    title = iWon ? "🛡️ BID DEFEATED!" : "❌ BID FAILED";
    subtitle = `Defenders prevented the requirement of ${summary.requirement} points.`;
    pointsAwardedText = "+1 Match Point";
  }

  return (
    <div className="fixed inset-x-0 top-16 z-40 flex justify-center pointer-events-none px-4 animate-riseFade">
      <div className="rounded-2xl bg-slate-950/92 px-6 py-4 border border-amber-400/40 shadow-2xl backdrop-blur-xl text-center ring-1 ring-white/10 max-w-sm w-full">
        <h3 className={`text-lg font-black tracking-wide ${iWon ? "text-emerald-400" : "text-rose-400"}`}>
          {title}
        </h3>
        <p className="text-xs text-white/70 mt-0.5 font-medium">{subtitle}</p>
        <div className="mt-2 inline-block rounded-full bg-amber-400/20 px-3 py-1 text-[11px] font-black text-amber-300 ring-1 ring-amber-400/30">
          {pointsAwardedText}
        </div>
      </div>
    </div>
  );
}

export const RoundBanner = React.memo(RoundBannerComponent);

function MatchOverBannerComponent() {
  const { tnState, leaveRoom, me } = useGame();
  if (!tnState || tnState.phase !== "MATCH_OVER" || !tnState.winnerTeam) return null;
  const mySeat = me?.seatIndex ?? -1;
  const myTeam = (mySeat % 2 === 0 ? "A" : "B") as "A" | "B";
  const iWon = tnState.winnerTeam === myTeam;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-md px-4">
      <div className="glass w-full max-w-sm rounded-3xl p-7 text-center shadow-panel animate-riseFade">
        <p className="text-3xl">🏆</p>
        <h2 className={`mt-2 text-2xl font-black ${iWon ? "text-emerald-300" : "text-crimson"}`}>
          {iWon ? "Victory!" : "Defeat"}
        </h2>
        <p className="mt-1 text-xs uppercase tracking-[0.25em] text-white/45">
          {iWon ? "Your team wins the match!" : "Other team wins the match"}
        </p>
        <p className="mt-2 tabnum text-sm font-bold text-white/80">
          {tnState.matchScore.A} – {tnState.matchScore.B}
        </p>
        <button
          onClick={leaveRoom}
          className="mt-5 w-full rounded-xl bg-gold py-3 text-sm font-black tracking-wide text-ink shadow-glowGold hover:brightness-105 active:scale-[0.98]"
        >
          Back to lobby
        </button>
      </div>
    </div>
  );
}

export const MatchOverBanner = React.memo(MatchOverBannerComponent);

function RulesModalComponent({ onClose }: { onClose: () => void }) {
  const { tnState } = useGame();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-md px-4" onClick={onClose}>
      <div
        className="glass max-h-[82dvh] w-full max-w-lg overflow-y-auto rounded-3xl p-6 shadow-panel animate-riseFade"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-black tracking-tight">
          Twenty-Nine <span className="text-gold">rules</span>
        </h2>
        <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-white/65">
          <li>• Two teams of two: seats 0&2 vs 1&3. Turns run anti-clockwise 0→3→2→1→0.</li>
          <li>• 32-card deck (7–A). Eight cards each, dealt in two batches of four.</li>
          <li>• Bid 16–28. Raise the other team by any amount, or MATCH their value once; your own side must always go strictly higher.</li>
          <li>• Single Hand (Solo): After 8 cards are dealt, any player can declare Single Hand in turn order. The player plays alone without trump and must win all 8 tricks (+3 match points). Losing even one trick loses 3 match points (-3) immediately.</li>
          <li>• Trick ranking J &gt; 9 &gt; A &gt; 10 &gt; K &gt; Q &gt; 8 &gt; 7. Follow suit if you can.</li>
          <li>• Points: J=3, 9=2, A=1, 10=1. Last trick +1 → always 29 total.</li>
          <li>• Trump stays 🔒 HIDDEN until someone void in the led suit calls it — reveal and playing are separate actions.</li>
          <li>• Marriage: whoever really holds K+Q of the hand&apos;s suit may declare it — bidding team lowers requirement by 4 (min 16), defending team pushes it to bid+4.</li>
          <li>• Bidding team scores at captured &ge; requirement; otherwise defenders do. First team to {tnState?.roundsToWin ?? 6} round-wins takes the match.</li>
        </ul>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          this hand: {(tnState?.trumpStyle ?? "bidder chooses").replace("_", " ").toLowerCase()}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-white/60">
          Every hand the bid winner integrates the classic mechanics themselves:
          declare a hidden suit, take the automatic 7th card (redeal if that card
          is their only one of its suit), or play Joker — no suit, where
          J&nbsp;&gt;&nbsp;9&nbsp;&gt;&nbsp;A&nbsp;&gt;&nbsp;10 act as universal power cards.
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-black/40 py-2.5 text-xs font-black uppercase tracking-widest text-white/70 ring-1 ring-white/15 hover:text-white"
        >
          close
        </button>
      </div>
    </div>
  );
}

export const RulesModal = React.memo(RulesModalComponent);
