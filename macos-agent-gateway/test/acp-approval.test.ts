import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRegistry } from "../src/agent-registry.js";
import { EventHub } from "../src/event-hub.js";
import { createGatewayHttpServer } from "../src/http.js";
import { NativeHistoryService } from "../src/history.js";
import { PairingManager } from "../src/security.js";
import { GatewayService } from "../src/service.js";
import { GatewayStore } from "../src/store.js";
import { createClaudeAcpAdapter } from "../src/adapters/claude-acp.js";
import {
  autoSelectPermissionOption,
  pickDecisionOptionId,
} from "../src/adapters/acp/permission-policy.js";
import { mapAcpSessionUpdate } from "../src/adapters/acp/map-session-update.js";
import type { AgentUsage } from "../src/types.js";

const mockAgentPath = fileURLToPath(
  new URL("./fixtures/mock-acp-agent.mjs", import.meta.url),
);

test("[APPROVAL-001] permission policy auto-allows full and low-risk auto reads", () => {
  const options = [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" as const },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" as const },
  ];
  assert.equal(
    autoSelectPermissionOption("full", { kind: "execute" }, options),
    "allow-once",
  );
  assert.equal(
    autoSelectPermissionOption("auto", { kind: "read" }, options),
    "allow-once",
  );
  assert.equal(
    autoSelectPermissionOption("ask", { kind: "execute" }, options),
    undefined,
  );
  assert.equal(pickDecisionOptionId("deny", options), "reject-once");
  assert.equal(pickDecisionOptionId("allow", options), "allow-once");
});

test("[APPROVAL-001] ACP session updates map to gateway events", () => {
  const deltas = mapAcpSessionUpdate({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "hi" },
  });
  assert.deepEqual(deltas, [
    { type: "output", payload: { stream: "assistant_delta", text: "hi" } },
  ]);
  const tool = mapAcpSessionUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "c1",
    name: "Bash",
    kind: "execute",
    status: "pending",
  });
  assert.equal(tool[0]?.type, "tool");
});

test("[APPROVAL-001] phone can approve a Claude ACP permission challenge", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-acp-"));
  const store = new GatewayStore(join(root, "gateway.sqlite"));
  const events = new EventHub();
  const adapter = createClaudeAcpAdapter({
    enabled: true,
    fallbackToCli: false,
    launchCommand: { command: process.execPath, args: [mockAgentPath] },
  });
  const service = new GatewayService(store, new AgentRegistry([adapter]), events, [root]);
  const historyDirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    cursorComposerDb: join(root, "missing-state.vscdb"),
    cursorTranscripts: join(root, "cursor-transcripts"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    workbuddyDb: join(root, "workbuddy.db"),
    workbuddyProjects: join(root, "workbuddy-projects"),
  };
  const history = new NativeHistoryService(historyDirs, [root]);
  const pairing = new PairingManager(60_000);
  const usage = {
    async list(): Promise<AgentUsage[]> {
      return [];
    },
  };
  const server = createGatewayHttpServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      dataDir: root,
      allowedRoots: [root],
      allowedOrigins: ["http://localhost:4173"],
      pairingTtlMs: 60_000,
      maxBodyBytes: 1_048_576,
      historyDirs,
    },
    service,
    pairing,
    events,
    history,
    usage,
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const start = await fetch(`${baseUrl}/v1/pairing/start`, { method: "POST" });
    const startBody = (await start.json()) as { data: { code: string } };
    const confirm = await fetch(`${baseUrl}/v1/pairing/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: startBody.data.code, deviceName: "phone-test" }),
    });
    const confirmBody = (await confirm.json()) as { data: { token: string } };
    const authorization = { Authorization: `Bearer ${confirmBody.data.token}` };

    const created = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        agent: "claude",
        prompt: "please run a tool",
        cwd: root,
        permissionMode: "ask",
      }),
    });
    const createdBody = (await created.json()) as { data: { id: string; status: string }; error?: string };
    assert.equal(created.status, 202, JSON.stringify(createdBody));
    const sessionId = createdBody.data.id;

    let challengeId: string | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const sessionRes = await fetch(`${baseUrl}/v1/sessions/${sessionId}`, {
        headers: authorization,
      });
      const sessionBody = (await sessionRes.json()) as { data: { status: string } };
      const eventsRes = await fetch(`${baseUrl}/v1/sessions/${sessionId}/events`, {
        headers: authorization,
      });
      const eventsBody = (await eventsRes.json()) as {
        data: Array<{ type: string; payload: Record<string, unknown> }>;
      };
      const approval = eventsBody.data.find((event) => event.type === "approval");
      if (approval && typeof approval.payload.challengeId === "string") {
        challengeId = approval.payload.challengeId;
        assert.equal(approval.payload.resolvable, true);
        assert.equal(sessionBody.data.status, "waiting_approval");
        break;
      }
    }
    assert.ok(challengeId, "expected a resolvable approval challenge");

    const resolved = await fetch(
      `${baseUrl}/v1/sessions/${sessionId}/approvals/${challengeId}`,
      {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({ decision: "allow" }),
      },
    );
    const resolvedBody = await resolved.json();
    assert.equal(resolved.status, 200, JSON.stringify(resolvedBody));

    let completed = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const sessionRes = await fetch(`${baseUrl}/v1/sessions/${sessionId}`, {
        headers: authorization,
      });
      const sessionBody = (await sessionRes.json()) as { data: { status: string } };
      if (sessionBody.data.status === "completed") {
        completed = true;
        break;
      }
    }
    assert.equal(completed, true, "session should complete after phone allow");

    const eventsRes = await fetch(`${baseUrl}/v1/sessions/${sessionId}/events`, {
      headers: authorization,
    });
    const eventsBody = (await eventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown> }>;
    };
    assert.ok(eventsBody.data.some((event) => event.type === "completed"));
    assert.ok(
      eventsBody.data.some(
        (event) =>
          event.type === "output"
          && typeof event.payload.text === "string"
          && event.payload.text.includes("Tool allowed"),
      ),
    );
  } finally {
    service.stop();
    server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
