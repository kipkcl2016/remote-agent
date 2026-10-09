#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const packageDir = resolve(projectRoot, "packages", "remote-agent-gateway");

const requiredInPackage = [
  "install-logon-task.ps1",
  "uninstall-logon-task.ps1",
  "wrapper-start-gateway.cmd",
  "UNSIGNED-NOTICE.txt",
  "gateway-task-config.cmd", // should NOT exist until install — skip
];

const mustExist = requiredInPackage.filter((name) => name !== "gateway-task-config.cmd");

for (const name of mustExist) {
  const path = join(packageDir, name);
  if (!existsSync(path)) {
    console.error(`Missing in package: ${path}`);
    process.exit(1);
  }
}

const installScript = join(packageDir, "install-logon-task.ps1");
const installBody = readFileSync(installScript, "utf8");
if (!installBody.includes("127.0.0.1")) {
  console.error("install-logon-task.ps1 must default REMOTE_AGENT_HOST to 127.0.0.1");
  process.exit(1);
}

const sourceDir = join(projectRoot, "scripts", "windows-setup");
const sourceFiles = readdirSync(sourceDir).filter((f) => !f.startsWith("."));
const packaged = readdirSync(packageDir);
for (const file of sourceFiles) {
  if (!packaged.includes(file)) {
    console.error(`Windows setup file not copied to package: ${file}`);
    process.exit(1);
  }
}

console.log("✓ Windows setup scripts present in gateway package");
