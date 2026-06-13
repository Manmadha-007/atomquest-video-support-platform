import {
  ParticipantRole,
  Prisma,
  SessionStatus,
  type FileAttachment,
  type Message,
  type Participant,
  type Recording,
  type Session,
} from "@prisma/client";
import { randomBytes } from "node:crypto";

import { prisma } from "../config/prisma.js";
import {
  AppError,
  type CreateSessionRequest,
  type EndSessionRequest,
  type JoinSessionRequest,
  type MessageDto,
  type ParticipantDto,
  type SessionDetailsDto,
  type SessionInviteDto,
  type SessionListItemDto,
} from "../types/sessionTypes.js";
import {
  mapFileAttachment,
  mapMessageWithAttachment,
} from "./fileAttachmentService.js";
import { mapRecording } from "./recordingService.js";

interface CreateSessionMessageInput {
  sessionId: string;
  participantId: string;
  content: string;
}

type SessionWithDetails = Session & {
  participants: Participant[];
  messages: Array<
    Message & {
      attachment: FileAttachment | null;
    }
  >;
  fileAttachments: FileAttachment[];
  recordings: Recording[];
};

type SessionWithCounts = Session & {
  _count: {
    participants: number;
    messages: number;
    fileAttachments: number;
    recordings: number;
  };
};

const TOKEN_BYTE_LENGTH = 24;
const MAX_TOKEN_GENERATION_ATTEMPTS = 5;
const MAX_MESSAGE_CONTENT_LENGTH = 4_000;

const sessionDetailsInclude = {
  participants: {
    orderBy: {
      joinedAt: "asc",
    },
  },
  messages: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      attachment: true,
    },
  },
  fileAttachments: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  recordings: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.SessionInclude;

const sessionListInclude = {
  _count: {
    select: {
      participants: true,
      messages: true,
      fileAttachments: true,
      recordings: true,
    },
  },
} satisfies Prisma.SessionInclude;

function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
}

function normalizeToken(token: string): string {
  return token.trim();
}

function normalizeEndedBy(endedBy?: string): string {
  const normalized = endedBy?.trim();
  return normalized && normalized.length > 0 ? normalized : ParticipantRole.AGENT;
}

function normalizeMessageContent(content: string): string {
  const normalized = content.trim();

  if (normalized.length === 0) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      "Message content cannot be empty.",
      400,
      "VALIDATION_ERROR",
      { field: "content" },
    );
  }

  if (normalized.length > MAX_MESSAGE_CONTENT_LENGTH) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      `Message content must be ${MAX_MESSAGE_CONTENT_LENGTH} characters or fewer.`,
      400,
      "VALIDATION_ERROR",
      { field: "content", maxLength: MAX_MESSAGE_CONTENT_LENGTH },
    );
  }

  return normalized;
}

function toIsoStringOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapParticipant(participant: Participant): ParticipantDto {
  return {
    id: participant.id,
    sessionId: participant.sessionId,
    role: participant.role,
    joinedAt: participant.joinedAt.toISOString(),
    leftAt: toIsoStringOrNull(participant.leftAt),
  };
}

function mapSessionDetails(session: SessionWithDetails): SessionDetailsDto {
  return {
    id: session.id,
    token: session.token,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    endedAt: toIsoStringOrNull(session.endedAt),
    endedBy: session.endedBy,
    participants: session.participants.map(mapParticipant),
    messages: session.messages.map(mapMessageWithAttachment),
    sharedFiles: session.fileAttachments.map(mapFileAttachment),
    recordings: session.recordings.map(mapRecording),
  };
}

function mapSessionListItem(session: SessionWithCounts): SessionListItemDto {
  return {
    id: session.id,
    token: session.token,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    endedAt: toIsoStringOrNull(session.endedAt),
    endedBy: session.endedBy,
    participantCount: session._count.participants,
    messageCount: session._count.messages,
    fileCount: session._count.fileAttachments,
    recordingCount: session._count.recordings,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
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

async function findSessionDetailsOrThrow(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<SessionWithDetails> {
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    include: sessionDetailsInclude,
  });

  if (!session) {
    throw new AppError(
      "SESSION_NOT_FOUND",
      "Session was not found.",
      404,
      "SESSION_ERROR",
      { sessionId },
    );
  }

  return session;
}

export async function createSession(
  input: CreateSessionRequest,
): Promise<SessionDetailsDto> {
  for (let attempt = 1; attempt <= MAX_TOKEN_GENERATION_ATTEMPTS; attempt += 1) {
    const token = generateInviteToken();

    try {
      const session = await prisma.$transaction(async (tx) => {
        return tx.session.create({
          data: {
            token,
            status: SessionStatus.ACTIVE,
            participants: {
              create: {
                role: ParticipantRole.AGENT,
              },
            },
          },
          include: sessionDetailsInclude,
        });
      });

      logInfo("session.created", {
        sessionId: session.id,
        status: session.status,
        agentId: input.agentId ?? null,
      });

      return mapSessionDetails(session);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        logWarn("session.token_collision", { attempt });
        continue;
      }

      throw error;
    }
  }

  throw new AppError(
    "SESSION_CONCURRENT_MODIFICATION",
    "Unable to allocate a unique session token.",
    503,
    "BUSINESS_RULE_VIOLATION",
  );
}

export async function joinSession(
  input: JoinSessionRequest,
): Promise<{ session: SessionDetailsDto; participant: ParticipantDto }> {
  const token = normalizeToken(input.token);

  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { token },
      include: sessionDetailsInclude,
    });

    if (!session) {
      logWarn("session.join_failed", { reason: "token_not_found" });
      throw new AppError(
        "SESSION_TOKEN_NOT_FOUND",
        "Session was not found for the provided invite token.",
        404,
        "SESSION_ERROR",
      );
    }

    if (session.status === SessionStatus.ENDED) {
      logWarn("session.join_failed", {
        reason: "session_ended",
        sessionId: session.id,
      });
      throw new AppError(
        "SESSION_ALREADY_ENDED",
        "Ended sessions cannot be joined.",
        409,
        "SESSION_ERROR",
        { sessionId: session.id },
      );
    }

    const existingCustomer = session.participants.find(
      (participant) => participant.role === ParticipantRole.CUSTOMER,
    );

    if (existingCustomer) {
      logWarn("session.join_failed", {
        reason: "duplicate_customer",
        sessionId: session.id,
      });
      throw new AppError(
        "SESSION_DUPLICATE_JOIN",
        "This session already has a customer participant.",
        409,
        "BUSINESS_RULE_VIOLATION",
        { sessionId: session.id },
      );
    }

    let participant: Participant;

    try {
      participant = await tx.participant.create({
        data: {
          sessionId: session.id,
          role: ParticipantRole.CUSTOMER,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        logWarn("session.join_failed", {
          reason: "concurrent_duplicate_customer",
          sessionId: session.id,
        });
        throw new AppError(
          "SESSION_DUPLICATE_JOIN",
          "This session already has a customer participant.",
          409,
          "BUSINESS_RULE_VIOLATION",
          { sessionId: session.id },
        );
      }

      throw error;
    }

    const updatedSession = await findSessionDetailsOrThrow(tx, session.id);

    logInfo("session.joined", {
      sessionId: session.id,
      participantId: participant.id,
      role: participant.role,
    });

    return {
      session: mapSessionDetails(updatedSession),
      participant: mapParticipant(participant),
    };
  });
}

export async function getSessionInvite(
  tokenValue: string,
): Promise<SessionInviteDto> {
  const token = normalizeToken(tokenValue);
  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      participants: {
        select: {
          role: true,
          leftAt: true,
        },
      },
    },
  });

  if (!session) {
    throw new AppError(
      "SESSION_TOKEN_NOT_FOUND",
      "Session was not found for the provided invite token.",
      404,
      "SESSION_ERROR",
    );
  }

  return {
    id: session.id,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    agentReady: session.participants.some(
      (participant) =>
        participant.role === ParticipantRole.AGENT &&
        participant.leftAt === null,
    ),
    customerJoined: session.participants.some(
      (participant) => participant.role === ParticipantRole.CUSTOMER,
    ),
  };
}

export async function endSession(
  sessionId: string,
  _input: EndSessionRequest,
): Promise<SessionDetailsDto> {
  return prisma.$transaction(async (tx) => {
    const existingSession = await findSessionDetailsOrThrow(tx, sessionId);

    if (existingSession.status === SessionStatus.ENDED) {
      throw new AppError(
        "SESSION_ALREADY_ENDED",
        "Session has already ended.",
        409,
        "SESSION_ERROR",
        { sessionId },
      );
    }

    const endedAt = new Date();
    const endedBy = ParticipantRole.AGENT;

    await tx.session.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.ENDED,
        endedAt,
        endedBy,
      },
    });

    await tx.participant.updateMany({
      where: {
        sessionId,
        leftAt: null,
      },
      data: {
        leftAt: endedAt,
      },
    });

    const endedSession = await findSessionDetailsOrThrow(tx, sessionId);

    logInfo("session.ended", {
      sessionId,
      endedBy,
      endedAt: endedAt.toISOString(),
    });

    return mapSessionDetails(endedSession);
  });
}

export async function getSessions(): Promise<SessionListItemDto[]> {
  const sessions = await prisma.session.findMany({
    orderBy: {
      createdAt: "desc",
    },
    include: sessionListInclude,
  });

  return sessions.map(mapSessionListItem);
}

export async function getSessionById(
  sessionId: string,
): Promise<SessionDetailsDto> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: sessionDetailsInclude,
  });

  if (!session) {
    throw new AppError(
      "SESSION_NOT_FOUND",
      "Session was not found.",
      404,
      "SESSION_ERROR",
      { sessionId },
    );
  }

  return mapSessionDetails(session);
}

export async function getSessionMessages(
  sessionId: string,
): Promise<MessageDto[]> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    throw new AppError(
      "SESSION_NOT_FOUND",
      "Session was not found.",
      404,
      "SESSION_ERROR",
      { sessionId },
    );
  }

  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      attachment: true,
    },
  });

  return messages.map(mapMessageWithAttachment);
}

export async function createSessionMessage(
  input: CreateSessionMessageInput,
): Promise<MessageDto> {
  const content = normalizeMessageContent(input.content);

  return prisma.$transaction(async (tx) => {
    const participant = await tx.participant.findUnique({
      where: {
        id: input.participantId,
      },
      include: {
        session: true,
      },
    });

    if (!participant) {
      logWarn("CHAT_AUTHORIZATION_FAILED", {
        sessionId: input.sessionId,
        participantId: input.participantId,
        reason: "participant_not_found",
      });
      throw new AppError(
        "AUTH_FORBIDDEN",
        "Participant is not authorized for this session.",
        403,
        "AUTHORIZATION_ERROR",
        { participantId: input.participantId },
      );
    }

    if (participant.sessionId !== input.sessionId) {
      logWarn("CHAT_AUTHORIZATION_FAILED", {
        sessionId: input.sessionId,
        participantId: input.participantId,
        participantSessionId: participant.sessionId,
        reason: "session_mismatch",
      });
      throw new AppError(
        "AUTH_FORBIDDEN",
        "Participant does not belong to the requested session.",
        403,
        "AUTHORIZATION_ERROR",
        {
          participantId: input.participantId,
          participantSessionId: participant.sessionId,
          requestedSessionId: input.sessionId,
        },
      );
    }

    if (participant.session.status === SessionStatus.ENDED) {
      logWarn("CHAT_AUTHORIZATION_FAILED", {
        sessionId: input.sessionId,
        participantId: input.participantId,
        sessionStatus: participant.session.status,
        reason: "session_ended",
      });
      throw new AppError(
        "SESSION_ALREADY_ENDED",
        "Ended sessions cannot receive new chat messages.",
        409,
        "SESSION_ERROR",
        { sessionId: input.sessionId },
      );
    }

    if (participant.leftAt !== null) {
      logWarn("CHAT_AUTHORIZATION_FAILED", {
        sessionId: input.sessionId,
        participantId: input.participantId,
        leftAt: participant.leftAt.toISOString(),
        reason: "participant_left",
      });
      throw new AppError(
        "SESSION_NOT_JOINABLE",
        "Participants that have left cannot send chat messages.",
        409,
        "SESSION_ERROR",
        { participantId: input.participantId },
      );
    }

    logInfo("CHAT_AUTHORIZATION_PASSED", {
      sessionId: input.sessionId,
      participantId: input.participantId,
      participantSessionId: participant.sessionId,
      role: participant.role,
      sessionStatus: participant.session.status,
      participantLeftAt: participant.leftAt,
    });

    logInfo("CHAT_PERSIST_ATTEMPT", {
      sessionId: input.sessionId,
      participantId: input.participantId,
      role: participant.role,
      contentLength: content.length,
    });

    let message: Message;

    try {
      message = await tx.message.create({
        data: {
          sessionId: input.sessionId,
          participantId: input.participantId,
          role: participant.role,
          content,
        },
      });
    } catch (error) {
      logError("CHAT_PERSIST_FAILED", {
        sessionId: input.sessionId,
        participantId: input.participantId,
        role: participant.role,
        error: serializeError(error),
      });
      throw error;
    }

    logInfo("session.chat_message_created", {
      sessionId: message.sessionId,
      messageId: message.id,
      participantId: message.participantId,
      role: message.role,
    });

    return mapMessageWithAttachment({
      ...message,
      attachment: null,
    });
  });
}
