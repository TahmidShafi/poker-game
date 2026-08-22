import { Card, Rank, Seat, Suit } from "@poker/shared-types";
import { BettingRoundState } from "../betting";
import { MAX_SEATS } from "../game";

/** Deterministic PRNG (mulberry32) for reproducible soak tests. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function c(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

export interface MkSeatOptions {
  coins?: number;
  bet?: number;
  invested?: number;
  status?: Seat["status"];
  username?: string | null;
}

export function mkSeat(seatIndex: number, opts: MkSeatOptions = {}): Seat {
  return {
    seatIndex,
    playerId: opts.status === "EMPTY" ? null : `p${seatIndex}`,
    username: opts.username === undefined ? `P${seatIndex}` : opts.username,
    coins: opts.coins ?? 10000,
    currentBetThisRound: opts.bet ?? 0,
    totalInvestedThisHand: opts.invested ?? opts.bet ?? 0,
    status: opts.status ?? "ACTIVE",
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    holeCards: null,
    preAction: null,
  };
}

export function mkRound(
  seats: Seat[],
  opts: Partial<Omit<BettingRoundState, "seats">> = {}
): BettingRoundState {
  return {
    seats,
    currentBet: opts.currentBet ?? 0,
    minRaiseIncrement: opts.minRaiseIncrement ?? 100,
    actingSeatIndex: opts.actingSeatIndex ?? 0,
    actedThisRound:
      opts.actedThisRound ?? Array.from({ length: MAX_SEATS }, () => false),
    mayRaise: opts.mayRaise ?? Array.from({ length: MAX_SEATS }, () => true),
  };
}