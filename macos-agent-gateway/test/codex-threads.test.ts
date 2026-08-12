import assert from "node:assert/strict";
import test from "node:test";
import { CodexThreadCatalog, parseCodexThreadPage } from "../src/codex-threads.js";
import type { NativeHistorySession } from "../src/types.js";

test("Codex thread pages prefer the desktop name over the raw prompt preview", () => {
  assert.deepEqual(parseCodexThreadPage({
    data: [{
      id: "019feec5-28ca-7480-87d8-9fb74ff744b8",
      name: "设计模型推理评测考题",
      preview: "针对这个项目，设计一组考题，用来评测不同模型下的表现",
      cwd: "/Users/test/projects/example-project",
      createdAt: 1_786_421_726,
      updatedAt: 1_786_422_134,
    }],
    nextCursor: "next-page",
  }, false), {
    sessions: [{
      id: "019feec5-28ca-7480-87d8-9fb74ff744b8",
      agent: "codex",
      title: "设计模型推理评测考题",
      cwd: "/Users/test/projects/example-project",
      createdAt: "2026-08-11T04:15:26.000Z",
      updatedAt: "2026-08-11T04:22:14.000Z",
      status: "completed",
      resumable: true,
      source: "native",
    }],
    nextCursor: "next-page",
  });
});

test("Codex thread pages map app-server runtime status", () => {
  const result = parseCodexThreadPage({
    data: [
      {
        id: "active-thread",
        cwd: "/Users/test/projects/active",
        updatedAt: 1_786_422_134,
        status: { type: "active", activeFlags: [] },
      },
      {
        id: "failed-thread",
        cwd: "/Users/test/projects/failed",
        updatedAt: 1_786_422_133,
        status: { type: "systemError" },
      },
    ],
  }, false);

  assert.deepEqual(result.sessions.map((session) => session.status), ["running", "failed"]);
});

test("Codex thread catalog caches the app-server result for 15 seconds", async () => {
  let nowMs = Date.parse("2026-08-11T04:00:00.000Z");
  let calls = 0;
  const sessions: NativeHistorySession[] = [{
    id: "codex-session",
    agent: "codex",
    title: "Desktop title",
    cwd: "/Users/test/project",
    updatedAt: "2026-08-11T04:00:00.000Z",
    resumable: true,
    source: "native",
  }];
  const catalog = new CodexThreadCatalog({
    now: () => new Date(nowMs),
    probe: async () => {
      calls += 1;
      return sessions;
    },
  });

  assert.deepEqual(await catalog.list(), sessions);
  assert.deepEqual(await catalog.list(), sessions);
  assert.equal(calls, 1);
  nowMs += 15_001;
  await catalog.list();
  assert.equal(calls, 2);
});
