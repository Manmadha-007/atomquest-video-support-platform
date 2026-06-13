import {
  AlertCircle,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessagesSquare,
  Paperclip,
  SendHorizontal,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  getFileDownloadUrl,
  getSessionApiErrorMessage,
  getSessionMessages,
  uploadChatFile,
} from "../api/sessions";
import type { ParticipantRole, SessionMessage } from "../types/session";
import {
  WebRtcSignalingError,
  type SessionChatNewPayload,
  type WebRtcSignalingClient,
} from "../webrtc";

const MAX_MESSAGE_CONTENT_LENGTH = 4_000;
const MAX_FILE_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "pdf",
  "doc",
  "docx",
  "txt",
]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const FILE_INPUT_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt";

interface InCallChatWidgetProps {
  canSend: boolean;
  isSessionEnded: boolean;
  participantId: string;
  role: ParticipantRole | null;
  sessionId: string;
  signalingClient: WebRtcSignalingClient | null;
  visible?: boolean;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  onUnreadCountChange?: (count: number) => void;
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function getMessageTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return timeFormatter.format(date);
}

function formatUnreadCount(unreadCount: number): string {
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

function getChatErrorMessage(error: unknown): string {
  if (error instanceof WebRtcSignalingError) {
    return `[${error.code}] ${error.message}`;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unable to send message.";
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(fileName: string): string {
  const extension = fileName.split(".").pop();
  return extension ? extension.toLowerCase() : "";
}

function validateFileBeforeUpload(file: File): string | null {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return "Unsupported file type. Share jpg, jpeg, png, webp, pdf, doc, docx, or txt files.";
  }

  if (file.size > MAX_FILE_UPLOAD_SIZE_BYTES) {
    return "File must be 25 MB or smaller.";
  }

  if (file.size === 0) {
    return "File cannot be empty.";
  }

  return null;
}

function ChatMessageBubble({ message }: { message: SessionMessage }) {
  const isAgentMessage = message.role === "AGENT";
  const attachment = message.attachment;
  const isImage =
    attachment !== null && IMAGE_EXTENSIONS.has(attachment.extension);
  const downloadUrl = attachment ? getFileDownloadUrl(attachment) : null;

  return (
    <article
      className={`flex ${isAgentMessage ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[82%] rounded-lg px-3 py-2 shadow-sm ${
          isAgentMessage
            ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
            : "border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        }`}
      >
        {message.kind === "FILE" && attachment ? (
          <div className="min-w-0">
            {isImage && downloadUrl && (
              <a
                className="mb-2 block overflow-hidden rounded-md border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5"
                href={downloadUrl}
                rel="noreferrer"
                target="_blank"
              >
                <img
                  alt={attachment.originalName}
                  className="max-h-44 w-full object-cover"
                  loading="lazy"
                  src={downloadUrl}
                />
              </a>
            )}
            <div
              className={`flex items-center gap-3 rounded-md border p-2 ${
                isAgentMessage
                  ? "border-white/15 bg-white/10 dark:border-zinc-900/10 dark:bg-zinc-950/5"
                  : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
              }`}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-500">
                {isImage ? (
                  <ImageIcon className="size-4" aria-hidden="true" />
                ) : (
                  <FileText className="size-4" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {attachment.originalName}
                </p>
                <p
                  className={`mt-0.5 text-[11px] ${
                    isAgentMessage
                      ? "text-white/65 dark:text-zinc-600"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {attachment.extension.toUpperCase()} |{" "}
                  {formatFileSize(attachment.sizeBytes)}
                </p>
              </div>
              {downloadUrl && (
                <a
                  aria-label={`Download ${attachment.originalName}`}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                    isAgentMessage
                      ? "bg-white/15 hover:bg-white/25 dark:bg-zinc-900/10 dark:hover:bg-zinc-900/15"
                      : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                  href={downloadUrl}
                >
                  <Download className="size-4" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-6">
            {message.content}
          </p>
        )}
        <div
          className={`mt-1 flex items-center gap-2 text-[11px] font-medium ${
            isAgentMessage
              ? "text-white/65 dark:text-zinc-600"
              : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          <span>{message.role === "AGENT" ? "Agent" : "Customer"}</span>
          <span aria-hidden="true">|</span>
          <time dateTime={message.createdAt}>
            {getMessageTimestamp(message.createdAt)}
          </time>
        </div>
      </div>
    </article>
  );
}

function sortMessages(messages: SessionMessage[]): SessionMessage[] {
  return [...messages].sort((first, second) => {
    const firstTime = Date.parse(first.createdAt);
    const secondTime = Date.parse(second.createdAt);
    const safeFirstTime = Number.isNaN(firstTime) ? 0 : firstTime;
    const safeSecondTime = Number.isNaN(secondTime) ? 0 : secondTime;

    if (safeFirstTime !== safeSecondTime) {
      return safeFirstTime - safeSecondTime;
    }

    return first.id.localeCompare(second.id);
  });
}

function mergeMessages(
  existingMessages: SessionMessage[],
  nextMessages: SessionMessage[],
): SessionMessage[] {
  const messagesById = new Map<string, SessionMessage>();

  for (const message of existingMessages) {
    messagesById.set(message.id, message);
  }

  for (const message of nextMessages) {
    messagesById.set(message.id, message);
  }

  return sortMessages(Array.from(messagesById.values()));
}

export default function InCallChatWidget({
  canSend,
  isSessionEnded,
  participantId,
  role,
  sessionId,
  signalingClient,
  visible = true,
  isOpen: isOpenProp,
  onOpenChange,
  onUnreadCountChange,
}: InCallChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [shouldPulse, setShouldPulse] = useState(false);
  const effectiveIsOpen = isOpenProp ?? isOpen;
  const isOpenRef = useRef(isOpen);
  const pulseTimeoutRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const trimmedDraft = draft.trim();
  const canSubmit =
    canSend &&
    !isSending &&
    !isUploadingFile &&
    sessionId.length > 0 &&
    participantId.length > 0 &&
    trimmedDraft.length > 0;
  const sendDisabledReason = useMemo(() => {
    if (canSend) {
      return null;
    }

    if (isSessionEnded) {
      return "Chat history is read-only after the call ends.";
    }

    if (!signalingClient) {
      return "Join media to connect chat.";
    }

    return "Chat is read-only for this session.";
  }, [canSend, isSessionEnded, signalingClient]);

  const loadHistoryFromInteraction = useCallback(async () => {
    if (sessionId.length === 0) {
      return;
    }

    setIsHistoryLoading(true);

    try {
      const response = await getSessionMessages(sessionId);
      setMessages((currentMessages) =>
        mergeMessages(currentMessages, response.messages),
      );
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getSessionApiErrorMessage(error));
    } finally {
      setIsHistoryLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    isOpenRef.current = effectiveIsOpen;
  }, [effectiveIsOpen]);

  useEffect(() => {
    let isCancelled = false;

    if (sessionId.length === 0) {
      return () => {
        isCancelled = true;
      };
    }

    async function loadHistoryOnRefresh(): Promise<void> {
      try {
        const response = await getSessionMessages(sessionId);

        if (isCancelled) {
          return;
        }

        setMessages((currentMessages) =>
          mergeMessages(currentMessages, response.messages),
        );
        setErrorMessage(null);
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(getSessionApiErrorMessage(error));
        }
      }
    }

    void loadHistoryOnRefresh();

    return () => {
      isCancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!signalingClient) {
      return undefined;
    }

    return signalingClient.onChatMessage((payload: SessionChatNewPayload) => {
      if (payload.sessionId !== sessionId) {
        return;
      }

      setMessages((currentMessages) =>
        mergeMessages(currentMessages, [payload.message]),
      );
      setErrorMessage(null);

      if (!isOpenRef.current) {
        setUnreadCount((currentCount) => currentCount + 1);
        setShouldPulse(true);

        if (pulseTimeoutRef.current !== null) {
          window.clearTimeout(pulseTimeoutRef.current);
        }

        pulseTimeoutRef.current = window.setTimeout(() => {
          setShouldPulse(false);
          pulseTimeoutRef.current = null;
        }, 1600);
      }
    });
  }, [sessionId, signalingClient]);

  useEffect(() => {
    if (!effectiveIsOpen) {
      return;
    }

    messagesEndRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [effectiveIsOpen, messages]);

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [unreadCount, onUnreadCountChange]);

  const handleOpen = () => {
    setIsOpen(true);
    onOpenChange?.(true);
    setUnreadCount(0);
    setShouldPulse(false);
    void loadHistoryFromInteraction();
  };

  const handleClose = () => {
    setIsOpen(false);
    onOpenChange?.(false);
  };

  const handleSendMessage = useCallback(async () => {
    if (!canSubmit || !signalingClient) {
      return;
    }

    const content = trimmedDraft;

    setIsSending(true);
    setErrorMessage(null);

    try {
      const payload = await signalingClient.sendChatMessage({
        sessionId,
        participantId,
        content,
      });

      setMessages((currentMessages) =>
        mergeMessages(currentMessages, [payload.message]),
      );
      setDraft("");
    } catch (error) {
      setErrorMessage(getChatErrorMessage(error));
    } finally {
      setIsSending(false);
    }
  }, [canSubmit, participantId, sessionId, signalingClient, trimmedDraft]);

  const handleSelectFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }

      const validationMessage = validateFileBeforeUpload(file);

      if (validationMessage) {
        setErrorMessage(validationMessage);
        return;
      }

      if (!canSend || sessionId.length === 0 || participantId.length === 0) {
        setErrorMessage("Join an active session before sharing files.");
        return;
      }

      setIsUploadingFile(true);
      setUploadProgress(0);
      setErrorMessage(null);

      try {
        const response = await uploadChatFile({
          sessionId,
          participantId,
          file,
          onUploadProgress: setUploadProgress,
        });

        setMessages((currentMessages) =>
          mergeMessages(currentMessages, [response.message]),
        );
        setUploadProgress(100);
      } catch (error) {
        setErrorMessage(getSessionApiErrorMessage(error));
      } finally {
        setIsUploadingFile(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [canSend, participantId, sessionId],
  );

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void handleSendMessage();
  };

  return (
    <>
      <section
        aria-label="In-call chat"
        className={`
          dark
          fixed inset-0 z-50 flex h-full w-full flex-col overflow-hidden bg-white dark:bg-zinc-950
          sm:inset-x-auto sm:right-6 sm:bottom-24 sm:h-[min(600px,calc(100vh-8rem))] sm:w-[min(400px,calc(100vw-2rem))] sm:rounded-lg
          lg:relative lg:inset-auto lg:h-full lg:rounded-[24px] lg:shadow-none lg:border-zinc-800/80 lg:bg-zinc-900/30 lg:backdrop-blur-md
          transition-all duration-500 ease-in-out
          ${
            effectiveIsOpen
              ? "visible opacity-100 translate-y-0 lg:w-[360px] lg:opacity-100 lg:translate-x-0 lg:ml-3 sm:lg:ml-4"
              : "invisible opacity-0 translate-y-6 pointer-events-none lg:w-0 lg:opacity-0 lg:translate-x-4 lg:pointer-events-none lg:ml-0"
          }
        `}
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white shadow-sm dark:bg-white dark:text-zinc-950">
              <MessagesSquare className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Support chat
              </h2>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {role ? `${role.toLowerCase()} participant` : "Session chat"}
              </p>
            </div>
          </div>
          <button
            aria-label="Close chat"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950"
            onClick={handleClose}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto bg-zinc-50 px-4 py-4 dark:bg-zinc-900/70">
          {isHistoryLoading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              Loading chat
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-zinc-500 dark:text-zinc-400">
              No messages yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((message) => (
                <ChatMessageBubble key={message.id} message={message} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <footer className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          {errorMessage && (
            <div className="mb-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}
          {sendDisabledReason && (
            <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {sendDisabledReason}
            </p>
          )}
          {isUploadingFile && (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
              <div className="flex items-center justify-between gap-3">
                <span>Uploading file</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-200/70 dark:bg-emerald-950">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              accept={FILE_INPUT_ACCEPT}
              aria-label="Attach file"
              className="sr-only"
              disabled={!canSend || isUploadingFile}
              onChange={(event) => {
                void handleSelectFile(event.target.files?.[0]);
              }}
              ref={fileInputRef}
              type="file"
            />
            <button
              aria-label="Attach file"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950 dark:disabled:bg-zinc-900/60"
              disabled={!canSend || isUploadingFile}
              onClick={() => fileInputRef.current?.click()}
              title="Attach jpg, png, webp, pdf, doc, docx, or txt"
              type="button"
            >
              {isUploadingFile ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="size-4" aria-hidden="true" />
              )}
            </button>
            <textarea
              aria-label="Message"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:disabled:bg-zinc-900/60"
              disabled={!canSend || isSending || isUploadingFile}
              maxLength={MAX_MESSAGE_CONTENT_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleDraftKeyDown}
              placeholder="Type a message"
              rows={1}
              value={draft}
            />
            <button
              aria-label="Send message"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none dark:focus:ring-offset-zinc-950 dark:disabled:bg-zinc-700"
              disabled={!canSubmit}
              onClick={() => void handleSendMessage()}
              type="button"
            >
              {isSending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <SendHorizontal className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </footer>
      </section>

      <button
        aria-label={effectiveIsOpen ? "Chat open" : "Open chat"}
        className={`fixed right-4 bottom-24 z-50 size-12 sm:size-14 items-center justify-center rounded-full bg-zinc-700/60 text-white shadow-2xl shadow-black/45 transition-all duration-500 ease-in-out hover:bg-zinc-700/80 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent sm:right-6 sm:bottom-6 ${
          effectiveIsOpen ? "hidden" : "hidden lg:flex"
        } ${
          shouldPulse ? "animate-pulse" : ""
        } ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 pointer-events-none translate-y-6"
        }`}
        onClick={effectiveIsOpen ? handleClose : handleOpen}
        type="button"
      >
        {shouldPulse && (
          <span className="absolute inset-0 rounded-full bg-emerald-400/35 animate-ping" />
        )}
        <MessagesSquare className="relative size-6" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-500 px-1.5 text-[11px] font-bold leading-5 text-white dark:border-zinc-950">
            {formatUnreadCount(unreadCount)}
          </span>
        )}
      </button>
    </>
  );
}
