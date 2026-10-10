import { homedir } from "node:os";
import { resolve } from "node:path";
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

/** Split `REMOTE_AGENT_ROOTS` on `:` or `;` so LaunchAgent / shell can list multiple explicit roots. */
export function parseRemoteAgentRoots(raw: string): string[] {
  return raw
    .split(/[:;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(item));
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
