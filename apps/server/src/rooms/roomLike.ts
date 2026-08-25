import { GameType, RoomConfig } from "@poker/shared-types";

/**
 * Minimal surface shared by every live room manager (poker & twenty-nine).
 * The registry, idle sweeper and socket handlers code against this so both
 * game types coexist behind one room-code namespace.
 */
export interface JoinOpts {
  sessionToken?: string;
  socketId: string;
  avatar?: number;
}

export type JoinResult =
  | { ok: true; seatIndex: number; playerId: string; sessionToken: string }
  | { ok: false; error: string };

export interface RoomPlayerRef {
  playerId: string;
  seatIndex: number;
  username: string;
  sessionToken: string;
}

export interface RoomLike {
  readonly roomCode: string;
  readonly gameType: GameType;
  /** Frozen room configuration (creator-supplied, server-clamped). */
  readonly config: RoomConfig;

  destroy(): void;
  isDestroyed(): boolean;
  /** Millis epoch of the last moment a socket was attached (idle sweeper). */
  lastActivityAt(): number;
  creationTime(): number;
  socketRoom(): string;

  join(username: string, opts: JoinOpts): JoinResult;
  attachSocket(playerId: string, socketId: string): void;
  findByToken(token: string): RoomPlayerRef | undefined;
  findPlayerBySocket(socketId: string): RoomPlayerRef | undefined;
  disconnectSocket(socketId: string): void;
  leave(socketId: string): void;

  reject(socketId: string, reason: string): void;
  broadcastState(): void;
}
