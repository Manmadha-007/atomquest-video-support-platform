import type { Message, Participant, Session } from "@prisma/client";

export type ApiErrorCategory =
  | "VALIDATION_ERROR"
  | "SESSION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "BUSINESS_RULE_VIOLATION";

export type ApiErrorCode =
  | "VALIDATION_MISSING_FIELD"
  | "VALIDATION_INVALID_FIELD"
  | "VALIDATION_INVALID_SESSION_ID"
  | "VALIDATION_INVALID_TOKEN"
  | "SESSION_NOT_FOUND"
  | "SESSION_TOKEN_NOT_FOUND"
  | "SESSION_ALREADY_ENDED"
  | "SESSION_NOT_JOINABLE"
  | "AUTH_FORBIDDEN"
  | "SESSION_DUPLICATE_JOIN"
  | "SESSION_INVALID_STATE_TRANSITION"
  | "SESSION_PARTICIPANT_LIMIT_REACHED"
  | "SESSION_CONCURRENT_MODIFICATION"
  | "INTERNAL_SERVER_ERROR";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    category: ApiErrorCategory | "INTERNAL_ERROR";
    details?: Record<string, unknown>;
  };
}

export interface CreateSessionRequest {
  agentId?: string;
}

export interface JoinSessionRequest {
  token: string;
}

export interface EndSessionRequest {
  endedBy?: string;
}

export interface SessionListItemDto {
  id: string;
  token: string;
  status: Session["status"];
  createdAt: string;
  endedAt: string | null;
  endedBy: string | null;
  participantCount: number;
  messageCount: number;
}

export interface ParticipantDto {
  id: string;
  sessionId: string;
  role: Participant["role"];
  joinedAt: string;
  leftAt: string | null;
}

export interface MessageDto {
  id: string;
  sessionId: string;
  sender: Message["sender"];
  content: string;
  createdAt: string;
}

export interface SessionDetailsDto {
  id: string;
  token: string;
  status: Session["status"];
  createdAt: string;
  endedAt: string | null;
  endedBy: string | null;
  participants: ParticipantDto[];
  messages: MessageDto[];
}

export interface CreateSessionResponse {
  session: SessionDetailsDto;
}

export interface JoinSessionResponse {
  session: SessionDetailsDto;
  participant: ParticipantDto;
}

export interface EndSessionResponse {
  session: SessionDetailsDto;
}

export interface GetSessionsResponse {
  sessions: SessionListItemDto[];
}

export interface GetSessionResponse {
  session: SessionDetailsDto;
}

export class AppError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;
  public readonly category: ApiErrorCategory;
  public readonly details?: Record<string, unknown>;

  public constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number,
    category: ApiErrorCategory,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.category = category;
    this.details = details;
  }
}
