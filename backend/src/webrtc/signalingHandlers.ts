import { randomUUID } from "node:crypto";

import { SessionStatus } from "@prisma/client";

import { prisma } from "../config/prisma.js";
import { getSessionRoomName } from "../sockets/sessionHandlers.js";
import { participantPresenceRegistry } from "../sockets/presenceRegistry.js";
import type {
  ActiveSessionParticipant,
  SessionSocket,
  SocketAck,
  SocketErrorCode,
  SocketErrorPayload,
  SocketServer,
} from "../sockets/types.js";
import type {
  WebRtcAnswerPayload,
  WebRtcIceCandidate,
  WebRtcIceCandidatePayload,
  WebRtcOfferPayload,
  WebRtcSessionDescription,
  WebRtcSignalAckPayload,
  WebRtcSignalBasePayload,
  WebRtcSignalEvent,
} from "./contracts.js";

const MAX_ID_LENGTH = 128;
const MAX_MESSAGE_ID_LENGTH = 128;
const MAX_SDP_LENGTH = 1_000_000;
const MAX_ICE_CANDIDATE_LENGTH = 16_384;

class WebRtcSignalingError extends Error {
  public readonly code: SocketErrorCode;
  public readonly details?: Record<string, unknown>;

  public constructor(
    code: SocketErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WebRtcSignalingError";
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
  fieldName: "sessionId" | "participantId" | "targetParticipantId",
): string {
  const value = body[fieldName];

  if (typeof value !== "string") {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      `${fieldName} must be a string.`,
      { field: fieldName },
    );
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      `${fieldName} must be between 1 and ${MAX_ID_LENGTH} characters.`,
      { field: fieldName },
    );
  }

  return trimmed;
}

function validateOptionalString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      `${fieldName} must be a string.`,
      { field: fieldName },
    );
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      `${fieldName} must be between 1 and ${maxLength} characters.`,
      { field: fieldName },
    );
  }

  return trimmed;
}

function validateSentAt(value: unknown): string | undefined {
  const sentAt = validateOptionalString(value, "sentAt", 64);

  if (sentAt === undefined) {
    return undefined;
  }

  if (Number.isNaN(Date.parse(sentAt))) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "sentAt must be a valid ISO-8601 date string.",
      { field: "sentAt" },
    );
  }

  return sentAt;
}

function validateBasePayload(payload: unknown): WebRtcSignalBasePayload {
  if (!isRecord(payload)) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "WebRTC signaling payload must be a JSON object.",
    );
  }

  const basePayload: WebRtcSignalBasePayload = {
    sessionId: validateIdField(payload, "sessionId"),
    participantId: validateIdField(payload, "participantId"),
    targetParticipantId: validateIdField(payload, "targetParticipantId"),
    messageId: validateOptionalString(
      payload.messageId,
      "messageId",
      MAX_MESSAGE_ID_LENGTH,
    ),
    sentAt: validateSentAt(payload.sentAt),
  };

  if (basePayload.participantId === basePayload.targetParticipantId) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "targetParticipantId must be different from participantId.",
      { field: "targetParticipantId" },
    );
  }

  return basePayload;
}

function validateSessionDescription(
  value: unknown,
  expectedType: WebRtcSessionDescription["type"],
): WebRtcSessionDescription {
  if (!isRecord(value)) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "description must be a JSON object.",
      { field: "description" },
    );
  }

  if (value.type !== expectedType) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      `description.type must be ${expectedType}.`,
      { field: "description.type" },
    );
  }

  if (typeof value.sdp !== "string") {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "description.sdp must be a string.",
      { field: "description.sdp" },
    );
  }

  if (
    value.sdp.trim().length === 0 ||
    value.sdp.length > MAX_SDP_LENGTH
  ) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      `description.sdp must be between 1 and ${MAX_SDP_LENGTH} characters.`,
      { field: "description.sdp" },
    );
  }

  return {
    type: expectedType,
    sdp: value.sdp,
  };
}

function validateNullableString(
  value: unknown,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      `${fieldName} must be a string or null.`,
      { field: fieldName },
    );
  }

  return value.trim();
}

function validateSdpMLineIndex(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "candidate.sdpMLineIndex must be a non-negative integer or null.",
      { field: "candidate.sdpMLineIndex" },
    );
  }

  return value;
}

function validateIceCandidate(value: unknown): WebRtcIceCandidate | null {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "candidate must be a JSON object or null.",
      { field: "candidate" },
    );
  }

  if (typeof value.candidate !== "string") {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "candidate.candidate must be a string.",
      { field: "candidate.candidate" },
    );
  }

  if (value.candidate.length > MAX_ICE_CANDIDATE_LENGTH) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      `candidate.candidate must be ${MAX_ICE_CANDIDATE_LENGTH} characters or fewer.`,
      { field: "candidate.candidate" },
    );
  }

  return {
    candidate: value.candidate,
    sdpMid: validateNullableString(value.sdpMid, "candidate.sdpMid"),
    sdpMLineIndex: validateSdpMLineIndex(value.sdpMLineIndex),
    usernameFragment: validateNullableString(
      value.usernameFragment,
      "candidate.usernameFragment",
    ),
  };
}

function validateOfferPayload(payload: unknown): WebRtcOfferPayload {
  const basePayload = validateBasePayload(payload);

  if (!isRecord(payload)) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "WebRTC offer payload must be a JSON object.",
    );
  }

  return {
    ...basePayload,
    description: {
      ...validateSessionDescription(payload.description, "offer"),
      type: "offer",
    },
  };
}

function validateAnswerPayload(payload: unknown): WebRtcAnswerPayload {
  const basePayload = validateBasePayload(payload);

  if (!isRecord(payload)) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "WebRTC answer payload must be a JSON object.",
    );
  }

  return {
    ...basePayload,
    description: {
      ...validateSessionDescription(payload.description, "answer"),
      type: "answer",
    },
  };
}

function validateIceCandidatePayload(
  payload: unknown,
): WebRtcIceCandidatePayload {
  const basePayload = validateBasePayload(payload);

  if (!isRecord(payload)) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "WebRTC ICE candidate payload must be a JSON object.",
    );
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "candidate")) {
    throw new WebRtcSignalingError(
      "VALIDATION_ERROR",
      "candidate is required.",
      { field: "candidate" },
    );
  }

  return {
    ...basePayload,
    candidate: validateIceCandidate(payload.candidate),
  };
}

function toSocketError(error: unknown): SocketErrorPayload {
  if (error instanceof WebRtcSignalingError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected WebRTC signaling error occurred.",
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

async function assertParticipantsBelongToSession(
  payload: WebRtcSignalBasePayload,
): Promise<void> {
  const participants = await prisma.participant.findMany({
    where: {
      id: {
        in: [payload.participantId, payload.targetParticipantId],
      },
    },
    include: {
      session: true,
    },
  });
  const participantsById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const sender = participantsById.get(payload.participantId);
  const target = participantsById.get(payload.targetParticipantId);

  if (!sender) {
    throw new WebRtcSignalingError(
      "PARTICIPANT_NOT_FOUND",
      "Sender participant was not found.",
      { participantId: payload.participantId },
    );
  }

  if (!target) {
    throw new WebRtcSignalingError(
      "PARTICIPANT_NOT_FOUND",
      "Target participant was not found.",
      { targetParticipantId: payload.targetParticipantId },
    );
  }

  if (sender.sessionId !== payload.sessionId) {
    throw new WebRtcSignalingError(
      "PARTICIPANT_SESSION_MISMATCH",
      "Sender participant does not belong to the requested session.",
      {
        participantId: payload.participantId,
        participantSessionId: sender.sessionId,
        requestedSessionId: payload.sessionId,
      },
    );
  }

  if (target.sessionId !== payload.sessionId) {
    throw new WebRtcSignalingError(
      "PARTICIPANT_SESSION_MISMATCH",
      "Target participant does not belong to the requested session.",
      {
        targetParticipantId: payload.targetParticipantId,
        targetParticipantSessionId: target.sessionId,
        requestedSessionId: payload.sessionId,
      },
    );
  }

  if (sender.session.status === SessionStatus.ENDED) {
    throw new WebRtcSignalingError(
      "SESSION_ENDED",
      "Ended sessions cannot exchange WebRTC signaling messages.",
      { sessionId: payload.sessionId },
    );
  }

  if (sender.leftAt !== null) {
    throw new WebRtcSignalingError(
      "PARTICIPANT_LEFT",
      "Sender participant has already left the session.",
      { participantId: payload.participantId },
    );
  }

  if (target.leftAt !== null) {
    throw new WebRtcSignalingError(
      "PARTICIPANT_LEFT",
      "Target participant has already left the session.",
      { targetParticipantId: payload.targetParticipantId },
    );
  }
}

async function resolveSignalRoute(
  io: SocketServer,
  socket: SessionSocket,
  payload: WebRtcSignalBasePayload,
): Promise<{
  room: string;
  sender: ActiveSessionParticipant;
  target: ActiveSessionParticipant;
  targetSocketId: string;
}> {
  const room = getSessionRoomName(payload.sessionId);
  const sender = socket.data.activeSessions[room];

  if (!sender) {
    throw new WebRtcSignalingError(
      "SESSION_NOT_FOUND",
      "Socket has not joined the requested session room.",
      { sessionId: payload.sessionId, room },
    );
  }

  if (sender.participantId !== payload.participantId) {
    throw new WebRtcSignalingError(
      "PARTICIPANT_SESSION_MISMATCH",
      "Signaling participantId does not match the joined participant.",
      {
        expectedParticipantId: sender.participantId,
        requestedParticipantId: payload.participantId,
      },
    );
  }

  await assertParticipantsBelongToSession(payload);

  const target = participantPresenceRegistry.getPresence(
    payload.sessionId,
    payload.targetParticipantId,
  );

  if (!target || target.status !== "online" || !target.activeSocketId) {
    throw new WebRtcSignalingError(
      "TARGET_NOT_AVAILABLE",
      "Target participant is not currently available for signaling.",
      {
        sessionId: payload.sessionId,
        targetParticipantId: payload.targetParticipantId,
      },
    );
  }

  if (!io.sockets.sockets.has(target.activeSocketId)) {
    throw new WebRtcSignalingError(
      "TARGET_NOT_AVAILABLE",
      "Target participant socket is no longer connected.",
      {
        sessionId: payload.sessionId,
        targetParticipantId: payload.targetParticipantId,
      },
    );
  }

  return {
    room,
    sender,
    target,
    targetSocketId: target.activeSocketId,
  };
}

type WebRtcRoutablePayload =
  | WebRtcOfferPayload
  | WebRtcAnswerPayload
  | WebRtcIceCandidatePayload;

function emitSignalToTarget(
  io: SocketServer,
  targetSocketId: string,
  event: WebRtcSignalEvent,
  payload: WebRtcRoutablePayload,
): void {
  if (event === "webrtc:offer") {
    io.to(targetSocketId).emit("webrtc:offer", payload as WebRtcOfferPayload);
    return;
  }

  if (event === "webrtc:answer") {
    io.to(targetSocketId).emit("webrtc:answer", payload as WebRtcAnswerPayload);
    return;
  }

  io.to(targetSocketId).emit(
    "webrtc:ice-candidate",
    payload as WebRtcIceCandidatePayload,
  );
}

async function routeSignal<TPayload extends WebRtcRoutablePayload>(
  io: SocketServer,
  socket: SessionSocket,
  event: WebRtcSignalEvent,
  payload: TPayload,
  ack?: SocketAck<WebRtcSignalAckPayload>,
): Promise<void> {
  const route = await resolveSignalRoute(io, socket, payload);
  const messageId = payload.messageId ?? randomUUID();
  const routedAt = new Date().toISOString();
  const routedPayload: TPayload = {
    ...payload,
    messageId,
    sentAt: payload.sentAt ?? routedAt,
  };

  emitSignalToTarget(io, route.targetSocketId, event, routedPayload);

  const ackPayload: WebRtcSignalAckPayload = {
    event,
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    targetParticipantId: payload.targetParticipantId,
    messageId,
    routedAt,
  };

  ack?.({
    ok: true,
    data: ackPayload,
  });

  logInfo("socket.webrtc_signal_routed", {
    signalEvent: event,
    socketId: socket.id,
    room: route.room,
    sessionId: payload.sessionId,
    participantId: payload.participantId,
    targetParticipantId: payload.targetParticipantId,
    targetSocketId: route.targetSocketId,
    senderConnectionVersion: route.sender.connectionVersion,
    targetConnectionVersion: route.target.connectionVersion,
    messageId,
  });
}

function handleSignal<TPayload extends WebRtcRoutablePayload>(
  io: SocketServer,
  socket: SessionSocket,
  event: WebRtcSignalEvent,
  payload: unknown,
  validatePayload: (payload: unknown) => TPayload,
  ack?: SocketAck<WebRtcSignalAckPayload>,
): void {
  let validatedPayload: TPayload;

  try {
    validatedPayload = validatePayload(payload);
  } catch (error) {
    const socketError = toSocketError(error);

    sendAckError(ack, error);
    logWarn("socket.webrtc_signal_rejected", {
      signalEvent: event,
      socketId: socket.id,
      code: socketError.code,
      message: socketError.message,
      details: socketError.details,
    });
    return;
  }

  void routeSignal(io, socket, event, validatedPayload, ack).catch((error) => {
    const socketError = toSocketError(error);

    sendAckError(ack, error);

    if (socketError.code === "INTERNAL_ERROR") {
      logError("socket.webrtc_signal_failed", {
        signalEvent: event,
        socketId: socket.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }

    logWarn("socket.webrtc_signal_rejected", {
      signalEvent: event,
      socketId: socket.id,
      code: socketError.code,
      message: socketError.message,
      details: socketError.details,
    });
  });
}

export function registerWebRtcSignalingHandlers(
  io: SocketServer,
  socket: SessionSocket,
): void {
  socket.on("webrtc:offer", (payload, ack) => {
    handleSignal(io, socket, "webrtc:offer", payload, validateOfferPayload, ack);
  });

  socket.on("webrtc:answer", (payload, ack) => {
    handleSignal(
      io,
      socket,
      "webrtc:answer",
      payload,
      validateAnswerPayload,
      ack,
    );
  });

  socket.on("webrtc:ice-candidate", (payload, ack) => {
    handleSignal(
      io,
      socket,
      "webrtc:ice-candidate",
      payload,
      validateIceCandidatePayload,
      ack,
    );
  });
}
