import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, parseRemoteAgentRoots } from "../src/config.js";

test("parseRemoteAgentRoots splits colon- and semicolon-separated paths", () => {
  const roots = parseRemoteAgentRoots("/Users/me/projects:/Users/me/.codex/worktrees");
  assert.equal(roots.length, 2);
  assert.match(roots[0], /\/Users\/me\/projects$/);
  assert.match(roots[1], /\/\.codex\/worktrees$/);

  const semicolonSeparated = parseRemoteAgentRoots("/Users/me/projects;/Users/me/.codex/worktrees");
  assert.equal(semicolonSeparated.length, 2);
});

test("loadConfig deduplicates REMOTE_AGENT_ROOTS entries", () => {
  const config = loadConfig({
    REMOTE_AGENT_ROOTS: "/tmp/a:/tmp/a;/tmp/b",
  });
  assert.deepEqual(config.allowedRoots, ["/tmp/a", "/tmp/b"]);
});
