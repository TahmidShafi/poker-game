"use client";

import React from "react";
import type { PublicGameState, Seat } from "@poker/shared-types";
import { PlayingCard } from "../common/PlayingCard";
import { CompactSeat } from "./CompactSeat";
import { useGame } from "../../lib/store";
import { useMediaQuery } from "../../lib/useMediaQuery";

/**
 * Dedicated mobile table composition — fixed-viewport friendly flex skeleton
 * (top row / side columns / felt / corner row / my strip).
 */

type SlotId = "TL" | "TM" | "TR" | "SLU" | "SLD" | "SRU" | "SRD" | "CL" | "CR";

interface Plan {
  top: SlotId[];
  left: SlotId[];
  right: SlotId[];
  corners: SlotId[];
}

/** Predefined seat maps per opponent count (zoned mode, max 9 opponents). */
const PLANS: Record<number, Plan> = {
  1: { top: ["TM"], left: [], right: [], corners: [] },
  2: { top: ["TL", "TR"], left: [], right: [], corners: [] },
  3: { top: ["TL", "TM", "TR"], left: [], right: [], corners: [] },
  4: { top: ["TL", "TR"], left: ["SLU"], right: ["SRU"], corners: [] },
  5: { top: ["TL", "TM", "TR"], left: ["SLU"], right: ["SRU"], corners: [] },
  6: { top: ["TL", "TR"], left: ["SLU", "SLD"], right: ["SRU", "SRD"], corners: [] },
  7: { top: ["TL", "TM", "TR"], left: ["SLU", "SLD"], right: ["SRU", "SRD"], corners: [] },
  8: { top: ["TL", "TR"], left: ["SLU", "SLD"], right: ["SRU", "SRD"], corners: ["CL", "CR"] },
  9: {
    top: ["TL", "TM", "TR"],
    left: ["SLU", "SLD"],
    right: ["SRU", "SRD"],
    corners: ["CL", "CR"],
  },
};

function Felt({
  state,
  potTotal,
  landscape,
  narrow,
}: {
  state: PublicGameState;
  potTotal: number;
  landscape: boolean;
  narrow: boolean;
}) {
  const cardSize = narrow ? ("xs" as const) : ("sm" as const);
  const pots = state.pots.filter((p) => p.amount > 0);
  const sideTotal = pots.slice(1).reduce((s, p) => s + p.amount, 0);
  const cards = state.communityCards;

  return (
    <div
      className={`rail-surface rounded-[24px] p-[6px] ${
        landscape ? "w-[min(94%,600px)]" : "w-full max-w-[350px]"
      }`}
    >
      <div
        className={`felt-surface gold-ring rounded-[18px] ${
          landscape
            ? "flex flex-row items-center justify-center gap-3 px-3 py-2"
            : "flex flex-col items-center gap-1.5 px-2 py-2"
        }`}
      >
        {/* Pot (or stakes while between hands) */}
        {potTotal > 0 ? (
          <div className="glass flex items-baseline gap-1.5 rounded-lg px-2.5 py-0.5 animate-riseFade shadow">
            <span className="text-[8px] font-black uppercase tracking-[0.22em] text-white/50">
              Pot
            </span>
            <span className="text-sm font-black leading-tight text-gold tabnum">
              {potTotal.toLocaleString()}
            </span>
            {sideTotal > 0 && (
              <span className="text-[9px] font-semibold text-emerald-200/80 tabnum">
                +{sideTotal.toLocaleString()} side
              </span>
            )}
          </div>
        ) : (
          <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/25">
            Blinds {state.smallBlind}/{state.bigBlind}
          </span>
        )}

        {/* Community cards */}
        <div className={`flex items-center ${narrow ? "gap-0.5" : "gap-1"}`}>
          {cards.map((c, i) => (
            <PlayingCard key={i} card={c} size={cardSize} animate="flip" delay={i * 120} />
          ))}
          {cards.length === 0 &&
            Array.from({ length: landscape ? 0 : 5 }).map((_, i) => (
              <PlayingCard key={i} faceDown size={cardSize} className="opacity-30" />
            ))}
        </div>

        {!landscape && cards.length > 0 && cards.length < 5 && (
          <div className="text-[8px] uppercase tracking-[0.3em] text-white/35 font-semibold">
            {cards.length === 3 ? "turn next" : "river next"}
          </div>
        )}
      </div>
    </div>
  );
}

export function MobileTable({
  state,
  mySeat,
}: {
  state: PublicGameState;
  mySeat: number | null;
}) {
  const { me, myCards } = useGame();
  const landscape = useMediaQuery("(orientation: landscape)");
  const narrow = useMediaQuery("(max-width: 430px)");
  const totalMs = (me?.config?.turnTimeSeconds ?? 60) * 1000;

  const potTotal =
    state.pots.reduce((s, p) => s + p.amount, 0) ||
    state.seats.reduce((s, x) => s + x.totalInvestedThisHand, 0);
  const acting = state.actingSeatIndex;

  const opponents = state.seats.filter((s) => s.username && s.seatIndex !== mySeat);
  const hero = mySeat !== null ? state.seats[mySeat] : null;

  // Landscape with a full table: single strip mode
  const stripMode = landscape && opponents.length >= 8;

  const seatUnit = (seat: Seat) => (
    <CompactSeat
      key={seat.seatIndex}
      seat={seat}
      isActing={acting === seat.seatIndex}
      isMe={false}
      turnDeadline={state.turnDeadline}
      totalMs={totalMs}
    />
  );

  let plan: Plan = PLANS[1];
  if (!stripMode) {
    plan = PLANS[Math.min(Math.max(opponents.length, 1), 9)];
  }
  const bySlot = new Map<SlotId, Seat>();
  if (!stripMode) {
    const order: SlotId[] = [...plan.top, ...plan.left, ...plan.right, ...plan.corners];
    opponents.forEach((s, i) => bySlot.set(order[i], s));
  }
  const take = (ids: SlotId[]) =>
    ids
      .map((id) => bySlot.get(id))
      .filter((s): s is Seat => !!s)
      .map(seatUnit);

  const heroBet = hero?.currentBetThisRound ?? 0;
  const heroCards =
    hero?.holeCards && hero.holeCards.length === 2
      ? hero.holeCards
      : myCards && myCards.length === 2
      ? myCards
      : null;

  const cardSize = narrow || landscape ? ("sm" as const) : ("md" as const);
  const landScale = "origin-top scale-[0.85]";

  return (
    <div className="absolute inset-0 flex select-none flex-col overflow-hidden">
      {/* ================= TOP OPPONENTS ================= */}
      {stripMode ? (
        <div className="shrink-0 origin-top scale-[0.92]">
          <div className="flex items-start justify-center gap-0.5">{opponents.map(seatUnit)}</div>
        </div>
      ) : (
        plan.top.length > 0 && (
          <div
            className={`flex shrink-0 items-start justify-between px-2 pt-1 ${landscape ? landScale : ""}`}
          >
            {take(plan.top)}
          </div>
        )
      )}

      {/* ================= MIDDLE: sides + felt ================= */}
      <div className="flex min-h-0 flex-1 items-stretch">
        {!stripMode && plan.left.length > 0 && (
          <div
            className={`flex w-[78px] shrink-0 flex-col justify-evenly py-1 ${landscape ? "origin-center -my-2 scale-[0.85]" : ""}`}
          >
            {take(plan.left)}
          </div>
        )}

        <div className="flex min-w-0 flex-1 items-center justify-center px-0.5">
          <Felt state={state} potTotal={potTotal} landscape={landscape} narrow={narrow} />
        </div>

        {!stripMode && plan.right.length > 0 && (
          <div
            className={`flex w-[78px] shrink-0 flex-col justify-evenly py-1 ${landscape ? "origin-center -my-2 scale-[0.85]" : ""}`}
          >
            {take(plan.right)}
          </div>
        )}
      </div>

      {/* ================= CORNER SEATS ================= */}
      {!stripMode && plan.corners.length > 0 && (
        <div className="flex shrink-0 items-end justify-between px-[12%]">{take(plan.corners)}</div>
      )}

      {/* ================= MY STRIP: seat + hole cards ================= */}
      <div
        className={`relative z-10 flex shrink-0 items-center justify-center gap-2 px-2 pb-0.5 ${
          landscape ? "origin-bottom scale-[0.88]" : ""
        }`}
      >
        {hero && hero.username ? (
          <>
            <CompactSeat
              seat={{ ...hero, currentBetThisRound: 0 }}
              isActing={acting === mySeat}
              isMe
              turnDeadline={state.turnDeadline}
              totalMs={totalMs}
            />
            <div className="relative">
              {heroBet > 0 && (
                <span className="absolute -top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-black/75 px-2 py-px text-[10px] font-bold text-gold tabnum ring-1 ring-white/15 shadow animate-popChip">
                  <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                  {heroBet.toLocaleString()}
                </span>
              )}
              <div className="flex gap-1.5">
                {heroCards ? (
                  heroCards.map((c, i) => (
                    <PlayingCard key={i} card={c} size={cardSize} animate="deal" delay={i * 110} />
                  ))
                ) : (
                  <>
                    <PlayingCard faceDown size={cardSize} />
                    <PlayingCard faceDown size={cardSize} />
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="py-3 text-[11px] uppercase tracking-[0.25em] text-white/30">
            spectating
          </div>
        )}
      </div>
    </div>
  );
}
