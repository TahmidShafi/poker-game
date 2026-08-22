import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@poker/shared-types";
import { loadConfig, ServerConfig } from "./config";
import { registerSocketHandlers } from "./websocket/handlers";
import { GameManagerHooks } from "./rooms/gameManager";
import type { RoomRegistry } from "./rooms/roomRegistry";
import {
  ensureGameSession,
  recordHandFinished,
  recordLoanEvent,
  recordRoomClosed,
} from "./persistence/persistence";
import { db } from "./persistence/db";

export interface PokerServer {
  httpServer: http.Server;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  registry: RoomRegistry;
  config: ServerConfig;
  close(): void;
}

/**
 * Creates the full game server (express + Socket.IO + rooms) without
 * binding a port - used both by the production entrypoint and tests.
 */
export function createPokerServer(overrides?: Partial<ServerConfig>, hooks: GameManagerHooks = {}): PokerServer {
  const config = { ...loadConfig(), ...overrides };
  if (overrides?.limits) config.limits = { ...loadConfig().limits, ...overrides.limits };

  const app = express();
  app.use(cors({ origin: config.clientOrigins.length > 0 ? config.clientOrigins : true }));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // ---- Read-only REST surface (leaderboard / stats) ----
  app.get("/api/leaderboard", async (_req, res) => {
    const prisma = db();
    if (!prisma) return res.status(503).json({ error: "persistence disabled" });
    try {
      const rows = await prisma.playerStats.findMany({
        orderBy: [{ totalWinnings: "desc" }, { biggestPotWon: "desc" }],
        take: 20,
        include: { player: { select: { username: true } } },
      });
      return res.json(
        rows.map((r) => ({
          username: r.player.username,
          handsPlayed: r.handsPlayed,
          handsWon: r.handsWon,
          totalWinnings: r.totalWinnings,
          biggestPotWon: r.biggestPotWon,
          bestHandLabel: r.bestHandLabel,
        }))
      );
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/stats/:username", async (req, res) => {
    const prisma = db();
    if (!prisma) return res.status(503).json({ error: "persistence disabled" });
    try {
      const player = await prisma.player.findUnique({
        where: { username: req.params.username },
        include: { stats: true },
      });
      if (!player) return res.status(404).json({ error: "player not found" });
      return res.json({
        username: player.username,
        createdAt: player.createdAt,
        stats: player.stats ?? null,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  const httpServer = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: config.clientOrigins.length > 0 ? config.clientOrigins : true },
  });

  const persistenceHooks: GameManagerHooks = {
    ...hooks,
    onHandFinished: (data) => {
      hooks.onHandFinished?.(data);
      void recordHandFinished(data.summary.roomCode, data.summary, data.communityCards, data.seats);
    },
    onRoomClosed: (code) => {
      hooks.onRoomClosed?.(code);
      void recordRoomClosed(code);
    },
    onLoanEvent: (code, from, to, amount, kind) => {
      hooks.onLoanEvent?.(code, from, to, amount, kind);
      void recordLoanEvent(code, from, to, amount, kind);
    },
  };
  const registry = registerSocketHandlers(io, config, persistenceHooks);

  return {
    httpServer,
    io,
    registry,
    config,
    close() {
      registry.destroyAll();
      io.close();
      httpServer.close();
    },
  };
}

// ---- Production entrypoint -------------------------------------------------
// Skipped entirely under vitest so tests can spin up isolated instances.

if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  const config = loadConfig();

  const hooks: GameManagerHooks = {
    onRoomClosed: (code) => console.log(`[room] closed ${code}`),
    onHandFinished: (data) =>
      console.log(`[room ${data.summary.roomCode}] hand #${data.summary.handNumber} finished`),
  };

  const server = createPokerServer(undefined, hooks);

  server.httpServer.listen(config.port, "0.0.0.0", () => {
    console.log(`Poker game server listening on 0.0.0.0:${config.port}`);
    console.log(`Allowed origins: ${config.clientOrigins.join(", ")}`);
  });

  // Graceful shutdown (Render sends SIGTERM on deploys/restarts).
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${signal}] shutting down - closing all rooms...`);
    server.registry.destroyAll();
    server.io.close();
    server.httpServer.close(() => {
      console.log("bye");
      process.exit(0);
    });
    // Hard-exit fallback if sockets refuse to drain.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
