import {
  ParticipantRole,
  Prisma,
  SessionStatus,
  type Message,
  type Participant,
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
  type SessionListItemDto,
} from "../types/sessionTypes.js";

type SessionWithDetails = Session & {
  participants: Participant[];
  messages: Message[];
};

type SessionWithCounts = Session & {
  _count: {
    participants: number;
    messages: number;
  };
};

const TOKEN_BYTE_LENGTH = 24;
const MAX_TOKEN_GENERATION_ATTEMPTS = 5;

const sessionDetailsInclude = {
  participants: {
    orderBy: {
      joinedAt: "asc",
    },
  },
  messages: {
    orderBy: {
      createdAt: "asc",
    },
  },
} satisfies Prisma.SessionInclude;

const sessionListInclude = {
  _count: {
    select: {
      participants: true,
      messages: true,
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

function mapMessage(message: Message): MessageDto {
  return {
    id: message.id,
    sessionId: message.sessionId,
    sender: message.sender,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
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
    messages: session.messages.map(mapMessage),
  };
}

function mapSessionListItem(session: SessionWithCounts): SessionListItemDto {
  return {
    id: session.id,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    endedAt: toIsoStringOrNull(session.endedAt),
    endedBy: session.endedBy,
    participantCount: session._count.participants,
    messageCount: session._count.messages,
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

export async function endSession(
  sessionId: string,
  input: EndSessionRequest,
): Promise<SessionDetailsDto> {
  return prisma.$transaction(async (tx) => {
    const existingSession = await findSessionDetailsOrThrow(tx, sessionId);

    if (existingSession.status === SessionStatus.ENDED) {
      logInfo("session.end_idempotent", { sessionId });
      return mapSessionDetails(existingSession);
    }

    const endedAt = new Date();
    const endedBy = normalizeEndedBy(input.endedBy);

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
