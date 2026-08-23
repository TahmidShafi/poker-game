"use client";

import React from "react";
import type { Seat } from "@poker/shared-types";
import { TimerRing, useCountdown } from "./TimerRing";

const SEAT_HUES = [200, 260, 150, 20, 320, 55, 100, 175, 285, 0];

const STATUS_MICRO: Partial<Record<Seat["status"], string>> = {
  FOLDED: "folded",
  DISCONNECTED: "offline",
  BUSTED: "busted",
  SITTING_OUT: "waiting",
};

/**
 * Compact mobile seat unit: 40px avatar, short name, chip count,
 * tiny D/SB/BB tag, micro status label, tiny bet pill.
 * Total height ≈ 84px — designed for the fixed-viewport mobile stage.
 */
export function CompactSeat({
  seat,
  isActing,
  isMe,
  turnDeadline,
  totalMs,
}: {
  seat: Seat;
  isActing: boolean;
  isMe: boolean;
  turnDeadline: number | null;
  totalMs: number;
}) {
  const remaining = useCountdown(isActing ? turnDeadline : null, isActing);
  const initial = (seat.username ?? "?").charAt(0).toUpperCase();
  const hue = SEAT_HUES[seat.seatIndex % SEAT_HUES.length] ?? 200;
  const avatarBg = `linear-gradient(160deg, hsl(${hue} 45% 38%), hsl(${hue} 55% 22%))`;
  const secs = Math.ceil(remaining / 1000);

  const avatar = (
    <div
      className={`grid h-10 w-10 place-items-center rounded-full text-base font-bold ring-2 transition-shadow ${
        isMe && isActing
          ? "ring-emerald-400 shadow-glowGreen"
          : isActing
          ? "ring-gold shadow-glowGold"
          : "ring-white/10"
      }`}
      style={{ background: avatarBg }}
    >
      <span className={seat.status === "DISCONNECTED" ? "opacity-40" : ""}>{initial}</span>
    </div>
  );

  return (
    <div
      className={`flex w-[76px] select-none flex-col items-center gap-0.5 ${
        seat.status === "FOLDED" ? "opacity-45" : ""
      } ${seat.status === "BUSTED" ? "opacity-60 grayscale" : ""}`}
    >
      <div className="relative">
        {isActing && remaining > 0 ? (
          <TimerRing remainingMs={remaining} totalMs={totalMs}>
            {avatar}
          </TimerRing>
        ) : (
          avatar
        )}

        {/* Position / blind tags */}
        {seat.isDealer && (
          <span
            className="absolute -left-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-md bg-violet-600 px-1 text-[8px] font-black text-white shadow ring-1 ring-white/30"
            title="Dealer"
          >
            D
          </span>
        )}
        {!seat.isDealer && (seat.isSmallBlind || seat.isBigBlind) && (
          <span
            className={`absolute -left-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-md px-1 text-[8px] font-black shadow ${
              seat.isSmallBlind ? "bg-sky-500 text-white" : "bg-amber-500 text-ink"
            }`}
            title={seat.isSmallBlind ? "small blind" : "big blind"}
          >
            {seat.isSmallBlind ? "SB" : "BB"}
          </span>
        )}

        {/* Compact turn seconds on the active seat */}
        {isActing && remaining > 0 && (
          <span
            className={`absolute -bottom-1 -right-1 rounded-md px-1 text-[9px] font-black tabnum ring-1 ${
              remaining < 5000
                ? "bg-crimson text-white ring-white/30"
                : "bg-black/75 text-gold ring-white/15"
            }`}
          >
            {secs}s
          </span>
        )}
      </div>

      {/* Name plate */}
      <div className="w-full rounded-md bg-panel/90 px-1 py-px text-center ring-1 line">
        <div className="truncate text-[10px] font-bold leading-tight">{seat.username ?? "—"}</div>
        <div className="text-[11px] font-bold leading-tight text-gold tabnum">
          {seat.coins.toLocaleString()}
        </div>
      </div>

      {/* Micro status */}
      {seat.status === "ALL_IN" ? (
        <span className="rounded bg-crimson px-1 text-[8px] font-black uppercase tracking-wide text-white">
          All-In
        </span>
      ) : (
        STATUS_MICRO[seat.status] && (
          <div className="text-[8px] uppercase tracking-wider text-white/40">
            {STATUS_MICRO[seat.status]}
          </div>
        )
      )}
      {seat.preAction && (
        <div className="text-[8px] text-sky-300/80">will {seat.preAction.toLowerCase()}</div>
      )}
      {seat.debtTo && Object.values(seat.debtTo).some((v) => v > 0) && (
        <div className="text-[8px] font-semibold text-fuchsia-300/90">owes</div>
      )}

      {/* Current bet this round */}
      {seat.currentBetThisRound > 0 && (
        <div className="mt-px flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-px ring-1 ring-white/10">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <span className="text-[9px] font-bold text-gold tabnum">
            {seat.currentBetThisRound.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}
