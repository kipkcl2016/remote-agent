import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const setupDir = join(projectRoot, "scripts", "windows-setup");

test("windows-setup source scripts exist and enforce loopback defaults", () => {
  const required = [
    "install-logon-task.ps1",
    "uninstall-logon-task.ps1",
    "wrapper-start-gateway.cmd",
    "UNSIGNED-NOTICE.txt",
  ];
  for (const name of required) {
    assert.ok(existsSync(join(setupDir, name)), `missing ${name}`);
  }
  const install = readFileSync(join(setupDir, "install-logon-task.ps1"), "utf8");
  assert.match(install, /127\.0\.0\.1/);
  assert.match(install, /RemoteAgentGateway/);
  const wrapper = readFileSync(join(setupDir, "wrapper-start-gateway.cmd"), "utf8");
  assert.match(wrapper, /127\.0\.0\.1/);
});

test("windows-setup directory has no unexpected file types", () => {
  const files = readdirSync(setupDir);
  assert.ok(files.length >= 6);
  for (const file of files) {
    assert.ok(!file.endsWith(".example.ps1"), `stale example in setup dir: ${file}`);
  }
});
