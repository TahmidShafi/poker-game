"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Card,
  GameType,
  HandFinishedSummary,
  PlayerAction,
  PublicGameState,
  PublicTwentyNineState,
  RoomConfig,
  RoomAck,
  ShowdownResult,
  TnBidderPrivatePayload,
  TnCard,
  TnRoundSummary,
  TnSuit,
} from "@poker/shared-types";
import { describeHand, HandCategory } from "@poker/shared-types";
import { createSocket, SERVER_URL, type PokerSocket } from "./socket";
import { accumulateTnHand, type AccumulatedHand } from "./tnHand";
import { isMuted, playChips, playTurn, playWin, setMuted } from "./sound";
import { beginTurnAlerts, endTurnAlerts } from "./notify";
import { fireConfetti, prefersReducedMotion } from "./celebrations";

export type ConnStatus = "connecting" | "online" | "offline";

interface Me {
  roomCode: string;
  seatIndex: number;
  sessionToken: string;
  config?: RoomConfig;
}

export interface LoanRequestView {
  requestId: string;
  debtorSeatIndex: number;
  debtorUsername: string;
  creditorSeatIndex: number;
  amount: number;
  deadline: number;
}

/** Per-sitting statistics shown in the left sidebar. */
export interface SessionStats {
  handsPlayed: number;
  handsWon: number;
  bestHandLabel: string | null;
  bestHandCategory: number;
  biggestPotWon: number;
}

export interface RecentHand {
  handNumber: number;
  communityCards: Card[];
  outcome: "Won" | "Lost";
}

export interface StreetTimeline {
  preflop: number | null;
  flop: number | null;
  turn: number | null;
  river: number | null;
  showdown: number | null;
}

/** Big-moment takeover shown above the table. */
export interface CelebrationView {
  kind: "royal" | "quads";
  label: string;
}

const EMPTY_STATS: SessionStats = {
  handsPlayed: 0,
  handsWon: 0,
  bestHandLabel: null,
  bestHandCategory: -1,
  biggestPotWon: 0,
};

export interface GameContextValue {
  serverUrl: string;
  status: ConnStatus;
  me: Me | null;
  state: PublicGameState | null;
  /** Which game the current room plays ("POKER" until seated in a 29 room). */
  gameType: GameType;
  // ---- Twenty-Nine slices ----
  tnState: PublicTwentyNineState | null;
  tnResolvedTrick: { plays: { seatIndex: number; card: TnCard }[] } | null;
  myTnCards: TnCard[] | null;
  tnBidderPrivate: TnBidderPrivatePayload | null;
  lastTnRound: TnRoundSummary | null;
  myCards: Card[] | null;
  showdown: ShowdownResult[] | null;
  clearShowdown: () => void;
  toast: { message: string; kind: "error" | "info" } | null;
  pushToast: (message: string, kind?: "error" | "info") => void;
  incomingLoan: LoanRequestView | null;
  dismissIncomingLoan: () => void;
  session: SessionStats;
  recentHands: RecentHand[];
  timeline: StreetTimeline;
  celebration: CelebrationView | null;
  clearCelebration: () => void;
  soundOn: boolean;
  toggleSound: () => void;
  createRoom: (
    username: string,
    cfg: RoomConfig,
    avatar?: number,
    extra?: { vsBots?: boolean },
  ) => Promise<RoomAck>;
  joinRoom: (roomCode: string, username: string, avatar?: number) => Promise<RoomAck>;
  tryReconnect: (token: string) => void;
  leaveRoom: () => void;
  act: (action: PlayerAction, amount?: number) => void;
  setPreaction: (action: "CHECK" | "FOLD" | null) => void;
  requestLoan: (creditorSeatIndex: number, amount: number) => void;
  respondLoan: (requestId: string, approve: boolean) => void;
  repayLoan: (creditorSeatIndex: number, amount: number) => void;
  // ---- Twenty-Nine actions ----
  tnBid: (bid?: number) => void;
  tnDeclareTrump: (choice: TnSuit | "SEVENTH_CARD" | "JOKER") => void;
  tnCallTrump: () => void;
  tnDeclareMarriage: (suit: TnSuit) => void;
  tnPlayCard: (card: TnCard) => void;
}

// Exported so dev-only tooling (e.g. the /dev/tn-preview visual harness) can
// supply a mock value without touching the socket lifecycle.
export const GameContext = createContext<GameContextValue | null>(null);

const TOKEN_KEY = "poker.sessionToken";
const ROOM_KEY = "poker.roomCode";

export function GameProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<PokerSocket | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<PublicGameState | null>(null);
  const [tnState, setTnState] = useState<PublicTwentyNineState | null>(null);
  const [tnResolvedTrick, setTnResolvedTrick] = useState<{ plays: { seatIndex: number; card: TnCard }[] } | null>(null);
  const resolvedTrickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [myTnCards, setMyTnCards] = useState<TnCard[] | null>(null);
  const [tnBidderPrivate, setTnBidderPrivate] = useState<TnBidderPrivatePayload | null>(null);
  const [lastTnRound, setLastTnRound] = useState<TnRoundSummary | null>(null);
  const [myCards, setMyCards] = useState<Card[] | null>(null);
  const [showdown, setShowdown] = useState<ShowdownResult[] | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "error" | "info" } | null>(null);
  const [incomingLoan, setIncomingLoan] = useState<LoanRequestView | null>(null);
  const [session, setSession] = useState<SessionStats>(EMPTY_STATS);
  const [recentHands, setRecentHands] = useState<RecentHand[]>([]);
  const [timeline, setTimeline] = useState<StreetTimeline>({
    preflop: null, flop: null, turn: null, river: null, showdown: null,
  });
  const [celebration, setCelebration] = useState<CelebrationView | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mutable refs used inside socket handlers (avoid stale closures).
  const meRef = useRef<Me | null>(null);
  useEffect(() => { meRef.current = me; }, [me]);
  // YOUR_TN_HAND arrives in two batches per hand + reconnect re-deliveries;
  // the full 8-card view must be ACCUMULATED (see lib/tnHand.ts) — replacing
  // on every event silently drops batch 1 when batch 2 lands.
  const myTnHandRef = useRef<AccumulatedHand | null>(null);
  // Cards I have observed MYSELF play this hand (from trick snapshots and
  // trick resolutions). The server removes played cards from the hand but
  // never re-sends YOUR_TN_HAND mid-hand, so the displayed fan must subtract
  // them locally — otherwise played cards stay on screen and clickable.
  const tnPlayedRef = useRef<{ handNumber: number; keys: Set<string> } | null>(null);

  const publishMyTnHand = useCallback(() => {
    const hand = myTnHandRef.current;
    if (!hand) {
      setMyTnCards(null);
      return;
    }
    const played =
      tnPlayedRef.current && tnPlayedRef.current.handNumber === hand.handNumber
        ? tnPlayedRef.current.keys
        : null;
    setMyTnCards(
      played
        ? hand.cards.filter((c) => !played.has(`${c.suit}:${c.rank}`))
        : hand.cards
    );
  }, []);
  const stateRef = useRef<PublicGameState | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  const handStartAt = useRef(0);
  const myDealtIn = useRef(false);
  const lastCommunity = useRef<Card[]>([]);
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const pushToast = useCallback((message: string, kind: "error" | "info" = "error") => {
    setToast({ message, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const clearCelebration = useCallback(() => {
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    celebrationTimer.current = null;
    setCelebration(null);
  }, []);

  const triggerCelebration = useCallback((kind: CelebrationView["kind"], label: string) => {
    if (prefersReducedMotion()) return;
    setCelebration({ kind, label });
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    celebrationTimer.current = setTimeout(() => setCelebration(null), 2400);
  }, []);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on("connect", () => setStatus("online"));
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", () => setStatus("offline"));

    socket.on("GAME_STATE", (s) => {
      setState(s);
      // Disarm turn alerts the moment it is no longer our action.
      const mine = meRef.current;
      if (!mine || s.actingSeatIndex !== mine.seatIndex) endTurnAlerts();
    });

    socket.on("TN_STATE", (s) => {
      setTnState(s);
      // Clear resolved trick immediately if a new trick has started
      if (s.trick.length > 0) {
        setTnResolvedTrick(null);
        if (resolvedTrickTimer.current) clearTimeout(resolvedTrickTimer.current);
      }
      const mine = meRef.current;
      if (!mine || s.actingSeatIndex !== mine.seatIndex) endTurnAlerts();
    });

    socket.on("YOUR_HOLE_CARDS", (cards) => {
      setMyCards(cards);
      myDealtIn.current = true;
    });

    socket.on("HAND_STARTED", () => {
      handStartAt.current = Date.now();
      myDealtIn.current = false;
      lastCommunity.current = [];
      setTimeline({ preflop: 0, flop: null, turn: null, river: null, showdown: null });
    });

    const elapsed = () =>
      handStartAt.current ? Math.round((Date.now() - handStartAt.current) / 1000) : null;

    socket.on("COMMUNITY_CARDS", ({ cards }) => {
      lastCommunity.current = cards;
      const t = elapsed();
      if (t === null) return;
      setTimeline((prev) => {
        if (cards.length === 3 && prev.flop === null) return { ...prev, flop: t };
        if (cards.length === 4 && prev.turn === null) return { ...prev, turn: t };
        if (cards.length === 5 && prev.river === null) return { ...prev, river: t };
        return prev;
      });
    });

    socket.on("SHOWDOWN", ({ results }) => {
      setShowdown(results);
      const t = elapsed();
      if (t !== null) setTimeline((prev) => (prev.showdown === null ? { ...prev, showdown: t } : prev));

      // Big-moment takeover for the best winning category.
      const winners = results.filter((r) => r.amountWon > 0);
      const royal = winners.find((r) => r.hand.category === HandCategory.ROYAL_FLUSH);
      if (royal) triggerCelebration("royal", describeHand(royal.hand));
      else {
        const quads = winners.find((r) => r.hand.category === HandCategory.FOUR_OF_A_KIND);
        if (quads) triggerCelebration("quads", describeHand(quads.hand));
      }

      // Track my best hand this sitting.
      const mine = results.find(
        (r) => r.seatIndex === meRef.current?.seatIndex && r.amountWon > 0
      );
      if (mine) {
        const label = describeHand(mine.hand);
        const cat = mine.hand.category as unknown as number;
        setSession((s) =>
          cat > s.bestHandCategory
            ? { ...s, bestHandLabel: label, bestHandCategory: cat }
            : s
        );
      }
    });

    socket.on("HAND_FINISHED", (summary: HandFinishedSummary) => {
      const dealtIn = myDealtIn.current;
      const mySeat = meRef.current?.seatIndex ?? -1;
      const winAmt = summary.awards
        .filter((a) => a.seatIndex === mySeat)
        .reduce((x, a) => x + a.amount, 0);

      if (dealtIn) {
        setSession((s) => ({
          ...s,
          handsPlayed: s.handsPlayed + 1,
          handsWon: s.handsWon + (winAmt > 0 ? 1 : 0),
          biggestPotWon: Math.max(s.biggestPotWon, winAmt),
        }));
        setRecentHands((list) =>
          [
            {
              handNumber: summary.handNumber,
              communityCards: [...lastCommunity.current],
              outcome: (winAmt > 0 ? "Won" : "Lost") as "Won" | "Lost",
            },
            ...list,
          ].slice(0, 20)
        );
        if (winAmt > 0) playWin();
        // Confetti on genuinely big pots (>= 50 big blinds).
        const bb = stateRef.current?.bigBlind ?? 20;
        if (winAmt >= bb * 50) fireConfetti();
      }

      setShowdown((cur) => cur); // winner banner clears on its own timer below
      setTimeout(() => setShowdown(null), 4200);
      myDealtIn.current = false;
    });

    socket.on("TURN_CHANGED", ({ seatIndex, deadline }) => {
      const mine = meRef.current;
      if (mine?.seatIndex === seatIndex) {
        playTurn();
        beginTurnAlerts({
          roomCode: mine.roomCode,
          seconds: Math.max(1, Math.round((deadline - Date.now()) / 1000)),
        });
      }
    });

    socket.on("ACTION_REJECTED", ({ reason }) => pushToast(reason, "error"));
    socket.on("ERROR", ({ message }) => pushToast(message, "error"));

    // ---- Twenty-Nine ----
    socket.on("TN_STATE", (s) => {
      setTnState(s);
      // Record my cards visible in the current trick as played.
      const hand = myTnHandRef.current;
      const mySeat = meRef.current?.seatIndex;
      if (hand && mySeat !== undefined && s.roundNumber === hand.handNumber) {
        let played = tnPlayedRef.current;
        if (!played || played.handNumber !== hand.handNumber) {
          played = { handNumber: hand.handNumber, keys: new Set<string>() };
        }
        for (const p of s.trick) {
          if (p.seatIndex === mySeat) played.keys.add(`${p.card.suit}:${p.card.rank}`);
        }
        tnPlayedRef.current = played;
        publishMyTnHand();
      }
    });
    socket.on("YOUR_TN_HAND", (payload) => {
      const prev = myTnHandRef.current;
      myTnHandRef.current = accumulateTnHand(prev, payload);
      // New hand or authoritative reconnect snapshot: the server hand is the
      // truth, so any locally-observed plays are obsolete.
      if (
        !prev ||
        prev.handNumber !== myTnHandRef.current.handNumber ||
        payload.batch === "FULL_RECONNECT"
      ) {
        tnPlayedRef.current = {
          handNumber: myTnHandRef.current.handNumber,
          keys: new Set<string>(),
        };
      }
      publishMyTnHand();
    });
    socket.on("TN_BIDDER_PRIVATE", (p) => {
      setTnBidderPrivate(p);
      pushToast(
        p.kind === "SEVENTH_INDICATOR"
          ? "7th card set your trump — hidden until called"
          : "you won the bid — choose how to set trump",
        "info"
      );
    });
    socket.on("TN_TRUMP_REVEALED", ({ suit }) => {
      pushToast(`trump revealed: ${suit.toLowerCase()}`, "info");
      playChips();
    });
    socket.on("TN_TRICK_RESOLVED", (p) => {
      playChips();
      
      // Temporarily hold the fully resolved trick so the UI can animate the 4th card
      setTnResolvedTrick({ plays: p.plays });
      if (resolvedTrickTimer.current) clearTimeout(resolvedTrickTimer.current);
      resolvedTrickTimer.current = setTimeout(() => setTnResolvedTrick(null), 1500);

      // Completed tricks can resolve between two TN_STATE snapshots — record
      // my play from the resolution payload too so the fan never keeps a
      // card that was played and cleared in one hop.
      const hand = myTnHandRef.current;
      const mySeat = meRef.current?.seatIndex;
      if (hand && mySeat !== undefined) {
        let played = tnPlayedRef.current;
        if (!played || played.handNumber !== hand.handNumber) {
          played = { handNumber: hand.handNumber, keys: new Set<string>() };
        }
        for (const pl of p.plays) {
          if (pl.seatIndex === mySeat) played.keys.add(`${pl.card.suit}:${pl.card.rank}`);
        }
        tnPlayedRef.current = played;
        publishMyTnHand();
      }
    });
    socket.on("TN_ROUND_FINISHED", ({ summary }) => {
      setLastTnRound(summary);
      const mySeat = meRef.current?.seatIndex ?? -1;
      const myTeam = mySeat % 2 === 0 ? "A" : "B";
      if (summary.winnerTeam === myTeam) playWin();
    });
    socket.on("TN_MATCH_FINISHED", () => fireConfetti());

    socket.on("LOAN_REQUESTED", (payload) => { setIncomingLoan(payload); playChips(); });
    socket.on("LOAN_RESOLVED", ({ approved }) => {
      setIncomingLoan(null);
      if (approved) playChips();
    });
    socket.on("LOAN_REPAID", () => { pushToast("loan repaid", "info"); playChips(); });

    return () => {
      endTurnAlerts();
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [pushToast, triggerCelebration, publishMyTnHand]);

  // Auto-reconnect via stored token whenever the socket comes online.
  useEffect(() => {
    if (status !== "online") return;
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (!token || me) return;
    const s = socketRef.current;
    if (!s) return;
    s.emit("RECONNECT", { sessionToken: token }, (ack) => {
      if (ack.ok && ack.roomCode) {
        setMe({
          roomCode: ack.roomCode,
          seatIndex: ack.seatIndex!,
          sessionToken: token,
          config: ack.config,
        });
        setState(ack.state ?? null);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ROOM_KEY);
      }
    });
  }, [status, me]);

  // Restore mute preference.
  useEffect(() => { setSoundOn(!isMuted()); }, []);

  const bindAck = useCallback(
    (socket: PokerSocket, ack: RoomAck) => {
      if (ack.ok && ack.roomCode && ack.sessionToken) {
        localStorage.setItem(TOKEN_KEY, ack.sessionToken);
        localStorage.setItem(ROOM_KEY, ack.roomCode);
        setMe({
          roomCode: ack.roomCode,
          seatIndex: ack.seatIndex!,
          sessionToken: ack.sessionToken,
          config: ack.config,
        });
        setSession(EMPTY_STATS);
        setRecentHands([]);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          if (url.searchParams.get("room")) {
            url.searchParams.delete("room");
            window.history.replaceState({}, "", url.pathname);
          }
        }
      } else if (ack.error) {
        pushToast(ack.error, "error");
      }
      return ack;
    },
    [pushToast]
  );

  const createRoom = useCallback(
    (username: string, cfg: RoomConfig, avatar?: number, extra?: { vsBots?: boolean }) => {
      const s = socketRef.current!;
      return new Promise<RoomAck>((resolve) => {
        s.emit(
          "CREATE_ROOM",
          { username, ...cfg, avatar, ...(extra ?? {}) },
          (ack) => resolve(bindAck(s, ack))
        );
      });
    },
    [bindAck]
  );

  const joinRoom = useCallback(
    (roomCode: string, username: string, avatar?: number) => {
      const s = socketRef.current!;
      return new Promise<RoomAck>((resolve) => {
        s.emit("JOIN_ROOM", { username, roomCode, avatar }, (ack) => resolve(bindAck(s, ack)));
      });
    },
    [bindAck]
  );

  const tryReconnect = useCallback((token: string) => {
    const s = socketRef.current;
    if (!s) return;
    s.emit("RECONNECT", { sessionToken: token }, (ack) => {
      if (ack.ok && ack.roomCode) {
        setMe({
          roomCode: ack.roomCode,
          seatIndex: ack.seatIndex!,
          sessionToken: token,
          config: ack.config,
        });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ROOM_KEY);
      }
    });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("LEAVE_ROOM");
    endTurnAlerts();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROOM_KEY);
    setMe(null);
    setState(null);
    setMyCards(null);
    setShowdown(null);
    setSession(EMPTY_STATS);
    setRecentHands([]);
    setTnState(null);
    setMyTnCards(null);
    myTnHandRef.current = null;
    tnPlayedRef.current = null;
    setTnBidderPrivate(null);
    setLastTnRound(null);
  }, []);

  const act = useCallback((action: PlayerAction, amount?: number) => {
    socketRef.current?.emit("PLAYER_ACTION", amount === undefined ? { action } : { action, amount });
  }, []);

  const setPreactionFn = useCallback((action: "CHECK" | "FOLD" | null) => {
    socketRef.current?.emit("SET_PREACTION", { action });
  }, []);

  const requestLoanFn = useCallback((creditorSeatIndex: number, amount: number) => {
    socketRef.current?.emit("REQUEST_LOAN", { creditorSeatIndex, amount });
  }, []);

  const respondLoanFn = useCallback((requestId: string, approve: boolean) => {
    socketRef.current?.emit("RESPOND_LOAN", { requestId, approve });
  }, []);

  const repayLoanFn = useCallback((creditorSeatIndex: number, amount: number) => {
    socketRef.current?.emit("REPAY_LOAN", { creditorSeatIndex, amount });
  }, []);

  // ---- Twenty-Nine actions ----
  const tnBidFn = useCallback((bid?: number) => {
    socketRef.current?.emit("GAME29_BID", bid === undefined ? {} : { bid });
  }, []);
const tnDeclareTrumpFn = useCallback((choice: TnSuit | "SEVENTH_CARD" | "JOKER") => {
    socketRef.current?.emit("GAME29_DECLARE_TRUMP", { choice });
  }, []);
  const tnCallTrumpFn = useCallback(() => {
    socketRef.current?.emit("GAME29_CALL_TRUMP", {});
  }, []);
  const tnDeclareMarriageFn = useCallback((suit: TnSuit) => {
    socketRef.current?.emit("GAME29_DECLARE_MARRIAGE", { suit });
  }, []);
  const tnPlayCardFn = useCallback((card: TnCard) => {
    socketRef.current?.emit("GAME29_PLAY_CARD", { card });
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      setMuted(on); // flipping ON→off means muted=true
      return !on;
    });
  }, []);

  const gameType: GameType = me?.config?.gameType ?? "POKER";

  const value = useMemo<GameContextValue>(
    () => ({
      serverUrl: SERVER_URL,
      status,
      me,
      state,
      gameType,
      tnState,
      tnResolvedTrick,
      myTnCards,
      tnBidderPrivate,
      lastTnRound,
      myCards,
      showdown,
      clearShowdown: () => setShowdown(null),
      toast,
      pushToast,
      incomingLoan,
      dismissIncomingLoan: () => setIncomingLoan(null),
      session,
      recentHands,
      timeline,
      celebration,
      clearCelebration,
      soundOn,
      toggleSound,
      createRoom,
      joinRoom,
      tryReconnect,
      leaveRoom,
      act,
      setPreaction: setPreactionFn,
      requestLoan: requestLoanFn,
      respondLoan: respondLoanFn,
      repayLoan: repayLoanFn,
      tnBid: tnBidFn,
      tnDeclareTrump: tnDeclareTrumpFn,
      tnCallTrump: tnCallTrumpFn,
      tnDeclareMarriage: tnDeclareMarriageFn,
      tnPlayCard: tnPlayCardFn,
    }),
    [
      status, me, state, gameType, tnState, myTnCards, tnBidderPrivate, lastTnRound,
      myCards, showdown, toast, incomingLoan,
      session, recentHands, timeline, celebration, clearCelebration, soundOn, toggleSound,
      createRoom, joinRoom, tryReconnect, leaveRoom, act, setPreactionFn,
      requestLoanFn, respondLoanFn, repayLoanFn,
      tnBidFn, tnDeclareTrumpFn, tnCallTrumpFn, tnDeclareMarriageFn, tnPlayCardFn,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>");
  return ctx;
}

/** Kept for potential future direct use of category ordering. */
export const BEST_CATEGORY = HandCategory.ROYAL_FLUSH;
