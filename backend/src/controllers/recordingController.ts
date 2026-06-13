import type { Request, Response } from "express";

import {
  getRecordingDownload as getRecordingDownloadService,
  getRecordings as getRecordingsService,
  startRecording as startRecordingService,
  stopRecording as stopRecordingService,
  uploadRecordingChunk as uploadRecordingChunkService,
} from "../services/recordingService.js";
import {
  AppError,
  type ApiErrorResponse,
  type GetRecordingsResponse,
  type RecordingResponse,
  type StartRecordingRequest,
  type StopRecordingRequest,
} from "../types/sessionTypes.js";

const MAX_ID_LENGTH = 128;
const MAX_MIME_TYPE_LENGTH = 128;
const MAX_SEQUENCE = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      "Request body must be a JSON object.",
      400,
      "VALIDATION_ERROR",
    );
  }

  return body;
}

function validateId(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      `${fieldName} must be a string.`,
      400,
      "VALIDATION_ERROR",
      { field: fieldName },
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > MAX_ID_LENGTH) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      `${fieldName} must be between 1 and ${MAX_ID_LENGTH} characters.`,
      400,
      "VALIDATION_ERROR",
      { field: fieldName },
    );
  }

  return normalized;
}

function validateMimeType(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      "mimeType must be a string.",
      400,
      "VALIDATION_ERROR",
      { field: "mimeType" },
    );
  }

  const mimeType = value.trim();

  if (
    !mimeType.startsWith("video/webm") ||
    mimeType.length > MAX_MIME_TYPE_LENGTH
  ) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      "mimeType must be a supported video/webm type.",
      400,
      "VALIDATION_ERROR",
      { field: "mimeType" },
    );
  }

  return mimeType;
}

function validateStartRequest(body: unknown): StartRecordingRequest {
  const value = validateBody(body);

  return {
    sessionId: validateId(value.sessionId, "sessionId"),
    participantId: validateId(value.participantId, "participantId"),
    mimeType: validateMimeType(value.mimeType),
  };
}

function validateStopRequest(body: unknown): StopRecordingRequest {
  const value = validateBody(body);

  return {
    participantId: validateId(value.participantId, "participantId"),
  };
}

function validateSequence(value: unknown): number {
  const sequence = typeof value === "string" ? Number(value) : Number.NaN;

  if (!Number.isInteger(sequence) || sequence < 0 || sequence > MAX_SEQUENCE) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      `sequence must be an integer between 0 and ${MAX_SEQUENCE}.`,
      400,
      "VALIDATION_ERROR",
      { field: "sequence" },
    );
  }

  return sequence;
}

function sendErrorResponse(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        category: error.category,
        details: error.details,
      },
    } satisfies ApiErrorResponse);
    return;
  }

  console.error(
    JSON.stringify({
      level: "error",
      event: "recording.request_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected recording error occurred.",
      category: "INTERNAL_ERROR",
    },
  } satisfies ApiErrorResponse);
}

export async function startRecording(
  req: Request<Record<string, never>, RecordingResponse | ApiErrorResponse>,
  res: Response<RecordingResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const recording = await startRecordingService(
      validateStartRequest(req.body),
    );
    res.status(201).json({ recording });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function uploadRecordingChunk(
  req: Request<{ recordingId: string; sequence: string }>,
  res: Response<RecordingResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const recordingId = validateId(req.params.recordingId, "recordingId");
    const participantId = validateId(
      req.header("x-atomquest-participant-id"),
      "x-atomquest-participant-id",
    );
    const sequence = validateSequence(req.params.sequence);

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(
        "VALIDATION_INVALID_FIELD",
        "Recording chunk body must contain binary media.",
        400,
        "VALIDATION_ERROR",
        { field: "body" },
      );
    }

    const recording = await uploadRecordingChunkService(
      recordingId,
      participantId,
      sequence,
      req.body,
    );
    res.status(200).json({ recording });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function stopRecording(
  req: Request<{ recordingId: string }, RecordingResponse | ApiErrorResponse>,
  res: Response<RecordingResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const recordingId = validateId(req.params.recordingId, "recordingId");
    const input = validateStopRequest(req.body);
    const recording = await stopRecordingService(
      recordingId,
      input.participantId,
    );
    res.status(200).json({ recording });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function getRecordings(
  req: Request,
  res: Response<GetRecordingsResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const sessionId =
      req.query.sessionId === undefined
        ? undefined
        : validateId(req.query.sessionId, "sessionId");
    const recordings = await getRecordingsService(sessionId);
    res.status(200).json({ recordings });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function downloadRecording(
  req: Request<{ recordingId: string }>,
  res: Response,
): Promise<void> {
  try {
    const recordingId = validateId(req.params.recordingId, "recordingId");
    const token = validateId(req.query.token, "token");
    const result = await getRecordingDownloadService(recordingId, token);

    res.download(result.filePath, `atomquest-${result.recording.id}.webm`);
  } catch (error) {
    sendErrorResponse(res, error);
  }
}
