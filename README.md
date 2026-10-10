# Remote Agent

在地铁上点一下手机，家里的 Mac 就把活干完了——代码不经过任何第三方服务器。  
Tap your phone on the subway; the Mac at home finishes the job—your code never touches a third-party server.

[![Build Release Artifacts](https://github.com/kipkcl2016/remote-agent/actions/workflows/release-artifacts.yml/badge.svg)](https://github.com/kipkcl2016/remote-agent/actions/workflows/release-artifacts.yml)

**Mac 上跑着 Cursor / Claude Code / Codex，人却不在电脑前——你想用手机遥控，又不想把代码打到公网中继。**  
**Your Mac runs coding agents while you're away. You want phone control—without shipping your repo through a public relay.**

**Remote Agent = 本机 macOS/Windows 网关 + 手机控制台。** 配对后在统一界面浏览会话、按项目开任务、看额度摘要；执行仍在你的电脑上，路径受白名单约束。  
**Remote Agent = a local macOS/Windows gateway + mobile console.** Pair once, then browse sessions, start tasks by project, and check usage—while agents keep running on your machine under a cwd whitelist.

<p align="center">
  <img src="docs/product/screenshots/sessions-projects.png" alt="项目会话列表" width="180" />
  <img src="docs/product/screenshots/recent-sessions.png" alt="最近会话" width="180" />
  <img src="docs/product/screenshots/new-session.png" alt="发起新会话" width="180" />
</p>

完整功能说明见 [docs/product/feature-guide.md](docs/product/feature-guide.md)。  
Full feature guide: [docs/product/feature-guide.md](docs/product/feature-guide.md).

---

## 和同类方案怎么选 / How it compares

Cursor 官方 Remote Control 只遥控 Cursor；我们覆盖 Cursor · Claude Code · Codex 三个 CLI，且代码默认不经过第三方服务器。

- **多 CLI 统一手机 UI**：Cursor · Claude Code · Codex  
- **默认无公网中继**：流量走你的私网 / Tailscale  
- **可自托管**：本机网关 + 开源协议  
- **Multi-CLI in one phone UI** · **no public relay by default** · **self-host**

---

## Early Access

开源协议下可免费自建与修改。若想跟进后续包装版 / 菜谱 / 支持渠道，请 Watch [Releases](https://github.com/kipkcl2016/remote-agent/releases)，或在 Issues / Discussions 留下邮箱。  
OSS is free to self-host. For packaged builds, recipes, and support updates: watch [Releases](https://github.com/kipkcl2016/remote-agent/releases), or leave an email via Issues / Discussions.

---

## 本机联调 / Local quickstart

**五分钟快乐路径：** 开三个终端——网关 → 配对码 → 手机 Web；在「设备」页填入地址和 6 位码，就能在浏览器里列出会话并开任务。同机联调用 `http://127.0.0.1:17821`。  
**5-minute happy path:** three terminals—gateway → pair code → mobile web; enter the URL and 6-digit code on the Devices page, then browse sessions and start tasks. Same-machine: `http://127.0.0.1:17821`.

终端 1 — 启动网关：

```bash
cd macos-agent-gateway
npm install
REMOTE_AGENT_ROOTS=/absolute/path/to/projects npm run dev
```

终端 2 — 生成一次性配对码：

```bash
cd macos-agent-gateway
npm run pair
```

终端 3 — 启动移动端原型：

```bash
cd mobile-agent-remote
npm install
npm run dev -- --port 4173
```

在移动端「设备」页填写网关地址和终端 2 的 6 位配对码。浏览器与网关同机时用 `http://127.0.0.1:17821`。

真实手机访问不了 Mac 的 `127.0.0.1`。跨设备请先读 [安全部署说明](docs/security.md)，使用 **Tailscale / 受信任私网** 或 HTTPS 反向代理；**不要**直接把 HTTP 网关暴露到公网。

### 安全边界 / Security boundary

- 工作目录白名单（`REMOTE_AGENT_ROOTS`）；符号链接逃逸会被拒绝  
- 一次性 6 位配对码 → 设备令牌；原生端进 Keychain / Keystore  
- **推荐 Tailscale 或受信任私网 + HTTPS**；**不要**把明文 HTTP 网关直接暴露到公网  
- Whitelist cwd · one-shot pairing codes · device tokens · prefer Tailscale/private net + HTTPS — do **not** expose plain HTTP to the public internet

---

## Windows 网关使用

Windows 可从 CI Artifacts 下载预打包网关：

1. 从 GitHub Actions 下载 `remote-agent-gateway-Windows.zip`（或含登录自启动脚本的 `remote-agent-gateway-Windows-setup-unsigned.zip`），解压
2. 在解压目录运行 `npm install --production`
3. 用 `start-gateway.bat C:\path\to\your\projects` 启动（前台）
4. 另一终端运行 `pair.bat` 生成配对码

**登录自启动（未签名，OPS-003）**：

```cmd
cd C:\path\to\remote-agent-gateway
npm install --production
powershell -ExecutionPolicy Bypass -File install-logon-task.ps1 -ProjectRoot C:\Users\me\Projects
REM 配对仍需手动：pair.bat
powershell -ExecutionPolicy Bypass -File uninstall-logon-task.ps1
```

默认以当前 Windows 用户登录时跑计划任务，监听 `127.0.0.1:17821`。详见 [docs/ops/windows-service-and-signing.md](docs/ops/windows-service-and-signing.md)。

- macOS `service:install`（launchd）在 Windows 不可用；默认用本包任务计划脚本，[NSSM](https://nssm.cc/) 仅备选
- 当前构建未经 Authenticode 签名，SmartScreen 可能警告；正式签名见运维文档 Phase C
- Windows 默认历史路径：Cursor `%APPDATA%\Cursor` · Claude `%USERPROFILE%\.claude` · Codex `%USERPROFILE%\.codex`

---

## 原生内测 / Native beta

```bash
cd mobile-agent-remote
npm run native:sync
npm run native:ios       # Xcode 中签名并运行 iOS
npm run native:android   # Android Studio 中签名并运行 Android
```

iOS 令牌保存在 Keychain；Android 用 Keystore AES/GCM 加密后存应用私有 SharedPreferences。局域网 HTTP 仅用于内部测试；公网必须 HTTPS。

在 Mac 安装登录后台服务：

```bash
cd macos-agent-gateway
npm run service:install -- /absolute/path/to/allowed/project
```

若项目在 `Desktop` / `Documents` / `Downloads`，请按安装提示给 Node 开「完全磁盘访问权限」，或把项目放到 `~/Projects`。

---

## 验证 / Verify

```bash
cd macos-agent-gateway && npm run typecheck && npm test && npm run build
cd ../mobile-agent-remote && npm run check:runtime && npm run build && npm run test:sites && npm run test:runtime
cd ../mobile-agent-remote && npm run test:ios:simulator
```

`test:ios:simulator` 会启动仅监听 `127.0.0.1` 的临时双网关 fixture，并在最新可用 iPhone Simulator 上验证配对、会话、缓存和多 Mac 流程。可用 `IOS_SIMULATOR_DESTINATION` 指定 destination。构建包与截图属本地验收证据，不随源码发布。

覆盖要求见 [`docs/quality/feature-matrix.md`](docs/quality/feature-matrix.md)。

贡献与仓库布局见 [CONTRIBUTING.md](CONTRIBUTING.md)。
