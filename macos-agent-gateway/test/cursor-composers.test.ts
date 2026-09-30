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
