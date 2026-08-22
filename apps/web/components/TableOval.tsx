"use client";

import React from "react";
import type { PublicGameState } from "@poker/shared-types";
import { PlayingCard } from "./PlayingCard";
import { PlayerBadge } from "./PlayerBadge";
import { ChipStack } from "./ChipStack";

/** Ellipse positions (percent) for seats 0..9 starting at the bottom center. */
function seatPos(i: number): { left: string; top: string } {
  const angle = (-90 + i * 36) * (Math.PI / 180);
  const rx = 42;
  const ry = 38;
  return {
    left: `${50 + Math.sin(angle) * rx}%`,
    top: `${50 + Math.cos(angle) * ry}%`,
  };
}

export function TableOval({
  state,
  mySeat,
  turnDeadline,
  turnTimeMs,
}: {
  state: PublicGameState;
  mySeat: number | null;
  turnDeadline: number | null;
  turnTimeMs: number;
}) {
  const potTotal = state.pots.reduce((s, p) => s + p.amount, 0) ||
    state.seats.reduce((s, x) => s + x.totalInvestedThisHand, 0);
  const acting = state.actingSeatIndex;

  const badge = (seatIndex: number, compact = false) => {
    const seat = state.seats[seatIndex];
    if (!seat || !seat.username) return null;
    return (
      <PlayerBadge
        key={seatIndex}
        seat={seat}
        isActing={acting === seatIndex}
        turnDeadline={turnDeadline}
        turnTimeMs={turnTimeMs}
        compact={compact}
      />
    );
  };

  const hero = mySeat !== null ? state.seats[mySeat] : null;

  return (
    <>
      {/* Desktop / tablet: full oval */}
      <div className="relative mx-auto hidden aspect-[16/9] w-full max-w-4xl md:block">
        <div className="absolute inset-[8%] rounded-[50%] felt-surface shadow-2xl border-[10px] border-rail ring-1 ring-black/40">
          {/* community cards */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="flex items-center gap-1.5">
              {state.communityCards.length === 0 ? (
                <span className="text-white/30 text-xs tracking-widest uppercase">
                  waiting for deal
                </span>
              ) : (
                state.communityCards.map((c, i) => (
                  <PlayingCard key={i} card={c} size="md" animate="flip" delay={i * 120} />
                ))
              )}
            </div>
            {potTotal > 0 && (
              <div className="glass rounded-full px-3 py-1 animate-riseFade">
                <ChipStack amount={potTotal} />
              </div>
            )}
          </div>
        </div>
        {state.seats.map((seat) => {
          if (!seat.username) return null;
          const pos = seatPos(seat.seatIndex);
          return (
            <div
              key={seat.seatIndex}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: pos.left, top: pos.top }}
            >
              {badge(seat.seatIndex)}
            </div>
          );
        })}
      </div>

      {/* Mobile: stacked composition */}
      <div className="flex flex-col gap-4 md:hidden">
        <div className="grid grid-cols-3 gap-2 place-items-center">
          {state.seats.filter((s) => s.username && s.seatIndex !== mySeat).slice(0, 6).map((s) => (
            <div key={s.seatIndex}>{badge(s.seatIndex, true)}</div>
          ))}
        </div>
        <div className="felt-surface rounded-3xl border-4 border-rail py-5 shadow-xl">
          <div className="flex flex-col items-center gap-2.5">
            <div className="flex items-center gap-1.5 min-h-[64px] justify-center">
              {state.communityCards.map((c, i) => (
                <PlayingCard key={i} card={c} size="sm" animate="flip" delay={i * 120} />
              ))}
            </div>
            {potTotal > 0 && (
              <div className="glass rounded-full px-3 py-1">
                <ChipStack amount={potTotal} />
              </div>
            )}
          </div>
        </div>
        {hero && hero.username && (
          <div className="flex justify-center">{badge(mySeat!)}</div>
        )}
      </div>
    </>
  );
}
