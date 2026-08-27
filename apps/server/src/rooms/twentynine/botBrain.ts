import {
  TnCard,
  TnPhase,
  tnCardPoints,
  TnSuit,
  TnTeamTotals,
  TnTrumpChoice,
  tnTeamOfSeat,
} from "@poker/shared-types";
import {
  canStay,
  minLegalBid,
  moveOptionsForSeat,
  TwentyNineState,
} from "@poker/twentynine-engine";

/**
 * CASUAL single-player bot brain. Pure functions: given the authoritative
 * state and a seat, return the action the bot takes. The MANAGER applies it
 * through the exact same pipeline as human moves, so every rule (bidding v2,
 * follow-suit, hidden trump, Σ29) is enforced identically.
 *
 * Heuristics are deliberately simple and deterministic-ish (seeded by round +
 * seat so games vary without RNG plumbing).
 */

export type BotDecision =
  | { kind: "BID"; bid: number }
  | { kind: "PASS" }
  | { kind: "DECLARE"; choice: TnTrumpChoice }
  | { kind: "CALL_TRUMP" }
  | { kind: "MARRIAGE"; suit: TnSuit }
  | { kind: "PLAY"; card: TnCard };

function handStats(hand: TnCard[]): { points: number; longest: number; bestSuit: TnSuit } {
  const bySuit = new Map<TnSuit, TnCard[]>();
  for (const c of hand) {
    const list = bySuit.get(c.suit) ?? [];
    list.push(c);
    bySuit.set(c.suit, list);
  }
  let longest = 0;
  let bestSuit: TnSuit = "SPADES";
  let bestScore = -1;
  let points = 0;
  for (const [suit, cards] of bySuit) {
    points += cards.reduce((s, c) => s + tnCardPoints(c), 0);
    const score = cards.length * 2 + cards.reduce((s, c) => s + tnCardPoints(c), 0);
    if (score > bestScore) {
      bestScore = score;
      longest = cards.length;
      bestSuit = suit;
    }
  }
  return { points, longest, bestSuit };
}

/** Bidding: open/raise with a strength-derived target, otherwise pass. */
export function decideBidding(state: TwentyNineState, seatIndex: number): BotDecision {
  const bids = state.bids!;
  const hand = state.seats[seatIndex]?.hand ?? [];
  const { points, longest } = handStats(hand);
  const strength = points + (longest >= 4 ? 1 : 0) + (longest >= 5 ? 1 : 0);
  const target = Math.min(21, 16 + Math.floor(strength / 2));

  const H = bids.highestBid;
  if (H === null) return { kind: "BID", bid: Math.max(16, target) };

  const holder = bids.bidderSeatIndex!;
  const sameSide = tnTeamOfSeat(holder) === tnTeamOfSeat(seatIndex);
  const min = minLegalBid(bids, seatIndex);

  if (sameSide) {
    // Don't fight the partner over a healthy contract.
    if (H >= target - 1 || min > 28) return { kind: "PASS" };
    return min <= Math.min(28, target + 1) ? { kind: "BID", bid: min } : { kind: "PASS" };
  }

  if (canStay(bids, seatIndex)) {
    // Defender deciding to Stay or Counter-Raise or Pass
    if (H > target) return { kind: "PASS" };
    if (strength >= 8 && target >= H + 2 && H + 1 <= 28) {
      return { kind: "BID", bid: H + 1 }; // counter-raise
    }
    return { kind: "BID", bid: H }; // Stay!
  }

  // Challenger deciding to Raise or Pass
  if (min <= Math.min(28, target)) {
    return { kind: "BID", bid: min };
  }
  return { kind: "PASS" };
}

/** Trump setup: usually the bot's strongest suit; occasionally 7th-card or joker flavour. */
export function chooseTrumpStyle(state: TwentyNineState, seatIndex: number): TnTrumpChoice {
  const hand = state.seats[seatIndex]?.hand ?? [];
  const { bestSuit } = handStats(hand);
  const flavor = (state.roundNumber * 31 + seatIndex * 7) % 10;
  if (flavor === 2) return "SEVENTH_CARD";
  if (flavor === 5) return "JOKER";
  return bestSuit;
}

function trickPoints(state: TwentyNineState): number {
  return state.currentTrick.reduce((s, p) => s + tnCardPoints(p.card), 0);
}

/** Who is currently winning the partial trick (mirrors standard resolution). */
function partialWinner(
  state: TwentyNineState,
  weight: (rank: TnCard["rank"]) => number
): number | null {
  const plays = state.currentTrick;
  if (plays.length === 0) return null;
  const ledSuit = plays[0]!.card.suit;
  let best = plays[0]!;
  for (const p of plays.slice(1)) {
    const trumpOn =
      state.trumpStyle !== "JOKER" &&
      state.trumpRevealed &&
      state.trumpSuit !== null;
    const pIsTrump = trumpOn && p.card.suit === state.trumpSuit;
    const bIsTrump = trumpOn && best.card.suit === state.trumpSuit;
    if (pIsTrump && !bIsTrump) best = p;
    else if (pIsTrump === bIsTrump && p.card.suit === (pIsTrump ? state.trumpSuit : ledSuit)) {
      const cmpSuit = pIsTrump ? state.trumpSuit! : ledSuit;
      if (best.card.suit === cmpSuit && weight(p.card.rank) > weight(best.card.rank)) best = p;
      else if (best.card.suit !== cmpSuit) best = p;
    }
  }
  return best.seatIndex;
}

/** Card play / optional trump-call / marriage declaration for the bot's turn. */
export function decidePlay(state: TwentyNineState, seatIndex: number): BotDecision | null {
  if (state.phase !== TnPhase.PLAYING) return null;
  const opts = moveOptionsForSeat(state, seatIndex);
  const legal = opts.legalCards;
  if (legal.length === 0) return null;

  if (opts.canDeclareMarriage && state.trumpSuit) {
    return { kind: "MARRIAGE", suit: state.trumpSuit };
  }

  const weight = (r: TnCard["rank"]) => r; // rank order suffices for casual play

  if (opts.canCallTrump) {
    const oppWinning = (() => {
      const w = partialWinner(state, weight);
      return w !== null && tnTeamOfSeat(w) !== tnTeamOfSeat(seatIndex);
    })();
    if (oppWinning && trickPoints(state) >= 2) return { kind: "CALL_TRUMP" };
  }

  const lowest = legal.reduce((m, c) => (c.rank < m.rank ? c : m));
  const highestPoint = legal.reduce((m, c) => {
    const pc = tnCardPoints(c) * 100 - c.rank;
    const pm = tnCardPoints(m) * 100 - m.rank;
    return pc > pm ? c : m;
  });

  if (state.currentTrick.length === 0) {
    // Leading: open with the most valuable card (casual aggression).
    return { kind: "PLAY", card: highestPoint };
  }

  if (state.currentTrick.length === 3) {
    // Last to act: win the trick if possible, otherwise dump the lowest.
    const w = partialWinner(state, weight);
    const partnerWinning = w !== null && tnTeamOfSeat(w) === tnTeamOfSeat(seatIndex);
    if (!partnerWinning) {
      const ledSuit = state.currentTrick[0]!.card.suit;
      const winners = legal.filter((c) => {
        if (w === null) return true;
        const bw = state.currentTrick.find((p) => p.seatIndex === w)!;
        const trumpOn =
          state.trumpStyle !== "JOKER" && state.trumpRevealed && state.trumpSuit !== null;
        const cTrump = trumpOn && c.suit === state.trumpSuit;
        const bTrump = trumpOn && bw.card.suit === state.trumpSuit;
        if (cTrump && !bTrump) return true;
        if (cTrump !== bTrump) return false;
        const cmpSuit = cTrump ? state.trumpSuit! : ledSuit;
        if (c.suit !== cmpSuit) return false;
        if (bw.card.suit !== cmpSuit) return true;
        return weight(c.rank) > weight(bw.card.rank);
      });
      if (winners.length > 0) {
        const cheapestWin = winners.reduce((m, c) => (c.rank < m.rank ? c : m));
        return { kind: "PLAY", card: cheapestWin };
      }
    }
    return { kind: "PLAY", card: lowest };
  }

  // Middle position: keep it simple and safe.
  return { kind: "PLAY", card: lowest };
}

// Team totals type kept referenced for potential future scoring-aware heuristics.
export type { TnTeamTotals };
