import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const gatewayRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(gatewayRoot, "..");
const ciDir = join(repoRoot, "scripts", "ci");

test("Phase C CI signing scripts exist at repo root", () => {
  assert.ok(existsSync(join(ciDir, "sign-windows.ps1")));
  assert.ok(existsSync(join(ciDir, "notarize-macos.sh")));
  const win = readFileSync(join(ciDir, "sign-windows.ps1"), "utf8");
  assert.match(win, /WINDOWS_CODE_SIGNING_CERT/);
  const mac = readFileSync(join(ciDir, "notarize-macos.sh"), "utf8");
  assert.match(mac, /APPLE_DEVELOPER_ID_CERT_BASE64/);
});

test("release workflow references optional signing gates", () => {
  const workflow = readFileSync(join(repoRoot, ".github", "workflows", "release-artifacts.yml"), "utf8");
  assert.match(workflow, /sign-windows\.ps1/);
  assert.match(workflow, /notarize-macos\.sh/);
  assert.match(workflow, /secrets\.WINDOWS_CODE_SIGNING_CERT/);
});
