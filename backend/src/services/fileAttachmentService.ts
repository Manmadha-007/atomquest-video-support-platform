import {
  MessageKind,
  SessionStatus,
  type FileAttachment,
  type Message,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { prisma } from "../config/prisma.js";
import {
  AppError,
  type FileAttachmentDto,
  type MessageDto,
} from "../types/sessionTypes.js";
import {
  getFileStorageKey,
  removeUploadedFile,
  resolveFileStoragePath,
  writeUploadedFile,
} from "./fileStorage.js";

export const MAX_FILE_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

const DOWNLOAD_TOKEN_BYTE_LENGTH = 32;
const ID_BYTE_LENGTH = 16;

const ALLOWED_FILE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

type MessageWithAttachment = Message & {
  attachment: FileAttachment | null;
};

export interface UploadFileInput {
  sessionId: string;
  participantId: string;
  originalName: string;
  mimeType: string;
  fileBuffer: Buffer;
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function generateSafeId(): string {
  return randomBytes(ID_BYTE_LENGTH).toString("hex");
}

function generateDownloadToken(): string {
  return randomBytes(DOWNLOAD_TOKEN_BYTE_LENGTH).toString("base64url");
}

function getDownloadUrl(attachment: FileAttachment): string {
  return `/api/files/${encodeURIComponent(attachment.id)}/download?token=${encodeURIComponent(attachment.downloadToken)}`;
}

export function mapFileAttachment(
  attachment: FileAttachment,
): FileAttachmentDto {
  return {
    id: attachment.id,
    sessionId: attachment.sessionId,
    participantId: attachment.participantId,
    messageId: attachment.messageId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    extension: attachment.extension,
    sizeBytes: attachment.sizeBytes,
    downloadUrl: getDownloadUrl(attachment),
    createdAt: toIsoString(attachment.createdAt),
  };
}

export function mapMessageWithAttachment(
  message: MessageWithAttachment,
): MessageDto {
  return {
    id: message.id,
    sessionId: message.sessionId,
    participantId: message.participantId,
    role: message.role,
    kind: message.kind,
    content: message.content,
    attachment: message.attachment
      ? mapFileAttachment(message.attachment)
      : null,
    createdAt: toIsoString(message.createdAt),
  };
}

function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function normalizeOriginalName(value: string): string {
  const normalized = value.trim().replace(/[/\\]/g, "_");

  if (normalized.length === 0 || normalized.length > 255) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      "File name must be between 1 and 255 characters.",
      400,
      "VALIDATION_ERROR",
      { field: "fileName" },
    );
  }

  return normalized;
}

function getExtension(originalName: string): string {
  const extension = path.extname(originalName).replace(".", "").toLowerCase();

  if (!extension) {
    throw new AppError(
      "FILE_UPLOAD_INVALID_TYPE",
      "File must include one of these extensions: jpg, jpeg, png, webp, pdf, doc, docx, txt.",
      400,
      "VALIDATION_ERROR",
      { allowedExtensions: Object.keys(ALLOWED_FILE_TYPES) },
    );
  }

  return extension;
}

function validateFileType({
  extension,
  mimeType,
}: {
  extension: string;
  mimeType: string;
}): void {
  const expectedMimeType = ALLOWED_FILE_TYPES[extension];

  if (!expectedMimeType) {
    throw new AppError(
      "FILE_UPLOAD_INVALID_TYPE",
      "Unsupported file type. Supported files: jpg, jpeg, png, webp, pdf, doc, docx, txt.",
      400,
      "VALIDATION_ERROR",
      { extension, allowedExtensions: Object.keys(ALLOWED_FILE_TYPES) },
    );
  }

  if (mimeType !== expectedMimeType) {
    throw new AppError(
      "FILE_UPLOAD_INVALID_TYPE",
      "File MIME type does not match the allowed type for its extension.",
      400,
      "VALIDATION_ERROR",
      { extension, mimeType, expectedMimeType },
    );
  }
}

function validateFileSize(sizeBytes: number): void {
  if (sizeBytes <= 0) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      "Uploaded file cannot be empty.",
      400,
      "VALIDATION_ERROR",
      { field: "file" },
    );
  }

  if (sizeBytes > MAX_FILE_UPLOAD_SIZE_BYTES) {
    throw new AppError(
      "FILE_UPLOAD_TOO_LARGE",
      "File must be 25 MB or smaller.",
      413,
      "VALIDATION_ERROR",
      { maxBytes: MAX_FILE_UPLOAD_SIZE_BYTES, sizeBytes },
    );
  }
}

async function assertActiveSessionParticipant(
  sessionId: string,
  participantId: string,
): Promise<void> {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    include: { session: true },
  });

  if (!participant || participant.sessionId !== sessionId) {
    throw new AppError(
      "AUTH_FORBIDDEN",
      "Participant is not authorized for this session.",
      403,
      "AUTHORIZATION_ERROR",
      { sessionId, participantId },
    );
  }

  if (participant.session.status === SessionStatus.ENDED) {
    throw new AppError(
      "SESSION_ALREADY_ENDED",
      "Ended sessions cannot receive new shared files.",
      409,
      "SESSION_ERROR",
      { sessionId },
    );
  }

  if (participant.leftAt !== null) {
    throw new AppError(
      "SESSION_NOT_JOINABLE",
      "Participants that have left cannot share files.",
      409,
      "SESSION_ERROR",
      { participantId },
    );
  }
}

export async function uploadFileAttachment(
  input: UploadFileInput,
): Promise<{ attachment: FileAttachmentDto; message: MessageDto }> {
  const originalName = normalizeOriginalName(input.originalName);
  const mimeType = normalizeMimeType(input.mimeType);
  const extension = getExtension(originalName);

  validateFileType({ extension, mimeType });
  validateFileSize(input.fileBuffer.length);
  await assertActiveSessionParticipant(input.sessionId, input.participantId);

  const fileAttachmentId = generateSafeId();
  const storageKey = getFileStorageKey({
    extension,
    fileAttachmentId,
    sessionId: input.sessionId,
  });

  let didWriteFile = false;

  try {
    const sizeBytes = await writeUploadedFile(storageKey, input.fileBuffer);
    didWriteFile = true;
    validateFileSize(sizeBytes);

    const result = await prisma.$transaction(async (tx) => {
      const participant = await tx.participant.findUniqueOrThrow({
        where: { id: input.participantId },
      });
      const message = await tx.message.create({
        data: {
          sessionId: input.sessionId,
          participantId: input.participantId,
          role: participant.role,
          kind: MessageKind.FILE,
          content: originalName,
        },
      });
      const attachment = await tx.fileAttachment.create({
        data: {
          id: fileAttachmentId,
          sessionId: input.sessionId,
          participantId: input.participantId,
          messageId: message.id,
          originalName,
          mimeType,
          extension,
          sizeBytes,
          storageKey,
          downloadToken: generateDownloadToken(),
        },
      });

      return {
        attachment,
        message: {
          ...message,
          attachment,
        },
      };
    });

    return {
      attachment: mapFileAttachment(result.attachment),
      message: mapMessageWithAttachment(result.message),
    };
  } catch (error) {
    if (didWriteFile) {
      await removeUploadedFile(storageKey).catch(() => undefined);
    }

    throw error;
  }
}

export async function getFileAttachments(
  sessionId?: string,
): Promise<FileAttachmentDto[]> {
  const files = await prisma.fileAttachment.findMany({
    where: sessionId ? { sessionId } : undefined,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return files.map(mapFileAttachment);
}

export async function getFileAttachmentForDownload({
  fileAttachmentId,
  token,
}: {
  fileAttachmentId: string;
  token: string;
}): Promise<{
  filePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const attachment = await prisma.fileAttachment.findUnique({
    where: { id: fileAttachmentId },
  });

  if (!attachment || attachment.downloadToken !== token) {
    throw new AppError(
      "FILE_ATTACHMENT_NOT_FOUND",
      "Shared file was not found or the download token is invalid.",
      404,
      "SESSION_ERROR",
      { fileAttachmentId },
    );
  }

  return {
    filePath: resolveFileStoragePath(attachment.storageKey),
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
}
