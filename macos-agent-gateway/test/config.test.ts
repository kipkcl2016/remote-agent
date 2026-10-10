import assert from "node:assert/strict";
import { win32 } from "node:path";
import test from "node:test";
import { loadConfig, parseRemoteAgentRoots } from "../src/config.js";

test("parseRemoteAgentRoots splits colon- and semicolon-separated paths on POSIX", () => {
  const roots = parseRemoteAgentRoots(
    "/Users/me/projects:/Users/me/.codex/worktrees",
    "linux",
  );
  assert.equal(roots.length, 2);
  assert.match(roots[0], /\/Users\/me\/projects$/);
  assert.match(roots[1], /\/\.codex\/worktrees$/);

  const semicolonSeparated = parseRemoteAgentRoots(
    "/Users/me/projects;/Users/me/.codex/worktrees",
    "darwin",
  );
  assert.equal(semicolonSeparated.length, 2);
});

test("parseRemoteAgentRoots does not split Windows drive-letter colons", () => {
  const single = parseRemoteAgentRoots("C:\\Users\\me\\projects", "win32");
  assert.equal(single.length, 1);
  assert.equal(single[0], "C:\\Users\\me\\projects");

  const multiple = parseRemoteAgentRoots(
    "C:\\Users\\me\\projects;D:\\codex\\worktrees",
    "win32",
  );
  assert.equal(multiple.length, 2);
  assert.equal(multiple[0], "C:\\Users\\me\\projects");
  assert.equal(multiple[1], "D:\\codex\\worktrees");
});

test("loadConfig deduplicates REMOTE_AGENT_ROOTS entries", () => {
  if (process.platform === "win32") {
    const config = loadConfig({
      REMOTE_AGENT_ROOTS: "C:\\tmp\\a;C:\\tmp\\a;C:\\tmp\\b",
    });
    assert.deepEqual(config.allowedRoots, [
      win32.resolve("C:\\tmp\\a"),
      win32.resolve("C:\\tmp\\b"),
    ]);
    return;
  }
  const config = loadConfig({
    REMOTE_AGENT_ROOTS: "/tmp/a:/tmp/a;/tmp/b",
  });
  assert.deepEqual(config.allowedRoots, ["/tmp/a", "/tmp/b"]);
});
