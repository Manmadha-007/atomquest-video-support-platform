export type SessionStatus = "ACTIVE" | "ENDED";

export type ParticipantRole = "AGENT" | "CUSTOMER";

export type RecordingStatus = "RECORDING" | "PROCESSING" | "READY" | "FAILED";

export type MessageKind = "TEXT" | "FILE";

export type RecordingStopReason =
  | "AGENT"
  | "SESSION_ENDED"
  | "CUSTOMER_DISCONNECTED"
  | "RECOVERY";

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
  | "RECORDING_NOT_FOUND"
  | "RECORDING_ALREADY_ACTIVE"
  | "RECORDING_INVALID_STATE"
  | "RECORDING_STORAGE_ERROR"
  | "FILE_ATTACHMENT_NOT_FOUND"
  | "FILE_UPLOAD_INVALID_TYPE"
  | "FILE_UPLOAD_TOO_LARGE"
  | "FILE_STORAGE_ERROR"
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
  fileCount: number;
  recordingCount: number;
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
  participantId: string;
  role: ParticipantRole;
  kind: MessageKind;
  content: string;
  attachment: FileAttachment | null;
  createdAt: string;
}

export interface FileAttachment {
  id: string;
  sessionId: string;
  participantId: string;
  messageId: string;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  downloadUrl: string;
  createdAt: string;
}

export interface Recording {
  id: string;
  sessionId: string;
  startedByParticipantId: string;
  status: RecordingStatus;
  stopReason: RecordingStopReason | null;
  mimeType: string;
  startedAt: string;
  stoppedAt: string | null;
  readyAt: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
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
  sharedFiles: FileAttachment[];
  recordings: Recording[];
}

export interface GetSessionsResponse {
  sessions: SessionListItem[];
}

export interface GetSessionResponse {
  session: SessionDetails;
}

export interface GetSessionMessagesResponse {
  messages: SessionMessage[];
}

export interface UploadFileResponse {
  attachment: FileAttachment;
  message: SessionMessage;
}

export interface GetFileAttachmentsResponse {
  files: FileAttachment[];
}

export interface CreateSessionResponse {
  session: SessionDetails;
}

export interface JoinSessionRequest {
  token: string;
}

export interface SessionInvite {
  id: string;
  status: SessionStatus;
  createdAt: string;
  agentReady: boolean;
  customerJoined: boolean;
}

export interface JoinSessionResponse {
  session: SessionDetails;
  participant: Participant;
}

export interface GetSessionInviteResponse {
  session: SessionInvite;
}

export interface EndSessionResponse {
  session: SessionDetails;
}

export interface RecordingResponse {
  recording: Recording;
}

export interface GetRecordingsResponse {
  recordings: Recording[];
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    category: ApiErrorCategory;
    details?: Record<string, unknown>;
  };
}
