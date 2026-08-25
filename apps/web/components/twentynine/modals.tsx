"use client";

import React from "react";
import type { TnSuit, TnTrumpMode } from "@poker/shared-types";
import { TN_SUIT_SYMBOLS } from "@poker/shared-types";
import { useGame } from "../../lib/store";

export function TrumpPickerModal() {
  const { tnState, tnBidderPrivate, tnDeclareTrump } = useGame();
  if (!tnState || !tnBidderPrivate) return null;
  if (tnState.phase !== "TRUMP_SETUP") return null;
  if (tnBidderPrivate.mode === "SEVENTH_CARD") return null; // automatic

  const suits: TnSuit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm">
      <div className="glass mx-4 w-full max-w-sm rounded-3xl p-6 shadow-panel animate-riseFade">
        <h2 className="text-lg font-black tracking-tight">
          Choose trump <span className="text-crimson">(secret)</span>
        </h2>
        <p className="mt-1 text-[11px] text-white/50">
          Only you will know the suit until it is called. {tnBidderPrivate.mode === "MARRIAGE" && "Hold K+Q of your pick to unlock the marriage bonus."}
        </p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {suits.map((s) => (
            <button
              key={s}
              onClick={() => tnDeclareTrump(s)}
              className="rounded-2xl bg-black/40 py-4 ring-1 ring-white/12 transition-all hover:ring-gold/60 hover:bg-gold/10 active:scale-[0.96]"
            >
              <span className="block text-2xl">{TN_SUIT_SYMBOLS[s]}</span>
              <span className="mt-1 block text-[9px] font-bold uppercase tracking-widest text-white/45">
                {s.slice(0, 3)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RoundBanner() {
  const { lastTnRound, me } = useGame();
  if (!lastTnRound) return null;
  const mySeat = me?.seatIndex ?? -1;
  const myTeam = (mySeat % 2 === 0 ? "A" : "B") as "A" | "B";
  const iWon = lastTnRound.winnerTeam === myTeam;

  return (
    <div className="fixed inset-x-0 top-[16%] z-40 flex justify-center px-4">
      <div className="glass w-full max-w-md rounded-3xl p-5 text-center shadow-panel animate-riseFade">
        <p className={`text-xl font-black tracking-tight ${iWon ? "text-emerald-300" : "text-crimson"}`}>
          {iWon ? "Your team won the round!" : "Other team won the round"}
        </p>
        <p className="mt-1.5 text-xs text-white/60">
          bid <b className="tabnum text-gold">{lastTnRound.bid}</b> · needed{" "}
          <b className="tabnum text-white/85">{lastTnRound.requirement}</b>
          {lastTnRound.marriageTeam && (
            <>
              {" "}
              · marriage{" "}
              <b className={lastTnRound.marriageTeam === "A" ? "text-gold" : "text-violet-300"}>
                {lastTnRound.marriageTeam}
              </b>
            </>
          )}
        </p>
        <p className="mt-2 tabnum text-sm font-bold text-white/80">
          A {lastTnRound.captured.A} — {lastTnRound.captured.B} B
          <span className="mx-2 text-white/25">·</span>
          score {lastTnRound.matchScoreAfter.A}–{lastTnRound.matchScoreAfter.B}
        </p>
      </div>
    </div>
  );
}

export function MatchOverBanner() {
  const { tnState, leaveRoom } = useGame();
  if (!tnState || tnState.phase !== "MATCH_OVER" || !tnState.winnerTeam) return null;
  const mySeat = useGame().me?.seatIndex ?? -1;
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
          team {tnState.winnerTeam} wins the match
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

const MODE_BLURBS: Record<TnTrumpMode, string> = {
  REGULAR: "The bid winner secretly picks any suit as trump.",
  SEVENTH_CARD: "Trump is automatically the suit of the bid winner's 7th card (3rd of their second batch). Redealt if it's their only card of that suit.",
  JOKER: "No suit is trump. J > 9 > A > 10 are universal power cards (in that order) among legally played cards.",
  MARRIAGE: "Like regular hidden trump — but whoever holds K+Q of trump may declare a marriage: bidding team needs bid−4, defending team pushes it to bid+4.",
};

export function RulesModal({ onClose }: { onClose: () => void }) {
  const { tnState } = useGame();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-md px-4" onClick={onClose}>
      <div
        className="glass w-full max-w-lg overflow-y-auto rounded-3xl p-6 shadow-panel animate-riseFade"
        style={{ maxHeight: "82dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-black tracking-tight">
          Twenty-Nine <span className="text-gold">rules</span>
        </h2>
        <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-white/65">
          <li>• Two teams of two: seats 0&2 vs 1&3. Turns run anti-clockwise 0→3→2→1→0.</li>
          <li>• 32-card deck (7–A). Eight cards each, dealt in two batches of four.</li>
          <li>• Bid 16–28 to name the contract; passes are final. Last remaining bidder wins.</li>
          <li>• Trick ranking J &gt; 9 &gt; A &gt; 10 &gt; K &gt; Q &gt; 8 &gt; 7. Follow suit if you can.</li>
          <li>• Points: J=3, 9=2, A=1, 10=1. Last trick +1 → always 29 total.</li>
          <li>• Trump stays 🔒 HIDDEN until someone void in the led suit calls it.</li>
          <li>• Bidding team scores the round at points ≥ requirement; otherwise defenders do.</li>
          <li>• First team to {tnState?.roundsToWin ?? 6} round wins takes the match.</li>
        </ul>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          trump mode: {(tnState?.trumpMode ?? "REGULAR").replace("_", " ")}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-white/60">
          {MODE_BLURBS[tnState?.trumpMode ?? "REGULAR"]}
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
