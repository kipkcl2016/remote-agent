import { ProcessAgentAdapter } from "./process.js";

export function createCursorAdapter(): ProcessAgentAdapter {
  return new ProcessAgentAdapter({
    kind: "cursor",
    label: "Cursor Agent",
    command: "cursor-agent",
    supportsNativeHistory: true,
    permissionModes: ["plan", "ask", "auto"],
    buildArgs: (request) => {
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--workspace",
        request.cwd,
        "--trust",
      ];
      if (request.nativeId) args.push("--resume", request.nativeId);
      if (request.permissionMode === "auto") args.push("--auto-review");
      else args.push("--plan");
      args.push(request.prompt);
      return args;
    },
  });
}
