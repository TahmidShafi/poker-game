"use client";

import React, { useState } from "react";
import type { PublicGameState } from "@poker/shared-types";
import { useGame } from "../../lib/store";
import { PlayingCard } from "../common/PlayingCard";

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-panel p-4 ring-1 line shadow-panel">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

const STREET_LABELS = ["Pre-flop", "Flop", "Turn", "River", "Showdown"] as const;

/** Street-by-street elapsed times for the current hand. */
export function StreetTimelinePanel({ state }: { state: PublicGameState }) {
  const { timeline } = useGame();
  const times = [timeline.preflop, timeline.flop, timeline.turn, timeline.river, timeline.showdown];
  const currentStreetIdx = (() => {
    if (state.phase === "SHOWDOWN" || state.phase === "PAYOUT") return 4;
    const n = state.communityCards.length;
    if (state.phase === "PRE_FLOP") return 0;
    if (n >= 5) return 3;
    if (n >= 4) return 2;
    if (n >= 3) return 1;
    return 0;
  })();

  return (
    <Panel title="Hand History">
      <ul className="space-y-1">
        {STREET_LABELS.map((label, i) => {
          const t = times[i];
          const active = i === currentStreetIdx && t !== null;
          return (
            <li
              key={label}
              className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${
                active ? "bg-accent/25 font-bold text-violet-100" : "text-white/60"
              }`}
            >
              <span>{label}</span>
              <span className={`tabnum ${active ? "" : "text-white/35"}`}>
                {t === null ? "—" : `${t}s`}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Recent finished hands + view-all modal. */
export function RecentHandsPanel() {
  const { recentHands } = useGame();
  const [showAll, setShowAll] = useState(false);

  return (
    <>
      <Panel
        title="Recent Hands"
        action={
          recentHands.length > 0 ? (
            <button
              className="rounded-lg bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/55 ring-1 line hover:text-gold"
              onClick={() => setShowAll(true)}
            >
              View All Hands
            </button>
          ) : null
        }
      >
        {recentHands.length === 0 ? (
          <div className="text-xs text-white/35">No hands finished yet this sitting.</div>
        ) : (
          <ul className="space-y-2">
            {recentHands.slice(0, 5).map((h) => (
              <li key={h.handNumber} className="flex items-center justify-between gap-2">
                <div className="flex -space-x-2">
                  {(h.communityCards.length
                    ? h.communityCards
                    : ([null, null, null, null, null] as const)
                  ).map((c, i) => (
                    <PlayingCard key={i} card={c ?? undefined} faceDown={!c} size="xs" />
                  ))}
                </div>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                    h.outcome === "Won"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-crimson/20 text-red-300"
                  }`}
                >
                  {h.outcome}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* View-all modal */}
      {showAll && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowAll(false)}
        >
          <div
            className="glass max-h-[80vh] w-full max-w-md overflow-y-auto rounded-3xl p-5 animate-riseFade"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-black uppercase tracking-widest text-gold">All Hands</h3>
              <button className="text-white/50 hover:text-white" onClick={() => setShowAll(false)}>
                ✕
              </button>
            </div>
            <ul className="space-y-2.5">
              {recentHands.map((h) => (
                <li
                  key={h.handNumber}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-2.5"
                >
                  <span className="text-[10px] font-bold text-white/40">#{h.handNumber}</span>
                  <div className="flex flex-1 -space-x-2">
                    {h.communityCards.map((c, i) => (
                      <PlayingCard key={i} card={c} size="xs" />
                    ))}
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                      h.outcome === "Won"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-crimson/20 text-red-300"
                    }`}
                  >
                    {h.outcome}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/** Occupied-seat roster with blinds / all-in tags. */
export function PlayersListPanel({ state }: { state: PublicGameState }) {
  const { me } = useGame();
  const occupied = state.seats.filter((s) => s.username);

  return (
    <Panel title={`Players (${occupied.length}/10)`}>
      <ul className="space-y-1">
        {occupied.map((s) => (
          <li
            key={s.seatIndex}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs ${
              s.seatIndex === me?.seatIndex ? "bg-gold/10 ring-1 ring-gold/25" : ""
            }`}
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-panel2 text-[9px] font-bold text-white/50 ring-1 line">
              {s.seatIndex + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {s.username}
              {s.seatIndex === me?.seatIndex && (
                <span className="ml-1 text-[9px] text-gold">(you)</span>
              )}
            </span>
            {s.status === "ALL_IN" && (
              <span className="text-[9px] font-black uppercase text-crimson">All-In</span>
            )}
            {s.isDealer && (
              <span className="grid h-4 w-4 place-items-center rounded-full bg-violet-600 text-[8px] font-black text-white">
                D
              </span>
            )}
            {s.isSmallBlind && (
              <span className="rounded bg-sky-500 px-1 text-[8px] font-black text-white">SB</span>
            )}
            {s.isBigBlind && (
              <span className="rounded bg-amber-500 px-1 text-[8px] font-black text-ink">BB</span>
            )}
            <span className="font-bold text-gold tabnum">{s.coins.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3 border-t border-white/5 pt-2 text-[9px] text-white/35">
        <span className="flex items-center gap-1">
          <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-violet-600 text-[7px] font-black text-white">
            D
          </span>
          Dealer
        </span>
        <span className="flex items-center gap-1">
          <span className="rounded bg-sky-500 px-0.5 text-[7px] font-black text-white">SB</span>
          Small Blind
        </span>
        <span className="flex items-center gap-1">
          <span className="rounded bg-amber-500 px-0.5 text-[7px] font-black text-ink">BB</span>
          Big Blind
        </span>
      </div>
    </Panel>
  );
}

export function RightSidebar({ state }: { state: PublicGameState }) {
  return (
    <div className="space-y-3">
      <StreetTimelinePanel state={state} />
      <RecentHandsPanel />
      <PlayersListPanel state={state} />
    </div>
  );
}
