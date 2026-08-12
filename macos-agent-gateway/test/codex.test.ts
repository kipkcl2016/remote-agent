import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexArgs } from "../src/adapters/codex.js";

test("[AGENT-002] builds a fixed read-only argv for a new Codex session", () => {
  assert.deepEqual(
    buildCodexArgs({
      prompt: "Inspect the project",
      cwd: "/allowed/projects",
      permissionMode: "ask",
    }),
    [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C",
      "/allowed/projects",
      "-s",
      "read-only",
      "Inspect the project",
    ],
  );
});

test("[SESSION-005][HISTORY-003] Codex resume allows an approved cwd that is not a Git repository", () => {
  assert.deepEqual(
    buildCodexArgs({
      prompt: "Continue the task",
      cwd: "/allowed/projects",
      permissionMode: "auto",
      nativeId: "11111111-1111-4111-8111-111111111111",
    }),
    [
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'sandbox_mode="workspace-write"',
      "11111111-1111-4111-8111-111111111111",
      "Continue the task",
    ],
  );
});
