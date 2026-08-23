"use client";

import React from "react";
import type { PublicGameState } from "@poker/shared-types";
import { PlayingCard } from "./PlayingCard";
import { PlayerBadge } from "./PlayerBadge";
import { ChipStack } from "./ChipStack";

/** Ellipse positions (percent) for seats 0..9 starting at the bottom center. */
function seatPos(i: number): { left: string; top: string } {
  const angle = (-90 + i * 36) * (Math.PI / 180);
  return {
    left: `${50 + Math.sin(angle) * 42}%`,
    top: `${50 + Math.cos(angle) * 38}%`,
  };
}

function towardCenter(pos: { left: string; top: string }, f: number) {
  return {
    left: `${parseFloat(pos.left) + (50 - parseFloat(pos.left)) * f}%`,
    top: `${parseFloat(pos.top) + (50 - parseFloat(pos.top)) * f}%`,
  };
}

/** Decorative CSS chip cluster under the pot plaque. */
function ChipsArt() {
  const chips = [
    { c: "#C0392B", x: 0 },
    { c: "#16A34A", x: 18 },
    { c: "#2563EB", x: 36 },
    { c: "#111827", x: 54 },
    { c: "#F0C75E", x: 27, y: -6 },
  ];
  return (
    <div className="relative h-7 w-24">
      {chips.map((ch, i) => (
        <span
          key={i}
          className="absolute bottom-0 rounded-full"
          style={{
            left: ch.x,
            bottom: ch.y ?? 0,
            width: 26,
            height: 26,
            background: `repeating-conic-gradient(${ch.c} 0deg 25deg, #ffffff22 25deg 40deg)`,
            boxShadow: "0 2px 4px rgba(0,0,0,.5), inset 0 0 0 3px rgba(255,255,255,.15)",
            border: "2px solid rgba(0,0,0,.35)",
          }}
        >
          <span
            className="absolute inset-[5px] rounded-full"
            style={{ background: ch.c, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.25)" }}
          />
        </span>
      ))}
    </div>
  );
}

function PotPlaques({ state }: { state: PublicGameState }) {
  const pots = state.pots.filter((p) => p.amount > 0);
  if (pots.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {pots.map((p, i) => (
        <span
          key={i}
          className="rounded-md bg-black/45 px-3 py-1 text-[11px] font-bold tracking-wide text-emerald-200/90 ring-1 ring-white/10 tabnum"
        >
          {pots.length === 1 ? "MAIN POT" : i === 0 ? "MAIN POT" : `SIDE POT ${i}`}:{" "}
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
  const potTotal =
    state.pots.reduce((s, p) => s + p.amount, 0) ||
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
        isMe={seatIndex === mySeat}
        compact={compact}
      />
    );
  };

  const hero = mySeat !== null ? state.seats[mySeat] : null;

  /** Hero's personalized plate + face-up hole cards overlapping the rail. */
  const HeroPlate = () => {
    if (!hero || !hero.username || mySeat === null) return null;
    return (
      <div className="flex flex-col items-center gap-1">
        {hero.holeCards && hero.holeCards.length === 2 && (
          <div className="mb-[-14px] flex gap-1 z-10">
            {hero.holeCards.map((c, i) => (
              <PlayingCard key={i} card={c} size="md" animate="deal" delay={i * 110} />
            ))}
          </div>
        )}
        <PlayerBadge
          seat={{ ...hero, currentBetThisRound: 0 }}
          isActing={acting === mySeat}
          isMe
        />
      </div>
    );
  };

  return (
    <>
      {/* ===================== Desktop / tablet oval ===================== */}
      <div className="relative mx-auto hidden aspect-[16/9] w-full max-w-[860px] dt:block">
        {/* Leather rail + felt */}
        <div className="rail-surface absolute inset-[5%] rounded-[50%] p-3 dt:p-4">
          <div className="felt-surface gold-ring relative h-full w-full overflow-hidden rounded-[50%]">
            {/* Watermark */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="select-none text-[clamp(14px,2.4vw,26px)] font-black uppercase tracking-[0.35em] text-white/[0.05]">
                Texas Hold&apos;em
              </span>
            </div>

            {/* Center stack: pot plaque → chips → cards → pot breakdown */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
              {potTotal > 0 && (
                <div className="glass rounded-lg px-4 py-1 text-center animate-riseFade">
                  <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/55">
                    Pot
                  </div>
                  <div className="text-lg font-black leading-none text-gold tabnum">
                    {potTotal.toLocaleString()}
                  </div>
                </div>
              )}
              {potTotal > 0 && <ChipsArt />}
              <div className="flex min-h-[84px] items-center gap-1.5">
                {state.communityCards.length === 0 ? (
                  <span className="text-white/25 text-[11px] tracking-[0.3em] uppercase">
                    Waiting for deal
                  </span>
                ) : (
                  state.communityCards.map((c, i) => (
                    <PlayingCard key={i} card={c} size="lg" animate="flip" delay={i * 120} />
                  ))
                )}
              </div>
              <PotPlaques state={state} />
            </div>
          </div>
        </div>

        {/* Dealer button ON the felt */}
        {state.dealerSeatIndex !== null && (
          (() => {
            const pos = towardCenter(seatPos(state.dealerSeatIndex), 0.62);
            return (
              <div
                className="absolute z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-violet-600 text-[10px] font-black text-white shadow-lg ring-2 ring-white/30"
                style={{ left: pos.left, top: pos.top }}
                title="Dealer"
              >
                D
              </div>
            );
          })()
        )}

        {/* Seats around the ellipse */}
        {state.seats.map((seat) => {
          if (!seat.username || seat.seatIndex === mySeat) return null;
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

        {/* Hero plate at the bottom edge of the table */}
        {mySeat !== null && (
          <div className="absolute bottom-[1%] left-1/2 z-20 -translate-x-1/2 translate-y-[12%]">
            <HeroPlate />
          </div>
        )}
      </div>

      {/* ===================== Mobile stacked ===================== */}
      <div className="flex flex-col gap-4 dt:hidden">
        <div className="grid grid-cols-3 gap-2 place-items-center">
          {state.seats
            .filter((s) => s.username && s.seatIndex !== mySeat)
            .slice(0, 6)
            .map((s) => (
              <div key={s.seatIndex}>{badge(s.seatIndex, true)}</div>
            ))}
        </div>

        <div className="rail-surface rounded-[28px] p-2.5">
          <div className="felt-surface gold-ring relative overflow-hidden rounded-3xl py-5">
            <div className="flex flex-col items-center gap-2.5">
              {potTotal > 0 && (
                <div className="glass rounded-lg px-3 py-0.5 text-center">
                  <div className="text-[8px] font-bold uppercase tracking-[0.25em] text-white/55">Pot</div>
                  <div className="text-base font-black leading-tight text-gold tabnum">
                    {potTotal.toLocaleString()}
                  </div>
                </div>
              )}
              {potTotal > 0 && <ChipsArt />}
              <div className="flex min-h-[64px] items-center justify-center gap-1">
                {state.communityCards.length === 0 ? (
                  <span className="text-white/25 text-[10px] tracking-[0.25em] uppercase">Waiting</span>
                ) : (
                  state.communityCards.map((c, i) => (
                    <PlayingCard key={i} card={c} size="sm" animate="flip" delay={i * 120} />
                  ))
                )}
              </div>
              <PotPlaques state={state} />
            </div>
          </div>
        </div>

        {hero && hero.username && (
          <div className="flex flex-col items-center gap-2">
            {hero.holeCards && hero.holeCards.length === 2 ? (
              <div className="flex gap-1.5">
                {hero.holeCards.map((c, i) => (
                  <PlayingCard key={i} card={c} size="md" animate="deal" delay={i * 110} />
                ))}
              </div>
            ) : (
              <div className="flex gap-1.5">
                <PlayingCard faceDown size="md" />
                <PlayingCard faceDown size="md" />
              </div>
            )}
            {badge(mySeat!)}
          </div>
        )}
      </div>
    </>
  );
}
