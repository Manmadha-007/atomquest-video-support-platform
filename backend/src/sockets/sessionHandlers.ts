import { SessionStatus } from "@prisma/client";

import { prisma } from "../config/prisma.js";
import {
  participantPresenceRegistry,
  type JoinPresenceResult,
} from "./presenceRegistry.js";
import type {
  ActiveSessionParticipant,
  ParticipantLeaveReason,
  ParticipantUpdateAction,
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

function buildParticipantUpdate({
  action,
  activeCount,
  activeParticipants,
  occurredAt,
  participant,
  reason,
  room,
}: {
  action: ParticipantUpdateAction;
  room: string,
  participant: ActiveSessionParticipant;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
  occurredAt: string;
  reason?: ParticipantLeaveReason;
}): ParticipantUpdatePayload {
  return {
    sessionId: participant.sessionId,
    room,
    action,
    participant,
    activeParticipants,
    activeCount,
    occurredAt,
    reason,
  };
}

function buildSessionLeftPayload({
  activeCount,
  activeParticipants,
  participant,
  reason,
  room,
}: {
  room: string;
  participant: ActiveSessionParticipant;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
  reason: ParticipantLeaveReason;
}): SessionLeftPayload {
  return {
    sessionId: participant.sessionId,
    room,
    participant,
    activeParticipants,
    activeCount,
    leftAt: new Date().toISOString(),
    reason,
  };
}

function emitParticipantUpdate(
  io: SocketServer,
  result: {
    action: ParticipantUpdateAction;
    sessionId: string;
    participant: ActiveSessionParticipant;
    activeParticipants: ActiveSessionParticipant[];
    activeCount: number;
    reason?: ParticipantLeaveReason;
  },
): void {
  const room = getSessionRoomName(result.sessionId);

  io.to(room).emit(
    "participant:update",
    buildParticipantUpdate({
      action: result.action,
      room,
      participant: result.participant,
      activeParticipants: result.activeParticipants,
      activeCount: result.activeCount,
      occurredAt: new Date().toISOString(),
      reason: result.reason,
    }),
  );
}

function replacePreviousSocket(
  io: SocketServer,
  room: string,
  joinResult: JoinPresenceResult,
): void {
  if (!joinResult.replacedSocketId) {
    return;
  }

  const replacedSocket = io.sockets.sockets.get(
    joinResult.replacedSocketId,
  ) as SessionSocket | undefined;

  if (!replacedSocket) {
    return;
  }

  delete replacedSocket.data.activeSessions[room];
  void replacedSocket.leave(room);
  replacedSocket.emit(
    "session:left",
    buildSessionLeftPayload({
      room,
      participant: joinResult.participant,
      activeParticipants: joinResult.activeParticipants,
      activeCount: joinResult.activeCount,
      reason: "socket_replaced",
    }),
  );

  logInfo("socket.session_socket_replaced", {
    oldSocketId: joinResult.replacedSocketId,
    newSocketId: joinResult.participant.activeSocketId,
    room,
    sessionId: joinResult.participant.sessionId,
    participantId: joinResult.participant.participantId,
    connectionVersion: joinResult.participant.connectionVersion,
  });
}

async function handleJoinSession(
  io: SocketServer,
  socket: SessionSocket,
  payload: SessionJoinPayload,
  ack?: SocketAck<SessionJoinedPayload>,
): Promise<void> {
  await assertParticipantCanJoin(payload);

  const room = getSessionRoomName(payload.sessionId);
  const joinResult = participantPresenceRegistry.join({
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    role: payload.role,
    socketId: socket.id,
    transport: getTransportName(socket),
  });

  await socket.join(room);
  socket.data.activeSessions[room] = joinResult.participant;
  replacePreviousSocket(io, room, joinResult);

  const joinedPayload: SessionJoinedPayload = {
    sessionId: payload.sessionId,
    room,
    participant: joinResult.participant,
    activeParticipants: joinResult.activeParticipants,
    activeCount: joinResult.activeCount,
    joinedAt: joinResult.participant.joinedAt,
  };

  socket.emit("session:joined", joinedPayload);
  emitParticipantUpdate(io, joinResult);
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
    action: joinResult.action,
    activeSocketId: joinResult.participant.activeSocketId,
    connectionVersion: joinResult.participant.connectionVersion,
    status: joinResult.participant.status,
    activeCount: joinResult.activeCount,
  });
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

  const leaveResult = participantPresenceRegistry.leave({
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    socketId: socket.id,
  });

  if (!leaveResult) {
    throw new SocketHandlerError(
      "SESSION_NOT_FOUND",
      "Socket has not joined the requested session room.",
      { sessionId: payload.sessionId, room },
    );
  }

  delete socket.data.activeSessions[room];

  const leftPayload = buildSessionLeftPayload({
    room,
    participant: leaveResult.participant,
    activeParticipants: leaveResult.activeParticipants,
    activeCount: leaveResult.activeCount,
    reason: leaveResult.reason,
  });

  socket.emit("session:left", leftPayload);
  socket.to(room).emit("session:left", leftPayload);
  emitParticipantUpdate(io, leaveResult);
  socket.leave(room);

  ack?.({
    ok: true,
    data: leftPayload,
  });

  logInfo("socket.session_left", {
    socketId: socket.id,
    room,
    sessionId: leaveResult.sessionId,
    participantId: leaveResult.participant.participantId,
    role: leaveResult.participant.role,
    reason: leaveResult.reason,
    activeCount: leaveResult.activeCount,
  });
}

function handleReconnectGraceExpired(
  io: SocketServer,
  result: {
    action: "offline";
    reason: "grace_expired";
    sessionId: string;
    participant: ActiveSessionParticipant;
    activeParticipants: ActiveSessionParticipant[];
    activeCount: number;
  },
): void {
  const room = getSessionRoomName(result.sessionId);
  const leftPayload = buildSessionLeftPayload({
    room,
    participant: result.participant,
    activeParticipants: result.activeParticipants,
    activeCount: result.activeCount,
    reason: result.reason,
  });

  io.to(room).emit("session:left", leftPayload);
  emitParticipantUpdate(io, result);

  logInfo("socket.session_offline", {
    room,
    sessionId: result.sessionId,
    participantId: result.participant.participantId,
    role: result.participant.role,
    reason: result.reason,
    activeCount: result.activeCount,
  });
}

function handleDisconnect(
  io: SocketServer,
  socket: SessionSocket,
  reason: string,
): void {
  const activeRooms = Object.keys(socket.data.activeSessions);
  const reconnectingResults = participantPresenceRegistry.markSocketDisconnected(
    socket.id,
    (result) => handleReconnectGraceExpired(io, result),
  );

  for (const result of reconnectingResults) {
    delete socket.data.activeSessions[getSessionRoomName(result.sessionId)];
    emitParticipantUpdate(io, result);
  }

  logInfo("socket.disconnected", {
    socketId: socket.id,
    reason,
    roomsLeft: activeRooms.length,
    reconnectingParticipants: reconnectingResults.length,
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
    handleDisconnect(io, socket, reason);
  });

  socket.on("error", (error) => {
    logError("socket.error", {
      socketId: socket.id,
      message: error instanceof Error ? error.message : "Unknown socket error",
    });
  });
}
