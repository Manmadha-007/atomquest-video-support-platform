import type { ParticipantRole } from "../types/session";

export type ParticipantPresenceStatus = "online" | "reconnecting" | "offline";

export interface ActiveSessionParticipant {
  sessionId: string;
  participantId: string;
  role: ParticipantRole;
  activeSocketId: string | null;
  status: ParticipantPresenceStatus;
  connectionVersion: number;
  joinedAt: string;
  lastSeenAt: string;
  disconnectDeadline: string | null;
  transport: string;
}

export interface SessionJoinPayload {
  sessionId: string;
  participantId: string;
  role: ParticipantRole;
}

export interface SessionJoinedPayload {
  sessionId: string;
  room: string;
  participant: ActiveSessionParticipant;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
  joinedAt: string;
}

export type WebRtcSignalEvent =
  | "webrtc:offer"
  | "webrtc:answer"
  | "webrtc:ice-candidate";

export interface WebRtcSignalBasePayload {
  sessionId: string;
  participantId: string;
  targetParticipantId: string;
  messageId?: string;
  sentAt?: string;
}

export interface WebRtcSessionDescription {
  type: "offer" | "answer";
  sdp: string;
}

export interface WebRtcIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface WebRtcOfferPayload extends WebRtcSignalBasePayload {
  description: WebRtcSessionDescription & {
    type: "offer";
  };
}

export interface WebRtcAnswerPayload extends WebRtcSignalBasePayload {
  description: WebRtcSessionDescription & {
    type: "answer";
  };
}

export interface WebRtcIceCandidatePayload extends WebRtcSignalBasePayload {
  candidate: WebRtcIceCandidate | null;
}

export interface WebRtcSignalAckPayload {
  event: WebRtcSignalEvent;
  sessionId: string;
  participantId: string;
  targetParticipantId: string;
  messageId: string;
  routedAt: string;
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
  "webrtc:offer": (payload: WebRtcOfferPayload) => void;
  "webrtc:answer": (payload: WebRtcAnswerPayload) => void;
  "webrtc:ice-candidate": (payload: WebRtcIceCandidatePayload) => void;
}
