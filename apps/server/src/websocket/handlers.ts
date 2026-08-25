import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, TnCard, TnSuit } from "@poker/shared-types";
import { isTnTrumpChoice } from "@poker/shared-types";
import type { GameManager, GameManagerHooks } from "../rooms/gameManager";
import type { RoomLike, RoomPlayerRef } from "../rooms/roomLike";
import type { TwentyNineGameManager } from "../rooms/twentynine/twentyNineManager";
import { RoomRegistry } from "../rooms/roomRegistry";
import { ServerConfig } from "../config";
import type { Socket } from "socket.io";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type SocketType = Socket<ClientToServerEvents, ServerToClientEvents>;

const TN_SUITS: TnSuit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];

/**
 * Wires every socket event to the room layer. This layer does NO game
 * decisions - it only validates payload shapes, routes to the right room
 * manager and translates errors into ACTION_REJECTED / acks.
 */
export function registerSocketHandlers(
  io: IO,
  config: ServerConfig,
  hooks: GameManagerHooks = {},
  tnHooks: import("../rooms/twentynine/twentyNineManager").TnManagerHooks = {}
): RoomRegistry {
  const registry = new RoomRegistry(io, config, hooks, tnHooks);

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

  function validateRoomConfig(
    raw: {
      startingCoins: unknown;
      smallBlind: unknown;
      bigBlind: unknown;
      turnTimeSeconds: unknown;
      gameType?: unknown;
      twentyNine?: unknown;
      twentynine?: unknown;
    },
    cfg: ServerConfig
  ): { ok: true; config: import("@poker/shared-types").RoomConfig } | { ok: false; error: string } {
    const L = cfg.limits;
    if (!isPositiveInt(raw.startingCoins)) {
      return { ok: false, error: "room values must be positive integers" };
    }

    // ---- Twenty-Nine rooms: no settings economy; single-player bots flag only.
    if (raw.gameType === "TWENTY_NINE") {
      return {
        ok: true,
        config: {
          startingCoins: raw.startingCoins as number,
          smallBlind: 0,
          bigBlind: 0,
          turnTimeSeconds: 60,
          gameType: "TWENTY_NINE",
        },
      };
    }

    // ---- Poker rooms (legacy default).
    if (!isPositiveInt(raw.smallBlind) || !isPositiveInt(raw.bigBlind) || !isPositiveInt(raw.turnTimeSeconds)) {
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

  /** Narrows a generic room reference to the 29 manager. */
  function asTnRoom(room: RoomLike | undefined): TwentyNineGameManager | null {
    return room && room.gameType === "TWENTY_NINE" ? (room as TwentyNineGameManager) : null;
  }

  io.on("connection", (socket: SocketType) => {
    // ---- CREATE_ROOM -----------------------------------------------------
    socket.on("CREATE_ROOM", (payload, ack) => {
      if (typeof payload !== "object" || payload === null || !isNonEmptyString(payload.username)) {
        return ack?.({ ok: false, error: "invalid CREATE_ROOM payload" });
      }
      const validated = validateRoomConfig(payload, config);
      if (!validated.ok) return ack?.({ ok: false, error: validated.error });
      try {
        const vsBots = validated.config.gameType === "TWENTY_NINE" && payload.vsBots === true;
        const room = registry.createRoom(validated.config, { vsBots });
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
          gameType: room.gameType,
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
        gameType: room.gameType,
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
        gameType: room.gameType,
      });
    });

    // ---- LEAVE_ROOM --------------------------------------------------------
    socket.on("LEAVE_ROOM", () => {
      const room = findRoomOf(registry, socket.id);
      if (room) room.leave(socket.id);
      for (const r of socket.rooms) socket.leave(r);
    });

    // ---- PLAYER_ACTION (poker only) ---------------------------------------
    const VALID_ACTIONS = new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE", "ALL_IN"]);
    socket.on("PLAYER_ACTION", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) {
        socket.emit("ACTION_REJECTED", { reason: "you are not in a room" });
        return;
      }
      if (room.gameType !== "POKER") {
        return room.reject(socket.id, "not a poker room");
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
      (room as GameManager).playerAction(socket.id, {
        action: payload.action as import("@poker/shared-types").PlayerAction,
        amount: amount as number | undefined,
      });
    });

    // ---- SET_PREACTION (poker only) ----------------------------------------
    socket.on("SET_PREACTION", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) return;
      if (room.gameType !== "POKER") return room.reject(socket.id, "not a poker room");
      if (
        typeof payload !== "object" ||
        payload === null ||
        !(payload.action === null || payload.action === "CHECK" || payload.action === "FOLD")
      ) {
        return room.reject(socket.id, "malformed pre-action payload");
      }
      (room as GameManager).setPreaction(socket.id, payload.action);
    });

    // ---- LOANS (poker only) --------------------------------------------------
    socket.on("REQUEST_LOAN", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) return;
      if (room.gameType !== "POKER") return room.reject(socket.id, "not a poker room");
      if (typeof payload !== "object" || payload === null || !isValidSeatIndex(payload.creditorSeatIndex) || !isPositiveInt(payload.amount)) {
        return room.reject(socket.id, "malformed loan request");
      }
      (room as GameManager).requestLoan(socket.id, payload.creditorSeatIndex, payload.amount);
    });

    socket.on("RESPOND_LOAN", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) return;
      if (room.gameType !== "POKER") return room.reject(socket.id, "not a poker room");
      if (typeof payload !== "object" || payload === null || !isNonEmptyString(payload.requestId) || typeof payload.approve !== "boolean") {
        return room.reject(socket.id, "malformed loan response");
      }
      (room as GameManager).respondLoan(socket.id, payload.requestId, payload.approve);
    });

    socket.on("REPAY_LOAN", (payload) => {
      const room = findRoomOf(registry, socket.id);
      if (!room) return;
      if (room.gameType !== "POKER") return room.reject(socket.id, "not a poker room");
      if (typeof payload !== "object" || payload === null || !isValidSeatIndex(payload.creditorSeatIndex) || !isPositiveInt(payload.amount)) {
        return room.reject(socket.id, "malformed repay request");
      }
      (room as GameManager).repayLoan(socket.id, payload.creditorSeatIndex, payload.amount);
    });

    // ---- TWENTY-NINE MOVES ---------------------------------------------------
    const tnRoomOf = (): TwentyNineGameManager | null => {
      const room = findRoomOf(registry, socket.id);
      if (!room) {
        socket.emit("ACTION_REJECTED", { reason: "you are not in a room" });
        return null;
      }
      const tn = asTnRoom(room);
      if (!tn) {
        room.reject(socket.id, "not a 29 room");
        return null;
      }
      return tn;
    };

    socket.on("GAME29_BID", (payload) => {
      const tn = tnRoomOf();
      if (!tn) return;
      if (typeof payload !== "object" || payload === null) {
        return tn.reject(socket.id, "malformed bid payload");
      }
      if (payload.bid !== undefined && !isPositiveInt(payload.bid)) {
        return tn.reject(socket.id, "bid must be a positive integer or omitted to pass");
      }
      tn.game29Bid(socket.id, payload.bid);
    });

    socket.on("GAME29_DECLARE_TRUMP", (payload) => {
      const tn = tnRoomOf();
      if (!tn) return;
      if (typeof payload !== "object" || payload === null || !isTnTrumpChoice(payload.choice)) {
        return tn.reject(socket.id, "malformed trump declaration");
      }
      tn.game29DeclareTrump(socket.id, payload.choice);
    });

    socket.on("GAME29_CALL_TRUMP", () => {
      const tn = tnRoomOf();
      if (!tn) return;
      tn.game29CallTrump(socket.id);
    });

    socket.on("GAME29_DECLARE_MARRIAGE", (payload) => {
      const tn = tnRoomOf();
      if (!tn) return;
      if (typeof payload !== "object" || payload === null || typeof payload.suit !== "string" || !TN_SUITS.includes(payload.suit as TnSuit)) {
        return tn.reject(socket.id, "malformed marriage declaration");
      }
      tn.game29DeclareMarriage(socket.id, payload.suit as TnSuit);
    });

    socket.on("GAME29_PLAY_CARD", (payload) => {
      const tn = tnRoomOf();
      if (!tn) return;
      if (
        typeof payload !== "object" ||
        payload === null ||
        typeof payload.card !== "object" ||
        payload.card === null ||
        !TN_SUITS.includes((payload.card as TnCard).suit) ||
        !Number.isInteger((payload.card as TnCard).rank) ||
        (payload.card as TnCard).rank < 7 ||
        (payload.card as TnCard).rank > 14
      ) {
        return tn.reject(socket.id, "malformed card payload");
      }
      tn.game29PlayCard(socket.id, { suit: (payload.card as TnCard).suit, rank: (payload.card as TnCard).rank });
    });

    // ---- DISCONNECT ----------------------------------------------------------
    socket.on("disconnect", () => {
      const room = findRoomOf(registry, socket.id);
      if (room) room.disconnectSocket(socket.id);
    });
  });

  return registry;
}

function findRoomOf(registry: RoomRegistry, socketId: string): RoomLike | undefined {
  for (const room of registry.roomsSnapshot()) {
    if (room.findPlayerBySocket(socketId)) return room;
  }
  return undefined;
}
