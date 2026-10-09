import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("compiled version module does not depend on package.json on disk", () => {
  const compiled = readFileSync(join(projectRoot, "dist", "version.js"), "utf8");
  assert.doesNotMatch(compiled, /package\.json/);
  assert.doesNotMatch(compiled, /readFileSync/);
});
