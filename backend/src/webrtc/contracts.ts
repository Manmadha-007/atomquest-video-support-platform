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
