import {
  CheckCircle2,
  Clock,
  HelpCircle,
  Home,
  KeyRound,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  UserRound,
  Video,
  VideoOff,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";

// ==========================================
// HELPERS
// ==========================================

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "Unavailable";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs} seconds`;
  return `${mins} min ${secs} sec`;
}

// Button styles matching AtomQuest design system
const primaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white shadow-lg shadow-zinc-300 transition hover:-translate-y-0.5 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950";

const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950";

// ==========================================
// 1. SESSION ENDED VIEW
// ==========================================

interface SessionEndedViewProps {
  role: "AGENT" | "CUSTOMER" | null;
  durationSeconds: number | null;
  endedAt: string | null;
  onAction: () => void;
}

export function SessionEndedView({
  role,
  durationSeconds,
  endedAt,
  onAction,
}: SessionEndedViewProps) {
  const isAgent = role === "AGENT";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f8fb] px-4 py-12 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50">
      <div className="w-full max-w-md scale-in rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 text-center animate-fade-in">
        {/* Double-ring Success Checkmark */}
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-400/10 border border-emerald-100 dark:border-emerald-400/20 shadow-inner">
          <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100/60 dark:bg-emerald-400/20 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-8" aria-hidden="true" />
          </div>
        </div>

        {/* Badging */}
        <span className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Session Completed
        </span>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Support Session Ended
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          This support session has been completed.
        </p>

        {/* Stats Grid */}
        <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800/80 dark:bg-zinc-950/30 text-left">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Duration
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              {formatDuration(durationSeconds)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Session End
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              {endedAt ? new Date(endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Recently"}
            </p>
          </div>
        </div>

        <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
          Your camera and microphone streams have been safely stopped. All media ports are closed.
        </p>

        {/* Call to Action */}
        <div className="mt-8">
          <button
            className={`${primaryButtonClass} w-full`}
            onClick={onAction}
            type="button"
          >
            {isAgent ? <Home className="size-4" /> : <X className="size-4" />}
            {isAgent ? "Return to Workspace" : "Close Window"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. INVALID INVITE LINK VIEW
// ==========================================

interface InvalidInviteViewProps {
  onContactSupport: () => void;
}

export function InvalidInviteView({
  onContactSupport,
}: InvalidInviteViewProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f8fb] px-4 py-12 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50">
      <div className="w-full max-w-md scale-in rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 text-center animate-fade-in">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <KeyRound className="size-8 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Invalid Invite Link
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          This support invitation is no longer available.
        </p>
        <p className="mt-2 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
          Please verify that the URL matches the link provided by your support agent, or request a new invite to connect.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <button
            className={`${primaryButtonClass} w-full`}
            onClick={onContactSupport}
            type="button"
          >
            <HelpCircle className="size-4" />
            Contact Support
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 3. ALREADY USED INVITE VIEW
// ==========================================

interface AlreadyUsedInviteViewProps {
  onRequestInvite: () => void;
}

export function AlreadyUsedInviteView({
  onRequestInvite,
}: AlreadyUsedInviteViewProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f8fb] px-4 py-12 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50">
      <div className="w-full max-w-md scale-in rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 text-center animate-fade-in">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-400/10 border border-amber-100 dark:border-amber-400/20">
          <XCircle className="size-8 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Invite Already Used
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          This support invitation has already been used to join a session.
        </p>
        <p className="mt-2 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
          For security and privacy, support links are single-use. If you got disconnected or need to re-enter, please request a new invite link.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <button
            className={`${primaryButtonClass} w-full`}
            onClick={onRequestInvite}
            type="button"
          >
            <RefreshCw className="size-4" />
            Request New Invite
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 4. SESSION EXPIRED VIEW
// ==========================================

interface SessionExpiredViewProps {
  onContactSupport: () => void;
}

export function SessionExpiredView({
  onContactSupport,
}: SessionExpiredViewProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f8fb] px-4 py-12 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50">
      <div className="w-full max-w-md scale-in rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 text-center animate-fade-in">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <Clock className="size-8 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Session No Longer Available
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          This support session has already ended.
        </p>
        <p className="mt-2 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
          The support session has expired or was completed by the support representative.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <button
            className={`${primaryButtonClass} w-full`}
            onClick={onContactSupport}
            type="button"
          >
            <HelpCircle className="size-4" />
            Contact Support
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 5. CONNECTION LOST VIEW
// ==========================================

interface ConnectionLostViewProps {
  onTryAgain: () => void;
  onLeave: () => void;
}

export function ConnectionLostView({
  onTryAgain,
  onLeave,
}: ConnectionLostViewProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f8fb] px-4 py-12 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50">
      <div className="w-full max-w-md scale-in rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 text-center animate-fade-in">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-red-50 dark:bg-red-400/10 border border-red-100 dark:border-red-400/20">
          <WifiOff className="size-8 text-red-600 dark:text-red-400" aria-hidden="true" />
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Connection Lost
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          We were unable to reconnect to the support session.
        </p>
        <p className="mt-2 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
          Please check your internet connection and try rejoining the call, or return home.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <button
            className={`${primaryButtonClass} w-full`}
            onClick={onTryAgain}
            type="button"
          >
            <RefreshCw className="size-4" />
            Try Again
          </button>
          <button
            className={`${secondaryButtonClass} w-full`}
            onClick={onLeave}
            type="button"
          >
            <X className="size-4" />
            Leave Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 6. CONNECTION LOST OVERLAY
// ==========================================

interface ConnectionLostOverlayProps {
  status: "connecting" | "reconnecting" | "restored";
}

export function ConnectionLostOverlay({ status }: ConnectionLostOverlayProps) {
  if (status === "restored") {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 rounded-full border border-emerald-500 bg-emerald-500/90 px-4 py-2 text-white shadow-lg backdrop-blur-sm transition-all duration-500 animate-bounce">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        <span className="text-xs font-semibold">Connection Restored</span>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-zinc-950/75 backdrop-blur-sm text-center px-6 transition-all duration-300">
      <div className="flex size-14 items-center justify-center rounded-full bg-zinc-900 border border-white/10 shadow-lg text-white">
        <Loader2 className="size-6 animate-spin text-emerald-400" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight text-white">
        {status === "reconnecting" ? "Reconnecting..." : "Connecting securely..."}
      </h3>
      <p className="mt-2 text-xs max-w-xs text-zinc-400">
        We lost you for a second. Attempting to restore your secure audio and video stream...
      </p>
    </div>
  );
}

// ==========================================
// 7. WAITING ROOM STAGE PLACEHOLDER
// ==========================================

interface WaitingRoomStageProps {
  role: "AGENT" | "CUSTOMER";
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
}

export function WaitingRoomStage({
  role,
  isCameraEnabled,
  isMicrophoneEnabled,
}: WaitingRoomStageProps) {
  const isAgent = role === "AGENT";

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 p-6 text-center text-zinc-100 select-none">
      {/* Center Badge Icon */}
      <div className="relative flex size-32 items-center justify-center rounded-full bg-zinc-800 border border-white/10 shadow-lg text-zinc-400">
        <UserRound className="size-16" aria-hidden="true" />
      </div>

      {/* Info Card */}
      <div className="mt-5 sm:mt-6 max-w-md">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl text-white">
          {isAgent ? "Waiting for customer to join" : "Waiting for support agent"}
        </h2>
      <p className="mt-2 text-sm leading-6 text-zinc-300 sm:text-base">
        The support session is active and secure. The call will start automatically as soon as the other participant connects.
      </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-zinc-200">
            {isCameraEnabled ? (
              <Video className="size-3.5 text-emerald-300" aria-hidden="true" />
            ) : (
              <VideoOff className="size-3.5 text-zinc-500" aria-hidden="true" />
            )}
            Camera {isCameraEnabled ? "ready" : "off"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-zinc-200">
            {isMicrophoneEnabled ? (
              <Mic className="size-3.5 text-emerald-300" aria-hidden="true" />
            ) : (
              <MicOff className="size-3.5 text-zinc-500" aria-hidden="true" />
            )}
            Mic {isMicrophoneEnabled ? "ready" : "muted"}
          </span>
        </div>
      </div>
    </div>
  );
}
