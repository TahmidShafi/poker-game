"use client";

import React, { useEffect, useState } from "react";
import { useGame } from "../lib/store";
import { JoinScreen } from "../components/JoinScreen";
import { TableOval } from "../components/TableOval";
import { ActionBar } from "../components/ActionBar";
import { HandRankingsModal } from "../components/HandRankingsModal";
import { WinnerBanner } from "../components/WinnerBanner";
import { LoanRequestModal, RepayDialog } from "../components/LoanModals";
import { PlayingCard } from "../components/PlayingCard";

export default function HomePage() {
  const {
    status, me, state, myCards, showdown, clearShowdown,
    toast, incomingLoan, leaveRoom, serverUrl,
  } = useGame();
  const [showHelp, setShowHelp] = useState(false);
  const [showRepay, setShowRepay] = useState(false);
  const [copied, setCopied] = useState(false);

  // Deep-link ?room=CODE prefill even when a session exists? Only when no me.
  useEffect(() => {
    if (me) {
      const url = new URL(window.location.href);
      if (url.searchParams.get("room")) {
        url.searchParams.delete("room");
        window.history.replaceState({}, "", url.pathname);
      }
    }
  }, [me]);

  if (!me) return <JoinScreen />;

  const mySeat = me.seatIndex;
  const myDebt = state?.seats[mySeat]?.debtTo ?? {};
  const owes = Object.values(myDebt).some((v) => v > 0);
  const turnTimeMs = (me.config?.turnTimeSeconds ?? 20) * 1000;
  const statusColor =
    status === "online" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-crimson";

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(me.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-3 px-3 pb-4 pt-3">
      {/* Header */}
      <header className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusColor}`} title={status} />
          <span className="font-black tracking-tight">
            Hold<span className="text-gold">'em</span> Club
          </span>
          <button
            onClick={copyCode}
            className="ml-1 rounded-lg bg-white/8 px-2.5 py-1 font-mono text-xs font-bold tracking-[0.25em] text-gold ring-1 ring-gold/30 hover:bg-gold/15"
            title="Copy room code"
          >
            {me.roomCode}
            <span className="ml-1.5 tracking-normal text-white/40">{copied ? "✓" : "⧉"}</span>
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {state && (
            <span className="rounded-lg bg-white/5 px-2 py-1 text-white/60">
              blinds <b className="text-gold tabnum">{state.smallBlind}/{state.bigBlind}</b>
            </span>
          )}
          {owes && (
            <button
              onClick={() => setShowRepay(true)}
              className="rounded-lg bg-crimson/20 px-2 py-1 font-semibold text-red-200 ring-1 ring-crimson/30 hover:bg-crimson/30"
            >
              repay loan
            </button>
          )}
          <button
            onClick={() => setShowHelp(true)}
            className="rounded-lg bg-white/5 px-2.5 py-1 font-semibold text-white/70 hover:bg-white/10"
          >
            Hand rankings
          </button>
          <button
            onClick={leaveRoom}
            className="rounded-lg bg-white/5 px-2.5 py-1 font-semibold text-white/50 hover:bg-crimson/20 hover:text-red-200"
          >
            leave
          </button>
        </div>
      </header>

      {status === "offline" && (
        <div className="rounded-xl bg-amber-500/15 px-3 py-2 text-center text-xs text-amber-200 ring-1 ring-amber-400/30">
          connection lost — reconnecting to {serverUrl}…
        </div>
      )}

      {/* Table */}
      {state ? (
        <>
          <TableOval
            state={state}
            mySeat={mySeat}
            turnDeadline={state.turnDeadline}
            turnTimeMs={turnTimeMs}
          />

          {/* My hole cards */}
          <div className="flex justify-center gap-1.5">
            {myCards ? (
              myCards.map((c, i) => <PlayingCard key={i} card={c} size="md" animate="deal" delay={i * 90} />)
            ) : state.seats[mySeat]?.holeCards ? (
              state.seats[mySeat]!.holeCards!.map((c, i) => (
                <PlayingCard key={i} card={c} size="md" />
              ))
            ) : (
              <>
                <PlayingCard faceDown size="md" />
                <PlayingCard faceDown size="md" />
              </>
            )}
          </div>

          <ActionBar state={state} mySeat={mySeat} turnDeadline={state.turnDeadline} />

          {showdown && showdown.length > 0 && (
            <WinnerBanner results={showdown} onClose={clearShowdown} />
          )}
          {incomingLoan && state && (
            <LoanRequestModal request={incomingLoan} state={state} />
          )}
          {showRepay && state && <RepayDialog state={state} mySeat={mySeat} onClose={() => setShowRepay(false)} />}
        </>
      ) : (
        <div className="grid flex-1 place-items-center text-sm text-white/40">
          joining table…
        </div>
      )}

      {showHelp && <HandRankingsModal onClose={() => setShowHelp(false)} />}

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
          <div
            className={`glass rounded-xl px-4 py-2.5 text-sm font-semibold animate-riseFade ${
              toast.kind === "error" ? "text-red-200 ring-1 ring-crimson/40" : "text-emerald-200 ring-1 ring-emerald-400/40"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </main>
  );
}
