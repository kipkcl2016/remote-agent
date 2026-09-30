import { ProcessAgentAdapter } from "./process.js";
import type { AdapterLaunchRequest } from "../types.js";

export function buildCursorArgs(request: AdapterLaunchRequest): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--workspace",
    request.cwd,
    "--trust",
  ];
  if (request.nativeId) args.push("--resume", request.nativeId);
  if (request.permissionMode === "full") args.push("--force");
  else if (request.permissionMode === "auto") args.push("--auto-review");
  else args.push("--plan");
  args.push(request.prompt);
  return args;
}

export function createCursorAdapter(): ProcessAgentAdapter {
  return new ProcessAgentAdapter({
    kind: "cursor",
    label: "Cursor Agent",
    command: "cursor-agent",
    supportsNativeHistory: true,
    permissionModes: ["plan", "ask", "auto", "full"],
    buildArgs: buildCursorArgs,
  });
}
