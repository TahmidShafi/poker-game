import { Card } from "./card";
import { PublicGameState, PlayerAction, SeatStatus } from "./game";
import { EvaluatedHand } from "./hand";
import {
  GameType,
  PublicTwentyNineState,
  TnBidPayload,
  TnBidderPrivatePayload,
  TnCallTrumpPayload,
  TnDeclareMarriagePayload,
  TnDeclareTrumpPayload,
  TnPlayCardPayload,
  TnSingleHandDecisionPayload,
  TnRoundSummary,
  TnSuit,
  TnTeam,
  TnTeamTotals,
  TnTrickPlay,
  YourTnHandPayload,
} from "./twentynine";

// ---- Shared room config (creator-only; frozen once the room exists) ----

export interface RoomConfig {
  startingCoins: number;
  smallBlind: number;
  bigBlind: number;
  turnTimeSeconds: number;
  /** Absent/undefined on legacy clients => POKER. */
  gameType?: GameType;
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
  /** Absent => POKER (legacy clients). */
  gameType?: GameType;
  /** TWENTY_NINE only: fill the other three seats with server-side bots (single player). */
  vsBots?: boolean;
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
  // ---- Twenty-Nine moves (routed only in TWENTY_NINE rooms) ----
  GAME29_BID: (payload: TnBidPayload) => void;
  GAME29_DECLARE_TRUMP: (payload: TnDeclareTrumpPayload) => void;
  GAME29_CALL_TRUMP: (payload: TnCallTrumpPayload) => void;
  GAME29_DECLARE_MARRIAGE: (payload: TnDeclareMarriagePayload) => void;
  GAME29_PLAY_CARD: (payload: TnPlayCardPayload) => void;
  GAME29_SINGLE_HAND_DECISION: (payload: TnSingleHandDecisionPayload) => void;
  GAME29_FILL_BOTS: () => void;
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
  /** Which UI the client should render for this room (absent on legacy acks => POKER). */
  gameType?: GameType;
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
  // ---- Twenty-Nine (only emitted in TWENTY_NINE rooms) ----
  /** Full authoritative public snapshot, identical for all sockets (no per-seat hidden data exists in it). */
  TN_STATE: (state: PublicTwentyNineState) => void;
  /** Private: this seat's cards only. Never contains any other seat's cards. */
  YOUR_TN_HAND: (payload: YourTnHandPayload) => void;
  /** Private: bid winner only. Carries the seventh-card indicator in SEVENTH_CARD mode. */
  TN_BIDDER_PRIVATE: (payload: TnBidderPrivatePayload) => void;
  TN_TRICK_RESOLVED: (payload: {
    trickNumber: number;
    plays: TnTrickPlay[];
    winnerSeatIndex: number;
    winnerTeam: TnTeam;
    pointsWon: number;
  }) => void;
  /** The moment hidden trump becomes public. suit is always defined here (joker mode never fires this). */
  TN_TRUMP_REVEALED: (payload: { suit: TnSuit; revealedBySeatIndex: number }) => void;
  TN_ROUND_FINISHED: (payload: { summary: TnRoundSummary }) => void;
  TN_MATCH_FINISHED: (payload: { winnerTeam: TnTeam; finalScore: TnTeamTotals }) => void;
}

/** Helper type guard surface shared with the web app. */
export type ActingSeatStatus = SeatStatus;
