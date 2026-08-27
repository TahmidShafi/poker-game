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
    <div className="flex items-end justify-center -space-x-2.5 sm:space-x-1.5 px-2">
      {myTnCards.map((c, idx) => {
        const isLegal = legalKeys.has(`${c.rank}${c.suit}`);
        const clickable = myTurn && isLegal;
        return (
          <button
            key={`${c.rank}${c.suit}`}
            disabled={!clickable}
            onClick={() => tnPlayCard(c)}
            className={`transition-all ${
              clickable ? "hover:-translate-y-3 cursor-pointer hover:z-30 active:scale-95" : ""
            } ${myTurn && !isLegal ? "opacity-35 saturate-50" : ""} disabled:cursor-not-allowed`}
            style={{ zIndex: idx }}
            title={
              clickable
                ? "play this card"
                : myTurn
                ? "not legal — follow suit"
                : `waiting for seat ${state.actingSeatIndex}`
            }
          >
            <PlayingCard card={c} size="sm" className="sm:hidden shadow-card" />
            <PlayingCard card={c} size="md" className="hidden sm:block shadow-card" />
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

  const [bidValue, setBidValue] = useState(16);

  // Always reset to minimum legal bid (starting from 16) for each new round or turn
  React.useEffect(() => {
    if (H === null) {
      setBidValue(16);
    } else {
      setBidValue((v) => Math.min(28, Math.max(v, floor)));
    }
  }, [H, floor, state.roundNumber]);

  if (state.phase !== "BIDDING") return null;

  const currentBid = Math.min(28, Math.max(bidValue, floor));
  const canBidHigher = floor <= 28;

  return (
    <div className="rounded-2xl bg-black/50 p-4 ring-1 ring-white/10 backdrop-blur-md shadow-panel">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50">
          BIDDING (16 – 28)
        </p>
        <span className="text-[10px] text-white/40 font-mono">Round #{state.roundNumber}</span>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-white/70">
          Current High:{" "}
          <b className="tabnum font-black text-gold text-sm">
            {bids?.highestBid ?? "None (Starts at 16)"}
          </b>
          {bids?.bidderSeatIndex !== null && bids?.bidderSeatIndex !== undefined && (
            <span className="text-white/45">
              {" "}
              · seat {bids.bidderSeatIndex}
            </span>
          )}
        </span>
        <span className="flex gap-1">
          {(bids?.passedSeatIndexes ?? []).map((s) => (
            <span
              key={s}
              className="rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white/30 line-through"
            >
              P{s}
            </span>
          ))}
        </span>
      </div>

      {myTurn ? (
        <div className="mt-3 space-y-2.5">
          {canMatch && (
            <p className="text-center text-[10px] font-bold uppercase tracking-widest text-violet-300">
              ⚡ match {floor} available
            </p>
          )}

          {canBidHigher ? (
            <>
              {/* Stepper + Slider */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentBid <= floor}
                  onClick={() => setBidValue((v) => Math.max(floor, v - 1))}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-sm font-black text-white hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                >
                  −
                </button>
                <input
                  type="range"
                  min={floor}
                  max={28}
                  value={currentBid}
                  onChange={(e) => setBidValue(Number(e.target.value))}
                  className="w-full accent-gold cursor-pointer"
                />
                <button
                  type="button"
                  disabled={currentBid >= 28}
                  onClick={() => setBidValue((v) => Math.min(28, v + 1))}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-sm font-black text-white hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                >
                  +
                </button>
                <span className="w-9 text-center tabnum text-base font-black text-gold">
                  {currentBid}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => tnBid(currentBid)}
                  className="rounded-xl bg-gold py-2 text-xs font-black tracking-wide text-slate-950 shadow-glowGold hover:brightness-105 active:scale-[0.98]"
                >
                  BID {currentBid}
                </button>
                <button
                  onClick={() => tnBid()}
                  className="rounded-xl bg-black/60 py-2 text-xs font-black tracking-wide text-white/80 ring-1 ring-white/15 hover:bg-white/10 hover:text-white active:scale-[0.98]"
                >
                  PASS
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-center text-[10px] font-bold text-amber-300 uppercase">
                Maximum bid (28) reached
              </p>
              <button
                onClick={() => tnBid()}
                className="w-full rounded-xl bg-black/60 py-2 text-xs font-black tracking-wide text-white/80 ring-1 ring-white/15 hover:bg-white/10 hover:text-white active:scale-[0.98]"
              >
                PASS
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-center text-[11px] font-medium text-white/40">
          waiting for seat {bids?.turnSeatIndex} to act…
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
 * Tracks tricks, points, and Full Board possibilities in real-time,
 * dynamically customized to the viewing player's perspective.
 */
export function LiveRoundProgress({ state }: { state: PublicTwentyNineState }) {
  const { me } = useGame();
  const mySeat = me?.seatIndex ?? null;
  const myTeam = mySeat !== null ? (mySeat % 2 === 0 ? "A" : "B") : null;

  const bidderSeat = state.bidderSeatIndex ?? state.bids?.bidderSeatIndex ?? state.lastRoundSummary?.bidderSeatIndex ?? null;
  const bid = state.bid ?? state.bids?.highestBid ?? state.lastRoundSummary?.bid ?? null;

  // Don't render until bidding has established a bid & bidder
  if (bidderSeat == null || bid == null) return null;
  if (state.phase === "WAITING_FOR_PLAYERS" || state.phase === "REDEALING") {
    return null;
  }

  const biddingTeam = bidderSeat % 2 === 0 ? "A" : "B";
  const opponentTeam = biddingTeam === "A" ? "B" : "A";

  const isMyTeamBidding = myTeam !== null && myTeam === biddingTeam;
  const isMeTheBidder = mySeat !== null && mySeat === bidderSeat;

  // Header Titles from the viewer's perspective
  const bidderTitle = isMeTheBidder
    ? "BIDDER (YOU)"
    : isMyTeamBidding
    ? "BIDDING (YOU)"
    : "BIDDING (THEM)";

  const opponentTitle = isMyTeamBidding
    ? "OPPONENT (THEM)"
    : "DEFENDING (YOU)";

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
  const opponentDefeatTarget = 29 - bidRequirement;
  const opponentNeeds = Math.max(0, opponentDefeatTarget - opponentPoints);

  const fullBoardPossible = opponentTricks === 0;
  
  let statusBadge = null;
  if (bidderTricks === 8) {
    statusBadge = (
      <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/50">
        {isMyTeamBidding ? "FULL BOARD! +2 (YOU WON)" : "FULL BOARD +2 (THEM)"}
      </span>
    );
  } else if (opponentPoints >= opponentDefeatTarget) {
    statusBadge = (
      <span className="rounded-full bg-crimson/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-crimson ring-1 ring-crimson/40">
        {isMyTeamBidding ? "BID DEFEATED" : "BID DEFEATED! (YOU WON)"}
      </span>
    );
  } else if (bidderPoints >= bidRequirement) {
    if (fullBoardPossible) {
      statusBadge = (
        <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-blue-300 ring-1 ring-blue-500/50">
          BID ACHIEVED — FULL BOARD POSSIBLE
        </span>
      );
    } else {
      statusBadge = (
        <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/50">
          {isMyTeamBidding ? "BID ACHIEVED (+1)" : "BID ACHIEVED (THEM)"}
        </span>
      );
    }
  } else if (fullBoardPossible) {
    statusBadge = (
      <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/60 ring-1 ring-white/20">
        FULL BOARD POSSIBLE
      </span>
    );
  } else {
    statusBadge = (
      <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/35 ring-1 ring-white/10">
        FULL BOARD LOST
      </span>
    );
  }

  return (
    <>
      {/* Mobile compact HUD */}
      <div className="sm:hidden flex items-center justify-between w-full max-w-sm mx-auto rounded-xl bg-black/75 px-3 py-1.5 backdrop-blur-md ring-1 ring-white/10 text-[10.5px] font-mono select-none">
        <div className="flex items-center gap-2">
          <span className={`font-bold ${isMyTeamBidding ? "text-gold" : "text-amber-400"}`}>
            {isMyTeamBidding ? "YOU" : "THEM"}: {bidderPoints}/{bidRequirement}
          </span>
          <span className="text-white/25">|</span>
          <span className={`font-bold ${!isMyTeamBidding ? "text-violet-300" : "text-violet-400"}`}>
            DEF: {opponentPoints}/{opponentDefeatTarget}
          </span>
        </div>
        <div className="text-[10px] font-bold text-white/50">
          Tricks: {bidderTricks}-{opponentTricks}
        </div>
      </div>

      {/* Desktop full floating card */}
      <div className="hidden sm:flex w-60 flex-col overflow-hidden rounded-2xl bg-black/70 p-4 shadow-panel backdrop-blur-md ring-1 ring-white/10 font-mono select-none">
        <div className="mb-3 text-center text-[10px] font-black uppercase tracking-widest text-white/60">
          Live Round Progress
        </div>
        
        {/* Bidding Team Section */}
        <div className="flex flex-col text-[11px]">
          <div className={`flex justify-between font-bold ${isMyTeamBidding ? "text-gold" : "text-amber-400/90"}`}>
            <span>{bidderTitle}</span>
            <span>{bidderTricks} TRICKS</span>
          </div>
          <div className="mt-1 flex justify-between text-white/90">
            <span className="text-white/60">Points</span>
            <span className="font-semibold">{bidderPoints} / {bidRequirement}</span>
          </div>
          <div className="flex justify-between text-white/50">
            <span>Need</span>
            <span>{bidderNeeds > 0 ? bidderNeeds : 0}</span>
          </div>
        </div>

        <div className="my-2.5 h-[1px] w-full bg-white/10" />

        {/* Opponent / Defending Team Section */}
        <div className="flex flex-col text-[11px] mb-3.5">
          <div className={`flex justify-between font-bold ${!isMyTeamBidding ? "text-violet-300" : "text-violet-400/80"}`}>
            <span>{opponentTitle}</span>
            <span>{opponentTricks} TRICKS</span>
          </div>
          <div className="mt-1 flex justify-between text-white/90">
            <span className="text-white/60">Points</span>
            <span className="font-semibold">{opponentPoints} / {opponentDefeatTarget}</span>
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
    </>
  );
}
