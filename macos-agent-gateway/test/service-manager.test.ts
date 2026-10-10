import assert from "node:assert/strict";
import { platform } from "node:os";
import { delimiter } from "node:path";
import test from "node:test";
import {
  buildLaunchAgentPlist,
  isMacOSPrivacyProtectedRoot,
  serviceLabel,
  servicePaths,
} from "../src/service-manager.js";

test("launchd plist pins executable paths and escapes user values", () => {
  const plist = buildLaunchAgentPlist({
    nodePath: "/opt/node & tools/bin/node",
    entryPath: "/Apps/Remote <Agent>/dist/index.js",
    roots: ["/Users/test/Project & Notes"],
    dataDir: "/Users/test/.remote-agent",
    stdoutPath: "/Users/test/.remote-agent/logs/gateway.log",
    stderrPath: "/Users/test/.remote-agent/logs/gateway.error.log",
    path: "/opt/homebrew/bin:/usr/bin:/bin",
  });

  assert.match(plist, new RegExp(`<string>${serviceLabel}</string>`));
  assert.match(plist, /\/opt\/node &amp; tools\/bin\/node/);
  assert.match(plist, /Remote &lt;Agent&gt;/);
  assert.match(plist, /REMOTE_AGENT_HOST/);
  assert.match(plist, /<string>0\.0\.0\.0<\/string>/);
  assert.match(plist, /capacitor:\/\/localhost/);
  assert.match(plist, /http:\/\/127\.0\.0\.1:4173/);
  assert.doesNotMatch(plist, /<string>\/opt\/node & tools/);
});

test("launchd plist joins multiple REMOTE_AGENT_ROOTS for Codex worktrees", () => {
  const plist = buildLaunchAgentPlist({
    nodePath: "/opt/node/bin/node",
    entryPath: "/Users/test/.remote-agent/runtime/index.js",
    roots: ["/Users/test/projects", "/Users/test/.codex/worktrees"],
    dataDir: "/Users/test/.remote-agent",
    stdoutPath: "/Users/test/.remote-agent/logs/gateway.log",
    stderrPath: "/Users/test/.remote-agent/logs/gateway.error.log",
    path: "/opt/homebrew/bin:/usr/bin:/bin",
  });

  assert.match(
    plist,
    new RegExp(
      `<key>REMOTE_AGENT_ROOTS</key>\\s*<string>/Users/test/projects${delimiter}/Users/test/\\.codex/worktrees</string>`,
    ),
  );
});

test("detects macOS privacy-protected project roots", () => {
  assert.equal(
    isMacOSPrivacyProtectedRoot("/Users/example/Documents/app", "/Users/example"),
    true,
  );
  assert.equal(isMacOSPrivacyProtectedRoot("/Users/example/Projects/app", "/Users/example"), false);
});

test("service paths stay inside the selected user home", { skip: platform() === "win32" }, () => {
  const paths = servicePaths("/Users/example");
  assert.equal(
    paths.plistPath,
    `/Users/example/Library/LaunchAgents/${serviceLabel}.plist`,
  );
  assert.equal(paths.dataDir, "/Users/example/.remote-agent");
  assert.equal(paths.runtimeDir, "/Users/example/.remote-agent/runtime");
});
