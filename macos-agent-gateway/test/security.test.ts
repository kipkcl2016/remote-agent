import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PairingManager, hashToken, resolveAllowedWorkingDirectory } from "../src/security.js";

test("pairing codes are one-time and expire", () => {
  const pairing = new PairingManager(1_000);
  const started = pairing.begin(10_000);
  assert.match(started.code, /^\d{8}$/);
  assert.equal(pairing.consume(started.code, 10_500), true);
  assert.equal(pairing.consume(started.code, 10_500), false);

  const expired = pairing.begin(20_000);
  assert.equal(pairing.consume(expired.code, 21_001), false);
});

test("working directories must stay inside configured roots", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-root-"));
  const inside = join(root, "project");
  const outside = mkdtempSync(join(tmpdir(), "remote-agent-outside-"));
  mkdirSync(inside);
  try {
    assert.equal(resolveAllowedWorkingDirectory(inside, [root]), realpathSync.native(inside));
    const differentlyCasedRoot = root.replace("remote-agent-root-", "REMOTE-AGENT-ROOT-");
    if (differentlyCasedRoot !== root && existsSync(differentlyCasedRoot)) {
      assert.equal(
        resolveAllowedWorkingDirectory(inside, [differentlyCasedRoot]),
        realpathSync.native(inside),
      );
    }
    assert.throws(() => resolveAllowedWorkingDirectory(outside, [root]), /outside/);
    assert.throws(() => resolveAllowedWorkingDirectory("relative", [root]), /absolute/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("device tokens are stored as deterministic hashes", () => {
  assert.equal(hashToken("token"), hashToken("token"));
  assert.notEqual(hashToken("token"), hashToken("different"));
});
