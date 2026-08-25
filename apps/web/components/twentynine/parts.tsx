"use client";

import React from "react";
import type { PublicTwentyNineState, TnCard, TnSeatView } from "@poker/shared-types";
import { TN_RANK_LABELS, TN_SUIT_SYMBOLS } from "@poker/shared-types";
import { PlayingCard } from "../PlayingCard";
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
        src={`/avatars/${avatar}.png`}
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

export function SeatCard({
  seat,
  isDealer,
  isActing,
  isMe,
}: {
  seat: TnSeatView;
  isDealer: boolean;
  isActing: boolean;
  isMe: boolean;
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
            <p className={`text-[10px] font-bold ${tnTeamColor(seat.team)}`}>team {seat.team}</p>
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
              <span className={`text-[10px] font-black ${tnTeamColor(seat.team)}`}>
                TEAM {seat.team}
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

/** Center of the felt: current trick plays positioned by seat. */
export function TrickArea({
  state,
  flashSeat,
}: {
  state: PublicTwentyNineState;
  flashSeat: number | null;
}) {
  const bySeat = new Map<number, TnCard>();
  for (const p of state.trick) bySeat.set(p.seatIndex, p.card);
  const slot: Record<number, string> = { 0: "left-3", 1: "top-2 left-1/2 -translate-x-1/2", 2: "right-3", 3: "bottom-2 left-1/2 -translate-x-1/2" };
  return (
    <div className="pointer-events-none absolute inset-6 rounded-[999px] border border-white/10">
      {[0, 1, 2, 3].map((i) => {
        const card = bySeat.get(i);
        return (
          <div key={i} className={`absolute ${slot[i]} ${flashSeat === i ? "animate-pulse" : ""}`}>
            {card ? (
              <PlayingCard card={card} size="sm" />
            ) : (
              <span className="block h-[3.4rem] w-0" aria-hidden />
            )}
          </div>
        );
      })}
      {state.trick.length === 0 && (
        <span className="absolute inset-0 grid place-items-center text-[10px] uppercase tracking-[0.3em] text-white/25">
          {state.phase === "PLAYING" ? `${state.ledSeatIndex !== null ? "trick " + (state.roundNumber ? "" : "") : ""}waiting…` : ""}
        </span>
      )}
    </div>
  );
}

export function TrumpBanner({ state }: { state: PublicTwentyNineState }) {
  let value: React.ReactNode;
  if (state.trump.state === "JOKER_MODE") value = <span className="text-violet-300">JOKER MODE</span>;
  else if (state.trump.state === "REVEALED")
    value = (
      <span className="text-gold">
        {TN_SUIT_SYMBOLS[state.trump.suit]} {state.trump.suit.toLowerCase()}
      </span>
    );
  else if (state.trump.state === "HIDDEN") value = <span>🔒 HIDDEN</span>;
  else value = <span className="text-white/40">not set</span>;

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/55 ring-1 ring-white/10">
      <span>{state.trumpMode.replace("_", " ").toLowerCase()}</span>
      <span className="text-white/20">·</span>
      {value}
      {state.marriageDeclaredBy && (
        <>
          <span className="text-white/20">·</span>
          <span className={tnTeamColor(state.marriageDeclaredBy)}>
            marriage team {state.marriageDeclaredBy}
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
