import { Card } from "./card";
import { PublicGameState, PlayerAction, SeatStatus } from "./game";
import { EvaluatedHand } from "./hand";

// ---- Shared room config (creator-only; frozen once the room exists) ----

export interface RoomConfig {
  startingCoins: number;
  smallBlind: number;
  bigBlind: number;
  turnTimeSeconds: number;
}

// ---- Client -> Server (locked V1 protocol) ----

export interface CreateRoomPayload {
  username: string;
  /** Avatar picture index (1-10); ignored if out of range. */
  avatar?: number;
  startingCoins: number;
  smallBlind: number;
  bigBlind: number;
  turnTimeSeconds: number;
}

export interface JoinRoomPayload {
  username: string;
  roomCode: string;
  /** Avatar picture index (1-10); ignored if out of range. */
  avatar?: number;
  /** Present when rejoining a room you were previously seated in. */
  sessionToken?: string;
}

export interface ReconnectPayload {
  sessionToken: string;
}

export interface PlayerActionPayload {
  action: PlayerAction;
  amount?: number; // required for BET and RAISE (raise-TO amount, not raise-BY)
}

export interface SetPreactionPayload {
  /** CHECK = check if free else fold when the turn arrives; null clears. */
  action: "CHECK" | "FOLD" | null;
}

export interface RequestLoanPayload {
  creditorSeatIndex: number;
  amount: number;
}

export interface RespondLoanPayload {
  requestId: string;
  approve: boolean;
}

export interface RepayLoanPayload {
  creditorSeatIndex: number;
  amount: number;
}

export interface ClientToServerEvents {
  CREATE_ROOM: (payload: CreateRoomPayload, ack: (res: RoomAck) => void) => void;
  JOIN_ROOM: (payload: JoinRoomPayload, ack: (res: RoomAck) => void) => void;
  LEAVE_ROOM: () => void;
  PLAYER_ACTION: (payload: PlayerActionPayload) => void;
  SET_PREACTION: (payload: SetPreactionPayload) => void;
  RECONNECT: (payload: ReconnectPayload, ack: (res: RoomAck) => void) => void;
  REQUEST_LOAN: (payload: RequestLoanPayload) => void;
  RESPOND_LOAN: (payload: RespondLoanPayload) => void;
  REPAY_LOAN: (payload: RepayLoanPayload) => void;
}

/** Acknowledgement payload for CREATE_ROOM / JOIN_ROOM / RECONNECT. */
export interface RoomAck {
  ok: boolean;
  error?: string;
  sessionToken?: string;
  seatIndex?: number;
  roomCode?: string;
  config?: RoomConfig;
  state?: PublicGameState;
}

// ---- Server -> Client ----

export interface ShowdownResult {
  seatIndex: number;
  username: string;
  hand: EvaluatedHand;
  amountWon: number;
  potIndex: number;
}

export interface HandFinishedSummary {
  handNumber: number;
  pots: PublicGameState["pots"];
  awards: {
    seatIndex: number;
    username: string;
    amount: number;
    potIndex?: number;
  }[];
  bustedSeats: number[];
  /** Present when the hand reached showdown (used for stats' best-hand). */
  results?: ShowdownResult[];
}

export type ServerEvent =
  | { type: "GAME_STATE" }
  | { type: "TURN_CHANGED" }
  | { type: "ACTION_ACCEPTED" }
  | { type: "ACTION_REJECTED" }
  | { type: "LOAN_REQUESTED" }
  | { type: "LOAN_RESOLVED" }
  | { type: "LOAN_REPAID" };

export interface LoanRequestedEvent {
  requestId: string;
  debtorSeatIndex: number;
  debtorUsername: string;
  creditorSeatIndex: number;
  amount: number;
  deadline: number;
}

export interface ServerToClientEvents {
  /** Full authoritative snapshot (hole cards stripped per recipient). */
  GAME_STATE: (state: PublicGameState) => void;
  YOUR_HOLE_CARDS: (cards: Card[]) => void;
  PLAYER_JOINED: (payload: { seatIndex: number; username: string }) => void;
  PLAYER_LEFT: (payload: { seatIndex: number }) => void;
  HAND_STARTED: (payload: { handNumber: number; dealerSeatIndex: number }) => void;
  TURN_CHANGED: (payload: { seatIndex: number; deadline: number }) => void;
  ACTION_ACCEPTED: (payload: { seatIndex: number; action: PlayerAction; amount?: number }) => void;
  ACTION_REJECTED: (payload: { reason: string }) => void;
  COMMUNITY_CARDS: (payload: { cards: Card[] }) => void;
  POT_UPDATED: (payload: { pots: PublicGameState["pots"] }) => void;
  SHOWDOWN: (payload: { results: ShowdownResult[] }) => void;
  HAND_FINISHED: (payload: HandFinishedSummary) => void;
  PLAYER_RECONNECTED: (payload: { seatIndex: number; username: string }) => void;
  PREACTION_SET: (payload: { seatIndex: number; preAction: "CHECK" | "FOLD" | null }) => void;
  LOAN_REQUESTED: (payload: LoanRequestedEvent) => void;
  LOAN_RESOLVED: (payload: { requestId: string; approved: boolean; reason?: string }) => void;
  LOAN_REPAID: (payload: { debtorSeatIndex: number; creditorSeatIndex: number; amount: number }) => void;
  ERROR: (payload: { message: string }) => void;
}

/** Helper type guard surface shared with the web app. */
export type ActingSeatStatus = SeatStatus;
