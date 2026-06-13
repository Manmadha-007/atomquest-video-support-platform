import axios from "axios";

import type {
  ApiErrorResponse,
  CreateSessionResponse,
  FileAttachment,
  GetFileAttachmentsResponse,
  GetSessionInviteResponse,
  GetSessionResponse,
  GetSessionMessagesResponse,
  EndSessionResponse,
  GetSessionsResponse,
  JoinSessionRequest,
  JoinSessionResponse,
  Participant,
  Recording,
  RecordingResponse,
  RecordingStatus,
  SessionDetails,
  SessionInvite,
  SessionListItem,
  SessionMessage,
  SessionStatus,
  GetRecordingsResponse,
  UploadFileResponse,
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

function isRecordingStatus(value: unknown): value is RecordingStatus {
  return (
    value === "RECORDING" ||
    value === "PROCESSING" ||
    value === "READY" ||
    value === "FAILED"
  );
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isSessionListItem(value: unknown): value is SessionListItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.token === "string" &&
    isSessionStatus(value.status) &&
    typeof value.createdAt === "string" &&
    isNullableString(value.endedAt) &&
    isNullableString(value.endedBy) &&
    typeof value.participantCount === "number" &&
    typeof value.messageCount === "number" &&
    typeof value.fileCount === "number" &&
    typeof value.recordingCount === "number"
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

function isFileAttachment(value: unknown): value is FileAttachment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.participantId === "string" &&
    typeof value.messageId === "string" &&
    typeof value.originalName === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.extension === "string" &&
    typeof value.sizeBytes === "number" &&
    typeof value.downloadUrl === "string" &&
    typeof value.createdAt === "string"
  );
}

function isSessionMessage(value: unknown): value is SessionMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.participantId === "string" &&
    (value.role === "AGENT" || value.role === "CUSTOMER") &&
    (value.kind === "TEXT" || value.kind === "FILE") &&
    typeof value.content === "string" &&
    (value.attachment === null || isFileAttachment(value.attachment)) &&
    typeof value.createdAt === "string"
  );
}

function isSessionInvite(value: unknown): value is SessionInvite {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isSessionStatus(value.status) &&
    typeof value.createdAt === "string" &&
    typeof value.agentReady === "boolean" &&
    typeof value.customerJoined === "boolean"
  );
}

function isRecording(value: unknown): value is Recording {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.startedByParticipantId === "string" &&
    isRecordingStatus(value.status) &&
    (value.stopReason === null ||
      value.stopReason === "AGENT" ||
      value.stopReason === "SESSION_ENDED" ||
      value.stopReason === "CUSTOMER_DISCONNECTED" ||
      value.stopReason === "RECOVERY") &&
    typeof value.mimeType === "string" &&
    typeof value.startedAt === "string" &&
    isNullableString(value.stoppedAt) &&
    isNullableString(value.readyAt) &&
    (typeof value.durationMs === "number" || value.durationMs === null) &&
    (typeof value.sizeBytes === "number" || value.sizeBytes === null) &&
    isNullableString(value.downloadUrl) &&
    isNullableString(value.failureReason) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
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
    value.messages.every(isSessionMessage) &&
    Array.isArray(value.sharedFiles) &&
    value.sharedFiles.every(isFileAttachment) &&
    Array.isArray(value.recordings) &&
    value.recordings.every(isRecording)
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

function parseGetSessionResponse(value: unknown): GetSessionResponse {
  if (isRecord(value) && isSessionDetails(value.session)) {
    return {
      session: value.session,
    };
  }

  throw new Error("Unexpected session response from the API.");
}

function parseGetSessionInviteResponse(
  value: unknown,
): GetSessionInviteResponse {
  if (isRecord(value) && isSessionInvite(value.session)) {
    return {
      session: value.session,
    };
  }

  throw new Error("Unexpected session invite response from the API.");
}

function parseGetSessionMessagesResponse(
  value: unknown,
): GetSessionMessagesResponse {
  if (
    isRecord(value) &&
    Array.isArray(value.messages) &&
    value.messages.every(isSessionMessage)
  ) {
    return {
      messages: value.messages,
    };
  }

  throw new Error("Unexpected session messages response from the API.");
}

function parseCreateSessionResponse(value: unknown): CreateSessionResponse {
  if (isRecord(value) && isSessionDetails(value.session)) {
    return {
      session: value.session,
    };
  }

  throw new Error("Unexpected created session response from the API.");
}

function parseJoinSessionResponse(value: unknown): JoinSessionResponse {
  if (
    isRecord(value) &&
    isSessionDetails(value.session) &&
    isParticipant(value.participant)
  ) {
    return {
      session: value.session,
      participant: value.participant,
    };
  }

  throw new Error("Unexpected join session response from the API.");
}

function parseEndSessionResponse(value: unknown): EndSessionResponse {
  if (isRecord(value) && isSessionDetails(value.session)) {
    return {
      session: value.session,
    };
  }

  throw new Error("Unexpected end session response from the API.");
}

function parseRecordingResponse(value: unknown): RecordingResponse {
  if (isRecord(value) && isRecording(value.recording)) {
    return {
      recording: value.recording,
    };
  }

  throw new Error("Unexpected recording response from the API.");
}

function parseGetRecordingsResponse(value: unknown): GetRecordingsResponse {
  if (
    isRecord(value) &&
    Array.isArray(value.recordings) &&
    value.recordings.every(isRecording)
  ) {
    return {
      recordings: value.recordings,
    };
  }

  throw new Error("Unexpected recordings response from the API.");
}

function parseUploadFileResponse(value: unknown): UploadFileResponse {
  if (
    isRecord(value) &&
    isFileAttachment(value.attachment) &&
    isSessionMessage(value.message)
  ) {
    return {
      attachment: value.attachment,
      message: value.message,
    };
  }

  throw new Error("Unexpected file upload response from the API.");
}

function parseGetFileAttachmentsResponse(
  value: unknown,
): GetFileAttachmentsResponse {
  if (
    isRecord(value) &&
    Array.isArray(value.files) &&
    value.files.every(isFileAttachment)
  ) {
    return {
      files: value.files,
    };
  }

  throw new Error("Unexpected shared files response from the API.");
}

export async function getSessions(): Promise<GetSessionsResponse> {
  const response = await sessionsApi.get<unknown>("/sessions");
  return parseGetSessionsResponse(response.data);
}

export async function getSession(
  sessionId: string,
): Promise<GetSessionResponse> {
  const response = await sessionsApi.get<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}`,
  );
  return parseGetSessionResponse(response.data);
}

export async function getSessionInvite(
  token: string,
): Promise<GetSessionInviteResponse> {
  const response = await sessionsApi.get<unknown>(
    `/sessions/invites/${encodeURIComponent(token)}`,
  );
  return parseGetSessionInviteResponse(response.data);
}

export async function getSessionMessages(
  sessionId: string,
): Promise<GetSessionMessagesResponse> {
  const response = await sessionsApi.get<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  return parseGetSessionMessagesResponse(response.data);
}

export async function createSession(): Promise<CreateSessionResponse> {
  const response = await sessionsApi.post<unknown>("/sessions");
  return parseCreateSessionResponse(response.data);
}

export async function joinSession(
  request: JoinSessionRequest,
): Promise<JoinSessionResponse> {
  const response = await sessionsApi.post<unknown>("/sessions/join", request);
  return parseJoinSessionResponse(response.data);
}

export async function endSession(
  sessionId: string,
): Promise<EndSessionResponse> {
  const response = await sessionsApi.post<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}/end`,
    {},
  );
  return parseEndSessionResponse(response.data);
}

export async function getRecordings(
  sessionId?: string,
): Promise<GetRecordingsResponse> {
  const response = await sessionsApi.get<unknown>("/recordings", {
    params: sessionId ? { sessionId } : undefined,
  });
  return parseGetRecordingsResponse(response.data);
}

export async function startRecording({
  mimeType,
  participantId,
  sessionId,
}: {
  sessionId: string;
  participantId: string;
  mimeType: string;
}): Promise<RecordingResponse> {
  const response = await sessionsApi.post<unknown>("/recordings/start", {
    sessionId,
    participantId,
    mimeType,
  });
  return parseRecordingResponse(response.data);
}

export async function uploadRecordingChunk({
  chunk,
  participantId,
  recordingId,
  sequence,
}: {
  recordingId: string;
  participantId: string;
  sequence: number;
  chunk: Blob;
}): Promise<RecordingResponse> {
  const response = await sessionsApi.post<unknown>(
    `/recordings/${encodeURIComponent(recordingId)}/chunks/${sequence}`,
    chunk,
    {
      headers: {
        "Content-Type": "application/octet-stream",
        "x-atomquest-participant-id": participantId,
      },
    },
  );
  return parseRecordingResponse(response.data);
}

export async function stopRecording({
  participantId,
  recordingId,
}: {
  recordingId: string;
  participantId: string;
}): Promise<RecordingResponse> {
  const response = await sessionsApi.post<unknown>(
    `/recordings/${encodeURIComponent(recordingId)}/stop`,
    { participantId },
  );
  return parseRecordingResponse(response.data);
}

export async function uploadChatFile({
  file,
  onUploadProgress,
  participantId,
  sessionId,
}: {
  sessionId: string;
  participantId: string;
  file: File;
  onUploadProgress?: (progressPercent: number) => void;
}): Promise<UploadFileResponse> {
  const response = await sessionsApi.post<unknown>("/files/upload", file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-atomquest-session-id": sessionId,
      "x-atomquest-participant-id": participantId,
      "x-atomquest-file-name": encodeURIComponent(file.name),
    },
    onUploadProgress: (progressEvent) => {
      if (!progressEvent.total || !onUploadProgress) {
        return;
      }

      onUploadProgress(
        Math.min(
          100,
          Math.round((progressEvent.loaded / progressEvent.total) * 100),
        ),
      );
    },
  });

  return parseUploadFileResponse(response.data);
}

export async function getFileAttachments(
  sessionId?: string,
): Promise<GetFileAttachmentsResponse> {
  const response = await sessionsApi.get<unknown>("/files", {
    params: sessionId ? { sessionId } : undefined,
  });
  return parseGetFileAttachmentsResponse(response.data);
}

export function getRecordingDownloadUrl(recording: Recording): string | null {
  if (!recording.downloadUrl) {
    return null;
  }

  const apiBaseUrl = new URL(API_BASE_URL, window.location.origin);
  return new URL(recording.downloadUrl, apiBaseUrl).toString();
}

export function getFileDownloadUrl(file: FileAttachment): string {
  const apiBaseUrl = new URL(API_BASE_URL, window.location.origin);
  return new URL(file.downloadUrl, apiBaseUrl).toString();
}

export function toSessionListItem(session: SessionDetails): SessionListItem {
  return {
    id: session.id,
    token: session.token,
    status: session.status,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    endedBy: session.endedBy,
    participantCount: session.participants.length,
    messageCount: session.messages.length,
    fileCount: session.sharedFiles.length,
    recordingCount: session.recordings.length,
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

export function getSessionApiErrorCode(error: unknown): string | null {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    return error.response?.data?.error?.code ?? null;
  }
  return null;
}
