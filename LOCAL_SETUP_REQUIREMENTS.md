# System Requirements

AtomQuest is a two-app Node.js project:

- `backend`: Express 5, Socket.IO 4, Prisma 7, SQLite through `@prisma/adapter-better-sqlite3`
- `frontend`: Vite, React 19, TypeScript, Socket.IO client, browser WebRTC APIs

Required local tools:

- Node.js: `20.19.0` or newer. Node `22.13.0+` or `24.x` is also compatible with the current frontend tooling. This requirement comes from Vite/Rolldown/ESLint/Tailwind package engines.
- npm: npm `10+` is recommended. Use the npm version bundled with the installed Node.js release.
- PostgreSQL: not currently used by the checked-in Prisma schema. The current datasource provider is `sqlite`; judges do not need PostgreSQL unless the repository is changed to `provider = "postgresql"`.
- SQLite: required indirectly through `better-sqlite3`; no separate database server is required.
- Browser: current Chrome, Edge, or Firefox with support for `getUserMedia`, `RTCPeerConnection`, `MediaRecorder`, WebSocket, and `canvas.captureStream`.
- Browser permissions: camera and microphone access must be allowed for the frontend origin.
- OS compatibility: Windows, macOS, and Linux should work. Native install of `better-sqlite3` may require a working compiler toolchain if a prebuilt binary is unavailable for the judge's Node/OS combination.

# Repository Setup

Clone the repository:

```powershell
git clone https://github.com/<OWNER>/<REPOSITORY>.git
cd <REPOSITORY>
```

There is no root `package.json`, so there are no root dependencies to install.

Install backend dependencies:

```powershell
cd backend
npm install
```

Install frontend dependencies:

```powershell
cd ..\frontend
npm install
```

Equivalent macOS/Linux commands:

```bash
cd backend && npm install
cd ../frontend && npm install
```

# Environment Variables

The backend requires a `.env` file because `backend/src/config/prisma.ts` throws if `DATABASE_URL` is missing.

Backend variables:

| Name | Example value | Purpose | Required |
| --- | --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | SQLite database file used by Prisma and `better-sqlite3`. Relative paths resolve from `backend`. | Required |
| `SOCKET_IO_CORS_ORIGIN` | `http://localhost:5173` | Socket.IO CORS allowlist. Comma-separate multiple origins. Defaults to `*` if omitted. | Optional |
| `RECORDING_STORAGE_DIR` | `./storage/recordings` | Directory where finalized recording `.webm` files and temporary chunks are written. Defaults to `backend/storage/recordings`. | Optional |

Frontend variables:

| Name | Example value | Purpose | Required |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:5000/api` | Base URL for REST API calls. Defaults to `http://localhost:5000/api`. | Optional |
| `VITE_SOCKET_URL` | `http://localhost:5000` | Socket.IO server URL. Defaults to `http://localhost:5000`. | Optional |
| `VITE_CACHE_DIR` | `.vite` | Optional Vite cache directory override used by `vite.config.ts`. | Optional |

Create `backend/.env`:

```dotenv
# .env.backend sample
DATABASE_URL="file:./dev.db"
SOCKET_IO_CORS_ORIGIN="http://localhost:5173"
RECORDING_STORAGE_DIR="./storage/recordings"
```

Create `frontend/.env`:

```dotenv
# .env.frontend sample
VITE_API_BASE_URL="http://localhost:5000/api"
VITE_SOCKET_URL="http://localhost:5000"
# VITE_CACHE_DIR=".vite"
```

# Database Setup

Current implementation uses SQLite, not PostgreSQL.

PostgreSQL installation requirements:

- None for the current codebase.
- A PostgreSQL setup would require changing `backend/prisma/schema.prisma` datasource provider from `sqlite` to `postgresql`, replacing the `PrismaBetterSqlite3` adapter usage in `backend/src/config/prisma.ts`, and regenerating/revalidating migrations.

SQLite database creation and Prisma setup:

```powershell
cd backend
Set-Content .env 'DATABASE_URL="file:./dev.db"'
npx prisma migrate deploy
npx prisma generate
```

macOS/Linux:

```bash
cd backend
printf 'DATABASE_URL="file:./dev.db"\n' > .env
npx prisma migrate deploy
npx prisma generate
```

Development alternative:

```powershell
cd backend
npx prisma migrate dev
```

Seed data:

- No seed script is defined in `backend/package.json`.
- No seed file was found.
- Initial sessions are created through the app/API.

Current migrations:

- `20260613041017_init`
- `20260613050000_session_management`
- `20260613113000_session_chat_messages`
- `20260613143000_call_recordings`
- `20260613170000_chat_file_attachments`

# Storage Requirements

| Location | Purpose | Auto-created or manual | Permissions needed |
| --- | --- | --- | --- |
| `backend/dev.db` | Local SQLite database when `DATABASE_URL="file:./dev.db"`. | Created by Prisma migration commands. | Backend process needs read/write access. |
| `backend/storage/recordings` | Finalized call recording `.webm` files. | Auto-created by recording storage code when chunks are finalized. | Backend process needs create/read/write/delete access. |
| `backend/storage/recordings/.chunks/<recordingId>` | Temporary recording chunk files before finalization. | Auto-created by recording upload endpoint. | Backend process needs create/read/write/delete access. |
| `backend/uploads/files` | Intended local storage path for file sharing per docs. | Not currently implemented in backend routes/services. Manual folder creation will not make file sharing work. | Would require backend read/write/delete access if implemented. |

# Running The Application

Start the backend:

```powershell
cd backend
npm run dev
```

Expected backend URL:

- `http://localhost:5000/`
- Health response: `{"message":"AtomQuest Backend Running"}`

Start the frontend in another terminal:

```powershell
cd frontend
npm run dev
```

Expected frontend URL:

- Vite default: `http://localhost:5173/`
- Main routes: `/agent`, `/operations`, `/join/:token`, `/call`

Production-style local build:

```powershell
cd backend
npm run build
npm start

cd ..\frontend
npm run build
npm run preview
```

# Verification Checklist

Backend running:

1. Open `http://localhost:5000/`.
2. Confirm the JSON response says `AtomQuest Backend Running`.

Frontend running:

1. Open `http://localhost:5173/`.
2. Confirm it redirects to `/agent`.

Database connected:

1. Run `cd backend`.
2. Run `npx prisma migrate deploy`.
3. Start the backend.
4. Create a session from `/agent`.
5. Confirm no `DATABASE_URL` or Prisma errors appear in the backend terminal.

WebSocket working:

1. Start backend and frontend.
2. Open `/agent`.
3. Create or resume a session.
4. Confirm the UI can enter a call and the backend logs Socket.IO connection events.

Session creation working:

1. Open `http://localhost:5173/agent`.
2. Create a session.
3. Confirm an invite/join link is generated.
4. Confirm the session appears in `http://localhost:5173/operations`.

Video calling working:

1. Open the agent call in one browser tab.
2. Open the customer join link in a second tab or browser.
3. Allow camera and microphone permissions in both.
4. Join both sides and confirm local/remote video and audio connect.

Chat working:

1. Join the same session as agent and customer.
2. Send a message from one side.
3. Confirm it appears on the other side.
4. Refresh and confirm message history is loaded.

Recording working:

1. Join a call as agent.
2. Start recording.
3. Let at least one 5-second chunk upload.
4. Stop recording.
5. Confirm recording status becomes `READY`.
6. Download the `.webm` recording.

File sharing working:

1. Current repository is not ready for this verification.
2. The schema and design doc mention file attachments, but no `/api/files` routes/controllers/services were found.
3. Judges should treat file sharing as not runnable until the missing implementation is added.

# Common Issues

Missing `DATABASE_URL`:

- Symptom: backend crashes with `DATABASE_URL environment variable is required.`
- Resolution: create `backend/.env` with `DATABASE_URL="file:./dev.db"`.

PostgreSQL expected but SQLite configured:

- Symptom: judge creates PostgreSQL database but Prisma still uses SQLite.
- Resolution: use SQLite for the current repo, or change Prisma/provider/adapter code before using PostgreSQL.

Prisma client not generated:

- Symptom: TypeScript/runtime errors from `@prisma/client`.
- Resolution: run `cd backend` then `npx prisma generate`.

Migrations not applied:

- Symptom: missing tables/columns such as `Recording`, `Message.kind`, or `FileAttachment`.
- Resolution: run `cd backend` then `npx prisma migrate deploy`.

Missing recording storage folder:

- Symptom: recording finalization/upload filesystem errors.
- Resolution: ensure the backend process can write to `backend/storage/recordings`, or set `RECORDING_STORAGE_DIR` to a writable folder.

Port conflict:

- Symptom: backend cannot bind port `5000` or frontend cannot bind `5173`.
- Resolution: free the port. Backend port is hard-coded as `5000` in `backend/src/index.ts`; changing it requires a code edit plus matching frontend env values.

Socket.IO CORS blocked:

- Symptom: frontend cannot connect to Socket.IO.
- Resolution: set `SOCKET_IO_CORS_ORIGIN="http://localhost:5173"` in `backend/.env`.

Camera/microphone denied:

- Symptom: pre-join or call page cannot start media.
- Resolution: allow camera and microphone permissions in the browser for `http://localhost:5173`.

Recording unsupported in browser:

- Symptom: recording button fails or no chunks upload.
- Resolution: use a modern Chromium-based browser with `MediaRecorder` support for `video/webm`.

Native dependency install failure:

- Symptom: `better-sqlite3` fails during `npm install`.
- Resolution: use a supported Node version and install OS build tools if no prebuilt binary is available.

File sharing missing:

- Symptom: no upload control/API works for shared files.
- Resolution: implement `/api/files` backend routes/controllers/storage and frontend upload UI. The current repo contains schema/design pieces but not the runnable feature.

# Judge Quick Start

```powershell
git clone https://github.com/<OWNER>/<REPOSITORY>.git
cd <REPOSITORY>\backend
npm install
Set-Content .env 'DATABASE_URL="file:./dev.db"`nSOCKET_IO_CORS_ORIGIN="http://localhost:5173"`nRECORDING_STORAGE_DIR="./storage/recordings"'
npx prisma migrate deploy
npx prisma generate
npm run dev
```

In a second terminal:

```powershell
cd <REPOSITORY>\frontend
npm install
Set-Content .env 'VITE_API_BASE_URL="http://localhost:5000/api"`nVITE_SOCKET_URL="http://localhost:5000"'
npm run dev
```

Open:

- Agent app: `http://localhost:5173/agent`
- Operations dashboard: `http://localhost:5173/operations`
- Backend health check: `http://localhost:5000/`

# Repository Readiness Report

| Dependency / Area | Status | Notes |
| --- | --- | --- |
| Frontend dependency install | ✅ Ready | `frontend/package.json` and lockfile exist. |
| Backend dependency install | ✅ Ready | `backend/package.json` and lockfile exist. |
| Root dependency install | ✅ Ready | No root package exists; no root install required. |
| Node.js version documentation | ⚠ Needs Attention | No repo-level engines field or setup doc currently states the required Node version. |
| npm version documentation | ⚠ Needs Attention | No repo-level engines field or setup doc currently states npm requirements. |
| Backend environment documentation | ⚠ Needs Attention | Required `DATABASE_URL` is not documented in README. |
| Frontend environment documentation | ⚠ Needs Attention | `VITE_API_BASE_URL` and `VITE_SOCKET_URL` are used but not documented in README. |
| Database engine | ⚠ Needs Attention | User-facing requirement mentions PostgreSQL, but code is SQLite-only. |
| PostgreSQL local setup | ❌ Blocker | Not supported by current Prisma schema and Prisma client adapter. |
| SQLite local setup | ✅ Ready | Migrations and Prisma config exist. |
| Prisma migrations | ✅ Ready | Migration folders exist, including recording and file attachment schema. |
| Prisma seed data | ✅ Ready | No seed data required; sessions are created through the app. |
| Backend port configuration | ⚠ Needs Attention | Port `5000` is hard-coded and cannot be changed through env. |
| Socket.IO signaling | ✅ Ready | Backend Socket.IO server and frontend client are implemented. |
| WebRTC media calling | ✅ Ready | Browser peer connection/media transport code is present. Requires browser permissions. |
| Chat | ✅ Ready | Socket event, persistence, REST history, and UI integration are present. |
| Recording system | ✅ Ready | REST chunk upload, local storage, status updates, and download are implemented. |
| Recording storage folder | ✅ Ready | Auto-created, but process must have write permissions. |
| File attachment database schema | ✅ Ready | Prisma model and migration exist. |
| File upload/download backend | ❌ Blocker | `/api/files` routes/controllers/services are missing. |
| File sharing frontend | ❌ Blocker | No implemented upload UI/API client found. |
| Static assets | ✅ Ready | `frontend/public` and `frontend/src/assets` contain required assets. |
| Test scripts | ⚠ Needs Attention | Backend test script exists; frontend has lint/build but no test script. |
| Existing setup docs | ❌ Blocker | Root `README.md` is empty and frontend README is the Vite template. |

# Audit Findings

1. Missing setup instructions currently not documented:
   - Node/npm version expectations.
   - Separate backend/frontend install commands.
   - Required backend `.env`.
   - Prisma migration/generate commands.
   - SQLite rather than PostgreSQL.
   - Recording storage behavior.
   - Run URLs and verification flow.

2. Missing environment variables:
   - `DATABASE_URL` is required but not documented.
   - `SOCKET_IO_CORS_ORIGIN` is optional but not documented.
   - `RECORDING_STORAGE_DIR` is optional but not documented.
   - `VITE_API_BASE_URL`, `VITE_SOCKET_URL`, and `VITE_CACHE_DIR` are used but not documented.

3. Missing storage folders:
   - `backend/storage/recordings` is not committed, but it is auto-created.
   - `backend/uploads/files` is described in docs but no implementation currently uses or creates it.

4. Missing migrations:
   - No missing migration was found for the current Prisma schema. The `FileAttachment` migration exists on disk as `20260613170000_chat_file_attachments`.

5. Setup blockers that could cause a judge to fail:
   - Expecting PostgreSQL will fail because the repo is configured for SQLite.
   - Missing `backend/.env` will crash the backend.
   - Not running Prisma migrations will leave the database unusable.
   - File sharing cannot be verified because implementation is incomplete.
   - Backend port `5000` is hard-coded, so port conflicts require code changes.
