import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { NativeHistoryService } from "../src/history.js";

test("Cursor history prefers IDE composerHeaders titles and skips archived", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-cursor-headers-"));
  const workspace = join(root, "remote-agent");
  const multiRoot = join(root, "neursales.code-workspace");
  const neursales = join(root, "neursales");
  mkdirSync(workspace);
  mkdirSync(neursales);
  writeFileSync(multiRoot, JSON.stringify({
    folders: [{ path: "./neursales" }],
  }));

  const dbPath = join(root, "state.vscdb");
  const database = new DatabaseSync(dbPath);
  database.exec(`
    CREATE TABLE composerHeaders (
      composerId TEXT PRIMARY KEY,
      workspaceId TEXT,
      createdAt INTEGER,
      lastUpdatedAt INTEGER,
      isArchived INTEGER,
      isSubagent INTEGER,
      value TEXT
    );
  `);
  const insert = database.prepare(
    `INSERT INTO composerHeaders
      (composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, value)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    "active-local",
    "ws-local",
    Date.parse("2026-09-30T01:00:00.000Z"),
    Date.parse("2026-09-30T01:10:00.000Z"),
    0,
    0,
    JSON.stringify({
      name: "Current sessions in directory",
      isDraft: false,
      workspaceIdentifier: {
        uri: { fsPath: workspace },
      },
    }),
  );
  insert.run(
    "active-multi",
    "ws-multi",
    Date.parse("2026-09-29T01:00:00.000Z"),
    Date.parse("2026-09-29T10:00:00.000Z"),
    0,
    0,
    JSON.stringify({
      name: "Performance report summary",
      isDraft: false,
      workspaceIdentifier: {
        configPath: { fsPath: multiRoot },
      },
    }),
  );
  insert.run(
    "archived-one",
    "ws-local",
    Date.parse("2026-09-28T01:00:00.000Z"),
    Date.parse("2026-09-28T10:00:00.000Z"),
    1,
    0,
    JSON.stringify({
      name: "Archived Code version check",
      isDraft: false,
      workspaceIdentifier: {
        uri: { fsPath: workspace },
      },
    }),
  );
  insert.run(
    "draft-one",
    "ws-local",
    Date.parse("2026-09-27T01:00:00.000Z"),
    Date.parse("2026-09-27T10:00:00.000Z"),
    0,
    0,
    JSON.stringify({
      name: "Draft should hide",
      isDraft: true,
      workspaceIdentifier: {
        uri: { fsPath: workspace },
      },
    }),
  );
  database.close();

  mkdirSync(join(root, "cursor-chats", "ws", "active-local"), { recursive: true });
  writeFileSync(
    join(root, "cursor-chats", "ws", "active-local", "meta.json"),
    JSON.stringify({ cwd: workspace, title: "wrong basename title" }),
  );

  const dirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    cursorComposerDb: dbPath,
    cursorTranscripts: join(root, "cursor-transcripts"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
  };

  try {
    const service = new NativeHistoryService(dirs, [root]);
    const sessions = await service.list({ agent: "cursor", limit: 50 });
    assert.deepEqual(
      sessions.map((session) => session.id).sort(),
      ["active-local", "active-multi"],
    );
    assert.equal(
      (await service.get("cursor", "active-local"))?.title,
      "Current sessions in directory",
    );
    assert.equal((await service.get("cursor", "active-local"))?.resumable, true);
    assert.equal((await service.get("cursor", "active-multi"))?.cwd, neursales);
    assert.equal((await service.get("cursor", "active-multi"))?.projectName, "neursales");
    assert.equal((await service.get("cursor", "active-multi"))?.resumable, true);
    assert.equal(await service.get("cursor", "archived-one"), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Cursor 3.0 composer.composerHeaders ItemTable index loads transcript messages", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-cursor-itemtable-"));
  const workspace = join(root, "demo-app");
  mkdirSync(workspace, { recursive: true });

  const composerId = "22222222-2222-4222-8222-222222222222";
  const dbPath = join(root, "state.vscdb");
  const database = new DatabaseSync(dbPath);
  database.exec(`
    CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
    CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
  `);
  database.prepare(`INSERT INTO ItemTable (key, value) VALUES (?, ?)`).run(
    "composer.composerHeaders",
    JSON.stringify({
      allComposers: [{
        composerId,
        name: "ItemTable indexed chat",
        lastUpdatedAt: Date.parse("2026-10-01T12:00:00.000Z"),
        workspaceIdentifier: {
          id: "ws-demo",
          uri: { fsPath: workspace },
        },
      }],
    }),
  );
  database.close();

  const transcriptDir = join(root, "cursor-transcripts", "proj", "agent-transcripts", composerId);
  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(
    join(transcriptDir, `${composerId}.jsonl`),
    [
      JSON.stringify({
        type: "user",
        id: "msg-1",
        timestamp: "2026-10-01T12:00:01.000Z",
        role: "user",
        message: {
          content: [{ type: "text", text: "<user_query>Hello from ItemTable</user_query>" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        role: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Planning" },
            { type: "text", text: "Reply body" },
          ],
        },
      }),
      "",
    ].join("\n"),
  );

  const dirs = {
    cursor: join(root, "cursor"),
    cursorChats: join(root, "cursor-chats"),
    cursorComposerDb: dbPath,
    cursorTranscripts: join(root, "cursor-transcripts"),
    claude: join(root, "claude"),
    codex: join(root, "codex"),
  };

  try {
    const service = new NativeHistoryService(dirs, [root]);
    const sessions = await service.list({ agent: "cursor", limit: 10 });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, composerId);
    assert.equal(sessions[0]?.title, "ItemTable indexed chat");
    assert.equal(sessions[0]?.resumable, true);
    assert.deepEqual(
      (await service.messages("cursor", composerId))?.map((message) => message.text),
      ["Hello from ItemTable", "Planning\nReply body"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
