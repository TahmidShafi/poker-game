"use client";

/**
 * DEV-ONLY visual harness (never renders in production builds).
 * Renders the real TwentyNineView with a mock game context so the UI can be
 * screenshotted in fixed states (mid-bidding / mid-trick) without a server
 * or any sockets. Drive with ?state=bidding | playing.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { PublicTwentyNineState, TnCard } from "@poker/shared-types";
import { TnPhase } from "@poker/shared-types";
import { GameContext, type GameContextValue } from "../../../lib/store";
import { TwentyNineView } from "../../../components/twentynine/TwentyNineView";

const c = (rank: TnCard["rank"], suit: TnCard["suit"]): TnCard => ({ rank, suit });

const HAND_8: TnCard[] = [
  c(7, "SPADES"), c(11, "DIAMONDS"), c(13, "DIAMONDS"), c(7, "DIAMONDS"),
  c(14, "HEARTS"), c(10, "HEARTS"), c(13, "HEARTS"), c(11, "SPADES"),
];

function seat(i: number, username: string) {
  return {
    seatIndex: i,
    username,
    avatar: undefined,
    team: (i % 2 === 0 ? "A" : "B") as "A" | "B",
    status: "SEATED" as const,
    cardsRemaining: 7,
  };
}

const BASE_SEATS = [
  seat(0, "Tahmid"),
  seat(1, "South"),
  seat(2, "West"),
  seat(3, "North"),
];

function playingState(): PublicTwentyNineState {
  return {
    gameType: "TWENTY_NINE",
    gameId: "preview",
    roomCode: "MD86GA",
    phase: TnPhase.PLAYING,
    seats: BASE_SEATS.map((s) => ({ ...s })),
    dealerSeatIndex: 0,
    trumpStyle: "JOKER",
    trump: { state: "JOKER_MODE" },
    bid: 20,
    bidderSeatIndex: 2,
    marriageDeclaredBy: null,
    bids: {
      highestBid: 20,
      bidderSeatIndex: 2,
      passedSeatIndexes: [0, 1, 3],
      turnSeatIndex: null,
      history: [
        { seatIndex: 3, bid: 20 },
        { seatIndex: 2 },
        { seatIndex: 1 },
        { seatIndex: 0 },
      ],
    },
    trick: [
      { seatIndex: 2, card: c(11, "CLUBS") },
      { seatIndex: 1, card: c(7, "HEARTS") },
      { seatIndex: 3, card: c(13, "DIAMONDS") },
    ],
    ledSeatIndex: 2,
    tricksWon: { A: 2, B: 0 },
    capturedPoints: { A: 7, B: 3 },
    roundNumber: 1,
    matchScore: { A: 2, B: 1 },
    roundHistory: ["A", "A", "B"],
    roundsToWin: 6,
    winnerTeam: null,
    lastRoundSummary: null,
    actingSeatIndex: 0,
    offlineFallback: null,
    lastMove: { seatIndex: 3, kind: "PLAY", card: c(13, "DIAMONDS") },
  };
}

function biddingState(): PublicTwentyNineState {
  return {
    ...playingState(),
    phase: TnPhase.BIDDING,
    trumpStyle: null,
    trump: { state: "NOT_SET" },
    bids: {
      highestBid: 17,
      bidderSeatIndex: 3,
      passedSeatIndexes: [2],
      turnSeatIndex: 0,
      history: [
        { seatIndex: 3, bid: 17 },
        { seatIndex: 2 },
      ],
    },
    trick: [],
    ledSeatIndex: null,
    tricksWon: { A: 0, B: 0 },
    capturedPoints: { A: 0, B: 0 },
    actingSeatIndex: 0,
    lastMove: { seatIndex: 2, kind: "PASS" },
  };
}

export default function TnPreviewPage() {
  // Mounted-only state selection: reading the query string during render
  // would diverge between SSR and hydration and trip the dev overlay.
  const [state, setState] = React.useState<PublicTwentyNineState | null>(null);
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const which = new URLSearchParams(window.location.search).get("state");
    setState(which === "bidding" ? biddingState() : playingState());
  }, []);

  const value = useMemo<GameContextValue | null>(() => {
    if (!state) return null;
    const noop = () => undefined;
    return {
      serverUrl: "http://localhost:4000",
      status: "online",
      me: { roomCode: state.roomCode ?? "MD86GA", seatIndex: 0, sessionToken: "preview", config: state ? { startingCoins: 1000, smallBlind: 10, bigBlind: 20, turnTimeSeconds: 60, gameType: "TWENTY_NINE" } : undefined },
      state: null,
      gameType: "TWENTY_NINE",
      tnState: state,
      tnResolvedTrick: null,
      myTnCards: state.phase === "BIDDING" ? HAND_8.slice(0, 4) : HAND_8,
      tnBidderPrivate: null,
      lastTnRound: null,
      myCards: null,
      showdown: null,
      clearShowdown: noop,
      toast: null,
      pushToast: noop,
      incomingLoan: null,
      dismissIncomingLoan: noop,
      session: { handsPlayed: 0, handsWon: 0, bestHandLabel: null, bestHandCategory: -1, biggestPotWon: 0 },
      recentHands: [],
      timeline: { preflop: null, flop: null, turn: null, river: null, showdown: null },
      celebration: null,
      clearCelebration: noop,
      soundOn: true,
      toggleSound: noop,
      createRoom: async () => ({ ok: false }),
      joinRoom: async () => ({ ok: false }),
      tryReconnect: noop,
      leaveRoom: noop,
      act: noop,
      setPreaction: noop,
      requestLoan: noop,
      respondLoan: noop,
      repayLoan: noop,
      tnBid: noop,
      tnDeclareTrump: noop,
      tnCallTrump: noop,
      tnDeclareMarriage: noop,
      tnPlayCard: noop,
      tnSingleHandDecision: noop,
      tnFillBots: noop,
      tnSyncHand: noop,
    };
  }, [state]);

  if (process.env.NODE_ENV === "production") {
    return <p style={{ padding: 40 }}>preview unavailable in production</p>;
  }
  if (!value) return null;

  return (
    <GameContext.Provider value={value}>
      <TwentyNineView />
    </GameContext.Provider>
  );
}
