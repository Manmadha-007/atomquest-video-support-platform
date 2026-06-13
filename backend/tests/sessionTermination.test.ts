import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import express from "express";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";

const SESSION_ID = "termination-session-1";
const TOKEN = "termination-token";
const AGENT_ID = "termination-agent-1";
const CUSTOMER_ID = "termination-customer-1";

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
  const directory = await mkdtemp(path.join(tmpdir(), "atomquest-end-"));
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
      "participantId" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "kind" TEXT NOT NULL DEFAULT 'TEXT',
      "content" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Message_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Recording" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "startedByParticipantId" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'RECORDING',
      "stopReason" TEXT,
      "mimeType" TEXT NOT NULL,
      "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "stoppedAt" DATETIME,
      "readyAt" DATETIME,
      "durationMs" INTEGER,
      "sizeBytes" INTEGER,
      "storageKey" TEXT,
      "downloadToken" TEXT NOT NULL,
      "failureReason" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "Recording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Recording_startedByParticipantId_fkey" FOREIGN KEY ("startedByParticipantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "FileAttachment" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "participantId" TEXT NOT NULL,
      "messageId" TEXT NOT NULL,
      "originalName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "extension" TEXT NOT NULL,
      "sizeBytes" INTEGER NOT NULL,
      "storageKey" TEXT NOT NULL,
      "downloadToken" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FileAttachment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "FileAttachment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "FileAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "Message_participantId_idx" ON "Message"("participantId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "Recording_downloadToken_key" ON "Recording"("downloadToken")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "FileAttachment_messageId_key" ON "FileAttachment"("messageId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "FileAttachment_downloadToken_key" ON "FileAttachment"("downloadToken")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "FileAttachment_sessionId_createdAt_idx" ON "FileAttachment"("sessionId", "createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "FileAttachment_participantId_idx" ON "FileAttachment"("participantId")`,
  );
}

async function seedSession(
  prisma: typeof import("../src/config/prisma.js").prisma,
): Promise<void> {
  await prisma.session.create({
    data: {
      id: SESSION_ID,
      token: TOKEN,
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

test("POST /api/sessions/:sessionId/end ends the session and notifies room sockets", async () => {
  const { databaseUrl, directory } = await createTempDatabase();
  process.env.DATABASE_URL = databaseUrl;

  const [{ default: sessionRoutes }, { initializeSocketServer }, { prisma }] =
    await Promise.all([
      import("../src/routes/sessionRoutes.js"),
      import("../src/sockets/socketServer.js"),
      import("../src/config/prisma.js"),
    ]);

  await prepareSchema(prisma);
  await seedSession(prisma);

  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionRoutes);

  const httpServer = createServer(app);
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
    const customerJoin = await emitAck(customerSocket, "session:join", {
      sessionId: SESSION_ID,
      participantId: CUSTOMER_ID,
      role: "CUSTOMER",
    });

    assert.equal(agentJoin.ok, true);
    assert.equal(customerJoin.ok, true);

    const agentEnded = waitForEvent<Record<string, unknown>>(
      agentSocket,
      "session:ended",
    );
    const customerEnded = waitForEvent<Record<string, unknown>>(
      customerSocket,
      "session:ended",
    );
    const endResponse = await fetch(`${url}/api/sessions/${SESSION_ID}/end`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endedBy: "CUSTOMER_SHOULD_BE_IGNORED" }),
    });

    assert.equal(endResponse.status, 200);

    const body = (await endResponse.json()) as {
      session: {
        id: string;
        status: string;
        endedAt: string | null;
        endedBy: string | null;
        participants: Array<{ id: string; leftAt: string | null }>;
      };
    };

    assert.equal(body.session.id, SESSION_ID);
    assert.equal(body.session.status, "ENDED");
    assert.equal(body.session.endedBy, "AGENT");
    assert.ok(body.session.endedAt);
    assert.equal(
      body.session.participants.every((participant) => participant.leftAt),
      true,
    );

    const [agentPayload, customerPayload] = await Promise.all([
      agentEnded,
      customerEnded,
    ]);

    assert.equal(agentPayload["sessionId"], SESSION_ID);
    assert.equal(customerPayload["sessionId"], SESSION_ID);
    assert.equal(
      (agentPayload["session"] as Record<string, unknown>)["status"],
      "ENDED",
    );

    const endedSession = await prisma.session.findUniqueOrThrow({
      where: {
        id: SESSION_ID,
      },
      include: {
        participants: true,
      },
    });

    assert.equal(endedSession.status, "ENDED");
    assert.equal(endedSession.endedBy, "AGENT");
    assert.ok(endedSession.endedAt);
    assert.equal(
      endedSession.participants.every(
        (participant) => participant.leftAt !== null,
      ),
      true,
    );

    const duplicateResponse = await fetch(
      `${url}/api/sessions/${SESSION_ID}/end`,
      {
        method: "POST",
      },
    );
    const duplicateBody = (await duplicateResponse.json()) as {
      error: { code: string };
    };

    assert.equal(duplicateResponse.status, 409);
    assert.equal(duplicateBody.error.code, "SESSION_ALREADY_ENDED");

    const missingResponse = await fetch(`${url}/api/sessions/missing/end`, {
      method: "POST",
    });
    const missingBody = (await missingResponse.json()) as {
      error: { code: string };
    };

    assert.equal(missingResponse.status, 404);
    assert.equal(missingBody.error.code, "SESSION_NOT_FOUND");
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
