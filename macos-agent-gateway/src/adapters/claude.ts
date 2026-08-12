import { ProcessAgentAdapter } from "./process.js";

export function createClaudeAdapter(): ProcessAgentAdapter {
  return new ProcessAgentAdapter({
    kind: "claude",
    label: "Claude Code",
    command: "claude",
    supportsNativeHistory: true,
    permissionModes: ["plan", "ask", "auto"],
    buildArgs: (request) => {
      const permissionMode = request.permissionMode === "auto" ? "acceptEdits" : "plan";
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        permissionMode,
        "--no-chrome",
      ];
      if (request.nativeId) args.push("--resume", request.nativeId);
      args.push(request.prompt);
      return args;
    },
  });
}
