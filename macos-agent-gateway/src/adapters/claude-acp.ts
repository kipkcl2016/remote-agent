import type {
  AdapterEvent,
  AdapterLaunchRequest,
  AgentAdapter,
  AgentAvailability,
  RunningAgent,
} from "../types.js";
import { createClaudeAdapter } from "./claude.js";
import { launchAcpTurn, type AcpLaunchCommand } from "./acp/run-acp-turn.js";

export type ClaudeAcpOptions = {
  /** When false, always use the short-process CLI adapter. */
  enabled?: boolean;
  /** Override the ACP agent launch command (tests inject a mock). */
  launchCommand?: AcpLaunchCommand;
  /** Fallback to CLI when ACP spawn/initialize fails. Default true. */
  fallbackToCli?: boolean;
};

/**
 * Claude adapter that prefers ACP (`claude-agent-acp`) so tool permissions can
 * pause for a phone resolve. Falls back to the existing short-process CLI.
 */
export function createClaudeAcpAdapter(options: ClaudeAcpOptions = {}): AgentAdapter {
  const cli = createClaudeAdapter();
  const enabled = options.enabled ?? isClaudeAcpEnabled();
  const fallbackToCli = options.fallbackToCli ?? true;
  const launchCommand = options.launchCommand ?? defaultClaudeAcpLaunch();

  if (!enabled) return cli;

  return {
    kind: "claude",
    label: "Claude Code",
    command: launchCommand.command,
    supportsNativeHistory: true,
    async detect(): Promise<AgentAvailability> {
      const base = await cli.detect();
      return {
        ...base,
        label: "Claude Code (ACP)",
        command: `${launchCommand.command} ${launchCommand.args.join(" ")}`.trim(),
      };
    },
    async launch(
      request: AdapterLaunchRequest,
      emit: (event: AdapterEvent) => void,
    ): Promise<RunningAgent> {
      try {
        return await launchAcpTurn(
          {
            prompt: request.prompt,
            cwd: request.cwd,
            permissionMode: request.permissionMode,
            ...(request.nativeId ? { nativeId: request.nativeId } : {}),
            launch: launchCommand,
            clientName: "remote-agent-gateway",
          },
          emit,
        );
      } catch (error) {
        if (!fallbackToCli) throw error;
        emit({
          type: "output",
          payload: {
            stream: "stderr",
            text: `ACP launch failed; falling back to Claude CLI: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        });
        return cli.launch(request, emit);
      }
    },
  };
}

export function isClaudeAcpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.REMOTE_AGENT_CLAUDE_TRANSPORT ?? "acp").trim().toLowerCase();
  return raw === "acp" || raw === "1" || raw === "true";
}

export function defaultClaudeAcpLaunch(
  env: NodeJS.ProcessEnv = process.env,
): AcpLaunchCommand {
  const override = env.REMOTE_AGENT_CLAUDE_ACP_COMMAND?.trim();
  if (override) {
    const parts = override.split(/\s+/).filter(Boolean);
    return { command: parts[0] ?? "npx", args: parts.slice(1) };
  }
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp@0.89.1"],
  };
}
