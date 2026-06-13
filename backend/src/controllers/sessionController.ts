import type { Request, Response } from "express";
import { RecordingStopReason } from "@prisma/client";

import {
  createSession as createSessionService,
  endSession as endSessionService,
  getSessionById as getSessionByIdService,
  getSessionInvite as getSessionInviteService,
  getSessionMessages as getSessionMessagesService,
  getSessions as getSessionsService,
  joinSession as joinSessionService,
} from "../services/sessionService.js";
import { broadcastSessionEnded } from "../sockets/sessionBroadcaster.js";
import { stopActiveRecordingForSession } from "../services/recordingService.js";
import {
  AppError,
  type ApiErrorResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type EndSessionRequest,
  type EndSessionResponse,
  type GetSessionResponse,
  type GetSessionMessagesResponse,
  type GetSessionInviteResponse,
  type GetSessionsResponse,
  type JoinSessionRequest,
  type JoinSessionResponse,
} from "../types/sessionTypes.js";

type EmptyParams = Record<string, never>;
type SessionIdParams = {
  sessionId: string;
};
type SessionTokenParams = {
  token: string;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
const MAX_ACTOR_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOptionalActorId(
  body: Record<string, unknown>,
  fieldName: "agentId" | "endedBy",
): string | undefined {
  const value = body[fieldName];

  if (value === undefined) {
    return undefined;
  }

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

  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.length > MAX_ACTOR_ID_LENGTH) {
    throw new AppError(
      "VALIDATION_INVALID_FIELD",
      `${fieldName} must be ${MAX_ACTOR_ID_LENGTH} characters or fewer.`,
      400,
      "VALIDATION_ERROR",
      { field: fieldName },
    );
  }

  return trimmed;
}

function validateSessionId(sessionId: unknown): string {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new AppError(
      "VALIDATION_INVALID_SESSION_ID",
      "A valid sessionId path parameter is required.",
      400,
      "VALIDATION_ERROR",
      { field: "sessionId" },
    );
  }

  return sessionId.trim();
}

function validateRequestBody(body: unknown): Record<string, unknown> {
  if (body === undefined) {
    return {};
  }

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

function validateCreateSessionRequest(body: unknown): CreateSessionRequest {
  const validatedBody = validateRequestBody(body);

  return {
    agentId: validateOptionalActorId(validatedBody, "agentId"),
  };
}

function validateToken(token: unknown): string {
  if (token === undefined) {
    throw new AppError(
      "VALIDATION_MISSING_FIELD",
      "token is required.",
      400,
      "VALIDATION_ERROR",
      { field: "token" },
    );
  }

  if (typeof token !== "string") {
    throw new AppError(
      "VALIDATION_INVALID_TOKEN",
      "token must be a string.",
      400,
      "VALIDATION_ERROR",
      { field: "token" },
    );
  }

  const normalizedToken = token.trim();

  if (!TOKEN_PATTERN.test(normalizedToken)) {
    throw new AppError(
      "VALIDATION_INVALID_TOKEN",
      "token format is invalid.",
      400,
      "VALIDATION_ERROR",
      { field: "token" },
    );
  }

  return normalizedToken;
}

function validateJoinSessionRequest(body: unknown): JoinSessionRequest {
  const validatedBody = validateRequestBody(body);

  return {
    token: validateToken(validatedBody.token),
  };
}

function validateEndSessionRequest(body: unknown): EndSessionRequest {
  const validatedBody = validateRequestBody(body);

  return {
    endedBy: validateOptionalActorId(validatedBody, "endedBy"),
  };
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
      event: "session.request_failed",
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

export async function createSession(
  req: Request<EmptyParams, CreateSessionResponse | ApiErrorResponse, unknown>,
  res: Response<CreateSessionResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const input = validateCreateSessionRequest(req.body);
    const session = await createSessionService(input);

    res.status(201).json({ session });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function joinSession(
  req: Request<EmptyParams, JoinSessionResponse | ApiErrorResponse, unknown>,
  res: Response<JoinSessionResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const input = validateJoinSessionRequest(req.body);
    const result = await joinSessionService(input);

    res.status(200).json(result);
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function getSessionInvite(
  req: Request<SessionTokenParams, GetSessionInviteResponse | ApiErrorResponse>,
  res: Response<GetSessionInviteResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const token = validateToken(req.params.token);
    const session = await getSessionInviteService(token);

    res.status(200).json({ session });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function endSession(
  req: Request<SessionIdParams, EndSessionResponse | ApiErrorResponse, unknown>,
  res: Response<EndSessionResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const sessionId = validateSessionId(req.params.sessionId);
    const input = validateEndSessionRequest(req.body);
    const session = await endSessionService(sessionId, input);

    await stopActiveRecordingForSession(
      sessionId,
      RecordingStopReason.SESSION_ENDED,
    );
    broadcastSessionEnded(session);
    res.status(200).json({ session });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function getSessions(
  _req: Request<EmptyParams, GetSessionsResponse | ApiErrorResponse>,
  res: Response<GetSessionsResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const sessions = await getSessionsService();

    res.status(200).json({ sessions });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function getSessionById(
  req: Request<SessionIdParams, GetSessionResponse | ApiErrorResponse>,
  res: Response<GetSessionResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const sessionId = validateSessionId(req.params.sessionId);
    const session = await getSessionByIdService(sessionId);

    res.status(200).json({ session });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}

export async function getSessionMessages(
  req: Request<SessionIdParams, GetSessionMessagesResponse | ApiErrorResponse>,
  res: Response<GetSessionMessagesResponse | ApiErrorResponse>,
): Promise<void> {
  try {
    const sessionId = validateSessionId(req.params.sessionId);
    const messages = await getSessionMessagesService(sessionId);

    res.status(200).json({ messages });
  } catch (error) {
    sendErrorResponse(res, error);
  }
}
