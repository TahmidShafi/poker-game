"use client";

import React from "react";
import type { TnSuit } from "@poker/shared-types";
import { TN_SUIT_SYMBOLS } from "@poker/shared-types";
import { useGame } from "../../lib/store";
import { PlayingCard } from "../common/PlayingCard";

const SUITS: TnSuit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];

export function TrumpPickerModal() {
  const { tnState, tnBidderPrivate, tnDeclareTrump, me } = useGame();
  if (!tnState) return null;

  const myTurn = tnState.actingSeatIndex === me?.seatIndex;

  // Show if phase is TRUMP_SETUP and it's our turn. (tnBidderPrivate is just extra validation/payload).
  if (tnState.phase !== "TRUMP_SETUP") return null;
  if (!myTurn) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm">
      <div className="glass mx-4 w-full max-w-md rounded-3xl p-6 shadow-panel animate-riseFade">
        <h2 className="text-lg font-black tracking-tight">
          Set trump <span className="text-crimson">(secret)</span>
        </h2>
        <p className="mt-1 text-[11px] text-white/50">
          Pick a suit to hide it, take your 7th card, or go Joker — no suit at
          all, J&nbsp;9&nbsp;A&nbsp;10 rule the tricks.
        </p>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {SUITS.map((s) => (
            <button
              key={s}
              onClick={() => tnDeclareTrump(s)}
              className="rounded-2xl bg-black/40 py-4 ring-1 ring-white/12 transition-all hover:ring-gold/60 hover:bg-gold/10 active:scale-[0.96]"
            >
              <span className="block text-2xl">{TN_SUIT_SYMBOLS[s]}</span>
              <span className="mt-1 block text-[9px] font-bold uppercase tracking-widest text-white/45">
                hidden
              </span>
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={() => tnDeclareTrump("SEVENTH_CARD")}
            className="rounded-2xl bg-black/40 px-3 py-3 ring-1 ring-white/12 transition-all hover:ring-violet-300/60 hover:bg-violet-400/10 active:scale-[0.97]"
          >
            <span className="block text-sm font-black">7th Card ♢</span>
            <span className="block text-[9px] leading-tight text-white/45">
              auto trump from your 7th card (redeal if dead)
            </span>
          </button>
          <button
            onClick={() => tnDeclareTrump("JOKER")}
            className="rounded-2xl bg-black/40 px-3 py-3 ring-1 ring-white/12 transition-all hover:ring-violet-300/60 hover:bg-violet-400/10 active:scale-[0.97]"
          >
            <span className="block text-sm font-black">Joker 🃏</span>
            <span className="block text-[9px] leading-tight text-white/45">
              no suit — J 9 A 10 are power cards
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SeventhCardModal() {
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

export function RoundBanner() {
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

export function MatchOverBanner() {
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

export function RulesModal({ onClose }: { onClose: () => void }) {
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
          is their only one of its suit), or play Joker � no suit, where
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
