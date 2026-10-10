import assert from "node:assert/strict";
import test from "node:test";

function installMemoryStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => { data.clear(); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}

installMemoryStorage();

const {
  archiveSession,
  canArchiveSession,
  filterSessionsByArchive,
  readSessionArchiveKeys,
  restoreSession,
  sessionArchiveIdentity,
  SESSION_ARCHIVE_KEY,
} = await import("../src/session-archive.ts");

const gatewayA = "http://gateway-a.test";
const gatewayB = "http://gateway-b.test";

function clearArchiveStorage() {
  localStorage.clear();
}

test("archive identity prefers nativeId for gateway-linked sessions", () => {
  assert.equal(
    sessionArchiveIdentity({ agent: "Cursor", id: "gateway-id", nativeId: "native-42" }),
    "Cursor:native-42",
  );
  assert.equal(
    sessionArchiveIdentity({ agent: "Claude", id: "only-id" }),
    "Claude:only-id",
  );
});

test("archive and restore are isolated per gateway bucket", () => {
  clearArchiveStorage();
  const session = { agent: "Codex", id: "codex-1", nativeId: "native-codex" };
  assert.equal(canArchiveSession("done"), true);
  assert.equal(canArchiveSession("running"), false);
  archiveSession(gatewayA, session);
  assert.equal(readSessionArchiveKeys(gatewayA).has(sessionArchiveIdentity(session)), true);
  assert.equal(readSessionArchiveKeys(gatewayB).has(sessionArchiveIdentity(session)), false);
  restoreSession(gatewayA, session);
  assert.equal(readSessionArchiveKeys(gatewayA).size, 0);
});

test("filterSessionsByArchive splits active and archived lists", () => {
  const sessions = [
    { agent: "Cursor", id: "a" },
    { agent: "Claude", id: "b" },
  ];
  const archived = new Set(["Cursor:a"]);
  assert.deepEqual(
    filterSessionsByArchive(sessions, archived, "active").map((item) => item.id),
    ["b"],
  );
  assert.deepEqual(
    filterSessionsByArchive(sessions, archived, "archived").map((item) => item.id),
    ["a"],
  );
});
