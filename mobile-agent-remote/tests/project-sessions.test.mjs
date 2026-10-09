import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProjectDisambiguation,
  disambiguateProjectNames,
} from "../src/project-sessions.ts";

test("duplicate real project names keep the folder title and move path context to a hint", () => {
  const sessions = disambiguateProjectNames([
    {
      projectId: "project-a",
      project: "remote-agent",
      cwd: "/Users/test/ws-a/workspace/remote-agent",
    },
    {
      projectId: "project-b",
      project: "remote-agent",
      cwd: "/Users/test/ws-b/workspace/remote-agent",
    },
  ]);

  assert.equal(sessions[0]?.project, "remote-agent");
  assert.equal(sessions[1]?.project, "remote-agent");
  assert.notEqual(sessions[0]?.projectHint, sessions[1]?.projectHint);
  assert.match(sessions[0]?.project ?? "", /^remote-agent$/);
  assert.doesNotMatch(sessions[0]?.project ?? "", /^workspace · /);
});

test("benchmark workspace folders still use the full disambiguation label as the project title", () => {
  const sessions = disambiguateProjectNames([
    {
      projectId: "benchmark-a",
      project: "workspace",
      cwd: "/Users/test/Projects/current-vs-luna-benchmark/runs/task-1/claude/workspace",
    },
    {
      projectId: "benchmark-b",
      project: "workspace",
      cwd: "/Users/test/Projects/current-vs-luna-benchmark/runs/task-2/claude/workspace",
    },
  ]);

  assert.equal(sessions[0]?.project, "claude · task-1 · current-vs-luna");
  assert.equal(sessions[1]?.project, "claude · task-2 · current-vs-luna");
  assert.equal(sessions[0]?.projectHint, undefined);
});

test("applyProjectDisambiguation splits workspace prefixes from the canonical folder name", () => {
  assert.deepEqual(
    applyProjectDisambiguation("remote-agent", "workspace · remote-agent"),
    { project: "remote-agent", projectHint: "workspace" },
  );
});
