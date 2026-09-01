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
import { accumulateTnHand, sortTnCards, type AccumulatedHand } from "./tnHand";
import {
  isMuted,
  playChips,
  playTurn,
  playWin,
  setMuted,
  unlockAudio,
  subscribeAudioState,
} from "./sound";
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
  isReconnecting?: boolean;
  audioUnlocked?: boolean;
  unlockAudio?: () => Promise<boolean>;
  me: Me | null;
  state: PublicGameState | null;
  /** Which game the current room plays ("POKER" until seated in a 29 room). */
  gameType: GameType;
  // ---- Twenty-Nine slices ----
  tnState: PublicTwentyNineState | null;
  tnResolvedTrick: { plays: { seatIndex: number; card: TnCard }[]; winnerSeatIndex?: number } | null;
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
  removePlayer: (targetSeatIndex: number) => void;
  // ---- Twenty-Nine actions ----
  tnBid: (bid?: number) => void;
  tnDeclareTrump: (choice: TnSuit | "SEVENTH_CARD" | "JOKER") => void;
  tnCallTrump: () => void;
  tnDeclareMarriage: (suit: TnSuit) => void;
  tnPlayCard: (card: TnCard) => void;
  tnSingleHandDecision: (declare: boolean) => void;
  tnFillBots: () => void;
  tnSyncHand: () => void;
}

// Exported so dev-only tooling (e.g. the /dev/tn-preview visual harness) can
// supply a mock value without touching the socket lifecycle.
export const GameContext = createContext<GameContextValue | null>(null);

const TOKEN_KEY = "poker.sessionToken";
const ROOM_KEY = "poker.roomCode";

export function GameProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<PokerSocket | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [isReconnecting, setIsReconnecting] = useState<boolean>(
    () => typeof window !== "undefined" && Boolean(localStorage.getItem(TOKEN_KEY))
  );
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);

  useEffect(() => {
    return subscribeAudioState((unlocked) => {
      setAudioUnlocked(unlocked);
    });
  }, []);

  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<PublicGameState | null>(null);
  const [tnState, setTnState] = useState<PublicTwentyNineState | null>(null);
  const [tnResolvedTrick, setTnResolvedTrick] = useState<{ plays: { seatIndex: number; card: TnCard }[]; winnerSeatIndex?: number } | null>(null);
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
  const showdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mutable refs used inside socket handlers (avoid stale closures).
  const meRef = useRef<Me | null>(null);
  const tnStateRef = useRef<PublicTwentyNineState | null>(null);
  const myTnCardsRef = useRef<TnCard[] | null>(null);
  const syncPendingRef = useRef<{ handNumber: number; requestedAt: number } | null>(null);

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
      myTnCardsRef.current = null;
      setMyTnCards(null);
      return;
    }
    const played =
      tnPlayedRef.current && tnPlayedRef.current.handNumber === hand.handNumber
        ? tnPlayedRef.current.keys
        : null;
    const remaining = played
      ? hand.cards.filter((c) => !played.has(`${c.suit}:${c.rank}`))
      : hand.cards;
    const sorted = sortTnCards(remaining);
    myTnCardsRef.current = sorted;
    setMyTnCards(sorted);
  }, []);

  const requestTnHandSync = useCallback((reason: string) => {
    const socket = socketRef.current;
    const mine = meRef.current;
    const state = tnStateRef.current;
    if (!socket || !socket.connected || !mine || mine.seatIndex === undefined || !state) {
      return;
    }

    const now = Date.now();
    const pending = syncPendingRef.current;
    // Throttle / debounce: if already pending for this round and requested within 1500ms, wait
    if (pending && pending.handNumber === state.roundNumber && now - pending.requestedAt < 1500) {
      return;
    }

    syncPendingRef.current = {
      handNumber: state.roundNumber,
      requestedAt: now,
    };

    if (process.env.NODE_ENV !== "test" || process.env.NEXT_PUBLIC_TN_DEBUG === "1") {
      console.log(
        `[TN_SYNC] Requesting hand sync (reason: ${reason}, round: ${state.roundNumber}, seat: ${mine.seatIndex})`
      );
    }
    socket.emit("GAME29_SYNC_HAND");
  }, []);

  const evaluateHandSync = useCallback((reason: string) => {
    const mine = meRef.current;
    const state = tnStateRef.current;
    const myCards = myTnCardsRef.current;
    const accumulated = myTnHandRef.current;

    if (!mine || mine.seatIndex === undefined || !state) return;

    const isGameActive =
      state.phase === "BIDDING" ||
      state.phase === "TRUMP_SETUP" ||
      state.phase === "SINGLE_HAND_DECISION" ||
      state.phase === "PLAYING";

    if (!isGameActive) return;

    const mySeatView = state.seats.find((st) => st.seatIndex === mine.seatIndex);
    if (!mySeatView || mySeatView.username === null || mySeatView.isInactive) return;

    const serverCardsCount = mySeatView.cardsRemaining;
    if (serverCardsCount <= 0) return;

    // Criteria for out-of-sync / missing hand:
    const missingCards = myCards === null || myCards.length === 0;
    const missingAccumulated = accumulated === null || accumulated.handNumber !== state.roundNumber;
    const countMismatch = myCards !== null && myCards.length !== serverCardsCount;
    const isMyTurn = state.actingSeatIndex === mine.seatIndex;
    const urgentTurnMissing = isMyTurn && (missingCards || countMismatch);

    if (missingCards || missingAccumulated || countMismatch || urgentTurnMissing) {
      requestTnHandSync(
        `${reason} (missingCards=${missingCards}, countMismatch=${countMismatch}, local=${myCards?.length ?? 0}, server=${serverCardsCount}, turn=${isMyTurn})`
      );
    }
  }, [requestTnHandSync]);

  useEffect(() => {
    meRef.current = me;
    publishMyTnHand();
    evaluateHandSync("ME_STATE_UPDATED");
  }, [me, publishMyTnHand, evaluateHandSync]);

  useEffect(() => {
    tnStateRef.current = tnState;
    evaluateHandSync("TN_STATE_UPDATED");
  }, [tnState, evaluateHandSync]);

  useEffect(() => {
    myTnCardsRef.current = myTnCards;
  }, [myTnCards]);

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

  const clearShowdown = useCallback(() => {
    if (showdownTimer.current) {
      clearTimeout(showdownTimer.current);
      showdownTimer.current = null;
    }
    setShowdown(null);
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
      if (showdownTimer.current) clearTimeout(showdownTimer.current);
      showdownTimer.current = setTimeout(() => {
        showdownTimer.current = null;
        setShowdown(null);
      }, 4200);
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
        evaluateHandSync("TURN_CHANGED_TO_ME");
      }
    });

    socket.on("ACTION_REJECTED", ({ reason }) => pushToast(reason, "error"));
    socket.on("ERROR", ({ message }) => pushToast(message, "error"));

    // ---- Twenty-Nine ----
    socket.on("TN_STATE", (s) => {
      if (s.marriageDeclaredBy && !tnStateRef.current?.marriageDeclaredBy) {
        const mySeat = meRef.current?.seatIndex ?? -1;
        const myTeam = mySeat >= 0 ? (mySeat % 2 === 0 ? "A" : "B") : null;
        const isUs = myTeam !== null && s.marriageDeclaredBy === myTeam;
        pushToast(
          isUs
            ? "Marriage (K+Q) automatically activated for your team! (±4)"
            : `Marriage (K+Q) automatically activated for Team ${s.marriageDeclaredBy}! (±4)`,
          "info"
        );
      }

      setTnState(s);
      tnStateRef.current = s;

      const mine = meRef.current;
      if (!mine || s.actingSeatIndex !== mine.seatIndex) endTurnAlerts();

      // Record my cards visible in the current trick as played.
      const hand = myTnHandRef.current;
      const mySeat = mine?.seatIndex;
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

      evaluateHandSync("TN_STATE_RECEIVED");
    });
    socket.on("YOUR_TN_HAND", (payload) => {
      if (process.env.NODE_ENV !== "test" || process.env.NEXT_PUBLIC_TN_DEBUG === "1") {
        console.log(
          `[TN_SYNC] YOUR_TN_HAND received: batch=${payload.batch} handNumber=${payload.handNumber} cards=${payload.cards.length}`
        );
      }
      syncPendingRef.current = null;
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
      setTnResolvedTrick({ plays: p.plays, winnerSeatIndex: p.winnerSeatIndex });
      if (resolvedTrickTimer.current) clearTimeout(resolvedTrickTimer.current);
      resolvedTrickTimer.current = setTimeout(() => setTnResolvedTrick(null), 2000);

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
    socket.on("PLAYER_REMOVED", (payload) => {
      if (meRef.current?.seatIndex === payload.seatIndex) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ROOM_KEY);
        meRef.current = null;
        setMe(null);
        pushToast("You were removed from the room by the host", "info");
      }
    });

    return () => {
      endTurnAlerts();
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (showdownTimer.current) clearTimeout(showdownTimer.current);
      if (resolvedTrickTimer.current) clearTimeout(resolvedTrickTimer.current);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [pushToast, triggerCelebration, publishMyTnHand]);

  // Auto-reconnect via stored token whenever the socket comes online.
  useEffect(() => {
    if (status !== "online") {
      if (status === "offline") setIsReconnecting(false);
      return;
    }
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    const currentToken = meRef.current?.sessionToken ?? token;
    if (!currentToken) {
      setIsReconnecting(false);
      return;
    }

    const s = socketRef.current;
    if (!s) return;

    setIsReconnecting(true);
    let resolved = false;
    const fallbackTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setIsReconnecting(false);
      }
    }, 6000);

    s.emit("RECONNECT", { sessionToken: currentToken }, (ack) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(fallbackTimer);
      setIsReconnecting(false);
      if (ack.ok && ack.roomCode) {
        const cleanCode = ack.roomCode.trim().toUpperCase();
        localStorage.setItem(TOKEN_KEY, currentToken);
        localStorage.setItem(ROOM_KEY, cleanCode);
        const newMe = {
          roomCode: cleanCode,
          seatIndex: ack.seatIndex!,
          sessionToken: currentToken,
          config: ack.config,
        };
        meRef.current = newMe;
        setMe(newMe);
        setState(ack.state ?? null);
        if (ack.tnState) {
          setTnState(ack.tnState);
          tnStateRef.current = ack.tnState;
        }
        // If Twenty-Nine, trigger hand sync immediately to recover cards if needed
        if (ack.config?.gameType === "TWENTY_NINE" || ack.gameType === "TWENTY_NINE") {
          s.emit("GAME29_SYNC_HAND");
        }
      } else {
        const err = (ack.error ?? "").toLowerCase();
        // Only clear storage if the session/room is genuinely gone/closed
        if (
          err.includes("session not found") ||
          err.includes("no longer exists") ||
          err.includes("table may have closed")
        ) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(ROOM_KEY);
          meRef.current = null;
          setMe(null);
        }
      }
    });
  }, [status]);

  // Restore mute preference.
  useEffect(() => { setSoundOn(!isMuted()); }, []);

  const bindAck = useCallback(
    (socket: PokerSocket, ack: RoomAck) => {
      if (ack.ok && ack.roomCode && ack.sessionToken) {
        const cleanCode = ack.roomCode.trim().toUpperCase();
        const prevCode = meRef.current?.roomCode;
        localStorage.setItem(TOKEN_KEY, ack.sessionToken);
        localStorage.setItem(ROOM_KEY, cleanCode);
        const newMe = {
          roomCode: cleanCode,
          seatIndex: ack.seatIndex!,
          sessionToken: ack.sessionToken,
          config: ack.config,
        };
        meRef.current = newMe;
        setMe(newMe);
        if (ack.state) {
          setState(ack.state);
        } else if (ack.config?.gameType === "TWENTY_NINE" || ack.gameType === "TWENTY_NINE") {
          setState(null);
        }
        setMyCards(null);
        setShowdown(null);
        if (showdownTimer.current) {
          clearTimeout(showdownTimer.current);
          showdownTimer.current = null;
        }
        if (ack.tnState) {
          setTnState(ack.tnState);
          tnStateRef.current = ack.tnState;
        } else if (ack.config?.gameType !== "TWENTY_NINE" && ack.gameType !== "TWENTY_NINE") {
          setTnState(null);
          tnStateRef.current = null;
        }
        // Only wipe out hand cards if changing to a different room
        if (prevCode && prevCode !== cleanCode) {
          setMyTnCards(null);
          myTnHandRef.current = null;
          tnPlayedRef.current = null;
        }
        setTnBidderPrivate(null);
        setLastTnRound(null);
        setTnResolvedTrick(null);
        if (resolvedTrickTimer.current) {
          clearTimeout(resolvedTrickTimer.current);
          resolvedTrickTimer.current = null;
        }
        setSession(EMPTY_STATS);
        setRecentHands([]);
        if (ack.config?.gameType === "TWENTY_NINE" || ack.gameType === "TWENTY_NINE") {
          socket.emit("GAME29_SYNC_HAND");
        }
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
      void unlockAudio();
      const s = socketRef.current!;
      const cleanName = username.trim();
      return new Promise<RoomAck>((resolve) => {
        s.emit(
          "CREATE_ROOM",
          { username: cleanName, ...cfg, avatar, ...(extra ?? {}) },
          (ack) => resolve(bindAck(s, ack))
        );
      });
    },
    [bindAck]
  );

  const joinRoom = useCallback(
    (roomCode: string, username: string, avatar?: number) => {
      void unlockAudio();
      const s = socketRef.current!;
      const cleanCode = roomCode.trim().toUpperCase();
      const cleanName = username.trim();
      const storedRoom = typeof window !== "undefined" ? localStorage.getItem(ROOM_KEY) : null;
      const storedToken = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
      // Only attach sessionToken if it is from the EXACT same room code
      const sessionToken =
        storedRoom && storedRoom.trim().toUpperCase() === cleanCode && storedToken
          ? storedToken
          : undefined;

      return new Promise<RoomAck>((resolve) => {
        s.emit(
          "JOIN_ROOM",
          { username: cleanName, roomCode: cleanCode, avatar, sessionToken },
          (ack) => resolve(bindAck(s, ack))
        );
      });
    },
    [bindAck]
  );

  const tryReconnect = useCallback((token: string) => {
    void unlockAudio();
    const s = socketRef.current;
    if (!s) return;
    setIsReconnecting(true);
    s.emit("RECONNECT", { sessionToken: token }, (ack) => {
      setIsReconnecting(false);
      if (ack.ok && ack.roomCode) {
        const cleanCode = ack.roomCode.trim().toUpperCase();
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(ROOM_KEY, cleanCode);
        const newMe = {
          roomCode: cleanCode,
          seatIndex: ack.seatIndex!,
          sessionToken: token,
          config: ack.config,
        };
        meRef.current = newMe;
        setMe(newMe);
        setState(ack.state ?? null);
        if (ack.tnState) {
          setTnState(ack.tnState);
          tnStateRef.current = ack.tnState;
        }
        if (ack.config?.gameType === "TWENTY_NINE" || ack.gameType === "TWENTY_NINE") {
          s.emit("GAME29_SYNC_HAND");
        }
      } else {
        const err = (ack.error ?? "").toLowerCase();
        if (
          err.includes("session not found") ||
          err.includes("no longer exists") ||
          err.includes("table may have closed")
        ) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(ROOM_KEY);
          meRef.current = null;
          setMe(null);
        }
      }
    });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("LEAVE_ROOM");
    endTurnAlerts();
    if (showdownTimer.current) {
      clearTimeout(showdownTimer.current);
      showdownTimer.current = null;
    }
    if (resolvedTrickTimer.current) {
      clearTimeout(resolvedTrickTimer.current);
      resolvedTrickTimer.current = null;
    }
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    if (celebrationTimer.current) {
      clearTimeout(celebrationTimer.current);
      celebrationTimer.current = null;
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROOM_KEY);
    meRef.current = null;
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
    setTnResolvedTrick(null);
    setCelebration(null);
    setToast(null);
  }, []);

  const act = useCallback((action: PlayerAction, amount?: number) => {
    void unlockAudio();
    socketRef.current?.emit("PLAYER_ACTION", amount === undefined ? { action } : { action, amount });
  }, []);

  const setPreactionFn = useCallback((action: "CHECK" | "FOLD" | null) => {
    void unlockAudio();
    socketRef.current?.emit("SET_PREACTION", { action });
  }, []);

  const requestLoanFn = useCallback((creditorSeatIndex: number, amount: number) => {
    void unlockAudio();
    socketRef.current?.emit("REQUEST_LOAN", { creditorSeatIndex, amount });
  }, []);

  const respondLoanFn = useCallback((requestId: string, approve: boolean) => {
    void unlockAudio();
    socketRef.current?.emit("RESPOND_LOAN", { requestId, approve });
  }, []);

  const repayLoanFn = useCallback((creditorSeatIndex: number, amount: number) => {
    void unlockAudio();
    socketRef.current?.emit("REPAY_LOAN", { creditorSeatIndex, amount });
  }, []);

  const removePlayerFn = useCallback((targetSeatIndex: number) => {
    void unlockAudio();
    socketRef.current?.emit("REMOVE_PLAYER", { targetSeatIndex });
  }, []);

  // ---- Twenty-Nine actions ----
  const tnBidFn = useCallback((bid?: number) => {
    void unlockAudio();
    socketRef.current?.emit("GAME29_BID", bid === undefined ? {} : { bid });
  }, []);
  const tnDeclareTrumpFn = useCallback((choice: TnSuit | "SEVENTH_CARD" | "JOKER") => {
    void unlockAudio();
    socketRef.current?.emit("GAME29_DECLARE_TRUMP", { choice });
  }, []);
  const tnCallTrumpFn = useCallback(() => {
    void unlockAudio();
    socketRef.current?.emit("GAME29_CALL_TRUMP", {});
  }, []);
  const tnDeclareMarriageFn = useCallback((suit: TnSuit) => {
    void unlockAudio();
    socketRef.current?.emit("GAME29_DECLARE_MARRIAGE", { suit });
  }, []);
  const tnPlayCardFn = useCallback((card: TnCard) => {
    void unlockAudio();
    socketRef.current?.emit("GAME29_PLAY_CARD", { card });
  }, []);
  const tnSingleHandDecisionFn = useCallback((declare: boolean) => {
    void unlockAudio();
    socketRef.current?.emit("GAME29_SINGLE_HAND_DECISION", { declare });
  }, []);
  const tnFillBotsFn = useCallback(() => {
    void unlockAudio();
    socketRef.current?.emit("GAME29_FILL_BOTS");
  }, []);
  const tnSyncHandFn = useCallback(() => {
    socketRef.current?.emit("GAME29_SYNC_HAND");
  }, []);

  const toggleSound = useCallback(() => {
    void unlockAudio();
    setSoundOn((on) => {
      setMuted(on); // flipping ON→off means muted=true
      return !on;
    });
  }, []);

  const dismissIncomingLoan = useCallback(() => {
    setIncomingLoan(null);
  }, []);

  const gameType: GameType = me?.config?.gameType ?? "POKER";

  const value: GameContextValue = useMemo(
    () => ({
      serverUrl: SERVER_URL,
      status,
      isReconnecting,
      audioUnlocked,
      unlockAudio,
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
      clearShowdown,
      toast,
      pushToast,
      incomingLoan,
      dismissIncomingLoan,
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
      removePlayer: removePlayerFn,
      tnBid: tnBidFn,
      tnDeclareTrump: tnDeclareTrumpFn,
      tnCallTrump: tnCallTrumpFn,
      tnDeclareMarriage: tnDeclareMarriageFn,
      tnPlayCard: tnPlayCardFn,
      tnSingleHandDecision: tnSingleHandDecisionFn,
      tnFillBots: tnFillBotsFn,
      tnSyncHand: tnSyncHandFn,
    }),
    [
      status, isReconnecting, audioUnlocked, me, state, gameType, tnState, tnResolvedTrick, myTnCards, tnBidderPrivate, lastTnRound,
      myCards, showdown, clearShowdown, toast, pushToast, incomingLoan, dismissIncomingLoan,
      session, recentHands, timeline, celebration, clearCelebration, soundOn, toggleSound,
      createRoom, joinRoom, tryReconnect, leaveRoom, act, setPreactionFn,
      requestLoanFn, respondLoanFn, repayLoanFn, removePlayerFn,
      tnBidFn, tnDeclareTrumpFn, tnCallTrumpFn, tnDeclareMarriageFn, tnPlayCardFn, tnSingleHandDecisionFn, tnFillBotsFn, tnSyncHandFn,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>");
  return ctx;
}

export function useMySeat(): number | null {
  const { me } = useGame();
  return me?.seatIndex ?? null;
}

export function useTnState(): PublicTwentyNineState | null {
  const { tnState } = useGame();
  return tnState;
}

export function useMyTnCards(): TnCard[] | null {
  const { myTnCards } = useGame();
  return myTnCards;
}

export function useTnBidderPrivate(): TnBidderPrivatePayload | null {
  const { tnBidderPrivate } = useGame();
  return tnBidderPrivate;
}

export function useTnResolvedTrick() {
  const { tnResolvedTrick } = useGame();
  return tnResolvedTrick;
}

/** Kept for potential future direct use of category ordering. */
export const BEST_CATEGORY = HandCategory.ROYAL_FLUSH;
