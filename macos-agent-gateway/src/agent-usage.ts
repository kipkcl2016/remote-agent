import { constants, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentKind,
  AgentUsage,
  AgentUsageProvider,
  AgentUsageWindow,
} from "./types.js";
import { GATEWAY_VERSION } from "./version.js";

const USAGE_CACHE_MS = 60_000;
const STATUS_TIMEOUT_MS = 4_000;
const CODEX_TIMEOUT_MS = 12_000;
const CURSOR_USAGE_TIMEOUT_MS = 8_000;
const MAX_PROBE_OUTPUT_BYTES = 262_144;
const CURSOR_USAGE_URL =
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

type UsageProbe = (updatedAt: string) => Promise<AgentUsage>;

type AgentUsageServiceOptions = {
  now?: () => Date;
  probes?: Partial<Record<AgentKind, UsageProbe>>;
  cursorAuthDb?: string;
};

export class AgentUsageService implements AgentUsageProvider {
  readonly #now: () => Date;
  readonly #probes: Record<AgentKind, UsageProbe>;
  #cached: { expiresAt: number; usages: AgentUsage[] } | null = null;
  #pending: Promise<AgentUsage[]> | null = null;

  constructor(options: AgentUsageServiceOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    const cursorAuthDb = options.cursorAuthDb;
    this.#probes = {
      cursor: options.probes?.cursor ?? ((updatedAt) => probeCursorUsage(updatedAt, cursorAuthDb)),
      claude: options.probes?.claude ?? probeClaudeUsage,
      codex: options.probes?.codex ?? probeCodexUsage,
    };
  }

  async list(): Promise<AgentUsage[]> {
    const now = this.#now();
    if (this.#cached && this.#cached.expiresAt > now.getTime()) {
      return cloneUsages(this.#cached.usages);
    }
    if (this.#pending) return cloneUsages(await this.#pending);

    const updatedAt = now.toISOString();
    this.#pending = Promise.all(([
      "cursor",
      "claude",
      "codex",
    ] as AgentKind[]).map(async (agent) => {
      try {
        return await this.#probes[agent](updatedAt);
      } catch {
        return unavailableUsage(agent, unavailableMessage(agent), updatedAt);
      }
    }));

    try {
      const usages = await this.#pending;
      this.#cached = { expiresAt: now.getTime() + USAGE_CACHE_MS, usages };
      return cloneUsages(usages);
    } finally {
      this.#pending = null;
    }
  }
}

export async function probeCursorUsage(
  updatedAt: string,
  cursorAuthDb?: string,
): Promise<AgentUsage> {
  const token = readCursorAccessToken(cursorAuthDb);
  if (!token) {
    return unavailableUsage(
      "cursor",
      "无法获取额度信息 · Cursor 未登录或本机无可用凭证",
      updatedAt,
    );
  }

  try {
    const payload = await fetchCursorPeriodUsage(token);
    const windows = parseCursorPeriodUsageWindows(payload);
    if (!windows.length) {
      return unavailableUsage(
        "cursor",
        "无法获取额度信息 · Cursor 当前套餐未返回可用额度窗口",
        updatedAt,
      );
    }
    return { agent: "cursor", state: "available", windows, updatedAt };
  } catch {
    return unavailableUsage(
      "cursor",
      "无法获取额度信息 · Cursor 额度接口暂不可用",
      updatedAt,
    );
  }
}

export function parseCursorPeriodUsageWindows(value: unknown): AgentUsageWindow[] {
  if (!isRecord(value)) return [];
  const planUsage = isRecord(value.planUsage) ? value.planUsage : null;
  if (!planUsage) return [];

  const remaining = asFiniteNumber(planUsage.remaining);
  const limit = asFiniteNumber(planUsage.limit);
  let remainingPercent: number | undefined;
  if (remaining !== undefined && limit !== undefined && limit > 0) {
    remainingPercent = clampPercent((remaining / limit) * 100);
  } else {
    const used = asFiniteNumber(planUsage.totalPercentUsed)
      ?? asFiniteNumber(planUsage.autoPercentUsed);
    if (used !== undefined) remainingPercent = clampPercent(100 - used);
  }
  if (remainingPercent === undefined) return [];

  const resetsAt = readEpochMsDate(value.billingCycleEnd);
  return [{
    label: "本月",
    remainingPercent,
    ...(resetsAt ? { resetsAt } : {}),
  }];
}

async function probeClaudeUsage(updatedAt: string): Promise<AgentUsage> {
  try {
    const result = await runFixedCommand(
      "claude",
      ["auth", "status", "--json"],
      STATUS_TIMEOUT_MS,
      { allowNonZeroExit: true },
    );
    const parsed = JSON.parse(result) as unknown;
    if (isClaudeApiMode(parsed)) {
      return unavailableUsage(
        "claude",
        "无法获取额度信息 · API模式",
        updatedAt,
      );
    }
  } catch {
    return unavailableUsage(
      "claude",
      "无法获取额度信息 · Claude CLI 状态不可用",
      updatedAt,
    );
  }
  return unavailableUsage(
    "claude",
    "无法获取额度信息 · Claude CLI 暂无安全读取接口",
    updatedAt,
  );
}

function isClaudeApiMode(status: unknown): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim()) {
    return true;
  }
  if (!isRecord(status)) return false;
  const authMethod = typeof status.authMethod === "string" ? status.authMethod.toLocaleLowerCase() : "";
  const apiProvider = typeof status.apiProvider === "string" ? status.apiProvider : "";
  if (authMethod.includes("api")) return true;
  if (apiProvider && apiProvider !== "firstParty") return true;
  // No Claude subscription session ⇒ usage is billed as API, not a package quota window.
  if (status.loggedIn === false || authMethod === "none" || authMethod === "") return true;
  return false;
}

async function probeCodexUsage(updatedAt: string): Promise<AgentUsage> {
  if (isCodexApiMode()) {
    return unavailableUsage(
      "codex",
      "无法获取额度信息 · API模式",
      updatedAt,
    );
  }
  const result = await readCodexRateLimits();
  const windows = parseCodexRateLimitWindows(result);
  if (!windows.length) {
    return unavailableUsage(
      "codex",
      "无法获取额度信息 · Codex 额度服务暂不可用",
      updatedAt,
    );
  }
  return { agent: "codex", state: "available", windows, updatedAt };
}

export function isCodexApiModeFromAuth(auth: unknown): boolean {
  if (!isRecord(auth)) return false;
  const mode = typeof auth.auth_mode === "string" ? auth.auth_mode.toLocaleLowerCase() : "";
  if (mode === "chatgpt" || mode === "chat_gpt") return false;
  if (mode.includes("api")) return true;
  const hasApiKey = typeof auth.OPENAI_API_KEY === "string" && Boolean(auth.OPENAI_API_KEY.trim());
  const hasTokens = Boolean(auth.tokens);
  return hasApiKey && !hasTokens;
}

function isCodexApiMode(): boolean {
  if (process.env.OPENAI_API_KEY?.trim() || process.env.CODEX_API_KEY?.trim()) {
    return true;
  }
  return isCodexApiModeFromAuth(readCodexAuthFile());
}

function readCodexAuthFile(): unknown {
  const path = join(process.env.HOME ?? "", ".codex", "auth.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export function parseCodexRateLimitWindows(value: unknown): AgentUsageWindow[] {
  if (!isRecord(value)) return [];
  const byLimitId = isRecord(value.rateLimitsByLimitId) ? value.rateLimitsByLimitId : null;
  const snapshot = byLimitId && isRecord(byLimitId.codex)
    ? byLimitId.codex
    : isRecord(value.rateLimits)
      ? value.rateLimits
      : null;
  if (!snapshot) return [];

  return [
    parseRateLimitWindow(snapshot.primary, "短期额度"),
    parseRateLimitWindow(snapshot.secondary, "长期额度"),
  ].filter((window): window is AgentUsageWindow => Boolean(window));
}

function parseRateLimitWindow(value: unknown, fallbackLabel: string): AgentUsageWindow | null {
  if (!isRecord(value) || typeof value.usedPercent !== "number" || !Number.isFinite(value.usedPercent)) {
    return null;
  }
  const duration = typeof value.windowDurationMins === "number" && Number.isFinite(value.windowDurationMins)
    ? Math.max(0, Math.round(value.windowDurationMins))
    : null;
  const remainingPercent = Math.round(100 - Math.min(100, Math.max(0, value.usedPercent)));
  const resetsAtSeconds = typeof value.resetsAt === "number" && Number.isFinite(value.resetsAt)
    ? value.resetsAt
    : null;
  const resetsAt = resetsAtSeconds && resetsAtSeconds > 0
    ? new Date(resetsAtSeconds * 1_000).toISOString()
    : undefined;
  return {
    label: usageWindowLabel(duration, fallbackLabel),
    remainingPercent,
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function usageWindowLabel(duration: number | null, fallback: string): string {
  if (duration === 300) return "5 小时";
  if (duration === 10_080) return "每周";
  if (duration === 1_440) return "24 小时";
  if (duration && duration % 1_440 === 0) return `${duration / 1_440} 天`;
  if (duration && duration % 60 === 0) return `${duration / 60} 小时`;
  return fallback;
}

function readCursorAccessToken(dbPath?: string): string | undefined {
  if (!dbPath) return undefined;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(dbPath, { readOnly: true });
    const row = database
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get("cursorAuth/accessToken") as { value?: unknown } | undefined;
    const token = typeof row?.value === "string" ? row.value.trim() : "";
    return token.startsWith("eyJ") ? token : undefined;
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

async function fetchCursorPeriodUsage(token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CURSOR_USAGE_TIMEOUT_MS);
  try {
    const response = await fetch(CURSOR_USAGE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`cursor usage http ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readCodexRateLimits(): Promise<unknown> {
  const executable = await findExecutable("codex");
  if (!executable) throw new Error("codex unavailable");

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["app-server", "--stdio"], {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let settled = false;
    let buffer = "";
    let totalBytes = 0;

    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(result);
    };
    const send = (message: Record<string, unknown>) => {
      if (!settled && child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
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
        send({ method: "account/rateLimits/read", id: 2 });
      } else if (message.id === 2) {
        if (message.error) finish(new Error("codex rate limits unavailable"));
        else finish(undefined, message.result);
      }
    };

    const timer = setTimeout(() => finish(new Error("codex rate limits timed out")), CODEX_TIMEOUT_MS);
    timer.unref();
    child.once("spawn", () => {
      send({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: {
            name: "remote_agent_gateway",
            title: "Remote Agent Gateway",
            version: GATEWAY_VERSION,
          },
          capabilities: {},
        },
      });
    });
    child.once("error", () => finish(new Error("codex failed to start")));
    child.once("close", () => finish(new Error("codex exited before returning rate limits")));
    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_PROBE_OUTPUT_BYTES) {
        finish(new Error("codex rate limit response was too large"));
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

async function runFixedCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  options: { allowNonZeroExit?: boolean } = {},
): Promise<string> {
  const executable = await findExecutable(command);
  if (!executable) throw new Error(`${command} unavailable`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGTERM");
      finish(new Error(`${command} status timed out`));
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length >= MAX_PROBE_OUTPUT_BYTES) return;
      output += chunk.toString("utf8").slice(0, MAX_PROBE_OUTPUT_BYTES - output.length);
    });
    child.once("error", () => finish(new Error(`${command} failed to start`)));
    child.once("close", (code) => {
      if (code === 0 || (options.allowNonZeroExit && output.trim())) finish();
      else finish(new Error(`${command} status unavailable`));
    });
  });
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

function unavailableUsage(agent: AgentKind, message: string, updatedAt: string): AgentUsage {
  return { agent, state: "unavailable", windows: [], message, updatedAt };
}

function unavailableMessage(agent: AgentKind): string {
  const label = agent === "cursor" ? "Cursor" : agent === "claude" ? "Claude" : "Codex";
  return `无法获取额度信息 · ${label} 探测失败`;
}

function cloneUsages(usages: AgentUsage[]): AgentUsage[] {
  return usages.map((usage) => ({
    ...usage,
    windows: usage.windows.map((window) => ({ ...window })),
  }));
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function readEpochMsDate(value: unknown): string | undefined {
  const raw = asFiniteNumber(value);
  if (raw === undefined || raw <= 0) return undefined;
  const ms = raw < 1_000_000_000_000 ? raw * 1_000 : raw;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
