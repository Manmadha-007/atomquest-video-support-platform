export type SessionStatus = "ACTIVE" | "ENDED";

export type ParticipantRole = "AGENT" | "CUSTOMER";

export interface SessionListItem {
  id: string;
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

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    category: string;
    details?: Record<string, unknown>;
  };
}
