"use client";

import React, { useMemo, useState } from "react";
import type { PublicTwentyNineState, TnCard } from "@poker/shared-types";
import { TN_SUIT_SYMBOLS } from "@poker/shared-types";
import { PlayingCard } from "../PlayingCard";
import { useGame } from "../../lib/store";

/** Client-side mirror of the engine's follow-suit rule (server re-validates). */
export function legalMirror(hand: TnCard[], trick: PublicTwentyNineState["trick"]): TnCard[] {
  if (trick.length === 0) return hand;
  const led = trick[0]!.card.suit;
  const followers = hand.filter((c) => c.suit === led);
  return followers.length > 0 ? followers : hand;
}

export function HandFan({ state }: { state: PublicTwentyNineState }) {
  const { me, myTnCards, tnPlayCard } = useGame();
  const mySeat = me?.seatIndex ?? null;
  const legal = useMemo(
    () => legalMirror(myTnCards ?? [], state.trick),
    [myTnCards, state.trick]
  );
  const legalKeys = new Set(legal.map((c) => `${c.rank}${c.suit}`));
  const myTurn = state.actingSeatIndex !== null && state.actingSeatIndex === mySeat;

  if (!myTnCards || myTnCards.length === 0) return null;

  return (
    <div className="flex items-end justify-center gap-1.5">
      {myTnCards.map((c) => {
        const isLegal = legalKeys.has(`${c.rank}${c.suit}`);
        return (
          <button
            key={`${c.rank}${c.suit}`}
            disabled={!myTurn || !isLegal}
            onClick={() => tnPlayCard(c)}
            className={`transition-transform ${
              myTurn && isLegal ? "hover:-translate-y-2 cursor-pointer" : ""
            } ${!isLegal ? "opacity-35 saturate-50" : ""} disabled:cursor-not-allowed`}
            title={isLegal ? "play this card" : "not legal — follow suit"}
          >
            <PlayingCard card={c} size="md" />
          </button>
        );
      })}
    </div>
  );
}

export function BiddingPanel({ state }: { state: PublicTwentyNineState }) {
  const { me, tnBid } = useGame();
  const [bidValue, setBidValue] = useState(16);
  const bids = state.bids;
  const mySeat = me?.seatIndex ?? null;
  const myTurn =
    state.phase === "BIDDING" &&
    bids?.turnSeatIndex !== null &&
    bids?.turnSeatIndex === mySeat;

  // Keep the stepper above the current high bid.
  const min = Math.max(16, (bids?.highestBid ?? 15) + 1);
  React.useEffect(() => {
    setBidValue((v) => Math.max(v, min));
  }, [min]);

  if (state.phase !== "BIDDING") return null;

  return (
    <div className="rounded-2xl bg-black/40 p-3.5 ring-1 ring-white/10">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
        bidding
      </p>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-white/60">
          high bid{" "}
          <b className="tabnum text-gold">{bids?.highestBid ?? "—"}</b>
          {bids?.bidderSeatIndex !== null && bids?.bidderSeatIndex !== undefined && (
            <span className="text-white/40">
              {" "}
              · seat {bids.bidderSeatIndex}
            </span>
          )}
        </span>
        <span className="flex gap-1">
          {(bids?.passedSeatIndexes ?? []).map((s) => (
            <span
              key={s}
              className="rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] text-white/35 line-through"
            >
              seat {s}
            </span>
          ))}
        </span>
      </div>

      {myTurn ? (
        <div className="mt-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={min}
              max={28}
              value={Math.min(Math.max(bidValue, min), 28)}
              onChange={(e) => setBidValue(Number(e.target.value))}
              className="w-full accent-gold"
            />
            <span className="w-8 text-right tabnum text-sm font-black text-gold">
              {Math.min(Math.max(bidValue, min), 28)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => tnBid(Math.min(Math.max(bidValue, min), 28))}
              className="rounded-xl bg-gold py-2 text-xs font-black tracking-wide text-ink hover:brightness-105 active:scale-[0.98]"
            >
              BID {Math.min(Math.max(bidValue, min), 28)}
            </button>
            <button
              onClick={() => tnBid()}
              className="rounded-xl bg-black/50 py-2 text-xs font-black tracking-wide text-white/70 ring-1 ring-white/15 hover:text-white active:scale-[0.98]"
            >
              PASS
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-white/40">
          waiting for seat {bids?.turnSeatIndex}…
        </p>
      )}
    </div>
  );
}

export function ScoreBoard({ state }: { state: PublicTwentyNineState }) {
  const teamRow = (team: "A" | "B") => (
    <div className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/10">
      <span className={`text-[11px] font-black ${team === "A" ? "text-gold" : "text-violet-300"}`}>
        TEAM {team}
      </span>
      <span className="text-[11px] text-white/55">
        rounds <b className="tabnum text-white/90">{state.matchScore[team]}</b>
        /{state.roundsToWin}
        <span className="mx-1.5 text-white/20">·</span>
        tricks <b className="tabnum text-white/90">{state.tricksWon[team]}</b>
        <span className="mx-1.5 text-white/20">·</span>
        pts <b className="tabnum text-white/90">{state.capturedPoints[team]}</b>
      </span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <p className="px-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
        round {state.roundNumber} · first to {state.roundsToWin}
      </p>
      {teamRow("A")}
      {teamRow("B")}
    </div>
  );
}

/** Contextual action pills under the hand fan: CALL TRUMP / MARRIAGE. */
export function ActionPills({ state }: { state: PublicTwentyNineState }) {
  const { me, myTnCards, tnCallTrump, tnDeclareMarriage } = useGame();
  const mySeat = me?.seatIndex ?? null;
  const myTurn = state.actingSeatIndex !== null && state.actingSeatIndex === mySeat;
  if (!myTnCards || state.phase !== "PLAYING") return null;

  const canCall =
    myTurn &&
    state.trumpMode !== "JOKER" &&
    state.trump.state === "HIDDEN" &&
    state.trick.length > 0 &&
    !myTnCards.some((c) => c.suit === state.trick[0]!.card.suit);

  const marriageSuits = (() => {
    if (state.trumpMode !== "MARRIAGE" || state.marriageDeclaredBy) return [] as string[];
    const suits = [];
    for (const s of ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"] as const) {
      const hasK = myTnCards.some((c) => c.suit === s && c.rank === 13);
      const hasQ = myTnCards.some((c) => c.suit === s && c.rank === 12);
      if (hasK && hasQ) suits.push(s);
    }
    return suits as string[];
  })();

  return (
    <div className="flex items-center justify-center gap-2">
      {canCall && (
        <button
          onClick={tnCallTrump}
          className="rounded-full bg-gold px-4 py-1.5 text-[11px] font-black uppercase tracking-wide text-ink shadow-glowGold hover:brightness-105 active:scale-[0.97]"
        >
          call trump
        </button>
      )}
      {marriageSuits.map((s) => (
        <button
          key={s}
          onClick={() => tnDeclareMarriage(s as never)}
          className={`rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-wide text-ink hover:brightness-105 active:scale-[0.97] bg-violet-300`}
        >
          marriage {TN_SUIT_SYMBOLS[s as keyof typeof TN_SUIT_SYMBOLS]}
        </button>
      ))}
    </div>
  );
}
