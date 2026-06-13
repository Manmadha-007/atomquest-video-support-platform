import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import express from "express";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";

const SESSION_ID = "chat-session-1";
const TOKEN = "chat-token";
const AGENT_ID = "chat-agent-1";
const CUSTOMER_ID = "chat-customer-1";

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

interface ChatEventPayload {
  sessionId: string;
  room: string;
  message: {
    id: string;
    sessionId: string;
    participantId: string;
    role: "AGENT" | "CUSTOMER";
    content: string;
    createdAt: string;
  };
}

async function createTempDatabase(): Promise<{
  directory: string;
  databaseUrl: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "atomquest-chat-"));
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

test("session chat persists messages, broadcasts to the room, and keeps ended history readable", async () => {
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

    const agentSeesAgentMessage = waitForEvent<ChatEventPayload>(
      agentSocket,
      "session:chat:new",
    );
    const customerSeesAgentMessage = waitForEvent<ChatEventPayload>(
      customerSocket,
      "session:chat:new",
    );
    const agentChatAck = await emitAck<ChatEventPayload>(
      agentSocket,
      "session:chat:send",
      {
        sessionId: SESSION_ID,
        participantId: AGENT_ID,
        content: "  Hello from support.  ",
      },
    );

    assert.equal(agentChatAck.ok, true);
    assert.equal(agentChatAck.data.message.content, "Hello from support.");
    assert.equal(agentChatAck.data.message.role, "AGENT");
    assert.equal(agentChatAck.data.message.participantId, AGENT_ID);

    const [agentMessageForAgent, agentMessageForCustomer] = await Promise.all([
      agentSeesAgentMessage,
      customerSeesAgentMessage,
    ]);

    assert.equal(agentMessageForAgent.message.id, agentChatAck.data.message.id);
    assert.equal(
      agentMessageForCustomer.message.id,
      agentChatAck.data.message.id,
    );

    const customerSeesOwnMessage = waitForEvent<ChatEventPayload>(
      customerSocket,
      "session:chat:new",
    );
    const customerChatAck = await emitAck<ChatEventPayload>(
      customerSocket,
      "session:chat:send",
      {
        sessionId: SESSION_ID,
        participantId: CUSTOMER_ID,
        content: "Thanks, I can see it.",
      },
    );

    assert.equal(customerChatAck.ok, true);
    assert.equal(customerChatAck.data.message.role, "CUSTOMER");
    assert.equal(
      (await customerSeesOwnMessage).message.id,
      customerChatAck.data.message.id,
    );

    const mismatchedParticipant = await emitAck(
      agentSocket,
      "session:chat:send",
      {
        sessionId: SESSION_ID,
        participantId: CUSTOMER_ID,
        content: "spoof attempt",
      },
    );

    assert.equal(mismatchedParticipant.ok, false);
    assert.equal(
      mismatchedParticipant.error.code,
      "PARTICIPANT_SESSION_MISMATCH",
    );

    const emptyMessage = await emitAck(agentSocket, "session:chat:send", {
      sessionId: SESSION_ID,
      participantId: AGENT_ID,
      content: "   ",
    });

    assert.equal(emptyMessage.ok, false);
    assert.equal(emptyMessage.error.code, "VALIDATION_ERROR");

    const persistedMessages = await prisma.message.findMany({
      where: {
        sessionId: SESSION_ID,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    assert.equal(persistedMessages.length, 2);
    assert.equal(persistedMessages[0]?.participantId, AGENT_ID);
    assert.equal(persistedMessages[1]?.participantId, CUSTOMER_ID);

    await prisma.session.update({
      where: {
        id: SESSION_ID,
      },
      data: {
        status: "ENDED",
        endedAt: new Date(),
        endedBy: "AGENT",
      },
    });

    const endedSend = await emitAck(agentSocket, "session:chat:send", {
      sessionId: SESSION_ID,
      participantId: AGENT_ID,
      content: "after close",
    });

    assert.equal(endedSend.ok, false);
    assert.equal(endedSend.error.code, "SESSION_ENDED");

    const historyResponse = await fetch(
      `${url}/api/sessions/${SESSION_ID}/messages`,
    );
    const historyBody = (await historyResponse.json()) as {
      messages: Array<{
        id: string;
        participantId: string;
        role: string;
        content: string;
      }>;
    };

    assert.equal(historyResponse.status, 200);
    assert.deepEqual(
      historyBody.messages.map((message) => message.content),
      ["Hello from support.", "Thanks, I can see it."],
    );
    assert.deepEqual(
      historyBody.messages.map((message) => message.role),
      ["AGENT", "CUSTOMER"],
    );
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
