#!/usr/bin/env node
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const distDir = resolve(projectRoot, "dist");
const packagesDir = resolve(projectRoot, "packages");

// Clean and create packages directory
mkdirSync(packagesDir, { recursive: true });

// Copy built files
const packageDir = join(packagesDir, "remote-agent-gateway");
mkdirSync(packageDir, { recursive: true });
cpSync(distDir, join(packageDir, "dist"), { recursive: true });
copyFileSync(join(projectRoot, "package.json"), join(packageDir, "package.json"));
copyFileSync(join(projectRoot, "package-lock.json"), join(packageDir, "package-lock.json"));

// Create README
const readme = `# Remote Agent Gateway

本地网关服务，用于连接移动端控制台与 Cursor Agent、Claude Code、Codex CLI。

## 系统要求

- Node.js >= 22.13
- macOS 或 Windows 10/11

## 快速开始

### macOS / Linux

\`\`\`bash
# 1. 安装依赖（仅首次）
npm install --production

# 2. 启动网关
./start-gateway.sh /path/to/your/projects

# 3. 在另一个终端生成配对码
./pair.sh
\`\`\`

### Windows

\`\`\`cmd
REM 1. 安装依赖（仅首次）
npm install --production

REM 2. 启动网关
start-gateway.bat C:\\path\\to\\your\\projects

REM 3. 在另一个终端生成配对码
pair.bat
\`\`\`

## 环境变量配置

\`\`\`bash
# 网关监听地址（默认 127.0.0.1，仅本机访问）
REMOTE_AGENT_HOST=127.0.0.1

# 网关端口（默认 17821）
REMOTE_AGENT_PORT=17821

# 允许的项目根目录（多个用冒号或分号分隔）
REMOTE_AGENT_ROOTS=/path/to/projects:/another/path

# 数据存储目录（默认 ~/.remote-agent）
REMOTE_AGENT_DATA_DIR=$HOME/.remote-agent
\`\`\`

## Windows 限制

- launchd 服务安装不可用（使用手动启动或 NSSM 包装为 Windows 服务）
- Cursor 历史路径：\`%APPDATA%\\Cursor\`
- Claude 历史路径：\`%USERPROFILE%\\.claude\`
- Codex 历史路径：\`%USERPROFILE%\\.codex\`

如需自定义历史路径，使用环境变量：
- \`REMOTE_AGENT_CURSOR_HISTORY_DIR\`
- \`REMOTE_AGENT_CLAUDE_HISTORY_DIR\`
- \`REMOTE_AGENT_CODEX_HISTORY_DIR\`

## 安全说明

- 默认只监听 \`127.0.0.1\`（本机），无法从网络访问
- 跨设备使用请配置 HTTPS 反向代理或使用 Tailscale
- 不要将 HTTP 网关直接暴露到公网

详细文档：https://github.com/kipkcl2016/remote-agent
`;

writeFileSync(join(packageDir, "README.md"), readme, "utf8");

// Create Unix start script
const startScriptUnix = `#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <project-root-directory> [additional-root...]"
  echo "Example: $0 /Users/me/projects"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export REMOTE_AGENT_ROOTS="$*"
export REMOTE_AGENT_HOST=\${REMOTE_AGENT_HOST:-127.0.0.1}
export REMOTE_AGENT_PORT=\${REMOTE_AGENT_PORT:-17821}

cd "$SCRIPT_DIR"
node dist/index.js
`;

writeFileSync(join(packageDir, "start-gateway.sh"), startScriptUnix, { mode: 0o755 });

// Create Windows start script
const startScriptWin = `@echo off
setlocal

if "%~1"=="" (
  echo Usage: %~nx0 ^<project-root-directory^> [additional-root...]
  echo Example: %~nx0 C:\\Users\\me\\projects
  exit /b 1
)

set "REMOTE_AGENT_ROOTS=%*"
if not defined REMOTE_AGENT_HOST set "REMOTE_AGENT_HOST=127.0.0.1"
if not defined REMOTE_AGENT_PORT set "REMOTE_AGENT_PORT=17821"

cd /d "%~dp0"
node dist\\index.js
`;

writeFileSync(join(packageDir, "start-gateway.bat"), startScriptWin, "utf8");

// Create Unix pair script
const pairScriptUnix = `#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export REMOTE_AGENT_HOST=\${REMOTE_AGENT_HOST:-127.0.0.1}
export REMOTE_AGENT_PORT=\${REMOTE_AGENT_PORT:-17821}

cd "$SCRIPT_DIR"
node -e "
const port = process.env.REMOTE_AGENT_PORT || '17821';
const host = process.env.REMOTE_AGENT_HOST === '0.0.0.0' ? '127.0.0.1' : process.env.REMOTE_AGENT_HOST || '127.0.0.1';
fetch(\\\`http://\\\${host}:\\\${port}/v1/pairing/start\\\`, { method: 'POST' })
  .then(res => res.json())
  .then(body => {
    if (body.data?.code) {
      console.log(\\\`\\\\n配对码: \\\${body.data.code}\\\\n过期时间: \\\${body.data.expiresAt}\\\\n\\\`);
    } else {
      console.error('配对失败:', body.error?.message || '未知错误');
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('无法连接到网关:', err.message);
    process.exit(1);
  });
"
`;

writeFileSync(join(packageDir, "pair.sh"), pairScriptUnix, { mode: 0o755 });

// Create Windows pair script
const pairScriptWin = `@echo off
setlocal

if not defined REMOTE_AGENT_HOST set "REMOTE_AGENT_HOST=127.0.0.1"
if not defined REMOTE_AGENT_PORT set "REMOTE_AGENT_PORT=17821"

cd /d "%~dp0"
node -e "const port = process.env.REMOTE_AGENT_PORT || '17821'; const host = process.env.REMOTE_AGENT_HOST === '0.0.0.0' ? '127.0.0.1' : process.env.REMOTE_AGENT_HOST || '127.0.0.1'; fetch(\`http://\${host}:\${port}/v1/pairing/start\`, { method: 'POST' }).then(res => res.json()).then(body => { if (body.data?.code) { console.log(\`\\n配对码: \${body.data.code}\\n过期时间: \${body.data.expiresAt}\\n\`); } else { console.error('配对失败:', body.error?.message || '未知错误'); process.exit(1); } }).catch(err => { console.error('无法连接到网关:', err.message); process.exit(1); });"
`;

writeFileSync(join(packageDir, "pair.bat"), pairScriptWin, "utf8");

console.log(`✓ Package created: ${packageDir}`);
console.log(`  - dist/ (compiled TypeScript)`);
console.log(`  - package.json & package-lock.json`);
console.log(`  - start-gateway.sh & start-gateway.bat`);
console.log(`  - pair.sh & pair.bat`);
console.log(`  - README.md`);
