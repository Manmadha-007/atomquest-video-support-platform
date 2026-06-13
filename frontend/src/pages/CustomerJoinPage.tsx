import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getSessionApiErrorMessage, joinSession } from "../api/sessions";
import type { JoinSessionResponse } from "../types/session";

type JoinState = "idle" | "loading" | "success" | "error";

function formatReference(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function StatusPanel({
  joinState,
  errorMessage,
  joinedSession,
}: {
  joinState: JoinState;
  errorMessage: string | null;
  joinedSession: JoinSessionResponse | null;
}) {
  if (joinState === "success" && joinedSession) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">You joined the session</p>
            <p className="mt-1 text-sm leading-6 text-emerald-700 dark:text-emerald-200/80">
              Customer participant{" "}
              <span className="font-mono">
                {formatReference(joinedSession.participant.id)}
              </span>{" "}
              joined with invite token{" "}
              <span className="font-mono">
                {formatReference(joinedSession.session.token)}
              </span>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (joinState === "error" && errorMessage) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Unable to join session</p>
            <p className="mt-1 text-sm leading-6 text-red-700 dark:text-red-200/80">
              {errorMessage}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300">
      <div className="flex gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
            Secure invite check
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            AtomQuest will verify this token with the session service before
            opening your customer seat.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CustomerJoinPage() {
  const { token: routeToken } = useParams<{ token: string }>();
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [joinedSession, setJoinedSession] =
    useState<JoinSessionResponse | null>(null);

  const token = useMemo(() => routeToken ?? "", [routeToken]);
  const isLoading = joinState === "loading";
  const isSuccess = joinState === "success";
  const hasToken = token.length > 0;

  const handleJoinSession = async () => {
    if (!hasToken) {
      setJoinState("error");
      setErrorMessage("A session token is required in the invite URL.");
      return;
    }

    setJoinState("loading");
    setErrorMessage(null);
    setJoinedSession(null);

    try {
      const response = await joinSession({ token });
      setJoinedSession(response);
      setJoinState("success");
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
      setJoinState("error");
    }
  };

  return (
    <main className="flex min-h-screen items-center bg-[#f7f8fb] px-4 py-8 text-zinc-950 dark:bg-[#101216] dark:text-zinc-50 sm:px-6 lg:px-8">
      <section className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[0.82fr_1.18fr] lg:items-stretch">
        <div className="rounded-lg border border-zinc-200/80 bg-white/75 p-6 shadow-sm shadow-zinc-200/60 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-black/20 sm:p-7">
          <div className="flex h-full flex-col justify-between gap-10">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Customer Invite
              </div>
              <h1 className="mt-5 text-3xl font-semibold text-zinc-950 dark:text-zinc-50 sm:text-4xl">
                Join your AtomQuest support session
              </h1>
              <p className="mt-4 text-base leading-7 text-zinc-600 dark:text-zinc-400">
                Confirm your invite token and enter the live customer session
                when your support agent is ready.
              </p>
            </div>

            <div className="grid gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  <KeyRound className="size-4" aria-hidden="true" />
                </div>
                Token-based session access
              </div>
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  <Video className="size-4" aria-hidden="true" />
                </div>
                Ready for the next support step
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                Session Token
              </p>
              <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/70">
                <p className="break-all font-mono text-sm font-semibold text-zinc-950 dark:text-zinc-50 sm:text-base">
                  {hasToken ? token : "Missing token"}
                </p>
              </div>
            </div>
            <div className="hidden size-12 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 sm:flex">
              <KeyRound className="size-5" aria-hidden="true" />
            </div>
          </div>

          <div className="mt-6">
            <StatusPanel
              errorMessage={errorMessage}
              joinedSession={joinedSession}
              joinState={joinState}
            />
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white shadow-lg shadow-zinc-300 transition hover:-translate-y-0.5 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 dark:bg-white dark:text-zinc-950 dark:shadow-black/30 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
              disabled={isLoading || !hasToken || isSuccess}
              onClick={handleJoinSession}
              type="button"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : isSuccess ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              {isLoading ? "Joining..." : isSuccess ? "Joined" : "Join Session"}
              {!isLoading && !isSuccess && (
                <ArrowRight className="size-4" aria-hidden="true" />
              )}
            </button>

            <Link
              className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950"
              to="/"
            >
              Agent dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
