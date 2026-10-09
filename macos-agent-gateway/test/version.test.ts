import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { GATEWAY_VERSION } from "../src/version.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("GATEWAY_VERSION matches package.json without reading parent package.json at runtime", () => {
  const packageJson = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8"),
  ) as { version: string };
  assert.equal(GATEWAY_VERSION, packageJson.version);
});

test("version module is a build-time constant (no package.json filesystem reads)", () => {
  const generated = readFileSync(
    join(projectRoot, "src", "gateway-version.generated.ts"),
    "utf8",
  );
  assert.doesNotMatch(generated, /package\.json/);
  assert.doesNotMatch(generated, /readFileSync/);

  const versionSource = readFileSync(join(projectRoot, "src", "version.ts"), "utf8");
  assert.doesNotMatch(versionSource, /package\.json/);
  assert.doesNotMatch(versionSource, /readFileSync/);
});

test("compiled version module does not depend on package.json on disk", () => {
  const compiledPath = join(projectRoot, "dist", "version.js");
  if (!existsSync(compiledPath)) {
    return;
  }
  const compiled = readFileSync(compiledPath, "utf8");
  assert.doesNotMatch(compiled, /package\.json/);
  assert.doesNotMatch(compiled, /readFileSync/);
});
