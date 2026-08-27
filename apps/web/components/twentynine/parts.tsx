"use client";

import React, { useState, useEffect } from "react";
import type { PublicTwentyNineState, TnCard, TnSeatView } from "@poker/shared-types";
import { TN_RANK_LABELS, TN_SUIT_SYMBOLS } from "@poker/shared-types";
import { PlayingCard } from "../common/PlayingCard";
import { useGame } from "../../lib/store";

export function tnTeamColor(team: "A" | "B"): string {
  return team === "A" ? "text-gold" : "text-violet-300";
}

export function tnTeamRing(team: "A" | "B"): string {
  return team === "A" ? "ring-gold/60" : "ring-violet-400/60";
}

/** Letter disc / avatar image, shared style with the poker lobby. */
function AvatarChip({ username, avatar }: { username: string | null; avatar?: number }) {
  if (avatar && username) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/avatars/avatar-${avatar}.png`}
        alt=""
        className="h-8 w-8 rounded-full object-cover ring-1 ring-white/20"
      />
    );
  }
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-black/50 text-xs font-black text-white/70 ring-1 ring-white/15">
      {(username ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Anti-clockwise seat -> viewer-relative screen position.
 * rel = (seatIndex - mySeat + 4) % 4:
 *   0 = you (bottom) · 2 = partner (top)
 *   3 = next actor (right) · 1 = previous actor (left)
 * This keeps the true anti-clockwise flow visible from the player's chair.
 */
export function seatRel(mySeat: number | null, seatIndex: number): number {
  if (mySeat === null) return seatIndex;
  return (seatIndex - mySeat + 4) % 4;
}

export function SeatCard({
  seat,
  isDealer,
  isActing,
  isMe,
  myTeam,
}: {
  seat: TnSeatView;
  isDealer: boolean;
  isActing: boolean;
  isMe: boolean;
  myTeam?: "A" | "B" | null;
}) {
  const empty = seat.username === null;
  return (
    <div
      className={`relative flex w-[9.5rem] items-center gap-2 rounded-2xl px-3 py-2.5 ring-1 backdrop-blur-sm transition-all ${
        empty ? "bg-black/25 ring-white/10 opacity-50" : "bg-black/40"
      } ${isActing ? `${tnTeamRing(seat.team)} shadow-glowGold scale-[1.03]` : "ring-white/10"} ${
        seat.status === "DISCONNECTED" ? "opacity-60 grayscale" : ""
      }`}
    >
      {isDealer && (
        <span className="absolute -left-1.5 -top-2 grid h-5 w-5 place-items-center rounded-full bg-gold text-[9px] font-black text-ink shadow-glowGold">
          D
        </span>
      )}
      {empty ? (
        <>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-black/50 text-xs font-black text-white/30 ring-1 ring-white/10">
            +
          </span>
          <div className="leading-tight">
            <p className="text-[11px] font-bold text-white/35">open seat</p>
          </div>
        </>
      ) : (
        <>
          <AvatarChip username={seat.username} avatar={seat.avatar} />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[11px] font-bold text-white/85">
              {seat.username}
              {isMe ? " (you)" : ""}
            </p>
            {seat.status === "DISCONNECTED" && (
              <p className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-crimson">offline</span>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Where a played card flies in FROM, per viewer-relative seat (CSS vars consumed by the dealIn keyframe). */
const DEAL_FROM: Record<number, { x: string; y: string }> = {
  0: { x: "0px", y: "130px" }, // you (bottom)
  1: { x: "-150px", y: "0px" }, // left
  2: { x: "0px", y: "-130px" }, // top (partner)
  3: { x: "150px", y: "0px" }, // right
};

/** Small resting rotation per seat so the trick reads as a loose, natural cross. */
const TRICK_REST_ROT: Record<number, string> = {
  0: "rotate-[-3deg]",
  1: "rotate-[6deg]",
  2: "rotate-[2deg]",
  3: "rotate-[-6deg]",
};

/** Center of the felt: current trick plays positioned by viewer-relative seat. */
export function TrickArea({
  state,
  mySeat,
  flashSeat,
}: {
  state: PublicTwentyNineState;
  mySeat: number | null;
  flashSeat: number | null;
}) {
  const { tnResolvedTrick } = useGame();
  
  // Use the temporarily held resolved trick so the sweep animation finishes before showing the new trick
  const isResolved = tnResolvedTrick !== null;
  const trickToRender = isResolved ? tnResolvedTrick.plays : state.trick;
  const winnerRel = isResolved && tnResolvedTrick.winnerSeatIndex !== undefined ? seatRel(mySeat, tnResolvedTrick.winnerSeatIndex) : null;
  
  const [formTrain, setFormTrain] = useState(false);
  useEffect(() => {
    if (isResolved) {
      const timer = setTimeout(() => setFormTrain(true), 1000); // Let the 4th card sit for 1s
      return () => clearTimeout(timer);
    } else {
      setFormTrain(false);
    }
  }, [isResolved]);

  // Calculate the layout styles for each card
  const getSlotStyle = (rel: number, playIndex: number): React.CSSProperties => {
    if (formTrain) {
      // Overlapping train line in the center
      const offsetX = (playIndex - 1.5) * 22; // 22px overlap per card
      return {
        left: `calc(50% + ${offsetX}px)`,
        top: "50%",
        transform: "translate(-50%, -50%)",
        transition: "all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)",
        zIndex: playIndex,
      };
    }
    // Normal loose diamond layout
    let base: React.CSSProperties = {};
    switch (rel) {
      case 0: base = { left: "50%", top: "72%", transform: "translate(-50%, -50%)" }; break;
      case 1: base = { left: "32%", top: "50%", transform: "translate(-50%, -50%)" }; break;
      case 2: base = { left: "50%", top: "28%", transform: "translate(-50%, -50%)" }; break;
      case 3: base = { left: "68%", top: "50%", transform: "translate(-50%, -50%)" }; break;
    }
    return { ...base, transition: "all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)", zIndex: playIndex };
  };

  const ledSuit = trickToRender[0]?.card.suit ?? null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Faint watermark of the led suit, purely decorative */}
      {ledSuit && (
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[9rem] leading-none text-white/[0.05]"
        >
          {TN_SUIT_SYMBOLS[ledSuit]}
        </span>
      )}

      {/* Sweep container: wraps all cards and sweeps them together if resolved */}
      <div
        className={`absolute inset-0 ${isResolved && winnerRel !== null ? "animate-sweepOut" : ""}`}
        style={
          isResolved && winnerRel !== null
            ? ({
                "--sweep-to-x": DEAL_FROM[winnerRel].x,
                "--sweep-to-y": DEAL_FROM[winnerRel].y,
              } as React.CSSProperties)
            : {}
        }
      >
        {[0, 1, 2, 3].map((rel) => {
          const playIndex = trickToRender.findIndex((p) => seatRel(mySeat, p.seatIndex) === rel);
          const play = trickToRender[playIndex];
          const owner = play?.seatIndex ?? null;
          return (
            <div 
              key={rel} 
              className={`absolute ${flashSeat === owner ? "animate-pulse" : ""}`}
              style={getSlotStyle(rel, playIndex !== -1 ? playIndex : rel)}
            >
              {play ? (
                <div className={`${isResolved ? "rotate-0" : TRICK_REST_ROT[rel]} transition-transform duration-300`}>
                  <div
                    key={`${play.seatIndex}:${play.card.suit}:${play.card.rank}`}
                    className="animate-dealIn drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)]"
                    style={
                      {
                        "--deal-from-x": DEAL_FROM[rel].x,
                        "--deal-from-y": DEAL_FROM[rel].y,
                      } as React.CSSProperties
                    }
                  >
                    <PlayingCard card={play.card} size="sm" />
                  </div>
                </div>
              ) : (
                <span className="block h-[3.4rem] w-0" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {trickToRender.length === 0 && state.phase === "PLAYING" && (
        <span className="absolute inset-0 grid place-items-center text-[10px] uppercase tracking-[0.3em] text-white/25">
          waiting…
        </span>
      )}
    </div>
  );
}

export function TrumpBanner({ state }: { state: PublicTwentyNineState }) {
  const mySeat = useMySeat();
  const myTeam = mySeat !== null ? (mySeat % 2 === 0 ? "A" : "B") : null;
  
  let cardContent: React.ReactNode;
  
  if (state.trumpStyle === null && state.trump.state === "NOT_SET") {
    cardContent = (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <span className="text-[8px] font-bold uppercase text-white/30">trump</span>
        <span className="text-lg text-white/20 mt-0.5">?</span>
      </div>
    );
  } else if (state.trumpStyle === "JOKER") {
    cardContent = (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#f0ebd8] rounded-lg shadow-card">
        <span className="text-2xl">🃏</span>
        <span className="text-[7px] font-black uppercase tracking-widest text-violet-600 mt-1">Joker</span>
      </div>
    );
  } else if (state.trump.state === "HIDDEN" || (state.trumpStyle === "SEVENTH_CARD" && state.trump.state !== "REVEALED")) {
    cardContent = (
      <div className="relative flex h-full w-full items-center justify-center rounded-lg overflow-hidden">
        <PlayingCard faceDown size="sm" className="absolute inset-0" />
        <div className="absolute inset-0 bg-black/40 grid place-items-center">
          <span className="text-base shadow-black drop-shadow-md">🔒</span>
        </div>
      </div>
    );
  } else if (state.trump.state === "REVEALED") {
    if (state.trumpStyle === "SEVENTH_CARD" && 'card' in state.trump && state.trump.card) {
      cardContent = <PlayingCard card={state.trump.card} size="sm" />;
    } else {
      // Suit only
      const color = (state.trump.suit === "HEARTS" || state.trump.suit === "DIAMONDS") ? "text-crimson" : "text-ink";
      cardContent = (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#f0ebd8] rounded-lg shadow-card relative">
          <span className={`text-[7px] font-black uppercase tracking-widest ${color} absolute top-1.5 opacity-60`}>Trump</span>
          <span className={`text-4xl leading-none ${color} mt-2`}>
            {TN_SUIT_SYMBOLS[state.trump.suit]}
          </span>
        </div>
      );
    }
  } else {
    cardContent = <div className="h-full w-full bg-black/40 rounded-lg" />;
  }

  return (
    <div className="flex flex-col items-center gap-1.5 transition-all">
      <div className="relative w-11 h-16 rounded-lg ring-1 ring-white/10 bg-black/20 shadow-xl overflow-hidden">
        {cardContent}
      </div>
      {state.marriageDeclaredBy && (
        <span className={`text-[8px] font-bold uppercase tracking-widest bg-black/50 px-2 py-0.5 rounded-full ring-1 ring-white/10 ${tnTeamColor(state.marriageDeclaredBy)}`}>
          marriage {myTeam ? (state.marriageDeclaredBy === myTeam ? "(us)" : "(them)") : ""}
        </span>
      )}
    </div>
  );
}

export function RankHint() {
  return (
    <p className="text-center text-[9.5px] uppercase tracking-[0.14em] text-white/30">
      J &gt; 9 &gt; A &gt; 10 &gt; K &gt; Q &gt; 8 &gt; 7 · points J3 9·2 A·1 10·1 · last trick +1
    </p>
  );
}

export function cardLabel(c: TnCard): string {
  return `${TN_RANK_LABELS[c.rank]}${TN_SUIT_SYMBOLS[c.suit]}`;
}

export function useMySeat(): number | null {
  const { me } = useGame();
  return me?.seatIndex ?? null;
}
