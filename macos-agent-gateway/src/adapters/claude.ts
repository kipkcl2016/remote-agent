import { ProcessAgentAdapter } from "./process.js";
import type { AdapterLaunchRequest } from "../types.js";

export function buildClaudeArgs(request: AdapterLaunchRequest): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-chrome",
  ];
  if (request.permissionMode === "full") {
    args.push("--permission-mode", "bypassPermissions", "--allow-dangerously-skip-permissions");
  } else {
    args.push(
      "--permission-mode",
      request.permissionMode === "auto" ? "acceptEdits" : "plan",
    );
  }
  if (request.nativeId) args.push("--resume", request.nativeId);
  args.push(request.prompt);
  return args;
}

export function createClaudeAdapter(): ProcessAgentAdapter {
  return new ProcessAgentAdapter({
    kind: "claude",
    label: "Claude Code",
    command: "claude",
    supportsNativeHistory: true,
    permissionModes: ["plan", "ask", "auto", "full"],
    buildArgs: buildClaudeArgs,
  });
}
