import { Card } from "./card";

export enum GamePhase {
  WAITING_FOR_PLAYERS = "WAITING_FOR_PLAYERS",
  STARTING_HAND = "STARTING_HAND",
  PRE_FLOP = "PRE_FLOP",
  FLOP = "FLOP",
  TURN = "TURN",
  RIVER = "RIVER",
  SHOWDOWN = "SHOWDOWN",
  PAYOUT = "PAYOUT",
  NEXT_HAND = "NEXT_HAND",
}

export type PlayerAction = "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE" | "ALL_IN";

export type SeatStatus =
  | "EMPTY"
  | "SITTING_OUT" // has a seat but not in current hand (joined mid-hand, or sat out)
  | "ACTIVE" // in the hand, can act
  | "FOLDED"
  | "ALL_IN"
  | "DISCONNECTED" // temporarily disconnected, seat preserved
  | "BUSTED"; // zero coins; may request a loan or leave+rebuy (seat kept while connected)

export interface Seat {
  seatIndex: number; // 0-9
  playerId: string | null;
  username: string | null;
  /** Chosen avatar picture index (1-10); undefined = letter-disc fallback. */
  avatar?: number;
  coins: number;
  currentBetThisRound: number;
  totalInvestedThisHand: number;
  status: SeatStatus;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  holeCards: Card[] | null; // only ever sent to the seat's own client
  /** Loans this seat still owes: creditorSeatIndex (stringified) -> amount outstanding. */
  debtTo?: Record<string, number>;
  /** Queued "act ahead of turn" intent: CHECK = check if free else fold; FOLD = fold. */
  preAction?: "CHECK" | "FOLD" | null;
}

export interface Pot {
  amount: number;
  eligibleSeatIndexes: number[];
}

/**
 * The state broadcast to all clients. Hole cards for other players are
 * ALWAYS stripped server-side before this is sent to a given socket -
 * see server/websocket/serializeStateForSeat.
 */
export interface PublicGameState {
  gameId: string;
  roomCode?: string;
  phase: GamePhase;
  seats: Seat[];
  communityCards: Card[];
  pots: Pot[];
  currentBet: number;
  minRaiseIncrement: number;
  actingSeatIndex: number | null;
  dealerSeatIndex: number | null;
  turnDeadline: number | null; // server unix-ms timestamp; client computes remaining time locally
  /** When phase is between hands and ≥2 eligible players exist: ms epoch of the scheduled deal. */
  nextHandDeadline?: number | null;
  smallBlind: number;
  bigBlind: number;
  handNumber: number;
  lastAction: { seatIndex: number; action: PlayerAction; amount?: number } | null;
}
