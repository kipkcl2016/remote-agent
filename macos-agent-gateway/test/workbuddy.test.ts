import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  isWorkbuddyEphemeralCwd,
  resolveWorkbuddyCreateCwd,
  scanWorkbuddySessions,
  workbuddyTempDir,
} from "../src/workbuddy.js";

test("scanWorkbuddySessions skips archived and soft-deleted rows", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-workbuddy-scan-"));
  const dbPath = join(root, "workbuddy.db");
  const database = new DatabaseSync(dbPath);
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT,
      custom_title TEXT,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      last_activity_at INTEGER
    );
  `);
  const now = Date.parse("2026-10-10T08:00:00.000Z");
  database.prepare(
    `INSERT INTO sessions (id, cwd, user_id, title, status, created_at, updated_at, deleted_at, last_activity_at)
     VALUES (?, ?, 'u', ?, ?, ?, ?, ?, ?)`,
  ).run("active-1", join(root, "proj"), "Active", "completed", now, now, null, now);
  database.prepare(
    `INSERT INTO sessions (id, cwd, user_id, title, status, created_at, updated_at, deleted_at, last_activity_at)
     VALUES (?, ?, 'u', ?, ?, ?, ?, ?, ?)`,
  ).run("archived-1", join(root, "old"), "Archived", "archived", now - 1000, now - 1000, null, now - 1000);
  database.prepare(
    `INSERT INTO sessions (id, cwd, user_id, title, status, created_at, updated_at, deleted_at, last_activity_at)
     VALUES (?, ?, 'u', ?, ?, ?, ?, ?, ?)`,
  ).run("deleted-1", join(root, "gone"), "Deleted", "completed", now - 2000, now - 2000, now - 500, now - 2000);
  database.prepare(
    `INSERT INTO sessions (id, cwd, user_id, title, status, created_at, updated_at, deleted_at, last_activity_at)
     VALUES (?, ?, 'u', ?, ?, ?, ?, ?, ?)`,
  ).run("cloud-alive", join(root, "cloud"), "Cloud", "completed", now - 3000, now - 3000, -1, now - 3000);
  database.close();

  try {
    const sessions = scanWorkbuddySessions(dbPath);
    assert.equal(sessions.some((s) => s.id === "active-1"), true);
    assert.equal(sessions.some((s) => s.id === "cloud-alive"), true);
    assert.equal(sessions.some((s) => s.id === "archived-1"), false);
    assert.equal(sessions.some((s) => s.id === "deleted-1"), false);
    assert.equal(sessions.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveWorkbuddyCreateCwd maps dated and home cwd to shared _temp", () => {
  const home = mkdtempSync(join(tmpdir(), "remote-agent-wb-home-"));
  try {
    const dated = join(home, "2026-10-10-13-37-28");
    mkdirSync(dated);
    const named = join(home, "房子");
    mkdirSync(named);

    assert.equal(isWorkbuddyEphemeralCwd(home, home), true);
    assert.equal(isWorkbuddyEphemeralCwd(dated, home), true);
    assert.equal(isWorkbuddyEphemeralCwd(named, home), false);
    assert.equal(isWorkbuddyEphemeralCwd(join(home, "_temp"), home), true);

    const temp = resolveWorkbuddyCreateCwd(dated, home);
    assert.equal(temp, workbuddyTempDir(home));
    assert.equal(existsSync(temp), true);
    assert.equal(resolveWorkbuddyCreateCwd(home, home), temp);
    assert.equal(resolveWorkbuddyCreateCwd(named, home), named);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
