import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveLookupKeysFromEntries,
  canArchiveSession,
  filterSessionsByArchive,
  sessionArchiveLookupKeys,
} from "../src/session-archive.ts";

test("session archive lookup keys include gateway id alias", () => {
  const keys = sessionArchiveLookupKeys({
    agent: "Cursor",
    id: "gateway-id",
    nativeId: "native-id",
  });
  assert.deepEqual(keys.sort(), ["cursor:gateway-id", "cursor:native-id"]);
});

test("filterSessionsByArchive respects dual-key matches", () => {
  const sessions = [
    { agent: "Cursor", id: "gateway-id", nativeId: "native-id", title: "one" },
    { agent: "Codex", id: "other", title: "two" },
  ];
  const archivedKeys = archiveLookupKeysFromEntries([
    { agent: "cursor", sessionKey: "native-id", archivedAt: "2026-10-10T00:00:00.000Z" },
  ]);
  const active = filterSessionsByArchive(sessions, archivedKeys, "active");
  const archived = filterSessionsByArchive(sessions, archivedKeys, "archived");
  assert.equal(active.length, 1);
  assert.equal(active[0]?.id, "other");
  assert.equal(archived.length, 1);
  assert.equal(archived[0]?.id, "gateway-id");
});

test("canArchiveSession blocks running and attention states", () => {
  assert.equal(canArchiveSession("running"), false);
  assert.equal(canArchiveSession("attention"), false);
  assert.equal(canArchiveSession("done"), true);
});
