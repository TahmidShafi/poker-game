"use client";

import React, { useState } from "react";
import { useGame } from "../../lib/store";
import { SeatCard, TrickArea, TrumpBanner, seatRel } from "./parts";
import { ActionPills, BiddingPanel, HandFan, TurnStatus, LiveRoundProgress, SingleHandPrompt } from "./panels";
import { MatchOverBanner, RoundBanner, RulesModal, TrumpPickerModal, SeventhCardModal } from "./modals";
import { PhysicalScoreBoard } from "./ScoreCard";

/**
 * Viewer-relative seat positions: the local player is ALWAYS at the bottom,
 * partner across the top; anti-clockwise next actor on the right, previous
 * on the left. rel = (seatIndex - mySeat + 4) % 4.
 */
const REL_POS: Record<number, string> = {
  0: "left-1/2 -bottom-5 sm:-bottom-9 -translate-x-1/2 z-30", // You (South) - Outside Bottom Rail
  1: "-left-2.5 sm:-left-9 top-1/2 -translate-y-1/2 z-30",     // Left Player (West) - Outside Left Rail
  2: "left-1/2 -top-5 sm:-top-9 -translate-x-1/2 z-30",       // Partner (North) - Outside Top Rail
  3: "-right-2.5 sm:-right-9 top-1/2 -translate-y-1/2 z-30",   // Right Player (East) - Outside Right Rail
};

/** Dev-only diagnostics (formula string, raw counters). Off in shipped UI. */
const TN_DEBUG_UI = process.env.NEXT_PUBLIC_TN_DEBUG === "1";

function TwentyNineViewComponent() {
  const { me, tnState, status, serverUrl, leaveRoom, soundOn, toggleSound, tnFillBots, tnSyncHand, removePlayer } = useGame();
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    tnSyncHand?.();
  }, [tnSyncHand]);

  const mySeat = me?.seatIndex ?? null;
  const isHost = mySeat !== null && tnState?.hostSeatIndex === mySeat;
  const myTeam = mySeat !== null ? (mySeat % 2 === 0 ? "A" : "B") : null;

  const copyCode = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(me?.roomCode ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  }, [me?.roomCode]);

  const handleOpenRules = React.useCallback(() => setShowRules(true), []);
  const handleCloseRules = React.useCallback(() => setShowRules(false), []);

  if (!tnState) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="animate-pulse text-sm text-white/50">joining table…</p>
      </div>
    );
  }

  const seatedCount = tnState.seats.filter((s) => s.username !== null).length;
  const neededCount = 4 - seatedCount;

  return (
    <div className="flex min-h-dvh flex-col bg-room pb-28 w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-3 sm:px-4 pt-3 sm:pt-4">
        <div className="flex items-center gap-2">
          <span className="rounded-xl bg-black/40 px-2.5 sm:px-3 py-1.5 text-xs font-bold tracking-widest text-gold ring-1 ring-gold/40">
            {me?.roomCode}
          </span>
          <button
            onClick={copyCode}
            className="rounded-xl bg-black/30 px-2 sm:px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/55 ring-1 ring-white/10 hover:text-white"
          >
            {copied ? "copied!" : "copy"}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {tnState.phase === "WAITING_FOR_PLAYERS" && (
            <button
              onClick={tnFillBots}
              className="rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-wider text-slate-950 shadow-glowGold hover:brightness-110 active:scale-95 transition-all cursor-pointer ring-1 ring-white/30"
            >
              🤖 Fill Bots
            </button>
          )}
          <button
            onClick={handleOpenRules}
            className="rounded-xl bg-black/30 px-2 sm:px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/55 ring-1 ring-white/10 hover:text-white"
          >
            rules
          </button>
          <button
            onClick={toggleSound}
            className="rounded-xl bg-black/30 px-2 sm:px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/55 ring-1 ring-white/10 hover:text-white"
          >
            {soundOn ? "sound" : "muted"}
          </button>
          <button
            onClick={leaveRoom}
            className="rounded-xl bg-black/30 px-2 sm:px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-crimson ring-1 ring-crimson/40 hover:brightness-125"
          >
            leave
          </button>
        </div>
      </header>

      {/* Mobile Live Round Progress HUD */}
      <div className="sm:hidden px-3 pt-2 w-full max-w-full">
        <LiveRoundProgress state={tnState} />
      </div>

      {/* Table Area */}
      <main
        className={`relative flex flex-1 items-center justify-center px-4 sm:px-12 py-6 sm:py-12 transition-[padding] w-full max-w-full min-w-0 ${
          tnState.phase === "BIDDING" ? "pb-32 sm:pb-28" : ""
        }`}
      >
        {/* ambient wood-tone glow behind the felt */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-[72%] w-[86%] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(122,74,34,0.20),transparent_70%)]" />
        </div>

        {/* Live Round Progress Tracker — Outside the table on desktop */}
        <div className="hidden sm:block absolute left-3 top-3 lg:left-6 lg:top-6 z-30 pointer-events-auto">
          <LiveRoundProgress state={tnState} />
        </div>

        <section className="relative aspect-[1.15/1] sm:aspect-[16/9] w-full max-w-[68rem] rounded-[2.2rem] sm:rounded-[50%] p-2 sm:p-4 rail-surface min-w-0">
          {/* Inner Felt */}
          <div className="relative h-full w-full overflow-hidden rounded-[1.8rem] sm:rounded-[50%] felt-surface gold-ring">
            <TrickArea state={tnState} mySeat={mySeat} flashSeat={null} />
            {tnState.offlineFallback && (
              <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-crimson/20 px-3 py-1 text-[9.5px] font-bold uppercase tracking-widest text-crimson ring-1 ring-crimson/40">
                seat {tnState.offlineFallback.seatIndex} offline · auto-play countdown
              </div>
            )}
            <div className="absolute left-[82%] sm:left-[80%] top-[47%] z-20 -translate-x-1/2 -translate-y-1/2">
              <TrumpBanner state={tnState} />
            </div>

            {/* Waiting for Players overlay inside the felt */}
            {tnState.phase === "WAITING_FOR_PLAYERS" && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] rounded-[1.8rem] sm:rounded-[50%] select-none animate-riseFade">
                <div className="flex flex-col items-center text-center max-w-xs sm:max-w-sm space-y-2 sm:space-y-3">
                  <div className="flex items-center gap-2 rounded-full bg-amber-400/20 px-3 py-1 border border-amber-400/40 text-amber-300 text-xs font-black uppercase tracking-wider">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                    Waiting for Players ({seatedCount}/4)
                  </div>
                  <p className="text-[11px] sm:text-xs text-white/70">
                    Need <b className="text-white font-bold">{neededCount}</b> more player{neededCount > 1 ? "s" : ""}. Share code <span className="font-mono text-gold font-bold">{me?.roomCode}</span> or start with AI bots:
                  </p>
                  <button
                    onClick={tnFillBots}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 px-4 py-2 text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider shadow-glowGold hover:scale-105 active:scale-95 transition-all cursor-pointer ring-1 ring-white/40"
                  >
                    <span>🤖</span>
                    <span>Fill with Bots ({neededCount})</span>
                  </button>
                </div>
              </div>
            )}

            {/* Scoreboards inside the felt */}
            <div className="absolute left-[28%] top-[20%] sm:top-[22%] -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
              <PhysicalScoreBoard team="my" score={tnState.matchScore[myTeam ?? "A"]} />
            </div>
            <div className="absolute left-[68%] top-[20%] sm:top-[22%] -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
              <PhysicalScoreBoard team="opponent" score={tnState.matchScore[myTeam === "A" ? "B" : "A"]} />
            </div>
          </div>

          {/* Seats placed OUTSIDE the felt around the table rail */}
          {tnState.seats.map((s) => {
            const rel = seatRel(mySeat, s.seatIndex);
            const isMe = s.seatIndex === mySeat;
            return (
              <div
                key={s.seatIndex}
                className={`absolute ${REL_POS[rel]} z-40 pointer-events-auto`}
              >
                <SeatCard
                  seat={s}
                  isDealer={tnState.dealerSeatIndex === s.seatIndex}
                  isActing={tnState.actingSeatIndex === s.seatIndex && s.username !== null}
                  isMe={isMe}
                  myTeam={myTeam as "A" | "B" | null}
                  onFillBots={tnFillBots}
                  onRemove={() => removePlayer(s.seatIndex)}
                  isWaiting={tnState.phase === "WAITING_FOR_PLAYERS"}
                  canRemove={isHost}
                />
              </div>
            );
          })}
        </section>
      </main>

      {/* Bid + hand live in the fixed dock */}
      <footer className="fixed inset-x-0 bottom-0 z-30 space-y-2 bg-gradient-to-t from-room via-room/95 to-transparent pb-4 pt-3 w-full max-w-full pointer-events-none">
        {TN_DEBUG_UI && (
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 text-[9.5px] uppercase tracking-widest text-white/25 pointer-events-auto">
            <span>J &gt; 9 &gt; A &gt; 10 &gt; K &gt; Q &gt; 8 &gt; 7 · points J3 9·2 A·1 10·1 · last trick +1</span>
            <span>
              round {tnState.roundNumber} · tricks A{tnState.tricksWon.A}-B
              {tnState.tricksWon.B} · pts A{tnState.capturedPoints.A}-B
              {tnState.capturedPoints.B} · {status} · {serverUrl}
            </span>
          </div>
        )}
        {tnState.phase === "BIDDING" && (
          <div className="mx-auto w-full max-w-xl px-2 sm:px-0 pointer-events-auto">
            <BiddingPanel state={tnState} />
          </div>
        )}
        <div className="pointer-events-auto">
          <TurnStatus state={tnState} />
        </div>
        <div className="pointer-events-auto">
          <ActionPills state={tnState} />
        </div>
        <div className="pointer-events-auto">
          <HandFan state={tnState} />
        </div>
      </footer>

      <SingleHandPrompt state={tnState} />
      <TrumpPickerModal />
      <SeventhCardModal />
      <RoundBanner />
      <MatchOverBanner />
      {showRules && <RulesModal onClose={handleCloseRules} />}
    </div>
  );
}

export const TwentyNineView = React.memo(TwentyNineViewComponent);
