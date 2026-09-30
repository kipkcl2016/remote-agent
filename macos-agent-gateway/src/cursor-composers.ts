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

/**
 * Read Cursor IDE sidebar sessions from composerHeaders in state.vscdb.
 * This is the same index the Workspaces panel uses for titles and archive state.
 */
export function scanCursorComposerHeaders(dbPath: string): NativeHistorySession[] {
  if (!dbPath || !existsSync(dbPath)) return [];
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(dbPath, { readOnly: true });
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
        if (header.isArchived === true || header.isDraft === true) return [];
        const title = readString(header.name);
        if (!title) return [];
        const cwd = resolveComposerCwd(header);
        if (!cwd) return [];
        const updatedAt = readEpochDate(row.lastUpdatedAt)
          ?? readEpochDate(header.lastUpdatedAt)
          ?? new Date().toISOString();
        const createdAt = readEpochDate(row.createdAt) ?? readEpochDate(header.createdAt);
        return [{
          id: row.composerId,
          agent: "cursor" as const,
          title: cleanTitle(title),
          cwd,
          ...(createdAt ? { createdAt } : {}),
          updatedAt,
          status: "completed" as const,
          resumable: false,
          source: "native" as const,
        }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

export function indexCursorChatIds(cursorChatsDir: string): Set<string> {
  if (!cursorChatsDir || !existsSync(cursorChatsDir)) return new Set();
  const ids = new Set<string>();
  walkMetaDirs(cursorChatsDir, (sessionId) => {
    ids.add(sessionId);
  });
  return ids;
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
