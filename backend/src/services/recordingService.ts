import {
  ParticipantRole,
  RecordingStatus,
  RecordingStopReason,
  SessionStatus,
  type Recording,
} from "@prisma/client";
import { randomBytes } from "node:crypto";

import { prisma } from "../config/prisma.js";
import { broadcastRecordingUpdated } from "../sockets/sessionBroadcaster.js";
import { AppError, type RecordingDto } from "../types/sessionTypes.js";
import {
  finalizeRecordingStorage,
  resolveRecordingStoragePath,
  writeRecordingChunk,
} from "./recordingStorage.js";

const DOWNLOAD_TOKEN_BYTE_LENGTH = 32;
const PROCESSING_DELAY_MS = 1_500;
const MAX_FAILURE_REASON_LENGTH = 500;
const processingTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface StartRecordingInput {
  sessionId: string;
  participantId: string;
  mimeType: string;
}

function toIsoStringOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function mapRecording(recording: Recording): RecordingDto {
  return {
    id: recording.id,
    sessionId: recording.sessionId,
    startedByParticipantId: recording.startedByParticipantId,
    status: recording.status,
    stopReason: recording.stopReason,
    mimeType: recording.mimeType,
    startedAt: recording.startedAt.toISOString(),
    stoppedAt: toIsoStringOrNull(recording.stoppedAt),
    readyAt: toIsoStringOrNull(recording.readyAt),
    durationMs: recording.durationMs,
    sizeBytes: recording.sizeBytes,
    downloadUrl:
      recording.status === RecordingStatus.READY
        ? `/api/recordings/${encodeURIComponent(recording.id)}/download?token=${encodeURIComponent(recording.downloadToken)}`
        : null,
    failureReason: recording.failureReason,
    createdAt: recording.createdAt.toISOString(),
    updatedAt: recording.updatedAt.toISOString(),
  };
}

function getSafeFailureReason(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "Recording processing failed.";

  return message.slice(0, MAX_FAILURE_REASON_LENGTH);
}

async function assertAgentParticipant(
  sessionId: string,
  participantId: string,
  allowEndedSession = false,
): Promise<void> {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    include: { session: true },
  });

  if (
    !participant ||
    participant.sessionId !== sessionId ||
    participant.role !== ParticipantRole.AGENT ||
    (!allowEndedSession && participant.leftAt !== null)
  ) {
    throw new AppError(
      "AUTH_FORBIDDEN",
      "Only the active agent participant can control recording.",
      403,
      "AUTHORIZATION_ERROR",
      { sessionId, participantId },
    );
  }

  if (
    !allowEndedSession &&
    participant.session.status === SessionStatus.ENDED
  ) {
    throw new AppError(
      "SESSION_ALREADY_ENDED",
      "Ended sessions cannot start or control recording.",
      409,
      "SESSION_ERROR",
      { sessionId },
    );
  }
}

async function processRecording(recordingId: string): Promise<void> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
  });

  if (!recording || recording.status !== RecordingStatus.PROCESSING) {
    return;
  }

  try {
    const stored = await finalizeRecordingStorage(recording.id);
    const stoppedAt = recording.stoppedAt ?? new Date();
    const ready = await prisma.recording.update({
      where: { id: recording.id },
      data: {
        status: RecordingStatus.READY,
        readyAt: new Date(),
        stoppedAt,
        durationMs: Math.max(
          0,
          stoppedAt.getTime() - recording.startedAt.getTime(),
        ),
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
        failureReason: null,
      },
    });

    broadcastRecordingUpdated(mapRecording(ready));
  } catch (error) {
    const failed = await prisma.recording.update({
      where: { id: recording.id },
      data: {
        status: RecordingStatus.FAILED,
        stoppedAt: recording.stoppedAt ?? new Date(),
        failureReason: getSafeFailureReason(error),
      },
    });

    broadcastRecordingUpdated(mapRecording(failed));
  }
}

function scheduleRecordingProcessing(recordingId: string): void {
  const existingTimer = processingTimers.get(recordingId);

  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    processingTimers.delete(recordingId);
    void processRecording(recordingId);
  }, PROCESSING_DELAY_MS);

  timer.unref?.();
  processingTimers.set(recordingId, timer);
}

async function requestStopRecordingInternal(
  recording: Recording,
  stopReason: RecordingStopReason,
): Promise<RecordingDto> {
  if (
    recording.status === RecordingStatus.READY ||
    recording.status === RecordingStatus.FAILED
  ) {
    return mapRecording(recording);
  }

  const processing =
    recording.status === RecordingStatus.PROCESSING
      ? recording
      : await prisma.recording.update({
          where: { id: recording.id },
          data: {
            status: RecordingStatus.PROCESSING,
            stopReason,
            stoppedAt: new Date(),
          },
        });

  const dto = mapRecording(processing);
  broadcastRecordingUpdated(dto);
  scheduleRecordingProcessing(recording.id);
  return dto;
}

export async function startRecording(
  input: StartRecordingInput,
): Promise<RecordingDto> {
  await assertAgentParticipant(input.sessionId, input.participantId);

  const activeRecording = await prisma.recording.findFirst({
    where: {
      sessionId: input.sessionId,
      status: RecordingStatus.RECORDING,
    },
  });

  if (activeRecording) {
    throw new AppError(
      "RECORDING_ALREADY_ACTIVE",
      "This session already has an active recording.",
      409,
      "BUSINESS_RULE_VIOLATION",
      { recordingId: activeRecording.id, sessionId: input.sessionId },
    );
  }

  const recording = await prisma.recording.create({
    data: {
      sessionId: input.sessionId,
      startedByParticipantId: input.participantId,
      status: RecordingStatus.RECORDING,
      mimeType: input.mimeType,
      downloadToken: randomBytes(DOWNLOAD_TOKEN_BYTE_LENGTH).toString(
        "base64url",
      ),
    },
  });
  const dto = mapRecording(recording);

  broadcastRecordingUpdated(dto);
  return dto;
}

export async function uploadRecordingChunk(
  recordingId: string,
  participantId: string,
  sequence: number,
  chunk: Buffer,
): Promise<RecordingDto> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
  });

  if (!recording) {
    throw new AppError(
      "RECORDING_NOT_FOUND",
      "Recording was not found.",
      404,
      "SESSION_ERROR",
      { recordingId },
    );
  }

  await assertAgentParticipant(recording.sessionId, participantId, true);

  if (
    recording.status !== RecordingStatus.RECORDING &&
    recording.status !== RecordingStatus.PROCESSING
  ) {
    throw new AppError(
      "RECORDING_INVALID_STATE",
      "Recording no longer accepts media chunks.",
      409,
      "BUSINESS_RULE_VIOLATION",
      { recordingId, status: recording.status },
    );
  }

  try {
    await writeRecordingChunk(recording.id, sequence, chunk);
  } catch (error) {
    throw new AppError(
      "RECORDING_STORAGE_ERROR",
      "Unable to persist recording media.",
      500,
      "BUSINESS_RULE_VIOLATION",
      {
        recordingId,
        message: getSafeFailureReason(error),
      },
    );
  }

  if (recording.status === RecordingStatus.PROCESSING) {
    scheduleRecordingProcessing(recording.id);
  }

  return mapRecording(recording);
}

export async function stopRecording(
  recordingId: string,
  participantId: string,
): Promise<RecordingDto> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
  });

  if (!recording) {
    throw new AppError(
      "RECORDING_NOT_FOUND",
      "Recording was not found.",
      404,
      "SESSION_ERROR",
      { recordingId },
    );
  }

  await assertAgentParticipant(recording.sessionId, participantId);
  return requestStopRecordingInternal(recording, RecordingStopReason.AGENT);
}

export async function stopActiveRecordingForSession(
  sessionId: string,
  stopReason: RecordingStopReason,
): Promise<RecordingDto | null> {
  const recording = await prisma.recording.findFirst({
    where: {
      sessionId,
      status: RecordingStatus.RECORDING,
    },
    orderBy: { startedAt: "desc" },
  });

  return recording
    ? requestStopRecordingInternal(recording, stopReason)
    : null;
}

export async function getRecordings(
  sessionId?: string,
): Promise<RecordingDto[]> {
  const recordings = await prisma.recording.findMany({
    where: sessionId ? { sessionId } : undefined,
    orderBy: { createdAt: "desc" },
  });

  return recordings.map(mapRecording);
}

export async function getRecordingDownload(
  recordingId: string,
  downloadToken: string,
): Promise<{ filePath: string; recording: RecordingDto }> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
  });

  if (
    !recording ||
    recording.downloadToken !== downloadToken ||
    recording.status !== RecordingStatus.READY ||
    !recording.storageKey
  ) {
    throw new AppError(
      "RECORDING_NOT_FOUND",
      "Ready recording was not found.",
      404,
      "SESSION_ERROR",
      { recordingId },
    );
  }

  return {
    filePath: resolveRecordingStoragePath(recording.storageKey),
    recording: mapRecording(recording),
  };
}

export async function recoverInterruptedRecordings(): Promise<void> {
  const interrupted = await prisma.recording.findMany({
    where: {
      status: {
        in: [RecordingStatus.RECORDING, RecordingStatus.PROCESSING],
      },
    },
  });

  for (const recording of interrupted) {
    const processing =
      recording.status === RecordingStatus.PROCESSING
        ? recording
        : await prisma.recording.update({
            where: { id: recording.id },
            data: {
              status: RecordingStatus.PROCESSING,
              stopReason: RecordingStopReason.RECOVERY,
              stoppedAt: new Date(),
            },
          });

    broadcastRecordingUpdated(mapRecording(processing));
    scheduleRecordingProcessing(processing.id);
  }
}
