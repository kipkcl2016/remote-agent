import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { AgentKind } from "./types.js";
import { getDefaultHistoryDirs } from "./platform.js";

export type NativeDesktopArchiveResult = {
  agent: AgentKind;
  ok: boolean;
  detail?: string;
};

/** Archive or unarchive the session in the desktop Agent (Codex / Cursor). Claude has no desktop archive API. */
export async function applyNativeDesktopArchive(
  agent: AgentKind,
  sessionId: string,
  action: "archive" | "unarchive",
): Promise<NativeDesktopArchiveResult> {
  if (agent === "codex") {
    return archiveCodexThread(sessionId, action);
  }
  if (agent === "cursor") {
    return archiveCursorComposer(sessionId, action === "archive");
  }
  return { agent, ok: true, detail: `${agent} has no desktop archive API; remote soft-hide only` };
}

async function archiveCodexThread(
  sessionId: string,
  action: "archive" | "unarchive",
): Promise<NativeDesktopArchiveResult> {
  clearStaleCodexWriterLock(sessionId);
  const method = action === "archive" ? "thread/archive" : "thread/unarchive";
  try {
    await callCodexAppServer(method, { threadId: sessionId });
    return { agent: "codex", ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Already archived / missing rollout: desktop sidebar will not show it.
    if (
      action === "archive" &&
      (/no rollout/i.test(detail) || /not found/i.test(detail) || /already archiv/i.test(detail))
    ) {
      return { agent: "codex", ok: true, detail };
    }
    if (action === "unarchive" && /no rollout/i.test(detail)) {
      return { agent: "codex", ok: true, detail };
    }
    return { agent: "codex", ok: false, detail };
  }
}

function clearStaleCodexWriterLock(sessionId: string): void {
  const lockPath = join(homedir(), ".codex", "thread-writer-locks", `${sessionId}.lock`);
  if (!existsSync(lockPath)) return;
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    if (Number.isFinite(pid) && pid > 1) {
      try {
        process.kill(pid, 0);
        return; // process still alive
      } catch {
        // ESRCH — stale
      }
    }
    unlinkSync(lockPath);
  } catch {
    // ignore lock cleanup failures
  }
}

function callCodexAppServer(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server", "--stdio"], {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "ignore"],
      shell: false,
    });
    let buffer = "";
    let settled = false;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      if (error) reject(error);
      else resolve(result);
    };
    const send = (message: Record<string, unknown>) => {
      if (!settled && child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line.trim()) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (!message || typeof message !== "object") continue;
        const record = message as Record<string, unknown>;
        if (record.id === 1) {
          if (record.error) {
            finish(new Error("codex initialization failed"));
            return;
          }
          send({ method: "initialized", params: {} });
          send({ method, id: 2, params });
          return;
        }
        if (record.id === 2) {
          if (record.error && typeof record.error === "object") {
            const err = record.error as { message?: string };
            finish(new Error(err.message ?? "codex archive failed"));
          } else {
            finish(undefined, record.result);
          }
        }
      }
    });
    child.once("error", (error) => finish(error));
    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "remote-agent-gateway", version: "0.6.0" },
        capabilities: {},
      },
    });
    const timer = setTimeout(() => finish(new Error("codex archive timed out")), 12_000);
    timer.unref();
  });
}

function archiveCursorComposer(composerId: string, archived: boolean): NativeDesktopArchiveResult {
  const dbPath = getDefaultHistoryDirs().cursorComposerDb;
  if (!dbPath || !existsSync(dbPath)) {
    return { agent: "cursor", ok: false, detail: "Cursor state.vscdb not found" };
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(dbPath);
    const flag = archived ? 1 : 0;
    const row = database
      .prepare(`SELECT value FROM composerHeaders WHERE composerId = ? LIMIT 1`)
      .get(composerId) as { value?: string } | undefined;
    if (!row) {
      return { agent: "cursor", ok: false, detail: "composer not found in Cursor DB" };
    }
    let value = row.value ?? "{}";
    try {
      const header = JSON.parse(value) as Record<string, unknown>;
      header.isArchived = archived;
      value = JSON.stringify(header);
    } catch {
      // keep raw value
    }
    database
      .prepare(
        `UPDATE composerHeaders SET isArchived = ?, value = ? WHERE composerId = ?`,
      )
      .run(flag, value, composerId);
    return { agent: "cursor", ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { agent: "cursor", ok: false, detail };
  } finally {
    database?.close();
  }
}
