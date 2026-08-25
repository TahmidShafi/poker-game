"use client";

import React, { useState } from "react";
import { useGame } from "../../lib/store";
import { SeatCard, TrickArea, TrumpBanner, RankHint } from "./parts";
import { ActionPills, BiddingPanel, HandFan, ScoreBoard } from "./panels";
import { MatchOverBanner, RoundBanner, RulesModal, TrumpPickerModal } from "./modals";

/** Anti-clockwise seat -> screen position: 0 west, 1 north, 2 east, 3 south(me-agnostic). */
const POS: Record<number, string> = {
  0: "left-[4%] top-[38%]",
  1: "left-1/2 top-[3%] -translate-x-1/2",
  2: "right-[4%] top-[38%]",
  3: "left-1/2 bottom-[6%] -translate-x-1/2",
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

  const mySeat = me?.seatIndex ?? -1;
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(me?.roomCode ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="min-h-dvh bg-room">
      {/* Header */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-4">
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

      {/* Table */}
      <main className="mx-auto mt-3 grid w-full max-w-6xl gap-4 px-4 pb-8 dt:grid-cols-[240px_1fr_260px] dt:items-start">
        <aside className="order-2 space-y-3 dt:order-1">
          <ScoreBoard state={tnState} />
        </aside>

        <section className="relative order-1 mx-auto aspect-square w-full max-w-[36rem] rounded-full p-3 rail-surface dt:order-2">
          <div className="relative h-full w-full overflow-hidden rounded-full felt-surface gold-ring">
            <TrickArea state={tnState} flashSeat={null} />
            {/* offline-fallback notice */}
            {tnState.offlineFallback && (
              <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-crimson/20 px-3 py-1 text-[9.5px] font-bold uppercase tracking-widest text-crimson ring-1 ring-crimson/40">
                seat {tnState.offlineFallback.seatIndex} offline · auto-play countdown
              </div>
            )}
          </div>

          {/* Seats around the oval */}
          {tnState.seats.map((s) => (
            <div key={s.seatIndex} className={`absolute ${POS[s.seatIndex]}`}>
              <SeatCard
                seat={s}
                isDealer={tnState.dealerSeatIndex === s.seatIndex}
                isActing={tnState.actingSeatIndex === s.seatIndex && s.username !== null}
                isMe={s.seatIndex === mySeat}
              />
            </div>
          ))}
        </section>

        <aside className="order-3 space-y-3">
          <BiddingPanel state={tnState} />
          <RankHint />
          <p className="px-1 text-[9.5px] uppercase tracking-widest text-white/25">{status} · {serverUrl}</p>
        </aside>
      </main>

      {/* Hand + actions */}
      <footer className="fixed inset-x-0 bottom-0 z-30 space-y-2 bg-gradient-to-t from-room via-room/95 to-transparent pb-4 pt-3">
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
