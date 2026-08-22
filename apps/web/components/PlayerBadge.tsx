"use client";

import React from "react";
import type { Seat } from "@poker/shared-types";
import { ChipStack } from "./ChipStack";
import { TimerRing, useCountdown } from "./TimerRing";

const STATUS_LABEL: Partial<Record<Seat["status"], string>> = {
  FOLDED: "folded",
  DISCONNECTED: "offline",
  BUSTED: "busted",
  SITTING_OUT: "waiting",
  ALL_IN: "all-in",
};

export function PlayerBadge({
  seat,
  isActing,
  turnDeadline,
  turnTimeMs,
  compact = false,
}: {
  seat: Seat;
  isActing: boolean;
  turnDeadline: number | null;
  turnTimeMs: number;
  compact?: boolean;
}) {
  const remaining = useCountdown(isActing ? turnDeadline : null, isActing);
  const initial = (seat.username ?? "?").charAt(0).toUpperCase();

  return (
    <div
      className={`flex flex-col items-center gap-1 ${seat.status === "FOLDED" ? "opacity-45" : ""} ${
        seat.status === "BUSTED" ? "opacity-70 grayscale" : ""
      }`}
    >
      <div className="relative">
        <TimerRing remainingMs={remaining} totalMs={turnTimeMs}>
          <div
            className={`grid place-items-center rounded-full font-bold text-lg glass ${
              compact ? "h-10 w-10" : "h-14 w-14"
            } ${isActing ? "ring-2 ring-gold shadow-glowGold" : "ring-1 ring-white/10"}`}
          >
            <span className={seat.status === "DISCONNECTED" ? "opacity-40" : ""}>{initial}</span>
          </div>
        </TimerRing>

        {seat.isDealer && (
          <span className="absolute -top-1.5 -right-1.5 h-5 w-5 grid place-items-center rounded-full bg-gold text-[9px] font-black text-ink shadow">
            D
          </span>
        )}
        {(seat.isSmallBlind || seat.isBigBlind) && (
          <span
            className="absolute -bottom-1 -left-1 h-5 px-1 grid place-items-center rounded-md bg-white/90 text-[8px] font-black text-ink"
            title={seat.isSmallBlind ? "small blind" : "big blind"}
          >
            {seat.isSmallBlind ? "SB" : "BB"}
          </span>
        )}
      </div>

      <div className="text-center leading-tight">
        <div className="text-xs font-semibold max-w-[92px] truncate">{seat.username ?? "—"}</div>
        <div className="text-[11px] text-gold tabnum font-semibold">
          {seat.coins.toLocaleString()}
          {seat.debtTo && Object.values(seat.debtTo).some((v) => v > 0) && (
            <span className="ml-1 text-crimson" title="owes chips">
              owes
            </span>
          )}
        </div>
        {STATUS_LABEL[seat.status] && (
          <div className="text-[9px] uppercase tracking-wider text-white/40">
            {STATUS_LABEL[seat.status]}
          </div>
        )}
        {seat.preAction && (
          <div className="text-[9px] text-sky-300/80">
            will {seat.preAction.toLowerCase()}
          </div>
        )}
      </div>

      {seat.currentBetThisRound > 0 && (
        <div className="-mt-0.5">
          <ChipStack amount={seat.currentBetThisRound} />
        </div>
      )}
    </div>
  );
}
