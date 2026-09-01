"use client";

import React from "react";
import type { Seat } from "@poker/shared-types";
import { TimerRing, useCountdown, getTimerUrgency, getTimerIcon } from "./TimerRing";
import { SeatAvatar } from "../common/SeatAvatar";

const STATUS_MICRO: Partial<Record<Seat["status"], string>> = {
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
  canRemove,
  onRemove,
}: {
  seat: Seat;
  isActing: boolean;
  isMe: boolean;
  turnDeadline: number | null;
  totalMs: number;
  canRemove?: boolean;
  onRemove?: () => void;
}) {
  const remaining = useCountdown(isActing ? turnDeadline : null, isActing);
  const secs = Math.ceil(remaining / 1000);
  const urgency = getTimerUrgency(remaining);
  const icon = getTimerIcon(urgency);

  const avatar = (
    <div
      className={`grid h-10 w-10 place-items-center overflow-hidden rounded-full text-base font-bold ring-2 transition-shadow ${
        isMe && isActing
          ? "ring-emerald-400 shadow-glowGreen"
          : isActing
          ? "ring-gold shadow-glowGold"
          : "ring-white/10"
      }`}
    >
      <SeatAvatar username={seat.username} avatar={seat.avatar} dimmed={seat.status === "DISCONNECTED"} />
    </div>
  );

  return (
    <div
      className={`flex w-[76px] select-none flex-col items-center gap-0.5 ${
        seat.status === "FOLDED" ? "opacity-45" : ""
      } ${seat.status === "BUSTED" ? "opacity-60 grayscale" : ""}`}
    >
      <div className="relative">
        {canRemove && onRemove && !isMe && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -top-1.5 -right-1.5 z-50 grid h-5.5 w-5.5 place-items-center rounded-full bg-crimson hover:bg-red-500 active:bg-red-700 text-[10px] font-black text-white shadow-[0_2px_8px_rgba(0,0,0,0.6)] ring-2 ring-white cursor-pointer transition-transform hover:scale-125 active:scale-90 pointer-events-auto"
            title="Remove player"
          >
            ✕
          </button>
        )}
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

        {/* Always-present turn seconds on the active seat with non-color cues */}
        {isActing && remaining > 0 && (
          <span
            className={`absolute -bottom-1 -right-1 z-20 flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[8.5px] font-black tabnum shadow ring-1 ${
              urgency === "urgent"
                ? "bg-crimson text-white ring-white/40 animate-pulse"
                : urgency === "warning"
                ? "bg-amber-500 text-ink ring-amber-300 font-extrabold ring-offset-1 ring-offset-black"
                : "bg-black/90 text-gold ring-white/20"
            }`}
            title={`Time left: ${secs}s`}
          >
            <span className="text-[7.5px] font-black opacity-90">{icon}</span>
            {secs}s
          </span>
        )}
      </div>

      {/* Name plate */}
      <div className="w-full rounded-md bg-panel/95 px-1 py-px text-center ring-1 line shadow">
        <div className="truncate text-[10px] font-bold leading-tight">{seat.username ?? "—"}</div>
        <div className="text-[11px] font-bold leading-tight text-gold tabnum">
          {seat.coins.toLocaleString()}
        </div>
      </div>

      {/* Micro status with redundant non-color cues */}
      {seat.status === "DISCONNECTED" ? (
        <span className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-px text-[7.5px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/40 animate-pulse">
          <span className="h-1 w-1 rounded-full bg-amber-400" />
          Reconnecting...
        </span>
      ) : seat.status === "ALL_IN" ? (
        <span className="flex items-center gap-0.5 rounded bg-crimson px-1 py-px text-[8px] font-black uppercase tracking-wide text-white shadow ring-1 ring-white/30">
          <span className="text-[7.5px] font-black" aria-hidden="true">★</span>
          All-In
        </span>
      ) : seat.status === "FOLDED" ? (
        <span className="flex items-center gap-0.5 rounded bg-white/10 px-1 py-px text-[7.5px] font-bold uppercase tracking-wide text-white/50 ring-1 ring-white/15">
          <span className="text-[8px] font-black" aria-hidden="true">✕</span>
          Folded
        </span>
      ) : (
        STATUS_MICRO[seat.status] && (
          <div className="text-[8px] uppercase tracking-wider text-white/40 font-semibold">
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
        <div className="mt-px flex items-center gap-0.5 rounded-full bg-black/75 px-1.5 py-px ring-1 ring-white/15 shadow animate-popChip">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <span className="text-[9px] font-bold text-gold tabnum">
            {seat.currentBetThisRound.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}
