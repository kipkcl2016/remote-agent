import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import type {
  AdapterEvent,
  AdapterLaunchRequest,
  AgentAdapter,
  AgentAvailability,
  AgentUsage,
  RunningAgent,
} from "../src/types.js";

class FakeCodexAdapter implements AgentAdapter {
  readonly kind = "codex" as const;
  readonly label = "Codex";
  readonly command = "fake-codex";
  readonly supportsNativeHistory = true;
  launchCount = 0;

  async detect(): Promise<AgentAvailability> {
    return {
      kind: this.kind,
      label: this.label,
      command: this.command,
      installed: true,
      version: "test",
      supportsNativeHistory: true,
      permissionModes: ["plan", "ask", "auto"],
    };
  }

  async launch(
    request: AdapterLaunchRequest,
    emit: (event: AdapterEvent) => void,
  ): Promise<RunningAgent> {
    this.launchCount += 1;
    emit({
      type: "status",
      payload: { status: "running" },
      nativeId: request.nativeId ?? "native-codex-session",
    });
    emit({ type: "output", payload: { stream: "assistant", text: `Handled: ${request.prompt}` } });
    emit({ type: "completed", payload: { source: "fake" } });
    return { done: Promise.resolve(), cancel: () => undefined };
  }
}

test("gateway pairs a device and serves the session lifecycle", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-gateway-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "reports"), { recursive: true });
  writeFileSync(join(workspace, "reports", "check.txt"), "authenticated file preview", "utf8");
  writeFileSync(join(root, "outside.txt"), "must stay private", "utf8");
  const store = new GatewayStore(join(root, "gateway.sqlite"));
  const events = new EventHub();
  const adapter = new FakeCodexAdapter();
  const service = new GatewayService(store, new AgentRegistry([adapter]), events, [root]);
  const historyDirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    codexArchived: join(root, "codex-archived"),
  };
  mkdirSync(join(historyDirs.codex, "2026", "08", "04"), { recursive: true });
  const nativeId = "11111111-1111-4111-8111-111111111111";
  const nativePath = join(
    historyDirs.codex,
    "2026",
    "08",
    "04",
    `rollout-test-${nativeId}.jsonl`,
  );
  writeFileSync(
    nativePath,
    [
      JSON.stringify({
        timestamp: "2026-08-04T01:00:00.000Z",
        type: "session_meta",
        payload: { id: nativeId, cwd: workspace, timestamp: "2026-08-04T01:00:00.000Z" },
      }),
      JSON.stringify({
        timestamp: "2026-08-04T01:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Review the native history" },
      }),
      "",
    ].join("\n"),
  );
  const history = new NativeHistoryService(historyDirs, [root]);
  const usage: AgentUsage[] = [
    {
      agent: "cursor",
      state: "unavailable",
      windows: [],
      message: "无法获取额度信息 · Cursor CLI 暂无个人额度接口",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      agent: "claude",
      state: "unavailable",
      windows: [],
      message: "无法获取额度信息 · API 模式没有套餐额度",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      agent: "codex",
      state: "available",
      windows: [
        { label: "5 小时", remainingPercent: 72, resetsAt: "2026-08-11T05:00:00.000Z" },
        { label: "每周", remainingPercent: 41, resetsAt: "2026-08-17T00:00:00.000Z" },
      ],
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
  ];
  const server = createGatewayHttpServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      dataDir: root,
      allowedRoots: [root],
      allowedOrigins: ["http://localhost:4173"],
      pairingTtlMs: 60_000,
      maxBodyBytes: 100_000,
      historyDirs,
    },
    service,
    pairing: new PairingManager(60_000),
    events,
    history,
    usage: { list: async () => usage },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    mkdirSync(join(root, ".git"));
    const health = await fetch(`${baseUrl}/v1/health`);
    assert.equal(health.status, 200);

    const unauthorized = await fetch(`${baseUrl}/v1/sessions`);
    assert.equal(unauthorized.status, 401);

    const pairingStart = await fetch(`${baseUrl}/v1/pairing/start`, { method: "POST" });
    assert.equal(pairingStart.status, 201);
    const pairingBody = (await pairingStart.json()) as { data: { code: string } };

    const pairingConfirm = await fetch(`${baseUrl}/v1/pairing/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairingBody.data.code, deviceName: "Test iPhone" }),
    });
    assert.equal(pairingConfirm.status, 201);
    const tokenBody = (await pairingConfirm.json()) as { data: { token: string } };
    const authorization = { Authorization: `Bearer ${tokenBody.data.token}` };

    const pairedDevices = await fetch(`${baseUrl}/v1/devices`, { headers: authorization });
    assert.equal(pairedDevices.status, 200);
    const pairedDevicesBody = (await pairedDevices.json()) as {
      data: Array<{ id: string; name: string; current: boolean }>;
    };
    assert.equal(pairedDevicesBody.data.length, 1);
    assert.equal(pairedDevicesBody.data[0]?.name, "Test iPhone");
    assert.equal(pairedDevicesBody.data[0]?.current, true);

    const agents = await fetch(`${baseUrl}/v1/agents`, { headers: authorization });
    assert.equal(agents.status, 200);
    const agentsBody = (await agents.json()) as { data: AgentAvailability[] };
    assert.equal(agentsBody.data[0]?.installed, true);

    const agentUsage = await fetch(`${baseUrl}/v1/agents/usage`, { headers: authorization });
    assert.equal(agentUsage.status, 200);
    const agentUsageBody = (await agentUsage.json()) as { data: AgentUsage[] };
    assert.deepEqual(agentUsageBody.data, usage);

    const gatewayConfig = await fetch(`${baseUrl}/v1/config`, { headers: authorization });
    assert.equal(gatewayConfig.status, 200);
    const configBody = (await gatewayConfig.json()) as { data: { allowedRoots: string[] } };
    assert.deepEqual(configBody.data.allowedRoots, [root]);

    const nativeHistory = await fetch(`${baseUrl}/v1/history`, { headers: authorization });
    assert.equal(nativeHistory.status, 200);
    const historyBody = (await nativeHistory.json()) as {
      data: Array<{
        id: string;
        agent: string;
        resumable: boolean;
        status?: string;
        projectId?: string;
        projectName?: string;
      }>;
    };
    assert.deepEqual(historyBody.data.map((entry) => entry.id), [nativeId]);
    assert.equal(historyBody.data[0]?.agent, "codex");
    assert.equal(historyBody.data[0]?.resumable, true);
    assert.equal(historyBody.data[0]?.status, "running");
    assert.equal(historyBody.data[0]?.projectName, root.split("/").at(-1));
    assert.match(historyBody.data[0]?.projectId ?? "", /^[a-f0-9]{64}$/);

    const nativeSnapshot = await fetch(
      `${baseUrl}/v1/history/codex/${nativeId}/snapshot?limit=100`,
      { headers: authorization },
    );
    assert.equal(nativeSnapshot.status, 200);
    const nativeSnapshotBody = (await nativeSnapshot.json()) as {
      data: { session: { status?: string }; messages: Array<{ text: string }> };
    };
    assert.equal(nativeSnapshotBody.data.session.status, "running");
    assert.deepEqual(nativeSnapshotBody.data.messages.map((message) => message.text), [
      "Review the native history",
    ]);
    appendFileSync(nativePath, [
      JSON.stringify({
        timestamp: "2026-08-04T01:00:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "Native output arrived" },
      }),
      JSON.stringify({
        timestamp: "2026-08-04T01:00:03.000Z",
        type: "event_msg",
        payload: { type: "task_complete" },
      }),
      "",
    ].join("\n"));
    const completedSnapshot = await fetch(
      `${baseUrl}/v1/history/codex/${nativeId}/snapshot?limit=100`,
      { headers: authorization },
    );
    const completedSnapshotBody = (await completedSnapshot.json()) as {
      data: { session: { status?: string }; messages: Array<{ text: string }> };
    };
    assert.equal(completedSnapshotBody.data.session.status, "completed");
    assert.equal(completedSnapshotBody.data.messages.at(-1)?.text, "Native output arrived");

    const created = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "codex",
        cwd: workspace,
        prompt: "Inspect the test project",
        permissionMode: "plan",
      }),
    });
    assert.equal(created.status, 202);
    const createdBody = (await created.json()) as {
      data: { id: string; nativeId?: string; projectId?: string; projectName?: string };
    };
    assert.equal(createdBody.data.nativeId, "native-codex-session");
    assert.equal(createdBody.data.projectId, historyBody.data[0]?.projectId);
    assert.equal(createdBody.data.projectName, historyBody.data[0]?.projectName);

    const unauthorizedFile = await fetch(
      `${baseUrl}/v1/sessions/${createdBody.data.id}/files/read`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "./reports/check.txt" }),
      },
    );
    assert.equal(unauthorizedFile.status, 401);

    const sessionFile = await fetch(
      `${baseUrl}/v1/sessions/${createdBody.data.id}/files/read`,
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "./reports/check.txt" }),
      },
    );
    assert.equal(sessionFile.status, 200);
    assert.match(sessionFile.headers.get("content-type") ?? "", /^text\/plain/);
    assert.equal(sessionFile.headers.get("x-remote-agent-filename"), "check.txt");
    assert.equal(await sessionFile.text(), "authenticated file preview");

    const escapedFile = await fetch(
      `${baseUrl}/v1/sessions/${createdBody.data.id}/files/read`,
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "../outside.txt" }),
      },
    );
    assert.equal(escapedFile.status, 403);
    assert.doesNotMatch(await escapedFile.text(), /outside\.txt|remote-agent-gateway-/);

    const nativeFile = await fetch(
      `${baseUrl}/v1/history/codex/${nativeId}/files/read`,
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "./reports/check.txt" }),
      },
    );
    assert.equal(nativeFile.status, 200);
    assert.equal(await nativeFile.text(), "authenticated file preview");

    const sessions = await fetch(`${baseUrl}/v1/sessions`, { headers: authorization });
    const sessionsBody = (await sessions.json()) as { data: Array<{ id: string }> };
    assert.equal(sessionsBody.data.length, 1);

    const storedEvents = await fetch(
      `${baseUrl}/v1/sessions/${createdBody.data.id}/events`,
      { headers: authorization },
    );
    const eventsBody = (await storedEvents.json()) as { data: Array<{ type: string }> };
    assert.ok(eventsBody.data.some((event) => event.type === "output"));
    assert.ok(eventsBody.data.some((event) => event.type === "completed"));

    await new Promise<void>((resolve) => setImmediate(resolve));
    const continued = await fetch(`${baseUrl}/v1/sessions/${createdBody.data.id}/messages`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Continue with the next check" }),
    });
    assert.equal(continued.status, 202);
    assert.equal(adapter.launchCount, 2);

    const resumed = await fetch(`${baseUrl}/v1/history/codex/${nativeId}/resume`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Continue the native session", permissionMode: "ask" }),
    });
    assert.equal(resumed.status, 202);
    const resumedBody = (await resumed.json()) as { data: { nativeId?: string } };
    assert.equal(resumedBody.data.nativeId, nativeId);
    assert.equal(adapter.launchCount, 3);

    const controller = new AbortController();
    const streamResponse = await fetch(
      `${baseUrl}/v1/sessions/${createdBody.data.id}/events`,
      {
        headers: { ...authorization, Accept: "text/event-stream" },
        signal: controller.signal,
      },
    );
    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body?.getReader();
    assert.ok(reader);
    const firstChunk = await reader.read();
    assert.match(new TextDecoder().decode(firstChunk.value), /connected|event:/);
    controller.abort();

    const currentDeviceId = pairedDevicesBody.data[0]?.id;
    assert.ok(currentDeviceId);
    const revoked = await fetch(`${baseUrl}/v1/devices/${currentDeviceId}/revoke`, {
      method: "POST",
      headers: authorization,
    });
    assert.equal(revoked.status, 200);
    const rejectedAfterRevocation = await fetch(`${baseUrl}/v1/devices`, {
      headers: authorization,
    });
    assert.equal(rejectedAfterRevocation.status, 401);
  } finally {
    service.stop();
    server.close();
    await once(server, "close");
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
