import { io, type Socket } from "socket.io-client";

import type {
  ClientToServerEvents,
  RecordingUpdatePayload,
  ServerToClientEvents,
  SessionChatNewPayload,
  SessionChatSendPayload,
  SessionEndedPayload,
  SessionJoinedPayload,
  SessionLeavePayload,
  SessionLeftPayload,
  SessionJoinPayload,
  SocketAck,
  SocketErrorPayload,
  WebRtcAnswerPayload,
  WebRtcIceCandidatePayload,
  WebRtcOfferPayload,
  WebRtcSignalAckPayload,
} from "./types";

const DEFAULT_SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ?? "http://localhost:5000";
const DEFAULT_ACK_TIMEOUT_MS = 10_000;

export class WebRtcSignalingError extends Error {
  public readonly code: SocketErrorPayload["code"];
  public readonly details?: Record<string, unknown>;

  public constructor(error: SocketErrorPayload) {
    super(error.message);
    this.name = "WebRtcSignalingError";
    this.code = error.code;
    this.details = error.details;
  }
}

export interface WebRtcSignalingClientOptions {
  url?: string;
  ackTimeoutMs?: number;
  socket?: Socket<ServerToClientEvents, ClientToServerEvents>;
}

interface SocketDebugContext {
  sendEvent: "CHAT_SEND";
  ackEvent: "CHAT_ACK";
  sessionId: string;
  participantId: string;
  emittedPayload: SessionChatSendPayload;
}

function logSocketDebug(
  event: "CHAT_SEND" | "CHAT_ACK" | "CHAT_RECEIVED",
  details: Record<string, unknown>,
): void {
  console.info(
    JSON.stringify({
      event,
      ...details,
    }),
  );
}

export class WebRtcSignalingClient {
  private readonly ackTimeoutMs: number;
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;

  public constructor(options: WebRtcSignalingClientOptions = {}) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.socket =
      options.socket ??
      io(options.url ?? DEFAULT_SOCKET_URL, {
        autoConnect: false,
        transports: ["websocket", "polling"],
      });
  }

  public get id(): string | undefined {
    return this.socket.id;
  }

  public get connected(): boolean {
    return this.socket.connected;
  }

  public async connect(): Promise<void> {
    if (this.socket.connected) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while connecting to signaling server."));
      }, this.ackTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.socket.off("connect", handleConnect);
        this.socket.off("connect_error", handleConnectError);
      };

      const handleConnect = () => {
        cleanup();
        resolve();
      };

      const handleConnectError = (error: Error) => {
        cleanup();
        reject(error);
      };

      this.socket.once("connect", handleConnect);
      this.socket.once("connect_error", handleConnectError);
      this.socket.connect();
    });
  }

  public disconnect(): void {
    this.socket.disconnect();
  }

  public async joinSession(
    payload: SessionJoinPayload,
  ): Promise<SessionJoinedPayload> {
    return this.emitWithAck((ack) => {
      this.socket.emit("session:join", payload, ack);
    });
  }

  public async leaveSession(
    payload: SessionLeavePayload,
  ): Promise<SessionLeftPayload> {
    return this.emitWithAck((ack) => {
      this.socket.emit("session:leave", payload, ack);
    });
  }

  public async sendChatMessage(
    payload: SessionChatSendPayload,
  ): Promise<SessionChatNewPayload> {
    return this.emitWithAck(
      (ack) => {
        this.socket.emit("session:chat:send", payload, ack);
      },
      {
        sendEvent: "CHAT_SEND",
        ackEvent: "CHAT_ACK",
        sessionId: payload.sessionId,
        participantId: payload.participantId,
        emittedPayload: payload,
      },
    );
  }

  public async sendOffer(
    payload: WebRtcOfferPayload,
  ): Promise<WebRtcSignalAckPayload> {
    return this.emitWithAck((ack) => {
      this.socket.emit("webrtc:offer", payload, ack);
    });
  }

  public async sendAnswer(
    payload: WebRtcAnswerPayload,
  ): Promise<WebRtcSignalAckPayload> {
    return this.emitWithAck((ack) => {
      this.socket.emit("webrtc:answer", payload, ack);
    });
  }

  public async sendIceCandidate(
    payload: WebRtcIceCandidatePayload,
  ): Promise<WebRtcSignalAckPayload> {
    return this.emitWithAck((ack) => {
      this.socket.emit("webrtc:ice-candidate", payload, ack);
    });
  }

  public onOffer(handler: (payload: WebRtcOfferPayload) => void): () => void {
    this.socket.on("webrtc:offer", handler);
    return () => {
      this.socket.off("webrtc:offer", handler);
    };
  }

  public onAnswer(handler: (payload: WebRtcAnswerPayload) => void): () => void {
    this.socket.on("webrtc:answer", handler);
    return () => {
      this.socket.off("webrtc:answer", handler);
    };
  }

  public onIceCandidate(
    handler: (payload: WebRtcIceCandidatePayload) => void,
  ): () => void {
    this.socket.on("webrtc:ice-candidate", handler);
    return () => {
      this.socket.off("webrtc:ice-candidate", handler);
    };
  }

  public onSessionJoined(
    handler: (payload: SessionJoinedPayload) => void,
  ): () => void {
    this.socket.on("session:joined", handler);
    return () => {
      this.socket.off("session:joined", handler);
    };
  }

  public onSessionEnded(
    handler: (payload: SessionEndedPayload) => void,
  ): () => void {
    this.socket.on("session:ended", handler);
    return () => {
      this.socket.off("session:ended", handler);
    };
  }

  public onChatMessage(
    handler: (payload: SessionChatNewPayload) => void,
  ): () => void {
    const handleChatMessage = (payload: SessionChatNewPayload) => {
      logSocketDebug("CHAT_RECEIVED", {
        socketId: this.socket.id ?? null,
        sessionId: payload.sessionId,
        participantId: payload.message.participantId,
        receivedPayload: payload,
      });
      handler(payload);
    };

    this.socket.on("session:chat:new", handleChatMessage);
    return () => {
      this.socket.off("session:chat:new", handleChatMessage);
    };
  }

  public onRecordingUpdate(
    handler: (payload: RecordingUpdatePayload) => void,
  ): () => void {
    this.socket.on("recording:update", handler);
    return () => {
      this.socket.off("recording:update", handler);
    };
  }

  private async emitWithAck<TPayload>(
    emit: (ack: SocketAck<TPayload>) => void,
    debugContext?: SocketDebugContext,
  ): Promise<TPayload> {
    await this.connect();

    return new Promise<TPayload>((resolve, reject) => {
      let settled = false;

      if (debugContext) {
        logSocketDebug(debugContext.sendEvent, {
          socketId: this.socket.id ?? null,
          sessionId: debugContext.sessionId,
          participantId: debugContext.participantId,
          emittedPayload: debugContext.emittedPayload,
        });
      }

      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        const timeoutError = new Error(
          "Timed out waiting for signaling acknowledgement.",
        );

        if (debugContext) {
          logSocketDebug(debugContext.ackEvent, {
            socketId: this.socket.id ?? null,
            sessionId: debugContext.sessionId,
            participantId: debugContext.participantId,
            ackResponse: null,
            error: timeoutError.message,
          });
        }

        reject(timeoutError);
      }, this.ackTimeoutMs);

      emit((response) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);

        if (debugContext) {
          logSocketDebug(debugContext.ackEvent, {
            socketId: this.socket.id ?? null,
            sessionId: debugContext.sessionId,
            participantId: debugContext.participantId,
            ackResponse: response,
          });
        }

        if (response.ok) {
          resolve(response.data);
          return;
        }

        reject(new WebRtcSignalingError(response.error));
      });
    });
  }
}

export function createWebRtcSignalingClient(
  options?: WebRtcSignalingClientOptions,
): WebRtcSignalingClient {
  return new WebRtcSignalingClient(options);
}
