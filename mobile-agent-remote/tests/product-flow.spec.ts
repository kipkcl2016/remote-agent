import { expect, test, type Page, type Route } from "@playwright/test";

const gatewayUrl = "http://gateway.test";
const secondGatewayUrl = "http://gateway-two.test";
const now = new Date().toISOString();

type MockSession = {
  id: string;
  nativeId?: string;
  agent: "cursor" | "claude" | "codex";
  title: string;
  cwd: string;
  projectId?: string;
  projectName?: string;
  permissionMode: "plan" | "ask" | "auto" | "full";
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

type MockNativeSession = {
  id: string;
  agent: "cursor" | "claude" | "codex";
  title: string;
  cwd: string;
  projectId?: string;
  projectName?: string;
  updatedAt: string;
  status?: "running" | "completed" | "failed";
  resumable: boolean;
  source: "native";
};

type MockAgentAvailability = {
  kind: "cursor" | "claude" | "codex";
  label: string;
  command: string;
  installed: boolean;
  version?: string;
  supportsNativeHistory: boolean;
  permissionModes: Array<"plan" | "ask" | "auto" | "full">;
};

function defaultMockAgents(): MockAgentAvailability[] {
  return [
    {
      kind: "cursor",
      label: "Cursor",
      command: "cursor-agent",
      installed: true,
      version: "2026.01.0",
      supportsNativeHistory: true,
      permissionModes: ["plan", "ask", "auto", "full"],
    },
    {
      kind: "claude",
      label: "Claude Code",
      command: "claude",
      installed: true,
      version: "1.0.0",
      supportsNativeHistory: true,
      permissionModes: ["plan", "ask", "auto", "full"],
    },
    {
      kind: "codex",
      label: "Codex",
      command: "codex",
      installed: true,
      version: "0.9.0",
      supportsNativeHistory: true,
      permissionModes: ["plan", "ask", "auto", "full"],
    },
  ];
}

async function installConnectedGateway(page: Page, extraSessions = 0) {
  await page.addInitScript(({ url }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
  }, { url: gatewayUrl });

  const sessions: MockSession[] = [
    {
      id: "cursor-session",
      nativeId: "cursor-native",
      agent: "cursor",
      title: "修复登录流程",
      cwd: "/Users/test/Projects/auth-service",
      projectId: "project-auth",
      projectName: "auth-service",
      permissionMode: "ask",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "claude-session",
      nativeId: "claude-native",
      agent: "claude",
      title: "检查消息队列",
      cwd: "/Users/test/Projects/mq-worker",
      projectId: "project-mq",
      projectName: "mq-worker",
      permissionMode: "plan",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "codex-session",
      nativeId: "codex-native",
      agent: "codex",
      title: "运行支付测试",
      cwd: "/Users/test/Projects/auth-service/packages/payment",
      projectId: "project-auth",
      projectName: "auth-service",
      permissionMode: "plan",
      status: "running",
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (let index = 0; index < extraSessions; index += 1) {
    sessions.push({
      id: `extra-cursor-${index}`,
      nativeId: `extra-native-${index}`,
      agent: "cursor",
      title: `额外会话 ${index + 1}`,
      cwd: "/Users/test/Projects/bulk-project",
      projectId: "project-bulk",
      projectName: "bulk-project",
      permissionMode: "ask",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
  }
  const events = new Map<string, Array<Record<string, unknown>>>([
    [
      "cursor-session",
      [
        { seq: 1, type: "output", payload: { stream: "user", text: "检查登录流程" } },
        { seq: 2, type: "output", payload: { stream: "assistant", text: "已定位登录态刷新问题。" } },
      ],
    ],
    [
      "codex-session",
      [
        { seq: 1, type: "output", payload: { stream: "user", text: "运行支付测试" } },
        { seq: 2, type: "tool", payload: { name: "command_execution", command: "npm test" } },
      ],
    ],
  ]);
  const fileRequests: string[] = [];

  await page.route(`${gatewayUrl}/**`, async (route) => {
    await handleGatewayRoute(route, sessions, events, "TestMac.local", fileRequests);
  });
  return { sessions, events, fileRequests };
}

async function handleGatewayRoute(
  route: Route,
  sessions: MockSession[],
  events: Map<string, Array<Record<string, unknown>>>,
  hostname = "TestMac.local",
  fileRequests: string[] = [],
  nativeSessions: MockNativeSession[] = [],
  nativeMessages: Map<string, Array<{ id: string; role: "user" | "assistant"; text: string }>> = new Map(),
  agents: MockAgentAvailability[] = defaultMockAgents(),
) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  const ok = (data: unknown, status = 200) => route.fulfill({ status, json: { data } });

  if (method === "GET" && path === "/v1/sessions") return ok(sessions);
  if (method === "GET" && path === "/v1/history") return ok(nativeSessions);
  if (method === "GET" && path === "/v1/config") {
    return ok({ hostname, allowedRoots: ["/Users/test/Projects"] });
  }
  if (method === "GET" && path === "/v1/devices") {
    return ok([{ id: "phone", name: "Android 设备", current: true, createdAt: now, lastSeenAt: now }]);
  }
  if (method === "GET" && path === "/v1/agents") return ok(agents);
  if (method === "GET" && path === "/v1/agents/usage") {
    return ok([
      {
        agent: "cursor",
        state: "unavailable",
        windows: [],
        message: "无法获取额度信息 · Cursor 未登录或本机无可用凭证",
        updatedAt: now,
      },
      {
        agent: "claude",
        state: "unavailable",
        windows: [],
        message: "无法获取额度信息 · API模式",
        updatedAt: now,
      },
      {
        agent: "codex",
        state: "available",
        windows: [
          { label: "5 小时", remainingPercent: 72, resetsAt: new Date(Date.now() + 3_600_000).toISOString() },
          { label: "每周", remainingPercent: 41, resetsAt: new Date(Date.now() + 86_400_000).toISOString() },
        ],
        updatedAt: now,
      },
    ]);
  }
  if (method === "POST" && path === "/v1/pairing/confirm") {
    return ok({ token: `paired-${hostname}`, deviceName: "测试手机" });
  }

  const nativeSnapshotMatch = path.match(
    /^\/v1\/history\/(?:cursor|claude|codex)\/([^/]+)\/snapshot$/,
  );
  if (method === "GET" && nativeSnapshotMatch?.[1]) {
    const id = decodeURIComponent(nativeSnapshotMatch[1]);
    const session = nativeSessions.find((item) => item.id === id);
    return session
      ? ok({ session, messages: nativeMessages.get(id) ?? [] })
      : route.fulfill({ status: 404, json: { error: { message: "missing" } } });
  }

  const nativeMessagesMatch = path.match(/^\/v1\/history\/(?:cursor|claude|codex)\/([^/]+)\/messages$/);
  if (method === "GET" && nativeMessagesMatch?.[1]) {
    return ok(nativeMessages.get(decodeURIComponent(nativeMessagesMatch[1])) ?? []);
  }

  const fileMatch = path.match(
    /^\/v1\/(?:sessions\/[^/]+|history\/(?:cursor|claude|codex)\/[^/]+)\/files\/read$/,
  );
  if (method === "POST" && fileMatch) {
    const body = request.postDataJSON() as { path?: string };
    const reference = body.path ?? "";
    fileRequests.push(reference);
    if (reference.endsWith("preview.png")) {
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Access-Control-Expose-Headers": "X-Remote-Agent-Filename",
          "X-Remote-Agent-Filename": encodeURIComponent("效果图.png"),
        },
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQmwAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    }
    if (reference.endsWith("check.txt")) {
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Expose-Headers": "X-Remote-Agent-Filename",
          "X-Remote-Agent-Filename": encodeURIComponent("检查报告.txt"),
        },
        body: "检查通过：移动端已从当前会话目录读取此文件。",
      });
    }
    if (reference.endsWith("check.md")) {
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Access-Control-Expose-Headers": "X-Remote-Agent-Filename",
          "X-Remote-Agent-Filename": encodeURIComponent("检查报告.md"),
        },
        body: [
          "# Markdown 检查报告",
          "",
          "| 项目 | 状态 |",
          "| --- | --- |",
          "| 文件渲染 | 通过 |",
          "",
          "```mermaid",
          "flowchart LR",
          "  File[Markdown 文件] --> Preview[应用内预览]",
          "```",
          "",
          "[同目录说明](./details.txt)",
          "",
          "<script>unsafe()</script>",
        ].join("\n"),
      });
    }
    if (reference.endsWith("preview.html")) {
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Expose-Headers": "X-Remote-Agent-Filename",
          "X-Remote-Agent-Filename": encodeURIComponent("效果页.html"),
        },
        body: "<!doctype html><html><body><h1>HTML 内置预览通过</h1><p>隔离页面内容</p></body></html>",
      });
    }
    if (reference.includes("outside")) {
      return route.fulfill({
        status: 403,
        json: { error: { message: "File is outside the session working directory" } },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { message: "Session file not found" } },
    });
  }

  if (method === "POST" && path === "/v1/sessions") {
    const body = request.postDataJSON() as {
      agent: MockSession["agent"];
      prompt: string;
      cwd: string;
      permissionMode?: MockSession["permissionMode"];
    };
    const created: MockSession = {
      id: "new-session",
      nativeId: "new-native",
      agent: body.agent,
      title: body.prompt,
      cwd: body.cwd,
      permissionMode: body.permissionMode ?? "ask",
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
    sessions.unshift(created);
    events.set(created.id, [
      { seq: 1, type: "output", payload: { stream: "user", text: body.prompt } },
      { seq: 2, type: "status", payload: { status: "running" } },
      {
        seq: 3,
        type: "output",
        payload: {
          stream: "assistant",
          text: "## 分析结果\n\n**正在分析**项目结构。\n\n- 第一项\n- 第二项\n\n| 状态 | 值 |\n| --- | --- |\n| 通过 | 1 |\n\n```mermaid\nflowchart LR\n  Phone[手机] --> Mac[Mac]\n```\n\n```mermaid\nnot-a-valid-diagram\n```\n\n<script>unsafe()</script>",
        },
      },
      { seq: 4, type: "output", payload: { stream: "stderr", text: "non-fatal diagnostic" } },
    ]);
    return ok(created, 202);
  }

  const messagesMatch = path.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
  if (method === "POST" && messagesMatch?.[1]) {
    const id = decodeURIComponent(messagesMatch[1]);
    const body = request.postDataJSON() as { prompt: string };
    const session = sessions.find((item) => item.id === id);
    if (!session) return route.fulfill({ status: 404, json: { error: { message: "missing" } } });
    session.status = "running";
    const current = events.get(id) ?? [];
    const nextSeq = current.length ? Number(current.at(-1)?.seq) + 1 : 1;
    current.push(
      { seq: nextSeq, type: "output", payload: { stream: "user", text: body.prompt } },
      { seq: nextSeq + 1, type: "output", payload: { stream: "assistant_delta", text: "正在补充" } },
      { seq: nextSeq + 2, type: "output", payload: { stream: "assistant_delta", text: "边界场景测试。" } },
      { seq: nextSeq + 3, type: "completed", payload: {} },
    );
    session.status = "completed";
    return ok(session, 202);
  }

  const eventsMatch = path.match(/^\/v1\/sessions\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch?.[1]) {
    const id = decodeURIComponent(eventsMatch[1]);
    const after = Number(url.searchParams.get("after") ?? request.headers()["last-event-id"] ?? 0);
    const payload = (events.get(id) ?? []).filter((event) => Number(event.seq) > after);
    const accept = request.headers().accept ?? "";
    if (accept.includes("text/event-stream")) {
      const body = [
        ": connected\n\n",
        ...payload.map((event) => (
          `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        )),
      ].join("");
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body,
      });
    }
    return ok(payload);
  }

  const cancelMatch = path.match(/^\/v1\/sessions\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch?.[1]) {
    const id = decodeURIComponent(cancelMatch[1]);
    const session = sessions.find((item) => item.id === id);
    if (!session) return route.fulfill({ status: 404, json: { error: { message: "missing" } } });
    session.status = "cancelled";
    session.updatedAt = new Date().toISOString();
    const current = events.get(id) ?? [];
    const nextSeq = current.length ? Number(current.at(-1)?.seq) + 1 : 1;
    current.push({ seq: nextSeq, type: "status", payload: { status: "cancelled" } });
    events.set(id, current);
    return ok(session);
  }

  const revokeMatch = path.match(/^\/v1\/devices\/([^/]+)\/revoke$/);
  if (method === "POST" && revokeMatch?.[1]) {
    return ok({ id: decodeURIComponent(revokeMatch[1]), revoked: true });
  }

  const sessionMatch = path.match(/^\/v1\/sessions\/([^/]+)$/);
  if (method === "GET" && sessionMatch?.[1]) {
    const session = sessions.find((item) => item.id === decodeURIComponent(sessionMatch[1]));
    return session ? ok(session) : route.fulfill({ status: 404, json: { error: { message: "missing" } } });
  }

  return route.fulfill({ status: 404, json: { error: { message: `Unhandled ${method} ${path}` } } });
}

test("disconnected mode never shows simulated sessions and keeps connection entry visible", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("session-list").locator(".session-row")).toHaveCount(0);
  await expect(page.getByText("连接 Mac 后查看真实会话")).toBeVisible();
  await expect(page.getByTestId("device-status")).toContainText("未连接");
  await expect(page.getByTestId("new-session")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "连接 Mac", exact: true })).toHaveCount(1);
});

test("[PAIR-002][DEVICE-004] legacy credentials migrate to the saved connection store", async ({ page }) => {
  await installConnectedGateway(page);
  await page.goto("/");
  await expect(page.getByText("TestMac.local")).toBeVisible();

  const storage = await page.evaluate(() => ({
    connections: localStorage.getItem("remote-agent.gateway.connections.v1"),
    legacyUrl: localStorage.getItem("remote-agent.gateway.url"),
    legacyToken: localStorage.getItem("remote-agent.gateway.token"),
  }));
  const parsed = JSON.parse(storage.connections ?? "null") as {
    activeId: string;
    connections: Array<{ id: string; url: string; token: string }>;
  };
  expect(parsed.connections).toHaveLength(1);
  expect(parsed.connections[0]).toMatchObject({ url: gatewayUrl, token: "test-token" });
  expect(parsed.activeId).toBe(parsed.connections[0].id);
  expect(storage.legacyUrl).toBeNull();
  expect(storage.legacyToken).toBeNull();
});

test("[PAIR-002][DEVICE-002][DEVICE-004][SESSION-008] saved Macs add, switch, persist, and retain isolated caches", async ({ page }) => {
  const oneSession: MockSession = {
    id: "mac-one-session",
    agent: "cursor",
    title: "第一台 Mac 的会话",
    cwd: "/Users/test/Projects/one",
    projectId: "project-one",
    projectName: "one",
    permissionMode: "ask",
    status: "completed",
    createdAt: now,
    updatedAt: now,
  };
  const twoSession: MockSession = {
    id: "mac-two-session",
    agent: "claude",
    title: "第二台 Mac 的会话",
    cwd: "/Users/test/Projects/two",
    projectId: "project-two",
    projectName: "two",
    permissionMode: "plan",
    status: "completed",
    createdAt: now,
    updatedAt: now,
  };
  await page.addInitScript(({ firstUrl, timestamp }) => {
    if (localStorage.getItem("remote-agent.gateway.connections.v1")) return;
    localStorage.setItem("remote-agent.gateway.connections.v1", JSON.stringify({
      version: 1,
      activeId: "gateway-one",
      connections: [
        { id: "gateway-one", url: firstUrl, token: "token-one", name: "OneMac.local", lastUsedAt: timestamp },
      ],
    }));
  }, { firstUrl: gatewayUrl, timestamp: now });
  await page.route(`${gatewayUrl}/**`, (route) => (
    handleGatewayRoute(route, [oneSession], new Map(), "OneMac.local")
  ));
  await page.route(`${secondGatewayUrl}/**`, (route) => (
    handleGatewayRoute(route, [twoSession], new Map(), "TwoMac.local")
  ));

  await page.goto("/");
  await expect(page.getByTestId("device-status")).toContainText("OneMac.local");
  await expect(page.getByTestId("session-mac-one-session")).toBeVisible();

  await page.getByTestId("nav-devices").click();
  await expect(page.getByTestId("saved-connections").locator(".saved-connection-row")).toHaveCount(1);
  await page.getByTestId("add-connection").click();
  await page.getByTestId("gateway-url").fill(secondGatewayUrl);
  await page.getByTestId("pairing-code").fill("12345678");
  await page.getByRole("button", { name: "配对并保存连接" }).click();
  await expect(page.getByTestId("saved-connections").locator(".saved-connection-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("device-status")).toContainText("TwoMac.local");
  await expect(page.getByTestId("session-mac-two-session")).toBeVisible();
  await expect(page.getByTestId("session-mac-one-session")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("device-status")).toContainText("TwoMac.local");
  await expect(page.getByTestId("session-mac-two-session")).toBeVisible();
  const cacheKeys = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("remote-agent.session-cache.v1.")));
  expect(cacheKeys).toHaveLength(2);

  await page.getByTestId("nav-devices").click();
  await page.getByTestId("switch-connection-gateway-one").click();
  await expect(page.getByTestId("device-status")).toContainText("OneMac.local");
  await expect(page.getByTestId("session-mac-one-session")).toBeVisible();
  await page.getByTestId("nav-devices").click();
  await page.getByRole("button", { name: "从本机移除此 Mac" }).click();
  await expect(page.getByTestId("device-status")).toContainText("TwoMac.local");
  await expect(page.getByTestId("session-mac-two-session")).toBeVisible();
  const remaining = await page.evaluate(() => JSON.parse(
    localStorage.getItem("remote-agent.gateway.connections.v1") ?? "null",
  ) as { activeId: string; connections: Array<{ id: string }> });
  expect(remaining.activeId).not.toBe("gateway-one");
  expect(remaining.connections).toHaveLength(1);
});

test("[SESSION-007] project view groups agents, persists collapse state, and prefills cwd", async ({ page }) => {
  await installConnectedGateway(page);
  await page.goto("/");
  await expect(page.getByText("TestMac.local")).toBeVisible();

  await page.getByTestId("view-projects").click();
  await expect(page.getByTestId("project-group")).toHaveCount(2);
  const authProject = page.getByTestId("project-group").filter({ hasText: "auth-service" });
  await expect(authProject).toContainText("最近更新");
  await expect(authProject).not.toContainText("个会话");
  await expect(page.getByTestId("session-cursor-session")).toBeVisible();
  await expect(page.getByTestId("session-codex-session")).toBeVisible();

  await page.getByTestId("project-toggle-group:auth-service").click();
  await expect(page.getByTestId("session-cursor-session")).toHaveCount(0);
  await page.reload();
  await page.getByTestId("view-projects").click();
  await expect(page.getByTestId("session-cursor-session")).toHaveCount(0);

  await page.getByTestId("project-toggle-group:auth-service").click();
  await authProject.getByRole("button", { name: "在 auth-service 中发起新会话" }).click();
  await expect(page.getByTestId("bottom-sheet")).toBeVisible();
  await expect(page.getByTestId("working-directory")).toHaveValue("/Users/test/Projects/auth-service");
});

test("[SESSION-007] same-name benchmark workspaces keep separate projects with useful labels", async ({ page }) => {
  await page.addInitScript(({ url }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
  }, { url: gatewayUrl });

  const nativeSessions: MockNativeSession[] = [
    {
      id: "benchmark-current-task-1",
      agent: "claude",
      title: "Current benchmark task 1",
      cwd: "/Users/test/Projects/current-vs-luna-benchmark/runs/task-1/claude/workspace",
      projectId: "benchmark-current-task-1-project",
      projectName: "workspace",
      updatedAt: now,
      resumable: true,
      source: "native",
    },
    {
      id: "benchmark-current-task-2",
      agent: "claude",
      title: "Current benchmark task 2",
      cwd: "/Users/test/Projects/current-vs-luna-benchmark/runs/task-2/claude/workspace",
      projectId: "benchmark-current-task-2-project",
      projectName: "workspace",
      updatedAt: now,
      resumable: true,
      source: "native",
    },
    {
      id: "benchmark-cursor-task-1",
      agent: "cursor",
      title: "Cursor benchmark task 1",
      cwd: "/Users/test/Projects/luna-vs-cursor-benchmark/runs/task-1/cursor/workspace",
      projectId: "benchmark-cursor-task-1-project",
      projectName: "workspace",
      updatedAt: now,
      resumable: true,
      source: "native",
    },
  ];
  await page.route(`${gatewayUrl}/**`, (route) => (
    handleGatewayRoute(route, [], new Map(), "TestMac.local", [], nativeSessions)
  ));

  await page.goto("/");
  await expect(page.getByTestId("session-benchmark-current-task-1"))
    .toContainText("claude · task-1 · current-vs-luna");
  await expect(page.getByTestId("session-benchmark-current-task-2"))
    .toContainText("claude · task-2 · current-vs-luna");
  await expect(page.getByTestId("session-benchmark-cursor-task-1"))
    .toContainText("cursor · task-1 · luna-vs-cursor");

  await page.getByTestId("view-projects").click();
  await expect(page.getByTestId("project-group")).toHaveCount(3);
  await expect(page.locator(".project-summary strong")).toHaveText([
    "claude · task-1 · current-vs-luna",
    "claude · task-2 · current-vs-luna",
    "cursor · task-1 · luna-vs-cursor",
  ]);

  await page.getByTestId("search-toggle").click();
  await page.getByTestId("history-search").fill("claude · task-2");
  await expect(page.getByTestId("project-group")).toHaveCount(1);
  await expect(page.getByTestId("session-benchmark-current-task-2")).toBeVisible();
});

test("[SESSION-007] duplicate Codex project folders keep the real name in the project header", async ({ page }) => {
  await page.addInitScript(({ url }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
  }, { url: gatewayUrl });

  const nativeSessions: MockNativeSession[] = [
    {
      id: "codex-shared-a",
      agent: "codex",
      title: "Codex task A",
      cwd: "/Users/test/ws-a/workspace/remote-agent",
      projectId: "codex-shared-a-project",
      projectName: "remote-agent",
      updatedAt: now,
      resumable: true,
      source: "native",
    },
    {
      id: "codex-shared-b",
      agent: "codex",
      title: "Codex task B",
      cwd: "/Users/test/ws-b/workspace/remote-agent",
      projectId: "codex-shared-b-project",
      projectName: "remote-agent",
      updatedAt: now,
      resumable: true,
      source: "native",
    },
  ];
  await page.route(`${gatewayUrl}/**`, (route) => (
    handleGatewayRoute(route, [], new Map(), "TestMac.local", [], nativeSessions)
  ));

  await page.goto("/");
  await page.getByTestId("view-projects").click();
  await expect(page.getByTestId("project-group")).toHaveCount(1);
  const mergedGroup = page.getByTestId("project-group").filter({ hasText: "remote-agent" });
  await expect(mergedGroup.locator(".project-summary strong")).toHaveText(["remote-agent"]);
  await expect(mergedGroup.getByTestId("session-codex-shared-a")).toBeVisible();
  await expect(mergedGroup.getByTestId("session-codex-shared-b")).toBeVisible();
  await expect(page.locator(".project-summary small").first()).not.toContainText(/^workspace · remote-agent/);
});

test("[SESSION-008] matching cache renders first, then live data replaces it without caching secrets", async ({ page }) => {
  const freshSession: MockSession = {
    id: "fresh-session",
    nativeId: "fresh-native",
    agent: "codex",
    title: "服务端最新会话",
    cwd: "/Users/test/Projects/fresh-project",
    projectId: "project-fresh",
    projectName: "fresh-project",
    permissionMode: "ask",
    status: "completed",
    createdAt: now,
    updatedAt: now,
  };
  await page.addInitScript(({ url, timestamp }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
    localStorage.setItem("remote-agent.session-cache.v1", JSON.stringify({
      version: 1,
      url,
      hostname: "CachedMac.local",
      savedAt: timestamp,
      sessions: [{
        id: "cached-session",
        source: "gateway",
        resumable: true,
        agent: "Cursor",
        title: "上次缓存的会话",
        projectId: "project-cached",
        project: "cached-project",
        branch: "受限执行",
        status: "done",
        updatedAt: timestamp,
      }],
    }));
  }, { url: gatewayUrl, timestamp: now });

  let releaseSync = () => undefined;
  const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
  const events = new Map<string, Array<Record<string, unknown>>>();
  await page.route(`${gatewayUrl}/**`, async (route) => {
    await syncGate;
    await handleGatewayRoute(route, [freshSession], events);
  });

  await page.goto("/");
  await expect(page.getByTestId("session-cached-session")).toBeVisible();
  await expect(page.getByTestId("session-sync-state")).toContainText("正在同步最新会话");
  releaseSync();
  await expect(page.getByTestId("session-fresh-session")).toBeVisible();
  await expect(page.getByTestId("session-cached-session")).toHaveCount(0);
  await expect(page.getByTestId("session-sync-state")).toHaveCount(0);

  const storedCache = await page.evaluate(() => Object.entries(localStorage)
    .find(([key]) => key.startsWith("remote-agent.session-cache.v1."))?.[1] ?? "");
  expect(storedCache).toContain("fresh-session");
  expect(storedCache).not.toContain("test-token");
  expect(storedCache).not.toContain("/Users/");
});

test("[SESSION-008] cache from a different server is isolated during cold loading", async ({ page }) => {
  await page.addInitScript(({ url, timestamp }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
    localStorage.setItem("remote-agent.session-cache.v1", JSON.stringify({
      version: 1,
      url: "http://another-gateway.test",
      hostname: "OtherMac.local",
      savedAt: timestamp,
      sessions: [{
        id: "foreign-cache",
        source: "gateway",
        resumable: false,
        agent: "Claude",
        title: "不应显示的其他服务端缓存",
        projectId: "foreign-project",
        project: "foreign",
        branch: "受限执行",
        status: "done",
        updatedAt: timestamp,
      }],
    }));
  }, { url: gatewayUrl, timestamp: now });

  let releaseSync = () => undefined;
  const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
  await page.route(`${gatewayUrl}/**`, async (route) => {
    await syncGate;
    await handleGatewayRoute(route, [], new Map());
  });

  await page.goto("/");
  await expect(page.getByText("正在加载会话")).toBeVisible();
  await expect(page.getByText("不应显示的其他服务端缓存")).toHaveCount(0);
  releaseSync();
});

test("[SESSION-008] cached sessions stay visible on sync failure and retry recovers", async ({ page }) => {
  await page.addInitScript(({ url, timestamp }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
    localStorage.setItem("remote-agent.session-cache.v1", JSON.stringify({
      version: 1,
      url,
      hostname: "CachedMac.local",
      savedAt: timestamp,
      sessions: [{
        id: "cached-retry-session",
        source: "native",
        resumable: true,
        agent: "Claude",
        title: "断网时保留的会话",
        projectId: "retry-project",
        project: "retry-project",
        branch: "原生历史",
        status: "done",
        updatedAt: timestamp,
      }],
    }));
  }, { url: gatewayUrl, timestamp: now });

  let failing = true;
  await page.route(`${gatewayUrl}/**`, async (route) => {
    if (failing) {
      return route.fulfill({ status: 503, json: { error: { message: "offline" } } });
    }
    return handleGatewayRoute(route, [], new Map());
  });

  await page.goto("/");
  await expect(page.getByTestId("session-cached-retry-session")).toBeVisible();
  await expect(page.getByTestId("session-sync-state")).toContainText("同步失败");
  failing = false;
  await page.getByTestId("session-sync-state").getByRole("button", { name: "重试" }).click();
  await expect(page.getByTestId("session-sync-state")).toHaveCount(0);
  await expect(page.getByTestId("session-cached-retry-session")).toHaveCount(0);
});

test("[SESSION-002][SESSION-005] tabs and search filter immediately before a full-screen continuation", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await installConnectedGateway(page);
  await page.goto("/");
  await expect(page.getByText("TestMac.local")).toBeVisible();
  await expect(page.getByTestId("agent-usage-grid")).toHaveCount(0);
  await expect(page.getByTestId("agent-usage-Cursor")).toHaveText("无法获取");
  await expect(page.getByTestId("agent-usage-Cursor")).toHaveAttribute(
    "aria-label",
    /Cursor 未登录或本机无可用凭证/,
  );
  await expect(page.getByTestId("agent-usage-Claude")).toHaveText("API模式");
  await expect(page.getByTestId("agent-usage-Claude")).toHaveAttribute(
    "aria-label",
    /API模式/,
  );
  await expect(page.getByTestId("agent-usage-Codex")).toHaveText("余 41%");
  await expect(page.getByTestId("agent-usage-Codex")).toHaveAttribute(
    "aria-label",
    /Codex 每周剩余 41%/,
  );

  const headingActions = page.locator(".section-heading-actions");
  await expect(headingActions.getByTestId("view-recent")).toBeVisible();
  await expect(headingActions.getByTestId("view-projects")).toBeVisible();
  await expect(headingActions.getByTestId("search-toggle")).toBeVisible();
  const productHeaderBox = await page.locator(".product-header").boundingBox();
  const productTitleBox = await page.locator(".product-header h1").boundingBox();
  const deviceStatusBox = await page.getByTestId("device-status").boundingBox();
  expect(deviceStatusBox?.height).toBeLessThanOrEqual(44);
  expect(deviceStatusBox?.x ?? 0).toBeGreaterThan((productTitleBox?.x ?? 0) + (productTitleBox?.width ?? 0));
  expect(Math.abs(
    ((deviceStatusBox?.y ?? 0) + (deviceStatusBox?.height ?? 0) / 2)
      - ((productHeaderBox?.y ?? 0) + (productHeaderBox?.height ?? 0) / 2),
  )).toBeLessThanOrEqual(4);
  await expect(page.getByTestId("device-status").locator("img, .device-copy, .row-chevron")).toHaveCount(0);
  expect((await page.locator(".agent-filters").boundingBox())?.height).toBeLessThanOrEqual(54);
  const deviceScreen = page.getByTestId("device-screen");
  const iPhoneScreenBox = await deviceScreen.boundingBox();
  expect(Math.abs((iPhoneScreenBox?.width ?? 0) - 393)).toBeLessThanOrEqual(1);
  expect(Math.abs((iPhoneScreenBox?.height ?? 0) - 852)).toBeLessThanOrEqual(1);
  await deviceScreen.screenshot({ path: testInfo.outputPath("compact-home-iphone.png") });
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-pixel-10").click();
  await expect(deviceScreen).toHaveAttribute("data-device", "pixel-10");
  const pixelScreenBox = await deviceScreen.boundingBox();
  expect(Math.abs((pixelScreenBox?.width ?? 0) - 427)).toBeLessThanOrEqual(1);
  expect(Math.abs((pixelScreenBox?.height ?? 0) - 952)).toBeLessThanOrEqual(1);
  expect(await page.getByTestId("remote-app").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await deviceScreen.screenshot({ path: testInfo.outputPath("compact-home-pixel.png") });
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-iphone").click();
  await expect(deviceScreen).toHaveAttribute("data-device", "iphone");
  expect(consoleErrors).toEqual([]);

  const completedRow = page.getByTestId("session-cursor-session");
  await expect(completedRow).not.toContainText("已完成");
  await expect(completedRow).not.toContainText("受限执行");
  await expect(page.getByTestId("session-state-list-cursor-session")).toHaveCount(0);
  expect((await completedRow.boundingBox())?.height).toBeLessThanOrEqual(72);
  await expect(page.getByTestId("session-state-list-codex-session")).toHaveAttribute("aria-label", "运行中");
  await expect(page.getByTestId("session-state-list-codex-session").locator("svg")).toHaveCount(1);
  const statusGroupBox = await page.locator(".status-summary-group").boundingBox();
  const newSessionBox = await page.getByTestId("new-session").boundingBox();
  expect(newSessionBox?.x ?? 0).toBeGreaterThan(
    (statusGroupBox?.x ?? 0) + (statusGroupBox?.width ?? 0),
  );
  expect(Math.abs((newSessionBox?.y ?? 0) - (statusGroupBox?.y ?? 0))).toBeLessThanOrEqual(1);

  await page.getByTestId("filter-Codex").click();
  await expect(page.getByTestId("session-codex-session")).toBeVisible();
  await expect(page.getByTestId("session-cursor-session")).toHaveCount(0);
  await expect(page.getByTestId("filter-Codex")).toContainText("Codex");
  await expect(page.getByTestId("filter-feedback")).toContainText("进行中1");
  await expect(page.getByTestId("filter-feedback")).toContainText("已完成 · 未读0");
  await expect(page.getByTestId("new-session")).toHaveAttribute("aria-label", "发起 Codex 新会话");
  await page.getByTestId("new-session").click();
  await expect(page.getByTestId("new-session-agent-Codex")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  await page.getByTestId("filter-Claude").click();
  await expect(page.getByTestId("session-claude-session")).toBeVisible();
  await expect(page.getByTestId("session-codex-session")).toHaveCount(0);

  await page.getByTestId("search-toggle").click();
  await expect(page.getByTestId("new-session")).toHaveAttribute("aria-label", "发起 Claude 新会话");
  await page.getByTestId("history-search").fill("支付");
  await expect(page.getByTestId("session-list")).toContainText("没有找到会话");
  await page.getByTestId("filter-Codex").click();
  await expect(page.getByTestId("session-codex-session")).toBeVisible();
  await page.getByTestId("search-clear").click();
  await page.getByTestId("search-toggle").click();
  await expect(page.getByTestId("new-session")).toBeVisible();

  await page.getByTestId("filter-Cursor").click();
  await expect(page.getByTestId("session-cursor-session")).toBeVisible();
  await expect(page.getByTestId("session-codex-session")).toHaveCount(0);
  await expect(page.getByTestId("new-session")).toHaveAttribute("aria-label", "发起 Cursor 新会话");
  await page.getByTestId("new-session").click();
  await expect(page.getByTestId("new-session-agent-Cursor")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  await page.getByTestId("session-cursor-session").click();
  await expect(page.getByTestId("session-detail")).toBeVisible();
  await expect(page.getByTestId("bottom-sheet")).toHaveCount(0);
  await expect(page.getByTestId("session-stream")).toContainText("已定位登录态刷新问题");

  await page.getByTestId("detail-reply").fill("补充边界测试");
  await page.getByTestId("detail-send").click();
  await expect(page.getByTestId("session-detail")).toBeVisible();
  await expect(page.getByTestId("session-stream")).toContainText("正在补充边界场景测试", { timeout: 5_000 });

  await page.getByTestId("session-detail-back").click();
  await expect(page.getByTestId("session-detail")).toHaveCount(0);
  await expect(page.getByTestId("session-list")).toBeVisible();

  await page.getByTestId("filter-全部").click();
  await expect(page.getByTestId("new-session")).toBeVisible();
});

test("[SESSION-004] user questions stick to the current answer section without output yanking the scroll", async ({ page }, testInfo) => {
  const gateway = await installConnectedGateway(page);
  const firstAnswer = Array.from(
    { length: 28 },
    (_, index) => `第一轮分析第 ${index + 1} 段：核对登录、缓存和权限边界。`,
  ).join("\n\n");
  const secondAnswer = Array.from(
    { length: 28 },
    (_, index) => `第二轮分析第 ${index + 1} 段：继续检查移动端滚动位置。`,
  ).join("\n\n");
  gateway.events.set("codex-session", [
    {
      seq: 1,
      type: "output",
      payload: {
        stream: "user",
        text: "第一问：先检查登录和缓存边界，并核对移动端权限状态。请同时说明缓存失效后的恢复路径，以及不同服务端之间的数据隔离。最后列出需要继续观察的风险。",
      },
    },
    { seq: 2, type: "output", payload: { stream: "assistant", text: firstAnswer } },
    { seq: 3, type: "output", payload: { stream: "user", text: "第二问：再检查滚动位置是否保持" } },
    { seq: 4, type: "output", payload: { stream: "assistant", text: secondAnswer } },
  ]);

  await page.goto("/");
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-pixel-10").click();
  await expect(page.getByTestId("device-screen")).toHaveAttribute("data-device", "pixel-10");
  await expect(page.getByText("TestMac.local")).toBeVisible();
  await page.getByTestId("session-codex-session").click();

  const stream = page.getByTestId("session-stream");
  const firstQuestion = page.getByTestId("user-question-event-1");
  const secondQuestion = page.getByTestId("user-question-event-3");
  await expect(firstQuestion).toContainText("第一问");
  await expect(secondQuestion).toContainText("第二问");

  const scrollQuestionPastStickyTop = async (testId: string) => {
    await stream.evaluate((element, questionTestId) => {
      const question = element.querySelector<HTMLElement>(`[data-testid="${questionTestId}"]`);
      if (!question) throw new Error(`Missing ${questionTestId}`);
      const turn = question.closest<HTMLElement>(".detail-turn");
      if (!turn) throw new Error(`Missing turn for ${questionTestId}`);
      const stickyTop = Number.parseFloat(
        getComputedStyle(element).getPropertyValue("--detail-question-pin-top"),
      );
      const streamTop = element.getBoundingClientRect().top;
      const turnContentTop = turn.getBoundingClientRect().top - streamTop + element.scrollTop;
      element.scrollTop = Math.max(0, turnContentTop - stickyTop + 12);
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, testId);
  };
  const activeQuestionTestId = () => stream.evaluate((element) => {
    const questionId = element.parentElement
      ?.querySelector<HTMLElement>(".detail-question-pin [data-question-id]")
      ?.dataset.questionId;
    return questionId ? `user-question-${questionId}` : null;
  });
  const pinnedQuestion = page.getByTestId("pinned-question");
  const waitForPinnedAnimation = async () => {
    await pinnedQuestion.locator(".detail-question-pin-layer.is-current").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
  };

  await scrollQuestionPastStickyTop("user-question-event-1");
  await expect.poll(activeQuestionTestId).toBe("user-question-event-1");
  await expect(pinnedQuestion).toHaveAttribute("data-motion", "backward");
  await expect(pinnedQuestion.locator(".detail-question-pin-layer.is-current")).toHaveCSS(
    "animation-name",
    "detail-question-cover-backward",
  );
  await waitForPinnedAnimation();
  const livePinGap = await Promise.all([
    pinnedQuestion.boundingBox(),
    stream.locator(".stream-live-indicator").boundingBox(),
  ]).then(([pinBox, liveBox]) => Math.abs(
    (pinBox?.y ?? 0) - ((liveBox?.y ?? 0) + (liveBox?.height ?? 0)),
  ));
  // Headless Chromium may report a few pixels of subpixel gap between sticky layers.
  expect(livePinGap).toBeLessThanOrEqual(4);
  const expandQuestion = page.getByRole("button", { name: "展开当前问题" });
  await expect(expandQuestion).toHaveAttribute("aria-expanded", "false");
  const collapsedQuestionHeight = await pinnedQuestion.getByTestId("pinned-question-card")
    .evaluate((element) => element.getBoundingClientRect().height);
  await expandQuestion.click();
  const collapseQuestion = page.getByRole("button", { name: "收起当前问题" });
  await expect(collapseQuestion).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => pinnedQuestion.getByTestId("pinned-question-card")
    .evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(collapsedQuestionHeight);
  await stream.screenshot({ path: testInfo.outputPath("sticky-first-question-expanded.png") });

  const scrollTopBeforeOutput = await stream.evaluate((element) => element.scrollTop);
  gateway.events.get("codex-session")?.push({
    seq: 5,
    type: "output",
    payload: { stream: "assistant_delta", text: "后台新增输出，但不改变当前阅读位置。" },
  });
  await expect(stream).toContainText("后台新增输出", { timeout: 3_000 });
  await expect.poll(async () => Math.abs(
    (await stream.evaluate((element) => element.scrollTop)) - scrollTopBeforeOutput,
  )).toBeLessThanOrEqual(2);

  await scrollQuestionPastStickyTop("user-question-event-3");
  await expect.poll(activeQuestionTestId).toBe("user-question-event-3");
  await expect(pinnedQuestion).toHaveAttribute("data-motion", "forward");
  await waitForPinnedAnimation();
  await stream.screenshot({ path: testInfo.outputPath("sticky-second-question.png") });

  await scrollQuestionPastStickyTop("user-question-event-1");
  await expect.poll(activeQuestionTestId).toBe("user-question-event-1");
  await expect(pinnedQuestion).toHaveAttribute("data-motion", "backward");
  await waitForPinnedAnimation();
  await expect(page.getByRole("button", { name: "展开当前问题" })).toHaveAttribute("aria-expanded", "false");
  await stream.screenshot({ path: testInfo.outputPath("sticky-first-question-collapsed.png") });

  const codexSession = gateway.sessions.find((session) => session.id === "codex-session");
  expect(codexSession).toBeTruthy();
  if (!codexSession) return;
  codexSession.status = "completed";
  await expect(stream.locator(".stream-live-indicator")).toHaveCount(0, { timeout: 3_000 });
  await scrollQuestionPastStickyTop("user-question-event-3");
  await expect.poll(activeQuestionTestId).toBe("user-question-event-3");
  await waitForPinnedAnimation();
  const completedPinGap = await Promise.all([
    pinnedQuestion.boundingBox(),
    stream.boundingBox(),
  ]).then(([pinBox, streamBox]) => Math.abs((pinBox?.y ?? 0) - (streamBox?.y ?? 0)));
  expect(completedPinGap).toBeLessThanOrEqual(1);
  await stream.screenshot({ path: testInfo.outputPath("sticky-second-question-completed.png") });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await scrollQuestionPastStickyTop("user-question-event-1");
  await expect.poll(activeQuestionTestId).toBe("user-question-event-1");
  await expect(pinnedQuestion).toHaveAttribute("data-motion", "backward");
  await expect(pinnedQuestion.locator(".detail-question-pin-layer.is-current")).toHaveCSS("animation-name", "none");
});

test("[FILE-001] session files use type-aware previews and authenticated export", async ({ page }, testInfo) => {
  const gateway = await installConnectedGateway(page);
  gateway.events.set("cursor-session", [
    { seq: 1, type: "output", payload: { stream: "user", text: "查看本次生成的文件" } },
    {
      seq: 2,
      type: "output",
      payload: {
        stream: "assistant",
        text: [
          "## 生成结果",
          "",
          "[Markdown 检查报告](./reports/check.md)",
          "",
          "[HTML 效果页](./reports/preview.html)",
          "",
          "![移动端效果图](./reports/preview.png)",
          "",
          "[目录外文件](../outside.txt)",
          "",
          "[缺失文件](./reports/missing.pdf)",
          "",
          "[外部说明](https://example.com/guide)",
        ].join("\n"),
      },
    },
  ]);

  await page.goto("/");
  await expect(page.getByText("TestMac.local")).toBeVisible();
  await page.getByTestId("session-cursor-session").click();

  const inlineImage = page.getByTestId("remote-file-image");
  await expect(inlineImage).toBeVisible();
  await expect(inlineImage.locator("img")).toHaveAttribute("alt", "移动端效果图");
  const external = page.getByRole("link", { name: "外部说明" });
  await expect(external).toHaveAttribute("href", "https://example.com/guide");
  await expect(external).toHaveAttribute("target", "_blank");

  await page.getByRole("link", { name: "Markdown 检查报告" }).click();
  await expect(page.getByTestId("file-preview")).toBeVisible();
  const markdownPreview = page.getByTestId("file-preview-markdown");
  await expect(markdownPreview.getByRole("heading", { name: "Markdown 检查报告" })).toBeVisible();
  await expect(markdownPreview.locator("table")).toContainText("文件渲染");
  await expect(markdownPreview.getByTestId("mermaid-diagram").locator("svg")).toHaveCount(1);
  await expect(markdownPreview.locator("script")).toHaveCount(0);
  await expect(markdownPreview.getByRole("link", { name: "同目录说明" })).toHaveAttribute("href", "./details.txt");
  await expect(page.getByTestId("file-download")).toBeVisible();
  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("file-download").click();
  const markdownDownload = await markdownDownloadPromise;
  expect(markdownDownload.suggestedFilename()).toBe("检查报告.md");
  await page.getByTestId("device-screen").screenshot({ path: testInfo.outputPath("file-preview-markdown.png") });
  await page.getByTestId("file-preview-back").click();
  await expect(page.getByTestId("session-detail")).toBeVisible();

  await page.getByRole("link", { name: "HTML 效果页" }).click();
  const htmlPreview = page.frameLocator('[data-testid="file-preview-html"]');
  await expect(htmlPreview.getByRole("heading", { name: "HTML 内置预览通过" })).toBeVisible();
  await expect(htmlPreview.locator('meta[charset="utf-8"]')).toHaveCount(1);
  await expect(page.getByTestId("file-preview-html")).toHaveAttribute("sandbox", /allow-scripts/);
  await expect(page.getByTestId("file-preview-html")).not.toHaveAttribute("sandbox", /allow-same-origin/);
  const htmlDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("file-download").click();
  const htmlDownload = await htmlDownloadPromise;
  expect(htmlDownload.suggestedFilename()).toBe("效果页.html");
  await page.getByTestId("device-screen").screenshot({ path: testInfo.outputPath("file-preview-html.png") });
  await page.getByTestId("file-preview-back").click();

  await inlineImage.click();
  await expect(page.getByTestId("file-preview-image")).toBeVisible();
  await expect(page.getByTestId("file-preview")).toContainText("效果图.png");
  await page.getByTestId("device-screen").screenshot({ path: testInfo.outputPath("file-preview-image.png") });
  await page.getByTestId("file-preview-back").click();

  await page.getByRole("link", { name: "目录外文件" }).click();
  await expect(page.getByTestId("file-preview-error")).toContainText("文件不在当前会话目录内");
  await page.getByTestId("file-preview-back").click();

  await page.getByRole("link", { name: "缺失文件" }).click();
  await expect(page.getByTestId("file-preview-error")).toContainText("Mac 上找不到这个文件");
  await page.getByTestId("file-preview-back").click();

  expect(gateway.fileRequests.filter((reference) => reference.endsWith("preview.png"))).toHaveLength(1);
  expect(gateway.fileRequests).toContain("./reports/check.md");
  expect(gateway.fileRequests).toContain("./reports/preview.html");
  expect(gateway.fileRequests).toContain("../outside.txt");
  expect(gateway.fileRequests).toContain("./reports/missing.pdf");
});

test("[SESSION-003][SESSION-004] creating a session opens live output with diagnostics collapsed", async ({ page }) => {
  const gateway = await installConnectedGateway(page);
  await page.goto("/");
  await expect(page.getByText("TestMac.local")).toBeVisible();

  await page.getByTestId("new-session").click();
  await expect(page.getByTestId("new-session-project")).toBeVisible();
  await page.getByTestId("new-session-project").selectOption("project-mq");
  await expect(page.getByTestId("working-directory")).toHaveValue("/Users/test/Projects/mq-worker");
  await page.getByTestId("new-session-project").selectOption("project-auth");
  await expect(page.getByTestId("working-directory")).toHaveValue("/Users/test/Projects/auth-service");
  await expect(page.getByTestId("permission-ask")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("permission-full").click();
  await expect(page.getByTestId("permission-full")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("new-session-prompt").fill("检查移动端连接");
  await page.locator(".sheet-primary", { hasText: "启动会话" }).evaluate((button: HTMLButtonElement) => button.click());

  await expect(page.getByTestId("session-detail")).toBeVisible();
  expect(gateway.sessions[0]?.permissionMode).toBe("full");
  await expect(page.getByTestId("session-stream")).toContainText("正在分析项目结构", { timeout: 5_000 });
  await expect(page.getByTestId("session-stream").getByRole("heading", { name: "分析结果" })).toBeVisible();
  await expect(page.getByTestId("session-stream").locator("strong", { hasText: "正在分析" })).toBeVisible();
  await expect(page.getByTestId("session-stream").locator("table")).toContainText("通过");
  await expect(page.getByTestId("mermaid-diagram")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("mermaid-diagram").locator("svg")).toHaveCount(1);
  await expect(page.getByTestId("mermaid-fallback")).toContainText("图表语法无法解析");
  await expect(page.getByTestId("mermaid-fallback").locator("code")).toContainText("not-a-valid-diagram");
  await expect(page.getByTestId("session-stream").locator("script")).toHaveCount(0);
  await expect(page.getByTestId("bottom-sheet")).toHaveCount(0);
  const diagnostic = page.getByTestId("diagnostic-log");
  await expect(diagnostic.locator("summary")).toHaveText("Agent 诊断日志");
  await expect(diagnostic.locator("p")).not.toBeVisible();
  await diagnostic.locator("summary").click();
  await expect(diagnostic.locator("p")).toContainText("non-fatal diagnostic");
});

test("[SESSION-001] each tab and project keeps at most 20 recent sessions", async ({ page }) => {
  const gateway = await installConnectedGateway(page, 45);
  const duplicate = gateway.sessions.find((session) => session.id === "cursor-session");
  expect(duplicate).toBeTruthy();
  if (duplicate) gateway.sessions.push({ ...duplicate }, { ...duplicate });
  await page.goto("/");
  await expect(page.getByText("TestMac.local")).toBeVisible();

  await expect(page.getByTestId("session-list").locator(".session-row")).toHaveCount(20);
  await expect(page.getByTestId("session-cursor-session")).toHaveCount(1);
  await expect(page.getByTestId("load-more-sessions")).toHaveCount(0);
  await page.getByTestId("filter-Cursor").click();
  await page.getByTestId("view-projects").click();
  const bulkProject = page.getByTestId("project-group").filter({ hasText: "bulk-project" });
  await page.getByTestId("project-toggle-project-bulk").click();
  await expect(bulkProject.locator(".session-row")).toHaveCount(20);
});

test("[SESSION-009] newly completed sessions stay unread until opened", async ({ page }) => {
  const gateway = await installConnectedGateway(page);
  await page.goto("/");
  await expect(page.getByText("TestMac.local")).toBeVisible();
  await expect(page.getByTestId("filter-feedback")).toContainText("已完成 · 未读0");

  const codexSession = gateway.sessions.find((session) => session.id === "codex-session");
  expect(codexSession).toBeTruthy();
  if (!codexSession) return;
  codexSession.status = "completed";
  codexSession.updatedAt = new Date(Date.now() + 60_000).toISOString();
  await page.reload();
  await expect(page.getByTestId("filter-feedback")).toContainText("进行中0");
  await expect(page.getByTestId("filter-feedback")).toContainText("已完成 · 未读1");
  await expect(page.getByTestId("session-codex-session")).not.toContainText("已完成");
  await expect(page.getByTestId("session-codex-session")).not.toContainText("未读");
  await expect(page.getByTestId("session-state-list-codex-session")).toHaveAttribute(
    "aria-label",
    "已完成，未读",
  );

  await page.getByTestId("session-codex-session").click();
  await expect(page.getByTestId("session-detail")).toBeVisible();
  await page.getByTestId("session-detail-back").click();
  await expect(page.getByTestId("filter-feedback")).toContainText("已完成 · 未读0");
  await expect(page.getByTestId("session-state-list-codex-session")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("filter-feedback")).toContainText("已完成 · 未读0");
  await expect(page.getByTestId("session-state-list-codex-session")).toHaveCount(0);
});

test("[HISTORY-001][HISTORY-003] read-only history moves its hint from the row to the disabled composer", async ({ page }) => {
  await page.addInitScript(({ url }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
  }, { url: gatewayUrl });

  const nativeSessions: MockNativeSession[] = [{
    id: "read-only-native",
    agent: "codex",
    title: "检查示例项目",
    cwd: "/Users/test/Projects/example-project",
    projectId: "project-house",
    projectName: "example-project",
    updatedAt: now,
    resumable: false,
    source: "native",
  }];
  await page.route(`${gatewayUrl}/**`, (route) => (
    handleGatewayRoute(route, [], new Map(), "TestMac.local", [], nativeSessions)
  ));

  await page.goto("/");
  const row = page.getByTestId("session-read-only-native");
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("只读记录");
  await expect(row).not.toContainText("原生历史");
  await expect(row).not.toContainText("已完成");
  expect((await row.boundingBox())?.height).toBeLessThanOrEqual(72);

  await row.click();
  await expect(page.getByTestId("session-detail")).toBeVisible();
  const detailHeader = page.locator(".session-detail-header");
  await expect(detailHeader).not.toContainText("只读记录");
  await expect(detailHeader).not.toContainText("原生历史");
  await expect(detailHeader.locator("time")).toBeVisible();
  await expect(page.locator(".session-detail-meta")).toHaveCount(0);
  const headerAndStream = await Promise.all([
    detailHeader.boundingBox(),
    page.locator(".session-detail-stream-shell").boundingBox(),
  ]);
  expect(Math.abs(
    (headerAndStream[1]?.y ?? 0) - ((headerAndStream[0]?.y ?? 0) + (headerAndStream[0]?.height ?? 0)),
  )).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("session-stream")).toContainText("不能在手机端续接或发送指令");
  await expect(page.getByTestId("detail-reply")).toBeDisabled();
  await expect(page.getByTestId("detail-reply")).toHaveAttribute("placeholder", "仅查看");
  await expect(page.getByTestId("detail-send")).toBeDisabled();
});

test("[HISTORY-001][HISTORY-002][SESSION-004] active native Codex status and output refresh in detail", async ({ page }) => {
  await page.addInitScript(({ url }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
  }, { url: gatewayUrl });

  const nativeSessions: MockNativeSession[] = [{
    id: "active-native-codex",
    agent: "codex",
    title: "电脑端正在执行的任务",
    cwd: "/Users/test/Projects/active-project",
    projectId: "project-active",
    projectName: "active-project",
    updatedAt: now,
    status: "running",
    resumable: true,
    source: "native",
  }];
  const nativeMessages = new Map([
    ["active-native-codex", [
      { id: "native-user-1", role: "user" as const, text: "检查当前任务" },
      { id: "native-assistant-1", role: "assistant" as const, text: "已开始检查。" },
    ]],
  ]);
  await page.route(`${gatewayUrl}/**`, (route) => (
    handleGatewayRoute(
      route,
      [],
      new Map(),
      "TestMac.local",
      [],
      nativeSessions,
      nativeMessages,
    )
  ));

  await page.goto("/");
  await expect(page.getByTestId("session-state-list-active-native-codex")).toHaveAttribute(
    "aria-label",
    "运行中",
  );
  await page.getByTestId("session-active-native-codex").click();
  const stream = page.getByTestId("session-stream");
  await expect(stream.locator(".stream-live-indicator")).toContainText("持续同步最新输出");
  await expect(stream).toContainText("已开始检查。");
  await expect(page.getByTestId("detail-reply")).toBeDisabled();
  await expect(page.getByTestId("detail-reply")).toHaveAttribute(
    "placeholder",
    "Agent 运行中，完成后可继续",
  );

  nativeMessages.get("active-native-codex")?.push({
    id: "native-assistant-2",
    role: "assistant",
    text: "电脑端新增的实时结果。",
  });
  await expect(stream).toContainText("电脑端新增的实时结果。", { timeout: 3_000 });

  nativeSessions[0]!.status = "completed";
  await expect(stream.locator(".stream-live-indicator")).toHaveCount(0, { timeout: 3_000 });
  await expect(page.getByTestId("detail-reply")).toBeEnabled();
});

test("[STREAM-002] gateway session detail prefers SSE with Last-Event-ID resume", async ({ page }) => {
  const sseRequests: string[] = [];
  await page.addInitScript(({ url }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
  }, { url: gatewayUrl });

  const sessions: MockSession[] = [{
    id: "live-session",
    nativeId: "live-native",
    agent: "codex",
    title: "SSE 实时会话",
    cwd: "/Users/test/Projects/live",
    permissionMode: "ask",
    status: "running",
    createdAt: now,
    updatedAt: now,
  }];
  const events = new Map<string, Array<Record<string, unknown>>>([
    ["live-session", [
      { seq: 1, type: "output", payload: { stream: "user", text: "SSE 实时会话" } },
      { seq: 2, type: "output", payload: { stream: "assistant", text: "通过 SSE 推送的输出。" } },
    ]],
  ]);

  await page.route(`${gatewayUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/events") && (request.headers().accept ?? "").includes("text/event-stream")) {
      sseRequests.push(String(url.searchParams.get("after") ?? request.headers()["last-event-id"] ?? "0"));
    }
    await handleGatewayRoute(route, sessions, events);
  });

  await page.goto("/");
  await page.getByTestId("session-live-session").click();
  await expect(page.getByTestId("session-stream")).toContainText("通过 SSE 推送的输出。", { timeout: 5_000 });
  expect(sseRequests.length).toBeGreaterThan(0);
  expect(sseRequests[0]).toBe("0");
});

test("[SESSION-006] running gateway session can be cancelled and shows cancelled state", async ({ page }) => {
  await installConnectedGateway(page);
  await page.goto("/");
  await page.getByTestId("session-codex-session").click();
  await expect(page.getByTestId("session-cancel")).toBeVisible();
  await page.getByTestId("session-cancel").click();
  await expect(page.getByTestId("session-status-cancelled")).toContainText("已取消");
  await expect(page.getByTestId("session-state-detail-codex-session")).toHaveAttribute("aria-label", "已取消");
  await expect(page.getByTestId("session-cancel")).toHaveCount(0);
});

test("[DEVICE-003] revoke device requires confirmation", async ({ page }) => {
  await installConnectedGateway(page);
  await page.goto("/");
  await page.getByTestId("nav-devices").click();
  await page.getByTestId("revoke-device-phone").click();
  await expect(page.getByTestId("revoke-confirm-phone")).toBeVisible();
  await page.getByTestId("revoke-confirm-action-phone").click();
  await expect(page.getByText("当前设备授权已撤销")).toBeVisible();
});

test("[SETTING-001][SETTING-002] settings toggles persist across reload", async ({ page }) => {
  await installConnectedGateway(page);
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  await page.getByRole("button", { name: "默认受限执行" }).click();
  await page.getByRole("button", { name: "Agent 状态通知" }).click();
  const stored = await page.evaluate(() => localStorage.getItem("remote-agent.app.preferences.v1"));
  expect(stored).toContain("\"defaultRestrictedExecution\":false");
  expect(stored).toContain("\"agentStatusNotifications\":false");
  await page.reload();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByRole("button", { name: "默认受限执行" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Agent 状态通知" })).toHaveAttribute("aria-pressed", "false");
});

test("[AGENT-001] mobile reads /v1/agents and disables missing CLI in tabs and new session", async ({ page }) => {
  await page.addInitScript(({ url }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
  }, { url: gatewayUrl });

  const agents = defaultMockAgents().map((agent) => (
    agent.kind === "claude"
      ? { ...agent, installed: false, version: undefined }
      : agent
  ));
  await page.route(`${gatewayUrl}/**`, (route) => (
    handleGatewayRoute(route, [], new Map(), "TestMac.local", [], [], new Map(), agents)
  ));

  await page.goto("/");
  await expect(page.getByTestId("agent-install-Claude")).toHaveText("未安装");
  await expect(page.getByTestId("filter-Claude")).toBeDisabled();
  await page.getByTestId("new-session").click();
  await expect(page.getByText("任务将在 TestMac.local 上执行")).toBeVisible();
  await expect(page.getByTestId("new-session-agent-Claude")).toBeDisabled();
  await expect(page.getByTestId("new-session-agent-Cursor")).toBeEnabled();
});

test("[CONN-001] background sync failure clears online UI", async ({ page }) => {
  await page.addInitScript(({ url }) => {
    localStorage.setItem("remote-agent.gateway.url", url);
    localStorage.setItem("remote-agent.gateway.token", "test-token");
    (window as unknown as { __REMOTE_AGENT_SYNC_MS__: number }).__REMOTE_AGENT_SYNC_MS__ = 400;
  }, { url: gatewayUrl });

  let failSync = false;
  await page.route(`${gatewayUrl}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const isStateSync = route.request().method() === "GET" && (
      path === "/v1/sessions"
      || path === "/v1/history"
      || path === "/v1/config"
      || path === "/v1/devices"
      || path === "/v1/agents"
    );
    if (failSync && isStateSync) {
      return route.fulfill({ status: 503, json: { error: { message: "offline" } } });
    }
    return handleGatewayRoute(route, [], new Map());
  });

  await page.goto("/");
  await expect(page.getByTestId("new-session")).toBeVisible();
  failSync = true;
  await page.waitForTimeout(900);
  await expect(page.getByTestId("new-session")).toHaveCount(0);
  await expect(page.locator(".connection-status-button .online-dot.is-offline")).toBeVisible();
});
