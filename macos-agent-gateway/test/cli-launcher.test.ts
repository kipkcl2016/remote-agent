import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveCliLauncher } from "../src/cli-launcher.js";

test("[AGENT-001][AGENT-002] Windows native binaries and npm Node shims are resolved without shell expansion", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-cli-"));
  const dir = join(root, "install with spaces");
  const script = join(dir, "node_modules", "fixture", "cli.js");
  mkdirSync(join(dir, "node_modules", "fixture"), { recursive: true });
  try {
    writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
    writeFileSync(join(dir, "codex.cmd"), '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\fixture\\cli.js" %*\r\n');
    const options = { platform: "win32" as const, env: { PATH: `"${dir}"` } };
    const launcher = await resolveCliLauncher("codex", options);
    assert.deepEqual(launcher, { executable: process.execPath, prefixArgs: [script] });
    const args = ['hello & echo unexpected', '$(touch sentinel)', '"quoted"', '中文'];
    const result = spawnSync(launcher!.executable, [...launcher!.prefixArgs, ...args], { shell: false, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), args);
    writeFileSync(join(dir, "codex.exe"), "fixture", { mode: 0o755 });
    assert.deepEqual(await resolveCliLauncher("codex", options), { executable: join(dir, "codex.exe"), prefixArgs: [] });
    writeFileSync(join(dir, "claude.cmd"), "@echo off\r\nnode arbitrary.js %*\r\n");
    assert.equal(await resolveCliLauncher("claude", options), undefined, "unknown batch commands must not run through cmd.exe");
    writeFileSync(join(dir, "escape.cmd"), '"%_prog%" "%dp0%\\..\\outside.js" %*');
    writeFileSync(join(root, "outside.js"), "fixture");
    assert.equal(await resolveCliLauncher("escape", options), undefined);
    assert.equal(await resolveCliLauncher("missing", options), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
