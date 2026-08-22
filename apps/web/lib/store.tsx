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
  HandFinishedSummary,
  PlayerAction,
  PublicGameState,
  RoomConfig,
  RoomAck,
  ShowdownResult,
} from "@poker/shared-types";
import { describeHand, HandCategory } from "@poker/shared-types";
import { createSocket, SERVER_URL, type PokerSocket } from "./socket";
import { isMuted, playChips, playTurn, playWin, setMuted } from "./sound";

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

const EMPTY_STATS: SessionStats = {
  handsPlayed: 0,
  handsWon: 0,
  bestHandLabel: null,
  bestHandCategory: -1,
  biggestPotWon: 0,
};

interface GameContextValue {
  serverUrl: string;
  status: ConnStatus;
  me: Me | null;
  state: PublicGameState | null;
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
  soundOn: boolean;
  toggleSound: () => void;
  createRoom: (username: string, cfg: RoomConfig) => Promise<RoomAck>;
  joinRoom: (roomCode: string, username: string) => Promise<RoomAck>;
  tryReconnect: (token: string) => void;
  leaveRoom: () => void;
  act: (action: PlayerAction, amount?: number) => void;
  setPreaction: (action: "CHECK" | "FOLD" | null) => void;
  requestLoan: (creditorSeatIndex: number, amount: number) => void;
  respondLoan: (requestId: string, approve: boolean) => void;
  repayLoan: (creditorSeatIndex: number, amount: number) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

const TOKEN_KEY = "poker.sessionToken";
const ROOM_KEY = "poker.roomCode";

export function GameProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<PokerSocket | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<PublicGameState | null>(null);
  const [myCards, setMyCards] = useState<Card[] | null>(null);
  const [showdown, setShowdown] = useState<ShowdownResult[] | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "error" | "info" } | null>(null);
  const [incomingLoan, setIncomingLoan] = useState<LoanRequestView | null>(null);
  const [session, setSession] = useState<SessionStats>(EMPTY_STATS);
  const [recentHands, setRecentHands] = useState<RecentHand[]>([]);
  const [timeline, setTimeline] = useState<StreetTimeline>({
    preflop: null, flop: null, turn: null, river: null, showdown: null,
  });
  const [soundOn, setSoundOn] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mutable refs used inside socket handlers (avoid stale closures).
  const meRef = useRef<Me | null>(null);
  useEffect(() => { meRef.current = me; }, [me]);
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

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on("connect", () => setStatus("online"));
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", () => setStatus("offline"));

    socket.on("GAME_STATE", (s) => setState(s));

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
      }

      setShowdown((cur) => cur); // winner banner clears on its own timer below
      setTimeout(() => setShowdown(null), 4200);
      myDealtIn.current = false;
    });

    socket.on("TURN_CHANGED", ({ seatIndex }) => {
      if (meRef.current?.seatIndex === seatIndex) playTurn();
    });

    socket.on("ACTION_REJECTED", ({ reason }) => pushToast(reason, "error"));
    socket.on("ERROR", ({ message }) => pushToast(message, "error"));

    socket.on("LOAN_REQUESTED", (payload) => { setIncomingLoan(payload); playChips(); });
    socket.on("LOAN_RESOLVED", ({ approved }) => {
      setIncomingLoan(null);
      if (approved) playChips();
    });
    socket.on("LOAN_REPAID", () => { pushToast("loan repaid", "info"); playChips(); });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [pushToast]);

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
    (username: string, cfg: RoomConfig) => {
      const s = socketRef.current!;
      return new Promise<RoomAck>((resolve) => {
        s.emit("CREATE_ROOM", { username, ...cfg }, (ack) => resolve(bindAck(s, ack)));
      });
    },
    [bindAck]
  );

  const joinRoom = useCallback(
    (roomCode: string, username: string) => {
      const s = socketRef.current!;
      return new Promise<RoomAck>((resolve) => {
        s.emit("JOIN_ROOM", { username, roomCode }, (ack) => resolve(bindAck(s, ack)));
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
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROOM_KEY);
    setMe(null);
    setState(null);
    setMyCards(null);
    setShowdown(null);
    setSession(EMPTY_STATS);
    setRecentHands([]);
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

  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      setMuted(on); // flipping ON→off means muted=true
      return !on;
    });
  }, []);

  const value = useMemo<GameContextValue>(
    () => ({
      serverUrl: SERVER_URL,
      status,
      me,
      state,
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
    }),
    [
      status, me, state, myCards, showdown, toast, incomingLoan,
      session, recentHands, timeline, soundOn, toggleSound,
      createRoom, joinRoom, tryReconnect, leaveRoom, act, setPreactionFn,
      requestLoanFn, respondLoanFn, repayLoanFn,
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
