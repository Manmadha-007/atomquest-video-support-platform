import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import express from "express";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";

const SESSION_ID = "file-session-1";
const TOKEN = "file-token";
const AGENT_ID = "file-agent-1";
const CUSTOMER_ID = "file-customer-1";

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
    kind: "TEXT" | "FILE";
    content: string;
    attachment: {
      id: string;
      originalName: string;
      mimeType: string;
      extension: string;
      sizeBytes: number;
      downloadUrl: string;
    } | null;
    createdAt: string;
  };
}

async function createTempWorkspace(): Promise<{
  directory: string;
  databaseUrl: string;
  fileStorageDirectory: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "atomquest-files-"));
  const databasePath = path.join(directory, "test.db").replace(/\\/g, "/");

  return {
    directory,
    databaseUrl: `file:${databasePath}`,
    fileStorageDirectory: path.join(directory, "uploads", "files"),
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
    `CREATE UNIQUE INDEX "Participant_sessionId_role_key" ON "Participant"("sessionId", "role")`,
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

test("chat file sharing persists, broadcasts, validates, and downloads files", async () => {
  const { databaseUrl, directory, fileStorageDirectory } =
    await createTempWorkspace();
  process.env.DATABASE_URL = databaseUrl;
  process.env.FILE_STORAGE_DIR = fileStorageDirectory;

  const [
    { default: fileAttachmentRoutes },
    { default: sessionRoutes },
    { initializeSocketServer },
    { prisma },
  ] = await Promise.all([
    import("../src/routes/fileAttachmentRoutes.js"),
    import("../src/routes/sessionRoutes.js"),
    import("../src/sockets/socketServer.js"),
    import("../src/config/prisma.js"),
  ]);

  await prepareSchema(prisma);
  await prisma.session.create({
    data: {
      id: SESSION_ID,
      token: TOKEN,
      status: "ACTIVE",
      participants: {
        create: [
          { id: AGENT_ID, role: "AGENT" },
          { id: CUSTOMER_ID, role: "CUSTOMER" },
        ],
      },
    },
  });

  const app = express();
  app.use(express.json());
  app.use("/api/files", fileAttachmentRoutes);
  app.use("/api/sessions", sessionRoutes);

  const httpServer = createServer(app);
  const io = initializeSocketServer(httpServer);
  const url = await listen(httpServer);
  const agentSocket = await connectClient(url);
  const customerSocket = await connectClient(url);

  try {
    await emitAck(agentSocket, "session:join", {
      sessionId: SESSION_ID,
      participantId: AGENT_ID,
      role: "AGENT",
    });
    await emitAck(customerSocket, "session:join", {
      sessionId: SESSION_ID,
      participantId: CUSTOMER_ID,
      role: "CUSTOMER",
    });

    const agentSeesText = waitForEvent<ChatEventPayload>(
      agentSocket,
      "session:chat:new",
    );
    const customerSeesText = waitForEvent<ChatEventPayload>(
      customerSocket,
      "session:chat:new",
    );
    const textAck = await emitAck<ChatEventPayload>(
      agentSocket,
      "session:chat:send",
      {
        sessionId: SESSION_ID,
        participantId: AGENT_ID,
        content: "Please review this file.",
      },
    );

    assert.equal(textAck.ok, true);
    assert.equal(textAck.data.message.kind, "TEXT");
    await Promise.all([agentSeesText, customerSeesText]);

    const agentSeesFile = waitForEvent<ChatEventPayload>(
      agentSocket,
      "session:chat:new",
    );
    const customerSeesFile = waitForEvent<ChatEventPayload>(
      customerSocket,
      "session:chat:new",
    );
    const fileBytes = Buffer.from("hello from a shared file");
    const uploadResponse = await fetch(`${url}/api/files/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "x-atomquest-session-id": SESSION_ID,
        "x-atomquest-participant-id": CUSTOMER_ID,
        "x-atomquest-file-name": encodeURIComponent("notes.txt"),
      },
      body: fileBytes,
    });
    const uploadBody = (await uploadResponse.json()) as {
      attachment: {
        id: string;
        originalName: string;
        sizeBytes: number;
        downloadUrl: string;
      };
      message: {
        kind: string;
        attachment: { originalName: string } | null;
      };
    };

    assert.equal(uploadResponse.status, 201);
    assert.equal(uploadBody.message.kind, "FILE");
    assert.equal(uploadBody.attachment.originalName, "notes.txt");
    assert.equal(uploadBody.attachment.sizeBytes, fileBytes.length);

    const [agentFileEvent, customerFileEvent] = await Promise.all([
      agentSeesFile,
      customerSeesFile,
    ]);

    assert.equal(agentFileEvent.message.kind, "FILE");
    assert.equal(customerFileEvent.message.kind, "FILE");
    assert.equal(
      customerFileEvent.message.attachment?.originalName,
      "notes.txt",
    );

    const invalidUpload = await fetch(`${url}/api/files/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-atomquest-session-id": SESSION_ID,
        "x-atomquest-participant-id": CUSTOMER_ID,
        "x-atomquest-file-name": encodeURIComponent("malware.exe"),
      },
      body: Buffer.from("nope"),
    });

    assert.equal(invalidUpload.status, 400);

    const historyResponse = await fetch(
      `${url}/api/sessions/${SESSION_ID}/messages`,
    );
    const historyBody = (await historyResponse.json()) as {
      messages: Array<{ kind: string; content: string }>;
    };

    assert.equal(historyResponse.status, 200);
    assert.deepEqual(
      historyBody.messages.map((message) => message.kind),
      ["TEXT", "FILE"],
    );
    assert.deepEqual(
      historyBody.messages.map((message) => message.content),
      ["Please review this file.", "notes.txt"],
    );

    const filesResponse = await fetch(
      `${url}/api/files?sessionId=${encodeURIComponent(SESSION_ID)}`,
    );
    const filesBody = (await filesResponse.json()) as {
      files: Array<{ id: string; originalName: string }>;
    };

    assert.equal(filesResponse.status, 200);
    assert.equal(filesBody.files.length, 1);
    assert.equal(filesBody.files[0]?.originalName, "notes.txt");

    const deniedDownload = await fetch(
      `${url}/api/files/${uploadBody.attachment.id}/download?token=wrong`,
    );
    assert.equal(deniedDownload.status, 404);

    const downloadResponse = await fetch(
      `${url}${uploadBody.attachment.downloadUrl}`,
    );
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());

    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get("content-type"), "text/plain");
    assert.deepEqual(downloaded, fileBytes);

    await prisma.session.update({
      where: { id: SESSION_ID },
      data: {
        status: "ENDED",
        endedAt: new Date(),
        endedBy: "AGENT",
      },
    });

    const endedUpload = await fetch(`${url}/api/files/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "x-atomquest-session-id": SESSION_ID,
        "x-atomquest-participant-id": CUSTOMER_ID,
        "x-atomquest-file-name": encodeURIComponent("late.txt"),
      },
      body: Buffer.from("too late"),
    });

    assert.equal(endedUpload.status, 409);
  } finally {
    agentSocket.disconnect();
    customerSocket.disconnect();
    io.close();
    await closeServer(httpServer);
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
