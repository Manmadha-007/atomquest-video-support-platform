import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import express from "express";

const SESSION_ID = "invite-session-1";
const TOKEN = "invite-token-12345678901234567890";
const AGENT_ID = "invite-agent-1";

async function createTempDatabase(): Promise<{
  directory: string;
  databaseUrl: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "atomquest-invite-"));
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

test("invite inspection does not consume the customer seat", async () => {
  const { databaseUrl, directory } = await createTempDatabase();
  process.env.DATABASE_URL = databaseUrl;

  const [{ default: sessionRoutes }, { prisma }] = await Promise.all([
    import("../src/routes/sessionRoutes.js"),
    import("../src/config/prisma.js"),
  ]);

  await prepareSchema(prisma);
  await prisma.session.create({
    data: {
      id: SESSION_ID,
      token: TOKEN,
      status: "ACTIVE",
      participants: {
        create: {
          id: AGENT_ID,
          role: "AGENT",
        },
      },
    },
  });

  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionRoutes);

  const httpServer = createServer(app);
  const url = await listen(httpServer);

  try {
    const inviteResponse = await fetch(
      `${url}/api/sessions/invites/${TOKEN}`,
    );
    const inviteBody = (await inviteResponse.json()) as {
      session: {
        id: string;
        status: string;
        agentReady: boolean;
        customerJoined: boolean;
      };
    };

    assert.equal(inviteResponse.status, 200);
    assert.equal(inviteBody.session.id, SESSION_ID);
    assert.equal(inviteBody.session.status, "ACTIVE");
    assert.equal(inviteBody.session.agentReady, true);
    assert.equal(inviteBody.session.customerJoined, false);
    assert.equal(await prisma.participant.count(), 1);

    const joinResponse = await fetch(`${url}/api/sessions/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: TOKEN }),
    });

    assert.equal(joinResponse.status, 200);
    assert.equal(await prisma.participant.count(), 2);

    const usedInviteResponse = await fetch(
      `${url}/api/sessions/invites/${TOKEN}`,
    );
    const usedInviteBody = (await usedInviteResponse.json()) as {
      session: {
        customerJoined: boolean;
      };
    };

    assert.equal(usedInviteBody.session.customerJoined, true);
  } finally {
    await closeServer(httpServer);
    await prisma.$disconnect();
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});
