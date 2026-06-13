import type {
  ActiveSessionParticipant,
  ParticipantLeaveReason,
  ParticipantPresenceStatus,
  ParticipantUpdateAction,
  SocketParticipantRole,
} from "./types.js";

export const DEFAULT_RECONNECT_GRACE_MS = 15_000;

type TimerHandle = ReturnType<typeof setTimeout>;

interface PresenceEntry {
  presence: ActiveSessionParticipant;
  reconnectTimer: TimerHandle | null;
}

interface JoinPresenceInput {
  sessionId: string;
  participantId: string;
  role: SocketParticipantRole;
  socketId: string;
  transport: string;
}

interface LeavePresenceInput {
  sessionId: string;
  participantId?: string;
  socketId: string;
}

interface PresenceSnapshot {
  sessionId: string;
  participant: ActiveSessionParticipant;
  activeParticipants: ActiveSessionParticipant[];
  activeCount: number;
}

export interface JoinPresenceResult extends PresenceSnapshot {
  action: Extract<
    ParticipantUpdateAction,
    "joined" | "reconnected" | "replaced"
  >;
  replacedSocketId: string | null;
}

export interface LeavePresenceResult extends PresenceSnapshot {
  action: Extract<ParticipantUpdateAction, "left">;
  reason: Extract<ParticipantLeaveReason, "client_leave">;
}

export interface ReconnectingPresenceResult extends PresenceSnapshot {
  action: Extract<ParticipantUpdateAction, "reconnecting">;
  reason: Extract<ParticipantLeaveReason, "disconnect">;
}

export interface OfflinePresenceResult extends PresenceSnapshot {
  action: Extract<ParticipantUpdateAction, "offline">;
  reason: Extract<ParticipantLeaveReason, "grace_expired">;
}

export type PresenceExpirationHandler = (result: OfflinePresenceResult) => void;

function toPresenceKey(sessionId: string, participantId: string): string {
  return `${sessionId}:${participantId}`;
}

function getNowIso(): string {
  return new Date().toISOString();
}

function getDisconnectDeadline(graceMs: number): string {
  return new Date(Date.now() + graceMs).toISOString();
}

function clonePresence(
  presence: ActiveSessionParticipant,
): ActiveSessionParticipant {
  return {
    ...presence,
  };
}

export class ParticipantPresenceRegistry {
  private readonly reconnectGraceMs: number;
  private readonly sessions = new Map<string, Map<string, PresenceEntry>>();
  private readonly socketIndex = new Map<string, Set<string>>();

  public constructor(reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS) {
    this.reconnectGraceMs = reconnectGraceMs;
  }

  public join(input: JoinPresenceInput): JoinPresenceResult {
    const now = getNowIso();
    const key = toPresenceKey(input.sessionId, input.participantId);
    const sessionParticipants = this.getOrCreateSession(input.sessionId);
    const existingEntry = sessionParticipants.get(input.participantId);
    const existingPresence = existingEntry?.presence;
    const replacedSocketId =
      existingPresence?.activeSocketId &&
      existingPresence.activeSocketId !== input.socketId
        ? existingPresence.activeSocketId
        : null;

    if (existingEntry?.reconnectTimer) {
      clearTimeout(existingEntry.reconnectTimer);
      existingEntry.reconnectTimer = null;
    }

    if (replacedSocketId) {
      this.removeSocketIndex(replacedSocketId, key);
    }

    const action = this.getJoinAction(existingPresence, input.socketId);
    const connectionVersion =
      existingPresence && existingPresence.activeSocketId !== input.socketId
        ? existingPresence.connectionVersion + 1
        : existingPresence?.connectionVersion ?? 1;
    const presence: ActiveSessionParticipant = {
      sessionId: input.sessionId,
      participantId: input.participantId,
      role: input.role,
      activeSocketId: input.socketId,
      status: "online",
      connectionVersion,
      joinedAt: existingPresence?.joinedAt ?? now,
      lastSeenAt: now,
      disconnectDeadline: null,
      transport: input.transport,
    };

    sessionParticipants.set(input.participantId, {
      presence,
      reconnectTimer: null,
    });
    this.addSocketIndex(input.socketId, key);

    return {
      action,
      sessionId: input.sessionId,
      participant: clonePresence(presence),
      activeParticipants: this.getActiveParticipants(input.sessionId),
      activeCount: this.getActiveCount(input.sessionId),
      replacedSocketId,
    };
  }

  public leave(input: LeavePresenceInput): LeavePresenceResult | null {
    const entry = this.findEntryBySocket(input.socketId, input.sessionId);

    if (!entry) {
      return null;
    }

    if (
      input.participantId !== undefined &&
      input.participantId !== entry.presence.participantId
    ) {
      return null;
    }

    this.clearReconnectTimer(entry);
    this.removeSocketIndex(input.socketId, entry.key);

    const offlinePresence = this.toStatus(entry.presence, "offline", {
      activeSocketId: null,
      disconnectDeadline: null,
    });

    this.deleteEntry(entry.presence.sessionId, entry.presence.participantId);

    return {
      action: "left",
      reason: "client_leave",
      sessionId: offlinePresence.sessionId,
      participant: offlinePresence,
      activeParticipants: this.getActiveParticipants(offlinePresence.sessionId),
      activeCount: this.getActiveCount(offlinePresence.sessionId),
    };
  }

  public markSocketDisconnected(
    socketId: string,
    onExpired: PresenceExpirationHandler,
  ): ReconnectingPresenceResult[] {
    const indexedKeys = Array.from(this.socketIndex.get(socketId) ?? []);
    const results: ReconnectingPresenceResult[] = [];

    for (const key of indexedKeys) {
      const entry = this.getEntryByKey(key);

      if (!entry || entry.presence.activeSocketId !== socketId) {
        this.removeSocketIndex(socketId, key);
        continue;
      }

      const disconnectDeadline = getDisconnectDeadline(this.reconnectGraceMs);

      this.removeSocketIndex(socketId, key);
      entry.presence = this.toStatus(entry.presence, "reconnecting", {
        activeSocketId: null,
        disconnectDeadline,
      });
      this.clearReconnectTimer(entry);

      const expectedConnectionVersion = entry.presence.connectionVersion;
      entry.reconnectTimer = setTimeout(() => {
        const expired = this.expireReconnectGrace(
          key,
          expectedConnectionVersion,
        );

        if (expired) {
          onExpired(expired);
        }
      }, this.reconnectGraceMs);

      results.push({
        action: "reconnecting",
        reason: "disconnect",
        sessionId: entry.presence.sessionId,
        participant: clonePresence(entry.presence),
        activeParticipants: this.getActiveParticipants(entry.presence.sessionId),
        activeCount: this.getActiveCount(entry.presence.sessionId),
      });
    }

    return results;
  }

  public getActiveParticipants(sessionId: string): ActiveSessionParticipant[] {
    const sessionParticipants = this.sessions.get(sessionId);

    if (!sessionParticipants) {
      return [];
    }

    return Array.from(sessionParticipants.values())
      .map((entry) => clonePresence(entry.presence))
      .filter((participant) => participant.status !== "offline");
  }

  public getActiveCount(sessionId: string): number {
    return this.getActiveParticipants(sessionId).length;
  }

  public getPresence(
    sessionId: string,
    participantId: string,
  ): ActiveSessionParticipant | null {
    const presence = this.sessions.get(sessionId)?.get(participantId)?.presence;
    return presence ? clonePresence(presence) : null;
  }

  public getPresenceBySocket(
    socketId: string,
    sessionId: string,
  ): ActiveSessionParticipant | null {
    const presence = this.findEntryBySocket(socketId, sessionId)?.presence;
    return presence ? clonePresence(presence) : null;
  }

  private getJoinAction(
    existingPresence: ActiveSessionParticipant | undefined,
    socketId: string,
  ): JoinPresenceResult["action"] {
    if (!existingPresence || existingPresence.status === "offline") {
      return "joined";
    }

    if (existingPresence.status === "reconnecting") {
      return "reconnected";
    }

    if (
      existingPresence.status === "online" &&
      existingPresence.activeSocketId !== socketId
    ) {
      return "replaced";
    }

    return "joined";
  }

  private expireReconnectGrace(
    key: string,
    expectedConnectionVersion: number,
  ): OfflinePresenceResult | null {
    const entry = this.getEntryByKey(key);

    if (
      !entry ||
      entry.presence.status !== "reconnecting" ||
      entry.presence.connectionVersion !== expectedConnectionVersion
    ) {
      return null;
    }

    entry.reconnectTimer = null;
    const offlinePresence = this.toStatus(entry.presence, "offline", {
      activeSocketId: null,
      disconnectDeadline: null,
    });

    this.deleteEntry(offlinePresence.sessionId, offlinePresence.participantId);

    return {
      action: "offline",
      reason: "grace_expired",
      sessionId: offlinePresence.sessionId,
      participant: offlinePresence,
      activeParticipants: this.getActiveParticipants(offlinePresence.sessionId),
      activeCount: this.getActiveCount(offlinePresence.sessionId),
    };
  }

  private toStatus(
    presence: ActiveSessionParticipant,
    status: ParticipantPresenceStatus,
    overrides: Pick<
      ActiveSessionParticipant,
      "activeSocketId" | "disconnectDeadline"
    >,
  ): ActiveSessionParticipant {
    return {
      ...presence,
      status,
      activeSocketId: overrides.activeSocketId,
      disconnectDeadline: overrides.disconnectDeadline,
      lastSeenAt: getNowIso(),
    };
  }

  private getOrCreateSession(
    sessionId: string,
  ): Map<string, PresenceEntry> {
    const existingSession = this.sessions.get(sessionId);

    if (existingSession) {
      return existingSession;
    }

    const sessionParticipants = new Map<string, PresenceEntry>();
    this.sessions.set(sessionId, sessionParticipants);
    return sessionParticipants;
  }

  private getEntryByKey(
    key: string,
  ): (PresenceEntry & { key: string }) | null {
    const [sessionId, participantId] = key.split(":");
    const entry = this.sessions.get(sessionId)?.get(participantId);

    return entry ? Object.assign(entry, { key }) : null;
  }

  private findEntryBySocket(
    socketId: string,
    sessionId: string,
  ): (PresenceEntry & { key: string }) | null {
    const indexedKeys = this.socketIndex.get(socketId);

    if (!indexedKeys) {
      return null;
    }

    for (const key of indexedKeys) {
      const entry = this.getEntryByKey(key);

      if (entry?.presence.sessionId === sessionId) {
        return entry;
      }
    }

    return null;
  }

  private addSocketIndex(socketId: string, key: string): void {
    const existingKeys = this.socketIndex.get(socketId) ?? new Set<string>();
    existingKeys.add(key);
    this.socketIndex.set(socketId, existingKeys);
  }

  private removeSocketIndex(socketId: string, key: string): void {
    const existingKeys = this.socketIndex.get(socketId);

    if (!existingKeys) {
      return;
    }

    existingKeys.delete(key);

    if (existingKeys.size === 0) {
      this.socketIndex.delete(socketId);
    }
  }

  private clearReconnectTimer(entry: PresenceEntry): void {
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
  }

  private deleteEntry(sessionId: string, participantId: string): void {
    const sessionParticipants = this.sessions.get(sessionId);

    if (!sessionParticipants) {
      return;
    }

    sessionParticipants.delete(participantId);

    if (sessionParticipants.size === 0) {
      this.sessions.delete(sessionId);
    }
  }
}

export const participantPresenceRegistry =
  new ParticipantPresenceRegistry(DEFAULT_RECONNECT_GRACE_MS);
