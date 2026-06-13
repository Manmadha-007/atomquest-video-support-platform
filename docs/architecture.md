# AtomQuest Finale System Architecture

AtomQuest Finale is a real-time customer support platform where an agent creates a support session, invites a customer, tracks live presence, conducts a video session, receives AI support, and stores the completed session history.

This document describes the complete high-level architecture for hackathon judging, technical documentation, implementation guidance, and the future scaling roadmap.

## 1. Product Architecture Overview

### Core Business Domains

- Session Management: create, join, end, and retrieve support sessions.
- Participant Management: agent/customer identity, roles, join/leave lifecycle, reconnect state.
- Real-Time Collaboration: presence, room membership, signaling, session status updates.
- Video Support: browser media capture, peer connection lifecycle, STUN/TURN traversal.
- AI Assistance: transcript analysis, issue classification, recommendations, retrieval, summaries.
- Session History: durable messages, participants, AI interactions, analytics, audit logs.
- Operations: deployment, observability, rate limiting, logging, incident diagnostics.

### Primary User Journeys

- Agent journey: open dashboard -> create session -> copy invite link -> wait for customer -> join live room -> start video -> use AI suggestions -> end session -> review history.
- Customer journey: open invite link -> token validated -> join session -> presence published -> connect video -> receive support -> leave/end.
- Admin/operations journey: monitor health -> inspect logs/metrics -> review audit trail -> scale services.

### Major Subsystems

- Frontend React app: dashboard, customer join, session room, video UI, AI side panel.
- Express API: session lifecycle, participant creation, history retrieval, analytics endpoints.
- Prisma persistence: sessions, participants, messages, AI interactions, audit logs.
- Socket.IO realtime service: rooms, presence registry, reconnect grace, WebRTC signaling.
- WebRTC browser layer: media capture, peer connection, tracks, ICE negotiation.
- AI service layer: transcript ingestion, retrieval, recommendations, summaries.
- Deployment/observability: Vercel, Render, logs, metrics, tracing, alerts.

### High-Level Architecture Diagram

```text
+----------------------+       HTTPS        +-------------------------+
| Frontend - Vercel    | <----------------> | Backend API - Render    |
| React/Vite/TS        |                    | Express/TS/Prisma       |
|                      |                    |                         |
| Agent Dashboard      |       Socket.IO    | Session Controllers     |
| Customer Join        | <================> | Presence + Signaling    |
| Session Room         |                    | AI Orchestrator         |
+----------+-----------+                    +-----------+-------------+
           |                                            |
           | WebRTC media path                          | Prisma
           v                                            v
+----------+-----------+                    +-----------+-------------+
| Browser Peer         | <--- SRTP/ICE ---> | Browser Peer            |
| Agent media          |                    | Customer media          |
+----------+-----------+                    +-----------+-------------+
           ^                                            ^
           |                                            |
           +-------------- STUN/TURN -------------------+
                                                        |
                                           +------------+-------------+
                                           | DB: SQLite MVP           |
                                           | Postgres production      |
                                           +------------+-------------+
                                                        |
                                           +------------+-------------+
                                           | AI Providers + Vector DB |
                                           | LLM, ASR, embeddings     |
                                           +--------------------------+
```

### End-to-End Data Flow

```text
1. Agent creates session over REST.
2. Backend stores Session and Agent Participant in the database.
3. Backend returns invite token.
4. Customer opens /join/:token and calls REST join endpoint.
5. Backend validates token and creates Customer Participant.
6. Both clients connect to Socket.IO and join session:{sessionId}.
7. Presence registry emits participant:update events to the room.
8. WebRTC offer/answer/ICE messages are routed over Socket.IO.
9. Media flows peer-to-peer through WebRTC, assisted by STUN/TURN.
10. Transcript/messages/AI outputs are persisted through backend services.
11. Agent ends session; backend marks participants left and stores history.
```

## 2. System Components

### Frontend Layer

Responsibilities:
- Render agent dashboard, customer join, session room, video controls, AI assistant, and history views.
- Own browser media capture, WebRTC peer connection state, Socket.IO client state, and optimistic UI state.
- Validate user input before API calls and display recoverable errors.

Dependencies:
- React, TypeScript, Vite, TailwindCSS, axios, socket.io-client, browser WebRTC APIs.

Communication patterns:
- REST for durable commands and queries.
- Socket.IO for live presence, signaling, and session events.
- WebRTC for media streams.

### Backend Layer

Responsibilities:
- Expose REST APIs for session lifecycle, participant join, messages, AI interactions, analytics, and history.
- Enforce business rules, input validation, authorization, rate limiting, and audit logging.
- Coordinate Socket.IO room state and WebRTC signaling.

Dependencies:
- Express, TypeScript, Prisma, Socket.IO, AI SDK/provider clients, validation middleware.

Communication patterns:
- HTTP request/response for commands and queries.
- Socket.IO pub/sub rooms for live events.
- Prisma queries and transactions for durable state.
- Outbound HTTPS to AI providers and retrieval services.

### Database Layer

Responsibilities:
- Persist session lifecycle, participant records, messages/transcripts, AI outputs, and audit logs.
- Provide indexed query paths for dashboards, session history, analytics, and compliance.

Dependencies:
- SQLite for hackathon MVP.
- Postgres for production beta and enterprise.
- Prisma migrations and generated client.

Communication patterns:
- Backend-only access through repositories/services.
- No direct frontend access.

### Real-Time Layer

Responsibilities:
- Maintain room membership, active participants, reconnect grace, and event routing.
- Broadcast participant state changes and session lifecycle updates.
- Relay WebRTC offer, answer, and ICE candidate payloads.

Dependencies:
- Socket.IO server/client.
- In-memory presence registry for MVP.
- Redis adapter for multi-instance production.

Communication patterns:
- Client emits events with acknowledgement callbacks.
- Server validates event payloads, updates registry, broadcasts room events.

### WebRTC Layer

Responsibilities:
- Establish secure low-latency audio/video between agent and customer.
- Manage offer/answer negotiation, ICE candidates, media tracks, device selection, mute/camera states, and teardown.

Dependencies:
- Browser RTCPeerConnection, getUserMedia, STUN/TURN servers.
- Socket.IO signaling channel.

Communication patterns:
- Signaling via backend Socket.IO.
- Media directly between peers when possible.
- Media relayed through TURN when NAT/firewall conditions require it.

### AI Layer

Responsibilities:
- Analyze live transcript, classify issue, recommend agent responses, retrieve knowledge, summarize session.
- Store AI inputs/outputs for explainability, history, and analytics.

Dependencies:
- Speech-to-text provider or browser/server transcription pipeline.
- LLM provider, embedding model, vector database/knowledge base.
- Backend AI service and repository.

Communication patterns:
- Transcript chunks/messages enter backend through REST or Socket.IO.
- AI jobs run synchronously for quick suggestions or asynchronously for summaries.
- Results stream/broadcast back to session room and persist to database.

### Monitoring Layer

Responsibilities:
- Track API health, Socket.IO connections, session duration, WebRTC quality, AI latency/cost, and errors.
- Provide logs, metrics, traces, and alerting for operations.

Dependencies:
- Render/Vercel logs for MVP.
- Sentry, OpenTelemetry, Prometheus/Grafana, or hosted observability for production.

Communication patterns:
- Structured JSON logs from backend.
- Browser error reports from frontend.
- Metrics exported through backend health/metrics endpoints.

### Deployment Layer

Responsibilities:
- Build, configure, deploy, and rollback frontend/backend services.
- Manage environment variables, migrations, preview deployments, and release checks.

Dependencies:
- Vercel for frontend.
- Render for backend.
- GitHub Actions for CI/CD.
- Managed Postgres/Redis/TURN provider in production.

Communication patterns:
- Browser calls Vercel static app.
- Frontend calls Render API and Socket.IO endpoint.
- Backend calls database, Redis, TURN credentials service, and AI APIs.

## 3. Frontend Architecture

Recommended `frontend/src` structure:

```text
frontend/src
|-- api
|   |-- client.ts
|   |-- sessions.ts
|   |-- messages.ts
|   |-- ai.ts
|   `-- analytics.ts
|-- assets
|-- components
|   |-- layout
|   |   |-- AppShell.tsx
|   |   `-- SessionHeader.tsx
|   |-- session
|   |   |-- InviteCard.tsx
|   |   |-- ParticipantList.tsx
|   |   |-- PresenceBadge.tsx
|   |   `-- SessionTimeline.tsx
|   |-- video
|   |   |-- LocalVideo.tsx
|   |   |-- RemoteVideo.tsx
|   |   |-- MediaControls.tsx
|   |   `-- DevicePicker.tsx
|   |-- ai
|   |   |-- AIAssistantPanel.tsx
|   |   |-- RecommendationList.tsx
|   |   |-- IssueClassification.tsx
|   |   `-- SessionSummary.tsx
|   `-- ui
|       |-- Button.tsx
|       |-- EmptyState.tsx
|       |-- ErrorState.tsx
|       `-- LoadingState.tsx
|-- hooks
|   |-- useSession.ts
|   |-- usePresence.ts
|   |-- useSocket.ts
|   |-- useWebRTC.ts
|   |-- useMediaDevices.ts
|   `-- useAIAssistant.ts
|-- pages
|   |-- AgentDashboard.tsx
|   |-- CustomerJoinPage.tsx
|   |-- SessionRoomPage.tsx
|   `-- SessionHistoryPage.tsx
|-- realtime
|   |-- socketClient.ts
|   |-- socketEvents.ts
|   `-- presenceStore.ts
|-- state
|   |-- sessionStore.ts
|   |-- uiStore.ts
|   `-- authStore.ts
|-- types
|   |-- session.ts
|   |-- socket.ts
|   |-- webrtc.ts
|   `-- ai.ts
|-- webrtc
|   |-- peerConnection.ts
|   |-- signaling.ts
|   |-- media.ts
|   `-- iceServers.ts
|-- App.tsx
|-- main.tsx
`-- index.css
```

Design rationale:
- Pages coordinate route-level workflows.
- Components stay presentational or workflow-local.
- Hooks own lifecycle-heavy browser concerns such as sockets, media devices, and peer connections.
- API services keep HTTP parsing and error handling out of UI components.
- `realtime` and `webrtc` are explicit because their failure modes and lifecycles differ from normal React state.

State management:
- MVP: React local state plus custom hooks.
- Beta: add Zustand or TanStack Query for sessions, presence snapshots, and async cache invalidation.
- Enterprise: normalize event-sourced session room state and persist critical UI recovery data in sessionStorage.

## 4. Backend Architecture

Recommended `backend/src` structure:

```text
backend/src
|-- app.ts
|-- index.ts
|-- config
|   |-- env.ts
|   |-- prisma.ts
|   |-- cors.ts
|   `-- logger.ts
|-- routes
|   |-- sessionRoutes.ts
|   |-- messageRoutes.ts
|   |-- aiRoutes.ts
|   |-- analyticsRoutes.ts
|   `-- healthRoutes.ts
|-- controllers
|   |-- sessionController.ts
|   |-- messageController.ts
|   |-- aiController.ts
|   `-- analyticsController.ts
|-- services
|   |-- sessionService.ts
|   |-- participantService.ts
|   |-- messageService.ts
|   |-- signalingService.ts
|   |-- aiAssistantService.ts
|   |-- transcriptService.ts
|   `-- analyticsService.ts
|-- repositories
|   |-- sessionRepository.ts
|   |-- participantRepository.ts
|   |-- messageRepository.ts
|   |-- aiInteractionRepository.ts
|   `-- auditLogRepository.ts
|-- sockets
|   |-- socketServer.ts
|   |-- sessionHandlers.ts
|   |-- signalingHandlers.ts
|   |-- presenceRegistry.ts
|   |-- roomRegistry.ts
|   `-- types.ts
|-- ai
|   |-- providers
|   |   |-- llmProvider.ts
|   |   |-- transcriptionProvider.ts
|   |   `-- embeddingProvider.ts
|   |-- prompts
|   |   |-- classifyIssue.ts
|   |   |-- recommendAction.ts
|   |   `-- summarizeSession.ts
|   `-- retrieval
|       |-- knowledgeBase.ts
|       `-- vectorSearch.ts
|-- middleware
|   |-- authMiddleware.ts
|   |-- rateLimitMiddleware.ts
|   |-- validateRequest.ts
|   |-- errorHandler.ts
|   `-- auditMiddleware.ts
|-- prisma
|   `-- generatedClientBoundary.ts
|-- types
|   |-- sessionTypes.ts
|   |-- socketTypes.ts
|   |-- aiTypes.ts
|   `-- apiTypes.ts
`-- utils
    |-- ids.ts
    |-- time.ts
    `-- result.ts
```

Design rationale:
- Controllers validate transport-level input and shape responses.
- Services enforce business workflows and transaction boundaries.
- Repositories isolate Prisma query details and make the database migration path cleaner.
- Socket handlers remain thin and delegate business logic to services.
- AI modules keep provider-specific code separate from product behavior.

## 5. Database Architecture

Current MVP uses SQLite and Prisma. Production should move to Postgres because sessions, analytics, search, concurrent writes, and retention policies will outgrow SQLite.

### Logical Schema

```text
Session
|-- id: string PK
|-- token: string UNIQUE
|-- status: ACTIVE | ENDED
|-- createdAt: datetime
|-- endedAt: datetime?
|-- endedBy: string?
|-- metadata: json?

Participant
|-- id: string PK
|-- sessionId: string FK -> Session.id
|-- role: AGENT | CUSTOMER
|-- displayName: string?
|-- userId: string?
|-- joinedAt: datetime
|-- leftAt: datetime?
|-- lastSeenAt: datetime?

Message
|-- id: string PK
|-- sessionId: string FK -> Session.id
|-- participantId: string? FK -> Participant.id
|-- sender: string
|-- type: CHAT | TRANSCRIPT | SYSTEM
|-- content: text
|-- createdAt: datetime

AIInteraction
|-- id: string PK
|-- sessionId: string FK -> Session.id
|-- messageId: string? FK -> Message.id
|-- type: CLASSIFICATION | RECOMMENDATION | RETRIEVAL | SUMMARY
|-- input: json
|-- output: json
|-- model: string
|-- confidence: float?
|-- latencyMs: int?
|-- tokenUsage: json?
|-- createdAt: datetime

AuditLog
|-- id: string PK
|-- actorId: string?
|-- actorRole: AGENT | CUSTOMER | SYSTEM
|-- sessionId: string? FK -> Session.id
|-- action: string
|-- targetType: string
|-- targetId: string?
|-- ipAddress: string?
|-- userAgent: string?
|-- metadata: json?
|-- createdAt: datetime
```

### Relationships

```text
Session 1 --- many Participant
Session 1 --- many Message
Session 1 --- many AIInteraction
Session 1 --- many AuditLog
Participant 1 --- many Message
Message 0/1 --- many AIInteraction
```

### Prisma Model Direction

```prisma
model Session {
  id             String          @id @default(cuid())
  token          String          @unique
  status         SessionStatus   @default(ACTIVE)
  createdAt      DateTime        @default(now())
  endedAt        DateTime?
  endedBy        String?
  participants   Participant[]
  messages       Message[]
  aiInteractions AIInteraction[]
  auditLogs      AuditLog[]

  @@index([status, createdAt])
  @@index([createdAt])
}

model Participant {
  id          String          @id @default(cuid())
  sessionId   String
  session     Session         @relation(fields: [sessionId], references: [id])
  role        ParticipantRole
  displayName String?
  userId      String?
  joinedAt    DateTime        @default(now())
  leftAt      DateTime?
  lastSeenAt  DateTime?
  messages    Message[]

  @@unique([sessionId, role])
  @@index([sessionId])
  @@index([userId])
}

model Message {
  id             String          @id @default(cuid())
  sessionId      String
  session        Session         @relation(fields: [sessionId], references: [id])
  participantId  String?
  participant    Participant?    @relation(fields: [participantId], references: [id])
  sender         String
  type           MessageType     @default(CHAT)
  content        String
  createdAt      DateTime        @default(now())
  aiInteractions AIInteraction[]

  @@index([sessionId, createdAt])
  @@index([participantId, createdAt])
}

model AIInteraction {
  id          String            @id @default(cuid())
  sessionId   String
  session     Session           @relation(fields: [sessionId], references: [id])
  messageId   String?
  message     Message?          @relation(fields: [messageId], references: [id])
  type        AIInteractionType
  input       Json
  output      Json
  model       String
  confidence  Float?
  latencyMs   Int?
  tokenUsage  Json?
  createdAt   DateTime          @default(now())

  @@index([sessionId, createdAt])
  @@index([type, createdAt])
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  actorRole  String
  sessionId  String?
  session    Session? @relation(fields: [sessionId], references: [id])
  action     String
  targetType String
  targetId   String?
  ipAddress  String?
  userAgent  String?
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([sessionId, createdAt])
  @@index([actorId, createdAt])
  @@index([action, createdAt])
}
```

### Indexing Strategy

- `Session.token`: unique lookup for customer invite joins.
- `Session.status, createdAt`: dashboard active-session queries.
- `Participant.sessionId`: room participant hydration.
- `Participant.sessionId, role`: enforce one agent and one customer in MVP.
- `Message.sessionId, createdAt`: timeline and transcript loading.
- `AIInteraction.sessionId, createdAt`: assistant panel and session summary timeline.
- `AuditLog.sessionId, createdAt`: compliance and incident review.
- Future Postgres: partial index for active sessions, GIN indexes for JSON metadata, full-text index for transcript search.

## 6. Real-Time Architecture

### Socket.IO Room Model

```text
Namespace: /
Room: session:{sessionId}

Participant Registry Key:
  {sessionId}:{participantId}

Registry Entry:
  participantId
  sessionId
  role
  activeSocketId
  status: online | reconnecting | offline
  connectionVersion
  joinedAt
  lastSeenAt
  disconnectDeadline
  transport
```

### Core Events

Client to server:
- `session:join` with `{ sessionId, participantId, role }`
- `session:leave` with `{ sessionId, participantId? }`
- `webrtc:offer` with `{ sessionId, fromParticipantId, toParticipantId, offer }`
- `webrtc:answer` with `{ sessionId, fromParticipantId, toParticipantId, answer }`
- `webrtc:ice-candidate` with `{ sessionId, fromParticipantId, toParticipantId, candidate }`
- `message:create` with `{ sessionId, participantId, content, type }`
- `ai:request` with `{ sessionId, type, input }`

Server to client:
- `session:joined`
- `session:left`
- `participant:update`
- `session:ended`
- `webrtc:offer`
- `webrtc:answer`
- `webrtc:ice-candidate`
- `message:created`
- `ai:result`
- `socket:error`

### Presence Flow

```text
Client                 Socket.IO Server          Presence Registry        Room
  | session:join              |                         |                  |
  |-------------------------->| validate DB participant |                  |
  |                           |------------------------>| upsert online    |
  |                           | socket.join(room)       |                  |
  |                           | emit session:joined     |                  |
  |<--------------------------|                         |                  |
  |                           | broadcast update        | participant:update
  |<--------------------------+-------------------------+----------------->|
```

### Reconnect Handling

```text
Socket disconnect
  -> registry marks participant reconnecting
  -> room receives participant:update status=reconnecting
  -> 15s grace timer starts
  -> if same participant rejoins, timer clears and status=online
  -> if timer expires, registry removes participant and emits session:left
```

### Multi-Instance Production Upgrade

```text
MVP:
  one Render instance -> in-memory presence registry

Production:
  many backend instances -> Socket.IO Redis adapter
  Redis stores ephemeral presence and room membership hints
  Postgres remains durable source of truth
```

## 7. WebRTC Architecture

### Signaling and Media Responsibilities

- Socket.IO only exchanges signaling metadata.
- WebRTC transports encrypted audio/video directly between browsers where possible.
- STUN helps peers discover public network addresses.
- TURN relays media when direct peer-to-peer connectivity fails.

### Offer/Answer/ICE Sequence

```text
Agent Browser        Backend Socket.IO       Customer Browser
     |                      |                       |
     | getUserMedia         |                       |
     | create RTCPeerConn   |                       |
     | createOffer          |                       |
     | setLocalDescription  |                       |
     | webrtc:offer         |                       |
     |--------------------->| validate room/target  |
     |                      | webrtc:offer          |
     |                      |---------------------->|
     |                      |              setRemoteDescription
     |                      |              getUserMedia
     |                      |              createAnswer
     |                      |              setLocalDescription
     |                      | webrtc:answer         |
     |<---------------------|<----------------------|
     | setRemoteDescription |                       |
     |                      |                       |
     | ICE candidates       |                       |
     |<====================>| relay candidates      |
     |                      |<=====================>|
     |                      |                       |
     | SRTP media flows directly or through TURN     |
     |<============================================>|
```

### ICE Candidate Flow

```text
1. Each peer gathers host, server-reflexive, and relay candidates.
2. Each `icecandidate` event is sent to backend through Socket.IO.
3. Backend validates session room and target participant.
4. Backend forwards candidate to the other participant.
5. Browsers test candidate pairs and select the best working route.
6. If direct route fails, TURN relay candidate carries media.
```

### STUN, TURN, and NAT Traversal

- STUN: tells a browser what public IP/port the outside world sees. It is lightweight and works for many home/mobile networks.
- TURN: relays encrypted media through a server when firewalls or symmetric NAT prevent direct peer connectivity.
- ICE: browser algorithm that gathers possible routes, tests them, and selects the best candidate pair.
- MVP can use public STUN servers for demos.
- Production should use a managed TURN provider or self-hosted coturn with expiring credentials.

### Future Mediasoup Migration Path

```text
Phase 1: Peer-to-peer WebRTC
  Browser <-> Browser
  Socket.IO signaling only
  Best for one agent and one customer

Phase 2: SFU for recording and multi-party
  Browser -> Mediasoup SFU -> Browser
  Backend issues transport parameters
  Better for supervisors, recording, transcription, and quality control

Phase 3: Regional media edge
  Browser -> nearest SFU region
  Global load balancing
  Enterprise call quality and compliance controls
```

Migration steps:
- Keep signaling events abstract: `call:start`, `call:join`, `media:publish`, `media:subscribe`.
- Introduce `MediaSession` and `MediaParticipant` records before SFU cutover.
- Move from browser-created peer offers to server-coordinated SFU transports.
- Add recording/transcription consumers on the SFU side.

## 8. AI Architecture

### Capabilities

- Live transcript analysis.
- Customer issue classification.
- Agent recommendations.
- Knowledge retrieval.
- Session summarization.

### AI Processing Pipeline

```text
Audio/Chat/Transcript
        |
        v
+-------------------+
| Input Normalizer  |
| chunk, redact PII |
+---------+---------+
          |
          v
+-------------------+       +--------------------+
| AI Orchestrator   | <---> | Knowledge Retrieval |
| classify/recommend|       | embeddings/vector DB|
+---------+---------+       +--------------------+
          |
          v
+-------------------+
| Provider Adapter  |
| LLM / ASR / tools |
+---------+---------+
          |
          v
+-------------------+
| Output Validator  |
| schema, confidence|
+---------+---------+
          |
          v
+-------------------+       +--------------------+
| Persist Result    | ----> | Broadcast ai:result |
| AIInteraction     |       | Agent UI            |
+-------------------+       +--------------------+
```

### Input -> Processing -> Output

```text
Transcript chunk
  -> redact sensitive fields
  -> classify issue
  -> retrieve matching knowledge articles
  -> generate recommendation
  -> store AIInteraction
  -> emit ai:result to agent

Session end
  -> collect messages/transcript/presence metadata
  -> generate summary, action items, sentiment, tags
  -> store AIInteraction(type=SUMMARY)
  -> attach summary to history view
```

Design rationale:
- Keep AI calls server-side to protect API keys and enforce audit logging.
- Persist both input and output to make recommendations explainable.
- Use schema validation on AI output before showing it to the agent.
- Separate retrieval from generation so the knowledge base can evolve independently.

## 9. Security Architecture

### Controls

- Authentication: MVP can use lightweight agent identity; production should use OAuth/OIDC, SSO, or magic-link login.
- Authorization: role-based access for agent, customer, admin, and system jobs.
- Session tokens: use high-entropy invite tokens, store only active tokens, expire or revoke after session end.
- Input validation: validate REST bodies, socket payloads, AI requests, and route params with shared schemas.
- Rate limiting: protect create session, join session, socket connect, signaling, and AI endpoints.
- Audit logging: record session create/join/end, AI requests, token use, auth failures, and admin actions.
- CORS: restrict frontend origins in production.
- Secrets: keep AI keys, database URLs, TURN credentials, and JWT secrets in environment variables.
- Transport security: HTTPS/WSS only in production; WebRTC media is encrypted by DTLS-SRTP.
- Data protection: redact PII before AI processing where possible; set retention rules for transcripts.

### Risks and Mitigations

```text
Risk: Invite token leakage
Mitigation: high entropy, expiration, single-customer join, revoke on end, audit token use.

Risk: Unauthorized socket room join
Mitigation: validate participantId/sessionId/role against database before socket.join.

Risk: WebRTC connection failure behind strict NAT
Mitigation: production TURN service, connectivity diagnostics, graceful fallback messaging.

Risk: AI hallucinated recommendations
Mitigation: retrieval grounding, confidence display, output schemas, agent-only suggestions.

Risk: Prompt injection through transcript/customer text
Mitigation: isolate system prompts, treat transcript as untrusted data, restrict tool calls.

Risk: In-memory presence loss on restart
Mitigation: acceptable for MVP; Redis-backed presence and durable heartbeat events for production.

Risk: Cost spikes from AI calls
Mitigation: rate limits, chunking thresholds, caching, model routing, token budgets.
```

## 10. Deployment Architecture

### Current Deployment Target

- Frontend: Vercel.
- Backend: Render.
- Database: SQLite for MVP; managed Postgres for production.

### Environment Variables

Frontend:

```text
VITE_API_BASE_URL=https://atomquest-api.onrender.com/api
VITE_SOCKET_URL=https://atomquest-api.onrender.com
VITE_APP_ENV=production
```

Backend:

```text
NODE_ENV=production
PORT=5000
DATABASE_URL=...
FRONTEND_ORIGIN=https://atomquest-finale.vercel.app
SOCKET_IO_CORS_ORIGIN=https://atomquest-finale.vercel.app
JWT_SECRET=...
OPENAI_API_KEY=...
TURN_STATIC_AUTH_SECRET=...
REDIS_URL=...
LOG_LEVEL=info
```

### CI/CD Pipeline

```text
GitHub push
   |
   +-- frontend job: install -> lint -> typecheck -> test -> build
   |
   +-- backend job: install -> lint -> typecheck -> test -> prisma validate -> build
   |
   +-- migration job: prisma migrate deploy
   |
   +-- deploy frontend to Vercel
   |
   +-- deploy backend to Render
   |
   +-- smoke tests: health, create session, socket connect
```

### Deployment Diagram

```text
+-------------+       preview/prod       +----------------+
| GitHub Repo | -----------------------> | Vercel         |
| CI/CD       |                          | Frontend CDN   |
+------+------+                          +--------+-------+
       |                                          |
       | backend deploy                           | HTTPS/WSS
       v                                          v
+------+-------+        Prisma          +---------+-------+
| Render API   | ---------------------> | Managed DB      |
| Express/IO   |                        | SQLite/Postgres |
+------+-------+                        +-----------------+
       |
       +-------------------------------> AI Provider
       |
       +-------------------------------> Redis Adapter
       |
       +-------------------------------> TURN Provider
```

### Monitoring and Logging

- Health endpoint: `/health` with app version, DB connectivity, and uptime.
- Readiness endpoint: `/ready` checks database, Redis, and provider configuration.
- Backend logs: structured JSON with requestId, sessionId, participantId, event, latency.
- Frontend logs: capture render errors, API failures, WebRTC connection state failures.
- Metrics: active sessions, socket connections, reconnects, failed joins, AI latency, AI cost, call setup time, ICE failure rate.
- Alerts: API error rate, socket connection drops, DB migration failures, AI provider failures, TURN relay saturation.

## 11. Scalability Roadmap

### Phase 1: Hackathon MVP

Architecture:
- React frontend on Vercel.
- Single Express/Socket.IO backend on Render.
- SQLite with Prisma.
- In-memory presence registry.
- Peer-to-peer WebRTC with public STUN.
- Basic AI summary/recommendation endpoint if time allows.

Strengths:
- Simple, demoable, low operational overhead.
- Clear separation between durable REST state and realtime room state.

Known limits:
- Single backend instance.
- Presence lost on restart.
- SQLite concurrency limits.
- WebRTC limited to one-on-one support.

### Phase 2: Production Beta

Architecture evolution:
- Move SQLite to managed Postgres.
- Add Redis for Socket.IO adapter, rate limiting, and ephemeral presence.
- Add production TURN.
- Add authenticated agents and scoped customer invite tokens.
- Add message/transcript persistence and AIInteraction table.
- Add health/readiness endpoints, Sentry, structured logs, and smoke tests.

Product evolution:
- Session room page with video controls.
- AI assistant panel.
- Searchable session history.
- Basic analytics dashboard.

### Phase 3: Enterprise Scale

Architecture evolution:
- Horizontal backend scaling with Redis pub/sub.
- Mediasoup SFU for supervisors, call recording, server-side transcription, and multi-party sessions.
- Regional media routing and TURN/SFU edge selection.
- Event bus for analytics and AI jobs.
- Dedicated worker service for transcription, summarization, and embeddings.
- Multi-tenant data model with organization, team, user, role, and policy tables.
- Compliance features: retention policies, exports, audit trails, encryption controls.

Product evolution:
- Supervisor monitoring.
- CRM/helpdesk integrations.
- Knowledge base sync.
- SLA analytics.
- Enterprise SSO and admin console.

## 12. Judge Presentation Version

### Concise Slide Summary

```text
AtomQuest Finale: Real-Time AI Customer Support

Key technologies:
  React + TypeScript + Vite + TailwindCSS
  Express + TypeScript + Prisma
  Socket.IO for presence and signaling
  WebRTC for low-latency video
  SQLite MVP -> Postgres production
  AI layer for recommendations and summaries

System flow:
  Agent creates session
  Backend generates invite token
  Customer joins with token
  Socket.IO publishes live presence
  WebRTC connects agent and customer
  AI analyzes transcript and assists agent
  Session ends and history is stored

Innovation points:
  Realtime participant presence with reconnect grace
  WebRTC-ready signaling architecture
  AI assistant designed around live support workflows
  Clear migration path from hackathon MVP to enterprise scale

Technical strengths:
  Clean REST + realtime separation
  Durable session history with Prisma
  Role-aware participant model
  Security controls around invite tokens and socket joins
  Scalable roadmap: Postgres, Redis, TURN, Mediasoup, workers
```

### One-Screen Architecture Diagram

```text
Agent UI / Customer UI
        |
        | REST: sessions, history, AI
        | Socket.IO: presence, signaling
        v
Express Backend
  |-- Session Service
  |-- Presence Registry
  |-- WebRTC Signaling
  |-- AI Assistant
        |
        +--> Prisma DB: sessions, participants, messages, AI, audit
        +--> AI Provider + Knowledge Retrieval
        +--> Redis/TURN/Postgres in production

Browser media:
  Agent <========== WebRTC audio/video ==========> Customer
```

## Final Design Rationale

AtomQuest Finale should keep a strict separation between durable product state and ephemeral realtime state. REST APIs and Prisma own lifecycle records that must survive refreshes and restarts. Socket.IO owns fast-changing room presence and WebRTC signaling. WebRTC owns media transport. AI is a backend-controlled assistant layer that consumes transcripts and session context, then returns structured, auditable outputs.

This design is intentionally simple enough for the hackathon MVP, while preserving clean upgrade paths to Postgres, Redis, TURN, Mediasoup, worker queues, retrieval-augmented AI, and enterprise authentication.
