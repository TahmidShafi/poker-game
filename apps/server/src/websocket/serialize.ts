import { PublicGameState } from "@poker/shared-types";
import { GamePhase } from "@poker/shared-types";
import { TableState, toPublicGameState } from "@poker/engine";

/**
 * Produces the broadcast-safe view of the table for ONE seat:
 *  - that seat keeps its own hole cards;
 *  - every other seat's hole cards are stripped UNLESS the hand is over
 *    (SHOWDOWN/PAYOUT), when all cards are public information anyway.
 *
 * This is the ONLY place hole-card visibility is decided - the browser never
 * receives hidden data to "hide with CSS".
 */
export function serializeForSeat(
  table: TableState,
  roomCode: string,
  viewerSeatIndex: number | null,
  turnDeadline: number
): PublicGameState {
  const state = toPublicGameState(table, { roomCode, turnDeadline });

  const revealAll =
    table.phase === GamePhase.SHOWDOWN || table.phase === GamePhase.PAYOUT;

  for (const seat of state.seats) {
    if (seat.seatIndex !== viewerSeatIndex && !revealAll) {
      seat.holeCards = null;
    }
  }
  return state;
}
