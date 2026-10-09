# Remote Agent

[![Build Release Artifacts](https://github.com/kipkcl2016/remote-agent/actions/workflows/release-artifacts.yml/badge.svg)](https://github.com/kipkcl2016/remote-agent/actions/workflows/release-artifacts.yml)

Remote Agent 是一个移动端控制台 + macOS 本地网关，用统一界面操作 Cursor Agent、Claude Code 和 Codex。当前 MVP 支持：

- 一次性 6 位配对码与设备令牌认证
- 安全保存多个 Mac 连接、默认恢复上次连接，并在设备页切换或移除
- 网关检测 Mac 上安装的三个 Agent CLI（移动端尚未展示检测结果）
- 浏览网关会话与 Claude/Codex 原生历史消息；Cursor 优先对齐 IDE composer 标题，白名单内 Glass/composer 可续接
- 按项目浏览会话；新建会话可下拉选择已有项目，并选择受限执行 / 自动执行 / 完全允许
- Agent Tab 内额度摘要（Cursor Dashboard / Claude·Codex API模式等）
- 发起新会话与续聊；网关提供取消和 SSE，移动端尚未接入对应入口/传输
- 工作目录白名单与 `plan / ask / auto / full` 权限模式
- Capacitor iOS/Android 原生工程与系统安全凭据存储
- 已授权移动设备列表、服务端撤销与 macOS launchd 后台服务

完整功能说明见 [docs/product/feature-guide.md](docs/product/feature-guide.md)。

## 目录

- `mobile-agent-remote/`：移动端 Web UI 与 Capacitor iOS/Android 原生工程
- `macos-agent-gateway/`：运行在 Mac 上的本地 TypeScript 网关
- `docs/README.md`：产品、协议、安全与验收文档总入口
- `docs/product/feature-guide.md`：面向使用/验收的完整功能说明（与现网对齐）
- `docs/product/functional-spec.md`：当前功能状态、用户流程与业务规则 SSOT
- `docs/reference/protocol-contract.md`：HTTP/SSE、状态、事件与权限映射 SSOT
- `docs/quality/`：代码改动前置检查、功能追踪矩阵与验收记录模板
- `docs/architecture.md`：架构、统一协议与数据流
- `docs/security.md`：安全边界、部署要求与已知限制

开始开发前先从 [文档中心](docs/README.md) 选择受影响的功能 ID，并按
[变更前检查与验收规范](docs/quality/change-and-acceptance.md) 完成对应门禁。用户可读说明以
[功能说明](docs/product/feature-guide.md) 为准，功能状态以
[功能规格](docs/product/functional-spec.md) 为准，跨端字段和状态以
[协议契约](docs/reference/protocol-contract.md) 为准。

## 本机联调

终端 1：

```bash
cd macos-agent-gateway
npm install
REMOTE_AGENT_ROOTS=/absolute/path/to/projects npm run dev
```

终端 2：

```bash
cd macos-agent-gateway
npm run pair
```

终端 3：

```bash
cd mobile-agent-remote
npm install
npm run dev -- --port 4173
```

在移动端原型的“设备”页填写网关地址和终端 2 显示的一次性配对码。浏览器与网关都在同一台 Mac 时，地址使用 `http://127.0.0.1:17821`。

真实手机不能访问 Mac 的 `127.0.0.1`。跨设备联调请先阅读 [安全部署说明](docs/security.md)，使用受信任的私有网络或 HTTPS 反向代理；不要直接把 HTTP 网关暴露到公网。

## Windows 网关使用

Windows 平台可从 CI Artifacts 下载预打包的网关压缩包：

1. **下载与解压**：从 GitHub Actions 运行记录中下载 `remote-agent-gateway-Windows.zip`，解压到任意目录
2. **安装依赖**：在解压目录运行 `npm install --production`
3. **启动网关**：使用 `start-gateway.bat C:\path\to\your\projects` 启动网关
4. **生成配对码**：在另一个终端运行 `pair.bat`

**Windows 特有说明**：

- launchd 是 macOS 专用功能，Windows 无法使用 `service:install` 命令
- 如需开机自启动，可使用 Windows 任务计划程序或 [NSSM](https://nssm.cc/) 将网关封装为系统服务
- 当前构建未经代码签名，首次运行可能触发 Windows Defender SmartScreen 警告，选择"仍要运行"即可
- Windows 默认历史路径：
  - Cursor: `%APPDATA%\Cursor`
  - Claude: `%USERPROFILE%\.claude`
  - Codex: `%USERPROFILE%\.codex`

## 原生内测

```bash
cd mobile-agent-remote
npm run native:sync
npm run native:ios       # Xcode 中签名并运行 iOS
npm run native:android   # Android Studio 中签名并运行 Android
```

iOS 令牌保存在 Keychain，Android 令牌用 Android Keystore 的 AES/GCM 密钥加密后存入应用私有
SharedPreferences。局域网 HTTP 仅用于内部测试；公网部署必须使用 HTTPS。

在 Mac 安装登录后台服务：

```bash
cd macos-agent-gateway
npm run service:install -- /absolute/path/to/allowed/project
```

如果项目在 macOS 的 `Desktop`、`Documents` 或 `Downloads`，需要按安装时提示给 Node 开启
“完全磁盘访问权限”，或者把项目迁移到 `~/Projects`。

## 验证

```bash
cd macos-agent-gateway && npm run typecheck && npm test && npm run build
cd ../mobile-agent-remote && npm run check:runtime && npm run build && npm run test:sites && npm run test:runtime
cd ../mobile-agent-remote && npm run test:ios:simulator
```

`test:ios:simulator` 会启动仅监听 `127.0.0.1` 的临时双网关 fixture，并通过共享 Xcode scheme
在最新可用 iPhone Simulator 上验证原生配对、会话、缓存和多 Mac 流程。可用
`IOS_SIMULATOR_DESTINATION` 指定其他 Xcode destination；指定 iPad destination 后会额外运行
iPad 横竖屏自适应覆盖。构建包、截图和 Xcode 结果包属于本地验收证据，不随源码发布；需要时可按上述命令在本地重新生成。

不同改动范围需要的自动化、人工检查和证据要求见
[`docs/quality/feature-matrix.md`](docs/quality/feature-matrix.md)。
