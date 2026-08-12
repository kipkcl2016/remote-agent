import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NativeHistoryService } from "../src/history.js";

test("native history shows disallowed directories as browse-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-history-"));
  const outside = mkdtempSync(join(tmpdir(), "remote-agent-outside-"));
  const dirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    codexArchived: join(root, "codex-archived"),
  };

  try {
    mkdirSync(join(root, ".git"));
    mkdirSync(join(dirs.cursor, "cursor-session"), { recursive: true });
    writeFileSync(
      join(dirs.cursor, "cursor-session", "meta.json"),
      JSON.stringify({ cwd: root, title: "Cursor task" }),
    );

    mkdirSync(join(dirs.cursorChats, "workspace", "cursor-chat"), { recursive: true });
    writeFileSync(
      join(dirs.cursorChats, "workspace", "cursor-chat", "meta.json"),
      JSON.stringify({
        cwd: root,
        createdAtMs: Date.parse("2026-08-04T01:00:00.000Z"),
        updatedAtMs: Date.parse("2026-08-04T01:05:00.000Z"),
      }),
    );

    mkdirSync(join(dirs.claude, "project"), { recursive: true });
    writeFileSync(
      join(dirs.claude, "project", "claude-session.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-08-04T02:00:00.000Z",
          cwd: root,
          sessionId: "claude-session",
          message: { role: "user", content: "Claude task" },
        }),
        "",
      ].join("\n"),
    );

    mkdirSync(join(dirs.codex, "2026", "08", "04"), { recursive: true });
    const codexPath = join(dirs.codex, "2026", "08", "04", "rollout-codex-session.jsonl");
    writeFileSync(
      codexPath,
      [
        JSON.stringify({
          timestamp: "2026-08-04T03:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-session", cwd: root },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: [
              '<in-app-browser-context source="ambient-ui-state">',
              "# In app browser:",
              "- Current URL: http://localhost:4173/",
              "</in-app-browser-context>",
              "",
              "## My request:",
              "Codex task",
            ].join("\n"),
          },
        }),
        "",
      ].join("\n"),
    );

    writeFileSync(
      join(dirs.codex, "2026", "08", "04", "rollout-hidden-session.jsonl"),
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "hidden-session", cwd: outside },
        }),
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Hidden" } }),
        "",
      ].join("\n"),
    );

    const service = new NativeHistoryService(dirs, [root]);
    const sessions = await service.list({ limit: 20 });
    assert.deepEqual(new Set(sessions.map((session) => session.agent)), new Set(["cursor", "claude", "codex"]));
    assert.equal(sessions.some((session) => session.id === "hidden-session"), true);
    assert.equal((await service.get("codex", "hidden-session"))?.resumable, false);
    assert.equal((await service.get("cursor", "cursor-session"))?.resumable, false);
    assert.equal((await service.get("cursor", "cursor-chat"))?.resumable, true);
    assert.equal((await service.get("cursor", "cursor-chat"))?.title, root.split("/").at(-1));
    assert.equal((await service.get("cursor", "cursor-chat"))?.createdAt, "2026-08-04T01:00:00.000Z");
    assert.equal((await service.get("cursor", "cursor-chat"))?.updatedAt, "2026-08-04T01:05:00.000Z");
    assert.equal((await service.get("claude", "claude-session"))?.title, "Claude task");
    assert.equal((await service.get("codex", "codex-session"))?.title, "Codex task");
    assert.equal((await service.get("codex", "codex-session"))?.status, "running");
    assert.equal(new Set(sessions.map((session) => session.projectId)).size, 2);
    assert.equal((await service.get("codex", "codex-session"))?.projectName, root.split("/").at(-1));
    assert.equal((await service.get("codex", "hidden-session"))?.projectName, outside.split("/").at(-1));
    assert.deepEqual((await service.messages("claude", "claude-session"))?.map((message) => message.text), [
      "Claude task",
    ]);
    assert.deepEqual((await service.messages("codex", "codex-session"))?.map((message) => message.text), [
      "Codex task",
    ]);
    appendFileSync(codexPath, [
      JSON.stringify({
        timestamp: "2026-08-04T03:00:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "Incremental answer" },
      }),
      "",
    ].join("\n"));
    assert.deepEqual((await service.snapshot("codex", "codex-session"))?.messages.map(
      (message) => message.text,
    ), ["Codex task", "Incremental answer"]);
    appendFileSync(codexPath, [
      JSON.stringify({
        timestamp: "2026-08-04T03:00:03.000Z",
        type: "event_msg",
        payload: { type: "task_complete" },
      }),
      "",
    ].join("\n"));
    assert.equal((await service.snapshot("codex", "codex-session"))?.session.status, "completed");
    assert.deepEqual(await service.messages("cursor", "cursor-session"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("native history caps each Agent project independently", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-history-projects-"));
  const firstProject = join(root, "first");
  const secondProject = join(root, "second");
  mkdirSync(firstProject);
  mkdirSync(secondProject);
  const dirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    codexArchived: join(root, "codex-archived"),
  };
  const codexThreads = {
    list: async () => [firstProject, secondProject].flatMap((cwd, projectIndex) => (
      Array.from({ length: 25 }, (_, index) => ({
        id: `codex-${projectIndex}-${index}`,
        agent: "codex" as const,
        title: `Desktop title ${projectIndex}-${index}`,
        cwd,
        updatedAt: new Date(Date.UTC(2026, 7, 11, projectIndex, index)).toISOString(),
        resumable: true,
        source: "native" as const,
      }))
    )),
  };

  try {
    const service = new NativeHistoryService(dirs, [root], codexThreads);
    const sessions = await service.list({
      agent: "codex",
      limit: 2_000,
      perProjectLimit: 20,
    });
    assert.equal(sessions.length, 40);
    assert.equal(sessions.filter((session) => session.projectName === "first").length, 20);
    assert.equal(sessions.filter((session) => session.projectName === "second").length, 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
