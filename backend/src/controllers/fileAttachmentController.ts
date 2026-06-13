import type { NextFunction, Request, Response } from "express";
import { createReadStream } from "node:fs";
import { basename } from "node:path";

import {
  getFileAttachmentForDownload,
  getFileAttachments as getFileAttachmentsService,
  MAX_FILE_UPLOAD_SIZE_BYTES,
  uploadFileAttachment,
} from "../services/fileAttachmentService.js";
import { broadcastSessionChatMessage } from "../sockets/sessionBroadcaster.js";
import {
  AppError,
  type ApiErrorResponse,
  type GetFileAttachmentsResponse,
  type UploadFileResponse,
} from "../types/sessionTypes.js";

type EmptyParams = Record<string, never>;
type FileIdParams = {
  fileId: string;
};

const MAX_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getHeaderValue(req: Request, headerName: string): string {
  const value = req.header(headerName);

  if (!value || value.trim().length === 0) {
    throw new AppError(
      "VALIDATION_MISSING_FIELD",
      `${headerName} header is required.`,
      400,
      "VALIDATION_ERROR",
      { header: headerName },
    );
  }

  return value.trim();
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

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      `${fieldName} must be between 1 and ${MAX_ID_LENGTH} characters.`,
      400,
      "VALIDATION_ERROR",
      { field: fieldName },
    );
  }

  return trimmed;
}

function decodeFileName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getRequestBuffer(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      "File upload body must contain raw bytes.",
      400,
      "VALIDATION_ERROR",
      { field: "file" },
    );
  }

  return req.body;
}

function sendErrorResponse(res: Response<ApiErrorResponse>, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        category: error.category,
        details: error.details,
      },
    });
    return;
  }

  console.error(
    JSON.stringify({
      level: "error",
      event: "file.request_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      category: "INTERNAL_ERROR",
    },
  });
}

export function handleRawBodyError(
  error: unknown,
  _req: Request,
  res: Response<ApiErrorResponse>,
  next: NextFunction,
): void {
  if (
    isRecord(error) &&
    error.type === "entity.too.large"
  ) {
    sendErrorResponse(
      res,
      new AppError(
        "FILE_UPLOAD_TOO_LARGE",
        "File must be 25 MB or smaller.",
        413,
        "VALIDATION_ERROR",
        { maxBytes: MAX_FILE_UPLOAD_SIZE_BYTES },
      ),
    );
    return;
  }

  next(error);
}

export async function uploadFile(
  req: Request<EmptyParams, UploadFileResponse | ApiErrorResponse, Buffer>,
  res: Response<UploadFileResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const sessionId = validateId(
      getHeaderValue(req, "x-atomquest-session-id"),
      "sessionId",
    );
    const participantId = validateId(
      getHeaderValue(req, "x-atomquest-participant-id"),
      "participantId",
    );
    const originalName = decodeFileName(
      getHeaderValue(req, "x-atomquest-file-name"),
    );
    const mimeType = getHeaderValue(req, "content-type");
    const result = await uploadFileAttachment({
      sessionId,
      participantId,
      originalName,
      mimeType,
      fileBuffer: getRequestBuffer(req),
    });

    broadcastSessionChatMessage(result.message);
    res.status(201).json(result);
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function getFileAttachments(
  req: Request<EmptyParams, GetFileAttachmentsResponse | ApiErrorResponse>,
  res: Response<GetFileAttachmentsResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const sessionId =
      typeof req.query.sessionId === "string"
        ? validateId(req.query.sessionId, "sessionId")
        : undefined;
    const files = await getFileAttachmentsService(sessionId);

    res.status(200).json({ files });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function downloadFile(
  req: Request<FileIdParams, ApiErrorResponse>,
  res: Response<ApiErrorResponse>,
): Promise<void> {
  try {
    const fileAttachmentId = validateId(req.params.fileId, "fileId");
    const token = validateId(req.query.token, "token");
    const file = await getFileAttachmentForDownload({
      fileAttachmentId,
      token,
    });

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", file.sizeBytes.toString());
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${basename(file.originalName).replace(/"/g, "")}"`,
    );

    createReadStream(file.filePath).pipe(res);
  } catch (error) {
    sendErrorResponse(res, error);
  }
}
