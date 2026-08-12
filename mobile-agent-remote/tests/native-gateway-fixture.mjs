import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const pairingCode = String(100_000 + Math.floor(Math.random() * 900_000));

const now = new Date().toISOString();

function initialSession({ id, agent, title, projectId, projectName }) {
  return {
    id,
    nativeId: `${id}-native`,
    agent,
    title,
    cwd: `/Users/test/Projects/${projectId}`,
    projectId,
    projectName,
    permissionMode: "ask",
    status: "completed",
    createdAt: now,
    updatedAt: now,
  };
}

const gateways = [
  {
    port: 17831,
    hostname: "NativeMacOne.local",
    token: randomBytes(32).toString("base64url"),
    nextSession: 1,
    delayMs: 0,
    sessions: [
      initialSession({
        id: "native-cursor-one",
        agent: "cursor",
        title: "修复原生登录流程",
        projectId: "native-one",
        projectName: "Native One",
      }),
      initialSession({
        id: "native-codex-one",
        agent: "codex",
        title: "运行原生支付测试",
        projectId: "native-one",
        projectName: "Native One",
      }),
    ],
    events: new Map(),
  },
  {
    port: 17832,
    hostname: "NativeMacTwo.local",
    token: randomBytes(32).toString("base64url"),
    nextSession: 1,
    delayMs: 0,
    sessions: [
      initialSession({
        id: "native-claude-two",
        agent: "claude",
        title: "第二台 Mac 原生会话",
        projectId: "native-two",
        projectName: "Native Two",
      }),
    ],
    events: new Map(),
  },
];

for (const gateway of gateways) {
  for (const session of gateway.sessions) {
    gateway.events.set(session.id, [
      { seq: 1, type: "output", payload: { stream: "user", text: session.title } },
      {
        seq: 2,
        type: "output",
        payload: { stream: "assistant_delta", text: "## 原生会话结果\n\n- 已通过 **Simulator** 验证。" },
      },
      { seq: 3, type: "completed", payload: { status: "completed" } },
    ]);
  }
}

function send(response, status, payload, origin) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": nativeOrigin(origin),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, contentType, filename, bytes, origin) {
  response.writeHead(200, {
    "Access-Control-Allow-Origin": nativeOrigin(origin),
    "Access-Control-Expose-Headers": "Content-Disposition, Content-Length, X-Remote-Agent-Filename",
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Content-Length": bytes.byteLength,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "X-Remote-Agent-Filename": encodeURIComponent(filename),
  });
  response.end(bytes);
}

function nativeOrigin(origin) {
  return origin === "capacitor://localhost" || origin === "https://localhost"
    ? origin
    : "capacitor://localhost";
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) reject(new Error("request body too large"));
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function currentDevice() {
  return [{
    id: "simulator-device",
    name: "iPhone Simulator",
    createdAt: now,
    lastSeenAt: new Date().toISOString(),
    current: true,
  }];
}

function createSession(gateway, body) {
  const timestamp = new Date().toISOString();
  const id = `created-${gateway.port}-${gateway.nextSession++}`;
  const title = String(body.prompt ?? "Simulator 新会话").replace(/\s+/g, " ").slice(0, 60);
  const cwd = String(body.cwd ?? "/Users/test/Projects/native-one");
  const projectName = cwd.split("/").filter(Boolean).at(-1) ?? "Project";
  const session = {
    id,
    nativeId: `${id}-native`,
    agent: body.agent === "cursor" || body.agent === "claude" ? body.agent : "codex",
    title,
    cwd,
    projectId: `project-${gateway.port}`,
    projectName,
    permissionMode: body.permissionMode === "auto" ? "auto" : "ask",
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  gateway.sessions.unshift(session);
  gateway.events.set(id, [
    { seq: 1, type: "output", payload: { stream: "user", text: title } },
    {
      seq: 2,
      type: "output",
      payload: {
        stream: "assistant_delta",
        text: [
          "## Simulator 分析结果",
          "",
          "1. 原生创建成功",
          "2. **Markdown** 流内容已显示",
          "",
          "[检查报告](./reports/simulator-check.md)",
          "",
          "[HTML 效果页](./reports/simulator-preview.html)",
          "",
          "![Simulator 效果图](./reports/simulator-preview.png)",
        ].join("\n"),
      },
    },
    { seq: 3, type: "completed", payload: { status: "completed" } },
  ]);
  return session;
}

function continueSession(gateway, session, body) {
  const timestamp = new Date().toISOString();
  session.status = "completed";
  session.updatedAt = timestamp;
  const events = gateway.events.get(session.id) ?? [];
  const nextSequence = (events.at(-1)?.seq ?? 0) + 1;
  events.push(
    { seq: nextSequence, type: "output", payload: { stream: "user", text: String(body.prompt ?? "") } },
    {
      seq: nextSequence + 1,
      type: "output",
      payload: { stream: "assistant_delta", text: "\n\n继续任务已完成，流式结果已同步。" },
    },
    { seq: nextSequence + 2, type: "completed", payload: { status: "completed" } },
  );
  gateway.events.set(session.id, events);
  return session;
}

async function handle(gateway, request, response) {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") {
    send(response, 204, {}, origin);
    return;
  }

  const url = new URL(request.url ?? "/", `http://127.0.0.1:${gateway.port}`);
  if (url.pathname === "/__pairing-code" && request.method === "GET") {
    send(response, 200, { data: { pairingCode } }, origin);
    return;
  }
  if (url.pathname === "/__control" && request.method === "POST") {
    const body = await readBody(request);
    gateway.delayMs = Math.max(0, Math.min(Number(body.delayMs) || 0, 10_000));
    send(response, 200, { data: { delayMs: gateway.delayMs } }, origin);
    return;
  }

  if (gateway.delayMs) await sleep(gateway.delayMs);

  if (url.pathname === "/v1/pairing/confirm" && request.method === "POST") {
    const body = await readBody(request);
    if (body.code !== pairingCode) {
      process.stdout.write(`pairing rejected on ${gateway.port}\n`);
      send(response, 400, { error: { message: "配对码无效或已过期" } }, origin);
      return;
    }
    process.stdout.write(`pairing accepted on ${gateway.port}\n`);
    send(response, 200, { data: { token: gateway.token, deviceName: "iPhone Simulator" } }, origin);
    return;
  }

  if (request.headers.authorization !== `Bearer ${gateway.token}`) {
    send(response, 401, { error: { message: "设备授权无效" } }, origin);
    return;
  }

  if (url.pathname === "/v1/sessions" && request.method === "GET") {
    send(response, 200, { data: gateway.sessions }, origin);
    return;
  }
  if (url.pathname === "/v1/sessions" && request.method === "POST") {
    send(response, 201, { data: createSession(gateway, await readBody(request)) }, origin);
    return;
  }
  if (url.pathname === "/v1/history" && request.method === "GET") {
    send(response, 200, { data: [] }, origin);
    return;
  }
  if (url.pathname === "/v1/config" && request.method === "GET") {
    send(response, 200, {
      data: { hostname: gateway.hostname, allowedRoots: ["/Users/test/Projects/native-one"] },
    }, origin);
    return;
  }
  if (url.pathname === "/v1/devices" && request.method === "GET") {
    send(response, 200, { data: currentDevice() }, origin);
    return;
  }
  if (url.pathname === "/v1/agents/usage" && request.method === "GET") {
    send(response, 200, {
      data: [
        {
          agent: "cursor",
          state: "unavailable",
          windows: [],
          message: "无法获取额度信息 · Cursor CLI 暂无个人额度接口",
          updatedAt: new Date().toISOString(),
        },
        {
          agent: "claude",
          state: "unavailable",
          windows: [],
          message: "无法获取额度信息 · API 模式没有套餐额度",
          updatedAt: new Date().toISOString(),
        },
        {
          agent: "codex",
          state: "available",
          windows: [
            { label: "5 小时", remainingPercent: 72, resetsAt: new Date(Date.now() + 3_600_000).toISOString() },
            { label: "每周", remainingPercent: 41, resetsAt: new Date(Date.now() + 86_400_000).toISOString() },
          ],
          updatedAt: new Date().toISOString(),
        },
      ],
    }, origin);
    return;
  }

  const fileMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/files\/read$/);
  if (fileMatch && request.method === "POST") {
    const session = gateway.sessions.find((candidate) => candidate.id === decodeURIComponent(fileMatch[1]));
    if (!session) {
      send(response, 404, { error: { message: "会话不存在" } }, origin);
      return;
    }
    const body = await readBody(request);
    const reference = String(body.path ?? "");
    if (reference.endsWith("simulator-check.md")) {
      sendFile(
        response,
        "text/markdown; charset=utf-8",
        "Simulator 检查报告.md",
        Buffer.from([
          "# Simulator 文件读取通过",
          "",
          "iPhone 与 iPad 使用相同的受控会话文件桥接。",
          "",
          "```mermaid",
          "flowchart LR",
          "  Mac[Mac 文件] --> Mobile[移动端 Markdown 预览]",
          "```",
        ].join("\n"), "utf8"),
        origin,
      );
      return;
    }
    if (reference.endsWith("simulator-preview.html")) {
      sendFile(
        response,
        "text/html; charset=utf-8",
        "Simulator 效果页.html",
        Buffer.from(
          "<!doctype html><html><body><h1>HTML 内置预览通过</h1><p>Simulator 隔离页面内容</p></body></html>",
          "utf8",
        ),
        origin,
      );
      return;
    }
    if (reference.endsWith("simulator-preview.png")) {
      sendFile(
        response,
        "image/png",
        "Simulator 效果图.png",
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQmwAAAABJRU5ErkJggg==",
          "base64",
        ),
        origin,
      );
      return;
    }
    send(response, 404, { error: { message: "Session file not found" } }, origin);
    return;
  }

  const eventMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/events$/);
  if (eventMatch && request.method === "GET") {
    const after = Number(url.searchParams.get("after") ?? 0);
    const events = (gateway.events.get(decodeURIComponent(eventMatch[1])) ?? [])
      .filter((event) => event.seq > after);
    send(response, 200, { data: events }, origin);
    return;
  }

  const messageMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
  if (messageMatch && request.method === "POST") {
    const session = gateway.sessions.find((candidate) => candidate.id === decodeURIComponent(messageMatch[1]));
    if (!session) {
      send(response, 404, { error: { message: "会话不存在" } }, origin);
      return;
    }
    send(response, 200, { data: continueSession(gateway, session, await readBody(request)) }, origin);
    return;
  }

  const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
  if (sessionMatch && request.method === "GET") {
    const session = gateway.sessions.find((candidate) => candidate.id === decodeURIComponent(sessionMatch[1]));
    if (!session) {
      send(response, 404, { error: { message: "会话不存在" } }, origin);
      return;
    }
    send(response, 200, { data: session }, origin);
    return;
  }

  send(response, 404, { error: { message: "fixture route not found" } }, origin);
}

const servers = gateways.map((gateway) => createServer((request, response) => {
  void handle(gateway, request, response).catch(() => {
    if (!response.headersSent) send(response, 500, { error: { message: "fixture request failed" } }, request.headers.origin);
    else response.end();
  });
}));

await Promise.all(servers.map((server, index) => new Promise((resolve) => {
  server.listen(gateways[index].port, "127.0.0.1", resolve);
})));

process.stdout.write("native gateway fixture ready\n");

const shutdown = () => {
  for (const server of servers) server.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
