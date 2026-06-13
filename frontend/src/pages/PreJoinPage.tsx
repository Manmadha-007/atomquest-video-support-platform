import {
  AlertCircle,

  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Loader2,

  Mic,
  MicOff,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Video,
  VideoOff,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  getSessionApiErrorMessage,
  getSessionApiErrorCode,
  getSessionInvite,
  joinSession,
} from "../api/sessions";
import type { Participant, SessionInvite } from "../types/session";
import {
  InvalidInviteView,
  AlreadyUsedInviteView,
  SessionExpiredView,
} from "../components/SessionLifecycle";
import {
  getCallMediaKey,
  releasePreJoinMedia,
  retainPreJoinMedia,
  retryPreJoinMedia,
  transferPreJoinMediaToCall,
  type DeviceAccessResult,
  type DeviceAccessStatus,
  type PreJoinMediaResult,
} from "../webrtc";

type InviteLoadState = "loading" | "ready" | "error";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function getAgentParticipant(participants: Participant[]): Participant | null {
  return (
    participants.find((participant) => participant.role === "AGENT") ?? null
  );
}

function buildCustomerCallPath({
  participantId,
  sessionId,
  targetParticipantId,
}: {
  sessionId: string;
  participantId: string;
  targetParticipantId: string;
}): string {
  const params = new URLSearchParams({
    sessionId,
    participantId,
    targetParticipantId,
    role: "CUSTOMER",
    initiator: "false",
    prejoin: "true",
  });

  return `/call?${params.toString()}`;
}

function formatSessionDate(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : dateFormatter.format(date);
}

function shortToken(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 9)}...${value.slice(-6)}`;
}

function getPermissionPresentation(
  status: DeviceAccessStatus,
  enabled: boolean,
): {
  icon: ReactNode;
  label: string;
  className: string;
} {
  if (status === "requesting") {
    return {
      icon: <Loader2 className="size-4 animate-spin" aria-hidden="true" />,
      label: "Checking",
      className:
        "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
    };
  }

  if (status === "granted" && enabled) {
    return {
      icon: <CheckCircle2 className="size-4" aria-hidden="true" />,
      label: "Ready",
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
    };
  }

  if (status === "granted") {
    return {
      icon: <CircleAlert className="size-4" aria-hidden="true" />,
      label: "Off",
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
    };
  }

  if (status === "denied") {
    return {
      icon: <XCircle className="size-4" aria-hidden="true" />,
      label: "Blocked",
      className:
        "border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200",
    };
  }

  return {
    icon: <AlertCircle className="size-4" aria-hidden="true" />,
    label: "Unavailable",
    className:
      "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200",
  };
}

function PermissionRow({
  access,
  enabled,
  icon,
  label,
}: {
  access: DeviceAccessResult | null;
  enabled: boolean;
  icon: ReactNode;
  label: string;
}) {
  const presentation = getPermissionPresentation(
    access?.status ?? "requesting",
    enabled,
  );

  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            {label}
          </p>
          {access?.message && (
            <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {access.message}
            </p>
          )}
        </div>
      </div>
      <span
        className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${presentation.className}`}
      >
        {presentation.icon}
        {presentation.label}
      </span>
    </div>
  );
}

export default function PreJoinPage() {
  const { token: routeToken } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaResultRef = useRef<PreJoinMediaResult | null>(null);
  const token = useMemo(() => routeToken?.trim() ?? "", [routeToken]);
  const preJoinMediaKey = useMemo(() => `invite:${token}`, [token]);

  const [inviteState, setInviteState] =
    useState<InviteLoadState>(() =>
      token.length === 0 ? "error" : "loading",
    );
  const [invite, setInvite] = useState<SessionInvite | null>(null);
  const [apiErrorCode, setApiErrorCode] = useState<string | null>(null);
  const [mediaResult, setMediaResult] =
    useState<PreJoinMediaResult | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [isRetryingDevices, setIsRetryingDevices] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    token.length === 0
      ? "A session token is required in the invite URL."
      : null,
  );

  const attachPreview = useCallback(async (stream: MediaStream) => {
    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    videoElement.srcObject = stream;

    try {
      await videoElement.play();
    } catch {
      // Muted preview can be resumed by the next user interaction.
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    if (token.length === 0) {
      return () => undefined;
    }

    async function loadInvite(): Promise<void> {
      try {
        const response = await getSessionInvite(token);

        if (!isCancelled) {
          setInvite(response.session);
          setInviteState("ready");
        }
      } catch (error) {
        if (!isCancelled) {
          setInviteState("error");
          setApiErrorCode(getSessionApiErrorCode(error));
          setErrorMessage(getSessionApiErrorMessage(error));
        }
      }
    }

    void loadInvite();

    return () => {
      isCancelled = true;
    };
  }, [token]);

  // Redirect to premium error pages based on status
  const showInvalidLink =
    apiErrorCode === "SESSION_TOKEN_NOT_FOUND" ||
    (inviteState === "error" && apiErrorCode === "SESSION_TOKEN_NOT_FOUND");

  const showAlreadyUsed =
    apiErrorCode === "SESSION_DUPLICATE_JOIN" ||
    (inviteState === "ready" && invite?.customerJoined);

  const showExpired =
    apiErrorCode === "SESSION_ALREADY_ENDED" ||
    (inviteState === "ready" && invite?.status === "ENDED");

  useEffect(() => {
    if (showInvalidLink || showAlreadyUsed || showExpired) {
      return undefined;
    }

    let isCancelled = false;
    const previewElement = videoRef.current;

    void retainPreJoinMedia(preJoinMediaKey).then((result) => {
      if (isCancelled) {
        return;
      }

      mediaResultRef.current = result;
      setMediaResult(result);
      setCameraEnabled(result.stream.getVideoTracks().length > 0);
      setMicrophoneEnabled(result.stream.getAudioTracks().length > 0);
      void attachPreview(result.stream);
    });

    return () => {
      isCancelled = true;
      releasePreJoinMedia(preJoinMediaKey);

      if (previewElement) {
        previewElement.srcObject = null;
      }
    };
  }, [attachPreview, preJoinMediaKey, showInvalidLink, showAlreadyUsed, showExpired]);

  const handleToggleCamera = () => {
    if (isJoining) {
      return;
    }

    const track = mediaResultRef.current?.stream.getVideoTracks()[0];

    if (!track) {
      return;
    }

    const nextEnabled = !cameraEnabled;
    track.enabled = nextEnabled;
    setCameraEnabled(nextEnabled);
  };

  const handleToggleMicrophone = () => {
    if (isJoining) {
      return;
    }

    const track = mediaResultRef.current?.stream.getAudioTracks()[0];

    if (!track) {
      return;
    }

    const nextEnabled = !microphoneEnabled;
    track.enabled = nextEnabled;
    setMicrophoneEnabled(nextEnabled);
  };

  const handleRetryDevices = async () => {
    if (isJoining || isRetryingDevices) {
      return;
    }

    setIsRetryingDevices(true);
    setErrorMessage(null);
    setMediaResult(null);

    try {
      const result = await retryPreJoinMedia(preJoinMediaKey);
      mediaResultRef.current = result;
      setMediaResult(result);
      setCameraEnabled(result.stream.getVideoTracks().length > 0);
      setMicrophoneEnabled(result.stream.getAudioTracks().length > 0);
      await attachPreview(result.stream);
    } finally {
      setIsRetryingDevices(false);
    }
  };

  const handleJoinSession = async () => {
    if (
      token.length === 0 ||
      !invite ||
      invite.status !== "ACTIVE" ||
      invite.customerJoined ||
      !mediaResultRef.current
    ) {
      return;
    }

    setIsJoining(true);
    setErrorMessage(null);

    try {
      const response = await joinSession({ token });
      const agentParticipant = getAgentParticipant(
        response.session.participants,
      );

      if (!agentParticipant) {
        throw new Error("Agent participant was not found for this session.");
      }

      const callMediaKey = getCallMediaKey(
        response.session.id,
        response.participant.id,
      );

      await transferPreJoinMediaToCall(preJoinMediaKey, callMediaKey);
      navigate(
        buildCustomerCallPath({
          sessionId: response.session.id,
          participantId: response.participant.id,
          targetParticipantId: agentParticipant.id,
        }),
        {
          replace: true,
        },
      );
    } catch (error) {
      setApiErrorCode(getSessionApiErrorCode(error));
      setErrorMessage(getSessionApiErrorMessage(error));
      setIsJoining(false);
    }
  };

  const cameraAccess = mediaResult?.camera ?? null;
  const microphoneAccess = mediaResult?.microphone ?? null;
  const hasCameraTrack =
    (mediaResult?.stream.getVideoTracks().length ?? 0) > 0;
  const hasMicrophoneTrack =
    (mediaResult?.stream.getAudioTracks().length ?? 0) > 0;
  const inviteIsJoinable =
    invite?.status === "ACTIVE" && !invite.customerJoined;
  const isMediaLoading = mediaResult === null;
  const canJoin =
    inviteState === "ready" &&
    inviteIsJoinable &&
    !isMediaLoading &&
    !isJoining;

  const handleContactSupport = () => {
    window.location.href = "mailto:support@atomquest.com?subject=Support Session Inquiry";
  };
  const handleRequestInvite = () => {
    window.location.href = "mailto:support@atomquest.com?subject=Requesting New Support Invite";
  };

  if (showInvalidLink) {
    return (
      <InvalidInviteView
        onContactSupport={handleContactSupport}
      />
    );
  }

  if (showAlreadyUsed) {
    return (
      <AlreadyUsedInviteView
        onRequestInvite={handleRequestInvite}
      />
    );
  }

  if (showExpired) {
    return (
      <SessionExpiredView
        onContactSupport={handleContactSupport}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-zinc-950 dark:bg-[#101216] dark:text-zinc-50">

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.65fr)] lg:items-center lg:px-8 lg:py-10">
        <section>
          <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl shadow-zinc-950/15">
            <div className="relative aspect-video w-full">
              <video
                autoPlay
                className="h-full w-full -scale-x-100 object-cover"
                muted
                playsInline
                ref={videoRef}
              />

              {(!hasCameraTrack || !cameraEnabled) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 px-6 text-center text-zinc-300">
                  <span className="flex size-16 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
                    {isMediaLoading ? (
                      <Loader2
                        className="size-7 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <UserRound className="size-7" aria-hidden="true" />
                    )}
                  </span>
                  <p className="mt-4 text-sm font-semibold">
                    {isMediaLoading
                      ? "Starting your devices"
                      : cameraAccess?.status === "denied"
                        ? "Camera permission is blocked"
                        : cameraAccess?.status === "unavailable"
                          ? "Camera is unavailable"
                          : "Camera is off"}
                  </p>
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-black/55 px-4 py-4">
                <div className="min-w-0 text-white">
                  <p className="truncate text-sm font-semibold">Your preview</p>
                  <p className="mt-0.5 text-xs text-white/65">
                    Check your audio and video before entering
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    aria-label={
                      microphoneEnabled
                        ? "Turn off microphone"
                        : "Turn on microphone"
                    }
                    aria-pressed={!microphoneEnabled}
                    className={`flex size-11 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-45 ${
                      microphoneEnabled
                        ? "border-white/25 bg-white/10 text-white hover:bg-white/20"
                        : "border-red-400/40 bg-red-500 text-white hover:bg-red-600"
                    }`}
                    disabled={isJoining || !hasMicrophoneTrack}
                    onClick={handleToggleMicrophone}
                    type="button"
                  >
                    {microphoneEnabled ? (
                      <Mic className="size-5" aria-hidden="true" />
                    ) : (
                      <MicOff className="size-5" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    aria-label={
                      cameraEnabled ? "Turn off camera" : "Turn on camera"
                    }
                    aria-pressed={!cameraEnabled}
                    className={`flex size-11 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-45 ${
                      cameraEnabled
                        ? "border-white/25 bg-white/10 text-white hover:bg-white/20"
                        : "border-red-400/40 bg-red-500 text-white hover:bg-red-600"
                    }`}
                    disabled={isJoining || !hasCameraTrack}
                    onClick={handleToggleCamera}
                    type="button"
                  >
                    {cameraEnabled ? (
                      <Video className="size-5" aria-hidden="true" />
                    ) : (
                      <VideoOff className="size-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
            <PermissionRow
              access={cameraAccess}
              enabled={cameraEnabled}
              icon={<Video className="size-4" aria-hidden="true" />}
              label="Camera"
            />
            <PermissionRow
              access={microphoneAccess}
              enabled={microphoneEnabled}
              icon={<Mic className="size-4" aria-hidden="true" />}
              label="Microphone"
            />
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 sm:p-7">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Customer support
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            Ready to meet your support agent?
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Your devices stay under your control. You can enter with either
            camera or microphone turned off.
          </p>

          <div className="mt-6 border-y border-zinc-200 py-4 dark:border-zinc-800">
            {inviteState === "loading" ? (
              <div className="flex items-center gap-3 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Verifying invite
              </div>
            ) : invite ? (
              <div className="grid gap-4">
                <div className="flex items-center gap-3">
                  <CalendarClock
                    className="size-4 shrink-0 text-zinc-400"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Session created
                    </p>
                    <p className="mt-0.5 text-sm font-semibold">
                      {formatSessionDate(invite.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ShieldCheck
                    className="size-4 shrink-0 text-zinc-400"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Invite
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-semibold">
                      {shortToken(token)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${
                      invite.status === "ACTIVE" &&
                      invite.agentReady &&
                      !invite.customerJoined
                        ? "bg-emerald-500"
                        : "bg-zinc-400"
                    }`}
                  />
                  <p className="text-sm font-semibold">
                    {invite.status === "ENDED"
                      ? "This support session has ended"
                      : invite.customerJoined
                        ? "This invite has already been used"
                        : invite.agentReady
                          ? "Agent room is ready"
                          : "Waiting for agent"}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {errorMessage && (
            <div className="mt-5 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
              <AlertCircle
                className="mt-0.5 size-5 shrink-0"
                aria-hidden="true"
              />
              <p className="text-sm leading-6">{errorMessage}</p>
            </div>
          )}

          <button
            className="mt-6 inline-flex h-13 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-base font-semibold text-white shadow-lg shadow-zinc-300 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
            disabled={!canJoin}
            onClick={() => void handleJoinSession()}
            type="button"
          >
            {isJoining ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <Video className="size-5" aria-hidden="true" />
            )}
            {isJoining ? "Joining..." : "Join Support Session"}
          </button>

          <button
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950"
            disabled={isJoining || isRetryingDevices}
            onClick={() => void handleRetryDevices()}
            type="button"
          >
            {isRetryingDevices ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            {isRetryingDevices ? "Checking devices..." : "Retry device access"}
          </button>
        </section>
      </div>
    </main>
  );
}
