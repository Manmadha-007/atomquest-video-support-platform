import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { io as createClient, type Socket as ClientSocket } from "socket.io-client";

const SESSION_ID = "webrtc-session-1";
const AGENT_ID = "webrtc-agent-1";
const CUSTOMER_ID = "webrtc-customer-1";

type AckResponse<TPayload = unknown> =
  | {
      ok: true;
      data: TPayload;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };

async function createTempDatabase(): Promise<{
  directory: string;
  databaseUrl: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "atomquest-webrtc-"));
  const databasePath = path.join(directory, "test.db").replace(/\\/g, "/");

  return {
    directory,
    databaseUrl: `file:${databasePath}`,
  };
}

async function prepareSchema(
  prisma: typeof import("../src/config/prisma.js").prisma,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "token" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "endedAt" DATETIME,
      "endedBy" TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Participant" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "leftAt" DATETIME,
      CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Message" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "sender" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "Session_status_idx" ON "Session"("status")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "Participant_sessionId_role_key" ON "Participant"("sessionId", "role")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "Participant_sessionId_idx" ON "Participant"("sessionId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt")`,
  );
}

async function seedSession(
  prisma: typeof import("../src/config/prisma.js").prisma,
): Promise<void> {
  await prisma.session.create({
    data: {
      id: SESSION_ID,
      token: "webrtc-token",
      status: "ACTIVE",
      participants: {
        create: [
          {
            id: AGENT_ID,
            role: "AGENT",
          },
          {
            id: CUSTOMER_ID,
            role: "CUSTOMER",
          },
        ],
      },
    },
  });
}

async function listen(httpServer: HttpServer): Promise<string> {
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const address = httpServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected HTTP server to listen on a TCP port.");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(httpServer: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function connectClient(url: string): Promise<ClientSocket> {
  const socket = createClient(url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  });

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Socket.IO client connection."));
    }, 1_000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
    };

    const handleConnect = () => {
      cleanup();
      resolve(socket);
    };

    const handleConnectError = (error: Error) => {
      cleanup();
      reject(error);
    };

    socket.once("connect", handleConnect);
    socket.once("connect_error", handleConnectError);
  });
}

function emitAck<TPayload = unknown>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<AckResponse<TPayload>> {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function waitForEvent<TPayload>(
  socket: ClientSocket,
  event: string,
): Promise<TPayload> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}.`));
    }, 1_000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off(event, handleEvent);
    };

    const handleEvent = (payload: TPayload) => {
      cleanup();
      resolve(payload);
    };

    socket.once(event, handleEvent);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("WebRTC signaling validates membership and routes only to the target participant", async () => {
  const { databaseUrl, directory } = await createTempDatabase();
  process.env.DATABASE_URL = databaseUrl;

  const [{ initializeSocketServer }, { prisma }] = await Promise.all([
    import("../src/sockets/socketServer.js"),
    import("../src/config/prisma.js"),
  ]);

  await prepareSchema(prisma);
  await seedSession(prisma);

  const httpServer = createServer();
  const io = initializeSocketServer(httpServer);
  const url = await listen(httpServer);
  const agentSocket = await connectClient(url);
  const customerSocket = await connectClient(url);

  try {
    const agentJoin = await emitAck(agentSocket, "session:join", {
      sessionId: SESSION_ID,
      participantId: AGENT_ID,
      role: "AGENT",
    });

    assert.equal(agentJoin.ok, true);

    const unavailableTarget = await emitAck(agentSocket, "webrtc:offer", {
      sessionId: SESSION_ID,
      participantId: AGENT_ID,
      targetParticipantId: CUSTOMER_ID,
      description: {
        type: "offer",
        sdp: "v=0\r\n",
      },
    });

    assert.equal(unavailableTarget.ok, false);
    assert.equal(unavailableTarget.error.code, "TARGET_NOT_AVAILABLE");

    const customerJoin = await emitAck(customerSocket, "session:join", {
      sessionId: SESSION_ID,
      participantId: CUSTOMER_ID,
      role: "CUSTOMER",
    });

    assert.equal(customerJoin.ok, true);

    let senderOfferCount = 0;
    agentSocket.on("webrtc:offer", () => {
      senderOfferCount += 1;
    });

    const offerReceived = waitForEvent<Record<string, unknown>>(
      customerSocket,
      "webrtc:offer",
    );
    const offerAck = await emitAck<{ messageId: string }>(
      agentSocket,
      "webrtc:offer",
      {
        sessionId: SESSION_ID,
        participantId: AGENT_ID,
        targetParticipantId: CUSTOMER_ID,
        description: {
          type: "offer",
          sdp: "v=0\r\n",
        },
      },
    );

    assert.equal(offerAck.ok, true);

    const routedOffer = await offerReceived;

    assert.equal(routedOffer["participantId"], AGENT_ID);
    assert.equal(routedOffer["targetParticipantId"], CUSTOMER_ID);
    assert.equal(routedOffer["messageId"], offerAck.data.messageId);

    await wait(50);
    assert.equal(senderOfferCount, 0);

    const answerReceived = waitForEvent<Record<string, unknown>>(
      agentSocket,
      "webrtc:answer",
    );
    const answerAck = await emitAck(customerSocket, "webrtc:answer", {
      sessionId: SESSION_ID,
      participantId: CUSTOMER_ID,
      targetParticipantId: AGENT_ID,
      description: {
        type: "answer",
        sdp: "v=0\r\n",
      },
    });

    assert.equal(answerAck.ok, true);
    assert.equal((await answerReceived)["participantId"], CUSTOMER_ID);

    const iceReceived = waitForEvent<Record<string, unknown>>(
      customerSocket,
      "webrtc:ice-candidate",
    );
    const iceAck = await emitAck(agentSocket, "webrtc:ice-candidate", {
      sessionId: SESSION_ID,
      participantId: AGENT_ID,
      targetParticipantId: CUSTOMER_ID,
      candidate: null,
    });

    assert.equal(iceAck.ok, true);
    assert.equal((await iceReceived)["candidate"], null);

    await emitAck(agentSocket, "session:leave", {
      sessionId: SESSION_ID,
      participantId: AGENT_ID,
    });
    await emitAck(customerSocket, "session:leave", {
      sessionId: SESSION_ID,
      participantId: CUSTOMER_ID,
    });
  } finally {
    agentSocket.disconnect();
    customerSocket.disconnect();
    io.close();
    await closeServer(httpServer);
    await prisma.$disconnect();
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});
