import {
  AlertCircle,
  CalendarClock,
  CircleDot,
  Clock3,
  Download,
  FileClock,
  Loader2,
  Paperclip,
  PhoneOff,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  UsersRound,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  endSession,
  getFileAttachments,
  getFileDownloadUrl,
  getRecordingDownloadUrl,
  getRecordings,
  getSessionApiErrorMessage,
  getSessions,
  toSessionListItem,
} from "../api/sessions";
import type {
  FileAttachment,
  Recording,
  RecordingStatus,
  SessionListItem,
  SessionStatus,
} from "../types/session";

const statusClasses: Record<SessionStatus, string> = {
  ACTIVE:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
  ENDED:
    "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const recordingStatusClasses: Record<RecordingStatus, string> = {
  RECORDING:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200",
  PROCESSING:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  READY:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  FAILED:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200",
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDate(value: string | null): string {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return dateFormatter.format(date);
}

function formatDuration({
  createdAt,
  endedAt,
  now,
}: {
  createdAt: string;
  endedAt: string | null;
  now: number;
}): string {
  const started = new Date(createdAt).getTime();
  const ended = endedAt ? new Date(endedAt).getTime() : now;

  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return "Unavailable";
  }

  const totalSeconds = Math.max(0, Math.floor((ended - started) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

function shortId(value: string): string {
  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-5)}`;
}

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${statusClasses[status]}`}
    >
      <CircleDot className="size-3" aria-hidden="true" />
      {status}
    </span>
  );
}

function RecordingStatusBadge({ status }: { status: RecordingStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${recordingStatusClasses[status]}`}
    >
      {status === "PROCESSING" ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <CircleDot className="size-3" aria-hidden="true" />
      )}
      {status}
    </span>
  );
}

function formatFileSize(value: number | null): string {
  if (value === null) {
    return "Pending";
  }

  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function FilesTable({ files }: { files: FileAttachment[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="flex items-end justify-between gap-4 border-b border-zinc-200 px-6 py-5 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-semibold">Shared Files</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Files shared through session chat and retained after completion.
          </p>
        </div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {files.length} total
        </p>
      </div>
      {files.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm font-medium text-zinc-500 dark:text-zinc-400">
          No shared files yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500 dark:bg-zinc-950/55 dark:text-zinc-400">
              <tr>
                <th className="px-6 py-4">File</th>
                <th className="px-6 py-4">Session</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Size</th>
                <th className="px-6 py-4">Shared</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {files.map((file) => (
                <tr
                  className="transition hover:bg-zinc-50/80 dark:hover:bg-zinc-800/45"
                  key={file.id}
                >
                  <td className="px-6 py-5">
                    <p className="max-w-xs truncate text-sm font-semibold">
                      {file.originalName}
                    </p>
                    <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {shortId(file.id)}
                    </p>
                  </td>
                  <td className="px-6 py-5 font-mono text-sm font-semibold">
                    {shortId(file.sessionId)}
                  </td>
                  <td className="px-6 py-5 text-sm uppercase text-zinc-600 dark:text-zinc-300">
                    {file.extension}
                  </td>
                  <td className="px-6 py-5 text-sm font-medium">
                    {formatFileSize(file.sizeBytes)}
                  </td>
                  <td className="px-6 py-5 text-sm text-zinc-600 dark:text-zinc-300">
                    {formatDate(file.createdAt)}
                  </td>
                  <td className="px-6 py-5 text-right">
                    <a
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                      href={getFileDownloadUrl(file)}
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecordingsTable({
  now,
  recordings,
}: {
  now: number;
  recordings: Recording[];
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="flex items-end justify-between gap-4 border-b border-zinc-200 px-6 py-5 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-semibold">Recording History</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Persisted call recordings and processing outcomes.
          </p>
        </div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {recordings.length} total
        </p>
      </div>
      {recordings.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm font-medium text-zinc-500 dark:text-zinc-400">
          No recordings yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500 dark:bg-zinc-950/55 dark:text-zinc-400">
              <tr>
                <th className="px-6 py-4">Session</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Started</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4">Size</th>
                <th className="px-6 py-4 text-right">File</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {recordings.map((recording) => {
                const downloadUrl = getRecordingDownloadUrl(recording);

                return (
                  <tr
                    className="transition hover:bg-zinc-50/80 dark:hover:bg-zinc-800/45"
                    key={recording.id}
                  >
                    <td className="px-6 py-5">
                      <p className="font-mono text-sm font-semibold">
                        {shortId(recording.sessionId)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {shortId(recording.id)}
                      </p>
                    </td>
                    <td className="px-6 py-5">
                      <RecordingStatusBadge status={recording.status} />
                      {recording.failureReason && (
                        <p className="mt-2 max-w-xs text-xs text-red-600 dark:text-red-300">
                          {recording.failureReason}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-5 text-sm text-zinc-600 dark:text-zinc-300">
                      {formatDate(recording.startedAt)}
                    </td>
                    <td className="px-6 py-5 text-sm font-medium">
                      {recording.durationMs === null
                        ? "Pending"
                        : formatDuration({
                            createdAt: recording.startedAt,
                            endedAt:
                              recording.stoppedAt ??
                              new Date(
                                new Date(recording.startedAt).getTime() +
                                  recording.durationMs,
                              ).toISOString(),
                            now,
                          })}
                    </td>
                    <td className="px-6 py-5 text-sm font-medium">
                      {formatFileSize(recording.sizeBytes)}
                    </td>
                    <td className="px-6 py-5 text-right">
                      {downloadUrl ? (
                        <a
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                          href={downloadUrl}
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                          Download
                        </a>
                      ) : (
                        <span className="text-sm text-zinc-400">Unavailable</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          {icon}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
            {value}
          </p>
        </div>
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
    <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 shadow-sm shadow-red-100 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200 dark:shadow-black/20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Operations data unavailable</p>
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

function LoadingTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="border-b border-zinc-200 px-6 py-5 dark:border-zinc-800">
        <div className="h-5 w-44 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-[1.2fr_0.6fr_0.6fr_0.7fr_1fr_0.7fr]"
            key={index}
          >
            {Array.from({ length: 6 }).map((__, itemIndex) => (
              <div
                className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70"
                key={itemIndex}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionsTable({
  description,
  emptyLabel,
  endingSessionId,
  now,
  onForceEnd,
  sessions,
  title,
}: {
  description: string;
  emptyLabel: string;
  endingSessionId: string | null;
  now: number;
  onForceEnd?: (session: SessionListItem) => void;
  sessions: SessionListItem[];
  title: string;
}) {
  const hasForceEndAction = onForceEnd !== undefined;

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-6 py-5 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {title}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        </div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {sessions.length} total
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {emptyLabel}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500 dark:bg-zinc-950/55 dark:text-zinc-400">
              <tr>
                <th className="px-6 py-4">Session ID</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Participants</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4 text-right">
                  {hasForceEndAction ? "Action" : "Ended"}
                </th>
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
                  <td className="px-6 py-5 text-right text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {session.participantCount}
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                      <Clock3
                        className="size-4 text-zinc-400"
                        aria-hidden="true"
                      />
                      {formatDuration({
                        createdAt: session.createdAt,
                        endedAt: session.endedAt,
                        now,
                      })}
                    </div>
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
                  <td className="px-6 py-5 text-right">
                    {hasForceEndAction ? (
                      <button
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/15 dark:focus:ring-offset-zinc-950"
                        disabled={endingSessionId === session.id}
                        onClick={() => onForceEnd(session)}
                        type="button"
                      >
                        {endingSessionId === session.id ? (
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <PhoneOff className="size-3.5" aria-hidden="true" />
                        )}
                        Force End
                      </button>
                    ) : (
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {formatDate(session.endedAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function OperationsDashboard() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadSessions = useCallback(async () => {
    try {
      const [sessionsResponse, recordingsResponse, filesResponse] =
        await Promise.all([
          getSessions(),
          getRecordings(),
          getFileAttachments(),
        ]);
      setSessions(sessionsResponse.sessions);
      setRecordings(recordingsResponse.recordings);
      setFiles(filesResponse.files);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSessions();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadSessions]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadSessions();
      setNow(Date.now());
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadSessions]);

  const { activeSessions, endedSessions, totals } = useMemo(() => {
    const active = sessions.filter((session) => session.status === "ACTIVE");
    const ended = sessions.filter((session) => session.status === "ENDED");

    return {
      activeSessions: active,
      endedSessions: ended,
      totals: {
        active: active.length,
        ended: ended.length,
        recordings: recordings.length,
        files: files.length,
        participants: sessions.reduce(
          (sum, session) => sum + session.participantCount,
          0,
        ),
      },
    };
  }, [files.length, recordings.length, sessions]);

  const handleForceEnd = async (session: SessionListItem) => {
    setEndingSessionId(session.id);
    setErrorMessage(null);

    try {
      const response = await endSession(session.id);
      const endedSession = toSessionListItem(response.session);

      setSessions((currentSessions) =>
        currentSessions.map((currentSession) =>
          currentSession.id === endedSession.id ? endedSession : currentSession,
        ),
      );
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setEndingSessionId(null);
    }
  };

  const handleRefresh = () => {
    setIsLoading(true);
    void loadSessions();
  };

  return (
    <main className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300">
                <ShieldAlert className="size-3.5" aria-hidden="true" />
                Operations
              </div>
              <h1 className="mt-4 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
                Operations Dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                Monitor live sessions, history, participant volume, durations,
                and session termination from the operations view.
              </p>
            </div>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950"
              disabled={isLoading}
              onClick={handleRefresh}
              type="button"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              Refresh
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Metric
            icon={<CircleDot className="size-4" aria-hidden="true" />}
            label="Live Sessions"
            value={totals.active.toLocaleString()}
          />
          <Metric
            icon={<UsersRound className="size-4" aria-hidden="true" />}
            label="Participants"
            value={totals.participants.toLocaleString()}
          />
          <Metric
            icon={<FileClock className="size-4" aria-hidden="true" />}
            label="History"
            value={totals.ended.toLocaleString()}
          />
          <Metric
            icon={<Video className="size-4" aria-hidden="true" />}
            label="Recordings"
            value={totals.recordings.toLocaleString()}
          />
          <Metric
            icon={<Paperclip className="size-4" aria-hidden="true" />}
            label="Shared Files"
            value={totals.files.toLocaleString()}
          />
        </section>

        {errorMessage && (
          <ErrorState
            message={errorMessage}
            onRetry={handleRefresh}
          />
        )}

        {isLoading ? (
          <LoadingTable />
        ) : (
          <>
            <SessionsTable
              description="Active sessions currently available from the backend session service."
              emptyLabel="No live sessions."
              endingSessionId={endingSessionId}
              now={now}
              onForceEnd={handleForceEnd}
              sessions={activeSessions}
              title="Live Sessions"
            />

            <SessionsTable
              description="Ended sessions retained in session history."
              emptyLabel="No ended sessions yet."
              endingSessionId={endingSessionId}
              now={now}
              sessions={endedSessions}
              title="Session History"
            />
            <FilesTable files={files} />
            <RecordingsTable now={now} recordings={recordings} />
          </>
        )}

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                <ScrollText className="size-3.5" aria-hidden="true" />
                Event Logs
              </div>
              <h2 className="mt-3 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                Placeholder
              </h2>
            </div>
            <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              session.created / session.joined / session.ended
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
