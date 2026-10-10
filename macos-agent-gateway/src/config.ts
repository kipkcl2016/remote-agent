import { homedir } from "node:os";
import { resolve, win32 } from "node:path";
import { getDefaultHistoryDirs } from "./platform.js";

/** Comma-separated default for `REMOTE_AGENT_ALLOWED_ORIGINS` (Vite dev client on localhost and 127.0.0.1). */
export const DEFAULT_REMOTE_AGENT_ALLOWED_ORIGINS =
  "http://localhost:4173,http://127.0.0.1:4173,capacitor://localhost,https://localhost";

export type GatewayConfig = {
  host: string;
  port: number;
  dataDir: string;
  allowedRoots: string[];
  allowedOrigins: string[];
  pairingTtlMs: number;
  maxBodyBytes: number;
  historyDirs: {
    cursor: string;
    cursorChats: string;
    cursorComposerDb: string;
    cursorTranscripts: string;
    claude: string;
    codex: string;
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const port = parseInteger(env.REMOTE_AGENT_PORT, 17_821);
  const dataDir = resolve(env.REMOTE_AGENT_DATA_DIR ?? `${homedir()}/.remote-agent`);
  const roots = parseRemoteAgentRoots(env.REMOTE_AGENT_ROOTS ?? process.cwd());
  const origins = (env.REMOTE_AGENT_ALLOWED_ORIGINS ?? DEFAULT_REMOTE_AGENT_ALLOWED_ORIGINS)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    host: env.REMOTE_AGENT_HOST ?? "127.0.0.1",
    port,
    dataDir,
    allowedRoots: [...new Set(roots)],
    allowedOrigins: [...new Set(origins)],
    pairingTtlMs: parseInteger(env.REMOTE_AGENT_PAIRING_TTL_MS, 5 * 60_000),
    maxBodyBytes: parseInteger(env.REMOTE_AGENT_MAX_BODY_BYTES, 1_048_576),
    historyDirs: (() => {
      const defaults = getDefaultHistoryDirs();
      return {
        cursor: resolve(env.REMOTE_AGENT_CURSOR_HISTORY_DIR ?? defaults.cursor),
        cursorChats: resolve(env.REMOTE_AGENT_CURSOR_CHATS_HISTORY_DIR ?? defaults.cursorChats),
        cursorComposerDb: resolve(env.REMOTE_AGENT_CURSOR_COMPOSER_DB ?? defaults.cursorComposerDb),
        cursorTranscripts: resolve(env.REMOTE_AGENT_CURSOR_TRANSCRIPTS_DIR ?? defaults.cursorTranscripts),
        claude: resolve(env.REMOTE_AGENT_CLAUDE_HISTORY_DIR ?? defaults.claude),
        codex: resolve(env.REMOTE_AGENT_CODEX_HISTORY_DIR ?? defaults.codex),
      };
    })(),
  };
}

/**
 * Split `REMOTE_AGENT_ROOTS` into absolute roots.
 * - Windows: only `;` separates multiple roots (drive letters keep their `:`).
 * - POSIX: `:` or `;` may separate multiple roots.
 */
export function parseRemoteAgentRoots(
  raw: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const segments = platform === "win32"
    ? splitWindowsRemoteAgentRoots(raw)
    : splitPosixRemoteAgentRoots(raw);
  const resolveRoot = platform === "win32"
    ? (item: string) => win32.resolve(item)
    : (item: string) => resolve(item);
  return segments.map(resolveRoot);
}

function splitPosixRemoteAgentRoots(raw: string): string[] {
  return raw
    .split(/[:;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitWindowsRemoteAgentRoots(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (!trimmed.includes(";")) return [trimmed];
  return trimmed
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
