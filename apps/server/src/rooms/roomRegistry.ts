import { RoomConfig } from "@poker/shared-types";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@poker/shared-types";
import type { RoomLike } from "./roomLike";
import { GameManager, GameManagerHooks } from "./gameManager";
import { TnManagerHooks, TwentyNineGameManager } from "./twentynine/twentyNineManager";
import { ServerConfig } from "../config";
import { ensureGameSession } from "../persistence/persistence";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I,O,0,L,1

/**
 * Owns every live room: code allocation (collision-checked), the
 * roomCode -> table map, sessionToken routing and idle-room cleanup.
 * Hosts BOTH game types behind the RoomLike interface.
 */
export class RoomRegistry {
  private rooms = new Map<string, RoomLike>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly io: IO,
    private readonly config: ServerConfig,
    private readonly hooks: GameManagerHooks = {},
    private readonly tnHooks: TnManagerHooks = {}
  ) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    if (typeof this.sweeper.unref === "function") this.sweeper.unref();
  }

  get(code: string): RoomLike | undefined {
    return this.rooms.get(code);
  }

  roomsSnapshot(): RoomLike[] {
    return [...this.rooms.values()];
  }

  findByToken(token: string): RoomLike | undefined {
    for (const room of this.rooms.values()) {
      if (room.findByToken(token)) return room;
    }
    return undefined;
  }

  /** Factory dispatch on the creator-chosen game type. */
  createRoom(config: RoomConfig): RoomLike {
    if (this.rooms.size >= this.config.limits.maxRooms) {
      throw new Error("server is at capacity - try again later");
    }
    const code = this.allocateCode();
    const manager =
      config.gameType === "TWENTY_NINE"
        ? new TwentyNineGameManager(this.io, code, config, this.config.limits, this.tnHooks)
        : new GameManager(this.io, code, config, this.config.limits, this.hooks);
    this.rooms.set(code, manager);
    void ensureGameSession(code, config);
    return manager;
  }

  removeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.destroy();
    this.rooms.delete(code);
  }

  destroyAll(): void {
    for (const [code] of this.rooms) this.removeRoom(code);
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** 6-char unambiguous code; retries on collision. */
  private allocateCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("could not allocate a unique room code");
  }

  /** Removes rooms with nobody connected beyond the idle TTL. */
  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.isDestroyed()) {
        this.rooms.delete(code);
        continue;
      }
      const last = room.lastActivityAt();
      if (last === 0 || now - last > this.config.limits.emptyRoomTtlMs) {
        // Brand-new empty rooms get the full TTL measured from creation.
        if (last !== 0 || now - room.creationTime() > this.config.limits.emptyRoomTtlMs) {
          this.removeRoom(code);
        }
      }
    }
  }
}
