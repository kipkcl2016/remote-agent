import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { pathToFileURL } from "node:url";

export const DEFAULT_GATEWAY_PORT = 17_821;
export const DEFAULT_HTTPS_PORT = 443;
export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

export type TailscaleServeOptions = {
  gatewayPort: number;
  httpsPort: number;
  pair: boolean;
  reset: boolean;
};

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type Runner = (command: string, args: string[]) => CommandResult;

export function parseArgs(argv: string[]): TailscaleServeOptions {
  const options: TailscaleServeOptions = {
    gatewayPort: DEFAULT_GATEWAY_PORT,
    httpsPort: DEFAULT_HTTPS_PORT,
    pair: true,
    reset: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      throw new HelpRequested();
    }
    if (arg === "--no-pair") {
      options.pair = false;
      continue;
    }
    if (arg === "--pair") {
      options.pair = true;
      continue;
    }
    if (arg === "--reset") {
      options.reset = true;
      continue;
    }
    if (arg === "--port" || arg === "--gateway-port") {
      options.gatewayPort = readPositiveInt(argv[++index], arg);
      continue;
    }
    if (arg === "--https-port") {
      options.httpsPort = readPositiveInt(argv[++index], arg);
      continue;
    }
    throw new Error(`未知参数：${arg}\n${usageText()}`);
  }
  return options;
}

export class HelpRequested extends Error {
  constructor() {
    super(usageText());
  }
}

export function usageText(): string {
  return [
    "用法：npm run serve:tailscale -- [--port 17821] [--https-port 443] [--no-pair] [--reset]",
    "",
    "把本机网关（默认 127.0.0.1:17821）通过 Tailscale Serve 暴露为 tailnet HTTPS，",
    "打印 MagicDNS URL 与终端二维码，供手机「设备」页填写网关地址；配对仍用现有 8 位码。",
    "",
    "  --port / --gateway-port   本机网关端口（默认 17821）",
    "  --https-port              Tailscale Serve HTTPS 端口（默认 443）",
    "  --pair / --no-pair        是否同时请求一次性配对码（默认开启）",
    "  --reset                  清除当前机器的 Tailscale Serve 配置后退出",
  ].join("\n");
}

function readPositiveInt(raw: string | undefined, flag: string): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} 需要正整数端口`);
  }
  return parsed;
}

export function resolveTailscaleBinary(
  env: NodeJS.ProcessEnv = process.env,
  currentPlatform: NodeJS.Platform = platform(),
  which: Runner = defaultRunner,
): string | undefined {
  const fromEnv = env.TAILSCALE_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const whichResult = which(currentPlatform === "win32" ? "where" : "which", ["tailscale"]);
  const fromPath = whichResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (fromPath && existsSync(fromPath)) return fromPath;

  if (currentPlatform === "darwin") {
    const appCli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if (existsSync(appCli)) return appCli;
  }

  return undefined;
}

export function buildServeHttpsUrl(dnsName: string, httpsPort: number): string {
  const host = dnsName.replace(/\.$/, "").trim();
  if (!host) throw new Error("无法解析 Tailscale MagicDNS 名称");
  if (httpsPort === 443) return `https://${host}`;
  return `https://${host}:${httpsPort}`;
}

export function extractDnsName(statusJson: unknown): string | undefined {
  if (!isRecord(statusJson)) return undefined;
  const self = statusJson.Self;
  if (!isRecord(self)) return undefined;
  if (typeof self.DNSName === "string" && self.DNSName.trim()) return self.DNSName.trim();
  if (typeof self.HostName === "string" && self.HostName.trim()) return self.HostName.trim();
  return undefined;
}

export function extractServeProxyTarget(
  serveStatusJson: unknown,
  httpsPort: number,
): string | undefined {
  if (!isRecord(serveStatusJson)) return undefined;
  const web = isRecord(serveStatusJson.Web) ? serveStatusJson.Web : serveStatusJson;
  if (!isRecord(web)) return undefined;
  const httpsKey = `https://${httpsPort}`;
  const portConfig = web[httpsKey] ?? web[`https://:${httpsPort}`] ?? web[String(httpsPort)];
  if (!isRecord(portConfig)) return undefined;
  const handlers = isRecord(portConfig.Handlers) ? portConfig.Handlers : portConfig;
  if (!isRecord(handlers)) return undefined;
  const root = handlers["/"] ?? handlers[""];
  if (typeof root === "string") return root;
  if (isRecord(root)) {
    if (typeof root.Proxy === "string") return root.Proxy;
    if (typeof root.proxy === "string") return root.proxy;
  }
  return undefined;
}

export function pairingPayload(url: string, code: string): string {
  // Phone still uses existing Devices UI (URL + 8-digit code). QR encodes a
  // compact text block phones can scan into Notes / paste helpers; do not invent
  // a second auth scheme or deep-link protocol.
  return `Remote Agent\n${url}\ncode=${code}`;
}

export async function fetchPairingCode(
  gatewayPort: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ code: string; expiresAt: string }> {
  const response = await fetchImpl(`http://127.0.0.1:${gatewayPort}/v1/pairing/start`, {
    method: "POST",
  });
  const body = (await response.json()) as {
    data?: { code?: string; expiresAt?: string };
    error?: { message?: string };
  };
  if (!response.ok || !body.data?.code || !body.data.expiresAt) {
    throw new Error(body.error?.message ?? `配对请求失败（HTTP ${response.status}）。请先启动网关。`);
  }
  return { code: body.data.code, expiresAt: body.data.expiresAt };
}

export async function checkGatewayHealth(
  gatewayPort: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${gatewayPort}/v1/health`, {
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function renderQrToStdout(
  text: string,
  runner: Runner = defaultRunner,
): boolean {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: "npx", args: ["--yes", "qrcode@1.5.4", "--error", "M", "--qzone", "2", text] },
  ];
  for (const attempt of attempts) {
    const result = runner(attempt.command, attempt.args);
    if (result.status === 0 && result.stdout.trim()) {
      process.stdout.write(`${result.stdout.trimEnd()}\n`);
      return true;
    }
  }
  return false;
}

function defaultRunner(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function runTailscale(
  binary: string,
  args: string[],
  runner: Runner,
): CommandResult {
  return runner(binary, args);
}

export async function runTailscaleServe(
  options: TailscaleServeOptions,
  deps: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    runner?: Runner;
    fetchImpl?: typeof fetch;
    write?: (text: string) => void;
    writeErr?: (text: string) => void;
  } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const currentPlatform = deps.platform ?? platform();
  const runner = deps.runner ?? defaultRunner;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const write = deps.write ?? ((text) => process.stdout.write(text));
  const writeErr = deps.writeErr ?? ((text) => process.stderr.write(text));

  const binary = resolveTailscaleBinary(env, currentPlatform, runner);
  if (!binary) {
    writeErr(
      `未找到 Tailscale CLI。请先安装：${TAILSCALE_DOWNLOAD_URL}\n` +
        (currentPlatform === "darwin"
          ? "macOS 也可：App Store / https://tailscale.com/download/mac ，安装后确保 CLI 可用。\n"
          : currentPlatform === "win32"
            ? "Windows：安装 Tailscale 后，在「安装 CLI」或把 tailscale.exe 加入 PATH。\n"
            : "Linux：按发行版安装 tailscale 包。\n"),
    );
    return 1;
  }

  if (options.reset) {
    const reset = runTailscale(binary, ["serve", "reset"], runner);
    if (reset.status !== 0) {
      writeErr(reset.stderr.trim() || "tailscale serve reset 失败\n");
      return 1;
    }
    write("已清除本机 Tailscale Serve 配置。\n");
    return 0;
  }

  const status = runTailscale(binary, ["status", "--json"], runner);
  if (status.status !== 0) {
    writeErr(
      (status.stderr.trim() || "tailscale status 失败") +
        "\n请先登录 Tailscale：`tailscale up`，并确认手机与 Mac 在同一 tailnet。\n",
    );
    return 1;
  }

  let statusJson: unknown;
  try {
    statusJson = JSON.parse(status.stdout);
  } catch {
    writeErr("无法解析 tailscale status --json。\n");
    return 1;
  }

  const backend = isRecord(statusJson) ? statusJson.BackendState : undefined;
  if (typeof backend === "string" && backend !== "Running") {
    writeErr(`Tailscale 未处于 Running（当前：${backend}）。请执行 tailscale up。\n`);
    return 1;
  }

  const dnsName = extractDnsName(statusJson);
  if (!dnsName) {
    writeErr("无法读取 MagicDNS 名称。请在 Tailscale Admin 启用 MagicDNS / HTTPS Certificates。\n");
    return 1;
  }

  const healthy = await checkGatewayHealth(options.gatewayPort, fetchImpl);
  if (!healthy) {
    writeErr(
      `本机网关 http://127.0.0.1:${options.gatewayPort} 未响应。\n` +
        `请先启动网关，例如：\n` +
        `  cd macos-agent-gateway && REMOTE_AGENT_ROOTS=/path/to/projects npm run dev\n` +
        `或：npm run service:install -- /path/to/projects\n`,
    );
    return 1;
  }

  const target = `http://127.0.0.1:${options.gatewayPort}`;
  const serve = runTailscale(
    binary,
    ["serve", "--bg", "--yes", `--https=${options.httpsPort}`, target],
    runner,
  );
  if (serve.status !== 0) {
    writeErr(
      (serve.stderr.trim() || serve.stdout.trim() || "tailscale serve 失败") +
        "\n若提示启用 HTTPS Certificates，请按 CLI 给出的链接在 Admin Console 开启后重试。\n",
    );
    return 1;
  }

  const serveStatus = runTailscale(binary, ["serve", "status", "--json"], runner);
  if (serveStatus.status === 0) {
    try {
      const parsed = JSON.parse(serveStatus.stdout) as unknown;
      const proxy = extractServeProxyTarget(parsed, options.httpsPort);
      if (proxy && !proxy.includes(`:${options.gatewayPort}`) && !proxy.endsWith(`/${options.gatewayPort}`)) {
        writeErr(
          `警告：HTTPS :${options.httpsPort} 当前代理到 ${proxy}，不是本网关 ${target}。` +
            `如需覆盖，可先 npm run serve:tailscale -- --reset。\n`,
        );
      }
    } catch {
      // status JSON shape varies across Tailscale versions; URL still printable from DNSName.
    }
  }

  const httpsUrl = buildServeHttpsUrl(dnsName, options.httpsPort);
  write("\n");
  write("Tailscale Serve 已启用（仅 tailnet 内可达，不是 Funnel 公网）。\n");
  write(`HTTPS URL：${httpsUrl}\n`);
  write(`后端：${target}\n`);

  let pairingCode: string | undefined;
  let expiresAt: string | undefined;
  if (options.pair) {
    try {
      const paired = await fetchPairingCode(options.gatewayPort, fetchImpl);
      pairingCode = paired.code;
      expiresAt = paired.expiresAt;
      write(`配对码：${pairingCode}\n`);
      write(`过期时间：${expiresAt}\n`);
    } catch (error) {
      writeErr(
        `${error instanceof Error ? error.message : String(error)}\n` +
          "Serve 已就绪，可稍后在 Mac 上运行 npm run pair。\n",
      );
    }
  }

  const qrText = pairingCode ? pairingPayload(httpsUrl, pairingCode) : httpsUrl;
  write("\n手机步骤：\n");
  write("  1. 手机安装并登录同一 Tailscale 账号 / tailnet\n");
  write("  2. 打开 Remote Agent「设备」页，网关地址填入上面的 HTTPS URL\n");
  if (pairingCode) {
    write("  3. 输入本机显示的 8 位配对码并确认\n");
  } else {
    write("  3. 在 Mac 运行 npm run pair，再输入 8 位配对码\n");
  }
  write("\n二维码内容（网关 HTTPS URL" + (pairingCode ? " + 配对码文本" : "") + "）：\n");
  const rendered = renderQrToStdout(qrText, runner);
  if (!rendered) {
    write("(未能渲染二维码，请手动复制 URL" + (pairingCode ? " 与配对码" : "") + ")\n");
    write(`${qrText}\n`);
  } else if (pairingCode) {
    write(`\n${httpsUrl}\ncode=${pairingCode}\n`);
  }

  if (currentPlatform === "win32") {
    write(
      "\nWindows 说明：Serve 可用，但本仓库的 service:install（launchd）不可用；" +
        "请用 start-gateway.bat / 任务计划保持网关运行，再执行本命令。\n",
    );
  }

  return 0;
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const code = await runTailscaleServe(options);
    process.exitCode = code;
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(`${error.message}\n`);
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
