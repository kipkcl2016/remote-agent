# Windows 网关自启动与代码签名规划

> **文档性质**：运维与发布规划（非生产脚本 SSOT）。  
> **适用范围**：v0.1.0 及之后发布的 `remote-agent-gateway-Windows.zip` 解压目录布局（含 `start-gateway.bat`、`pair.bat`、`dist/`、`package.json`）。  
> **关联 SSOT**：安全边界见 [`security.md`](../security.md)；macOS launchd 见 [`macos-agent-gateway/README.md`](../../macos-agent-gateway/README.md)。

## 目标与范围

Remote Agent 网关在 macOS 上可通过 `npm run service:install` 安装 **LaunchAgent** 实现登录后后台运行。Windows 无等价的一键命令（`service-manager.ts` 在 win32 上明确拒绝安装）。本规划说明：

1. Windows 上实现「开机/登录自启动 + 后台运行」的可选方案及推荐默认；
2. 未来对网关安装包/可执行文件进行 **Authenticode**（Windows）与 **Developer ID + 公证**（macOS）时的概念、成本区间与 CI 改造要点；
3. 分阶段交付清单（**不**在本阶段购买证书、不提交私钥、不实现签名流水线）。

---

## 1. Windows 自启动方案对比

### 1.1 方案概览

| 维度 | 任务计划程序（Task Scheduler） | NSSM（Non-Sucking Service Manager） | 自研 / 第三方 Windows Service 包装 |
| --- | --- | --- | --- |
| **本质** | 在用户或系统上下文中按计划触发进程 | 将任意控制台程序注册为 SCM Windows 服务 | 用 .NET/C++ 等实现 `ServiceBase`，或 Node 专用包装（如 `node-windows`） |
| **与现有 bat 的契合** | 高：可直接调用 `start-gateway.bat` 或 `node dist\index.js` | 高：NSSM 指向 `node.exe` + 参数，或包装 `.bat`（不推荐长期） | 中：需维护安装器/服务代码与升级路径 |
| **登录前启动** | 可（需 SYSTEM/最高权限任务） | 是（服务可在无用户登录时运行） | 是 |
| **用户登录后启动** | 是（推荐：当前用户、触发器「登录时」） | 可配置为自动启动服务 | 是 |
| **日志与重启** | 有限；需额外重定向 stdout/stderr | 内置 stdout/stderr 轮转、失败重启策略 | 取决于实现 |
| **卸载/升级** | 删除任务即可 | `nssm remove` + 删除文件 | 需自定义卸载逻辑 |
| **权限模型** | 任务可指定「仅以某用户运行」 | 服务默认 **Local System** 或指定服务账户 | 可配置 |
| **运维复杂度** | 低（系统自带） | 中（需分发 NSSM 或文档说明下载） | 高 |
| **与网关安全模型** | 易对齐「当前开发者用户 + 127.0.0.1」 | 易误配为 SYSTEM + `0.0.0.0` | 同左 |

### 1.2 推荐默认（Remote Agent Windows 网关）

**默认推荐：任务计划程序 + 当前登录用户 +「用户登录时」触发**，原因如下：

1. **最小权限**：网关读写 `REMOTE_AGENT_DATA_DIR`（默认 `%USERPROFILE%\.remote-agent`）、访问 Cursor/Claude/Codex 历史路径，均假设为**交互用户**身份；以 SYSTEM 运行常导致历史目录、TCC/企业策略路径不可见或行为异常。
2. **与 v0.1.0 行为一致**：官方包仍默认 `REMOTE_AGENT_HOST=127.0.0.1`；跨设备场景再显式改为 `0.0.0.0` 并配合私网/TLS（见 [`security.md`](../security.md)），与 macOS launchd 内测服务「监听 0.0.0.0」的取舍相同，但**不应**因选 SYSTEM 而扩大暴露面。
3. **配对码流程**：`pair.bat` 依赖本机回环访问 `/v1/pairing/start`；服务化后仍需用户在登录会话中手动运行 `pair.bat`（与 macOS 本机 `npm run pair` 一致）。
4. **NSSM 适用场景**：需要「用户未登录也保持网关运行」或「统一用服务管理器监控重启」时选用；必须显式配置 **服务账户 = 目标用户**、环境变量、工作目录，并避免 Local System。

**不推荐默认**：将网关注册为 **Local System** 且监听 `0.0.0.0` 直接面向局域网——违背「默认回环、显式扩网」的安全 SSOT。

### 1.3 与 `start-gateway.bat` / `pair.bat` 对齐的示例

解压后的目录结构（与 `macos-agent-gateway/scripts/package.mjs` 生成物一致）：

```text
remote-agent-gateway\
  dist\index.js
  start-gateway.bat
  pair.bat
  package.json
  node_modules\   （npm install --production 之后）
```

#### 环境变量（与 bat 一致）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `REMOTE_AGENT_ROOTS` | （必填，由 bat 参数设置） | Windows 上多个根目录由 bat 以空格拼接；服务化时建议改为**分号**分隔的绝对路径，与 [`package.mjs`](../../macos-agent-gateway/scripts/package.mjs) README 一致 |
| `REMOTE_AGENT_HOST` | `127.0.0.1` | 仅本机；手机联调改为 `0.0.0.0` 时需私网/TLS |
| `REMOTE_AGENT_PORT` | `17821` | 与移动端配置一致 |
| `REMOTE_AGENT_DATA_DIR` | `%USERPROFILE%\.remote-agent` | SQLite 与令牌哈希 |

#### 手动前台启动（基线）

```cmd
cd /d C:\path\to\remote-agent-gateway
npm install --production
start-gateway.bat C:\Users\me\Projects
REM 另一终端
pair.bat
```

#### 任务计划程序（推荐路径）

仓库提供**非生产**示例脚本（需按本机路径修改）：

- [`stubs/register-logon-task.example.ps1`](stubs/register-logon-task.example.ps1) — 登录时以当前用户运行 `node dist\index.js`
- [`stubs/unregister-logon-task.example.ps1`](stubs/unregister-logon-task.example.ps1) — 删除任务

PowerShell 要点（与示例一致）：

```powershell
# 示意：工作目录 = 网关根目录；ROOTS 用分号
$GatewayRoot = "C:\Tools\remote-agent-gateway"
$roots = "C:\Users\me\Projects"
$action = New-ScheduledTaskAction -Execute "node.exe" `
  -Argument "dist\index.js" -WorkingDirectory $GatewayRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "RemoteAgentGateway" -Action $action -Trigger $trigger `
  -Settings $settings -RunLevel Limited `
  -Description "Remote Agent gateway (user logon); NOT production SSOT"
```

注册前在目标目录执行一次 `npm install --production`，并确认 `node` 在 PATH 中（或使用 `where.exe node` 得到的绝对路径作为 `-Execute`）。

#### NSSM（备选）

示例：[`stubs/nssm-install.example.cmd`](stubs/nssm-install.example.cmd)（**非生产**，需自备 [NSSM](https://nssm.cc/) 可执行文件）。

核心命令形态：

```cmd
nssm install RemoteAgentGateway "C:\Program Files\nodejs\node.exe" "dist\index.js"
nssm set RemoteAgentGateway AppDirectory "C:\Tools\remote-agent-gateway"
nssm set RemoteAgentGateway AppEnvironmentExtra "REMOTE_AGENT_ROOTS=C:\Users\me\Projects" "REMOTE_AGENT_HOST=127.0.0.1" "REMOTE_AGENT_PORT=17821"
nssm set RemoteAgentGateway ObjectName ".\YourUser" "YourPassword"
nssm set RemoteAgentGateway AppStdout "C:\Tools\remote-agent-gateway\logs\stdout.log"
nssm set RemoteAgentGateway AppStderr "C:\Tools\remote-agent-gateway\logs\stderr.log"
nssm start RemoteAgentGateway
```

**安全注意**：`ObjectName` 应为目标**人类用户**，而非 `LocalSystem`；密码存入服务配置有泄露面，企业环境优先 gMSA 或任务计划「仅以用户身份运行、不存储密码（组策略允许时）」。

#### Windows Service 包装（Phase B+ 产品化方向）

若未来提供官方「Windows 服务安装器」，更可能采用：

- 安装程序将运行时复制到 `%LOCALAPPDATA%\RemoteAgent\runtime`（对齐 macOS `~/.remote-agent/runtime` 思路）；
- 服务入口为固定 `node.exe` + `index.js`，由 MSI/脚本注册 SCM；
- 与 `OPS-002`（规划）类功能 ID 挂钩，见下文阶段清单。

当前 **不** 实现该安装器，仅保留架构选项。

### 1.4 安全与最小权限清单

| 主题 | 建议 |
| --- | --- |
| **运行身份** | 优先 **当前开发者 Windows 用户**；避免 Local System 访问用户目录下的 Cursor/Claude 配置 |
| **网络监听** | 默认保持 `127.0.0.1`；仅在内测私网需要时设 `0.0.0.0`，且不得直连公网 HTTP |
| **凭据与数据** | `REMOTE_AGENT_DATA_DIR` 仅该用户可读写；不要把含设备令牌的目录放到共享盘 |
| **配对** | 配对码仍只在**本机**生成；自动化任务不得把配对码写入计划任务参数或日志 |
| **Node 路径** | 固定使用受信任来源安装的 Node（官方安装包或版本管理器），避免全局可被篡改的 `node` 替身 |
| **升级** | 自启动任务应在升级 zip 后重启任务/服务；文档化「先 stop → 替换文件 → npm install → start」 |

更完整的威胁与部署边界见 [`security.md`](../security.md)。

---

## 2. 代码签名与公证（规划）

> **声明**：本节为发布工程规划。**不在仓库中存储证书、私钥或签名口令**；价格区间为公开渠道常见报价的**量级参考**，采购前以 CA/Apple 官网为准。

### 2.1 Windows Authenticode

| 项目 | 说明 |
| --- | --- |
| **签名对象** | 未来可能对 `remote-agent-gateway-Windows.zip` 内的 `node` 包装 exe、官方安装 MSI、或捆绑的 `nssm.exe` / 自研 launcher 进行签名 |
| **标准（OV/Organization）代码签名** | 验证组织身份；SmartScreen 仍可能对新文件显示「未知发布者」，随下载量与时间积累 **声誉（reputation）** |
| **EV（扩展验证）代码签名** | 更高审查级别，通常绑定硬件令牌；**新文件**上 SmartScreen 警告往往更少、声誉建立更快（仍非绝对） |
| **价格量级（公开信息，约 2025–2026）** | 标准代码签名证书约 **USD 200–500/年**（如 Sectigo、SSL.com 等经销商）；EV 约 **USD 400–900/年** 且含令牌硬件；具体以 CA 报价为准 |
| **SmartScreen** | 依赖证书类型、文件哈希声誉、下载规模；签名**不能**替代安全开发，仅降低误报与篡改风险 |
| **时间戳** | 签名时应加 RFC 3161 时间戳，避免证书过期后签名失效 |

**与本仓库制品的关系（当前）**：v0.1.0 zip 为 **未签名** 的 Node 脚本包；用户运行 `node dist\index.js`，无单独签名的 exe。Phase B/C 若引入 launcher/installer，签名目标应首先在 CI 文档中列清单（见 2.3）。

### 2.2 macOS Developer ID 与公证（Notarization）

| 项目 | 说明 |
| --- | --- |
| **Apple Developer Program** | 约 **USD 99/年**（公开定价），用于 Developer ID Application 证书 |
| **Developer ID** | 对 `.app`、`.pkg`、命令行工具等签名，标识团队 |
| **公证（notarytool）** | 上传 Apple 扫描；通过后 staple ticket，Gatekeeper 在离线环境更顺畅 |
| **当前制品** | `remote-agent-gateway-macOS.tar.gz` 为脚本 + `dist/`，**未**公证；用户通过 `start-gateway.sh` 运行 Node |
| **未来** | 若发布 `.pkg` 安装 launchd 服务或捆绑 Node 运行时，需对**所有原生二进制**签名并公证（含任何嵌入的 `node`） |

macOS 后台服务与 TCC（完全磁盘访问等）行为仍以 [`security.md`](../security.md) 与 gateway README 为准；签名不解决 TCC，只解决 Gatekeeper 分发摩擦。

### 2.3 CI 改造要点（不写 secrets 进仓库）

现有工作流： [`.github/workflows/release-artifacts.yml`](../../.github/workflows/release-artifacts.yml) — 在 macOS/Windows 上 `npm ci` → test → build → `npm run package` → 上传 artifact。

| 阶段 | 建议增加的 CI 概念步骤 | Secrets / 变量（仅 GitHub 配置） |
| --- | --- | --- |
| **Phase B**（无签名） | 构建 **unsigned** MSI/zip 安装脚本；校验产物目录含 `start-gateway.bat`；可选 smoke：解压后 dry-run `node -e "require('./dist/...')"` | 无 |
| **Phase C**（Windows 签名） | 在 Windows runner 或签名专用 runner 上：`signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 ...`；对 zip 内 exe/msi 签名后再打包 | `WINDOWS_CERT_PFX_BASE64` 或 Key Vault 引用、`WINDOWS_CERT_PASSWORD`、`SIGNTOOL_PATH`（若非默认） |
| **Phase C**（macOS 签名+公证） | `codesign --sign "Developer ID Application: ..."` → `xcrun notarytool submit` → `xcrun stapler staple`；再 `tar czf` | `APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 或 `notarytool` API Key（`ASC_KEY` 等）、证书 via `BUILD_CERTIFICATE_BASE64` + `P12_PASSWORD` |
| **通用** | 签名失败则 job 失败；**不上传**私钥到 artifact；发布 job 与 PR 构建分离（仅 `release/**` tag） | 使用 Environment protection + OIDC（若迁移 Azure Key Vault / Apple 官方推荐流程） |

文档与 workflow 中只描述 **变量名称与步骤顺序**；证书申请与 secret 录入由维护者在本机或 GitHub Settings 完成。

---

## 3. 分阶段交付清单

建议新增/扩展功能追踪 ID（与 [`docs/README.md`](../README.md) 中 `OPS` 域一致）：

| ID | 名称 | 阶段 |
| --- | --- | --- |
| `OPS-001` | macOS launchd 服务 | 已实现 |
| `OPS-002` | Windows 自启动文档与可选脚本 | Phase A |
| `OPS-003` | Windows 未签名服务/安装器 CI 制品 | Phase B |
| `OPS-004` | 正式代码签名与公证发布 | Phase C |

### Phase A — 脚本与文档（本 PR 范围）

| 交付物 | 说明 |
| --- | --- |
| 本文档 | 方案对比、推荐默认、安全注记 |
| `docs/ops/stubs/*` | 明确标注 **NON-PRODUCTION** 的示例脚本 |
| 链接 | `security.md`、`RELEASE_NOTES.md`、`docs/README.md` |

**成功标准**

- [ ] 维护者能仅凭文档在 Windows 10/11 上用任务计划实现登录自启动（127.0.0.1 + 用户上下文）。
- [ ] 文档明确说明 NSSM / SYSTEM 的风险与适用场景。
- [ ] 无私钥、无真实证书、无生产 SSOT 脚本路径写死在代码库中。

### Phase B — CI 未签名安装器/服务包

| 交付物 | 说明 |
| --- | --- |
| 可选 WiX/MSI 或 PowerShell 安装模块 | 注册计划任务或 SCM 服务（仍 unsigned） |
| CI job | `release/**` 附加 artifact `remote-agent-gateway-Windows-setup-unsigned.zip` |
| 文档 | 安装、升级、卸载章节 |

**成功标准**

- [ ] 干净 VM 上一键安装后网关可访问 `127.0.0.1:17821`。
- [ ] `pair.bat` 在登录用户会话中可生成配对码。
- [ ] 卸载不残留监听进程；SQLite 默认保留在 `%USERPROFILE%\.remote-agent`（与 macOS uninstall 行为对齐）。
- [ ] CI 无 secrets 泄露；PR 构建仅产出与现网相同的 unsigned zip 或明确标记的 unsigned setup。

### Phase C — 付费签名与正式分发

| 交付物 | 说明 |
| --- | --- |
| 采购 EV/OV 证书与 Apple Developer ID | 组织流程，不在仓库 |
| 签名流水线 | 按 2.3 接入 secrets |
| macOS `.pkg`（若需要） | 公证 + staple |
| 发布说明 | SmartScreen/Gatekeeper 用户指引 |

**成功标准**

- [ ] Windows：签名的安装包或 launcher 在 Virustotal/Defender 抽样下无篡改告警；新用户 SmartScreen 体验可接受（维护者记录实测截图）。
- [ ] macOS：Gatekeeper 默认策略下双击安装不阻断（或仅标准「来自互联网」一次确认）。
- [ ] 证书轮换与过期前 30 天告警 documented。
- [ ] [`security.md`](../security.md)「上线前必须完成」中签名项可勾选。

---

## 4. 参考链接

- NSSM：https://nssm.cc/
- Microsoft Task Scheduler：https://learn.microsoft.com/windows/win32/taskschd/task-scheduler-start-page
- SignTool：https://learn.microsoft.com/windows/win32/seccrypto/signtool
- Apple Notarization：https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- 仓库发布说明：[`RELEASE_NOTES.md`](../../RELEASE_NOTES.md)
- v0.1.0 Windows 限制摘要：[`RELEASE_NOTES.md#windows-平台`](../../RELEASE_NOTES.md)

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-10-09 | 初版：Windows 自启动与签名分阶段规划（文档 + 非生产 stubs） |
