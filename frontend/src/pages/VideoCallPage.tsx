import {
  AlertCircle,
  Atom,
  CheckCircle2,
  CircleDot,
  Loader2,
  Mic,
  MicOff,
  MessagesSquare,
  Phone,
  Square,
  TriangleAlert,
  UserRound,
  Video,
  VideoOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";

import {
  endSession,
  getRecordings,
  getSessionApiErrorMessage,
  startRecording,
  stopRecording,
  uploadRecordingChunk,
} from "../api/sessions";
import InCallChatWidget from "../components/InCallChatWidget";
import {
  SessionEndedView,
  ConnectionLostView,
  ConnectionLostOverlay,
  WaitingRoomStage,
} from "../components/SessionLifecycle";
import type { Recording, RecordingStatus, SessionDetails } from "../types/session";
import type { ParticipantRole } from "../types/session";
import {
  addLocalTracksToPeerConnection,
  addRemoteTrackToStream,
  AtomQuestCallRecorder,
  AtomQuestPeerConnectionService,
  createWebRtcSignalingClient,
  getCallMediaKey,
  getSupportedRecordingMimeType,
  requestCameraMicrophone,
  stopMediaStream,
  takePreJoinMediaForCall,
  type CallMediaState,
  type RecordingUpdatePayload,
  type WebRtcSignalingClient,
} from "../webrtc";

type CallStatus =
  | "idle"
  | "starting"
  | "ready"
  | "calling"
  | "connected"
  | "ending"
  | "ended"
  | "error";

type ConnectionStatus =
  | "Connected"
  | "Connecting"
  | "Reconnecting"
  | "Disconnected";

interface CallConfig {
  sessionId: string;
  participantId: string;
  targetParticipantId: string;
  role: ParticipantRole | null;
  isInitiator: boolean;
  shouldAutoStart: boolean;
  isValid: boolean;
}

const recordingStatusClasses: Record<RecordingStatus, string> = {
  RECORDING: "border-red-400/30 bg-red-500/20 text-red-100",
  PROCESSING: "border-amber-300/30 bg-amber-400/15 text-amber-100",
  READY: "border-emerald-300/30 bg-emerald-400/15 text-emerald-100",
  FAILED: "border-red-300/30 bg-red-500/15 text-red-100",
};

function RecordingBadge({ recording }: { recording: Recording }) {
  const presentation: Record<
    RecordingStatus,
    { icon: ReactNode; label: string }
  > = {
    RECORDING: {
      icon: <CircleDot className="size-3.5 fill-current" aria-hidden="true" />,
      label: "Recording",
    },
    PROCESSING: {
      icon: <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />,
      label: "Processing",
    },
    READY: {
      icon: <CheckCircle2 className="size-3.5" aria-hidden="true" />,
      label: "Ready",
    },
    FAILED: {
      icon: <TriangleAlert className="size-3.5" aria-hidden="true" />,
      label: "Failed",
    },
  };
  const status = presentation[recording.status];

  return (
    <div
      aria-live="polite"
      className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold shadow-lg backdrop-blur-md ${recordingStatusClasses[recording.status]}`}
      role="status"
    >
      {status.icon}
      {status.label}
    </div>
  );
}

function normalizeParam(value: string | null): string {
  return value?.trim() ?? "";
}

function parseRole(value: string | null): ParticipantRole | null {
  if (value === "AGENT" || value === "CUSTOMER") {
    return value;
  }

  return null;
}

function parseInitiator(
  value: string | null,
  role: ParticipantRole | null,
): boolean {
  if (value !== null) {
    return value === "true" || value === "1";
  }

  return role === "AGENT";
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
    // Browsers can defer autoplay with audio until the next interaction.
  }
}

function getConnectionStatus({
  callStatus,
  connectionState,
  hasConnected,
  iceConnectionState,
}: {
  callStatus: CallStatus;
  connectionState: RTCPeerConnectionState;
  hasConnected: boolean;
  iceConnectionState: RTCIceConnectionState;
}): ConnectionStatus {
  if (
    callStatus === "idle" ||
    callStatus === "ended" ||
    callStatus === "error" ||
    connectionState === "failed" ||
    connectionState === "closed"
  ) {
    return "Disconnected";
  }

  if (
    connectionState === "disconnected" ||
    (hasConnected &&
      (connectionState === "connecting" ||
        iceConnectionState === "checking" ||
        iceConnectionState === "disconnected"))
  ) {
    return "Reconnecting";
  }

  if (connectionState === "connected") {
    return "Connected";
  }

  return "Connecting";
}



function CallControl({
  active = true,
  danger = false,
  disabled,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  const stateClasses = danger
    ? "bg-red-500 text-white hover:bg-red-600"
    : active
      ? "bg-zinc-700/60 text-white hover:bg-zinc-700/80"
      : "bg-zinc-900 text-white hover:bg-zinc-800";

  return (
    <button
      aria-label={label}
      aria-pressed={danger ? undefined : active}
      className={`group inline-flex ${
        danger ? "h-12 w-20 sm:h-14 sm:w-24" : "size-12 sm:size-14"
      } items-center justify-center rounded-full transition-all duration-200 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-40 ${stateClasses}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className="transition-transform duration-150 group-active:scale-90">{icon}</span>
    </button>
  );
}

function StageMessage({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="call-stage-enter relative z-10 mx-auto flex max-w-md flex-col items-center px-6 text-center">
      <div className="flex size-16 sm:size-20 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white shadow-lg backdrop-blur-sm">
        {icon}
      </div>
      <h1 className="mt-5 sm:mt-6 text-2xl font-semibold tracking-tight sm:text-3xl text-white">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-zinc-300 sm:text-base">
        {description}
      </p>
      {action && <div className="mt-6 sm:mt-8">{action}</div>}
    </div>
  );
}

export default function VideoCallPage() {
  const navigate = useNavigate();
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
  const unsubscribeSessionEndedRef = useRef<(() => void) | null>(null);
  const unsubscribeRecordingUpdateRef = useRef<(() => void) | null>(null);
  const sessionEndedRef = useRef(false);
  const autoStartedCallKeyRef = useRef<string | null>(null);
  const callRecorderRef = useRef<AtomQuestCallRecorder | null>(null);

  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready to join");
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>("new");
  const [iceConnectionState, setIceConnectionState] =
    useState<RTCIceConnectionState>("new");
  const [hasConnected, setHasConnected] = useState(false);
  const [hasLocalCamera, setHasLocalCamera] = useState(false);
  const [hasLocalMicrophone, setHasLocalMicrophone] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(false);
  const [hasRemoteCamera, setHasRemoteCamera] = useState(false);
  const [hasRemoteMicrophone, setHasRemoteMicrophone] = useState(false);
  const [isRemoteCameraEnabled, setIsRemoteCameraEnabled] = useState<
    boolean | null
  >(null);
  const [isRemoteMicrophoneEnabled, setIsRemoteMicrophoneEnabled] = useState<
    boolean | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [endedSession, setEndedSession] = useState<SessionDetails | null>(null);
  const [chatSignalingClient, setChatSignalingClient] =
    useState<WebRtcSignalingClient | null>(null);
  const [isChatSocketJoined, setIsChatSocketJoined] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [isRecordingActionPending, setIsRecordingActionPending] =
    useState(false);
  const [recordingErrorMessage, setRecordingErrorMessage] = useState<
    string | null
  >(null);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [connectionStartTime, setConnectionStartTime] = useState<number | null>(null);
  const [showRestoredOverlay, setShowRestoredOverlay] = useState(false);
  const [durationTick, setDurationTick] = useState(0);
  const previousConnectionStateRef = useRef<string | null>(null);
  const endedAt = endedSession?.endedAt ?? null;

  let durationSeconds: number | null = null;
  if (connectionStartTime !== null) {
    const endedAtMs = endedAt ? Date.parse(endedAt) : null;
    const endMs =
      endedAtMs !== null && Number.isFinite(endedAtMs)
        ? endedAtMs
        : durationTick || connectionStartTime;

    durationSeconds = Math.max(
      0,
      Math.floor((endMs - connectionStartTime) / 1000),
    );
  }

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (
      connectionState === "connected" &&
      (previousConnectionStateRef.current === "disconnected" ||
        previousConnectionStateRef.current === "connecting")
    ) {
      setShowRestoredOverlay(true);
      const timer = setTimeout(() => {
        setShowRestoredOverlay(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
    previousConnectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    if (!connectionStartTime || endedAt) {
      return;
    }

    const timer = window.setInterval(() => setDurationTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connectionStartTime, endedAt]);

  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Draggable PiP stage/card states and refs
  const [pipCorner, setPipCorner] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("bottom-right");
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [pipSize, setPipSize] = useState({ width: 0, height: 0 });
  const [isPipDragging, setIsPipDragging] = useState(false);

  const stageRef = useRef<HTMLElement | null>(null);
  const pipRef = useRef<HTMLDivElement | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const pipStartRef = useRef({ x: 0, y: 0 });
  const latestDragPositionRef = useRef<{ x: number; y: number } | null>(null);

  const updateSizes = useCallback(() => {
    if (stageRef.current && pipRef.current) {
      setStageSize({
        width: stageRef.current.clientWidth,
        height: stageRef.current.clientHeight,
      });
      setPipSize({
        width: pipRef.current.clientWidth,
        height: pipRef.current.clientHeight,
      });
    }
  }, []);

  useEffect(() => {
    if (!stageRef.current) return;

    const observer = new ResizeObserver(() => {
      updateSizes();
    });

    observer.observe(stageRef.current);
    if (pipRef.current) {
      observer.observe(pipRef.current);
    }

    return () => observer.disconnect();
  }, [updateSizes]);

  // Re-attach media streams to video elements on layout changes/remounts
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      void attachStreamToVideo(localVideoRef.current, localStreamRef.current);
    }
  }, [isMobile, isChatOpen, isCameraEnabled]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamRef.current) {
      void attachStreamToVideo(remoteVideoRef.current, remoteStreamRef.current);
    }
  }, [isMobile, isChatOpen, callStatus, hasRemoteCamera, isRemoteCameraEnabled]);

  const resetControlsTimeout = useCallback(() => {
    setAreControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (!isChatOpen && !isDraggingRef.current) {
      controlsTimeoutRef.current = setTimeout(() => {
        setAreControlsVisible(false);
      }, 3000);
    }
  }, [isChatOpen]);

  const handlePipPointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if ("button" in e && e.button !== 0) return;

    updateSizes();

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const rectStage = stageRef.current?.getBoundingClientRect();
    const rectPip = pipRef.current?.getBoundingClientRect();

    const isFloatingFixed = isMobile && isChatOpen;
    const canStartDrag = isFloatingFixed ? !!rectPip : !!(rectStage && rectPip);

    if (canStartDrag && rectPip) {
      isDraggingRef.current = true;
      setIsPipDragging(true);
      dragStartRef.current = { x: clientX, y: clientY };

      const initialX = isFloatingFixed ? rectPip.left : rectPip.left - (rectStage?.left ?? 0);
      const initialY = isFloatingFixed ? rectPip.top : rectPip.top - (rectStage?.top ?? 0);

      pipStartRef.current = { x: initialX, y: initialY };
      latestDragPositionRef.current = { x: initialX, y: initialY };
      setDragPosition({ x: initialX, y: initialY });

      resetControlsTimeout();
    }
  }, [updateSizes, resetControlsTimeout, isMobile, isChatOpen]);

  useEffect(() => {
    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;

      if (e.cancelable) {
        e.preventDefault();
      }

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - dragStartRef.current.x;
      const deltaY = clientY - dragStartRef.current.y;

      let newX = pipStartRef.current.x + deltaX;
      let newY = pipStartRef.current.y + deltaY;

      const boundsWidth = isMobile && isChatOpen ? window.innerWidth : stageSize.width;
      const boundsHeight = isMobile && isChatOpen ? window.innerHeight : stageSize.height;

      newX = Math.max(0, Math.min(newX, boundsWidth - pipSize.width));
      newY = Math.max(0, Math.min(newY, boundsHeight - pipSize.height));

      const newPos = { x: newX, y: newY };
      latestDragPositionRef.current = newPos;
      setDragPosition(newPos);

      resetControlsTimeout();
    };

    const handlePointerUp = () => {
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      setIsPipDragging(false);
      const finalPos = latestDragPositionRef.current;

      const boundsWidth = isMobile && isChatOpen ? window.innerWidth : stageSize.width;
      const boundsHeight = isMobile && isChatOpen ? window.innerHeight : stageSize.height;

      if (finalPos && boundsWidth > 0 && boundsHeight > 0) {
        const stageCenterX = boundsWidth / 2;
        const stageCenterY = boundsHeight / 2;
        const pipCenterX = finalPos.x + pipSize.width / 2;
        const pipCenterY = finalPos.y + pipSize.height / 2;

        const targetCorner: "top-left" | "top-right" | "bottom-left" | "bottom-right" =
          pipCenterX < stageCenterX
            ? pipCenterY < stageCenterY
              ? "top-left"
              : "bottom-left"
            : pipCenterY < stageCenterY
              ? "top-right"
              : "bottom-right";

        // Calculate target coordinates for the snap animation
        const isSm = window.innerWidth >= 640;
        const margin = isSm ? 24 : 16;

        let targetX = boundsWidth - pipSize.width - margin;
        let targetY = boundsHeight - pipSize.height - margin;

        if (targetCorner === "top-left") {
          targetX = margin;
          targetY = margin;
        } else if (targetCorner === "top-right") {
          targetX = boundsWidth - pipSize.width - margin;
          targetY = margin;
        } else if (targetCorner === "bottom-left") {
          targetX = margin;
          targetY = boundsHeight - pipSize.height - margin;
        }

        setDragPosition({ x: targetX, y: targetY });
        setPipCorner(targetCorner);

        // Clear dragPosition after snap animation to revert to native CSS layout (resizes will sync instantly!)
        setTimeout(() => {
          if (!isDraggingRef.current) {
            setDragPosition(null);
          }
        }, 300);
      } else {
        setDragPosition(null);
      }

      latestDragPositionRef.current = null;
      resetControlsTimeout();
    };

    window.addEventListener("mousemove", handlePointerMove, { passive: false });
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchmove", handlePointerMove, { passive: false });
    window.addEventListener("touchend", handlePointerUp);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("touchend", handlePointerUp);
    };
  }, [stageSize, pipSize, resetControlsTimeout, isMobile, isChatOpen]);

  const getPipStyle = useCallback(() => {
    if (dragPosition !== null) {
      return {
        left: `${dragPosition.x}px`,
        top: `${dragPosition.y}px`,
        bottom: "auto",
        right: "auto",
        cursor: isPipDragging ? "grabbing" : "grab",
        transition: isPipDragging ? "none" : "left 0.3s cubic-bezier(0.25, 1, 0.5, 1), top 0.3s cubic-bezier(0.25, 1, 0.5, 1)",
      };
    }

    // Default snapped state uses native CSS layout (avoids size update lag during stage resizes)
    return {
      cursor: "grab",
    };
  }, [dragPosition, isPipDragging]);

  const getCornerClasses = useCallback(() => {
    if (dragPosition !== null) {
      return isMobile && isChatOpen ? "fixed z-[60]" : "absolute z-30";
    }

    const positionPrefix = isMobile && isChatOpen ? "fixed z-[60]" : "absolute z-30";

    switch (pipCorner) {
      case "top-left":
        return `${positionPrefix} left-4 top-4 sm:left-6 sm:top-6`;
      case "top-right":
        return `${positionPrefix} right-4 top-4 sm:right-6 sm:top-6`;
      case "bottom-left":
        return `${positionPrefix} left-4 bottom-4 sm:left-6 sm:bottom-6`;
      case "bottom-right":
      default:
        return `${positionPrefix} right-4 bottom-4 sm:right-6 sm:bottom-6`;
    }
  }, [dragPosition, pipCorner, isMobile, isChatOpen]);

  useEffect(() => {
    const handleActivity = () => {
      resetControlsTimeout();
    };

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("mousedown", handleActivity);
    window.addEventListener("keypress", handleActivity);
    window.addEventListener("touchstart", handleActivity);

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("keypress", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
    };
  }, [resetControlsTimeout]);

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
      shouldAutoStart:
        role === "CUSTOMER" && searchParams.get("prejoin") === "true",
      isValid:
        sessionId.length > 0 &&
        participantId.length > 0 &&
        targetParticipantId.length > 0 &&
        role !== null,
    };
  }, [searchParams]);

  const syncLocalMediaState = useCallback((stream: MediaStream) => {
    const videoTrack = stream
      .getVideoTracks()
      .find((track) => track.readyState === "live");
    const audioTrack = stream
      .getAudioTracks()
      .find((track) => track.readyState === "live");
    const mediaState: CallMediaState = {
      cameraEnabled: Boolean(videoTrack?.enabled),
      microphoneEnabled: Boolean(audioTrack?.enabled),
    };

    setHasLocalCamera(Boolean(videoTrack));
    setHasLocalMicrophone(Boolean(audioTrack));
    setIsCameraEnabled(mediaState.cameraEnabled);
    setIsMicrophoneEnabled(mediaState.microphoneEnabled);
    peerServiceRef.current?.sendMediaState(mediaState);
  }, []);

  const stopBrowserRecorder = useCallback(async (): Promise<void> => {
    const recorder = callRecorderRef.current;
    callRecorderRef.current = null;

    if (!recorder) {
      return;
    }

    await recorder.stop();
  }, []);

  const releaseCallResources = useCallback((resetState: boolean) => {
    unsubscribeConnectionStateRef.current?.();
    unsubscribeConnectionStateRef.current = null;
    unsubscribeSessionEndedRef.current?.();
    unsubscribeSessionEndedRef.current = null;
    unsubscribeRecordingUpdateRef.current?.();
    unsubscribeRecordingUpdateRef.current = null;
    void stopBrowserRecorder().catch((error) => {
      console.error("[recording] recorder cleanup failed", error);
    });
    peerServiceRef.current?.close();
    peerServiceRef.current = null;
    peerConnectionRef.current = null;
    signalingClientRef.current?.disconnect();
    signalingClientRef.current = null;
    setChatSignalingClient(null);
    setIsChatSocketJoined(false);
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
      setHasConnected(false);
      setHasLocalCamera(false);
      setHasLocalMicrophone(false);
      setIsCameraEnabled(false);
      setIsMicrophoneEnabled(false);
      setHasRemoteCamera(false);
      setHasRemoteMicrophone(false);
      setIsRemoteCameraEnabled(null);
      setIsRemoteMicrophoneEnabled(null);
      setStatusMessage("Call ended");
      setCallStatus("ended");
    }
  }, [stopBrowserRecorder]);

  const applySessionEnded = useCallback(
    (session: SessionDetails | null, source: "local" | "remote") => {
      if (sessionEndedRef.current) {
        return;
      }

      sessionEndedRef.current = true;
      void stopBrowserRecorder().catch((error) => {
        setRecordingErrorMessage(getSessionApiErrorMessage(error));
      });
      releaseCallResources(false);
      setEndedSession(session);
      setConnectionState("closed");
      setIceConnectionState("closed");
      setHasConnected(false);
      setHasLocalCamera(false);
      setHasLocalMicrophone(false);
      setIsCameraEnabled(false);
      setIsMicrophoneEnabled(false);
      setHasRemoteCamera(false);
      setHasRemoteMicrophone(false);
      setIsRemoteCameraEnabled(null);
      setIsRemoteMicrophoneEnabled(null);
      setErrorMessage(null);
      setStatusMessage("Session ended");
      setCallStatus("ended");
      console.log("[call] session ended", {
        source,
        sessionId: session?.id ?? callConfig.sessionId,
        endedAt: session?.endedAt ?? null,
        endedBy: session?.endedBy ?? "AGENT",
      });
    },
    [callConfig.sessionId, releaseCallResources, stopBrowserRecorder],
  );

  const handleSessionEndedAction = useCallback(() => {
    if (callConfig.role === "AGENT") {
      navigate("/agent");
    } else {
      window.close();
      setTimeout(() => {
        alert("Please close this browser tab manually.");
      }, 100);
    }
  }, [callConfig.role, navigate]);

  const leaveSocketRoom = useCallback(async (): Promise<void> => {
    const signalingClient = signalingClientRef.current;

    if (!signalingClient?.connected || !callConfig.isValid) {
      return;
    }

    try {
      await signalingClient.leaveSession({
        sessionId: callConfig.sessionId,
        participantId: callConfig.participantId,
      });
      console.log("[call] socket room left", {
        sessionId: callConfig.sessionId,
        participantId: callConfig.participantId,
      });
    } catch (error) {
      console.warn("[call] socket room leave failed", error);
    }
  }, [callConfig.isValid, callConfig.participantId, callConfig.sessionId]);

  const ensureLocalMedia = useCallback(
    async (peerConnection?: RTCPeerConnection): Promise<MediaStream> => {
      if (!localMediaPromiseRef.current) {
        const callMediaKey = getCallMediaKey(
          callConfig.sessionId,
          callConfig.participantId,
        );
        const preJoinStream = callConfig.shouldAutoStart
          ? takePreJoinMediaForCall(callMediaKey)
          : null;

        setStatusMessage(
          preJoinStream ? "Using your selected devices" : "Starting devices",
        );
        localMediaPromiseRef.current = (
          preJoinStream
            ? Promise.resolve(preJoinStream)
            : requestCameraMicrophone()
        )
          .then((stream) => {
            localStreamRef.current = stream;
            syncLocalMediaState(stream);
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
        syncLocalMediaState(stream);
      }

      return stream;
    },
    [
      callConfig.participantId,
      callConfig.sessionId,
      callConfig.shouldAutoStart,
      syncLocalMediaState,
    ],
  );

  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    const remoteStream = remoteStreamRef.current ?? new MediaStream();

    remoteStreamRef.current = addRemoteTrackToStream(remoteStream, event);
    void attachStreamToVideo(remoteVideoRef.current, remoteStreamRef.current);

    const updateEndedTrackState = () => {
      const activeStream = remoteStreamRef.current;

      if (event.track.kind === "video") {
        const hasLiveVideo = Boolean(
          activeStream
            ?.getVideoTracks()
            .some((track) => track.readyState === "live"),
        );
        setHasRemoteCamera(hasLiveVideo);

        if (!hasLiveVideo) {
          setIsRemoteCameraEnabled(false);
        }
      } else {
        const hasLiveAudio = Boolean(
          activeStream
            ?.getAudioTracks()
            .some((track) => track.readyState === "live"),
        );
        setHasRemoteMicrophone(hasLiveAudio);

        if (!hasLiveAudio) {
          setIsRemoteMicrophoneEnabled(false);
        }
      }
    };

    event.track.onended = updateEndedTrackState;

    if (event.track.kind === "video") {
      setHasRemoteCamera(true);
      setIsRemoteCameraEnabled((current) => current ?? true);
    } else {
      setHasRemoteMicrophone(true);
      setIsRemoteMicrophoneEnabled((current) => current ?? true);
    }

    console.log("[call] remote track received", {
      kind: event.track.kind,
      readyState: event.track.readyState,
    });
  }, []);

  const handleStartMedia = useCallback(async () => {
    if (!callConfig.isValid || !callConfig.role) {
      setCallStatus("error");
      setErrorMessage(
        "Missing sessionId, participantId, targetParticipantId, or role.",
      );
      return;
    }

    releaseCallResources(false);
    sessionEndedRef.current = false;
    setCallStatus("starting");
    setErrorMessage(null);
    setEndedSession(null);
    setStatusMessage("Joining secure session");
    setConnectionState("new");
    setIceConnectionState("new");
    setHasConnected(false);
    setHasLocalCamera(false);
    setHasLocalMicrophone(false);
    setIsCameraEnabled(false);
    setIsMicrophoneEnabled(false);
    setHasRemoteCamera(false);
    setHasRemoteMicrophone(false);
    setIsRemoteCameraEnabled(null);
    setIsRemoteMicrophoneEnabled(null);

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
      setChatSignalingClient(signalingClient);
      setIsChatSocketJoined(true);

      unsubscribeSessionEndedRef.current = signalingClient.onSessionEnded(
        (payload) => {
          if (payload.sessionId !== callConfig.sessionId) {
            return;
          }

          applySessionEnded(payload.session, "remote");
        },
      );
      unsubscribeRecordingUpdateRef.current = signalingClient.onRecordingUpdate(
        (payload: RecordingUpdatePayload) => {
          if (payload.sessionId !== callConfig.sessionId) {
            return;
          }

          setRecording(payload.recording);
          setRecordingErrorMessage(
            payload.recording.status === "FAILED"
              ? payload.recording.failureReason ?? "Recording failed."
              : null,
          );

          if (
            callConfig.role === "AGENT" &&
            payload.recording.status !== "RECORDING"
          ) {
            void stopBrowserRecorder().catch((error) => {
              setRecordingErrorMessage(getSessionApiErrorMessage(error));
            });
          }
        },
      );

      const existingRecordings = await getRecordings(callConfig.sessionId);
      setRecording(existingRecordings.recordings[0] ?? null);

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
          setStatusMessage("Call connection failed");
          setErrorMessage(error.message);
          console.error("[call] peer error", error);
        },
        onRemoteMediaState: (state) => {
          setIsRemoteCameraEnabled(state.cameraEnabled);
          setIsRemoteMicrophoneEnabled(state.microphoneEnabled);
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
            setHasConnected(true);
            setCallStatus("connected");
            setStatusMessage("Connected");
            setConnectionStartTime((prev) => prev ?? Date.now());

            if (localStreamRef.current) {
              syncLocalMediaState(localStreamRef.current);
            }
          } else if (state === "disconnected") {
            setStatusMessage("Reconnecting");
          } else if (state === "connecting") {
            setStatusMessage("Connecting securely");
          } else if (state === "failed") {
            setCallStatus("error");
            setStatusMessage("Call disconnected");
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

      await ensureLocalMedia(peerConnection);
      setCallStatus("ready");
      setStatusMessage(
        callConfig.isInitiator
          ? "Ready to start the call"
          : "Waiting for your support agent",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start media.";

      setCallStatus("error");
      setErrorMessage(message);
      setStatusMessage("Unable to join");
      console.error("[call] setup failed", error);
    }
  }, [
    applySessionEnded,
    callConfig,
    ensureLocalMedia,
    handleRemoteTrack,
    releaseCallResources,
    stopBrowserRecorder,
    syncLocalMediaState,
  ]);

  useEffect(() => {
    if (!callConfig.shouldAutoStart || !callConfig.isValid) {
      return undefined;
    }

    const callKey = getCallMediaKey(
      callConfig.sessionId,
      callConfig.participantId,
    );

    if (autoStartedCallKeyRef.current === callKey) {
      return undefined;
    }

    let hasStarted = false;
    const timeoutId = window.setTimeout(() => {
      hasStarted = true;
      autoStartedCallKeyRef.current = callKey;
      void handleStartMedia();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);

      if (!hasStarted && autoStartedCallKeyRef.current === callKey) {
        autoStartedCallKeyRef.current = null;
      }
    };
  }, [
    callConfig.isValid,
    callConfig.participantId,
    callConfig.sessionId,
    callConfig.shouldAutoStart,
    handleStartMedia,
  ]);

  useEffect(() => {
    return () => {
      releaseCallResources(false);
    };
  }, [releaseCallResources]);

  const handleStartCall = async () => {
    const peerService = peerServiceRef.current;

    if (!peerService) {
      setCallStatus("error");
      setErrorMessage("Peer connection is not ready.");
      return;
    }

    try {
      setCallStatus("calling");
      setStatusMessage("Calling participant");
      const offer = await peerService.createAndSendOffer();

      setStatusMessage("Waiting for participant");
      console.log("[call] offer sent", {
        type: offer.type,
        sdpLength: offer.sdp.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start call.";

      setCallStatus("error");
      setErrorMessage(message);
      setStatusMessage("Call could not start");
      console.error("[call] offer failed", error);
    }
  };

  const handleToggleMicrophone = () => {
    const stream = localStreamRef.current;
    const track = stream
      ?.getAudioTracks()
      .find((candidate) => candidate.readyState === "live");

    if (!stream || !track) {
      return;
    }

    track.enabled = !track.enabled;
    syncLocalMediaState(stream);
  };

  const handleToggleCamera = () => {
    const stream = localStreamRef.current;
    const track = stream
      ?.getVideoTracks()
      .find((candidate) => candidate.readyState === "live");

    if (!stream || !track) {
      return;
    }

    track.enabled = !track.enabled;
    syncLocalMediaState(stream);
  };

  const handleStartRecording = async () => {
    if (
      callConfig.role !== "AGENT" ||
      !callConfig.isValid ||
      connectionState !== "connected" ||
      !localStreamRef.current ||
      !remoteStreamRef.current
    ) {
      setRecordingErrorMessage(
        "Recording can start after the call is connected.",
      );
      return;
    }

    const mimeType = getSupportedRecordingMimeType();

    if (!mimeType) {
      setRecordingErrorMessage(
        "Call recording is not supported by this browser.",
      );
      return;
    }

    setIsRecordingActionPending(true);
    setRecordingErrorMessage(null);
    let createdRecordingId: string | null = null;

    try {
      const response = await startRecording({
        sessionId: callConfig.sessionId,
        participantId: callConfig.participantId,
        mimeType,
      });
      createdRecordingId = response.recording.id;
      const recorder = new AtomQuestCallRecorder({
        localStream: localStreamRef.current,
        remoteStream: remoteStreamRef.current,
        onChunk: async (chunk, sequence) => {
          await uploadRecordingChunk({
            recordingId: response.recording.id,
            participantId: callConfig.participantId,
            sequence,
            chunk,
          });
        },
      });

      callRecorderRef.current = recorder;
      await recorder.start();
      setRecording(response.recording);
    } catch (error) {
      callRecorderRef.current = null;

      if (createdRecordingId) {
        void stopRecording({
          recordingId: createdRecordingId,
          participantId: callConfig.participantId,
        }).then((response) => setRecording(response.recording)).catch(() => {
          // The backend recovery pass will close an interrupted recording.
        });
      }

      setRecordingErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setIsRecordingActionPending(false);
    }
  };

  const handleStopRecording = useCallback(async () => {
    if (
      callConfig.role !== "AGENT" ||
      !recording ||
      recording.status !== "RECORDING"
    ) {
      return;
    }

    setIsRecordingActionPending(true);
    setRecordingErrorMessage(null);

    let browserStopError: unknown = null;

    try {
      await stopBrowserRecorder();
    } catch (error) {
      browserStopError = error;
    }

    try {
      const response = await stopRecording({
        recordingId: recording.id,
        participantId: callConfig.participantId,
      });
      setRecording(response.recording);

      if (browserStopError) {
        setRecordingErrorMessage(getSessionApiErrorMessage(browserStopError));
      }
    } catch (error) {
      setRecordingErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setIsRecordingActionPending(false);
    }
  }, [
    callConfig.participantId,
    callConfig.role,
    recording,
    stopBrowserRecorder,
  ]);

  const handleEndButtonClick = async () => {
    if (callConfig.role === "AGENT" && callConfig.isValid) {
      try {
        setCallStatus("ending");
        setStatusMessage("Ending session");
        setErrorMessage(null);

        if (recording?.status === "RECORDING") {
          try {
            await stopBrowserRecorder();
          } catch (error) {
            setRecordingErrorMessage(getSessionApiErrorMessage(error));
          }

          await stopRecording({
            recordingId: recording.id,
            participantId: callConfig.participantId,
          });
        }

        const response = await endSession(callConfig.sessionId);

        applySessionEnded(response.session, "local");
      } catch (error) {
        setCallStatus("error");
        setErrorMessage(getSessionApiErrorMessage(error));
        setStatusMessage("Unable to end session");
        console.error("[call] session end failed", error);
      }

      return;
    }

    await leaveSocketRoom();
    releaseCallResources(true);
  };

  const connectionStatus = getConnectionStatus({
    callStatus,
    connectionState,
    hasConnected,
    iceConnectionState,
  });
  const isBusy =
    callStatus === "starting" ||
    callStatus === "calling" ||
    callStatus === "ending";
  const canStartCall =
    callConfig.isInitiator &&
    callStatus === "ready" &&
    connectionState !== "connected";
  const callControlsDisabled =
    callStatus === "idle" ||
    callStatus === "starting" ||
    callStatus === "ending" ||
    callStatus === "ended";
  const partnerLabel =
    callConfig.role === "AGENT" ? "Customer" : "AtomQuest support";
  const remoteCameraOff =
    isRemoteCameraEnabled === false ||
    (callStatus === "connected" && !hasRemoteCamera);
  const remoteVideoVisible =
    callStatus === "connected" &&
    hasRemoteCamera &&
    isRemoteCameraEnabled !== false;
  const remoteMicrophoneMuted =
    callStatus === "connected" &&
    (isRemoteMicrophoneEnabled === false || !hasRemoteMicrophone);
  const invalidCallMessage = callConfig.isValid
    ? null
    : "This call link is incomplete. Return to the session workspace and open the call again.";
  const canStartRecording =
    callConfig.role === "AGENT" &&
    connectionState === "connected" &&
    recording?.status !== "RECORDING" &&
    recording?.status !== "PROCESSING" &&
    !isRecordingActionPending;

  const primaryButtonClass =
    "inline-flex h-11 sm:h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-zinc-900 shadow-lg transition hover:-translate-y-0.5 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0";

  if (callStatus === "ended") {
    return (
      <SessionEndedView
        role={callConfig.role}
        durationSeconds={durationSeconds}
        endedAt={endedSession?.endedAt ?? null}
        onAction={handleSessionEndedAction}
      />
    );
  }

  if (callStatus === "error" && connectionState === "failed") {
    return (
      <ConnectionLostView
        onTryAgain={() => void handleStartMedia()}
        onLeave={handleSessionEndedAction}
      />
    );
  }

  let stageContent: ReactNode = null;

  if (invalidCallMessage || callStatus === "error") {
    stageContent = (
      <StageMessage
        action={
          callConfig.isValid ? (
            <button
              className={primaryButtonClass}
              disabled={isBusy}
              onClick={() => void handleStartMedia()}
              type="button"
            >
              <Video className="size-4" aria-hidden="true" />
              Try again
            </button>
          ) : undefined
        }
        description={
          errorMessage ??
          invalidCallMessage ??
          "The call could not be connected."
        }
        icon={<AlertCircle className="size-8 text-red-400" aria-hidden="true" />}
        title="We couldn't connect the call"
      />
    );
  } else if (callStatus === "idle") {
    stageContent = (
      <StageMessage
        action={
          <button
            className={primaryButtonClass}
            onClick={() => void handleStartMedia()}
            type="button"
          >
            <Video className="size-4" aria-hidden="true" />
            Join with camera &amp; mic
          </button>
        }
        description="Your devices stay under your control throughout the session."
        icon={<Atom className="size-9 text-emerald-400" aria-hidden="true" />}
        title="Ready for your support call?"
      />
    );
  } else if (callStatus === "starting") {
    stageContent = (
      <StageMessage
        description={statusMessage}
        icon={<Loader2 className="size-8 animate-spin" aria-hidden="true" />}
        title="Preparing your call"
      />
    );
  } else if (canStartCall) {
    stageContent = (
      <StageMessage
        action={
          <button
            className={primaryButtonClass}
            onClick={() => void handleStartCall()}
            type="button"
          >
            <Phone className="size-4" aria-hidden="true" />
            Start call
          </button>
        }
        description="Your camera and microphone are ready. Start when you are."
        icon={<Phone className="size-8 text-emerald-400" aria-hidden="true" />}
        title="Everything looks good"
      />
    );
  } else if (callStatus === "ready" || callStatus === "calling") {
    stageContent = callConfig.role ? (
      <WaitingRoomStage
        role={callConfig.role}
        isCameraEnabled={isCameraEnabled}
        isMicrophoneEnabled={isMicrophoneEnabled}
      />
    ) : (
      <StageMessage
        description={statusMessage}
        icon={<Loader2 className="size-8 animate-spin" aria-hidden="true" />}
        title={
          callStatus === "calling"
            ? "Calling participant"
            : "Waiting for the call to begin"
        }
      />
    );
  } else if (callStatus === "ending") {
    stageContent = (
      <StageMessage
        description="Closing media and wrapping up the session."
        icon={<Loader2 className="size-8 animate-spin" aria-hidden="true" />}
        title="Ending call"
      />
    );
  } else if (remoteCameraOff) {
    stageContent = (
      <StageMessage
        description={`${partnerLabel}'s video is currently unavailable.`}
        icon={<UserRound className="size-9 text-zinc-400" aria-hidden="true" />}
        title="Camera Off"
      />
    );
  } else if (!remoteVideoVisible) {
    stageContent = (
      <StageMessage
        description="The secure media connection is almost ready."
        icon={<Loader2 className="size-8 animate-spin" aria-hidden="true" />}
        title="Connecting video"
      />
    );
  }

  return (
    <main
      className={`relative flex h-[100dvh] flex-row overflow-hidden bg-zinc-950 transition-all duration-700 ease-in-out ${
        areControlsVisible ? "p-3 sm:p-4" : "p-0"
      } ${areControlsVisible ? "" : "cursor-none"}`}
    >
      {/* Left Column: Video Stage + Controls */}
      <div
        className={`relative flex flex-1 flex-col items-stretch h-full transition-all duration-700 ease-in-out ${
          areControlsVisible ? "pb-16 sm:pb-20" : "pb-0"
        }`}
      >
        {/* Video Stage with margin and good border radius */}
        <section
          aria-label={`${partnerLabel} video`}
          className={`relative flex flex-1 items-center justify-center overflow-hidden transition-all duration-700 ease-in-out bg-zinc-900 shadow-2xl ${
            areControlsVisible
              ? "rounded-2xl sm:rounded-[24px] border border-zinc-800/80"
              : "rounded-none border-transparent"
          }`}
          ref={stageRef}
        >
          {recording && (
            <div className="absolute left-4 top-4 z-40 sm:left-6 sm:top-6">
              <RecordingBadge recording={recording} />
            </div>
          )}

          {recordingErrorMessage && (
            <div
              className="absolute left-4 top-14 z-40 max-w-xs rounded-lg border border-red-400/25 bg-red-500/15 px-3 py-2 text-xs font-medium text-red-100 shadow-lg backdrop-blur-md sm:left-6"
              role="alert"
            >
              {recordingErrorMessage}
            </div>
          )}

          {/* Connection Lost Overlay */}
          {(connectionState === "disconnected" ||
            (hasConnected && connectionState === "connecting") ||
            showRestoredOverlay) && (
            <ConnectionLostOverlay
              status={
                showRestoredOverlay
                  ? "restored"
                  : connectionState === "disconnected"
                    ? "reconnecting"
                    : "connecting"
              }
            />
          )}

          {/* Remote Participant Container */}
          {(() => {
            const remoteVideoCard = (
              <div
                className={`transition-all duration-500 ${
                  callStatus !== "connected"
                    ? "opacity-0 pointer-events-none absolute inset-0 h-full w-full overflow-hidden"
                    : isMobile && isChatOpen
                      ? `${getCornerClasses()} aspect-[3/4] w-28 overflow-hidden rounded-xl border border-white/10 bg-zinc-800 shadow-2xl`
                      : "absolute inset-0 h-full w-full overflow-hidden"
                }`}
                onMouseDown={isMobile && isChatOpen ? handlePipPointerDown : undefined}
                onTouchStart={isMobile && isChatOpen ? handlePipPointerDown : undefined}
                ref={isMobile && isChatOpen ? pipRef : undefined}
                style={isMobile && isChatOpen ? getPipStyle() : undefined}
              >
                <video
                  aria-hidden={!remoteVideoVisible}
                  autoPlay
                  className={`h-full w-full object-cover transition-opacity duration-700 ease-in-out ${
                    remoteVideoVisible ? "opacity-100" : "opacity-0"
                  }`}
                  playsInline
                  ref={remoteVideoRef}
                />

              </div>
            );

            return isMobile && isChatOpen && typeof document !== "undefined"
              ? createPortal(remoteVideoCard, document.body)
              : remoteVideoCard;
          })()}

          {/* Subtle gradient at bottom for indicator text visibility */}
          {!(isMobile && isChatOpen) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent" />
          )}

          {/* Stage Content (Messages for non-video states) */}
          {!(isMobile && isChatOpen) && stageContent}

          {/* Remote Muted Indicator (only when not in floating PIP mode) */}
          {remoteMicrophoneMuted && callStatus === "connected" && !(isMobile && isChatOpen) && (
            <div className={`absolute bottom-4 left-4 z-20 inline-flex items-center justify-center rounded-full bg-zinc-900/80 text-white backdrop-blur-sm sm:bottom-6 sm:left-6 ${
              isMobile ? "size-8" : "min-h-7 px-3 gap-2 text-xs font-medium"
            }`}>
              <MicOff className="size-3.5" aria-hidden="true" />
              {!isMobile && "Muted"}
            </div>
          )}

          {/* Local PiP Video (hidden on mobile when chat is open) */}
          {!(isMobile && isChatOpen) && (
            <div
              aria-label="Your video preview"
              className={`call-stage-enter z-30 aspect-[3/4] w-28 overflow-hidden rounded-xl border border-white/10 bg-zinc-800 shadow-xl shadow-black/30 hover:border-white/20 sm:w-36 md:w-40 lg:w-56 lg:aspect-video touch-none select-none transition-colors duration-300 ${getCornerClasses()}`}
              onMouseDown={handlePipPointerDown}
              onTouchStart={handlePipPointerDown}
              ref={pipRef}
              style={getPipStyle()}
            >
              <video
                autoPlay
                className={`h-full w-full -scale-x-100 object-cover transition-opacity duration-500 ${
                  isCameraEnabled ? "opacity-100" : "opacity-0"
                }`}
                muted
                playsInline
                ref={localVideoRef}
              />

              {!isCameraEnabled && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
                  <UserRound className="size-8 sm:size-10 lg:size-12" aria-hidden="true" />
                </div>
              )}

              {/* PiP overlay tags */}
              <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1.5 sm:bottom-2 sm:left-2 sm:right-2">
                <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  You
                </span>
                <div className="flex items-center gap-1">
                  {!isMicrophoneEnabled && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-red-500/95 text-white shadow-sm" title="Microphone muted">
                      <MicOff className="size-3" aria-hidden="true" />
                    </span>
                  )}
                  {!isCameraEnabled && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-zinc-950/80 text-zinc-300 border border-white/10 shadow-sm" title="Camera off">
                      <VideoOff className="size-3" aria-hidden="true" />
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Control Dock — circular icon buttons centered absolute overlay at bottom of Left Column */}
        <div
          className={`absolute bottom-1 sm:bottom-1.5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 sm:gap-4 transition-all duration-500 ease-in-out ${
            areControlsVisible
              ? "opacity-100 translate-y-0"
              : "opacity-0 pointer-events-none translate-y-6"
          }`}
        >
          <CallControl
            active={isMicrophoneEnabled}
            disabled={callControlsDisabled || !hasLocalMicrophone}
            icon={
              isMicrophoneEnabled ? (
                <Mic className="size-5 sm:size-6" aria-hidden="true" />
              ) : (
                <MicOff className="size-5 sm:size-6" aria-hidden="true" />
              )
            }
            label={isMicrophoneEnabled ? "Mute" : "Unmute"}
            onClick={handleToggleMicrophone}
          />
          <CallControl
            active={isCameraEnabled}
            disabled={callControlsDisabled || !hasLocalCamera}
            icon={
              isCameraEnabled ? (
                <Video className="size-5 sm:size-6" aria-hidden="true" />
              ) : (
                <VideoOff className="size-5 sm:size-6" aria-hidden="true" />
              )
            }
            label={isCameraEnabled ? "Camera off" : "Camera on"}
            onClick={handleToggleCamera}
          />
          {callConfig.role === "AGENT" && (
            <CallControl
              active={recording?.status === "RECORDING"}
              disabled={
                recording?.status === "RECORDING"
                  ? isRecordingActionPending
                  : !canStartRecording
              }
              icon={
                isRecordingActionPending ||
                recording?.status === "PROCESSING" ? (
                  <Loader2
                    className="size-5 animate-spin sm:size-6"
                    aria-hidden="true"
                  />
                ) : recording?.status === "RECORDING" ? (
                  <Square
                    className="size-5 fill-current sm:size-6"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleDot
                    className="size-5 fill-current text-red-400 sm:size-6"
                    aria-hidden="true"
                  />
                )
              }
              label={
                recording?.status === "RECORDING"
                  ? "Stop recording"
                  : recording?.status === "PROCESSING"
                    ? "Recording processing"
                    : "Start recording"
              }
              onClick={() => {
                if (recording?.status === "RECORDING") {
                  void handleStopRecording();
                  return;
                }

                void handleStartRecording();
              }}
            />
          )}
          <div className="lg:hidden relative">
            <CallControl
              active={true}
              icon={<MessagesSquare className="size-5 sm:size-6" aria-hidden="true" />}
              label={isChatOpen ? "Close chat" : "Open chat"}
              onClick={() => setIsChatOpen(!isChatOpen)}
            />
            {unreadChatCount > 0 && !isChatOpen && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-5 h-5 items-center justify-center rounded-full border border-white bg-emerald-500 px-1.5 text-[10px] font-bold text-white pointer-events-none">
                {unreadChatCount}
              </span>
            )}
          </div>
          <CallControl
            danger
            disabled={isBusy || !callConfig.isValid}
            icon={
              callStatus === "ending" ? (
                <Loader2 className="size-5 sm:size-6 animate-spin" aria-hidden="true" />
              ) : (
                <Phone className="size-5 sm:size-6 rotate-[135deg]" fill="currentColor" aria-hidden="true" />
              )
            }
            label={callConfig.role === "AGENT" ? "End session" : "Leave call"}
            onClick={() => void handleEndButtonClick()}
          />
        </div>
      </div>

      {callConfig.isValid && (
        <InCallChatWidget
          canSend={isChatSocketJoined}
          isSessionEnded={false}
          isOpen={isChatOpen}
          participantId={callConfig.participantId}
          role={callConfig.role}
          sessionId={callConfig.sessionId}
          signalingClient={chatSignalingClient}
          visible={areControlsVisible}
          onOpenChange={setIsChatOpen}
          onUnreadCountChange={setUnreadChatCount}
        />
      )}

      <p className="sr-only" aria-live="polite">
        {connectionStatus}. {statusMessage}
      </p>
    </main>
  );
}
