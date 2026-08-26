"use client";

import React, { useState } from "react";
import { useGame } from "../../lib/store";
import { SeatCard, TrickArea, TrumpBanner, seatRel } from "./parts";
import { ActionPills, BiddingPanel, HandFan, TraditionalScoreCards, TurnStatus } from "./panels";
import { MatchOverBanner, RoundBanner, RulesModal, TrumpPickerModal } from "./modals";
import { OpponentHand } from "./OpponentHand";

/**
 * Viewer-relative seat positions: the local player is ALWAYS at the bottom,
 * partner across the top; anti-clockwise next actor on the right, previous
 * on the left. rel = (seatIndex - mySeat + 4) % 4.
 */
const REL_POS: Record<number, string> = {
  0: "left-1/2 bottom-[1%] -translate-x-1/2",
  1: "left-[4%] top-[38%] -translate-y-1/2",
  2: "left-1/2 top-[1%] -translate-x-1/2",
  3: "right-[4%] top-[38%] -translate-y-1/2",
};

/** Dev-only diagnostics (formula string, raw counters). Off in shipped UI. */
const TN_DEBUG_UI = process.env.NEXT_PUBLIC_TN_DEBUG === "1";

export function TwentyNineView() {
  const { me, tnState, status, serverUrl, leaveRoom, soundOn, toggleSound } = useGame();
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!tnState) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="animate-pulse text-sm text-white/50">joining table…</p>
      </div>
    );
  }

  const mySeat = me?.seatIndex ?? null;
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(me?.roomCode ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-room pb-28">
      {/* Header */}
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <span className="rounded-xl bg-black/40 px-3 py-1.5 text-xs font-bold tracking-widest text-gold ring-1 ring-gold/40">
            {me?.roomCode}
          </span>
          <button
            onClick={copyCode}
            className="rounded-xl bg-black/30 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/55 ring-1 ring-white/10 hover:text-white"
          >
            {copied ? "copied!" : "copy"}
          </button>
        </div>
        <TrumpBanner state={tnState} />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowRules(true)}
            className="rounded-xl bg-black/30 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/55 ring-1 ring-white/10 hover:text-white"
          >
            rules
          </button>
          <button
            onClick={toggleSound}
            className="rounded-xl bg-black/30 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/55 ring-1 ring-white/10 hover:text-white"
          >
            {soundOn ? "sound" : "muted"}
          </button>
          <button
            onClick={leaveRoom}
            className="rounded-xl bg-black/30 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-crimson ring-1 ring-crimson/40 hover:brightness-125"
          >
            leave
          </button>
        </div>
      </header>

      {/* Traditional score cards — prominent strip above the felt */}
      <section className="mx-auto mt-3 w-full max-w-6xl px-4">
        <TraditionalScoreCards state={tnState} />
      </section>

      {/* Table — large oval, vertically centered in the remaining space.
          While bidding, lift the oval above the dock so the bottom seat
          is never covered by the bid controls. */}
      <main
        className={`relative flex flex-1 items-center justify-center px-4 py-3 transition-[padding] ${
          tnState.phase === "BIDDING" ? "pb-48" : ""
        }`}
      >
        {/* ambient wood-tone glow behind the felt */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-[72%] w-[86%] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(122,74,34,0.20),transparent_70%)]" />
        </div>

        <section className="relative aspect-[16/9] w-full max-w-[70rem] rounded-[50%] p-4 rail-surface">
          <div className="relative h-full w-full overflow-hidden rounded-[50%] felt-surface gold-ring">
            <TrickArea state={tnState} mySeat={mySeat} flashSeat={null} />
            {tnState.offlineFallback && (
              <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-crimson/20 px-3 py-1 text-[9.5px] font-bold uppercase tracking-widest text-crimson ring-1 ring-crimson/40">
                seat {tnState.offlineFallback.seatIndex} offline · auto-play countdown
              </div>
            )}
          </div>

          {/* Seats around the oval, viewer-relative, with shrinking back-fans */}
          {tnState.seats.map((s) => {
            const rel = seatRel(mySeat, s.seatIndex);
            const isMe = s.seatIndex === mySeat;
            const fan =
              !isMe && s.username !== null && s.cardsRemaining > 0 ? (
                <OpponentHand
                  count={s.cardsRemaining}
                  position={rel === 2 ? "top" : rel === 1 ? "left" : "right"}
                />
              ) : null;
            return (
              <div
                key={s.seatIndex}
                className={`absolute ${REL_POS[rel]} flex items-center gap-1.5 ${
                  rel === 2 ? "flex-col" : "flex-row"
                }`}
              >
                {(rel === 1 || rel === 2) && fan}
                <SeatCard
                  seat={s}
                  isDealer={tnState.dealerSeatIndex === s.seatIndex}
                  isActing={tnState.actingSeatIndex === s.seatIndex && s.username !== null}
                  isMe={isMe}
                />
                {rel === 3 && fan}
              </div>
            );
          })}
        </section>
      </main>

      {/* Bid + hand live in the fixed dock so the hand fan can never cover
          the bid controls (they used to overlap underneath it). */}
      <footer className="fixed inset-x-0 bottom-0 z-30 space-y-2 bg-gradient-to-t from-room via-room/95 to-transparent pb-4 pt-3">
        {TN_DEBUG_UI && (
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 text-[9.5px] uppercase tracking-widest text-white/25">
            <span>J &gt; 9 &gt; A &gt; 10 &gt; K &gt; Q &gt; 8 &gt; 7 · points J3 9·2 A·1 10·1 · last trick +1</span>
            <span>
              round {tnState.roundNumber} · tricks A{tnState.tricksWon.A}-B
              {tnState.tricksWon.B} · pts A{tnState.capturedPoints.A}-B
              {tnState.capturedPoints.B} · {status} · {serverUrl}
            </span>
          </div>
        )}
        {tnState.phase === "BIDDING" && (
          <div className="mx-auto w-full max-w-xl">
            <BiddingPanel state={tnState} />
          </div>
        )}
        <TurnStatus state={tnState} />
        <ActionPills state={tnState} />
        <HandFan state={tnState} />
      </footer>

      <TrumpPickerModal />
      <RoundBanner />
      <MatchOverBanner />
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
