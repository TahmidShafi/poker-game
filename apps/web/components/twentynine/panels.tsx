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
  const { me, myTnCards, tnPlayCard, tnBidderPrivate } = useGame();
  const mySeat = me?.seatIndex ?? null;
  const isBidder = mySeat !== null && state.bidderSeatIndex === mySeat;
  const seventhCard = isBidder && tnBidderPrivate?.kind === "SEVENTH_INDICATOR" ? tnBidderPrivate.indicatorCard : null;

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
        const isSeventh = seventhCard && c.suit === seventhCard.suit && c.rank === seventhCard.rank;

        return (
          <button
            key={`${c.rank}${c.suit}`}
            disabled={!clickable}
            onClick={() => tnPlayCard(c)}
            className={`relative transition-all ${
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
            {isSeventh && (
              <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-20 bg-amber-400 text-slate-950 px-1.5 py-0.2 text-[8px] font-black rounded-full shadow-lg whitespace-nowrap ring-1 ring-black/40">
                7th 👑
              </div>
            )}
            <PlayingCard card={c} size="sm" className={`sm:hidden shadow-card ${isSeventh ? "ring-2 ring-amber-400" : ""}`} />
            <PlayingCard card={c} size="md" className={`hidden sm:block shadow-card ${isSeventh ? "ring-2 ring-amber-400" : ""}`} />
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

  const H = bids?.highestBid ?? null;
  const holderSeat = bids?.bidderSeatIndex ?? null;
  const isDefender = mySeat !== null && holderSeat === mySeat;
  const isChallenged = bids?.challengerSeatIndex !== null && bids?.challengerSeatIndex !== undefined && bids?.challengerSeatIndex !== mySeat;
  const canStay = isDefender && isChallenged && H !== null;

  let floor = 16;
  if (H !== null) {
    floor = canStay ? H : Math.max(16, H + 1);
  }

  const [bidValue, setBidValue] = useState(16);

  // Always reset to minimum legal bid for each new round or turn
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

  // Presets for quick jumping
  const presets = [
    { label: canStay && floor === H ? `Stay ${H}` : `Min ${floor}`, value: floor },
    ...(floor + 1 <= 28 && floor + 1 !== floor ? [{ label: `+1 (${floor + 1})`, value: floor + 1 }] : []),
    ...(20 >= floor && 20 <= 28 && floor !== 20 && floor + 1 !== 20 ? [{ label: "20", value: 20 }] : []),
    ...(24 >= floor && 24 <= 28 && floor !== 24 ? [{ label: "24", value: 24 }] : []),
    ...(28 >= floor && floor !== 28 ? [{ label: "28", value: 28 }] : []),
  ];

  // Active actor name
  const actingSeat = bids?.turnSeatIndex;
  const actor = actingSeat !== null && actingSeat !== undefined ? state.seats[actingSeat] : null;
  const actorName = actor?.username ?? (actingSeat !== null && actingSeat !== undefined ? `Seat ${actingSeat}` : "Unknown");

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl bg-slate-950/92 p-2.5 sm:p-3 border border-amber-500/30 ring-1 ring-white/10 shadow-2xl backdrop-blur-xl animate-riseFade select-none">
      {/* Compact Info Bar */}
      <div className="flex items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] font-bold uppercase tracking-wider text-white/45">High:</span>
          {H !== null ? (
            <span className="font-black text-amber-300 text-xs">
              {H} <span className="text-[9.5px] font-normal text-white/50">({holderSeat === mySeat ? "You" : `Seat ${holderSeat}`})</span>
            </span>
          ) : (
            <span className="text-white/60 text-[10.5px] font-bold">16 (Starts)</span>
          )}
        </div>

        <div>
          {myTurn ? (
            canStay ? (
              <span className="text-[10px] font-black uppercase text-amber-300 animate-pulse">
                ⚡ Challenged! Stay ({H}) or Raise
              </span>
            ) : (
              <span className="text-[10px] font-black uppercase text-emerald-400">
                Your Turn
              </span>
            )
          ) : (
            <span className="text-[10px] font-medium text-white/50">
              Waiting for <b className="text-white/80">{actorName}</b>…
            </span>
          )}
        </div>
      </div>

      {myTurn && (
        <div className="mt-2 space-y-2">
          {canBidHigher ? (
            <>
              {/* Stepper + Slider + Value */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentBid <= floor}
                  onClick={() => setBidValue((v) => Math.max(floor, v - 1))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10 text-xs font-black text-white hover:bg-white/20 disabled:opacity-20 active:scale-95 transition-all"
                >
                  −
                </button>

                <input
                  type="range"
                  min={floor}
                  max={28}
                  value={currentBid}
                  onChange={(e) => setBidValue(Number(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer h-1.5 bg-white/15 rounded-lg appearance-none"
                />

                <button
                  type="button"
                  disabled={currentBid >= 28}
                  onClick={() => setBidValue((v) => Math.min(28, v + 1))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10 text-xs font-black text-white hover:bg-white/20 disabled:opacity-20 active:scale-95 transition-all"
                >
                  +
                </button>

                <div className="grid h-7 w-10 shrink-0 place-items-center rounded-lg bg-amber-400/20 border border-amber-400/50 shadow-inner">
                  <span className="tabnum text-xs font-black text-amber-300">
                    {currentBid}
                  </span>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setBidValue(p.value)}
                    className={`rounded-md px-2 py-0.5 text-[9px] font-bold transition-all shrink-0 ${
                      currentBid === p.value
                        ? "bg-amber-400 text-slate-950 ring-1 ring-white/40 font-black"
                        : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => tnBid(currentBid)}
                  className={`rounded-xl py-2 text-xs font-black tracking-wide text-slate-950 transition-all active:scale-[0.98] shadow-md ${
                    canStay && currentBid === H
                      ? "bg-gradient-to-r from-emerald-400 to-amber-300 shadow-glowGold ring-1 ring-white/40"
                      : "bg-gradient-to-r from-amber-400 to-amber-500 shadow-glowGold hover:brightness-105"
                  }`}
                >
                  {canStay && currentBid === H
                    ? `STAY (${currentBid})`
                    : canStay && currentBid > H
                    ? `RAISE ${currentBid}`
                    : H === null
                    ? `BID ${currentBid}`
                    : `RAISE ${currentBid}`}
                </button>

                <button
                  type="button"
                  onClick={() => tnBid()}
                  className="rounded-xl bg-red-950/40 border border-red-500/30 hover:bg-red-900/60 py-2 text-xs font-black tracking-wide text-red-200 hover:text-white transition-all active:scale-[0.98]"
                >
                  PASS
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <p className="text-center text-[10px] font-bold text-amber-300 uppercase">
                Max Bid (28) Reached
              </p>
              <button
                type="button"
                onClick={() => tnBid()}
                className="w-full rounded-xl bg-red-950/40 border border-red-500/30 hover:bg-red-900/60 py-2 text-xs font-black tracking-wide text-red-200 hover:text-white transition-all active:scale-[0.98]"
              >
                PASS
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/** Contextual action pills under the hand fan: CALL TRUMP / MARRIAGE. */
export function ActionPills({ state }: { state: PublicTwentyNineState }) {
  const { me, myTnCards, tnCallTrump, tnDeclareMarriage } = useGame();
  const mySeat = me?.seatIndex ?? null;
  const myTurn = state.actingSeatIndex !== null && state.actingSeatIndex === mySeat;
  if (!myTnCards || state.phase !== "PLAYING" || state.isSingleHand) return null;

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
 * Single Hand Decision Prompt: clean tray with Single Hand Call title and buttons.
 */
export function SingleHandPrompt({ state }: { state: PublicTwentyNineState }) {
  const { me, tnSingleHandDecision } = useGame();
  const mySeat = me?.seatIndex ?? null;

  if (state.phase !== "SINGLE_HAND_DECISION") return null;

  const acting = state.actingSeatIndex;
  const isMyTurn = mySeat !== null && acting === mySeat;
  const actor = acting !== null ? state.seats[acting] : null;
  const actorName = actor?.username ?? (acting !== null ? `Seat ${acting}` : "Unknown");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 select-none">
      <div className="w-full max-w-sm rounded-2xl bg-slate-950/95 p-5 border border-amber-400/40 shadow-2xl text-center">
        <h3 className="text-lg font-black uppercase tracking-wider text-amber-300">
          Single Hand Call
        </h3>

        {isMyTurn ? (
          <div className="mt-4 flex gap-2.5 justify-center">
            <button
              onClick={() => tnSingleHandDecision(true)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              Single Hand
            </button>
            <button
              onClick={() => tnSingleHandDecision(false)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs uppercase tracking-wider border border-white/15 transition-colors cursor-pointer"
            >
              Skip
            </button>
          </div>
        ) : (
          <div className="mt-4 py-2.5 px-4 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-white/70">
            Waiting for <span className="text-amber-300 font-bold">{actorName}</span>…
          </div>
        )}
      </div>
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

  // Single Hand HUD Display
  if (state.isSingleHand && state.singleHandSeatIndex !== null && state.singleHandSeatIndex !== undefined) {
    const singleSeat = state.singleHandSeatIndex;
    const isMeSingle = mySeat === singleSeat;
    const singleTeam = singleSeat % 2 === 0 ? "A" : "B";
    const isMyTeamSingle = myTeam === singleTeam;
    const singleTricks = state.tricksWon[singleTeam];
    const opponentTeam = singleTeam === "A" ? "B" : "A";
    const opponentTricks = state.tricksWon[opponentTeam];

    return (
      <>
        {/* Mobile compact HUD */}
        <div className="sm:hidden flex items-center justify-between w-full max-w-sm mx-auto rounded-xl bg-amber-950/80 px-3 py-1.5 backdrop-blur-md ring-1 ring-amber-400/40 text-[10.5px] font-mono select-none">
          <div className="flex items-center gap-1.5 font-bold text-amber-300">
            👑 SOLO: {singleTricks}/8 TRICKS
          </div>
          <div className="text-[10px] font-bold text-white/70">
            {isMyTeamSingle ? (isMeSingle ? "YOU SOLO" : "PARTNER SOLO") : "OPPONENT SOLO"}
          </div>
        </div>

        {/* Desktop full floating card */}
        <div className="hidden sm:flex w-60 flex-col overflow-hidden rounded-2xl bg-slate-950/85 p-4 shadow-panel backdrop-blur-md ring-1 ring-amber-400/30 font-mono select-none">
          <div className="mb-2 text-center text-[10.5px] font-black uppercase tracking-widest text-amber-300 flex items-center justify-center gap-1">
            <span>👑</span> SINGLE HAND MODE
          </div>
          <div className="text-[10px] text-center text-white/60 mb-3">
            {isMeSingle ? "You are playing solo" : isMyTeamSingle ? "Partner playing solo" : `Seat ${singleSeat} playing solo`}
          </div>
          <div className="flex justify-between items-center bg-white/5 rounded-xl p-2.5 border border-white/10 text-xs">
            <span className="font-bold text-white/70">Tricks Won:</span>
            <span className="font-black text-amber-300 text-sm">{singleTricks} / 8</span>
          </div>
          <div className="mt-3 text-center">
            {opponentTricks > 0 ? (
              <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-rose-300 ring-1 ring-rose-500/50">
                FAILED
              </span>
            ) : singleTricks === 8 ? (
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/50">
                SUCCESS (+3)
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300 ring-1 ring-amber-500/50 animate-pulse">
                MUST WIN ALL 8
              </span>
            )}
          </div>
        </div>
      </>
    );
  }

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

  // Bid requirement shifts if there is a valid marriage declared (minimum 16)
  let bidRequirement = bid;
  if (state.marriageDeclaredBy) {
    if (state.marriageDeclaredBy === biddingTeam) {
      bidRequirement = Math.max(16, bidRequirement - 4);
    } else {
      bidRequirement += 4;
    }
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
