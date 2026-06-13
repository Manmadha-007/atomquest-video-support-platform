export type SessionStatus = "ACTIVE" | "ENDED";

export type ParticipantRole = "AGENT" | "CUSTOMER";

export type ApiErrorCategory =
  | "VALIDATION_ERROR"
  | "SESSION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "BUSINESS_RULE_VIOLATION"
  | "INTERNAL_ERROR";

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

export interface SessionListItem {
  id: string;
  token: string;
  status: SessionStatus;
  createdAt: string;
  endedAt: string | null;
  endedBy: string | null;
  participantCount: number;
  messageCount: number;
}

export interface Participant {
  id: string;
  sessionId: string;
  role: ParticipantRole;
  joinedAt: string;
  leftAt: string | null;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  sender: string;
  content: string;
  createdAt: string;
}

export interface SessionDetails {
  id: string;
  token: string;
  status: SessionStatus;
  createdAt: string;
  endedAt: string | null;
  endedBy: string | null;
  participants: Participant[];
  messages: SessionMessage[];
}

export interface GetSessionsResponse {
  sessions: SessionListItem[];
}

export interface CreateSessionResponse {
  session: SessionDetails;
}

export interface JoinSessionRequest {
  token: string;
}

export interface JoinSessionResponse {
  session: SessionDetails;
  participant: Participant;
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    category: ApiErrorCategory;
    details?: Record<string, unknown>;
  };
}
