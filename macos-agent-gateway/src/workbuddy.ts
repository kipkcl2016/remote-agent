import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NativeHistoryMessage, NativeHistorySession } from "./types.js";

type WorkbuddySessionRow = {
  id: string;
  cwd: string;
  title: string | null;
  custom_title: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  last_activity_at: number | null;
  deleted_at: number | null;
};

/** List WorkBuddy sessions from ~/.workbuddy/workbuddy.db (non-deleted). */
export function scanWorkbuddySessions(dbPath: string): NativeHistorySession[] {
  if (!dbPath || !existsSync(dbPath)) return [];
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(dbPath, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT id, cwd, title, custom_title, status, created_at, updated_at, last_activity_at, deleted_at
         FROM sessions
         WHERE deleted_at IS NULL
         ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC
         LIMIT 2000`,
      )
      .all() as WorkbuddySessionRow[];
    return rows.flatMap((row) => {
      const id = String(row.id ?? "").trim();
      const cwd = String(row.cwd ?? "").trim();
      if (!id || !cwd) return [];
      const title =
        (row.custom_title && String(row.custom_title).trim()) ||
        (row.title && String(row.title).trim()) ||
        basename(cwd) ||
        "WorkBuddy 会话";
      const updatedMs = Number(row.last_activity_at ?? row.updated_at ?? row.created_at);
      const createdMs = Number(row.created_at);
      if (!Number.isFinite(updatedMs)) return [];
      return [{
        id,
        agent: "workbuddy" as const,
        title,
        cwd,
        ...(Number.isFinite(createdMs) ? { createdAt: new Date(createdMs).toISOString() } : {}),
        updatedAt: new Date(updatedMs).toISOString(),
        status: mapWorkbuddyStatus(row.status),
        resumable: true,
        source: "native" as const,
      }];
    });
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

export function findWorkbuddyMessagePath(
  projectsRoot: string,
  id: string,
  cwd?: string,
): string | undefined {
  if (!id || !projectsRoot || !existsSync(projectsRoot)) return undefined;
  const candidates: string[] = [];
  if (cwd) {
    candidates.push(join(projectsRoot, workbuddyProjectSlug(cwd), `${id}.jsonl`));
  }
  try {
    for (const name of readdirSync(projectsRoot)) {
      candidates.push(join(projectsRoot, name, `${id}.jsonl`));
    }
  } catch {
    // ignore
  }
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function readWorkbuddyMessages(path: string): NativeHistoryMessage[] {
  if (!path || !existsSync(path)) return [];
  const messages: NativeHistoryMessage[] = [];
  let index = 0;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (record.type !== "message") continue;
    const role = record.role === "user" || record.role === "assistant" ? record.role : undefined;
    if (!role) continue;
    const text = extractWorkbuddyText(record.content);
    if (!text || looksLikeWorkbuddyNoise(text)) continue;
    index += 1;
    const createdAt = typeof record.timestamp === "number"
      ? new Date(record.timestamp).toISOString()
      : undefined;
    messages.push({
      id: typeof record.id === "string" ? record.id : `workbuddy-${index}`,
      role,
      text,
      ...(createdAt ? { createdAt } : {}),
    });
  }
  return messages;
}

export function workbuddyProjectSlug(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) {
    return trimmed.replace(/^\/+/, "").replace(/\//g, "-");
  }
  return trimmed.replace(/[:/\\]+/g, "-").replace(/^-+/, "");
}

function mapWorkbuddyStatus(status: string): "running" | "completed" | "failed" {
  const value = status.toLowerCase();
  if (value === "running" || value === "pending" || value === "in_progress") return "running";
  if (value === "failed" || value === "error") return "failed";
  return "completed";
}

function extractWorkbuddyText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as Record<string, unknown>;
    if ((item.type === "input_text" || item.type === "output_text") && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("\n").trim();
}

function looksLikeWorkbuddyNoise(text: string): boolean {
  return text.includes("<system-reminder") || text.includes("<user_info>");
}
