import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

import { registerSessionHandlers } from "./sessionHandlers.js";
import { registerWebRtcSignalingHandlers } from "../webrtc/signalingHandlers.js";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
  SocketServer,
} from "./types.js";

function logInfo(event: string, details: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      level: "info",
      event,
      ...details,
    }),
  );
}

function parseCorsOrigin(): string | string[] {
  const configuredOrigin = process.env.SOCKET_IO_CORS_ORIGIN;

  if (!configuredOrigin || configuredOrigin.trim().length === 0) {
    return "*";
  }

  const origins = configuredOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length === 1 ? origins[0] : origins;
}

export function initializeSocketServer(httpServer: HttpServer): SocketServer {
  const io: SocketServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: parseCorsOrigin(),
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    logInfo("socket.connected", {
      socketId: socket.id,
      transport: socket.conn.transport.name,
    });

    socket.conn.on("upgrade", (transport) => {
      logInfo("socket.transport_upgraded", {
        socketId: socket.id,
        transport: transport.name,
      });
    });

    registerSessionHandlers(io, socket);
    registerWebRtcSignalingHandlers(io, socket);
  });

  logInfo("socket.server_initialized", {
    path: io.path(),
    corsOrigin: parseCorsOrigin(),
  });

  return io;
}
