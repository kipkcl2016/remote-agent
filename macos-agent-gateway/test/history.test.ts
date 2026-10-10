import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { NativeHistoryService } from "../src/history.js";

test("native history shows disallowed directories as browse-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-history-"));
  const outside = mkdtempSync(join(tmpdir(), "remote-agent-outside-"));
  const dirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    cursorComposerDb: join(root, "missing-state.vscdb"),
    cursorTranscripts: join(root, "cursor-transcripts"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    workbuddyDb: join(root, "workbuddy.db"),
    workbuddyProjects: join(root, "workbuddy-projects"),
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
    assert.equal((await service.get("cursor", "cursor-chat"))?.title, basename(root));
    assert.equal((await service.get("cursor", "cursor-chat"))?.createdAt, "2026-08-04T01:00:00.000Z");
    assert.equal((await service.get("cursor", "cursor-chat"))?.updatedAt, "2026-08-04T01:05:00.000Z");
    assert.equal((await service.get("claude", "claude-session"))?.title, "Claude task");
    assert.equal((await service.get("codex", "codex-session"))?.title, "Codex task");
    assert.equal((await service.get("codex", "codex-session"))?.status, "running");
    assert.equal(new Set(sessions.map((session) => session.projectId)).size, 2);
    assert.equal((await service.get("codex", "codex-session"))?.projectName, basename(root));
    assert.equal((await service.get("codex", "hidden-session"))?.projectName, basename(outside));
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

    const transcriptId = "11111111-1111-4111-8111-111111111111";
    mkdirSync(
      join(dirs.cursorTranscripts, "proj", "agent-transcripts", transcriptId),
      { recursive: true },
    );
    writeFileSync(
      join(dirs.cursorTranscripts, "proj", "agent-transcripts", transcriptId, `${transcriptId}.jsonl`),
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{
              type: "text",
              text: "<timestamp>now</timestamp>\n<user_query>\nCursor transcript task\n</user_query>",
            }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [
              { type: "text", text: "Working on it." },
              { type: "tool_use", name: "Shell", input: { command: "ls" } },
            ],
          },
        }),
        JSON.stringify({ role: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
        JSON.stringify({ role: "turn_ended" }),
        "",
      ].join("\n"),
    );
    mkdirSync(join(dirs.cursorChats, "workspace", transcriptId), { recursive: true });
    writeFileSync(
      join(dirs.cursorChats, "workspace", transcriptId, "meta.json"),
      JSON.stringify({ cwd: root, title: "Cursor transcript task" }),
    );
    assert.deepEqual(
      (await service.messages("cursor", transcriptId))?.map((message) => ({
        role: message.role,
        text: message.text,
      })),
      [
        { role: "user", text: "Cursor transcript task" },
        { role: "assistant", text: "Working on it." },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("native history reads Codex response_item chat messages", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-history-codex-response-item-"));
  const dirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    cursorComposerDb: join(root, "missing-state.vscdb"),
    cursorTranscripts: join(root, "cursor-transcripts"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    workbuddyDb: join(root, "workbuddy.db"),
    workbuddyProjects: join(root, "workbuddy-projects"),
  };

  try {
    mkdirSync(join(dirs.codex, "2026", "10", "09"), { recursive: true });
    writeFileSync(
      join(
        dirs.codex,
        "2026",
        "10",
        "09",
        "rollout-01a120b6-2264-73f0-9d52-af38afc928ef.jsonl",
      ),
      [
        JSON.stringify({
          timestamp: "2026-10-09T12:00:00.000Z",
          type: "session_meta",
          payload: { id: "01a120b6-2264-73f0-9d52-af38afc928ef", cwd: root },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-10-09T12:00:01.000Z",
          payload: {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "# AGENTS.md\n\nFollow repository rules." }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-10-09T12:00:02.000Z",
          payload: {
            id: "user-turn-1",
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "staging发布时，使用的是test的哪个版本" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-10-09T12:00:03.000Z",
          payload: {
            id: "assistant-turn-1",
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "staging 使用的是 test 环境当前部署的版本。" },
              { type: "function_call", name: "shell", arguments: "{}" },
            ],
          },
        }),
        "",
      ].join("\n"),
    );

    const service = new NativeHistoryService(dirs, [root]);
    const sessionId = "01a120b6-2264-73f0-9d52-af38afc928ef";
    assert.equal((await service.get("codex", sessionId))?.title, "staging发布时，使用的是test的哪个版本");
    assert.deepEqual(
      (await service.messages("codex", sessionId))?.map((message) => ({
        role: message.role,
        text: message.text,
      })),
      [
        { role: "user", text: "staging发布时，使用的是test的哪个版本" },
        { role: "assistant", text: "staging 使用的是 test 环境当前部署的版本。" },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native history ignores Codex archived sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-history-archived-"));
  const archivedRoot = join(root, "codex-archived");
  const dirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    cursorComposerDb: join(root, "missing-state.vscdb"),
    cursorTranscripts: join(root, "cursor-transcripts"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    workbuddyDb: join(root, "workbuddy.db"),
    workbuddyProjects: join(root, "workbuddy-projects"),
  };

  try {
    mkdirSync(join(dirs.codex, "2026", "09", "30"), { recursive: true });
    writeFileSync(
      join(dirs.codex, "2026", "09", "30", "rollout-active-session.jsonl"),
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "active-session", cwd: root },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "Active Codex" },
        }),
        "",
      ].join("\n"),
    );

    mkdirSync(join(archivedRoot, "2026", "09", "30"), { recursive: true });
    writeFileSync(
      join(archivedRoot, "2026", "09", "30", "rollout-archived-session.jsonl"),
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "archived-session", cwd: root },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "Archived Codex" },
        }),
        "",
      ].join("\n"),
    );

    const service = new NativeHistoryService(dirs, [root]);
    const sessions = await service.list({ agent: "codex", limit: 50 });
    assert.equal(sessions.some((session) => session.id === "active-session"), true);
    assert.equal(sessions.some((session) => session.id === "archived-session"), false);
    assert.equal(sessions.every((session) => session.archived !== true), true);
    assert.equal(await service.get("codex", "archived-session"), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
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
    cursorComposerDb: join(root, "missing-state.vscdb"),
    cursorTranscripts: join(root, "cursor-transcripts"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
    workbuddyDb: join(root, "workbuddy.db"),
    workbuddyProjects: join(root, "workbuddy-projects"),
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
