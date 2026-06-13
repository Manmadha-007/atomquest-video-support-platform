# WebRTC Media Transport

## Architecture Changes

The signaling layer remains unchanged. Media transport is added entirely on the browser side:

```text
Agent VideoCallPage                         Customer VideoCallPage
  |                                               |
  | getUserMedia({ audio: true, video: true })    |
  | addTrack(local audio/video)                   |
  |                                               |
  | createOffer                                  |
  | webrtc:offer -------------------------------->|
  |                                               | setRemoteDescription
  |                                               | getUserMedia
  |                                               | addTrack(local audio/video)
  |                                               | createAnswer
  |<-------------------------------- webrtc:answer|
  | setRemoteDescription                          |
  |                                               |
  |<------------ webrtc:ice-candidate ----------->|
  |                                               |
  | ontrack(remote audio/video)                   | ontrack(remote audio/video)
  | render remote MediaStream                     | render remote MediaStream
```

The offerer attaches local tracks before creating the offer. The answerer uses the peer service `onBeforeAnswer` hook to attach local tracks before creating the answer.

No screen sharing, chat, recording, or Mediasoup transport is included.

## File Changes

```text
frontend/src/App.tsx
  Adds /call route.

frontend/src/pages/VideoCallPage.tsx
  Minimal two-party browser call page.

frontend/src/webrtc/mediaTransport.ts
  getUserMedia, local track attachment, remote track stream assembly, cleanup.

frontend/src/webrtc/peerConnectionService.ts
  Adds onBeforeAnswer and onRemoteTrack hooks.

frontend/src/webrtc/index.ts
  Exports media transport helpers.
```

## Components Created

- `VideoCallPage`
  - Joins the existing Socket.IO session.
  - Requests camera and microphone.
  - Adds local tracks to the existing `RTCPeerConnection`.
  - Handles remote tracks with `ontrack`.
  - Displays local preview, remote preview, connection state, ICE state, and ICE gathering state.

- `VideoPane`
  - Reusable video preview frame for local and remote streams.

- `StatusPill` and `Metric`
  - Compact connection diagnostics for manual validation.

## Local URLs

Create a session and customer participant first, then open:

Agent:

```text
http://127.0.0.1:5173/call?sessionId={SESSION_ID}&participantId={AGENT_ID}&targetParticipantId={CUSTOMER_ID}&role=AGENT&initiator=true
```

Customer:

```text
http://127.0.0.1:5173/call?sessionId={SESSION_ID}&participantId={CUSTOMER_ID}&targetParticipantId={AGENT_ID}&role=CUSTOMER&initiator=false
```

Use two browser profiles, two browsers, or one normal window plus one private window so permissions and Socket.IO state are isolated.

## Testing Strategy

Automated checks:

- `frontend npm run build`
- `frontend npm run lint`
- Existing backend signaling tests still validate `webrtc:offer`, `webrtc:answer`, and `webrtc:ice-candidate` routing.

Manual browser checks:

- Confirm both pages can join the Socket.IO session.
- Confirm both pages request camera and microphone.
- Confirm local previews render after permission is granted.
- Start the call from the agent page.
- Confirm the customer creates and sends an answer.
- Confirm ICE reaches a successful candidate pair.
- Confirm both pages show `connectionState: connected`.
- Confirm both users can see and hear each other.

## Manual Verification Checklist

Backend:

```powershell
cd D:\atomquest-finale\backend
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev
```

Frontend:

```powershell
cd D:\atomquest-finale\frontend
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev -- --host 127.0.0.1
```

Create session:

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

Open the agent URL and customer URL from the Local URLs section.

Customer steps:

1. Click `Join media`.
2. Allow camera and microphone permission.
3. Confirm local preview renders.
4. Wait for the agent offer.

Agent steps:

1. Click `Join media`.
2. Allow camera and microphone permission.
3. Confirm local preview renders.
4. Click `Start call`.
5. Wait until status shows `connected`.

Expected console logs:

```text
[call] session joined
[call] local media ready
[call] connectionState connecting
[call] offer sent
[call] remote track received
[call] iceConnectionState checking
[call] iceConnectionState connected
[call] connectionState connected
```

Expected UI:

```text
Connection: connected
ICE: connected or completed
Gathering: complete
Local: 2 tracks
Remote: 2 tracks
```

Chrome diagnostics:

```text
chrome://webrtc-internals
```

Verify:

```text
connectionState = connected
signalingState = stable
iceConnectionState = connected or completed
audio sender exists
video sender exists
audio receiver exists
video receiver exists
selected candidate pair state = succeeded
```

Stop once both pages show:

```text
connectionState: connected
Remote: 2 tracks
```
