"use client";

import React from "react";
import type { Seat } from "@poker/shared-types";
import { ChipStack } from "./ChipStack";
import { SeatAvatar } from "../common/SeatAvatar";
import { TimerRing, useCountdown, getTimerUrgency, getTimerIcon } from "./TimerRing";

const STATUS_LABEL: Partial<Record<Seat["status"], string>> = {
  DISCONNECTED: "offline",
  BUSTED: "busted",
  SITTING_OUT: "waiting",
};

export function PlayerBadge({
  seat,
  isActing,
  isMe,
  compact = false,
  turnDeadline = null,
  totalMs = 60000,
  canRemove = false,
  onRemove,
}: {
  seat: Seat;
  isActing: boolean;
  isMe: boolean;
  compact?: boolean;
  turnDeadline?: number | null;
  totalMs?: number;
  canRemove?: boolean;
  onRemove?: () => void;
}) {
  const remaining = useCountdown(isActing ? turnDeadline : null, isActing);
  const secs = Math.ceil(remaining / 1000);
  const urgency = getTimerUrgency(remaining);
  const icon = getTimerIcon(urgency);

  const avatar = (
    <div
      className={`relative grid place-items-center rounded-full ring-2 transition-shadow ${
        compact ? "h-11 w-11" : "h-14 w-14"
      } ${
        isMe && isActing
          ? "ring-emerald-400 shadow-glowGreen"
          : isActing
          ? "ring-gold shadow-glowGold"
          : "ring-white/10"
      }`}
    >
      {canRemove && onRemove && !isMe && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-1 -left-1 z-30 grid h-4 w-4 sm:h-5 sm:w-5 place-items-center rounded-full bg-crimson hover:bg-red-500 text-[8px] sm:text-[9px] font-black text-white shadow-md ring-1 ring-white/40 cursor-pointer transition-transform hover:scale-110"
          title="Remove player"
        >
          ✕
        </button>
      )}
      <SeatAvatar username={seat.username} avatar={seat.avatar} dimmed={seat.status === "DISCONNECTED"} />
    </div>
  );

  return (
    <div
      className={`flex flex-col items-center gap-1 transition-opacity duration-200 ${
        seat.status === "FOLDED" ? "opacity-45" : ""
      } ${seat.status === "BUSTED" ? "opacity-60 grayscale" : ""}`}
    >
      <div className="relative">
        {/* Avatar disc with optional countdown timer ring */}
        {isActing && remaining > 0 ? (
          <TimerRing remainingMs={remaining} totalMs={totalMs}>
            {avatar}
          </TimerRing>
        ) : (
          avatar
        )}

        {/* Always-present turn seconds with non-color cues */}
        {isActing && remaining > 0 ? (
          <span
            className={`absolute -bottom-1 -right-1.5 z-20 flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9.5px] font-black tabnum shadow ring-1 ${
              urgency === "urgent"
                ? "bg-crimson text-white ring-white/40 animate-pulse"
                : urgency === "warning"
                ? "bg-amber-500 text-ink ring-amber-300 font-extrabold ring-offset-1 ring-offset-black"
                : "bg-black/90 text-gold ring-white/20"
            }`}
            title={`Time left: ${secs}s`}
          >
            <span className="text-[8px] font-black opacity-90">{icon}</span>
            {secs}s
          </span>
        ) : !compact ? (
          /* Seat number when not acting */
          <span className="absolute -bottom-1 -right-1 h-5 w-5 grid place-items-center rounded-full bg-panel2 text-[9px] font-black text-white/70 ring-1 ring-white/15 shadow">
            {seat.seatIndex + 1}
          </span>
        ) : null}

        {/* SB / BB chip-style tags */}
        {(seat.isSmallBlind || seat.isBigBlind) && (
          <span
            className={`absolute -top-1.5 -left-1.5 h-5 min-w-5 px-1 grid place-items-center rounded-md text-[8px] font-black shadow ring-1 ring-white/20 ${
              seat.isSmallBlind ? "bg-sky-500 text-white" : "bg-amber-500 text-ink"
            }`}
            title={seat.isSmallBlind ? "small blind" : "big blind"}
          >
            {seat.isSmallBlind ? "SB" : "BB"}
          </span>
        )}
      </div>

      {/* Name plate */}
      <div className="w-[104px] rounded-lg bg-panel/95 px-2 py-1 text-center ring-1 line shadow">
        <div className="truncate text-xs font-bold leading-tight">{seat.username ?? "—"}</div>
        <div className="text-[12px] font-bold leading-tight text-gold tabnum">
          {seat.coins.toLocaleString()}
        </div>
      </div>

      {/* Status row with accessible icons and non-color cues */}
      {seat.status === "DISCONNECTED" ? (
        <span className="-mt-0.5 flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/40 animate-pulse shadow">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
          Reconnecting...
        </span>
      ) : seat.status === "ALL_IN" ? (
        <span className="-mt-0.5 flex items-center gap-1 rounded bg-crimson px-1.5 py-px text-[8.5px] font-black uppercase tracking-wide text-white shadow ring-1 ring-white/30">
          <span className="text-[9px] font-black" aria-hidden="true">★</span>
          All-In
        </span>
      ) : seat.status === "FOLDED" ? (
        <span className="-mt-0.5 flex items-center gap-1 rounded bg-white/10 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-white/50 ring-1 ring-white/15">
          <span className="text-[9px] font-black" aria-hidden="true">✕</span>
          Folded
        </span>
      ) : (
        STATUS_LABEL[seat.status] && (
          <div className="-mt-0.5 text-[9px] uppercase tracking-wider text-white/40 font-semibold">
            {STATUS_LABEL[seat.status]}
          </div>
        )
      )}

      {seat.preAction && (
        <div className="text-[9px] text-sky-300/80">will {seat.preAction.toLowerCase()}</div>
      )}

      {seat.debtTo && Object.values(seat.debtTo).some((v) => v > 0) && (
        <div className="text-[9px] font-semibold text-fuchsia-300/90" title="owes chips">
          owes
        </div>
      )}

      {seat.currentBetThisRound > 0 && (
        <div className="-mt-0.5 animate-popChip">
          <ChipStack amount={seat.currentBetThisRound} />
        </div>
      )}
    </div>
  );
}
