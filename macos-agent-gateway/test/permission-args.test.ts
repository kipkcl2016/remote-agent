import assert from "node:assert/strict";
import test from "node:test";
import { buildClaudeArgs } from "../src/adapters/claude.js";
import { buildCodexArgs } from "../src/adapters/codex.js";
import { buildCursorArgs } from "../src/adapters/cursor.js";

test("[PERMISSION-001] Cursor maps ask/auto/full to plan/auto-review/force", () => {
  assert.deepEqual(
    buildCursorArgs({
      prompt: "Inspect",
      cwd: "/allowed/projects",
      permissionMode: "ask",
    }),
    [
      "-p",
      "--output-format",
      "stream-json",
      "--workspace",
      "/allowed/projects",
      "--trust",
      "--plan",
      "Inspect",
    ],
  );
  assert.ok(
    buildCursorArgs({
      prompt: "Write",
      cwd: "/allowed/projects",
      permissionMode: "auto",
    }).includes("--auto-review"),
  );
  assert.ok(
    buildCursorArgs({
      prompt: "Run everything",
      cwd: "/allowed/projects",
      permissionMode: "full",
    }).includes("--force"),
  );
});

test("[PERMISSION-001] Claude maps auto/full to acceptEdits/bypassPermissions", () => {
  assert.deepEqual(
    buildClaudeArgs({
      prompt: "Write",
      cwd: "/allowed/projects",
      permissionMode: "auto",
    }),
    [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-chrome",
      "--permission-mode",
      "acceptEdits",
      "Write",
    ],
  );
  assert.deepEqual(
    buildClaudeArgs({
      prompt: "Bypass",
      cwd: "/allowed/projects",
      permissionMode: "full",
    }),
    [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-chrome",
      "--permission-mode",
      "bypassPermissions",
      "--allow-dangerously-skip-permissions",
      "Bypass",
    ],
  );
});

test("[PERMISSION-001] Codex maps full to danger-full-access", () => {
  assert.deepEqual(
    buildCodexArgs({
      prompt: "Full access",
      cwd: "/allowed/projects",
      permissionMode: "full",
    }),
    [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C",
      "/allowed/projects",
      "-s",
      "danger-full-access",
      "Full access",
    ],
  );
});
