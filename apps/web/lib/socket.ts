"use client";

import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@poker/shared-types";

const rawUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
export const SERVER_URL = rawUrl.replace(/\/+$/, "");

export type PokerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): PokerSocket {
  return io(SERVER_URL, {
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    timeout: 20000,
    autoConnect: true,
  });
}
