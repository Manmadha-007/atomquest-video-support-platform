-- Redefine Message with participant ownership for in-call chat.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Message" ("id", "sessionId", "participantId", "role", "content", "createdAt")
SELECT
    "Message"."id",
    "Message"."sessionId",
    COALESCE(
        (
            SELECT "Participant"."id"
            FROM "Participant"
            WHERE "Participant"."sessionId" = "Message"."sessionId"
              AND "Participant"."role" = CASE
                WHEN UPPER("Message"."sender") = 'CUSTOMER' THEN 'CUSTOMER'
                ELSE 'AGENT'
              END
            LIMIT 1
        ),
        (
            SELECT "Participant"."id"
            FROM "Participant"
            WHERE "Participant"."sessionId" = "Message"."sessionId"
            LIMIT 1
        )
    ),
    CASE
        WHEN UPPER("Message"."sender") = 'CUSTOMER' THEN 'CUSTOMER'
        ELSE 'AGENT'
    END,
    "Message"."content",
    "Message"."createdAt"
FROM "Message"
WHERE COALESCE(
    (
        SELECT "Participant"."id"
        FROM "Participant"
        WHERE "Participant"."sessionId" = "Message"."sessionId"
          AND "Participant"."role" = CASE
            WHEN UPPER("Message"."sender") = 'CUSTOMER' THEN 'CUSTOMER'
            ELSE 'AGENT'
          END
        LIMIT 1
    ),
    (
        SELECT "Participant"."id"
        FROM "Participant"
        WHERE "Participant"."sessionId" = "Message"."sessionId"
        LIMIT 1
    )
) IS NOT NULL;

DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";

CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");
CREATE INDEX "Message_participantId_idx" ON "Message"("participantId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
