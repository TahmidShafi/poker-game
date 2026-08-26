"use client";

import React from "react";
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
            <p className={`text-[10px] font-bold ${tnTeamColor(seat.team)}`}>
              {myTeam ? (seat.team === myTeam ? "our team" : "their team") : `team ${seat.team}`}
            </p>
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
            <p className="flex items-center gap-1.5">
              <span className={`text-[10px] font-black uppercase ${tnTeamColor(seat.team)}`}>
                {myTeam ? (seat.team === myTeam ? "OUR TEAM" : "THEIR TEAM") : `TEAM ${seat.team}`}
              </span>
              <span className="text-[10px] tabnum text-white/45">{seat.cardsRemaining} cards</span>
              {seat.status === "DISCONNECTED" && (
                <span className="text-[10px] font-bold text-crimson">offline</span>
              )}
            </p>
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
  
  // Use the temporarily held resolved trick if the server's current trick is empty
  const trickToRender = state.trick.length > 0 ? state.trick : (tnResolvedTrick?.plays || []);
  
  // rel 0 = bottom(you) · 1 = left · 2 = top · 3 = right — a loose diamond
  // around the felt center, each card clearly separated and readable.
  const slot: Record<number, string> = {
    0: "left-1/2 bottom-[26%] -translate-x-1/2",
    1: "left-[30%] top-1/2 -translate-y-1/2",
    2: "left-1/2 top-[26%] -translate-x-1/2",
    3: "right-[30%] top-1/2 -translate-y-1/2",
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

      {[0, 1, 2, 3].map((rel) => {
        const play = trickToRender.find((p) => seatRel(mySeat, p.seatIndex) === rel);
        const owner = play?.seatIndex ?? null;
        return (
          <div key={rel} className={`absolute ${slot[rel]} ${flashSeat === owner ? "animate-pulse" : ""}`}>
            {play ? (
              <div className={TRICK_REST_ROT[rel]}>
                {/* Keyed by card identity: a newly played card remounts and
                    flies in from its seat's direction (dealIn keyframe). */}
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
  let value: React.ReactNode;
  if (state.trumpStyle === null && state.trump.state === "NOT_SET")
    value = <span className="text-white/40">awaiting bid winner</span>;
  else if (state.trumpStyle === "JOKER") value = <span className="text-violet-300">JOKER HAND</span>;
  else if (state.trumpStyle === "SEVENTH_CARD" && state.trump.state !== "REVEALED")
    value = <span>7th card · 🔒 HIDDEN</span>;
  else if (state.trump.state === "REVEALED")
    value = (
      <span className="text-gold">
        {TN_SUIT_SYMBOLS[state.trump.suit]} {state.trump.suit.toLowerCase()}
      </span>
    );
  else value = <span>🔒 HIDDEN</span>;

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/55 ring-1 ring-white/10">
      {value}
      {state.marriageDeclaredBy && (
        <>
          <span className="text-white/20">·</span>
          <span className={tnTeamColor(state.marriageDeclaredBy)}>
            {myTeam ? (state.marriageDeclaredBy === myTeam ? "marriage (our team)" : "marriage (their team)") : `marriage team ${state.marriageDeclaredBy}`}
          </span>
        </>
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
