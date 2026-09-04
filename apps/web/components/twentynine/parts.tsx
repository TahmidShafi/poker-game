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
const AvatarChip = React.memo(function AvatarChip({ username, avatar }: { username: string | null; avatar?: number }) {
  const sizeClass = "h-9 w-9 sm:h-12 sm:w-12";
  if (avatar && username) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/avatars/avatar-${avatar}.png`}
        alt=""
        className={`${sizeClass} rounded-full object-cover`}
      />
    );
  }
  return (
    <span className={`grid ${sizeClass} place-items-center rounded-full bg-slate-900 text-xs sm:text-sm font-black text-white/85`}>
      {(username ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
});

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

function SeatCardComponent({
  seat,
  isDealer,
  isActing,
  isMe,
  myTeam,
  onFillBots,
  onRemove,
  isWaiting,
  canRemove,
}: {
  seat: TnSeatView;
  isDealer: boolean;
  isActing: boolean;
  isMe: boolean;
  myTeam?: "A" | "B" | null;
  onFillBots?: () => void;
  onRemove?: () => void;
  isWaiting?: boolean;
  canRemove?: boolean;
}) {
  const empty = seat.username === null;
  const isTeammate = myTeam && seat.team === myTeam && !isMe;
  const isBot = !!seat.isBot || (seat.username?.startsWith("Bot ") ?? false);

  const teamRing = seat.team === "A" 
    ? "ring-2 ring-amber-400/80 shadow-[0_0_12px_rgba(251,191,36,0.35)]" 
    : "ring-2 ring-violet-400/80 shadow-[0_0_12px_rgba(167,139,250,0.35)]";

  return (
    <div className="flex flex-col items-center select-none transition-all">
      {/* Circular Avatar Container */}
      <div
        className={`relative grid place-items-center rounded-full p-0.5 sm:p-1 transition-all ${
          empty
            ? "h-10 w-10 sm:h-13 sm:w-13 bg-black/30 border border-dashed border-white/20 opacity-40"
            : "bg-slate-950/90 backdrop-blur-md shadow-xl"
        } ${!empty ? teamRing : ""} ${
          isActing
            ? "ring-[3px] ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.75)] scale-110 z-20"
            : "hover:scale-105 z-10"
        } ${seat.status === "DISCONNECTED" ? "opacity-60 grayscale" : ""}`}
      >
        {/* Host Remove Player Button */}
        {canRemove && onRemove && !empty && !isMe && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -top-1.5 -left-1.5 z-50 grid h-5.5 w-5.5 sm:h-6 sm:w-6 place-items-center rounded-full bg-crimson hover:bg-red-500 active:bg-red-700 text-[10px] sm:text-xs font-black text-white shadow-[0_2px_8px_rgba(0,0,0,0.6)] ring-2 ring-white cursor-pointer transition-transform hover:scale-125 active:scale-90 pointer-events-auto"
            title={isWaiting ? "Remove player" : "Remove & replace with Bot"}
          >
            ✕
          </button>
        )}

        {/* Dealer chip */}
        {isDealer && (
          <span className="absolute -top-1 -right-1 z-30 grid h-4 w-4 sm:h-5 sm:w-5 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-[8px] sm:text-[9px] font-black text-slate-950 shadow-md ring-1 ring-white/50">
            D
          </span>
        )}

        {empty ? (
          <button
            type="button"
            onClick={isWaiting ? onFillBots : undefined}
            className={`text-xs font-black text-white/40 ${
              isWaiting ? "hover:text-amber-300 hover:scale-110 cursor-pointer transition-transform" : ""
            }`}
            title={isWaiting ? "Click to add bot" : undefined}
          >
            +
          </button>
        ) : (
          <div className="relative rounded-full overflow-hidden">
            <AvatarChip username={seat.username} avatar={seat.avatar} />
            {isActing && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Floating Name Tag Pill */}
      {!empty && (
        <div className="mt-1 flex flex-col items-center">
          <div
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 backdrop-blur-md border shadow-md max-w-[5.2rem] sm:max-w-[7.2rem] truncate ${
              isActing
                ? "bg-amber-500/25 border-amber-400/70 text-amber-300 ring-1 ring-amber-400/40"
                : isMe
                ? "bg-white/20 border-white/20 text-white font-black"
                : isTeammate
                ? "bg-amber-400/15 border-amber-400/30 text-amber-200 font-bold"
                : "bg-black/80 border-white/10 text-white/90 font-medium"
            }`}
          >
            <p className="truncate text-[8.5px] sm:text-[10px] text-center w-full flex items-center justify-center gap-0.5">
              {isBot && <span className="text-[8px] sm:text-[9px]">🤖</span>}
              <span className="truncate">{isMe ? "YOU" : isTeammate ? "PARTNER" : seat.username}</span>
            </p>
          </div>
          {seat.status === "DISCONNECTED" && (
            <span className="text-[7.5px] font-black uppercase text-crimson mt-0.5">offline</span>
          )}
          {isActing && (
            <span className="text-[7.5px] sm:text-[8px] font-black uppercase tracking-wider text-amber-300 animate-pulse mt-0.5">
              Thinking
            </span>
          )}
        </div>
      )}
      {empty && (
        <button
          type="button"
          onClick={isWaiting ? onFillBots : undefined}
          className={`mt-1 text-[8px] sm:text-[9px] font-bold tracking-wider uppercase transition-all ${
            isWaiting
              ? "text-amber-300 hover:text-amber-200 cursor-pointer bg-amber-400/15 hover:bg-amber-400/25 px-1.5 py-0.5 rounded-full ring-1 ring-amber-400/30"
              : "text-white/30"
          }`}
        >
          {isWaiting ? "+ Bot" : "Open"}
        </button>
      )}
    </div>
  );
}

export const SeatCard = React.memo(SeatCardComponent);

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

function TrickAreaComponent({
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
        className={`absolute inset-0 ${isResolved && winnerRel !== null ? "animate-sweepOut transform-gpu will-change-transform" : ""}`}
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
                    className="animate-dealIn drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)] transform-gpu will-change-transform"
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

export const TrickArea = React.memo(TrickAreaComponent);

function TrumpBannerComponent({ state }: { state: PublicTwentyNineState }) {
  const mySeat = useMySeat();
  const myTeam = mySeat !== null ? (mySeat % 2 === 0 ? "A" : "B") : null;
  const { tnBidderPrivate } = useGame();
  const isBidder = mySeat !== null && state.bidderSeatIndex === mySeat;
  
  let cardContent: React.ReactNode;

  if (state.trump.state === "NOT_SET") {
    cardContent = (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <span className="text-[8px] font-bold uppercase text-white/30">trump</span>
        <span className="text-lg text-white/20 mt-0.5">?</span>
      </div>
    );
  } else if (state.trump.state === "HIDDEN") {
    cardContent = (
      <div
        className="relative flex h-full w-full items-center justify-center rounded-lg overflow-hidden bg-slate-950 shadow-card"
        title={isBidder ? "Trump is secret & locked until revealed" : "Trump is secret & locked"}
      >
        <PlayingCard faceDown size="sm" className="absolute inset-0" />
        <div className="absolute inset-0 bg-black/45 backdrop-blur-[0.5px] grid place-items-center">
          <div className="flex flex-col items-center">
            <span className="text-base shadow-black drop-shadow-md">🔒</span>
            <span className="text-[6.5px] font-black uppercase tracking-wider text-amber-300/90 mt-0.5">
              Locked
            </span>
          </div>
        </div>
      </div>
    );
  } else if (state.trump.state === "JOKER_MODE") {
    cardContent = (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#f0ebd8] rounded-lg shadow-card">
        <span className="text-2xl">🃏</span>
        <span className="text-[7px] font-black uppercase tracking-widest text-violet-600 mt-1">Joker</span>
      </div>
    );
  } else if (state.trump.state === "REVEALED") {
    if (state.trumpStyle === "SEVENTH_CARD" && 'card' in state.trump && state.trump.card) {
      cardContent = (
        <div className="relative flex h-full w-full items-center justify-center rounded-lg overflow-hidden ring-2 ring-gold/50 shadow-card">
          <PlayingCard card={state.trump.card} size="sm" />
        </div>
      );
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

export const TrumpBanner = React.memo(TrumpBannerComponent);

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
