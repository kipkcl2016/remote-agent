import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProcessAgentAdapter } from "./process.js";
import type { AdapterLaunchRequest } from "../types.js";

const WORKBUDDY_CLI_CANDIDATES = [
  "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
  join(homedir(), "Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"),
];

export function resolveWorkbuddyCli(): string | undefined {
  for (const candidate of WORKBUDDY_CLI_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function buildWorkbuddyArgs(request: AdapterLaunchRequest): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (request.permissionMode === "full") {
    args.push("--permission-mode", "bypassPermissions", "-y");
  } else if (request.permissionMode === "auto") {
    args.push("--permission-mode", "acceptEdits");
  } else if (request.permissionMode === "ask") {
    args.push("--permission-mode", "default");
  } else {
    args.push("--permission-mode", "plan");
  }
  if (request.nativeId) args.push("--resume", request.nativeId);
  args.push(request.prompt);
  return args;
}

export function createWorkbuddyAdapter(): ProcessAgentAdapter {
  const cli = resolveWorkbuddyCli() ?? "codebuddy";
  return new ProcessAgentAdapter({
    kind: "workbuddy",
    label: "WorkBuddy",
    command: cli,
    supportsNativeHistory: true,
    permissionModes: ["plan", "ask", "auto", "full"],
    buildArgs: buildWorkbuddyArgs,
  });
}
