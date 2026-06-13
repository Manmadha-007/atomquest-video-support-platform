# AtomQuest Chat File Sharing

## Existing Architecture

AtomQuest sessions are persisted in Prisma/SQLite with a `Session` owning
`Participant`, `Message`, and `Recording` records. The call room joins a
Socket.IO session room for WebRTC signaling and chat. Text chat is sent through
`session:chat:send`, persisted by the backend, then broadcast to all room
participants as `session:chat:new`.

Recordings introduced a local storage pattern: media is written outside the
database, metadata is stored in Prisma, and download URLs use opaque tokens
instead of exposing filesystem paths. File sharing follows that pattern.

## Architecture

File upload is a REST request so the browser can report upload progress. After
the backend validates and stores the file, it creates a `Message` with
`kind = FILE` and a linked `FileAttachment`. That message is broadcast through
the existing `session:chat:new` socket event, so text and file messages remain
one chronological stream.

Text messages continue to use `session:chat:send`.

## Database Changes

`Message` gains:

- `kind`: `TEXT` or `FILE`

New `FileAttachment` entity:

- `id`
- `sessionId`
- `participantId`
- `messageId`
- `originalName`
- `mimeType`
- `extension`
- `sizeBytes`
- `storageKey`
- `downloadToken`
- `createdAt`

Indexes:

- `FileAttachment(sessionId, createdAt)`
- `FileAttachment(participantId)`
- unique `FileAttachment(messageId)`
- unique `FileAttachment(downloadToken)`

## Storage Strategy

Files are stored locally under:

```text
backend/uploads/files
```

The on-disk key is session scoped:

```text
<sessionId>/<fileAttachmentId>.<extension>
```

Only metadata and download tokens are stored in the database. Original filenames
are preserved for display and `Content-Disposition`, but never used as storage
paths.

## API Contracts

### Upload

`POST /api/files/upload`

Headers:

- `content-type`: the file MIME type
- `x-atomquest-session-id`
- `x-atomquest-participant-id`
- `x-atomquest-file-name`

Body:

- raw file bytes

Response:

```json
{
  "attachment": {},
  "message": {}
}
```

### List

`GET /api/files?sessionId=<id>`

Returns persisted attachment metadata, newest last.

### Download

`GET /api/files/:fileId/download?token=<downloadToken>`

Streams the file with a safe filename and the persisted MIME type.

## Socket Contracts

No new socket event is required. File uploads broadcast the existing:

```text
session:chat:new
```

The `message` payload now includes:

- `kind`
- `attachment` when `kind = FILE`

## UI States

Chat widget states:

- Idle composer with attach button
- Uploading with progress bar and disabled attach/send controls
- Upload error with clear validation copy
- File message bubble
- Image preview for `jpg`, `jpeg`, `png`, and `webp`
- Download action for all supported files
- Read-only history after session end, while downloads remain available

Operations dashboard states:

- Shared file count metric
- Shared file history table
- Download available/unavailable action

## Security Considerations

- Uploads require an active session and a participant that belongs to that
  session.
- Participants that have left cannot upload.
- Ended sessions reject new uploads but retain downloadable history.
- Extension and MIME type must both match the allowlist.
- Maximum upload size is 25 MB.
- Storage paths are generated from internal IDs and checked against the storage
  root.
- Downloads require an opaque token and never expose storage paths.
- This matches the current lightweight participant-ID security model. A future
  authenticated production deployment should bind participant IDs and download
  rights to signed credentials or server sessions.
