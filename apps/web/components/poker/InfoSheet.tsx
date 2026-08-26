"use client";

import React, { useState } from "react";
import type { PublicGameState } from "@poker/shared-types";
import { useGame } from "../../lib/store";
import { GameInfoPanel, LoanPanel, StatsPanel } from "./LeftSidebar";
import { PlayersListPanel, RecentHandsPanel, StreetTimelinePanel } from "./RightSidebar";

type Tab = "players" | "stats" | "history" | "info";

const TABS: { id: Tab; label: string }[] = [
  { id: "players", label: "Players" },
  { id: "stats", label: "Stats" },
  { id: "history", label: "History" },
  { id: "info", label: "Game Info" },
];

/**
 * Mobile bottom sheet holding every secondary surface (roster, stats,
 * history, loans, game info, hand-rankings shortcut). The gameplay screen
 * itself stays fixed and uncluttered; only this sheet scrolls internally.
 */
export function InfoSheet({
  open,
  state,
  onClose,
  onOpenRankings,
  onOpenRepay,
}: {
  open: boolean;
  state: PublicGameState;
  onClose: () => void;
  onOpenRankings: () => void;
  onOpenRepay: () => void;
}) {
  const [tab, setTab] = useState<Tab>("players");
  const { status, serverUrl } = useGame();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="safe-b relative flex max-h-[82dvh] w-full flex-col rounded-t-3xl bg-room shadow-panel ring-1 line animate-riseFade sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Game information"
      >
        {/* Handle */}
        <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
          <span className="mx-auto h-1 w-10 rounded-full bg-white/15" />
          <button
            className="absolute right-3 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/5 text-sm text-white/60 active:bg-white/15"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2 pt-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold ring-1 transition-colors ${
                tab === t.id
                  ? "bg-gold/20 text-gold ring-gold/40"
                  : "bg-white/[0.04] text-white/55 ring-white/10 active:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content (internal scroll only) */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4">
          {tab === "players" && <PlayersListPanel state={state} />}
          {tab === "stats" && (
            <>
              <StatsPanel />
              <LoanPanel onOpenRepay={() => { onOpenRepay(); onClose(); }} />
            </>
          )}
          {tab === "history" && (
            <>
              <StreetTimelinePanel state={state} />
              <RecentHandsPanel />
            </>
          )}
          {tab === "info" && (
            <>
              <GameInfoPanel />
              <button
                onClick={() => { onOpenRankings(); onClose(); }}
                className="w-full rounded-2xl bg-panel p-4 text-left ring-1 line shadow-panel active:bg-white/5"
              >
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">
                  Help
                </div>
                <div className="mt-1 text-sm font-bold text-gold">🏆 Hand rankings</div>
              </button>
              <div className="rounded-2xl bg-panel p-4 ring-1 line">
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-white/40">
                  Connection
                </div>
                <div className="flex items-center gap-2 text-xs text-white/60">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status === "online"
                        ? "bg-emerald-400"
                        : status === "connecting"
                        ? "bg-amber-400"
                        : "bg-crimson"
                    }`}
                  />
                  {status} · {serverUrl}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
