import type {
  Message,
  Participant,
  Recording,
  Session,
} from "@prisma/client";

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
  | "RECORDING_NOT_FOUND"
  | "RECORDING_ALREADY_ACTIVE"
  | "RECORDING_INVALID_STATE"
  | "RECORDING_STORAGE_ERROR"
  | "FILE_ATTACHMENT_NOT_FOUND"
  | "FILE_UPLOAD_INVALID_TYPE"
  | "FILE_UPLOAD_TOO_LARGE"
  | "FILE_STORAGE_ERROR"
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

export interface SessionInviteDto {
  id: string;
  status: Session["status"];
  createdAt: string;
  agentReady: boolean;
  customerJoined: boolean;
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
  fileCount: number;
  recordingCount: number;
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
  participantId: string;
  role: Participant["role"];
  kind: Message["kind"];
  content: string;
  attachment: FileAttachmentDto | null;
  createdAt: string;
}

export interface FileAttachmentDto {
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

export interface RecordingDto {
  id: string;
  sessionId: string;
  startedByParticipantId: string;
  status: Recording["status"];
  stopReason: Recording["stopReason"];
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

export interface SessionDetailsDto {
  id: string;
  token: string;
  status: Session["status"];
  createdAt: string;
  endedAt: string | null;
  endedBy: string | null;
  participants: ParticipantDto[];
  messages: MessageDto[];
  sharedFiles: FileAttachmentDto[];
  recordings: RecordingDto[];
}

export interface CreateSessionResponse {
  session: SessionDetailsDto;
}

export interface JoinSessionResponse {
  session: SessionDetailsDto;
  participant: ParticipantDto;
}

export interface GetSessionInviteResponse {
  session: SessionInviteDto;
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

export interface GetSessionMessagesResponse {
  messages: MessageDto[];
}

export interface UploadFileResponse {
  attachment: FileAttachmentDto;
  message: MessageDto;
}

export interface StartRecordingRequest {
  sessionId: string;
  participantId: string;
  mimeType: string;
}

export interface StopRecordingRequest {
  participantId: string;
}

export interface RecordingResponse {
  recording: RecordingDto;
}

export interface GetRecordingsResponse {
  recordings: RecordingDto[];
}

export interface GetFileAttachmentsResponse {
  files: FileAttachmentDto[];
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
