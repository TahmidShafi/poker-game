import { PrismaClient } from "@prisma/client";

/**
 * Lazy Prisma singleton. When DATABASE_URL is missing (e.g. a dev socket
 * server started without Postgres) persistence is DISABLED: the game keeps
 * running, writes become no-ops and REST reads return 503.
 */
let client: PrismaClient | null = null;

export function db(): PrismaClient | null {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === "") return null;
  if (client === null) {
    client = new PrismaClient();
  }
  return client;
}
