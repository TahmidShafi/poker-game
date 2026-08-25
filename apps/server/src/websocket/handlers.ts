import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@poker/shared-types";
import type { GameManager, GameManagerHooks } from "../rooms/gameManager";
import { RoomRegistry } from "../rooms/roomRegistry";
import { ServerConfig } from "../config";
import type { Socket } from "socket.io";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type SocketType = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Wires every socket event to the room layer. This layer does NO game
 * decisions - it only validates payload shapes, routes to the right
 * GameManager and translates errors into ACTION_REJECTED / acks.
 */
export function registerSocketHandlers(
  io: IO,
  config: ServerConfig,
  hooks: GameManagerHooks = {}
): RoomRegistry {
  const registry = new RoomRegistry(io, config, hooks);

  const isNonEmptyString = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  const isPositiveInt = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v > 0;
  // Seat indexes are 0-based - isPositiveInt would wrongly lock seat 0 out
  // of every loan as creditor or debtor.
  const isValidSeatIndex = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10;
  // Avatar pictures are 1-10; anything else falls back to the letter disc.
  const isValidAvatar = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10;
  const sanitizeAvatar = (v: unknown): number | undefined =>
    isValidAvatar(v) ? v : undefined;

  const clampConfig = (raw: {
    startingCoins: unknown;
    smallBlind: unknown;
    bigBlind: unknown;
    turnTimeSeconds: unknown;
  }): ReturnType<typeof validateRoomConfig> => validateRoomConfig(raw, config);

  function validateRoomConfig(
    raw: {
      startingCoins: unknown;
      smallBlind: unknown;
      bigBlind: unknown;
      turnTimeSeconds: unknown;
    },
    cfg: ServerConfig
  ): { ok: true; config: import("@poker/shared-types").RoomConfig } | { ok: false; error: string } {
    const L = cfg.limits;
    if (!isPositiveInt(raw.startingCoins) || !isPositiveInt(raw.smallBlind) || !isPositiveInt(raw.bigBlind) || !isPositiveInt(raw.turnTimeSeconds)) {
      return { ok: false, error: "room values must be positive integers" };
    }
    const startingCoins = Math.min(Math.max(raw.startingCoins, L.minStartingCoins), L.maxStartingCoins);
    const bigBlindRaw = Math.min(raw.bigBlind, L.maxBigBlind);
    const smallBlind = Math.min(Math.max(raw.smallBlind, 1), Math.floor(bigBlindRaw / 2));
    const bigBlind = Math.max(bigBlindRaw, smallBlind * 2);
    if (startingCoins < bigBlind * 10) {
      return { ok: false, error: `starting coins must be at least 10x the big blind (${bigBlind * 10})` };
    }
    const turnTimeSeconds = Math.min(Math.max(raw.turnTimeSeconds, L.minTurnSeconds), L.maxTurnSeconds);
    return {
      ok: true,
      config: {
        startingCoins,
        smallBlind,
        bigBlind,
        turnTimeSeconds,
      },
    };
  }

  io.on("connection", (socket: SocketType) => {
    // ---- CREATE_ROOM -----------------------------------------------------
    socket.on("CREATE_ROOM", (payload, ack) => {
      if (typeof payload !== "object" || payload === null || !isNonEmptyString(payload.username)) {
        return ack?.({ ok: false, error: "invalid CREATE_ROOM payload" });
      }
      const validated = clampConfig(payload);
      if (!validated.ok) return ack?.({ ok: false, error: validated.error });
      try {
        const room = registry.createRoom(validated.config);
        const joined = room.join(payload.username, {
          socketId: socket.id,
          avatar: sanitizeAvatar((payload as { avatar?: unknown }).avatar),
        });
        if (!joined.ok) {
          registry.removeRoom(room.roomCode); // don't leave an orphan empty room
          return ack?.({ ok: false, error: joined.error });
        }
        socket.join(room.socketRoom());
        return ack?.({
          ok: true,
          roomCode: room.roomCode,
          seatIndex: joined.seatIndex,
          sessionToken: joined.sessionToken,
          config: validated.config,
        });
      } catch (err) {
        return ack?.({ ok: false, error: (err as Error).message });
      }
    });

    // ---- JOIN_ROOM -------------------------------------------------------
    socket.on("JOIN_ROOM", (payload, ack) => {
      if (
        typeof payload !== "object" ||
        payload === null ||
        !isNonEmptyString(payload.username) ||
        !isNonEmptyString(payload.roomCode)
      ) {
        return ack?.({ ok: false, error: "invalid JOIN_ROOM payload" });
      }
      const room = registry.get(payload.roomCode.toUpperCase());
      if (!room) return ack?.({ ok: false, error: "room not found" });
      const joined = room.join(payload.username, {
        sessionToken: typeof payload.sessionToken === "string" ? payload.sessionToken : undefined,
        socketId: socket.id,
        avatar: sanitizeAvatar((payload as { avatar?: unknown }).avatar),
      });
      if (!joined.ok) return ack?.({ ok: false, error: joined.error });
      socket.join(room.socketRoom());
      // Ensure the fresh socket always has a state even if the join-broadcast
      // raced ahead of it.
      room.broadcastState();
      return ack?.({
        ok: true,
        roomCode: room.roomCode,
        seatIndex: joined.seatIndex,
        sessionToken: joined.sessionToken,
        config: room.config,
      });
    });

    // ---- RECONNECT ---------------------------------------------------------
    socket.on("RECONNECT", (payload, ack) => {
      if (typeof payload !== "object" || payload === null || !isNonEmptyString(payload.sessionToken)) {
        return ack?.({ ok: false, error: "invalid RECONNECT payload" });
      }
      const room = registry.findByToken(payload.sessionToken);
      if (!room) return ack?.({ ok: false, error: "session not found - the table may have closed" });
      const rec = room.findByToken(payload.sessionToken)!;
      socket.join(room.socketRoom());
      room.attachSocket(rec.playerId, socket.id);
      room.broadcastState();
      return ack?.({
        ok: true,
        roomCode: room.roomCode,
        seatIndex: rec.seatIndex,
        sessionToken: rec.sessionToken,
        config: room.config,
      });
    });

    // ---- LEAVE_ROOM --------------------------------------------------------
    socket.on("LEAVE_ROOM", () => {
      const room = findRoomOf(registry, socket.id);
      if (room) room.leave(socket.id);
      for (const r of socket.rooms) socket.leave(r);
    });

    // ---- PLAYER_ACTION ---------------------------------------------------
    const VALID_ACTIONS = new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE", "ALL_IN"]);
    socket.on("PLAYER_ACTION", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) {
        socket.emit("ACTION_REJECTED", { reason: "you are not in a room" });
        return;
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        typeof payload.action !== "string" ||
        !VALID_ACTIONS.has(payload.action)
      ) {
        room.reject(socket.id, "malformed action payload");
        return;
      }
      const amount =
        payload.amount === undefined ? undefined : (payload.amount as unknown);
      if (amount !== undefined && !isPositiveInt(amount)) {
        room.reject(socket.id, "amount must be a positive integer");
        return;
      }
      room.playerAction(socket.id, {
        action: payload.action as import("@poker/shared-types").PlayerAction,
        amount: amount as number | undefined,
      });
    });

    // ---- SET_PREACTION ----------------------------------------------------
    socket.on("SET_PREACTION", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) return;
      if (
        typeof payload !== "object" ||
        payload === null ||
        !(payload.action === null || payload.action === "CHECK" || payload.action === "FOLD")
      ) {
        return room.reject(socket.id, "malformed pre-action payload");
      }
      room.setPreaction(socket.id, payload.action);
    });

    // ---- LOANS -------------------------------------------------------------
    socket.on("REQUEST_LOAN", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) return;
      if (typeof payload !== "object" || payload === null || !isValidSeatIndex(payload.creditorSeatIndex) || !isPositiveInt(payload.amount)) {
        return room.reject(socket.id, "malformed loan request");
      }
      room.requestLoan(socket.id, payload.creditorSeatIndex, payload.amount);
    });

    socket.on("RESPOND_LOAN", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) return;
      if (typeof payload !== "object" || payload === null || !isNonEmptyString(payload.requestId) || typeof payload.approve !== "boolean") {
        return room.reject(socket.id, "malformed loan response");
      }
      room.respondLoan(socket.id, payload.requestId, payload.approve);
    });

    socket.on("REPAY_LOAN", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) return;
      if (typeof payload !== "object" || payload === null || !isValidSeatIndex(payload.creditorSeatIndex) || !isPositiveInt(payload.amount)) {
        return room.reject(socket.id, "malformed repay request");
      }
      room.repayLoan(socket.id, payload.creditorSeatIndex, payload.amount);
    });

    // ---- DISCONNECT --------------------------------------------------------
    socket.on("disconnect", () => {
      const room = findRoomOf(registry, socket.id);
      if (room) room.disconnectSocket(socket.id);
    });
  });

  return registry;
}

function findRoomOf(registry: RoomRegistry, socketId: string): GameManager | undefined {
  for (const room of registry.roomsSnapshot()) {
    if (room.findPlayerBySocket(socketId)) return room;
  }
  return undefined;
}
