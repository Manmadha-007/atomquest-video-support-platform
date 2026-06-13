import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CircleDot,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Sparkles,
  UsersRound,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createSession,
  getSessionApiErrorMessage,
  getSessions,
  toSessionListItem,
} from "../api/sessions";
import type { SessionListItem, SessionStatus } from "../types/session";

const statusClasses: Record<SessionStatus, string> = {
  ACTIVE:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
  ENDED:
    "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

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

function shortId(value: string): string {
  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200/80 bg-white/85 p-5 shadow-sm shadow-zinc-200/60 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-black/20">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {value}
          </p>
        </div>
        <div className="flex size-11 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          {icon}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${statusClasses[status]}`}
    >
      <CircleDot className="size-3" aria-hidden="true" />
      {status}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="border-b border-zinc-200 px-6 py-5 dark:border-zinc-800">
        <div className="h-5 w-44 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-[1.2fr_0.75fr_1fr_0.6fr_0.6fr]"
            key={index}
          >
            <div className="h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
            <div className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
            <div className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
            <div className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800 shadow-sm shadow-red-100 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200 dark:shadow-black/20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Session service unavailable</p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-200/80">
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
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-14 text-center">
      <div className="relative mb-7 flex size-24 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700 shadow-inner dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        <Video className="size-10" aria-hidden="true" />
        <Sparkles
          className="absolute right-4 top-4 size-4 text-emerald-500"
          aria-hidden="true"
        />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        No sessions yet
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Create the first support session and it will appear here instantly.
      </p>
      <button
        className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white shadow-lg shadow-zinc-300 transition hover:-translate-y-0.5 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
        onClick={onCreate}
        type="button"
      >
        <Plus className="size-4" aria-hidden="true" />
        Create Session
      </button>
    </div>
  );
}

function SessionsTable({ sessions }: { sessions: SessionListItem[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-6 py-5 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Sessions
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Live list from the backend session service.
          </p>
        </div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {sessions.length} total
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[820px] w-full text-left">
          <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:bg-zinc-950/55 dark:text-zinc-400">
            <tr>
              <th className="px-6 py-4">Session</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Created</th>
              <th className="px-6 py-4 text-right">People</th>
              <th className="px-6 py-4 text-right">Messages</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sessions.map((session) => (
              <tr
                className="transition hover:bg-zinc-50/80 dark:hover:bg-zinc-800/45"
                key={session.id}
              >
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                      <Video className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                        {shortId(session.id)}
                      </p>
                      <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {session.id}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5">
                  <StatusBadge status={session.status} />
                </td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                    <CalendarClock
                      className="size-4 text-zinc-400"
                      aria-hidden="true"
                    />
                    {formatDate(session.createdAt)}
                  </div>
                </td>
                <td className="px-6 py-5 text-right text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {session.participantCount}
                </td>
                <td className="px-6 py-5 text-right text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {session.messageCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AgentDashboard() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await getSessions();
      setSessions(response.sessions);
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialSessions() {
      try {
        const response = await getSessions();

        if (isMounted) {
          setSessions(response.sessions);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(getSessionApiErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialSessions();

    return () => {
      isMounted = false;
    };
  }, []);

  const totals = useMemo(() => {
    return {
      active: sessions.filter((session) => session.status === "ACTIVE").length,
      participants: sessions.reduce(
        (sum, session) => sum + session.participantCount,
        0,
      ),
      messages: sessions.reduce((sum, session) => sum + session.messageCount, 0),
    };
  }, [sessions]);

  const handleCreateSession = async () => {
    setIsCreating(true);
    setErrorMessage(null);

    try {
      const response = await createSession();
      const createdSession = toSessionListItem(response.session);

      setSessions((currentSessions) => [
        createdSession,
        ...currentSessions.filter((session) => session.id !== createdSession.id),
      ]);
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const hasSessions = sessions.length > 0;

  return (
    <main className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="flex flex-col gap-5 rounded-lg border border-zinc-200/80 bg-white/80 p-6 shadow-sm shadow-zinc-200/60 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-black/20 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Agent Console
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-4xl">
                AtomQuest session dashboard
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
                Monitor support sessions and spin up a fresh agent room from one
                clean workspace.
              </p>
            </div>

            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white shadow-lg shadow-zinc-300 transition hover:-translate-y-0.5 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
              disabled={isCreating}
              onClick={handleCreateSession}
              type="button"
            >
              {isCreating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              {isCreating ? "Creating..." : "Create Session"}
              {!isCreating && (
                <ArrowUpRight className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard
            icon={<CircleDot className="size-5" aria-hidden="true" />}
            label="Active sessions"
            value={totals.active.toLocaleString()}
          />
          <StatCard
            icon={<UsersRound className="size-5" aria-hidden="true" />}
            label="Participants"
            value={totals.participants.toLocaleString()}
          />
          <StatCard
            icon={<MessageSquareText className="size-5" aria-hidden="true" />}
            label="Messages"
            value={totals.messages.toLocaleString()}
          />
        </section>

        {errorMessage && (
          <ErrorState message={errorMessage} onRetry={fetchSessions} />
        )}

        {isLoading ? (
          <LoadingSkeleton />
        ) : hasSessions ? (
          <SessionsTable sessions={sessions} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
            <EmptyState onCreate={handleCreateSession} />
          </div>
        )}
      </div>
    </main>
  );
}
