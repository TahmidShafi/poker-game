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
  PlayerAction,
  PublicGameState,
  RoomConfig,
  RoomAck,
  ShowdownResult,
} from "@poker/shared-types";
import { createSocket, SERVER_URL, type PokerSocket } from "./socket";

export type ConnStatus = "connecting" | "online" | "offline";

interface Me {
  config?: RoomConfig;
  roomCode: string;
  seatIndex: number;
  sessionToken: string;
}

export interface LoanRequestView {
  requestId: string;
  debtorSeatIndex: number;
  debtorUsername: string;
  creditorSeatIndex: number;
  amount: number;
  deadline: number;
}

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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    socket.on("YOUR_HOLE_CARDS", (cards) => setMyCards(cards));

    socket.on("SHOWDOWN", ({ results }) => setShowdown(results));

    socket.on("HAND_FINISHED", () => {
      // Keep the winner banner visible briefly, then clear.
      setTimeout(() => setShowdown(null), 4200);
    });

    socket.on("ACTION_REJECTED", ({ reason }) => pushToast(reason, "error"));

    socket.on("ERROR", ({ message }) => pushToast(message, "error"));

    socket.on("LOAN_REQUESTED", (payload) => setIncomingLoan(payload));
    socket.on("LOAN_RESOLVED", () => setIncomingLoan(null));
    socket.on("LOAN_REPAID", () => pushToast("loan repaid", "info"));

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
        setMe({ roomCode: ack.roomCode, seatIndex: ack.seatIndex!, sessionToken: token, config: ack.config });
        setState(ack.state ?? null);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ROOM_KEY);
      }
    });
  }, [status, me]);

  const bindAck = useCallback(
    (socket: PokerSocket, ack: RoomAck) => {
      if (ack.ok && ack.roomCode && ack.sessionToken) {
        localStorage.setItem(TOKEN_KEY, ack.sessionToken);
        localStorage.setItem(ROOM_KEY, ack.roomCode);
        setMe({
          roomCode: ack.roomCode,
          seatIndex: ack.seatIndex!,
          sessionToken: ack.sessionToken,
        });
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
        s.emit(
          "CREATE_ROOM",
          { username, ...cfg },
          (ack) => resolve(bindAck(s, ack))
        );
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
        setMe({ roomCode: ack.roomCode, seatIndex: ack.seatIndex!, sessionToken: token, config: ack.config });
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
      status, me, state, myCards, showdown, toast, incomingLoan, pushToast,
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
