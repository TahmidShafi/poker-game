"use client";

import React, { useMemo } from "react";
import type { PublicGameState, Seat } from "@poker/shared-types";
import { PlayingCard } from "../common/PlayingCard";
import { PlayerBadge } from "./PlayerBadge";
import { useGame } from "../../lib/store";

export interface DesktopSeatPlacement {
  seatIndex: number;
  compactedRelIndex: number;
  angle: number; // in radians
  left: string;
  top: string;
  pos: { left: string; top: string };
}

function cleanPercent(val: number): string {
  const rounded = Math.round(val * 10000) / 10000;
  return `${rounded}%`;
}

/**
 * Computes desktop ellipse seat placements with active seat compaction.
 *
 * Rather than dividing the ellipse by a fixed 10 slots (which clusters partial tables),
 * we sort occupied seats in clockwise order, anchor hero at compactedRelIndex 0 (angle 0),
 * and distribute the seats evenly using:
 *   angle = (compactedRelIndex / activeCount) * 2π
 */
export function computeDesktopSeatPlacements(
  seats: { seatIndex: number; username?: string | null; playerId?: string | null }[],
  mySeat: number | null
): {
  placements: Map<number, DesktopSeatPlacement>;
  occupiedCount: number;
} {
  const occupied = seats
    .filter((s) => Boolean(s.username || s.playerId))
    .sort((a, b) => a.seatIndex - b.seatIndex);

  const activeCount = occupied.length;
  const placements = new Map<number, DesktopSeatPlacement>();

  if (activeCount === 0) {
    return { placements, occupiedCount: 0 };
  }

  const heroIdx = mySeat !== null ? occupied.findIndex((s) => s.seatIndex === mySeat) : -1;
  const effectiveHeroIdx = heroIdx >= 0 ? heroIdx : 0;

  for (let k = 0; k < activeCount; k++) {
    const seat = occupied[k]!;
    const compactedRelIndex =
      heroIdx >= 0
        ? (k - effectiveHeroIdx + activeCount) % activeCount
        : k;
    const angle = (compactedRelIndex / activeCount) * 2 * Math.PI;
    const left = cleanPercent(50 - Math.sin(angle) * 42);
    const top = cleanPercent(50 + Math.cos(angle) * 38);

    placements.set(seat.seatIndex, {
      seatIndex: seat.seatIndex,
      compactedRelIndex,
      angle,
      left,
      top,
      pos: { left, top },
    });
  }

  return { placements, occupiedCount: activeCount };
}

/** Interpolates a point from the ellipse toward the center (50%, 50%) */
export function towardCenter(pos: { left: string; top: string }, factor = 0.65) {
  const parsePct = (s: string) => parseFloat(s) || 50;
  const cx = 50;
  const cy = 50;
  const px = parsePct(pos.left);
  const py = parsePct(pos.top);
  const ix = px + (cx - px) * factor;
  const iy = py + (cy - py) * factor;
  return { left: `${ix.toFixed(2)}%`, top: `${iy.toFixed(2)}%` };
}

/** Center table decorative chips */
function ChipsArt() {
  return (
    <div className="relative flex items-center justify-center pointer-events-none select-none">
      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 shadow-chip ring-2 ring-amber-300/40" />
      <div className="-ml-4 h-9 w-9 rounded-full bg-gradient-to-br from-red-500 to-red-700 shadow-chip ring-2 ring-red-300/40" />
      <div className="-ml-4 h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 shadow-chip ring-2 ring-blue-300/40" />
      <div className="-ml-4 h-9 w-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-chip ring-2 ring-emerald-300/40" />
    </div>
  );
}

/** Side pot breakdown list */
function PotPlaques({ state }: { state: PublicGameState }) {
  if (state.pots.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
      {state.pots.map((p, i) => (
        <span
          key={i}
          className="glass flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white/80 shadow"
        >
          <span className="text-white/40">{i === 0 ? "Main" : `Side ${i}`}:</span>
          <span className="text-gold">{p.amount.toLocaleString()}</span>
        </span>
      ))}
    </div>
  );
}

export function TableOval({
  state,
  mySeat,
}: {
  state: PublicGameState;
  mySeat: number | null;
}) {
  const { myCards, me, removePlayer } = useGame();
  const turnTimeMs = (me?.config?.turnTimeSeconds ?? 60) * 1000;
  const isHost = mySeat !== null && state.hostSeatIndex === mySeat;
  const isLobby = state.handNumber === 0;

  const potTotal =
    state.pots.reduce((s, p) => s + p.amount, 0) ||
    state.seats.reduce((s, x) => s + x.totalInvestedThisHand, 0);
  const acting = state.actingSeatIndex;

  const hero = mySeat !== null ? state.seats[mySeat] : null;
  const heroCards =
    hero?.holeCards && hero.holeCards.length === 2
      ? hero.holeCards
      : myCards && myCards.length === 2
      ? myCards
      : null;

  const heroBet = hero?.currentBetThisRound ?? 0;

  // Compute compacted seat placements
  const { placements } = useMemo(
    () => computeDesktopSeatPlacements(state.seats, mySeat),
    [state.seats, mySeat]
  );

  // Compute dealer button position
  const dealerPos = useMemo(() => {
    if (state.dealerSeatIndex === null) return null;
    const dealerPlacement = placements.get(state.dealerSeatIndex);
    if (!dealerPlacement) return null;
    return towardCenter(dealerPlacement.pos, 0.58);
  }, [state.dealerSeatIndex, placements]);

  const badge = (seatIndex: number, compact = false) => {
    const seat = state.seats[seatIndex];
    if (!seat || !seat.username) return null;
    return (
      <PlayerBadge
        key={seatIndex}
        seat={seat}
        isActing={acting === seatIndex}
        isMe={seatIndex === mySeat}
        compact={compact}
        turnDeadline={state.turnDeadline}
        totalMs={turnTimeMs}
        canRemove={isHost && isLobby}
        onRemove={() => removePlayer(seatIndex)}
      />
    );
  };

  /** Hero's personalized plate + face-up hole cards overlapping the rail. */
  const HeroPlate = () => {
    if (!hero || !hero.username || mySeat === null) return null;
    return (
      <div className="relative flex flex-col items-center gap-1">
        {/* Floating bet chip for Hero on the felt */}
        {heroBet > 0 && (
          <div className="absolute -top-7 left-1/2 z-30 -translate-x-1/2 flex items-center gap-1 rounded-full bg-black/75 px-2.5 py-0.5 ring-1 ring-white/15 shadow-lg animate-popChip">
            <span className="h-2 w-2 rounded-full bg-gold" />
            <span className="text-xs font-bold text-gold tabnum">{heroBet.toLocaleString()}</span>
          </div>
        )}

        {/* Hero Hole Cards */}
        {heroCards ? (
          <div className="mb-[-14px] flex gap-1.5 z-10">
            {heroCards.map((c, i) => (
              <PlayingCard key={i} card={c} size="md" animate="deal" delay={i * 110} />
            ))}
          </div>
        ) : hero.status === "ACTIVE" ? (
          <div className="mb-[-14px] flex gap-1.5 z-10">
            <PlayingCard faceDown size="md" />
            <PlayingCard faceDown size="md" />
          </div>
        ) : null}

        <PlayerBadge
          seat={{ ...hero, currentBetThisRound: 0 }}
          isActing={acting === mySeat}
          isMe
          turnDeadline={state.turnDeadline}
          totalMs={turnTimeMs}
        />
      </div>
    );
  };

  return (
    <div className="relative mx-auto aspect-[16/9] w-full max-w-[880px]">
      {/* Leather rail + felt surface */}
      <div className="rail-surface absolute inset-[4%] rounded-[50%] p-3 dt:p-4">
        <div className="felt-surface gold-ring relative h-full w-full overflow-hidden rounded-[50%]">
          {/* Watermark */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="select-none text-[clamp(14px,2.4vw,28px)] font-black uppercase tracking-[0.35em] text-white/[0.06]">
              Texas Hold&apos;em
            </span>
          </div>

          {/* Center stack: pot plaque -> chips -> community cards -> pot breakdown */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            {potTotal > 0 ? (
              <div className="glass rounded-xl px-4 py-1 text-center animate-riseFade shadow-panel">
                <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/55">
                  Pot
                </div>
                <div className="text-xl font-black leading-none text-gold tabnum">
                  {potTotal.toLocaleString()}
                </div>
              </div>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/25">
                Blinds {state.smallBlind}/{state.bigBlind}
              </span>
            )}

            {potTotal > 0 && <ChipsArt />}

            <div className="flex min-h-[84px] items-center justify-center gap-1.5">
              {state.communityCards.length === 0 ? (
                <div className="flex gap-1.5 opacity-25">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <PlayingCard key={i} faceDown size="lg" />
                  ))}
                </div>
              ) : (
                state.communityCards.map((c, i) => (
                  <PlayingCard key={i} card={c} size="lg" animate="deal" delay={i * 90} />
                ))
              )}
            </div>

            <PotPlaques state={state} />
          </div>
        </div>
      </div>

      {/* Dealer button positioned relative to the dealer seat on the felt */}
      {dealerPos && (
        <div
          className="absolute z-20 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-violet-600 text-[10px] font-black text-white shadow-lg ring-2 ring-white/30 transition-all duration-300"
          style={{ left: dealerPos.left, top: dealerPos.top }}
          title="Dealer"
        >
          D
        </div>
      )}

      {/* Opponents seated evenly and symmetrically around the ellipse */}
      {Array.from(placements.values()).map((placement) => {
        if (placement.seatIndex === mySeat) return null; // Hero rendered via HeroPlate
        return (
          <div
            key={placement.seatIndex}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-300"
            style={{ left: placement.left, top: placement.top }}
          >
            {badge(placement.seatIndex)}
          </div>
        );
      })}

      {/* Hero plate at the bottom edge of the table */}
      {mySeat !== null && (
        <div className="absolute bottom-[2%] left-1/2 z-20 -translate-x-1/2 translate-y-[10%]">
          <HeroPlate />
        </div>
      )}
    </div>
  );
}
