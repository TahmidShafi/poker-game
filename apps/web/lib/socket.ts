"use client";

import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@poker/shared-types";

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export type PokerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): PokerSocket {
  return io(SERVER_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 600,
    reconnectionDelayMax: 4000,
  });
}
