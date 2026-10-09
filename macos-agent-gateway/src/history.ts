import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { CodexThreadProvider } from "./codex-threads.js";
import { scanCursorComposerHeaders } from "./cursor-composers.js";
import { resolveAllowedWorkingDirectory } from "./security.js";
import { ProjectResolver } from "./project-resolver.js";
import type { GatewayConfig } from "./config.js";
import type { AgentKind, NativeHistoryMessage, NativeHistorySession } from "./types.js";

const MAX_SCAN_FILES = 5_000;
const MAX_PREFIX_BYTES = 256 * 1_024;
const MAX_MESSAGE_WINDOW_BYTES = 8 * 1_024 * 1_024;
const CODEX_RUNTIME_STATUS_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export class NativeHistoryService {
  readonly #projects: ProjectResolver;

  constructor(
    readonly dirs: GatewayConfig["historyDirs"],
    readonly allowedRoots: string[],
    readonly codexThreads?: CodexThreadProvider,
  ) {
    this.#projects = new ProjectResolver(allowedRoots);
  }

  async list(options: {
    agent?: AgentKind;
    limit?: number;
    perProjectLimit?: number;
  } = {}): Promise<NativeHistorySession[]> {
    const candidates = options.agent
      ? await this.scanAgent(options.agent)
      : (await Promise.all(
        (["cursor", "claude", "codex"] as const).map((agent) => this.scanAgent(agent)),
      )).flat();
    const limit = Math.max(1, Math.min(options.limit ?? 100, 2_000));
    const perProjectLimit = options.perProjectLimit
      ? Math.max(1, Math.min(options.perProjectLimit, 100))
      : undefined;
    const sorted = deduplicateSessions(candidates)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((session) => this.withProject(session));
    if (!perProjectLimit) return sorted.slice(0, limit);
    const counts = new Map<string, number>();
    return sorted.filter((session) => {
      const key = `${session.agent}:${session.projectId ?? session.cwd}`;
      const count = counts.get(key) ?? 0;
      if (count >= perProjectLimit) return false;
      counts.set(key, count + 1);
      return true;
    }).slice(0, limit);
  }

  async get(agent: AgentKind, id: string): Promise<NativeHistorySession | undefined> {
    if (!isSafeSessionId(id)) return undefined;
    const session = (await this.scanAgent(agent)).find(
      (candidate) => candidate.id === id,
    );
    return session ? this.withProject(session) : undefined;
  }

  async messages(
    agent: AgentKind,
    id: string,
    limit = 100,
  ): Promise<NativeHistoryMessage[] | undefined> {
    const session = await this.get(agent, id);
    if (!session) return undefined;
    const path = resolveNativeMessagePath(agent, id, this.dirs);
    if (!path) return [];
    const messages = readNativeMessages(agent, path);
    return messages.slice(-Math.max(1, Math.min(limit, 500)));
  }

  async snapshot(
    agent: AgentKind,
    id: string,
    limit = 100,
  ): Promise<{ session: NativeHistorySession; messages: NativeHistoryMessage[] } | undefined> {
    const session = await this.get(agent, id);
    if (!session) return undefined;
    const path = resolveNativeMessagePath(agent, id, this.dirs);
    if (!path) return { session, messages: [] };
    const messages = readNativeMessages(agent, path);
    return {
      session,
      messages: messages.slice(-Math.max(1, Math.min(limit, 500))),
    };
  }

  private async scanAgent(agent: AgentKind): Promise<NativeHistorySession[]> {
    if (agent === "cursor") {
      const fromHeaders = scanCursorComposerHeaders(this.dirs.cursorComposerDb);
      if (fromHeaders.length > 0) {
        // Glass/composer IDs are valid cursor-agent --resume targets; allowed-roots
        // still applied in withProject(). Do not require ~/.cursor/chats stores —
        // modern IDE sessions often only exist in composerHeaders + transcripts.
        return fromHeaders.map((session) => ({
          ...session,
          resumable: true,
        }));
      }
      // Fallback when Composer DB is missing: legacy acp-sessions + chats meta.json scan.
      const sessions = [
        ...scanCursor(this.dirs.cursor, false),
        ...scanCursor(this.dirs.cursorChats, true),
      ];
      return [...new Map(sessions.map((session) => [session.id, session])).values()];
    }
    if (agent === "claude") return scanClaude(this.dirs.claude);
    // Active Codex sessions only; archived_sessions are intentionally ignored.
    const rollouts = deduplicateSessions(scanCodex(this.dirs.codex));
    if (this.codexThreads) {
      try {
        const catalog = await this.codexThreads.list();
        const rolloutById = new Map(rollouts.map((session) => [session.id, session]));
        const merged = catalog.map((session) => {
          const rollout = rolloutById.get(session.id);
          rolloutById.delete(session.id);
          return {
            ...session,
            status: mergeCodexStatus(session.status, rollout?.status),
          };
        });
        return deduplicateSessions([...merged, ...rolloutById.values()]);
      } catch {
        // Fall back to the rollout scanner when app-server is unavailable.
      }
    }
    return rollouts;
  }

  private isAllowed(cwd: string): boolean {
    try {
      resolveAllowedWorkingDirectory(cwd, this.allowedRoots);
      return true;
    } catch {
      return false;
    }
  }

  private withProject(session: NativeHistorySession): NativeHistorySession {
    return {
      ...session,
      resumable: session.resumable && this.isAllowed(session.cwd),
      ...this.#projects.resolveStored(session.cwd),
    };
  }
}

function deduplicateSessions(sessions: NativeHistorySession[]): NativeHistorySession[] {
  const unique = new Map<string, NativeHistorySession>();
  for (const session of sessions) {
    const current = unique.get(session.id);
    if (!current || session.updatedAt > current.updatedAt) unique.set(session.id, session);
  }
  return [...unique.values()];
}

function scanCursor(root: string, resumable: boolean): NativeHistorySession[] {
  return walkFiles(root, ".json")
    .filter((path) => basename(path) === "meta.json")
    .slice(0, MAX_SCAN_FILES)
    .flatMap((metaPath) => {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
        const cwd = readString(meta.cwd);
        if (!cwd) return [];
        const stats = statSync(metaPath);
        return [{
          id: basename(dirname(metaPath)),
          agent: "cursor" as const,
          title: cleanTitle(readString(meta.title) ?? basename(cwd) ?? "Cursor 会话"),
          cwd,
          updatedAt: readEpochDate(meta.updatedAtMs) ?? stats.mtime.toISOString(),
          createdAt: readEpochDate(meta.createdAtMs) ?? stats.birthtime.toISOString(),
          status: "completed" as const,
          resumable,
          source: "native" as const,
        }];
      } catch {
        return [];
      }
    });
}

function readEpochDate(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function scanClaude(root: string): NativeHistorySession[] {
  return walkFiles(root, ".jsonl")
    .slice(0, MAX_SCAN_FILES)
    .flatMap((path) => {
      try {
        const stats = statSync(path);
        let id = basename(path, ".jsonl");
        let cwd = "";
        let title = "";
        let createdAt: string | undefined;
        for (const row of readJsonLinesPrefix(path)) {
          if (!id && readString(row.sessionId)) id = readString(row.sessionId) ?? id;
          cwd ||= readString(row.cwd) ?? "";
          createdAt ||= readIsoDate(row.timestamp);
          if (row.type === "custom-title") title ||= readString(row.customTitle) ?? "";
          if (row.type === "user" && !title) title = extractClaudeUserText(row);
          if (cwd && title) break;
        }
        if (!cwd || !id) return [];
        return [{
          id,
          agent: "claude" as const,
          title: cleanTitle(title || basename(cwd) || "Claude 会话"),
          cwd,
          ...(createdAt ? { createdAt } : {}),
          updatedAt: stats.mtime.toISOString(),
          status: "completed" as const,
          resumable: true,
          source: "native" as const,
        }];
      } catch {
        return [];
      }
    });
}

function scanCodex(root: string): NativeHistorySession[] {
  return walkFiles(root, ".jsonl")
    .slice(0, MAX_SCAN_FILES)
    .flatMap((path) => {
      try {
        const stats = statSync(path);
        let id = idFromCodexFilename(path);
        let cwd = "";
        let title = "";
        let createdAt: string | undefined;
        for (const row of readJsonLinesPrefix(path)) {
          const payload = readRecord(row.payload);
          if (!payload) continue;
          if (row.type === "session_meta") {
            id = readString(payload.id) ?? readString(payload.session_id) ?? id;
            cwd ||= readString(payload.cwd) ?? "";
            createdAt ||= readIsoDate(payload.timestamp) ?? readIsoDate(row.timestamp);
          }
          if (row.type === "event_msg" && payload.type === "user_message" && !title) {
            title = readString(payload.message) ?? "";
          }
          if (cwd && title) break;
        }
        if (!cwd || !id) return [];
        return [{
          id,
          agent: "codex" as const,
          title: cleanTitle(title || basename(cwd) || "Codex 会话"),
          cwd,
          ...(createdAt ? { createdAt } : {}),
          updatedAt: stats.mtime.toISOString(),
          status: readCodexRuntimeStatus(path, stats.mtimeMs),
          resumable: true,
          source: "native" as const,
        }];
      } catch {
        return [];
      }
    });
}

function readCodexRuntimeStatus(
  path: string,
  modifiedAtMs: number,
): "running" | "completed" | "failed" {
  if (Date.now() - modifiedAtMs > CODEX_RUNTIME_STATUS_MAX_AGE_MS) {
    return "completed";
  }
  const rows = readJsonLinesWindow(path);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.type !== "event_msg") continue;
    const payload = readRecord(row.payload);
    if (!payload) continue;
    if (payload.type === "task_complete" || payload.type === "turn_aborted") return "completed";
    if (payload.type === "task_started" || payload.type === "user_message") return "running";
    if (payload.type === "stream_error") return "failed";
  }
  return "completed";
}

function mergeCodexStatus(
  catalogStatus: NativeHistorySession["status"],
  rolloutStatus: NativeHistorySession["status"],
): NonNullable<NativeHistorySession["status"]> {
  if (catalogStatus === "running" || catalogStatus === "failed") return catalogStatus;
  return rolloutStatus ?? catalogStatus ?? "completed";
}

function extractClaudeUserText(row: Record<string, unknown>): string {
  const message = readRecord(row.message);
  if (!message || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((item) => {
      const record = readRecord(item);
      return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join(" ");
}

function safeDirectories(root: string): Dirent[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
}

function walkFiles(root: string, extension: string): string[] {
  const found: string[] = [];
  const pending = [root];
  while (pending.length && found.length < MAX_SCAN_FILES) {
    const current = pending.pop();
    if (!current) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && extname(entry.name) === extension) found.push(path);
      if (found.length >= MAX_SCAN_FILES) break;
    }
  }
  return found;
}

function readJsonLinesPrefix(path: string): Record<string, unknown>[] {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_PREFIX_BYTES);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer
      .subarray(0, bytes)
      .toString("utf8")
      .split("\n")
      .slice(0, -1)
      .flatMap((line) => {
        try {
          const value: unknown = JSON.parse(line);
          return value && typeof value === "object" && !Array.isArray(value)
            ? [value as Record<string, unknown>]
            : [];
        } catch {
          return [];
        }
      });
  } finally {
    closeSync(fd);
  }
}

function readJsonLinesWindow(path: string): Record<string, unknown>[] {
  const stats = statSync(path);
  const start = Math.max(0, stats.size - MAX_MESSAGE_WINDOW_BYTES);
  const length = Math.min(stats.size, MAX_MESSAGE_WINDOW_BYTES);
  const fd = openSync(path, "r");
  try {
    // Use Buffer.alloc (zero-filled) instead of allocUnsafe for security
    const buffer = Buffer.alloc(Math.min(length, stats.size));
    const bytes = readSync(fd, buffer, 0, buffer.length, start);
    let content = buffer.subarray(0, bytes).toString("utf8");
    if (start > 0) content = content.slice(Math.max(0, content.indexOf("\n") + 1));
    return content.split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const value: unknown = JSON.parse(line);
        return value && typeof value === "object" && !Array.isArray(value)
          ? [value as Record<string, unknown>]
          : [];
      } catch {
        return [];
      }
    });
  } finally {
    closeSync(fd);
  }
}

function resolveNativeMessagePath(
  agent: AgentKind,
  id: string,
  dirs: GatewayConfig["historyDirs"],
): string | undefined {
  if (agent === "cursor") return findCursorTranscriptPath(dirs.cursorTranscripts, id);
  if (agent === "claude") return findClaudePath(dirs.claude, id);
  return findCodexPath([dirs.codex], id);
}

function readNativeMessages(agent: AgentKind, path: string): NativeHistoryMessage[] {
  if (agent === "cursor") return readCursorMessages(path);
  if (agent === "claude") return readClaudeMessages(path);
  return readCodexMessages(path);
}

function findClaudePath(root: string, id: string): string | undefined {
  return walkFiles(root, ".jsonl").find((path) => basename(path, ".jsonl") === id);
}

function findCursorTranscriptPath(root: string, id: string): string | undefined {
  if (!isSafeSessionId(id) || !root || !existsSync(root)) return undefined;
  const direct = join(root, "agent-transcripts", id, `${id}.jsonl`);
  if (existsSync(direct)) return direct;
  for (const project of safeDirectories(root)) {
    const preferred = join(root, project.name, "agent-transcripts", id, `${id}.jsonl`);
    if (existsSync(preferred)) return preferred;
    const folder = join(root, project.name, "agent-transcripts", id);
    if (!existsSync(folder)) continue;
    try {
      const match = readdirSync(folder).find((name) => name.endsWith(".jsonl"));
      if (match) return join(folder, match);
    } catch {
      // Ignore unreadable project transcript folders.
    }
  }
  return undefined;
}

function findCodexPath(roots: string[], id: string): string | undefined {
  for (const root of roots) {
    for (const path of walkFiles(root, ".jsonl")) {
      if (idFromCodexFilename(path) === id) return path;
      const meta = readJsonLinesPrefix(path).find((row) => row.type === "session_meta");
      const payload = readRecord(meta?.payload);
      if (readString(payload?.id) === id || readString(payload?.session_id) === id) return path;
    }
  }
  return undefined;
}

function readCursorMessages(path: string): NativeHistoryMessage[] {
  return readJsonLinesWindow(path).flatMap((row, index) => {
    const role = row.role === "user" || row.role === "assistant"
      ? row.role
      : undefined;
    if (!role) return [];
    const message = readRecord(row.message) ?? row;
    const text = cleanCursorMessageText(readMessageContent(message.content), role);
    if (!text) return [];
    const createdAt = readIsoDate(row.timestamp) ?? readIsoDate(message.timestamp);
    return [{
      id: readString(row.uuid) ?? readString(message.id) ?? `cursor-${index}`,
      role,
      text,
      ...(createdAt ? { createdAt } : {}),
    }];
  });
}

function readClaudeMessages(path: string): NativeHistoryMessage[] {
  return readJsonLinesWindow(path).flatMap((row, index) => {
    if (row.type !== "user" && row.type !== "assistant") return [];
    const message = readRecord(row.message);
    if (!message || (message.role !== "user" && message.role !== "assistant")) return [];
    const text = cleanMessageText(readMessageContent(message.content));
    if (!text) return [];
    const createdAt = readIsoDate(row.timestamp);
    return [{
      id: readString(row.uuid) ?? `claude-${index}`,
      role: message.role,
      text,
      ...(createdAt ? { createdAt } : {}),
    }];
  });
}

function readCodexMessages(path: string): NativeHistoryMessage[] {
  return readJsonLinesWindow(path).flatMap((row, index) => {
    if (row.type !== "event_msg") return [];
    const payload = readRecord(row.payload);
    if (!payload || (payload.type !== "user_message" && payload.type !== "agent_message")) return [];
    const text = cleanMessageText(readString(payload.message) ?? "");
    if (!text) return [];
    const createdAt = readIsoDate(row.timestamp);
    return [{
      id: readString(payload.client_id) ?? `codex-${index}`,
      role: payload.type === "user_message" ? "user" as const : "assistant" as const,
      text,
      ...(createdAt ? { createdAt } : {}),
    }];
  });
}

function readMessageContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((item) => {
    const record = readRecord(item);
    return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
  }).join("\n");
}

function cleanCursorMessageText(value: string, role: "user" | "assistant"): string {
  let text = value;
  if (role === "user") {
    const query = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
    if (query?.[1]) text = query[1];
    text = text
      .replace(/<timestamp\b[^>]*>[\s\S]*?<\/timestamp>/gi, " ")
      .replace(/<\/?user_query>/gi, " ")
      .trim();
  }
  return cleanMessageText(text);
}

function cleanMessageText(value: string): string {
  const withoutRuntimeContext = cleanInjectedRuntimeContext(value);
  if (!withoutRuntimeContext) return "";
  return withoutRuntimeContext.length > 20_000
    ? `${withoutRuntimeContext.slice(0, 19_999)}…`
    : withoutRuntimeContext;
}

function idFromCodexFilename(path: string): string {
  const match = basename(path, ".jsonl").match(/([0-9a-f]{8}-[0-9a-f-]{27,})$/i);
  return match?.[1] ?? basename(path, ".jsonl");
}

function cleanTitle(value: string): string {
  const withoutInjectedContext = cleanInjectedRuntimeContext(value)
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = withoutInjectedContext || "未命名会话";
  return fallback.length > 80 ? `${fallback.slice(0, 79)}…` : fallback;
}

function cleanInjectedRuntimeContext(value: string): string {
  const hasInAppBrowserWrapper = /<in-app-browser-context\b/i.test(value);
  let cleaned = value
    .replace(/<(?:system-reminder|environment_context|in-app-browser-context|recommended_plugins)[^>]*>[\s\S]*?<\/(?:system-reminder|environment_context|in-app-browser-context|recommended_plugins)>/gi, " ")
    .trim();
  if (hasInAppBrowserWrapper) {
    cleaned = cleaned.replace(/^\s*(?:#{1,6}\s*)?My Request\s*[:：]\s*/i, "").trim();
  }
  return cleaned;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readIsoDate(value: unknown): string | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isSafeSessionId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[a-zA-Z0-9._-]+$/.test(value);
}
