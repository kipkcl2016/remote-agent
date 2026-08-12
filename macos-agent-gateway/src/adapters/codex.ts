import { ProcessAgentAdapter } from "./process.js";
import type { AdapterLaunchRequest } from "../types.js";

export function buildCodexArgs(request: AdapterLaunchRequest): string[] {
  const sandbox = request.permissionMode === "auto" ? "workspace-write" : "read-only";
  if (request.nativeId) {
    return [
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "-c",
      `sandbox_mode=${JSON.stringify(sandbox)}`,
      request.nativeId,
      request.prompt,
    ];
  }
  return [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C",
    request.cwd,
    "-s",
    sandbox,
    request.prompt,
  ];
}

export function createCodexAdapter(): ProcessAgentAdapter {
  return new ProcessAgentAdapter({
    kind: "codex",
    label: "Codex",
    command: "codex",
    supportsNativeHistory: true,
    permissionModes: ["plan", "ask", "auto"],
    buildArgs: buildCodexArgs,
  });
}
