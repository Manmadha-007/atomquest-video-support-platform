import { WebRtcSignalingClient } from "./signalingClient";
import type {
  WebRtcAnswerPayload,
  WebRtcIceCandidate,
  WebRtcIceCandidatePayload,
  WebRtcOfferPayload,
  WebRtcSessionDescription,
  WebRtcSignalBasePayload,
} from "./types";

const INTERNAL_DATA_CHANNEL_LABEL = "atomquest-webrtc-connection";
const DEFAULT_CONNECTED_TIMEOUT_MS = 15_000;

export interface CallMediaState {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
}

export interface AtomQuestPeerConnectionOptions {
  signalingClient: WebRtcSignalingClient;
  sessionId: string;
  participantId: string;
  targetParticipantId: string;
  rtcConfiguration?: RTCConfiguration;
  onBeforeAnswer?: (peerConnection: RTCPeerConnection) => Promise<void> | void;
  onError?: (error: Error) => void;
  onRemoteTrack?: (
    event: RTCTrackEvent,
    peerConnection: RTCPeerConnection,
  ) => void;
  onRemoteMediaState?: (state: CallMediaState) => void;
}

export type ConnectionStateListener = (
  state: RTCPeerConnectionState,
) => void;

export class AtomQuestPeerConnectionService {
  private readonly options: AtomQuestPeerConnectionOptions;
  private readonly connectionStateListeners = new Set<ConnectionStateListener>();
  private readonly unsubscribeSignalingHandlers: Array<() => void> = [];
  private pendingRemoteCandidates: Array<WebRtcIceCandidate | null> = [];
  private peerConnection: RTCPeerConnection | null = null;
  private internalDataChannel: RTCDataChannel | null = null;
  private pendingLocalMediaState: CallMediaState | null = null;
  private connectionState: RTCPeerConnectionState = "new";
  private isStarted = false;

  public constructor(options: AtomQuestPeerConnectionOptions) {
    this.options = options;
  }

  public start(): RTCPeerConnection {
    const peerConnection = this.ensurePeerConnection();

    if (!this.isStarted) {
      this.unsubscribeSignalingHandlers.push(
        this.options.signalingClient.onOffer((payload) => {
          void this.handleOffer(payload).catch((error: unknown) => {
            this.reportError(error);
          });
        }),
        this.options.signalingClient.onAnswer((payload) => {
          void this.handleAnswer(payload).catch((error: unknown) => {
            this.reportError(error);
          });
        }),
        this.options.signalingClient.onIceCandidate((payload) => {
          void this.handleRemoteIceCandidate(payload).catch((error: unknown) => {
            this.reportError(error);
          });
        }),
      );
      this.isStarted = true;
    }

    return peerConnection;
  }

  public async createAndSendOffer(): Promise<WebRtcSessionDescription> {
    const peerConnection = this.start();

    this.ensureInternalDataChannel(peerConnection);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const localDescription = this.getLocalDescription(peerConnection, "offer");

    await this.options.signalingClient.sendOffer({
      ...this.createBaseSignalPayload(),
      description: {
        ...localDescription,
        type: "offer",
      },
    });

    return localDescription;
  }

  public getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection;
  }

  public getConnectionState(): RTCPeerConnectionState {
    return this.peerConnection?.connectionState ?? this.connectionState;
  }

  public sendMediaState(state: CallMediaState): void {
    this.pendingLocalMediaState = state;
    this.flushPendingMediaState();
  }

  public onConnectionStateChange(
    listener: ConnectionStateListener,
  ): () => void {
    this.connectionStateListeners.add(listener);
    listener(this.getConnectionState());

    return () => {
      this.connectionStateListeners.delete(listener);
    };
  }

  public async waitUntilConnected(
    timeoutMs = DEFAULT_CONNECTED_TIMEOUT_MS,
  ): Promise<void> {
    if (this.getConnectionState() === "connected") {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out waiting for RTCPeerConnection to become connected after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.connectionStateListeners.delete(handleStateChange);
      };

      const handleStateChange = (state: RTCPeerConnectionState) => {
        if (state === "connected") {
          cleanup();
          resolve();
          return;
        }

        if (state === "failed" || state === "closed") {
          cleanup();
          reject(
            new Error(`RTCPeerConnection entered terminal state: ${state}.`),
          );
        }
      };

      this.connectionStateListeners.add(handleStateChange);
      handleStateChange(this.getConnectionState());
    });
  }

  public close(): void {
    for (const unsubscribe of this.unsubscribeSignalingHandlers.splice(0)) {
      unsubscribe();
    }

    this.internalDataChannel?.close();
    this.internalDataChannel = null;
    this.pendingLocalMediaState = null;
    this.pendingRemoteCandidates = [];
    this.isStarted = false;

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.updateConnectionState("closed");
  }

  private ensurePeerConnection(): RTCPeerConnection {
    if (this.peerConnection) {
      return this.peerConnection;
    }

    const peerConnection = new RTCPeerConnection(
      this.options.rtcConfiguration,
    );

    peerConnection.onconnectionstatechange = () => {
      this.updateConnectionState(peerConnection.connectionState);
    };
    peerConnection.onicecandidate = (event) => {
      void this.sendIceCandidate(event.candidate).catch((error: unknown) => {
        this.reportError(error);
      });
    };
    peerConnection.ondatachannel = (event) => {
      this.bindInternalDataChannel(event.channel);
    };
    peerConnection.ontrack = (event) => {
      this.options.onRemoteTrack?.(event, peerConnection);
    };

    this.peerConnection = peerConnection;
    this.updateConnectionState(peerConnection.connectionState);

    return peerConnection;
  }

  private ensureInternalDataChannel(
    peerConnection: RTCPeerConnection,
  ): RTCDataChannel {
    if (this.internalDataChannel) {
      return this.internalDataChannel;
    }

    const dataChannel = peerConnection.createDataChannel(
      INTERNAL_DATA_CHANNEL_LABEL,
      {
        ordered: true,
      },
    );
    this.bindInternalDataChannel(dataChannel);

    return dataChannel;
  }

  private bindInternalDataChannel(dataChannel: RTCDataChannel): void {
    if (dataChannel.label !== INTERNAL_DATA_CHANNEL_LABEL) {
      dataChannel.close();
      return;
    }

    this.internalDataChannel = dataChannel;
    dataChannel.onopen = () => {
      this.flushPendingMediaState();
    };
    dataChannel.onmessage = (event) => {
      const mediaState = parseMediaStateMessage(event.data);

      if (mediaState) {
        this.options.onRemoteMediaState?.(mediaState);
      }
    };

    this.flushPendingMediaState();
  }

  private flushPendingMediaState(): void {
    if (
      !this.pendingLocalMediaState ||
      this.internalDataChannel?.readyState !== "open"
    ) {
      return;
    }

    this.internalDataChannel.send(
      JSON.stringify({
        type: "media-state",
        ...this.pendingLocalMediaState,
      }),
    );
  }

  private async handleOffer(payload: WebRtcOfferPayload): Promise<void> {
    if (!this.isInboundForThisPeer(payload)) {
      return;
    }

    const peerConnection = this.start();

    await peerConnection.setRemoteDescription(
      toRtcSessionDescription(payload.description),
    );
    await this.options.onBeforeAnswer?.(peerConnection);
    await this.flushPendingRemoteCandidates(peerConnection);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    const localDescription = this.getLocalDescription(peerConnection, "answer");

    await this.options.signalingClient.sendAnswer({
      ...this.createBaseSignalPayload(),
      description: {
        ...localDescription,
        type: "answer",
      },
    });
  }

  private async handleAnswer(payload: WebRtcAnswerPayload): Promise<void> {
    if (!this.isInboundForThisPeer(payload)) {
      return;
    }

    const peerConnection = this.start();

    await peerConnection.setRemoteDescription(
      toRtcSessionDescription(payload.description),
    );
    await this.flushPendingRemoteCandidates(peerConnection);
  }

  private async handleRemoteIceCandidate(
    payload: WebRtcIceCandidatePayload,
  ): Promise<void> {
    if (!this.isInboundForThisPeer(payload)) {
      return;
    }

    const peerConnection = this.start();

    if (!peerConnection.remoteDescription) {
      this.pendingRemoteCandidates.push(payload.candidate);
      return;
    }

    await addIceCandidate(peerConnection, payload.candidate);
  }

  private async flushPendingRemoteCandidates(
    peerConnection: RTCPeerConnection,
  ): Promise<void> {
    const candidates = this.pendingRemoteCandidates.splice(0);

    for (const candidate of candidates) {
      await addIceCandidate(peerConnection, candidate);
    }
  }

  private async sendIceCandidate(
    candidate: RTCIceCandidate | null,
  ): Promise<void> {
    const payload: WebRtcIceCandidatePayload = {
      ...this.createBaseSignalPayload(),
      candidate: toWebRtcIceCandidate(candidate),
    };

    await this.options.signalingClient.sendIceCandidate(payload);
  }

  private createBaseSignalPayload(): WebRtcSignalBasePayload {
    return {
      sessionId: this.options.sessionId,
      participantId: this.options.participantId,
      targetParticipantId: this.options.targetParticipantId,
      sentAt: new Date().toISOString(),
    };
  }

  private isInboundForThisPeer(payload: WebRtcSignalBasePayload): boolean {
    return (
      payload.sessionId === this.options.sessionId &&
      payload.participantId === this.options.targetParticipantId &&
      payload.targetParticipantId === this.options.participantId
    );
  }

  private getLocalDescription(
    peerConnection: RTCPeerConnection,
    expectedType: WebRtcSessionDescription["type"],
  ): WebRtcSessionDescription {
    const localDescription = peerConnection.localDescription;

    if (!localDescription) {
      throw new Error("RTCPeerConnection localDescription is not available.");
    }

    if (localDescription.type !== expectedType) {
      throw new Error(
        `Expected localDescription.type to be ${expectedType}, received ${localDescription.type}.`,
      );
    }

    if (!localDescription.sdp) {
      throw new Error("RTCPeerConnection localDescription.sdp is empty.");
    }

    return {
      type: expectedType,
      sdp: localDescription.sdp,
    };
  }

  private updateConnectionState(state: RTCPeerConnectionState): void {
    if (this.connectionState === state) {
      return;
    }

    this.connectionState = state;

    for (const listener of this.connectionStateListeners) {
      listener(state);
    }
  }

  private reportError(error: unknown): void {
    const normalizedError =
      error instanceof Error ? error : new Error("Unknown WebRTC error.");

    this.options.onError?.(normalizedError);
  }
}

function parseMediaStateMessage(value: unknown): CallMediaState | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const message = JSON.parse(value) as Record<string, unknown>;

    if (
      message.type !== "media-state" ||
      typeof message.cameraEnabled !== "boolean" ||
      typeof message.microphoneEnabled !== "boolean"
    ) {
      return null;
    }

    return {
      cameraEnabled: message.cameraEnabled,
      microphoneEnabled: message.microphoneEnabled,
    };
  } catch {
    return null;
  }
}

function toRtcSessionDescription(
  description: WebRtcSessionDescription,
): RTCSessionDescriptionInit {
  return {
    type: description.type,
    sdp: description.sdp,
  };
}

function toWebRtcIceCandidate(
  candidate: RTCIceCandidate | null,
): WebRtcIceCandidate | null {
  if (!candidate) {
    return null;
  }

  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

async function addIceCandidate(
  peerConnection: RTCPeerConnection,
  candidate: WebRtcIceCandidate | null,
): Promise<void> {
  if (candidate === null) {
    await peerConnection.addIceCandidate();
    return;
  }

  await peerConnection.addIceCandidate(candidate);
}
