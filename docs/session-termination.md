# Session Termination Lifecycle

## Architecture Changes

Session termination is now a durable REST operation plus a realtime room event:

```text
Agent VideoCallPage
  |
  | POST /api/sessions/:sessionId/end
  v
Express Controller
  |
  | Prisma transaction
  | - validate session exists
  | - reject already ENDED
  | - status = ENDED
  | - endedAt = current timestamp
  | - endedBy = AGENT
  | - participants.leftAt = endedAt where leftAt is null
  v
Session DTO
  |
  | broadcastSessionEnded(session)
  v
Socket.IO room session:{sessionId}
  |
  | emit session:ended
  | remove sockets from room
  v
Agent + Customer VideoCallPage
  |
  | stop local tracks
  | close RTCPeerConnection
  | disconnect Socket.IO client
  | show ended state
```

The existing WebRTC signaling events remain unchanged:

```text
webrtc:offer
webrtc:answer
webrtc:ice-candidate
```

## Files Changed

Backend:

```text
backend/src/controllers/sessionController.ts
backend/src/services/sessionService.ts
backend/src/sockets/presenceRegistry.ts
backend/src/sockets/sessionBroadcaster.ts
backend/src/sockets/socketServer.ts
backend/src/sockets/types.ts
backend/tests/sessionTermination.test.ts
backend/package.json
```

Frontend:

```text
frontend/src/api/sessions.ts
frontend/src/pages/VideoCallPage.tsx
frontend/src/types/session.ts
frontend/src/webrtc/index.ts
frontend/src/webrtc/signalingClient.ts
frontend/src/webrtc/types.ts
```

## API Contract

Request:

```http
POST /api/sessions/:sessionId/end
Content-Type: application/json

{}
```

Success:

```json
{
  "session": {
    "id": "session-id",
    "token": "invite-token",
    "status": "ENDED",
    "createdAt": "2026-06-13T00:00:00.000Z",
    "endedAt": "2026-06-13T00:15:00.000Z",
    "endedBy": "AGENT",
    "participants": [
      {
        "id": "agent-id",
        "sessionId": "session-id",
        "role": "AGENT",
        "joinedAt": "2026-06-13T00:00:00.000Z",
        "leftAt": "2026-06-13T00:15:00.000Z"
      }
    ],
    "messages": []
  }
}
```

Errors:

```text
404 SESSION_NOT_FOUND
409 SESSION_ALREADY_ENDED
400 VALIDATION_INVALID_SESSION_ID
```

## Realtime Event

Server emits to all sockets in `session:{sessionId}`:

```ts
interface SessionEndedPayload {
  sessionId: string;
  room: string;
  session: SessionDetails;
  endedAt: string;
  endedBy: string;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
}
```

Event name:

```text
session:ended
```

## Frontend Behavior

Agent:

- Clicks `End session`.
- Calls `POST /api/sessions/:sessionId/end`.
- Stops local camera/microphone tracks.
- Closes `RTCPeerConnection`.
- Disconnects Socket.IO.
- Shows `Session ended`.

Customer:

- Receives `session:ended`.
- Stops local camera/microphone tracks.
- Closes `RTCPeerConnection`.
- Disconnects Socket.IO.
- Shows `Session ended`.

Customer `Leave call` remains local-only and does not end the durable session.

## Tests Added

`backend/tests/sessionTermination.test.ts` verifies:

- `POST /api/sessions/:sessionId/end` returns `200`.
- Response session status is `ENDED`.
- `endedBy` is forced to `AGENT`.
- `endedAt` is set.
- Active participants are marked with `leftAt`.
- Agent and customer sockets both receive `session:ended`.
- Duplicate end attempts return `409 SESSION_ALREADY_ENDED`.
- Missing sessions return `404 SESSION_NOT_FOUND`.

Run:

```powershell
cd D:\atomquest-finale\backend
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test
```

## Manual Verification

Start backend:

```powershell
cd D:\atomquest-finale\backend
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev
```

Start frontend:

```powershell
cd D:\atomquest-finale\frontend
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev -- --host 127.0.0.1
```

Create and join session:

```powershell
$created = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:5000/api/sessions `
  -ContentType "application/json" `
  -Body "{}"

$sessionId = $created.session.id
$token = $created.session.token
$agentId = ($created.session.participants | Where-Object role -eq "AGENT").id

$joined = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:5000/api/sessions/join `
  -ContentType "application/json" `
  -Body (@{ token = $token } | ConvertTo-Json)

$customerId = $joined.participant.id
```

Open agent:

```text
http://127.0.0.1:5173/call?sessionId={SESSION_ID}&participantId={AGENT_ID}&targetParticipantId={CUSTOMER_ID}&role=AGENT&initiator=true
```

Open customer:

```text
http://127.0.0.1:5173/call?sessionId={SESSION_ID}&participantId={CUSTOMER_ID}&targetParticipantId={AGENT_ID}&role=CUSTOMER&initiator=false
```

Steps:

1. Customer clicks `Join media`.
2. Customer allows camera/microphone.
3. Agent clicks `Join media`.
4. Agent allows camera/microphone.
5. Agent clicks `Start call`.
6. Confirm both pages show `connected`.
7. Agent clicks `End session`.
8. Confirm both pages show `Session ended`.
9. Confirm camera/microphone indicators turn off.
10. Confirm remote video stops.

Verify database/API:

```powershell
$ended = Invoke-RestMethod http://localhost:5000/api/sessions/$sessionId
$ended.status
$ended.endedAt
$ended.endedBy
$ended.participants | Select-Object id, role, leftAt
```

Expected:

```text
status = ENDED
endedAt = non-null timestamp
endedBy = AGENT
all active participants have leftAt
```

Verify duplicate termination:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:5000/api/sessions/$sessionId/end `
  -ContentType "application/json" `
  -Body "{}"
```

Expected HTTP status:

```text
409
```

Expected error code:

```text
SESSION_ALREADY_ENDED
```
