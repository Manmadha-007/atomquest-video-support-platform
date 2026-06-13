import { SessionStatus } from "@prisma/client";

import { prisma } from "../config/prisma.js";
import type {
  ActiveSessionParticipant,
  ParticipantLeaveReason,
  ParticipantUpdatePayload,
  SessionJoinedPayload,
  SessionJoinPayload,
  SessionLeavePayload,
  SessionLeftPayload,
  SessionSocket,
  SocketAck,
  SocketErrorCode,
  SocketErrorPayload,
  SocketParticipantRole,
  SocketServer,
} from "./types.js";

const MAX_ID_LENGTH = 128;

const activeParticipantsByRoom = new Map<
  string,
  Map<string, ActiveSessionParticipant>
>();

class SocketHandlerError extends Error {
  public readonly code: SocketErrorCode;
  public readonly details?: Record<string, unknown>;

  public constructor(
    code: SocketErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SocketHandlerError";
    this.code = code;
    this.details = details;
  }
}

function logInfo(event: string, details: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      level: "info",
      event,
      ...details,
    }),
  );
}

function logWarn(event: string, details: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event,
      ...details,
    }),
  );
}

function logError(event: string, details: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      ...details,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateIdField(
  body: Record<string, unknown>,
  fieldName: "sessionId" | "participantId",
): string {
  const value = body[fieldName];

  if (typeof value !== "string") {
    throw new SocketHandlerError(
      "VALIDATION_ERROR",
      `${fieldName} must be a string.`,
      { field: fieldName },
    );
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    throw new SocketHandlerError(
      "VALIDATION_ERROR",
      `${fieldName} must be between 1 and ${MAX_ID_LENGTH} characters.`,
      { field: fieldName },
    );
  }

  return trimmed;
}

function validateOptionalIdField(
  body: Record<string, unknown>,
  fieldName: "participantId",
): string | undefined {
  if (body[fieldName] === undefined) {
    return undefined;
  }

  return validateIdField(body, fieldName);
}

function validateRole(value: unknown): SocketParticipantRole {
  if (value === "AGENT" || value === "CUSTOMER") {
    return value;
  }

  throw new SocketHandlerError(
    "VALIDATION_ERROR",
    "role must be AGENT or CUSTOMER.",
    { field: "role" },
  );
}

function validateJoinPayload(payload: unknown): SessionJoinPayload {
  if (!isRecord(payload)) {
    throw new SocketHandlerError(
      "VALIDATION_ERROR",
      "session:join payload must be a JSON object.",
    );
  }

  return {
    sessionId: validateIdField(payload, "sessionId"),
    participantId: validateIdField(payload, "participantId"),
    role: validateRole(payload.role),
  };
}

function validateLeavePayload(payload: unknown): SessionLeavePayload {
  if (!isRecord(payload)) {
    throw new SocketHandlerError(
      "VALIDATION_ERROR",
      "session:leave payload must be a JSON object.",
    );
  }

  return {
    sessionId: validateIdField(payload, "sessionId"),
    participantId: validateOptionalIdField(payload, "participantId"),
  };
}

function getTransportName(socket: SessionSocket): string {
  return socket.conn.transport.name;
}

export function getSessionRoomName(sessionId: string): string {
  return `session:${sessionId}`;
}

function getRoomParticipants(room: string): ActiveSessionParticipant[] {
  return Array.from(activeParticipantsByRoom.get(room)?.values() ?? []);
}

function upsertActiveParticipant(
  room: string,
  participant: ActiveSessionParticipant,
): ActiveSessionParticipant[] {
  const roomParticipants =
    activeParticipantsByRoom.get(room) ??
    new Map<string, ActiveSessionParticipant>();

  roomParticipants.set(participant.socketId, participant);
  activeParticipantsByRoom.set(room, roomParticipants);

  return getRoomParticipants(room);
}

function removeActiveParticipant(
  room: string,
  socketId: string,
): ActiveSessionParticipant | null {
  const roomParticipants = activeParticipantsByRoom.get(room);

  if (!roomParticipants) {
    return null;
  }

  const participant = roomParticipants.get(socketId) ?? null;
  roomParticipants.delete(socketId);

  if (roomParticipants.size === 0) {
    activeParticipantsByRoom.delete(room);
  }

  return participant;
}

function toSocketError(error: unknown): SocketErrorPayload {
  if (error instanceof SocketHandlerError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected socket error occurred.",
  };
}

function sendAckError<TPayload>(
  ack: SocketAck<TPayload> | undefined,
  error: unknown,
): void {
  ack?.({
    ok: false,
    error: toSocketError(error),
  });
}

async function assertParticipantCanJoin(
  payload: SessionJoinPayload,
): Promise<void> {
  const participant = await prisma.participant.findUnique({
    where: {
      id: payload.participantId,
    },
    include: {
      session: true,
    },
  });

  if (!participant) {
    throw new SocketHandlerError(
      "PARTICIPANT_NOT_FOUND",
      "Participant was not found.",
      { participantId: payload.participantId },
    );
  }

  if (participant.sessionId !== payload.sessionId) {
    throw new SocketHandlerError(
      "PARTICIPANT_SESSION_MISMATCH",
      "Participant does not belong to the requested session.",
      {
        participantId: payload.participantId,
        participantSessionId: participant.sessionId,
        requestedSessionId: payload.sessionId,
      },
    );
  }

  if (participant.session.status === SessionStatus.ENDED) {
    throw new SocketHandlerError(
      "SESSION_ENDED",
      "Ended sessions cannot be joined.",
      { sessionId: payload.sessionId },
    );
  }

  if (participant.leftAt !== null) {
    throw new SocketHandlerError(
      "PARTICIPANT_LEFT",
      "Participants that have left cannot join signaling.",
      { participantId: payload.participantId },
    );
  }

  if (participant.role !== payload.role) {
    throw new SocketHandlerError(
      "ROLE_MISMATCH",
      "Participant role does not match the requested role.",
      {
        expectedRole: participant.role,
        requestedRole: payload.role,
      },
    );
  }
}

function buildParticipantUpdate(
  action: "joined",
  room: string,
  participant: ActiveSessionParticipant,
  activeParticipants: ActiveSessionParticipant[],
  occurredAt: string,
): ParticipantUpdatePayload;
function buildParticipantUpdate(
  action: "left",
  room: string,
  participant: ActiveSessionParticipant,
  activeParticipants: ActiveSessionParticipant[],
  occurredAt: string,
  reason: ParticipantLeaveReason,
): ParticipantUpdatePayload;
function buildParticipantUpdate(
  action: "joined" | "left",
  room: string,
  participant: ActiveSessionParticipant,
  activeParticipants: ActiveSessionParticipant[],
  occurredAt: string,
  reason?: ParticipantLeaveReason,
): ParticipantUpdatePayload {
  return {
    sessionId: participant.sessionId,
    room,
    action,
    participant,
    activeParticipants,
    activeCount: activeParticipants.length,
    occurredAt,
    reason,
  };
}

async function handleJoinSession(
  io: SocketServer,
  socket: SessionSocket,
  payload: SessionJoinPayload,
  ack?: SocketAck<SessionJoinedPayload>,
): Promise<void> {
  await assertParticipantCanJoin(payload);

  const room = getSessionRoomName(payload.sessionId);
  const joinedAt = new Date().toISOString();
  const participant: ActiveSessionParticipant = {
    socketId: socket.id,
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    role: payload.role,
    joinedAt,
    transport: getTransportName(socket),
  };

  await socket.join(room);
  socket.data.activeSessions[room] = participant;

  const activeParticipants = upsertActiveParticipant(room, participant);
  const joinedPayload: SessionJoinedPayload = {
    sessionId: payload.sessionId,
    room,
    participant,
    activeParticipants,
    activeCount: activeParticipants.length,
    joinedAt,
  };

  socket.emit("session:joined", joinedPayload);
  io.to(room).emit(
    "participant:update",
    buildParticipantUpdate(
      "joined",
      room,
      participant,
      activeParticipants,
      joinedAt,
    ),
  );
  ack?.({
    ok: true,
    data: joinedPayload,
  });

  logInfo("socket.session_joined", {
    socketId: socket.id,
    room,
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    role: payload.role,
    activeCount: activeParticipants.length,
  });
}

function leaveRoom(
  socket: SessionSocket,
  room: string,
  participant: ActiveSessionParticipant,
  reason: ParticipantLeaveReason,
): SessionLeftPayload {
  const leftAt = new Date().toISOString();
  const removedParticipant = removeActiveParticipant(room, socket.id);
  const activeParticipants = getRoomParticipants(room);
  const participantToEmit = removedParticipant ?? participant;
  const leftPayload: SessionLeftPayload = {
    sessionId: participantToEmit.sessionId,
    room,
    participant: participantToEmit,
    activeParticipants,
    activeCount: activeParticipants.length,
    leftAt,
    reason,
  };

  delete socket.data.activeSessions[room];

  if (reason === "client_leave") {
    socket.emit("session:left", leftPayload);
  }

  socket.to(room).emit("session:left", leftPayload);
  socket.to(room).emit(
    "participant:update",
    buildParticipantUpdate(
      "left",
      room,
      participantToEmit,
      activeParticipants,
      leftAt,
      reason,
    ),
  );
  socket.leave(room);

  logInfo("socket.session_left", {
    socketId: socket.id,
    room,
    sessionId: participantToEmit.sessionId,
    participantId: participantToEmit.participantId,
    role: participantToEmit.role,
    reason,
    activeCount: activeParticipants.length,
  });

  return leftPayload;
}

function handleLeaveSession(
  io: SocketServer,
  socket: SessionSocket,
  payload: SessionLeavePayload,
  ack?: SocketAck<SessionLeftPayload>,
): void {
  const room = getSessionRoomName(payload.sessionId);
  const participant = socket.data.activeSessions[room];

  if (!participant) {
    throw new SocketHandlerError(
      "SESSION_NOT_FOUND",
      "Socket has not joined the requested session room.",
      { sessionId: payload.sessionId, room },
    );
  }

  if (
    payload.participantId !== undefined &&
    payload.participantId !== participant.participantId
  ) {
    throw new SocketHandlerError(
      "PARTICIPANT_SESSION_MISMATCH",
      "Leave payload participantId does not match the joined participant.",
      {
        expectedParticipantId: participant.participantId,
        requestedParticipantId: payload.participantId,
      },
    );
  }

  const leftPayload = leaveRoom(socket, room, participant, "client_leave");

  ack?.({
    ok: true,
    data: leftPayload,
  });
}

function handleDisconnect(socket: SessionSocket, reason: string): void {
  const activeSessions = Object.entries(socket.data.activeSessions);

  for (const [room, participant] of activeSessions) {
    leaveRoom(socket, room, participant, "disconnect");
  }

  logInfo("socket.disconnected", {
    socketId: socket.id,
    reason,
    roomsLeft: activeSessions.length,
  });
}

export function registerSessionHandlers(
  io: SocketServer,
  socket: SessionSocket,
): void {
  socket.data.activeSessions = {};

  socket.on("session:join", (payload, ack) => {
    let validatedPayload: SessionJoinPayload;

    try {
      validatedPayload = validateJoinPayload(payload);
    } catch (error) {
      const socketError = toSocketError(error);

      sendAckError(ack, error);
      logWarn("socket.session_join_rejected", {
        socketId: socket.id,
        code: socketError.code,
        message: socketError.message,
        details: socketError.details,
      });
      return;
    }

    void handleJoinSession(io, socket, validatedPayload, ack).catch((error) => {
      const socketError = toSocketError(error);

      sendAckError(ack, error);

      if (socketError.code === "INTERNAL_ERROR") {
        logError("socket.session_join_failed", {
          socketId: socket.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return;
      }

      logWarn("socket.session_join_rejected", {
        socketId: socket.id,
        code: socketError.code,
        message: socketError.message,
        details: socketError.details,
      });
    });
  });

  socket.on("session:leave", (payload, ack) => {
    try {
      const validatedPayload = validateLeavePayload(payload);
      handleLeaveSession(io, socket, validatedPayload, ack);
    } catch (error) {
      const socketError = toSocketError(error);

      sendAckError(ack, error);
      logWarn("socket.session_leave_rejected", {
        socketId: socket.id,
        code: socketError.code,
        message: socketError.message,
        details: socketError.details,
      });
    }
  });

  socket.on("disconnect", (reason) => {
    handleDisconnect(socket, reason);
  });

  socket.on("error", (error) => {
    logError("socket.error", {
      socketId: socket.id,
      message: error instanceof Error ? error.message : "Unknown socket error",
    });
  });
}
