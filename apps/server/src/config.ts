import { RoomConfig } from "@poker/shared-types";

export type ServerLimits = {
  minStartingCoins: number;
  maxStartingCoins: number;
  maxBigBlind: number;
  minTurnSeconds: number;
  maxTurnSeconds: number;
  maxRooms: number;
  emptyRoomTtlMs: number;
  loanRequestTtlMs: number;
  debtCeilingMultiple: number; // x startingCoins
  autoStartDelayMs: number;
  disconnectGraceMs: number; // seat freed after being gone this long between hands
  /** Twenty-Nine only: countdown for a DISCONNECTED seat whose turn is up. */
  tnOfflineFallbackSeconds: number;
  /** Twenty-Nine only: inactivity countdown for a CONNECTED human seat whose turn is up. */
  tnConnectedTurnSeconds: number;
};

/** Server-level defaults & limits; per-room config is chosen by creators. */
export interface ServerConfig {
  port: number;
  clientOrigins: string[];
  defaultRoomConfig: RoomConfig;
  /** Hard clamps applied to any creator-supplied config. */
  limits: ServerLimits;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function loadConfig(): ServerConfig {
  const origins = (process.env.CLIENT_ORIGIN ?? process.env.FRONTEND_URL ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port: intEnv("PORT", 4000),
    clientOrigins: origins,
    defaultRoomConfig: {
      startingCoins: intEnv("INITIAL_COINS", 1000),
      smallBlind: intEnv("SMALL_BLIND", 10),
      bigBlind: intEnv("BIG_BLIND", 20),
      turnTimeSeconds: intEnv("TURN_TIME_SECONDS", 60),
    },
    limits: {
      minStartingCoins: 50,
      maxStartingCoins: 1_000_000,
      maxBigBlind: 10_000,
      minTurnSeconds: 5,
      maxTurnSeconds: 120,
      maxRooms: 200,
      emptyRoomTtlMs: intEnv("EMPTY_ROOM_TTL_MS", 5 * 60 * 1000),
      loanRequestTtlMs: 30_000,
      debtCeilingMultiple: 2,
      autoStartDelayMs: 4000,
      disconnectGraceMs: 60_000,
      tnOfflineFallbackSeconds: intEnv("TN_OFFLINE_FALLBACK_SECONDS", 10),
      tnConnectedTurnSeconds: intEnv("TN_CONNECTED_TURN_SECONDS", 25),
    },
  };
}
