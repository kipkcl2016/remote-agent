import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { EventHub } from "./event-hub.js";
import { PairingManager, createDeviceToken, hashToken, isLoopbackAddress } from "./security.js";
import { GatewayService } from "./service.js";
import { NativeHistoryService } from "./history.js";
import { readSessionFile, SessionFileError, type SessionFile } from "./session-files.js";
import type { GatewayConfig } from "./config.js";
import {
  isAgentKind,
  isPermissionMode,
  type AgentUsageProvider,
  type SessionEvent,
} from "./types.js";

export type GatewayHttpOptions = {
  config: GatewayConfig;
  service: GatewayService;
  pairing: PairingManager;
  events: EventHub;
  history: NativeHistoryService;
  usage: AgentUsageProvider;
};

export function createGatewayHttpServer(options: GatewayHttpOptions): Server {
  const { config, service, pairing, events, history, usage } = options;
  const pairingAttempts = new Map<string, { count: number; resetAt: number }>();

  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");

    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (!applyCors(request, response, config.allowedOrigins)) return;
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/health") {
        sendJson(response, 200, {
          data: {
            status: "ok",
            hostname: hostname(),
            version: "0.1.0",
            now: new Date().toISOString(),
          },
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/v1/pairing/start") {
        if (!isLoopbackAddress(request.socket.remoteAddress)) {
          sendError(response, 403, "Pairing codes can only be created on the Mac");
          return;
        }
        sendJson(response, 201, { data: pairing.begin() });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/v1/pairing/confirm") {
        const address = request.socket.remoteAddress ?? "unknown";
        if (!consumeRateLimit(pairingAttempts, address, 10, 60_000)) {
          sendError(response, 429, "Too many pairing attempts");
          return;
        }
        const body = await readJson(request, config.maxBodyBytes);
        const code = readRequiredString(body, "code", 8);
        const deviceName = readRequiredString(body, "deviceName", 80);
        if (!pairing.consume(code)) {
          sendError(response, 401, "The pairing code is invalid or expired");
          return;
        }
        const token = createDeviceToken();
        service.store.addDevice(randomUUID(), deviceName, hashToken(token));
        sendJson(response, 201, { data: { token, deviceName } });
        return;
      }

      const currentDeviceId = authenticate(request, service);
      if (!currentDeviceId) {
        response.setHeader("WWW-Authenticate", "Bearer");
        sendError(response, 401, "A paired device token is required");
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/devices") {
        sendJson(response, 200, { data: service.store.listDevices(currentDeviceId) });
        return;
      }

      const revokeDeviceMatch = requestUrl.pathname.match(/^\/v1\/devices\/([^/]+)\/revoke$/);
      if (request.method === "POST" && revokeDeviceMatch?.[1]) {
        const deviceId = decodeURIComponent(revokeDeviceMatch[1]);
        if (!service.store.revokeDevice(deviceId)) {
          throw new ClientError(404, "Paired device not found");
        }
        sendJson(response, 200, { data: { id: deviceId, revoked: true } });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/agents") {
        sendJson(response, 200, { data: await service.listAgents() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/agents/usage") {
        sendJson(response, 200, { data: await usage.list() });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/config") {
        sendJson(response, 200, {
          data: {
            hostname: hostname(),
            allowedRoots: config.allowedRoots,
          },
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/history") {
        const agentParam = requestUrl.searchParams.get("agent");
        if (agentParam && !isAgentKind(agentParam)) {
          sendError(response, 400, "Unknown agent filter");
          return;
        }
        const agent = agentParam && isAgentKind(agentParam) ? agentParam : undefined;
        const limit = parsePositiveInteger(requestUrl.searchParams.get("limit"), 100);
        const perProjectLimit = parsePositiveInteger(
          requestUrl.searchParams.get("perProjectLimit"),
          20,
        );
        sendJson(response, 200, {
          data: await history.list({
            ...(agent ? { agent } : {}),
            limit,
            perProjectLimit,
          }),
        });
        return;
      }

      const nativeResumeMatch = requestUrl.pathname.match(
        /^\/v1\/history\/(cursor|claude|codex)\/([^/]+)\/resume$/,
      );
      if (request.method === "POST" && nativeResumeMatch?.[1] && nativeResumeMatch[2]) {
        const agent = nativeResumeMatch[1];
        if (!isAgentKind(agent)) throw new ClientError(400, "Unknown agent");
        const nativeId = decodeURIComponent(nativeResumeMatch[2]);
        const native = await history.get(agent, nativeId);
        if (!native) throw new ClientError(404, "Native session not found");
        if (!native.resumable) throw new ClientError(409, "This native session is browse-only");
        if (native.status === "running") {
          throw new ClientError(409, "This native session is still running");
        }
        const body = await readJson(request, config.maxBodyBytes);
        if (!isPermissionMode(body.permissionMode)) {
          throw new ClientError(400, "Unknown permission mode");
        }
        const session = await service.resumeNativeSession(
          native,
          readRequiredString(body, "prompt", 50_000),
          body.permissionMode,
        );
        sendJson(response, 202, { data: session });
        return;
      }

      const nativeSnapshotMatch = requestUrl.pathname.match(
        /^\/v1\/history\/(cursor|claude|codex)\/([^/]+)\/snapshot$/,
      );
      if (request.method === "GET" && nativeSnapshotMatch?.[1] && nativeSnapshotMatch[2]) {
        const agent = nativeSnapshotMatch[1];
        if (!isAgentKind(agent)) throw new ClientError(400, "Unknown agent");
        const nativeId = decodeURIComponent(nativeSnapshotMatch[2]);
        const limit = parsePositiveInteger(requestUrl.searchParams.get("limit"), 100);
        const snapshot = await history.snapshot(agent, nativeId, limit);
        if (!snapshot) throw new ClientError(404, "Native session not found");
        sendJson(response, 200, { data: snapshot });
        return;
      }

      const nativeMessagesMatch = requestUrl.pathname.match(
        /^\/v1\/history\/(cursor|claude|codex)\/([^/]+)\/messages$/,
      );
      if (request.method === "GET" && nativeMessagesMatch?.[1] && nativeMessagesMatch[2]) {
        const agent = nativeMessagesMatch[1];
        if (!isAgentKind(agent)) throw new ClientError(400, "Unknown agent");
        const nativeId = decodeURIComponent(nativeMessagesMatch[2]);
        const limit = parsePositiveInteger(requestUrl.searchParams.get("limit"), 100);
        const messages = await history.messages(agent, nativeId, limit);
        if (!messages) throw new ClientError(404, "Native session not found");
        sendJson(response, 200, { data: messages });
        return;
      }

      const nativeFileMatch = requestUrl.pathname.match(
        /^\/v1\/history\/(cursor|claude|codex)\/([^/]+)\/files\/read$/,
      );
      if (request.method === "POST" && nativeFileMatch?.[1] && nativeFileMatch[2]) {
        const agent = nativeFileMatch[1];
        if (!isAgentKind(agent)) throw new ClientError(400, "Unknown agent");
        const native = await history.get(agent, decodeURIComponent(nativeFileMatch[2]));
        if (!native) throw new ClientError(404, "Native session not found");
        if (!native.resumable) throw new ClientError(403, "Files are unavailable for this native session");
        const body = await readJson(request, config.maxBodyBytes);
        sendSessionFile(
          response,
          await readSessionFile(
            native.cwd,
            readRequiredString(body, "path", 4_096),
            config.allowedRoots,
          ),
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/sessions") {
        const agentParam = requestUrl.searchParams.get("agent");
        if (agentParam && !isAgentKind(agentParam)) {
          sendError(response, 400, "Unknown agent filter");
          return;
        }
        const agent = agentParam && isAgentKind(agentParam) ? agentParam : undefined;
        const limit = parsePositiveInteger(requestUrl.searchParams.get("limit"), 100);
        sendJson(response, 200, {
          data: service.listSessions({
            ...(agent ? { agent } : {}),
            limit,
          }),
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/v1/sessions") {
        const body = await readJson(request, config.maxBodyBytes);
        const agent = body.agent;
        const permissionMode = body.permissionMode;
        if (!isAgentKind(agent)) throw new ClientError(400, "Unknown agent");
        if (!isPermissionMode(permissionMode)) throw new ClientError(400, "Unknown permission mode");
        const session = await service.startSession({
          agent,
          permissionMode,
          prompt: readRequiredString(body, "prompt", 50_000),
          cwd: readRequiredString(body, "cwd", 4_096),
        });
        sendJson(response, 202, { data: session });
        return;
      }

      const sessionMatch = requestUrl.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
      if (request.method === "GET" && sessionMatch?.[1]) {
        const session = service.getSession(decodeURIComponent(sessionMatch[1]));
        if (!session) throw new ClientError(404, "Session not found");
        sendJson(response, 200, { data: session });
        return;
      }

      const sessionFileMatch = requestUrl.pathname.match(/^\/v1\/sessions\/([^/]+)\/files\/read$/);
      if (request.method === "POST" && sessionFileMatch?.[1]) {
        const session = service.getSession(decodeURIComponent(sessionFileMatch[1]));
        if (!session) throw new ClientError(404, "Session not found");
        const body = await readJson(request, config.maxBodyBytes);
        sendSessionFile(
          response,
          await readSessionFile(
            session.cwd,
            readRequiredString(body, "path", 4_096),
            config.allowedRoots,
          ),
        );
        return;
      }

      const eventsMatch = requestUrl.pathname.match(/^\/v1\/sessions\/([^/]+)\/events$/);
      if (request.method === "GET" && eventsMatch?.[1]) {
        const sessionId = decodeURIComponent(eventsMatch[1]);
        if (!service.getSession(sessionId)) throw new ClientError(404, "Session not found");
        const after = parsePositiveInteger(
          requestUrl.searchParams.get("after") ?? request.headers["last-event-id"],
          0,
        );
        if (request.headers.accept?.includes("text/event-stream")) {
          openEventStream(request, response, service, events, sessionId, after);
        } else {
          sendJson(response, 200, { data: service.listEvents(sessionId, after) });
        }
        return;
      }

      const messagesMatch = requestUrl.pathname.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
      if (request.method === "POST" && messagesMatch?.[1]) {
        const body = await readJson(request, config.maxBodyBytes);
        const session = await service.continueSession(
          decodeURIComponent(messagesMatch[1]),
          readRequiredString(body, "prompt", 50_000),
        );
        sendJson(response, 202, { data: session });
        return;
      }

      const cancelMatch = requestUrl.pathname.match(/^\/v1\/sessions\/([^/]+)\/cancel$/);
      if (request.method === "POST" && cancelMatch?.[1]) {
        sendJson(response, 200, { data: service.cancelSession(decodeURIComponent(cancelMatch[1])) });
        return;
      }

      sendError(response, 404, "Route not found");
    } catch (error) {
      if (error instanceof ClientError || error instanceof SessionFileError) {
        sendError(response, error.status, error.message);
      } else {
        const message = error instanceof Error ? error.message : "Unexpected gateway error";
        sendError(response, 500, message);
      }
    }
  });

  // Security: Set timeouts and connection limits
  server.setTimeout(30_000); // 30 seconds total timeout
  server.requestTimeout = 10_000; // 10 seconds to receive request body
  server.maxConnections = 100; // Limit concurrent connections

  return server;
}

class ClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[],
): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.includes(origin)) {
    sendError(response, 403, "Origin is not allowed");
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Disposition, Content-Length, X-Remote-Agent-Filename",
  );
  return true;
}

function authenticate(request: IncomingMessage, service: GatewayService): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  if (!token || token.length > 512) return undefined;
  return service.store.authenticateDevice(hashToken(token));
}

async function readJson(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) throw new ClientError(413, "Request body is too large");
    chunks.push(buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ClientError(400, "Request body must be valid JSON");
  }
}

function readRequiredString(body: Record<string, unknown>, key: string, maxLength: number): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ClientError(400, `${key} is required`);
  }
  if (value.length > maxLength) throw new ClientError(400, `${key} is too long`);
  return value.trim();
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: { message } });
}

function sendSessionFile(response: ServerResponse, file: SessionFile): void {
  if (response.headersSent) return;
  const encodedName = encodeURIComponent(file.name).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  response.writeHead(200, {
    "Content-Type": file.contentType,
    "Content-Length": file.bytes.byteLength,
    "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
    "X-Remote-Agent-Filename": encodedName,
  });
  response.end(file.bytes);
}

function parsePositiveInteger(raw: string | string[] | null | undefined, fallback: number): number {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (!candidate) return fallback;
  const parsed = Number.parseInt(candidate, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function openEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  service: GatewayService,
  events: EventHub,
  sessionId: string,
  after: number,
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    Connection: "keep-alive",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  response.write(": connected\n\n");
  for (const event of service.listEvents(sessionId, after)) writeEvent(response, event);
  const unsubscribe = events.subscribe(sessionId, (event) => writeEvent(response, event));
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
  heartbeat.unref();
  request.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function writeEvent(response: ServerResponse, event: SessionEvent): void {
  const MAX_EVENT_PAYLOAD_BYTES = 16_384; // 16KB per event
  response.write(`id: ${event.seq}\n`);
  response.write(`event: ${event.type}\n`);
  const serialized = JSON.stringify(event);
  if (serialized.length > MAX_EVENT_PAYLOAD_BYTES) {
    const truncated = { ...event, payload: { ...event.payload, _truncated: true } };
    const truncatedJson = JSON.stringify(truncated).slice(0, MAX_EVENT_PAYLOAD_BYTES);
    response.write(`data: ${truncatedJson}\n\n`);
  } else {
    response.write(`data: ${serialized}\n\n`);
  }
}

function consumeRateLimit(
  records: Map<string, { count: number; resetAt: number }>,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const current = records.get(key);
  if (!current || current.resetAt <= now) {
    records.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
