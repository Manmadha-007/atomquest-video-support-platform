import axios from "axios";

import type {
  ApiErrorResponse,
  CreateSessionResponse,
  GetSessionsResponse,
  Participant,
  SessionDetails,
  SessionListItem,
  SessionMessage,
  SessionStatus,
} from "../types/session";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000/api";

const sessionsApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return value === "ACTIVE" || value === "ENDED";
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isSessionListItem(value: unknown): value is SessionListItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isSessionStatus(value.status) &&
    typeof value.createdAt === "string" &&
    isNullableString(value.endedAt) &&
    isNullableString(value.endedBy) &&
    typeof value.participantCount === "number" &&
    typeof value.messageCount === "number"
  );
}

function isParticipant(value: unknown): value is Participant {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    (value.role === "AGENT" || value.role === "CUSTOMER") &&
    typeof value.joinedAt === "string" &&
    isNullableString(value.leftAt)
  );
}

function isSessionMessage(value: unknown): value is SessionMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.sender === "string" &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string"
  );
}

function isSessionDetails(value: unknown): value is SessionDetails {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.token === "string" &&
    isSessionStatus(value.status) &&
    typeof value.createdAt === "string" &&
    isNullableString(value.endedAt) &&
    isNullableString(value.endedBy) &&
    Array.isArray(value.participants) &&
    value.participants.every(isParticipant) &&
    Array.isArray(value.messages) &&
    value.messages.every(isSessionMessage)
  );
}

function parseGetSessionsResponse(value: unknown): GetSessionsResponse {
  if (
    isRecord(value) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isSessionListItem)
  ) {
    return {
      sessions: value.sessions,
    };
  }

  throw new Error("Unexpected sessions response from the API.");
}

function parseCreateSessionResponse(value: unknown): CreateSessionResponse {
  if (isRecord(value) && isSessionDetails(value.session)) {
    return {
      session: value.session,
    };
  }

  throw new Error("Unexpected created session response from the API.");
}

export async function getSessions(): Promise<GetSessionsResponse> {
  const response = await sessionsApi.get<unknown>("/sessions");
  return parseGetSessionsResponse(response.data);
}

export async function createSession(): Promise<CreateSessionResponse> {
  const response = await sessionsApi.post<unknown>("/sessions");
  return parseCreateSessionResponse(response.data);
}

export function toSessionListItem(session: SessionDetails): SessionListItem {
  return {
    id: session.id,
    status: session.status,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    endedBy: session.endedBy,
    participantCount: session.participants.length,
    messageCount: session.messages.length,
  };
}

export function getSessionApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    const apiMessage = error.response?.data?.error?.message;

    if (apiMessage && apiMessage.trim().length > 0) {
      return apiMessage;
    }

    if (error.message.trim().length > 0) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unable to connect to the session service.";
}
