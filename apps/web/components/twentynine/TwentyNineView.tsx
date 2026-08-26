"use client";

import React, { useState } from "react";
import { useGame } from "../../lib/store";
import { SeatCard, TrickArea, TrumpBanner, RankHint, seatRel } from "./parts";
import { ActionPills, BiddingPanel, HandFan, TraditionalScoreCards, TurnStatus } from "./panels";
import { MatchOverBanner, RoundBanner, RulesModal, TrumpPickerModal } from "./modals";

/**
 * Viewer-relative seat positions: the local player is ALWAYS at the bottom,
 * partner across the top; anti-clockwise next actor on the right, previous
 * on the left. rel = (seatIndex - mySeat + 4) % 4.
 */
const REL_POS: Record<number, string> = {
  0: "left-1/2 bottom-[4%] -translate-x-1/2",
  1: "left-[3%] top-[38%]",
  2: "left-1/2 top-[2%] -translate-x-1/2",
  3: "right-[3%] top-[38%]",
};

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
    <div className="min-h-dvh bg-room pb-28">
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

      {/* Table */}
      <main className="mx-auto mt-4 flex w-full max-w-6xl justify-center px-4">
        <section className="relative aspect-square w-full max-w-[34rem] rounded-full p-3 rail-surface">
          <div className="relative h-full w-full overflow-hidden rounded-full felt-surface gold-ring">
            <TrickArea state={tnState} mySeat={mySeat} flashSeat={null} />
            {tnState.offlineFallback && (
              <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-crimson/20 px-3 py-1 text-[9.5px] font-bold uppercase tracking-widest text-crimson ring-1 ring-crimson/40">
                seat {tnState.offlineFallback.seatIndex} offline · auto-play countdown
              </div>
            )}
          </div>

          {/* Seats around the oval, viewer-relative */}
          {tnState.seats.map((s) => {
            const rel = seatRel(mySeat, s.seatIndex);
            return (
              <div key={s.seatIndex} className={`absolute ${REL_POS[rel]}`}>
                <SeatCard
                  seat={s}
                  isDealer={tnState.dealerSeatIndex === s.seatIndex}
                  isActing={tnState.actingSeatIndex === s.seatIndex && s.username !== null}
                  isMe={s.seatIndex === mySeat}
                />
              </div>
            );
          })}
        </section>
      </main>

      {/* Bid panel + hints */}
      <section className="mx-auto mt-4 grid w-full max-w-6xl gap-4 px-4 dt:grid-cols-[240px_1fr_260px] dt:items-start">
        <aside className="hidden dt:block" />
        <div className="space-y-3">
          <BiddingPanel state={tnState} />
          <RankHint />
        </div>
        <aside className="text-right text-[9.5px] uppercase tracking-widest text-white/25 dt:pt-1">
          round {tnState.roundNumber} · first to {tnState.roundsToWin}
          <br />
          tricks A{tnState.tricksWon.A}-B{tnState.tricksWon.B} · pts A
          {tnState.capturedPoints.A}-B{tnState.capturedPoints.B}
          <br />
          {status} · {serverUrl}
        </aside>
      </section>

      {/* Hand + actions */}
      <footer className="fixed inset-x-0 bottom-0 z-30 space-y-2 bg-gradient-to-t from-room via-room/95 to-transparent pb-4 pt-3">
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
