-- CreateTable
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
);

-- CreateIndex
CREATE UNIQUE INDEX "Recording_downloadToken_key" ON "Recording"("downloadToken");

-- CreateIndex
CREATE INDEX "Recording_sessionId_createdAt_idx" ON "Recording"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Recording_status_idx" ON "Recording"("status");

-- CreateIndex
CREATE INDEX "Recording_startedByParticipantId_idx" ON "Recording"("startedByParticipantId");
