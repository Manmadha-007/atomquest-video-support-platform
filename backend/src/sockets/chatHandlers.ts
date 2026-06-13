import { Prisma } from "@prisma/client";

import { AppError } from "../types/sessionTypes.js";
import { createSessionMessage } from "../services/sessionService.js";
import { getSessionRoomName } from "./sessionHandlers.js";
import type {
  SessionChatNewPayload,
  SessionChatSendPayload,
  SessionSocket,
  SocketAck,
  SocketErrorCode,
  SocketErrorPayload,
  SocketServer,
} from "./types.js";

const MAX_ID_LENGTH = 128;
const MAX_MESSAGE_CONTENT_LENGTH = 4_000;

class ChatHandlerError extends Error {
  public readonly code: SocketErrorCode;
  public readonly details?: Record<string, unknown>;

  public constructor(
    code: SocketErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChatHandlerError";
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

function sanitizeChatPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) {
    return {
      payloadType: typeof payload,
    };
  }

  return {
    sessionId:
      typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    participantId:
      typeof payload.participantId === "string"
        ? payload.participantId
        : undefined,
    content:
      typeof payload.content === "string" ? payload.content : undefined,
    contentLength:
      typeof payload.content === "string" ? payload.content.length : undefined,
  };
}

function extractChatLogContext(payload: unknown): {
  sessionId?: string;
  participantId?: string;
} {
  if (!isRecord(payload)) {
    return {};
  }

  return {
    sessionId:
      typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    participantId:
      typeof payload.participantId === "string"
        ? payload.participantId
        : undefined,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown error";
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      name: error.name,
      message: error.message,
      prismaCode: error.code,
      meta: error.meta,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

function validateIdField(
  body: Record<string, unknown>,
  fieldName: "sessionId" | "participantId",
): string {
  const value = body[fieldName];

  if (typeof value !== "string") {
    throw new ChatHandlerError(
      "VALIDATION_ERROR",
      `${fieldName} must be a string.`,
      { field: fieldName },
    );
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    throw new ChatHandlerError(
      "VALIDATION_ERROR",
      `${fieldName} must be between 1 and ${MAX_ID_LENGTH} characters.`,
      { field: fieldName },
    );
  }

  return trimmed;
}

function validateContent(value: unknown): string {
  if (typeof value !== "string") {
    throw new ChatHandlerError(
      "VALIDATION_ERROR",
      "content must be a string.",
      { field: "content" },
    );
  }

  const content = value.trim();

  if (content.length === 0) {
    throw new ChatHandlerError(
      "VALIDATION_ERROR",
      "content cannot be empty.",
      { field: "content" },
    );
  }

  if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    throw new ChatHandlerError(
      "VALIDATION_ERROR",
      `content must be ${MAX_MESSAGE_CONTENT_LENGTH} characters or fewer.`,
      { field: "content", maxLength: MAX_MESSAGE_CONTENT_LENGTH },
    );
  }

  return content;
}

function validateChatSendPayload(payload: unknown): SessionChatSendPayload {
  if (!isRecord(payload)) {
    throw new ChatHandlerError(
      "VALIDATION_ERROR",
      "session:chat:send payload must be a JSON object.",
    );
  }

  return {
    sessionId: validateIdField(payload, "sessionId"),
    participantId: validateIdField(payload, "participantId"),
    content: validateContent(payload.content),
  };
}

function mapAppErrorCode(error: AppError): SocketErrorCode {
  if (error.code === "SESSION_NOT_FOUND") {
    return "SESSION_NOT_FOUND";
  }

  if (error.code === "SESSION_ALREADY_ENDED") {
    return "SESSION_ENDED";
  }

  if (error.code === "SESSION_NOT_JOINABLE") {
    return "PARTICIPANT_LEFT";
  }

  if (error.code === "AUTH_FORBIDDEN") {
    return "AUTH_FORBIDDEN";
  }

  if (
    error.code === "VALIDATION_INVALID_FIELD" ||
    error.code === "VALIDATION_MISSING_FIELD"
  ) {
    return "VALIDATION_ERROR";
  }

  return "INTERNAL_ERROR";
}

function toSocketError(error: unknown): SocketErrorPayload {
  if (error instanceof ChatHandlerError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof AppError) {
    return {
      code: mapAppErrorCode(error),
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      code: "PERSISTENCE_ERROR",
      message: `Prisma ${error.code}: ${error.message}`,
      details: {
        prismaCode: error.code,
        meta: error.meta,
      },
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: `${error.name}: ${error.message}`,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: `Unknown chat socket error: ${String(error)}`,
  };
}

function sendAckError<TPayload>(
  ack: SocketAck<TPayload> | undefined,
  error: unknown,
  context: Record<string, unknown>,
): SocketErrorPayload {
  const socketError = toSocketError(error);
  const response = {
    ok: false,
    error: socketError,
  } as const;

  ack?.(response);
  logInfo("CHAT_ACK", {
    ...context,
    ackResponse: response,
  });

  return socketError;
}

async function handleSendChatMessage(
  io: SocketServer,
  socket: SessionSocket,
  payload: SessionChatSendPayload,
  ack?: SocketAck<SessionChatNewPayload>,
): Promise<void> {
  const room = getSessionRoomName(payload.sessionId);
  const joinedParticipant = socket.data.activeSessions[room];
  const socketIsInRoom = socket.rooms.has(room);

  logInfo("CHAT_AUTH_CHECK", {
    socketId: socket.id,
    room,
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    socketIsInRoom,
    joinedParticipantId: joinedParticipant?.participantId ?? null,
    joinedParticipantRole: joinedParticipant?.role ?? null,
  });

  if (!joinedParticipant || !socketIsInRoom) {
    throw new ChatHandlerError(
      "SESSION_NOT_FOUND",
      "Socket has not joined the requested session room.",
      {
        sessionId: payload.sessionId,
        room,
        hasJoinedParticipant: Boolean(joinedParticipant),
        socketIsInRoom,
      },
    );
  }

  if (joinedParticipant.participantId !== payload.participantId) {
    throw new ChatHandlerError(
      "PARTICIPANT_SESSION_MISMATCH",
      "Chat participantId does not match the joined participant.",
      {
        expectedParticipantId: joinedParticipant.participantId,
        requestedParticipantId: payload.participantId,
      },
    );
  }

  const message = await createSessionMessage(payload);
  const chatPayload: SessionChatNewPayload = {
    sessionId: payload.sessionId,
    room,
    message,
  };
  const successResponse = {
    ok: true,
    data: chatPayload,
  } as const;

  io.to(room).emit("session:chat:new", chatPayload);
  logInfo("CHAT_BROADCAST", {
    socketId: socket.id,
    room,
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    broadcastPayload: chatPayload,
    messageId: message.id,
  });

  ack?.(successResponse);
  logInfo("CHAT_ACK", {
    socketId: socket.id,
    room,
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    ackResponse: successResponse,
  });
}

export function registerChatHandlers(
  io: SocketServer,
  socket: SessionSocket,
): void {
  socket.on("session:chat:send", (payload, ack) => {
    logInfo("CHAT_SEND", {
      socketId: socket.id,
      ...extractChatLogContext(payload),
      receivedPayload: sanitizeChatPayload(payload),
    });

    let validatedPayload: SessionChatSendPayload;

    try {
      validatedPayload = validateChatSendPayload(payload);
    } catch (error) {
      const socketError = sendAckError(ack, error, {
        socketId: socket.id,
        ...extractChatLogContext(payload),
        validationFailure: true,
        receivedPayload: sanitizeChatPayload(payload),
      });

      logWarn("CHAT_VALIDATION_FAILED", {
        socketId: socket.id,
        code: socketError.code,
        message: socketError.message,
        details: socketError.details,
      });
      return;
    }

    void handleSendChatMessage(io, socket, validatedPayload, ack).catch(
      (error) => {
        const socketError = sendAckError(ack, error, {
          socketId: socket.id,
          sessionId: validatedPayload.sessionId,
          participantId: validatedPayload.participantId,
        });

        if (socketError.code === "INTERNAL_ERROR") {
          logError("CHAT_SEND_FAILED", {
            socketId: socket.id,
            sessionId: validatedPayload.sessionId,
            participantId: validatedPayload.participantId,
            error: serializeError(error),
          });
          return;
        }

        logWarn("CHAT_SEND_REJECTED", {
          socketId: socket.id,
          sessionId: validatedPayload.sessionId,
          participantId: validatedPayload.participantId,
          code: socketError.code,
          message: socketError.message,
          details: socketError.details,
          rawErrorMessage: getErrorMessage(error),
        });
      },
    );
  });
}
