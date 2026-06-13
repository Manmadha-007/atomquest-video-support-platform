import type {
  MessageDto,
  RecordingDto,
  SessionDetailsDto,
} from "../types/sessionTypes.js";
import { participantPresenceRegistry } from "./presenceRegistry.js";
import { getSessionRoomName } from "./sessionHandlers.js";
import type {
  RecordingUpdatePayload,
  SessionChatNewPayload,
  SessionEndedPayload,
  SessionSocket,
  SocketServer,
} from "./types.js";

let socketServer: SocketServer | null = null;

function logInfo(event: string, details: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      level: "info",
      event,
      ...details,
    }),
  );
}

export function registerSessionBroadcaster(io: SocketServer): void {
  socketServer = io;
}

export function broadcastSessionEnded(session: SessionDetailsDto): void {
  if (!socketServer) {
    logInfo("socket.session_ended_broadcast_skipped", {
      sessionId: session.id,
      reason: "socket_server_not_initialized",
    });
    return;
  }

  const room = getSessionRoomName(session.id);
  const presenceSnapshot = participantPresenceRegistry.endSession(session.id);
  const payload: SessionEndedPayload = {
    sessionId: session.id,
    room,
    session,
    endedAt: session.endedAt ?? new Date().toISOString(),
    endedBy: session.endedBy ?? "AGENT",
    activeParticipants: presenceSnapshot.activeParticipants,
    activeCount: presenceSnapshot.activeCount,
  };
  const socketIds = Array.from(
    socketServer.sockets.adapter.rooms.get(room) ?? [],
  );

  socketServer.to(room).emit("session:ended", payload);

  for (const socketId of socketIds) {
    const socket = socketServer.sockets.sockets.get(socketId) as
      | SessionSocket
      | undefined;

    if (!socket) {
      continue;
    }

    delete socket.data.activeSessions[room];
    void socket.leave(room);
  }

  logInfo("socket.session_ended_broadcasted", {
    sessionId: session.id,
    room,
    endedAt: payload.endedAt,
    endedBy: payload.endedBy,
    socketsNotified: socketIds.length,
    activeCount: payload.activeCount,
  });
}

export function broadcastSessionChatMessage(message: MessageDto): void {
  if (!socketServer) {
    logInfo("socket.session_chat_broadcast_skipped", {
      messageId: message.id,
      sessionId: message.sessionId,
      reason: "socket_server_not_initialized",
    });
    return;
  }

  const room = getSessionRoomName(message.sessionId);
  const payload: SessionChatNewPayload = {
    sessionId: message.sessionId,
    room,
    message,
  };

  socketServer.to(room).emit("session:chat:new", payload);

  logInfo("socket.session_chat_broadcasted", {
    messageId: message.id,
    sessionId: message.sessionId,
    room,
    kind: message.kind,
  });
}

export function broadcastRecordingUpdated(recording: RecordingDto): void {
  if (!socketServer) {
    logInfo("socket.recording_update_skipped", {
      recordingId: recording.id,
      sessionId: recording.sessionId,
      reason: "socket_server_not_initialized",
    });
    return;
  }

  const room = getSessionRoomName(recording.sessionId);
  const payload: RecordingUpdatePayload = {
    sessionId: recording.sessionId,
    room,
    recording,
  };

  socketServer.to(room).emit("recording:update", payload);

  logInfo("socket.recording_update_broadcasted", {
    recordingId: recording.id,
    sessionId: recording.sessionId,
    status: recording.status,
    room,
  });
}
