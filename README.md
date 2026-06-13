# AtomQuest Finale

## Overview

AtomQuest Finale is a browser-based support session app for connecting an agent with a customer through an invite link. It solves the common evaluation/demo need for a lightweight live assistance flow: create a session, let a customer join, talk over audio/video, chat in-call, share files, record the call, and review session history from an operations view. The project runs locally as a Vite React frontend plus an Express/Socket.IO backend using Prisma with SQLite.

## Features

- Agent session creation
- Invite-based customer joining
- Browser video calling
- Browser audio calling
- In-call chat with persisted history
- File sharing with local upload storage and downloads
- Agent-controlled call recording with local `.webm` storage
- Operations dashboard
- Session history with messages, files, and recordings

## Technology Stack

| Area | Stack |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS |
| Backend | Node.js, Express 5, TypeScript |
| Database | Prisma 7 with SQLite / `better-sqlite3` |
| Real-time communication | Socket.IO and browser WebRTC |

## Local Setup

### Prerequisites

- Node.js `20.19.0+` recommended
- npm `10+`

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
npx prisma migrate deploy
npx prisma generate
npm run build
npm run dev
```

On Windows PowerShell, use this instead of `cp`:

```powershell
Copy-Item .env.example .env
```

### Frontend Setup

Open a second terminal:

```bash
cd frontend
npm install
cp .env.example .env
npm run build
npm run dev
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### Environment Variables

Backend variables are in `backend/.env.example`:

```dotenv
DATABASE_URL="file:./dev.db"
SOCKET_IO_CORS_ORIGIN="http://localhost:5173"
RECORDING_STORAGE_DIR="./storage/recordings"
FILE_STORAGE_DIR="./uploads/files"
```

Frontend variables are in `frontend/.env.example`:

```dotenv
VITE_API_BASE_URL="http://localhost:5000/api"
VITE_SOCKET_URL="http://localhost:5000"
```

### Access URLs

Frontend: [http://localhost:5173](http://localhost:5173/)

Backend: [http://localhost:5000](http://localhost:5000/)

## Usage

1. Create a session from the agent dashboard.
2. Share the generated invite link.
3. Customer joins from the invite page.
4. Start the call.
5. Use chat/files during the session.
6. Record if needed.
7. End the session and review it in operations.

## Known Limitations

- Local development setup uses SQLite, not PostgreSQL.
- Uploaded files and recordings are stored on the local backend filesystem.
- Backend runs on hard-coded port `5000`.
- File sharing supports `jpg`, `jpeg`, `png`, `webp`, `pdf`, `doc`, `docx`, and `txt` up to 25 MB.
- Recording depends on browser `MediaRecorder` and `video/webm` support.
- No production cloud deployment configuration is included.

## Project Structure

- `frontend/`: Vite React app for agent, customer join, call, chat, files, recording controls, and operations dashboard.
- `backend/`: Express API, Socket.IO signaling/chat, Prisma schema/migrations, file storage, and recording storage.
- `docs/`: Architecture and feature notes for WebRTC, recording, file sharing, and session lifecycle.
