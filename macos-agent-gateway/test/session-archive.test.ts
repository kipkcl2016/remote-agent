import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { AgentRegistry } from "../src/agent-registry.js";
import { EventHub } from "../src/event-hub.js";
import { createGatewayHttpServer } from "../src/http.js";
import { NativeHistoryService } from "../src/history.js";
import { PairingManager } from "../src/security.js";
import { GatewayService } from "../src/service.js";
import { GatewayStore } from "../src/store.js";
import { createDeviceToken, hashToken } from "../src/security.js";
import type { AgentAdapter, AgentAvailability, AdapterLaunchRequest, RunningAgent } from "../src/types.js";

class IdleAdapter implements AgentAdapter {
  readonly kind = "cursor" as const;
  readonly label = "Cursor";
  readonly command = "fake-cursor";
  readonly supportsNativeHistory = true;

  async detect(): Promise<AgentAvailability> {
    return {
      kind: this.kind,
      label: this.label,
      command: this.command,
      installed: true,
      supportsNativeHistory: true,
      permissionModes: ["plan", "ask", "auto", "full"],
    };
  }

  async launch(
    _request: AdapterLaunchRequest,
    _emit: () => void,
  ): Promise<RunningAgent> {
    return { done: Promise.resolve(), cancel: () => undefined };
  }
}

test("session archive stores alias keys and filters sessions per device", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-archive-store-"));
  const store = new GatewayStore(join(root, "gateway.sqlite"));
  const deviceA = "device-a";
  const deviceB = "device-b";
  store.addDevice(deviceA, "Phone A", hashToken("token-a"));
  store.addDevice(deviceB, "Phone B", hashToken("token-b"));

  const now = "2026-10-10T00:00:00.000Z";
  store.createSession({
    id: "gw-1",
    nativeId: "native-1",
    agent: "cursor",
    title: "Test",
    cwd: root,
    permissionMode: "ask",
    status: "completed",
    createdAt: now,
    updatedAt: now,
  });
  store.createSession({
    id: "gw-running",
    agent: "codex",
    title: "Running",
    cwd: root,
    permissionMode: "ask",
    status: "running",
    createdAt: now,
    updatedAt: now,
  });

  store.archiveSession(deviceA, "cursor", "gw-1", "native-1", now);
  const records = store.listSessionArchive(deviceA);
  assert.deepEqual(
    records.map((record) => record.sessionKey).sort(),
    ["gw-1", "native-1"],
  );

  const events = new EventHub();
  const service = new GatewayService(store, new AgentRegistry([new IdleAdapter()]), events, [root]);
  const activeForA = service.listSessions({ deviceId: deviceA, visibility: "active" });
  const archivedForA = service.listSessions({ deviceId: deviceA, visibility: "archived" });
  assert.equal(activeForA.some((session) => session.id === "gw-1"), false);
  assert.equal(archivedForA.some((session) => session.id === "gw-1"), true);
  assert.equal(service.listSessions({ deviceId: deviceB, visibility: "active" }).length, 2);

  assert.equal(store.restoreSession(deviceA, "cursor", "gw-1", "native-1"), true);
  assert.equal(service.listSessions({ deviceId: deviceA, visibility: "active" }).length, 2);
  rmSync(root, { recursive: true, force: true });
});

test("session archive HTTP rejects running sessions and scopes by bearer device", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-archive-http-"));
  const store = new GatewayStore(join(root, "gateway.sqlite"));
  const tokenA = createDeviceToken();
  const tokenB = createDeviceToken();
  store.addDevice("phone-a", "Phone A", hashToken(tokenA));
  store.addDevice("phone-b", "Phone B", hashToken(tokenB));
  const now = new Date().toISOString();
  store.createSession({
    id: "done-session",
    nativeId: "done-native",
    agent: "cursor",
    title: "Done",
    cwd: root,
    permissionMode: "ask",
    status: "completed",
    createdAt: now,
    updatedAt: now,
  });
  store.createSession({
    id: "running-session",
    agent: "codex",
    title: "Running",
    cwd: root,
    permissionMode: "ask",
    status: "running",
    createdAt: now,
    updatedAt: now,
  });

  const events = new EventHub();
  const service = new GatewayService(store, new AgentRegistry([new IdleAdapter()]), events, [root]);
  const historyDirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    cursorComposerDb: join(root, "missing.vscdb"),
    cursorTranscripts: join(root, "cursor-transcripts"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    workbuddyDb: join(root, "workbuddy.db"),
    workbuddyProjects: join(root, "workbuddy-projects"),
  };
  const history = new NativeHistoryService(historyDirs, [root]);
  const server = createGatewayHttpServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      dataDir: root,
      allowedOrigins: [],
      allowedRoots: [root],
      pairingTtlMs: 60_000,
      maxBodyBytes: 1_048_576,
      historyDirs,
    },
    service,
    pairing: new PairingManager(),
    events,
    history,
    usage: { list: async () => [] },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authA = { Authorization: `Bearer ${tokenA}` };

  try {
    const blocked = await fetch(`${baseUrl}/v1/session-archive`, {
      method: "POST",
      headers: { ...authA, "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "codex", id: "running-session" }),
    });
    assert.equal(blocked.status, 409);

    const archived = await fetch(`${baseUrl}/v1/session-archive`, {
      method: "POST",
      headers: { ...authA, "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "cursor", id: "done-session", nativeId: "done-native" }),
    });
    assert.equal(archived.status, 200);

    const activeSessions = await fetch(`${baseUrl}/v1/sessions?visibility=active`, { headers: authA });
    const activeBody = (await activeSessions.json()) as { data: Array<{ id: string }> };
    assert.equal(activeBody.data.some((session) => session.id === "done-session"), false);

    const archivedSessions = await fetch(`${baseUrl}/v1/sessions?visibility=archived`, { headers: authA });
    const archivedBody = (await archivedSessions.json()) as { data: Array<{ id: string }> };
    assert.equal(archivedBody.data.some((session) => session.id === "done-session"), true);

    const listArchive = await fetch(`${baseUrl}/v1/session-archive`, { headers: authA });
    const listBody = (await listArchive.json()) as { data: Array<{ sessionKey: string }> };
    assert.equal(listBody.data.length, 2);

    const otherDeviceActive = await fetch(`${baseUrl}/v1/sessions?visibility=active`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const otherBody = (await otherDeviceActive.json()) as { data: unknown[] };
    assert.equal(otherBody.data.length, 2);

    const restored = await fetch(`${baseUrl}/v1/session-archive/restore`, {
      method: "POST",
      headers: { ...authA, "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "cursor", id: "done-session", nativeId: "done-native" }),
    });
    assert.equal(restored.status, 200);
  } finally {
    server.close();
    await once(server, "close");
    rmSync(root, { recursive: true, force: true });
  }
});
