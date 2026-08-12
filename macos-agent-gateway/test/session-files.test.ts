import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readSessionFile, SessionFileError } from "../src/session-files.js";

test("[FILE-001] session files resolve local references inside the session cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-files-"));
  const workspace = join(root, "workspace");
  const report = join(workspace, "reports", "检查 结果.txt");
  const html = join(workspace, "reports", "效果页.html");
  mkdirSync(join(workspace, "reports"), { recursive: true });
  writeFileSync(report, "preview-ready", "utf8");
  writeFileSync(html, "<!doctype html><title>preview</title>", "utf8");

  try {
    for (const reference of [
      "./reports/%E6%A3%80%E6%9F%A5%20%E7%BB%93%E6%9E%9C.txt",
      report,
      pathToFileURL(report).href,
      `${pathToFileURL(report).href}#L1`,
    ]) {
      const file = await readSessionFile(workspace, reference, [root]);
      assert.equal(file.name, "检查 结果.txt");
      assert.equal(file.contentType, "text/plain; charset=utf-8");
      assert.equal(file.bytes.toString("utf8"), "preview-ready");
    }
    const htmlFile = await readSessionFile(workspace, "./reports/效果页.html", [root]);
    assert.equal(htmlFile.name, "效果页.html");
    assert.equal(htmlFile.contentType, "text/html; charset=utf-8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[FILE-001] session file reads reject escape, non-files, missing files, and oversize content", async () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-files-"));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside.txt");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(outside, "private", "utf8");
  writeFileSync(join(workspace, "large.bin"), "1234", "utf8");
  symlinkSync(outside, join(workspace, "escape.txt"));

  try {
    await assert.rejects(
      readSessionFile(workspace, "../outside.txt", [root]),
      (error: unknown) => isFileError(error, 403),
    );
    await assert.rejects(
      readSessionFile(workspace, "./escape.txt", [root]),
      (error: unknown) => isFileError(error, 403),
    );
    await assert.rejects(
      readSessionFile(workspace, ".", [root]),
      (error: unknown) => isFileError(error, 400),
    );
    await assert.rejects(
      readSessionFile(workspace, "./missing.txt", [root]),
      (error: unknown) => isFileError(error, 404),
    );
    await assert.rejects(
      readSessionFile(workspace, "./large.bin", [root], 3),
      (error: unknown) => isFileError(error, 413),
    );
    await assert.rejects(
      readSessionFile(workspace, "https://example.com/file.txt", [root]),
      (error: unknown) => isFileError(error, 400),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function isFileError(error: unknown, status: number): boolean {
  return error instanceof SessionFileError && error.status === status;
}
