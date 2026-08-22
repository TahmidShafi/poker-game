"use client";

import React from "react";
import type { Seat } from "@poker/shared-types";
import { ChipStack } from "./ChipStack";

const STATUS_LABEL: Partial<Record<Seat["status"], string>> = {
  FOLDED: "folded",
  DISCONNECTED: "offline",
  BUSTED: "busted",
  SITTING_OUT: "waiting",
};

const SEAT_HUES = [200, 260, 150, 20, 320, 55, 100, 175, 285, 0];

export function PlayerBadge({
  seat,
  isActing,
  isMe,
  compact = false,
}: {
  seat: Seat;
  isActing: boolean;
  isMe: boolean;
  compact?: boolean;
}) {
  const initial = (seat.username ?? "?").charAt(0).toUpperCase();
  const hue = SEAT_HUES[seat.seatIndex % SEAT_HUES.length] ?? 200;
  const avatarBg = `linear-gradient(160deg, hsl(${hue} 45% 38%), hsl(${hue} 55% 22%))`;

  return (
    <div
      className={`flex flex-col items-center gap-1 transition-opacity duration-200 ${
        seat.status === "FOLDED" ? "opacity-45" : ""
      } ${seat.status === "BUSTED" ? "opacity-60 grayscale" : ""}`}
    >
      <div className="relative">
        {/* Avatar disc */}
        <div
          className={`grid place-items-center rounded-full font-bold text-lg ring-2 transition-shadow ${
            compact ? "h-11 w-11" : "h-14 w-14"
          } ${
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

        {/* Seat number */}
        {!compact && (
          <span className="absolute -bottom-1 -right-1 h-5 w-5 grid place-items-center rounded-full bg-panel2 text-[9px] font-black text-white/70 ring-1 ring-white/15">
            {seat.seatIndex + 1}
          </span>
        )}

        {/* SB / BB chip-style tags */}
        {(seat.isSmallBlind || seat.isBigBlind) && (
          <span
            className={`absolute -top-1.5 -left-1.5 h-5 min-w-5 px-1 grid place-items-center rounded-md text-[8px] font-black shadow ${
              seat.isSmallBlind ? "bg-sky-500 text-white" : "bg-amber-500 text-ink"
            }`}
            title={seat.isSmallBlind ? "small blind" : "big blind"}
          >
            {seat.isSmallBlind ? "SB" : "BB"}
          </span>
        )}
      </div>

      {/* Name plate */}
      <div className="w-[104px] rounded-lg bg-panel/90 px-2 py-1 text-center ring-1 line">
        <div className="truncate text-xs font-bold leading-tight">{seat.username ?? "—"}</div>
        <div className="text-[12px] font-bold leading-tight text-gold tabnum">
          {seat.coins.toLocaleString()}
        </div>
      </div>

      {/* Status row */}
      {seat.status === "ALL_IN" ? (
        <span className="-mt-0.5 rounded bg-crimson px-1.5 py-px text-[8px] font-black uppercase tracking-wide text-white">
          All-In
        </span>
      ) : (
        STATUS_LABEL[seat.status] && (
          <div className="-mt-0.5 text-[9px] uppercase tracking-wider text-white/40">
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
        <div className="-mt-0.5">
          <ChipStack amount={seat.currentBetThisRound} />
        </div>
      )}
    </div>
  );
}
