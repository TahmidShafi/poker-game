"use client";

import React, { useMemo, useState } from "react";
import type { PublicTwentyNineState, TnCard } from "@poker/shared-types";
import { TN_SUIT_SYMBOLS } from "@poker/shared-types";
import { PlayingCard } from "../common/PlayingCard";
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
  // Cards are clickable EXACTLY when it is my turn in the PLAYING phase.
  // During bidding/trump-setup the fan stays visible but inert (never
  // "enabled-looking"), so a click can never fire an out-of-phase action.
  const playing = state.phase === "PLAYING";
  const legal = useMemo(
    () => (playing ? legalMirror(myTnCards ?? [], state.trick) : []),
    [playing, myTnCards, state.trick]
  );
  const legalKeys = new Set(legal.map((c) => `${c.rank}${c.suit}`));
  const myTurn = playing && state.actingSeatIndex !== null && state.actingSeatIndex === mySeat;

  if (!myTnCards || myTnCards.length === 0) return null;

  return (
    <div className="flex items-end justify-center gap-1.5">
      {myTnCards.map((c) => {
        const isLegal = legalKeys.has(`${c.rank}${c.suit}`);
        const clickable = myTurn && isLegal;
        return (
          <button
            key={`${c.rank}${c.suit}`}
            disabled={!clickable}
            onClick={() => tnPlayCard(c)}
            className={`transition-transform ${
              clickable ? "hover:-translate-y-2 cursor-pointer" : ""
            } ${myTurn && !isLegal ? "opacity-35 saturate-50" : ""} disabled:cursor-not-allowed`}
            title={
              clickable
                ? "play this card"
                : myTurn
                ? "not legal — follow suit"
                : `waiting for seat ${state.actingSeatIndex}`
            }
          >
            <PlayingCard card={c} size="md" />
          </button>
        );
      })}
    </div>
  );
}

function StatusLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-center text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200/80">
      {children}
    </p>
  );
}

/**
 * Explicit non-blocking status line for every non-acting moment, so a phase
 * transition is never a silent stall: bidding waits, trump-setup waits,
 * dealing, and trick-play waits all name who is being waited on.
 */
export function TurnStatus({ state }: { state: PublicTwentyNineState }) {
  const { me } = useGame();
  const mySeat = me?.seatIndex ?? null;

  if (
    state.phase === "WAITING_FOR_PLAYERS" ||
    state.phase === "ROUND_SCORED" || // RoundBanner covers this
    state.phase === "MATCH_OVER" // MatchOverBanner covers this
  ) {
    return null;
  }
  if (state.phase === "REDEALING") {
    return <StatusLine>hand cancelled — redealing with the same dealer…</StatusLine>;
  }
  if (state.phase === "DEALING_BATCH_1" || state.phase === "DEALING_BATCH_2") {
    return <StatusLine>dealing remaining cards…</StatusLine>;
  }

  const acting = state.actingSeatIndex;
  if (acting === null || acting === mySeat) return null;
  const actor = state.seats[acting];
  const name =
    !actor || actor.username === null ? `seat ${acting}` : actor.username;
  if (state.phase === "BIDDING") return <StatusLine>waiting for {name} to bid…</StatusLine>;
  if (state.phase === "TRUMP_SETUP") {
    return <StatusLine>waiting for {name} to set trump…</StatusLine>;
  }
  if (state.phase === "PLAYING") return <StatusLine>waiting for {name} to play…</StatusLine>;
  return null;
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

  // v2 mirror of the server rule: own side holds -> strictly higher;
  // opponents hold an UNMATCHED value -> matching that value is allowed.
  const teamOf = (s: number) => (s % 2 === 0 ? "A" : "B");
  const H = bids?.highestBid ?? null;
  let floor = 16;
  let canMatch = false;
  if (H !== null && bids?.bidderSeatIndex != null && mySeat !== null) {
    const mine = teamOf(mySeat);
    const holders = teamOf(bids.bidderSeatIndex);
    const priorMatches = bids.history.filter((h) => h.bid === H).length;
    if (mine === holders) floor = Math.max(16, H + 1);
    else if (priorMatches === 1) {
      floor = H;
      canMatch = true;
    } else floor = Math.max(16, H + 1);
  }

  React.useEffect(() => {
    setBidValue((v) => Math.max(v, floor));
  }, [floor]);

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
          {canMatch && (
            <p className="text-center text-[10px] font-bold uppercase tracking-widest text-violet-300">
              match {floor} available
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={floor}
              max={28}
              value={Math.min(Math.max(bidValue, floor), 28)}
              onChange={(e) => setBidValue(Number(e.target.value))}
              className="w-full accent-gold"
            />
            <span className="w-8 text-right tabnum text-sm font-black text-gold">
              {Math.min(Math.max(bidValue, floor), 28)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => tnBid(Math.min(Math.max(bidValue, floor), 28))}
              className="rounded-xl bg-gold py-2 text-xs font-black tracking-wide text-ink hover:brightness-105 active:scale-[0.98]"
            >
              BID {Math.min(Math.max(bidValue, floor), 28)}
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


/** Contextual action pills under the hand fan: CALL TRUMP / MARRIAGE. */
export function ActionPills({ state }: { state: PublicTwentyNineState }) {
  const { me, myTnCards, tnCallTrump, tnDeclareMarriage } = useGame();
  const mySeat = me?.seatIndex ?? null;
  const myTurn = state.actingSeatIndex !== null && state.actingSeatIndex === mySeat;
  if (!myTnCards || state.phase !== "PLAYING") return null;

  const canCall =
    myTurn &&
    state.trumpStyle !== "JOKER" &&
    state.trump.state === "HIDDEN" &&
    state.trick.length > 0 &&
    !myTnCards.some((c) => c.suit === state.trick[0]!.card.suit);

  const marriageSuits = (() => {
    // The active suit is SECRET — offer every K+Q pair the player actually
    // holds; the server verifies it against the real trump on declare.
    if (state.trumpStyle === "JOKER" || state.marriageDeclaredBy) return [] as string[];
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

/** 
 * Live Round Progress Table
 * Tracks tricks, points, and Full Board possibilities in real-time.
 */
export function LiveRoundProgress({ state }: { state: PublicTwentyNineState }) {
  if (state.phase !== "PLAYING" && state.phase !== "ROUND_SCORED" && state.phase !== "MATCH_OVER") {
    return null;
  }
  const bidderSeat = state.bidderSeatIndex;
  const bid = state.bid;
  
  // Wait until we have a bidder and bid
  if (bidderSeat === null || bid === null) return null;

  const biddingTeam = bidderSeat % 2 === 0 ? "A" : "B";
  const opponentTeam = biddingTeam === "A" ? "B" : "A";

  // Bid requirement shifts if there is a valid marriage declared
  let bidRequirement = bid;
  if (state.marriageDeclaredBy) {
    if (state.marriageDeclaredBy === biddingTeam) bidRequirement -= 4;
    else bidRequirement += 4;
  }

  const bidderPoints = state.capturedPoints[biddingTeam];
  const opponentPoints = state.capturedPoints[opponentTeam];
  const bidderTricks = state.tricksWon[biddingTeam];
  const opponentTricks = state.tricksWon[opponentTeam];

  const bidderNeeds = Math.max(0, bidRequirement - bidderPoints);
  const opponentDefeatTarget = 29 - bidRequirement + 1;
  const opponentNeeds = Math.max(0, opponentDefeatTarget - opponentPoints);

  const fullBoardPossible = opponentTricks === 0;
  
  let statusBadge = null;
  if (bidderTricks === 8) {
    statusBadge = (
      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/50">
        FULL BOARD +3
      </span>
    );
  } else if (opponentPoints >= opponentDefeatTarget) {
    statusBadge = (
      <span className="rounded-full bg-crimson/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-crimson ring-1 ring-crimson/40">
        BID DEFEATED
      </span>
    );
  } else if (bidderPoints >= bidRequirement) {
    if (fullBoardPossible) {
      statusBadge = (
        <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-blue-300 ring-1 ring-blue-500/50">
          BID ACHIEVED — FULL BOARD STILL POSSIBLE
        </span>
      );
    } else {
      statusBadge = (
        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/50">
          BID ACHIEVED — +1
        </span>
      );
    }
  } else if (fullBoardPossible) {
    statusBadge = (
      <span className="rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/50 ring-1 ring-white/20">
        FULL BOARD POSSIBLE
      </span>
    );
  } else {
    statusBadge = (
      <span className="rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/30 ring-1 ring-white/10">
        FULL BOARD LOST
      </span>
    );
  }

  return (
    <div className="flex w-56 flex-col overflow-hidden rounded-2xl bg-black/60 p-4 shadow-panel backdrop-blur-md ring-1 ring-white/10 font-mono">
      <div className="mb-4 text-center text-[10px] font-black uppercase tracking-widest text-white/70">
        Live Round Progress
      </div>
      
      <div className="flex flex-col text-[11px]">
        <div className="flex justify-between font-bold text-gold">
          <span>BIDDING TEAM</span>
          <span>{bidderTricks} TRICKS</span>
        </div>
        <div className="mt-1 flex justify-between text-white/90">
          <span>Points</span>
          <span>{bidderPoints} / {bidRequirement}</span>
        </div>
        <div className="flex justify-between text-white/50">
          <span>Need</span>
          <span>{bidderNeeds > 0 ? bidderNeeds : 0}</span>
        </div>
      </div>

      <div className="my-3 h-[1px] w-full bg-white/10" />

      <div className="flex flex-col text-[11px] mb-4">
        <div className="flex justify-between font-bold text-violet-300">
          <span>OPPONENT TEAM</span>
          <span>{opponentTricks} TRICKS</span>
        </div>
        <div className="mt-1 flex justify-between text-white/90">
          <span>Points</span>
          <span>{opponentPoints} / {opponentDefeatTarget}</span>
        </div>
        <div className="flex justify-between text-white/50">
          <span>Need</span>
          <span>{opponentNeeds > 0 ? opponentNeeds : 0}</span>
        </div>
      </div>
      
      <div className="flex justify-center text-center">
        {statusBadge}
      </div>
    </div>
  );
}
