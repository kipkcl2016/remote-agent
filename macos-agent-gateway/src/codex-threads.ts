import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import type { NativeHistorySession } from "./types.js";

const THREAD_CACHE_MS = 15_000;
const THREAD_LIST_TIMEOUT_MS = 12_000;
const MAX_OUTPUT_BYTES = 8 * 1_024 * 1_024;
const PAGE_LIMIT = 500;
const MAX_PAGES = 20;

export interface CodexThreadProvider {
  list(): Promise<NativeHistorySession[]>;
}

export type CodexThreadCatalogOptions = {
  now?: () => Date;
  probe?: () => Promise<NativeHistorySession[]>;
};

export class CodexThreadCatalog implements CodexThreadProvider {
  readonly #now: () => Date;
  readonly #probe: () => Promise<NativeHistorySession[]>;
  #cached: { expiresAt: number; sessions: NativeHistorySession[] } | null = null;
  #pending: Promise<NativeHistorySession[]> | null = null;

  constructor(options: CodexThreadCatalogOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#probe = options.probe ?? readCodexThreads;
  }

  async list(): Promise<NativeHistorySession[]> {
    const now = this.#now().getTime();
    if (this.#cached && this.#cached.expiresAt > now) return cloneSessions(this.#cached.sessions);
    if (this.#pending) return cloneSessions(await this.#pending);
    this.#pending = this.#probe();
    try {
      const sessions = await this.#pending;
      this.#cached = { expiresAt: now + THREAD_CACHE_MS, sessions };
      return cloneSessions(sessions);
    } finally {
      this.#pending = null;
    }
  }
}

export function parseCodexThreadPage(
  value: unknown,
  archived: boolean,
): { sessions: NativeHistorySession[]; nextCursor?: string } {
  if (!isRecord(value) || !Array.isArray(value.data)) return { sessions: [] };
  const sessions = value.data.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = readString(entry.id);
    const cwd = readString(entry.cwd);
    if (!id || !cwd) return [];
    const name = readString(entry.name);
    const preview = readString(entry.preview);
    const title = name ?? preview ?? cwd.split("/").filter(Boolean).at(-1) ?? "Codex 会话";
    const updatedAt = readEpochSeconds(entry.updatedAt) ?? readEpochSeconds(entry.createdAt);
    if (!updatedAt) return [];
    const createdAt = readEpochSeconds(entry.createdAt);
    const status = readCodexThreadStatus(entry.status);
    return [{
      id,
      agent: "codex" as const,
      title,
      cwd,
      ...(createdAt ? { createdAt } : {}),
      updatedAt,
      status,
      resumable: true,
      ...(archived ? { archived: true } : {}),
      source: "native" as const,
    }];
  });
  const nextCursor = readString(value.nextCursor);
  return { sessions, ...(nextCursor ? { nextCursor } : {}) };
}

function readCodexThreadStatus(value: unknown): "running" | "completed" | "failed" {
  if (!isRecord(value)) return "completed";
  if (value.type === "active") return "running";
  if (value.type === "systemError") return "failed";
  return "completed";
}

async function readCodexThreads(): Promise<NativeHistorySession[]> {
  const executable = await findExecutable("codex");
  if (!executable) throw new Error("codex unavailable");

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["app-server", "--stdio"], {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const sessions: NativeHistorySession[] = [];
    let settled = false;
    let buffer = "";
    let totalBytes = 0;
    let requestId = 2;
    let expectedRequestId = 2;
    let pageCount = 0;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(deduplicateSessions(sessions));
    };
    const send = (message: Record<string, unknown>) => {
      if (!settled && child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const requestPage = (cursor?: string) => {
      pageCount += 1;
      if (pageCount > MAX_PAGES) {
        finish(new Error("codex thread list exceeded page limit"));
        return;
      }
      expectedRequestId = requestId;
      send({
        method: "thread/list",
        id: requestId,
        params: {
          limit: PAGE_LIMIT,
          sortKey: "updated_at",
          sortDirection: "desc",
          // Active threads only; do not page into archived history.
          archived: false,
          ...(cursor ? { cursor } : {}),
        },
      });
      requestId += 1;
    };
    const handleLine = (line: string) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(message)) return;
      if (message.id === 1) {
        if (message.error) {
          finish(new Error("codex initialization failed"));
          return;
        }
        send({ method: "initialized", params: {} });
        requestPage();
        return;
      }
      if (message.id !== expectedRequestId) return;
      if (message.error) {
        finish(new Error("codex thread list unavailable"));
        return;
      }
      const parsed = parseCodexThreadPage(message.result, false);
      sessions.push(...parsed.sessions);
      if (parsed.nextCursor) {
        requestPage(parsed.nextCursor);
      } else {
        finish();
      }
    };

    const timer = setTimeout(
      () => finish(new Error("codex thread list timed out")),
      THREAD_LIST_TIMEOUT_MS,
    );
    timer.unref();
    child.once("spawn", () => {
      send({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: {
            name: "remote_agent_gateway",
            title: "Remote Agent Gateway",
            version: "0.1.0",
          },
          capabilities: {},
        },
      });
    });
    child.once("error", () => finish(new Error("codex failed to start")));
    child.once("close", () => finish(new Error("codex exited before returning threads")));
    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        finish(new Error("codex thread list response was too large"));
        return;
      }
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) handleLine(line);
      }
    });
  });
}

function deduplicateSessions(sessions: NativeHistorySession[]): NativeHistorySession[] {
  const unique = new Map<string, NativeHistorySession>();
  for (const session of sessions) {
    const current = unique.get(session.id);
    if (!current || session.updatedAt > current.updatedAt) unique.set(session.id, session);
  }
  return [...unique.values()];
}

function cloneSessions(sessions: NativeHistorySession[]): NativeHistorySession[] {
  return sessions.map((session) => ({ ...session }));
}

async function findExecutable(command: string): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching the fixed command on PATH.
    }
  }
  return undefined;
}

function readEpochSeconds(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
