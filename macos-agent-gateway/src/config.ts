import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";

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
    claude: string;
    codex: string;
    codexArchived: string;
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const port = parseInteger(env.REMOTE_AGENT_PORT, 17_821);
  const dataDir = resolve(env.REMOTE_AGENT_DATA_DIR ?? `${homedir()}/.remote-agent`);
  const roots = (env.REMOTE_AGENT_ROOTS ?? process.cwd())
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(item));
  const origins = (
    env.REMOTE_AGENT_ALLOWED_ORIGINS ??
    "http://localhost:4173,capacitor://localhost,https://localhost"
  )
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
    historyDirs: {
      cursor: resolve(env.REMOTE_AGENT_CURSOR_HISTORY_DIR ?? `${homedir()}/.cursor/acp-sessions`),
      cursorChats: resolve(
        env.REMOTE_AGENT_CURSOR_CHATS_HISTORY_DIR ?? `${homedir()}/.cursor/chats`,
      ),
      claude: resolve(env.REMOTE_AGENT_CLAUDE_HISTORY_DIR ?? `${homedir()}/.claude/projects`),
      codex: resolve(env.REMOTE_AGENT_CODEX_HISTORY_DIR ?? `${homedir()}/.codex/sessions`),
      codexArchived: resolve(
        env.REMOTE_AGENT_CODEX_ARCHIVED_HISTORY_DIR ?? `${homedir()}/.codex/archived_sessions`,
      ),
    },
  };
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
