import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ParticipantPresenceRegistry,
  type OfflinePresenceResult,
} from "../src/sockets/presenceRegistry.js";

const SESSION_ID = "session-1";
const AGENT_ID = "agent-1";
const CUSTOMER_ID = "customer-1";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function joinAgent(
  registry: ParticipantPresenceRegistry,
  socketId: string,
  participantId = AGENT_ID,
) {
  return registry.join({
    sessionId: SESSION_ID,
    participantId,
    role: "AGENT",
    socketId,
    transport: "websocket",
  });
}

function joinCustomer(
  registry: ParticipantPresenceRegistry,
  socketId: string,
  participantId = CUSTOMER_ID,
) {
  return registry.join({
    sessionId: SESSION_ID,
    participantId,
    role: "CUSTOMER",
    socketId,
    transport: "websocket",
  });
}

test("duplicate socket connections replace the old socket and keep one participant active", () => {
  const registry = new ParticipantPresenceRegistry(50);

  const firstJoin = joinAgent(registry, "socket-1");
  const replacementJoin = joinAgent(registry, "socket-2");

  assert.equal(firstJoin.action, "joined");
  assert.equal(replacementJoin.action, "replaced");
  assert.equal(replacementJoin.replacedSocketId, "socket-1");
  assert.equal(replacementJoin.activeCount, 1);
  assert.equal(replacementJoin.activeParticipants.length, 1);
  assert.equal(replacementJoin.participant.activeSocketId, "socket-2");
  assert.equal(replacementJoin.participant.connectionVersion, 2);
  assert.equal(registry.getPresenceBySocket("socket-1", SESSION_ID), null);
  assert.equal(
    registry.getPresenceBySocket("socket-2", SESSION_ID)?.participantId,
    AGENT_ID,
  );
});

test("browser refresh marks reconnecting and reconnects during grace without offline", async () => {
  const registry = new ParticipantPresenceRegistry(30);
  const expirations: OfflinePresenceResult[] = [];

  joinAgent(registry, "socket-before-refresh");
  const disconnectResults = registry.markSocketDisconnected(
    "socket-before-refresh",
    (result) => expirations.push(result),
  );

  assert.equal(disconnectResults.length, 1);
  assert.equal(disconnectResults[0]?.action, "reconnecting");
  assert.equal(disconnectResults[0]?.activeCount, 1);
  assert.equal(disconnectResults[0]?.participant.status, "reconnecting");
  assert.equal(disconnectResults[0]?.participant.activeSocketId, null);

  const reconnect = joinAgent(registry, "socket-after-refresh");

  assert.equal(reconnect.action, "reconnected");
  assert.equal(reconnect.activeCount, 1);
  assert.equal(reconnect.participant.status, "online");
  assert.equal(reconnect.participant.activeSocketId, "socket-after-refresh");

  await wait(50);

  assert.equal(expirations.length, 0);
  assert.equal(registry.getActiveCount(SESSION_ID), 1);
});

test("reconnect during grace cancels the reconnect timer", async () => {
  const registry = new ParticipantPresenceRegistry(25);
  const expirations: OfflinePresenceResult[] = [];

  joinCustomer(registry, "customer-socket-1");
  registry.markSocketDisconnected("customer-socket-1", (result) =>
    expirations.push(result),
  );

  await wait(10);
  const reconnect = joinCustomer(registry, "customer-socket-2");
  await wait(35);

  assert.equal(reconnect.action, "reconnected");
  assert.equal(expirations.length, 0);
  assert.equal(registry.getPresence(SESSION_ID, CUSTOMER_ID)?.status, "online");
  assert.equal(registry.getActiveCount(SESSION_ID), 1);
});

test("reconnect after grace emits offline and creates a fresh presence", async () => {
  const registry = new ParticipantPresenceRegistry(15);
  const expirations: OfflinePresenceResult[] = [];

  joinAgent(registry, "socket-1");
  registry.markSocketDisconnected("socket-1", (result) =>
    expirations.push(result),
  );

  await wait(35);

  assert.equal(expirations.length, 1);
  assert.equal(expirations[0]?.action, "offline");
  assert.equal(expirations[0]?.reason, "grace_expired");
  assert.equal(expirations[0]?.activeCount, 0);
  assert.equal(registry.getActiveCount(SESSION_ID), 0);

  const lateReconnect = joinAgent(registry, "socket-2");

  assert.equal(lateReconnect.action, "joined");
  assert.equal(lateReconnect.activeCount, 1);
  assert.equal(lateReconnect.participant.connectionVersion, 1);
});

test("participant replacement removes old socket ownership and preserves participant presence", () => {
  const registry = new ParticipantPresenceRegistry(50);

  const original = joinCustomer(registry, "old-socket");
  const replacement = joinCustomer(registry, "new-socket");

  assert.equal(original.participant.participantId, CUSTOMER_ID);
  assert.equal(replacement.action, "replaced");
  assert.equal(registry.getPresenceBySocket("old-socket", SESSION_ID), null);
  assert.equal(
    registry.getPresenceBySocket("new-socket", SESSION_ID)?.participantId,
    CUSTOMER_ID,
  );
  assert.equal(
    registry.getPresence(SESSION_ID, CUSTOMER_ID)?.joinedAt,
    original.participant.joinedAt,
  );
});

test("active count tracks unique participants across replacement and grace expiry", async () => {
  const registry = new ParticipantPresenceRegistry(20);

  joinAgent(registry, "agent-socket-1");
  joinCustomer(registry, "customer-socket-1");

  assert.equal(registry.getActiveCount(SESSION_ID), 2);

  const replacement = joinAgent(registry, "agent-socket-2");

  assert.equal(replacement.action, "replaced");
  assert.equal(replacement.activeCount, 2);
  assert.equal(registry.getActiveCount(SESSION_ID), 2);

  const reconnecting = registry.markSocketDisconnected(
    "customer-socket-1",
    () => undefined,
  );

  assert.equal(reconnecting[0]?.activeCount, 2);
  assert.equal(registry.getActiveCount(SESSION_ID), 2);

  await wait(40);

  assert.equal(registry.getActiveCount(SESSION_ID), 1);
  assert.deepEqual(
    registry
      .getActiveParticipants(SESSION_ID)
      .map((participant) => participant.participantId),
    [AGENT_ID],
  );
});
