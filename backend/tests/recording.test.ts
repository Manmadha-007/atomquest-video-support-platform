import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import express from "express";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";

const SESSION_ID = "recording-session-1";
const TOKEN = "recording-token";
const AGENT_ID = "recording-agent-1";
const CUSTOMER_ID = "recording-customer-1";

async function createTempWorkspace(): Promise<{
  directory: string;
  databaseUrl: string;
  storageDirectory: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "atomquest-recording-"));
  const databasePath = path.join(directory, "test.db").replace(/\\/g, "/");

  return {
    directory,
    databaseUrl: `file:${databasePath}`,
    storageDirectory: path.join(directory, "recordings"),
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

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<unknown> {
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

async function waitForReady(
  url: string,
  recordingId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 8_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${url}/api/recordings`);
    const body = (await response.json()) as {
      recordings: Array<Record<string, unknown>>;
    };
    const recording = body.recordings.find(
      (candidate) => candidate["id"] === recordingId,
    );

    if (recording?.["status"] === "READY") {
      return recording;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for recording to become ready.");
}

test("agents record, customers cannot control recording, and ready files download", async () => {
  const { databaseUrl, directory, storageDirectory } =
    await createTempWorkspace();
  process.env.DATABASE_URL = databaseUrl;
  process.env.RECORDING_STORAGE_DIR = storageDirectory;

  const [
    { default: recordingRoutes },
    { default: sessionRoutes },
    { initializeSocketServer },
    { prisma },
  ] = await Promise.all([
    import("../src/routes/recordingRoutes.js"),
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
  app.use("/api/recordings", recordingRoutes);
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

    const customerStart = await fetch(`${url}/api/recordings/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        participantId: CUSTOMER_ID,
        mimeType: "video/webm",
      }),
    });

    assert.equal(customerStart.status, 403);

    const agentSeesRecording = waitForEvent<Record<string, unknown>>(
      agentSocket,
      "recording:update",
    );
    const customerSeesRecording = waitForEvent<Record<string, unknown>>(
      customerSocket,
      "recording:update",
    );
    const startResponse = await fetch(`${url}/api/recordings/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        participantId: AGENT_ID,
        mimeType: "video/webm",
      }),
    });
    const startBody = (await startResponse.json()) as {
      recording: { id: string; status: string };
    };

    assert.equal(startResponse.status, 201);
    assert.equal(startBody.recording.status, "RECORDING");
    assert.equal(
      (
        (await agentSeesRecording)["recording"] as Record<string, unknown>
      )["status"],
      "RECORDING",
    );
    assert.equal(
      (
        (await customerSeesRecording)["recording"] as Record<string, unknown>
      )["status"],
      "RECORDING",
    );

    const firstChunk = Buffer.from("first-webm-chunk");
    const secondChunk = Buffer.from("second-webm-chunk");

    for (const [sequence, chunk] of [firstChunk, secondChunk].entries()) {
      const chunkResponse = await fetch(
        `${url}/api/recordings/${startBody.recording.id}/chunks/${sequence}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-atomquest-participant-id": AGENT_ID,
          },
          body: chunk,
        },
      );

      assert.equal(chunkResponse.status, 200);
    }

    const stopResponse = await fetch(
      `${url}/api/recordings/${startBody.recording.id}/stop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: AGENT_ID }),
      },
    );
    const stopBody = (await stopResponse.json()) as {
      recording: { status: string };
    };

    assert.equal(stopResponse.status, 200);
    assert.equal(stopBody.recording.status, "PROCESSING");

    const readyRecording = await waitForReady(url, startBody.recording.id);
    assert.equal(readyRecording["sizeBytes"], firstChunk.length + secondChunk.length);
    assert.equal(typeof readyRecording["downloadUrl"], "string");

    const downloadResponse = await fetch(
      `${url}${String(readyRecording["downloadUrl"])}`,
    );
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());

    assert.equal(downloadResponse.status, 200);
    assert.deepEqual(downloaded, Buffer.concat([firstChunk, secondChunk]));

    const secondStart = await fetch(`${url}/api/recordings/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        participantId: AGENT_ID,
        mimeType: "video/webm",
      }),
    });
    const secondStartBody = (await secondStart.json()) as {
      recording: { id: string };
    };

    assert.equal(secondStart.status, 201);

    const endResponse = await fetch(`${url}/api/sessions/${SESSION_ID}/end`, {
      method: "POST",
    });
    assert.equal(endResponse.status, 200);

    const autoStopped = await prisma.recording.findUniqueOrThrow({
      where: { id: secondStartBody.recording.id },
    });

    assert.equal(autoStopped.status, "PROCESSING");
    assert.equal(autoStopped.stopReason, "SESSION_ENDED");
  } finally {
    agentSocket.disconnect();
    customerSocket.disconnect();
    io.close();
    await closeServer(httpServer);
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
