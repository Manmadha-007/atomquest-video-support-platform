import type { Participant } from "@prisma/client";
import type { Server, Socket } from "socket.io";
import type {
  MessageDto,
  RecordingDto,
  SessionDetailsDto,
} from "../types/sessionTypes.js";
import type {
  WebRtcAnswerPayload,
  WebRtcIceCandidatePayload,
  WebRtcOfferPayload,
  WebRtcSignalAckPayload,
} from "../webrtc/contracts.js";

export type SocketParticipantRole = Participant["role"];

export interface SessionJoinPayload {
  sessionId: string;
  participantId: string;
  role: SocketParticipantRole;
}

export interface SessionLeavePayload {
  sessionId: string;
  participantId?: string;
}

export interface SessionChatSendPayload {
  sessionId: string;
  participantId: string;
  content: string;
}

export interface SessionChatNewPayload {
  sessionId: string;
  room: string;
  message: MessageDto;
}

export interface RecordingUpdatePayload {
  sessionId: string;
  room: string;
  recording: RecordingDto;
}

export type ParticipantPresenceStatus = "online" | "reconnecting" | "offline";

export interface ActiveSessionParticipant {
  sessionId: string;
  participantId: string;
  role: SocketParticipantRole;
  activeSocketId: string | null;
  status: ParticipantPresenceStatus;
  connectionVersion: number;
  joinedAt: string;
  lastSeenAt: string;
  disconnectDeadline: string | null;
  transport: string;
}

export type ParticipantUpdateAction =
  | "joined"
  | "reconnected"
  | "replaced"
  | "reconnecting"
  | "left"
  | "offline";

export type ParticipantLeaveReason =
  | "client_leave"
  | "disconnect"
  | "socket_replaced"
  | "grace_expired";

export interface SessionJoinedPayload {
  sessionId: string;
  room: string;
  participant: ActiveSessionParticipant;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
  joinedAt: string;
}

export interface SessionLeftPayload {
  sessionId: string;
  room: string;
  participant: ActiveSessionParticipant;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
  leftAt: string;
  reason: ParticipantLeaveReason;
}

export interface ParticipantUpdatePayload {
  sessionId: string;
  room: string;
  action: ParticipantUpdateAction;
  participant: ActiveSessionParticipant;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
  occurredAt: string;
  reason?: ParticipantLeaveReason;
}

export interface SessionEndedPayload {
  sessionId: string;
  room: string;
  session: SessionDetailsDto;
  endedAt: string;
  endedBy: string;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
}

export type SocketErrorCode =
  | "VALIDATION_ERROR"
  | "SESSION_NOT_FOUND"
  | "SESSION_ENDED"
  | "PARTICIPANT_NOT_FOUND"
  | "PARTICIPANT_SESSION_MISMATCH"
  | "PARTICIPANT_LEFT"
  | "ROLE_MISMATCH"
  | "TARGET_NOT_AVAILABLE"
  | "AUTH_FORBIDDEN"
  | "PERSISTENCE_ERROR"
  | "INTERNAL_ERROR";

export interface SocketErrorPayload {
  code: SocketErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type SocketAckResponse<TPayload> =
  | {
      ok: true;
      data: TPayload;
    }
  | {
      ok: false;
      error: SocketErrorPayload;
    };

export type SocketAck<TPayload> = (
  response: SocketAckResponse<TPayload>,
) => void;

export interface ClientToServerEvents {
  "session:join": (
    payload: SessionJoinPayload,
    ack?: SocketAck<SessionJoinedPayload>,
  ) => void;
  "session:leave": (
    payload: SessionLeavePayload,
    ack?: SocketAck<SessionLeftPayload>,
  ) => void;
  "session:chat:send": (
    payload: SessionChatSendPayload,
    ack?: SocketAck<SessionChatNewPayload>,
  ) => void;
  "webrtc:offer": (
    payload: WebRtcOfferPayload,
    ack?: SocketAck<WebRtcSignalAckPayload>,
  ) => void;
  "webrtc:answer": (
    payload: WebRtcAnswerPayload,
    ack?: SocketAck<WebRtcSignalAckPayload>,
  ) => void;
  "webrtc:ice-candidate": (
    payload: WebRtcIceCandidatePayload,
    ack?: SocketAck<WebRtcSignalAckPayload>,
  ) => void;
}

export interface ServerToClientEvents {
  "session:joined": (payload: SessionJoinedPayload) => void;
  "session:left": (payload: SessionLeftPayload) => void;
  "session:ended": (payload: SessionEndedPayload) => void;
  "session:chat:new": (payload: SessionChatNewPayload) => void;
  "recording:update": (payload: RecordingUpdatePayload) => void;
  "participant:update": (payload: ParticipantUpdatePayload) => void;
  "webrtc:offer": (payload: WebRtcOfferPayload) => void;
  "webrtc:answer": (payload: WebRtcAnswerPayload) => void;
  "webrtc:ice-candidate": (payload: WebRtcIceCandidatePayload) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  activeSessions: Record<string, ActiveSessionParticipant>;
}

export type SocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type SessionSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
