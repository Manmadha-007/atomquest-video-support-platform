import {
  AlertCircle,
  Loader2,
  Phone,
  PhoneOff,
  Radio,
  UserRound,
  Video,
  Wifi,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import type { ParticipantRole } from "../types/session";
import {
  addLocalTracksToPeerConnection,
  addRemoteTrackToStream,
  AtomQuestPeerConnectionService,
  createWebRtcSignalingClient,
  requestCameraMicrophone,
  stopMediaStream,
  type WebRtcSignalingClient,
} from "../webrtc";

type CallStatus = "idle" | "starting" | "ready" | "calling" | "connected" | "ended" | "error";

interface CallConfig {
  sessionId: string;
  participantId: string;
  targetParticipantId: string;
  role: ParticipantRole | null;
  isInitiator: boolean;
  isValid: boolean;
}

const connectionClasses: Record<RTCPeerConnectionState, string> = {
  new: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300",
  connecting:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  connected:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  disconnected:
    "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200",
  failed:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200",
  closed:
    "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function normalizeParam(value: string | null): string {
  return value?.trim() ?? "";
}

function parseRole(value: string | null): ParticipantRole | null {
  if (value === "AGENT" || value === "CUSTOMER") {
    return value;
  }

  return null;
}

function parseInitiator(value: string | null, role: ParticipantRole | null): boolean {
  if (value !== null) {
    return value === "true" || value === "1";
  }

  return role === "AGENT";
}

function shortId(value: string): string {
  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-5)}`;
}

async function attachStreamToVideo(
  videoElement: HTMLVideoElement | null,
  stream: MediaStream,
): Promise<void> {
  if (!videoElement) {
    return;
  }

  if (videoElement.srcObject !== stream) {
    videoElement.srcObject = stream;
  }

  try {
    await videoElement.play();
  } catch {
    // Browsers can defer autoplay with audio until the user interacts again.
  }
}

function StatusPill({
  children,
  icon,
  state,
}: {
  children: ReactNode;
  icon: ReactNode;
  state: RTCPeerConnectionState;
}) {
  return (
    <span
      className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${connectionClasses[state]}`}
    >
      {icon}
      {children}
    </span>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex size-9 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        <p className="truncate font-mono text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          {value}
        </p>
      </div>
    </div>
  );
}

function VideoPane({
  isMuted,
  label,
  trackCount,
  videoRef,
}: {
  isMuted?: boolean;
  label: string;
  trackCount: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:shadow-black/20">
      <div className="relative aspect-video w-full">
        <video
          autoPlay
          className="h-full w-full bg-zinc-950 object-cover"
          muted={isMuted}
          playsInline
          ref={videoRef}
        />
        {trackCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 text-zinc-500">
            <Video className="size-10" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-zinc-950 px-4 py-3 text-white">
        <span className="text-sm font-semibold">{label}</span>
        <span className="font-mono text-xs text-zinc-400">
          {trackCount} tracks
        </span>
      </div>
    </section>
  );
}

export default function VideoCallPage() {
  const [searchParams] = useSearchParams();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const signalingClientRef = useRef<WebRtcSignalingClient | null>(null);
  const peerServiceRef = useRef<AtomQuestPeerConnectionService | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localMediaPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const unsubscribeConnectionStateRef = useRef<(() => void) | null>(null);

  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Idle");
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>("new");
  const [iceConnectionState, setIceConnectionState] =
    useState<RTCIceConnectionState>("new");
  const [iceGatheringState, setIceGatheringState] =
    useState<RTCIceGatheringState>("new");
  const [localTrackCount, setLocalTrackCount] = useState(0);
  const [remoteTrackCount, setRemoteTrackCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const callConfig = useMemo<CallConfig>(() => {
    const role = parseRole(searchParams.get("role"));
    const sessionId = normalizeParam(searchParams.get("sessionId"));
    const participantId = normalizeParam(searchParams.get("participantId"));
    const targetParticipantId = normalizeParam(
      searchParams.get("targetParticipantId"),
    );

    return {
      sessionId,
      participantId,
      targetParticipantId,
      role,
      isInitiator: parseInitiator(searchParams.get("initiator"), role),
      isValid:
        sessionId.length > 0 &&
        participantId.length > 0 &&
        targetParticipantId.length > 0 &&
        role !== null,
    };
  }, [searchParams]);

  const releaseCallResources = useCallback((resetState: boolean) => {
    unsubscribeConnectionStateRef.current?.();
    unsubscribeConnectionStateRef.current = null;
    peerServiceRef.current?.close();
    peerServiceRef.current = null;
    peerConnectionRef.current = null;
    signalingClientRef.current?.disconnect();
    signalingClientRef.current = null;
    stopMediaStream(localStreamRef.current);
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    localMediaPromiseRef.current = null;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (resetState) {
      setConnectionState("closed");
      setIceConnectionState("closed");
      setIceGatheringState("complete");
      setLocalTrackCount(0);
      setRemoteTrackCount(0);
      setStatusMessage("Ended");
      setCallStatus("ended");
    }
  }, []);

  const ensureLocalMedia = useCallback(
    async (peerConnection?: RTCPeerConnection): Promise<MediaStream> => {
      if (!localMediaPromiseRef.current) {
        setStatusMessage("Requesting camera and microphone");
        localMediaPromiseRef.current = requestCameraMicrophone()
          .then((stream) => {
            localStreamRef.current = stream;
            setLocalTrackCount(stream.getTracks().length);
            void attachStreamToVideo(localVideoRef.current, stream);
            console.log("[call] local media ready", {
              tracks: stream.getTracks().map((track) => track.kind),
            });
            return stream;
          })
          .catch((error: unknown) => {
            localMediaPromiseRef.current = null;
            throw error;
          });
      }

      const stream = await localMediaPromiseRef.current;

      if (peerConnection) {
        addLocalTracksToPeerConnection(peerConnection, stream);
        setLocalTrackCount(stream.getTracks().length);
      }

      return stream;
    },
    [],
  );

  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    const remoteStream = remoteStreamRef.current ?? new MediaStream();

    remoteStreamRef.current = addRemoteTrackToStream(remoteStream, event);
    setRemoteTrackCount(remoteStreamRef.current.getTracks().length);
    void attachStreamToVideo(remoteVideoRef.current, remoteStreamRef.current);
    console.log("[call] remote track received", {
      kind: event.track.kind,
      readyState: event.track.readyState,
      remoteTrackCount: remoteStreamRef.current.getTracks().length,
    });
  }, []);

  const handleStartMedia = async () => {
    if (!callConfig.isValid || !callConfig.role) {
      setCallStatus("error");
      setErrorMessage("Missing sessionId, participantId, targetParticipantId, or role.");
      return;
    }

    releaseCallResources(false);
    setCallStatus("starting");
    setErrorMessage(null);
    setStatusMessage("Joining session");
    setConnectionState("new");
    setIceConnectionState("new");
    setIceGatheringState("new");
    setLocalTrackCount(0);
    setRemoteTrackCount(0);

    try {
      const signalingClient = createWebRtcSignalingClient();
      signalingClientRef.current = signalingClient;

      const joined = await signalingClient.joinSession({
        sessionId: callConfig.sessionId,
        participantId: callConfig.participantId,
        role: callConfig.role,
      });

      console.log("[call] session joined", {
        room: joined.room,
        socketId: signalingClient.id,
        participantId: joined.participant.participantId,
      });

      remoteStreamRef.current = new MediaStream();

      const peerService = new AtomQuestPeerConnectionService({
        signalingClient,
        sessionId: callConfig.sessionId,
        participantId: callConfig.participantId,
        targetParticipantId: callConfig.targetParticipantId,
        onBeforeAnswer: async (peerConnection) => {
          await ensureLocalMedia(peerConnection);
          console.log("[call] local tracks attached before answer");
        },
        onError: (error) => {
          setCallStatus("error");
          setErrorMessage(error.message);
          console.error("[call] peer error", error);
        },
        onRemoteTrack: handleRemoteTrack,
      });

      peerServiceRef.current = peerService;
      const peerConnection = peerService.start();
      peerConnectionRef.current = peerConnection;

      unsubscribeConnectionStateRef.current =
        peerService.onConnectionStateChange((state) => {
          setConnectionState(state);
          console.log("[call] connectionState", state);

          if (state === "connected") {
            setCallStatus("connected");
            setStatusMessage("Connected");
          }

          if (state === "failed") {
            setCallStatus("error");
            setErrorMessage("Peer connection failed.");
          }
        });

      peerConnection.oniceconnectionstatechange = () => {
        setIceConnectionState(peerConnection.iceConnectionState);
        console.log(
          "[call] iceConnectionState",
          peerConnection.iceConnectionState,
        );
      };

      peerConnection.onicegatheringstatechange = () => {
        setIceGatheringState(peerConnection.iceGatheringState);
        console.log("[call] iceGatheringState", peerConnection.iceGatheringState);
      };

      await ensureLocalMedia(peerConnection);
      setCallStatus("ready");
      setStatusMessage(
        callConfig.isInitiator ? "Ready to start" : "Ready to answer",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start media.";

      setCallStatus("error");
      setErrorMessage(message);
      setStatusMessage("Error");
      console.error("[call] setup failed", error);
    }
  };

  const handleStartCall = async () => {
    const peerService = peerServiceRef.current;

    if (!peerService) {
      setCallStatus("error");
      setErrorMessage("Peer connection is not ready.");
      return;
    }

    try {
      setCallStatus("calling");
      setStatusMessage("Creating offer");
      const offer = await peerService.createAndSendOffer();

      setStatusMessage("Offer sent");
      console.log("[call] offer sent", {
        type: offer.type,
        sdpLength: offer.sdp.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start call.";

      setCallStatus("error");
      setErrorMessage(message);
      setStatusMessage("Error");
      console.error("[call] offer failed", error);
    }
  };

  const handleEndCall = () => {
    releaseCallResources(true);
  };

  const isBusy = callStatus === "starting" || callStatus === "calling";
  const canStartCall =
    callConfig.isInitiator &&
    (callStatus === "ready" || callStatus === "calling") &&
    connectionState !== "connected";

  return (
    <main className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
              <Radio className="size-3.5" aria-hidden="true" />
              {callConfig.role ?? "CALL"}
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-zinc-950 dark:text-zinc-50 sm:text-3xl">
              AtomQuest video call
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              icon={<Wifi className="size-4" aria-hidden="true" />}
              state={connectionState}
            >
              {connectionState}
            </StatusPill>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950"
              disabled={isBusy}
              onClick={handleStartMedia}
              type="button"
            >
              {callStatus === "starting" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Video className="size-4" aria-hidden="true" />
              )}
              Join media
            </button>
            {canStartCall && (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white shadow-lg shadow-zinc-300 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
                disabled={callStatus === "calling"}
                onClick={handleStartCall}
                type="button"
              >
                {callStatus === "calling" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Phone className="size-4" aria-hidden="true" />
                )}
                Start call
              </button>
            )}
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/15 dark:focus:ring-offset-zinc-950"
              onClick={handleEndCall}
              type="button"
            >
              <PhoneOff className="size-4" aria-hidden="true" />
              End
            </button>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={<UserRound className="size-4" aria-hidden="true" />}
            label="Participant"
            value={shortId(callConfig.participantId || "missing")}
          />
          <Metric
            icon={<UserRound className="size-4" aria-hidden="true" />}
            label="Target"
            value={shortId(callConfig.targetParticipantId || "missing")}
          />
          <Metric
            icon={<Radio className="size-4" aria-hidden="true" />}
            label="ICE"
            value={iceConnectionState}
          />
          <Metric
            icon={<Wifi className="size-4" aria-hidden="true" />}
            label="Gathering"
            value={iceGatheringState}
          />
        </section>

        {(errorMessage || !callConfig.isValid) && (
          <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">Call setup error</p>
                <p className="mt-1 text-sm">
                  {errorMessage ??
                    "URL requires sessionId, participantId, targetParticipantId, and role."}
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-2">
          <VideoPane
            isMuted
            label={`Local ${statusMessage}`}
            trackCount={localTrackCount}
            videoRef={localVideoRef}
          />
          <VideoPane
            label="Remote"
            trackCount={remoteTrackCount}
            videoRef={remoteVideoRef}
          />
        </section>
      </div>
    </main>
  );
}
