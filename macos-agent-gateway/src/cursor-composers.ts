import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NativeHistorySession } from "./types.js";

type ComposerHeaderRow = {
  composerId: string;
  lastUpdatedAt: number | null;
  createdAt: number | null;
  isArchived: number | null;
  isSubagent: number | null;
  value: string;
};

type ComposerHeaderSource = {
  composerId: string;
  header: Record<string, unknown>;
  lastUpdatedAt?: number | null;
  createdAt?: number | null;
  isArchived?: boolean;
  isSubagent?: boolean;
};

/**
 * Read Cursor IDE sidebar sessions from composerHeaders in state.vscdb.
 * Supports the legacy `composerHeaders` SQL table and Cursor 3.0+ `composer.composerHeaders`
 * in ItemTable (same index the Agents sidebar uses after the global migration).
 */
export function scanCursorComposerHeaders(dbPath: string): NativeHistorySession[] {
  if (!dbPath || !existsSync(dbPath)) return [];
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(dbPath, { readOnly: true });
    const sources = readComposerHeaderSources(database);
    const sessions: NativeHistorySession[] = [];
    for (const source of sources) {
      const session = mapComposerHeaderSource(database, source);
      if (session) sessions.push(session);
    }
    return sessions;
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

/** Cursor stores per-project transcripts under `~/.cursor/projects/<slug>/agent-transcripts/`. */
export function cursorProjectSlugFromCwd(cwd: string): string | undefined {
  const trimmed = cwd.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) {
    return trimmed.replace(/^\/+/, "").replace(/\//g, "-");
  }
  return trimmed.replace(/[:/\\]+/g, "-").replace(/^-+/, "") || undefined;
}

export function indexCursorChatIds(cursorChatsDir: string): Set<string> {
  if (!cursorChatsDir || !existsSync(cursorChatsDir)) return new Set();
  const ids = new Set<string>();
  walkMetaDirs(cursorChatsDir, (sessionId) => {
    ids.add(sessionId);
  });
  return ids;
}

function readComposerHeaderSources(database: DatabaseSync): ComposerHeaderSource[] {
  const fromTable = readComposerHeaderTable(database);
  if (fromTable.length > 0) return fromTable;
  return readComposerHeadersItemTable(database);
}

function readComposerHeaderTable(database: DatabaseSync): ComposerHeaderSource[] {
  try {
    const rows = database
      .prepare(
        `SELECT composerId, lastUpdatedAt, createdAt, isArchived, isSubagent, value
         FROM composerHeaders
         WHERE IFNULL(isArchived, 0) = 0
           AND IFNULL(isSubagent, 0) = 0`,
      )
      .all() as ComposerHeaderRow[];
    return rows.flatMap((row) => {
      try {
        const header = JSON.parse(row.value) as Record<string, unknown>;
        return [{
          composerId: row.composerId,
          header,
          lastUpdatedAt: row.lastUpdatedAt,
          createdAt: row.createdAt,
          isArchived: row.isArchived === 1 || header.isArchived === true,
          isSubagent: row.isSubagent === 1 || header.isSubagent === true,
        }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function readComposerHeadersItemTable(database: DatabaseSync): ComposerHeaderSource[] {
  try {
    const row = database
      .prepare(`SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders' LIMIT 1`)
      .get() as { value?: string | Buffer } | undefined;
    const raw = row?.value;
    const text = typeof raw === "string"
      ? raw
      : raw instanceof Buffer
        ? raw.toString("utf8")
        : undefined;
    if (!text) return [];
    const parsed = JSON.parse(text) as { allComposers?: unknown };
    if (!Array.isArray(parsed.allComposers)) return [];
    return parsed.allComposers.flatMap((item) => {
      const header = asRecord(item);
      if (!header) return [];
      const composerId = readString(header.composerId);
      if (!composerId) return [];
      return [{
        composerId,
        header,
        lastUpdatedAt: typeof header.lastUpdatedAt === "number" ? header.lastUpdatedAt : null,
        createdAt: typeof header.createdAt === "number" ? header.createdAt : null,
        isArchived: header.isArchived === true,
        isSubagent: header.isSubagent === true,
      }];
    });
  } catch {
    return [];
  }
}

function mapComposerHeaderSource(
  database: DatabaseSync,
  source: ComposerHeaderSource,
): NativeHistorySession | undefined {
  try {
    const { header, composerId } = source;
    if (source.isArchived || source.isSubagent || header.isArchived === true || header.isDraft === true) {
      return undefined;
    }
    const title = readString(header.name) ?? readComposerDataTitle(database, composerId);
    if (!title) return undefined;
    const cwd = resolveComposerCwd(header);
    if (!cwd) return undefined;
    const updatedAt = readEpochDate(source.lastUpdatedAt)
      ?? readEpochDate(header.lastUpdatedAt)
      ?? new Date().toISOString();
    const createdAt = readEpochDate(source.createdAt) ?? readEpochDate(header.createdAt);
    return {
      id: composerId,
      agent: "cursor",
      title: cleanTitle(title),
      cwd,
      ...(createdAt ? { createdAt } : {}),
      updatedAt,
      status: "completed",
      resumable: false,
      source: "native",
    };
  } catch {
    return undefined;
  }
}

function readComposerDataTitle(database: DatabaseSync, composerId: string): string | undefined {
  try {
    const row = database
      .prepare(`SELECT value FROM cursorDiskKV WHERE key = ? LIMIT 1`)
      .get(`composerData:${composerId}`) as { value?: string | Buffer } | undefined;
    const raw = row?.value;
    const text = typeof raw === "string"
      ? raw
      : raw instanceof Buffer
        ? raw.toString("utf8")
        : undefined;
    if (!text) return undefined;
    const data = JSON.parse(text) as Record<string, unknown>;
    return readString(data.name) ?? readString(data.title);
  } catch {
    return undefined;
  }
}

function resolveComposerCwd(header: Record<string, unknown>): string | undefined {
  const workspace = asRecord(header.workspaceIdentifier);
  const agentLocation = asRecord(header.agentLocation);
  const environment = asRecord(agentLocation?.environment);
  const direct = readFsPath(asRecord(workspace?.uri))
    ?? readFsPath(asRecord(environment?.uri));
  if (direct) return direct;
  const configPath = readFsPath(asRecord(workspace?.configPath))
    ?? readFsPath(asRecord(environment?.configPath));
  if (!configPath) return undefined;
  if (configPath.endsWith(".code-workspace")) {
    return firstFolderFromCodeWorkspace(configPath) ?? configPath;
  }
  return configPath;
}

function firstFolderFromCodeWorkspace(configPath: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      folders?: Array<{ path?: string }>;
    };
    const relative = raw.folders?.map((folder) => folder.path).find((path) => Boolean(path));
    if (!relative) return undefined;
    return isAbsolute(relative) ? relative : resolve(dirname(configPath), relative);
  } catch {
    return undefined;
  }
}

function walkMetaDirs(root: string, onSession: (id: string) => void, depth = 0): void {
  if (depth > 6) return;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = resolve(root, name);
    if (name === "meta.json") {
      onSession(basename(root));
      continue;
    }
    try {
      if (statSync(full).isDirectory()) walkMetaDirs(full, onSession, depth + 1);
    } catch {
      // Skip unreadable entries.
    }
  }
}

function readFsPath(value: Record<string, unknown> | undefined): string | undefined {
  return readString(value?.fsPath) ?? readString(value?.path);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readEpochDate(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 200);
}
