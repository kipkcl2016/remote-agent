import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { DEFAULT_REMOTE_AGENT_ALLOWED_ORIGINS } from "./config.js";

export const serviceLabel = "com.remoteagent.gateway";

export type LaunchAgentOptions = {
  nodePath: string;
  entryPath: string;
  roots: string[];
  dataDir: string;
  stdoutPath: string;
  stderrPath: string;
  path: string;
  port?: number;
  allowedOrigins?: string;
};

export function buildLaunchAgentPlist(options: LaunchAgentOptions): string {
  const environment = {
    PATH: options.path,
    REMOTE_AGENT_HOST: "0.0.0.0",
    REMOTE_AGENT_PORT: String(options.port ?? 17_821),
    REMOTE_AGENT_DATA_DIR: options.dataDir,
    REMOTE_AGENT_ROOTS: options.roots.join(delimiter),
    REMOTE_AGENT_ALLOWED_ORIGINS:
      options.allowedOrigins ?? DEFAULT_REMOTE_AGENT_ALLOWED_ORIGINS,
  };
  const environmentXml = Object.entries(environment)
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.nodePath)}</string>
    <string>${escapeXml(options.entryPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.stderrPath)}</string>
</dict>
</plist>
`;
}

export function servicePaths(userHome = homedir()) {
  const dataDir = resolve(userHome, ".remote-agent");
  return {
    dataDir,
    logDir: resolve(dataDir, "logs"),
    runtimeDir: resolve(dataDir, "runtime"),
    plistPath: resolve(userHome, "Library", "LaunchAgents", `${serviceLabel}.plist`),
  };
}

export function isMacOSPrivacyProtectedRoot(root: string, userHome = homedir()): boolean {
  const normalized = resolve(root);
  return ["Desktop", "Documents", "Downloads"].some((folder) => {
    const protectedDirectory = resolve(userHome, folder);
    return normalized === protectedDirectory || normalized.startsWith(`${protectedDirectory}${sep}`);
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function launchctl(...args: string[]) {
  return spawnSync("/bin/launchctl", args, { encoding: "utf8", stdio: "pipe" });
}

function serviceTarget(): string {
  return `gui/${userId()}/${serviceLabel}`;
}

function userId(): number {
  if (!process.getuid) {
    throw new Error("Service installation is only supported on macOS. On Windows, run the gateway manually or use a service wrapper like nssm.");
  }
  return process.getuid();
}

function install(roots: string[]): void {
  const paths = servicePaths();
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const builtRuntimeDir = resolve(projectRoot, "dist");
  const builtEntryPath = resolve(builtRuntimeDir, "index.js");
  if (!existsSync(builtEntryPath)) throw new Error("dist/index.js 不存在，请先运行 npm run build");
  const allowedRoots = roots.length
    ? roots.map((root) => resolve(root))
    : (process.env.REMOTE_AGENT_ROOTS ?? process.cwd())
        .split(delimiter)
        .filter(Boolean)
        .map((root) => resolve(root));
  mkdirSync(dirname(paths.plistPath), { recursive: true, mode: 0o700 });
  mkdirSync(paths.logDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.runtimeDir, { recursive: true, mode: 0o700 });
  cpSync(builtRuntimeDir, paths.runtimeDir, { recursive: true, force: true });
  copyFileSync(resolve(projectRoot, "package.json"), resolve(paths.dataDir, "package.json"));
  const entryPath = resolve(paths.runtimeDir, "index.js");
  const plist = buildLaunchAgentPlist({
    nodePath: process.execPath,
    entryPath,
    roots: [...new Set(allowedRoots)],
    dataDir: paths.dataDir,
    stdoutPath: resolve(paths.logDir, "gateway.log"),
    stderrPath: resolve(paths.logDir, "gateway.error.log"),
    path: process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    allowedOrigins: process.env.REMOTE_AGENT_ALLOWED_ORIGINS,
  });
  writeFileSync(paths.plistPath, plist, { encoding: "utf8", mode: 0o600 });
  chmodSync(paths.plistPath, 0o600);

  launchctl("bootout", `gui/${userId()}`, paths.plistPath);
  const loaded = launchctl("bootstrap", `gui/${userId()}`, paths.plistPath);
  if (loaded.status !== 0) {
    throw new Error(loaded.stderr.trim() || "launchd 服务加载失败");
  }
  const started = launchctl("kickstart", "-k", serviceTarget());
  if (started.status !== 0) {
    throw new Error(started.stderr.trim() || "launchd 服务启动失败");
  }
  process.stdout.write(`Remote Agent 网关已安装并启动：${paths.plistPath}\n`);
  process.stdout.write(`允许目录：${allowedRoots.join(", ")}\n`);
  if (allowedRoots.some((root) => isMacOSPrivacyProtectedRoot(root))) {
    process.stderr.write(
      `注意：白名单包含 Desktop/Documents/Downloads。macOS 可能阻止后台 Node 访问；` +
        `请在“系统设置 → 隐私与安全性 → 完全磁盘访问权限”中授权 ${process.execPath}，` +
        `或把项目放在 ~/Projects。\n`,
    );
  }
}

function uninstall(): void {
  const { plistPath } = servicePaths();
  if (!existsSync(plistPath)) {
    process.stdout.write("Remote Agent 网关未安装。\n");
    return;
  }
  const stopped = launchctl("bootout", `gui/${userId()}`, plistPath);
  if (stopped.status !== 0 && !/No such process|Could not find/i.test(stopped.stderr)) {
    throw new Error(stopped.stderr.trim() || "launchd 服务停止失败");
  }
  unlinkSync(plistPath);
  process.stdout.write("Remote Agent 网关已停止并移除；SQLite 与日志仍保留。\n");
}

function status(): void {
  const result = launchctl("print", serviceTarget());
  if (result.status === 0) {
    process.stdout.write(result.stdout);
    return;
  }
  process.stdout.write("Remote Agent 网关未运行。\n");
  process.exitCode = 1;
}

function main(): void {
  const command = process.argv[2];
  if (command === "install") install(process.argv.slice(3));
  else if (command === "uninstall") uninstall();
  else if (command === "status") status();
  else throw new Error("用法：service-manager.ts <install [allowed-root ...] | status | uninstall>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
