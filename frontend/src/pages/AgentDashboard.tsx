import {
  AlertCircle,
  Check,
  CircleDot,
  Copy,
  LinkIcon,
  Loader2,
  Mic,
  Pause,
  PhoneCall,
  PhoneOff,
  Plus,
  Radio,
  RefreshCw,
  Square,
  UserRound,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createSession,
  endSession,
  getSession,
  getSessionApiErrorMessage,
} from "../api/sessions";
import type { Participant, ParticipantRole, SessionDetails } from "../types/session";

const CURRENT_SESSION_ID_STORAGE_KEY = "atomquest.agent.currentSessionId";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return dateFormatter.format(date);
}

function getInvitePath(token: string): string {
  return `/join/${encodeURIComponent(token)}`;
}

function shortId(value: string): string {
  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-5)}`;
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";

  document.body.appendChild(textArea);
  textArea.select();

  const wasCopied = document.execCommand("copy");
  document.body.removeChild(textArea);

  if (!wasCopied) {
    throw new Error("Unable to copy invite link.");
  }
}

function getParticipantByRole(
  participants: Participant[],
  role: ParticipantRole,
): Participant | null {
  return participants.find((participant) => participant.role === role) ?? null;
}

function buildAgentCallPath({
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
    role: "AGENT",
    initiator: "true",
  });

  return `/call?${params.toString()}`;
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 shadow-sm shadow-red-100 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200 dark:shadow-black/20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Session action failed</p>
            <p className="mt-1 text-sm leading-6 text-red-700 dark:text-red-200/80">
              {message}
            </p>
          </div>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-100 dark:hover:bg-red-950/50 dark:focus:ring-offset-zinc-950"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    </section>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
            {label}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function SessionStatusBadge({ session }: { session: SessionDetails }) {
  const isActive = session.status === "ACTIVE";

  return (
    <span
      className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${
        isActive
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
          : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      <CircleDot className="size-4" aria-hidden="true" />
      {session.status}
    </span>
  );
}

function EmptyWorkspace({
  isCreating,
  onCreate,
}: {
  isCreating: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="mx-auto flex size-16 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        <PhoneCall className="size-7" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
        No current customer session
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Create a session to generate an invite link and prepare the agent call
        room.
      </p>
      <button
        className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white shadow-lg shadow-zinc-300 transition hover:-translate-y-0.5 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
        disabled={isCreating}
        onClick={onCreate}
        type="button"
      >
        {isCreating ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        {isCreating ? "Creating..." : "Create Session"}
      </button>
    </section>
  );
}

function RecordingPlaceholder() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <Mic className="size-3.5" aria-hidden="true" />
            Recording
          </div>
          <h2 className="mt-3 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Controls placeholder
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500"
            disabled
            type="button"
          >
            <CircleDot className="size-4" aria-hidden="true" />
            Record
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500"
            disabled
            type="button"
          >
            <Pause className="size-4" aria-hidden="true" />
            Pause
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500"
            disabled
            type="button"
          >
            <Square className="size-4" aria-hidden="true" />
            Stop
          </button>
        </div>
      </div>
    </section>
  );
}

export default function AgentDashboard() {
  const navigate = useNavigate();
  const copiedTokenTimeoutRef = useRef<number | null>(null);
  const [storedSessionId] = useState<string | null>(() =>
    window.localStorage.getItem(CURRENT_SESSION_ID_STORAGE_KEY),
  );
  const [currentSession, setCurrentSession] = useState<SessionDetails | null>(
    null,
  );
  const [isRestoring, setIsRestoring] = useState(storedSessionId !== null);
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshSession = useCallback(
    async (sessionId: string, showLoading = true) => {
      if (showLoading) {
        setIsRefreshing(true);
      }

      try {
        const response = await getSession(sessionId);
        setCurrentSession(response.session);
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(getSessionApiErrorMessage(error));
      } finally {
        if (showLoading) {
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    if (!storedSessionId) {
      return () => {
        isMounted = false;
      };
    }

    const sessionId = storedSessionId;

    async function restoreCurrentSession() {
      try {
        const response = await getSession(sessionId);

        if (isMounted) {
          setCurrentSession(response.session);
        }
      } catch (error) {
        window.localStorage.removeItem(CURRENT_SESSION_ID_STORAGE_KEY);

        if (isMounted) {
          setErrorMessage(getSessionApiErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsRestoring(false);
        }
      }
    }

    void restoreCurrentSession();

    return () => {
      isMounted = false;
    };
  }, [storedSessionId]);

  useEffect(() => {
    return () => {
      if (copiedTokenTimeoutRef.current !== null) {
        window.clearTimeout(copiedTokenTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentSession || currentSession.status !== "ACTIVE") {
      return;
    }

    const sessionId = currentSession.id;
    const intervalId = window.setInterval(() => {
      void refreshSession(sessionId, false);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [currentSession, refreshSession]);

  const agentParticipant = useMemo(() => {
    return currentSession
      ? getParticipantByRole(currentSession.participants, "AGENT")
      : null;
  }, [currentSession]);

  const customerParticipant = useMemo(() => {
    return currentSession
      ? getParticipantByRole(currentSession.participants, "CUSTOMER")
      : null;
  }, [currentSession]);

  const hasActiveSession = currentSession?.status === "ACTIVE";
  const inviteLink = currentSession
    ? `${window.location.origin}${getInvitePath(currentSession.token)}`
    : "";
  const canOpenCall =
    hasActiveSession &&
    agentParticipant !== null &&
    customerParticipant !== null &&
    customerParticipant.leftAt === null;

  const interactionState = useMemo(() => {
    if (!currentSession) {
      return "No session";
    }

    if (currentSession.status === "ENDED") {
      return "Session ended";
    }

    if (customerParticipant?.leftAt === null) {
      return "Customer joined";
    }

    return "Waiting for customer";
  }, [currentSession, customerParticipant]);

  const handleCreateSession = async () => {
    setIsCreating(true);
    setErrorMessage(null);
    setCopiedToken(null);

    try {
      const response = await createSession();

      setCurrentSession(response.session);
      window.localStorage.setItem(
        CURRENT_SESSION_ID_STORAGE_KEY,
        response.session.id,
      );
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!currentSession) {
      return;
    }

    try {
      await copyTextToClipboard(inviteLink);
      setCopiedToken(currentSession.token);
      setErrorMessage(null);

      if (copiedTokenTimeoutRef.current !== null) {
        window.clearTimeout(copiedTokenTimeoutRef.current);
      }

      copiedTokenTimeoutRef.current = window.setTimeout(() => {
        setCopiedToken((token) =>
          token === currentSession.token ? null : token,
        );
        copiedTokenTimeoutRef.current = null;
      }, 2400);
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
    }
  };

  const handleOpenCall = () => {
    if (!currentSession || !agentParticipant || !customerParticipant) {
      setErrorMessage("A customer must join before the agent call can open.");
      return;
    }

    navigate(
      buildAgentCallPath({
        sessionId: currentSession.id,
        participantId: agentParticipant.id,
        targetParticipantId: customerParticipant.id,
      }),
    );
  };

  const handleEndCurrentSession = async () => {
    if (!currentSession || currentSession.status !== "ACTIVE") {
      return;
    }

    setIsEnding(true);
    setErrorMessage(null);

    try {
      const response = await endSession(currentSession.id);
      setCurrentSession(response.session);
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setIsEnding(false);
    }
  };

  const handleRetry = () => {
    if (currentSession) {
      void refreshSession(currentSession.id);
      return;
    }

    setErrorMessage(null);
  };

  return (
    <main className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                <Radio className="size-3.5" aria-hidden="true" />
                Call Agent
              </div>
              <h1 className="mt-4 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
                Call Agent Workspace
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                Manage the active customer interaction, invite link, call
                launch, and wrap-up from one focused workspace.
              </p>
            </div>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white shadow-lg shadow-zinc-300 transition hover:-translate-y-0.5 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
              disabled={isCreating || hasActiveSession}
              onClick={handleCreateSession}
              title={
                hasActiveSession
                  ? "End the current session before creating another."
                  : undefined
              }
              type="button"
            >
              {isCreating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              {isCreating ? "Creating..." : "Create Session"}
            </button>
          </div>
        </section>

        {errorMessage && (
          <ErrorState message={errorMessage} onRetry={handleRetry} />
        )}

        {isRestoring ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
            <div className="flex items-center gap-3 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading current session
            </div>
          </section>
        ) : currentSession ? (
          <>
            <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <SessionStatusBadge session={currentSession} />
                    <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                      <UserRound className="size-4" aria-hidden="true" />
                      {interactionState}
                    </span>
                  </div>
                  <h2 className="mt-4 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
                    Current Session
                  </h2>
                  <p className="mt-2 break-all font-mono text-sm text-zinc-500 dark:text-zinc-400">
                    {currentSession.id}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950"
                    disabled={isRefreshing}
                    onClick={() => void refreshSession(currentSession.id)}
                    type="button"
                  >
                    {isRefreshing ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="size-4" aria-hidden="true" />
                    )}
                    Refresh
                  </button>
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950"
                    disabled={currentSession.status !== "ACTIVE"}
                    onClick={handleCopyInviteLink}
                    type="button"
                  >
                    {copiedToken === currentSession.token ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                    {copiedToken === currentSession.token
                      ? "Copied"
                      : "Copy Invite Link"}
                  </button>
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white shadow-lg shadow-zinc-300 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
                    disabled={!canOpenCall}
                    onClick={handleOpenCall}
                    type="button"
                  >
                    <Video className="size-4" aria-hidden="true" />
                    Start/Open Call
                  </button>
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/15 dark:focus:ring-offset-zinc-950"
                    disabled={!hasActiveSession || isEnding}
                    onClick={handleEndCurrentSession}
                    type="button"
                  >
                    {isEnding ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <PhoneOff className="size-4" aria-hidden="true" />
                    )}
                    End Current Session
                  </button>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Invite Link
                    </p>
                    <p className="mt-1 break-all font-mono text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                      {inviteLink}
                    </p>
                  </div>
                  <LinkIcon
                    className="hidden size-5 shrink-0 text-zinc-400 sm:block"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <InfoTile
                icon={<UserRound className="size-4" aria-hidden="true" />}
                label="Agent"
                value={agentParticipant ? shortId(agentParticipant.id) : "Missing"}
              />
              <InfoTile
                icon={<UserRound className="size-4" aria-hidden="true" />}
                label="Customer"
                value={
                  customerParticipant
                    ? shortId(customerParticipant.id)
                    : "Not joined"
                }
              />
              <InfoTile
                icon={<Radio className="size-4" aria-hidden="true" />}
                label="Created"
                value={formatDate(currentSession.createdAt)}
              />
            </section>
          </>
        ) : (
          <EmptyWorkspace
            isCreating={isCreating}
            onCreate={handleCreateSession}
          />
        )}

        <RecordingPlaceholder />
      </div>
    </main>
  );
}
