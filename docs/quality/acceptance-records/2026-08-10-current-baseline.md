# 变更验收记录：当前功能与文档基线

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-10 |
| 执行人 | Codex（本地自动化与代码核对） |
| 分支 / commit | `main`，仓库尚无 commit；现有项目文件均为工作区内容 |
| 最终结论 | **PASS WITH LIMITATIONS** |

## 目标与范围

- 目标：从当前实现和测试建立完整功能清单、协议契约、功能追踪矩阵和可复用验收流程。
- 明确不做：不修改产品代码，不安装 launchd，不生成真实配对码，不启动真实 Agent，不运行原生 IDE/真机验收。
- 关联功能 ID：功能规格中的全部 28 项。
- 功能状态变化：首次建立基线；状态按“已实现 / 受限实现 / 界面占位”记录。

## 规范与兼容性

- 新增 SSOT：功能规格、跨端协议契约、变更与验收规范、功能追踪矩阵、验收记录模板。
- 更新入口：根 README、AGENTS、架构和安全文档。
- 协议兼容性：不涉及运行代码变化。
- 安全边界变化：无；新增了当前实时 tool/approval 事件尚未独立脱敏的风险说明。

## 变更前基线

| 命令/检查 | 结果 | 备注 |
| --- | --- | --- |
| `git status --short` | 已检查 | 仓库无 commit，项目文件为既有未跟踪内容；未清理或覆盖无关文件 |
| 网关 verify | PASS | 见下表 |
| 移动 build/tests | PASS | 见下表 |

## 自动化验收

| 门禁 | 命令 | 结果与测试数 |
| --- | --- | --- |
| G0 规范与追踪 | 本地 Markdown 链接、功能 ID、状态和 package script 校验 | PASS；10+ Markdown 文件、28 个功能 ID，未发现断链或缺失映射 |
| G1 网关 | `cd macos-agent-gateway && npm run verify` | PASS；typecheck/build 通过，11/11 tests passed |
| G2 移动构建 | `npm run check:runtime && npm run build && npm run test:sites` | PASS；28 个受保护文件完整，build 通过，4/4 Sites tests passed |
| G3 移动交互 | `npm run test:runtime` | PASS；11/11 Playwright tests passed，其中 3 项产品流、8 项 runtime |
| G4 安全 | 随 G1 运行现有 security/gateway/history tests | PARTIAL；一次性码、cwd、token hash、401、撤销和历史白名单已有自动化，未做真实网络/渗透验证 |
| G5 原生 | 未执行 | 未打开 Xcode/Android Studio，未做模拟器/真机 SecureCredentials 验收 |
| G6 运维/网络 | 未执行 | 未获本任务授权安装 launchd、生成配对码或启动真实 Agent |

## 代码与文档核对结果

- 网关路由、模型、权限映射、状态和事件与 `protocol-contract.md` 逐项核对。
- UI 实际入口、5 秒主同步、850ms 详情轮询、15 秒请求超时、设置行为与功能规格核对。
- 原生凭据的 TypeScript bridge、Swift Keychain、Java Keystore 与插件注册已做静态核对。
- 识别并明确标注：移动端未消费 SSE、无取消 UI、无逐工具审批、通知仅占位、Agent 检测未接 UI、Cursor 消息正文受限。
- 识别并明确标注：已连接后轮询失败不会立即离线、合并会话不是严格按原始时间戳排序、实时 tool/approval payload 尚未独立脱敏。

## 未执行项与剩余风险

- 未执行：真实 Cursor/Claude/Codex CLI 启动、续接、权限写入边界。
- 未执行：iOS/Android 构建、凭据重启持久化、损坏密文、真机安全存储。
- 未执行：launchd 安装/重启/卸载、TCC、手机跨设备 HTTPS/私网连接。
- 未执行：公网 TLS、审计脱敏、依赖漏洞扫描、签名/密钥轮换。
- 自动化缺口：详见 [`../feature-matrix.md`](../feature-matrix.md) 的“当前最高优先级覆盖缺口”。

## 最终结论

结论：**PASS WITH LIMITATIONS**

依据：当前代码的编译、网关测试、移动产品流、移动 runtime 和 Sites 打包全部通过，功能与契约已建立 28 项可追踪基线；但真实 CLI、原生设备和运维网络没有在本次文档任务中执行，不能据此给出生产就绪或完整端到端 PASS。
