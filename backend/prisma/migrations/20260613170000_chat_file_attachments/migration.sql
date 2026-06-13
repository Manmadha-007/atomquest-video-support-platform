-- Add message kind so chat history can contain text and file messages.
ALTER TABLE "Message" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TEXT';

-- Persist shared file metadata separately from local file bytes.
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
);

CREATE UNIQUE INDEX "FileAttachment_messageId_key" ON "FileAttachment"("messageId");

CREATE UNIQUE INDEX "FileAttachment_downloadToken_key" ON "FileAttachment"("downloadToken");

CREATE INDEX "FileAttachment_sessionId_createdAt_idx" ON "FileAttachment"("sessionId", "createdAt");

CREATE INDEX "FileAttachment_participantId_idx" ON "FileAttachment"("participantId");
