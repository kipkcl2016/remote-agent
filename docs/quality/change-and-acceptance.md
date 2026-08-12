# 变更前检查与验收规范（质量流程 SSOT）

> 适用于所有代码、配置、依赖、原生工程和用户可见文档变更。目标是让每次变更都能从功能 ID 追踪到规范、实现、测试和交付证据。

## 1. 交付结论

一次变更只能给出以下结论之一：

| 结论 | 定义 |
| --- | --- |
| **PASS** | 目标功能和所有必需门禁通过；没有未披露的规范冲突或高风险缺口 |
| **PASS WITH LIMITATIONS** | 已批准范围完成，但存在无法执行的环境/真机检查或已知受限实现；限制、影响和后续动作已明确 |
| **FAIL** | 实现或任一必需验收不符合 SSOT；不得描述为完成 |
| **BLOCKED** | 缺少必须的权限、设备、外部服务或产品决策，无法形成可信结论 |

“typecheck/build 通过”只能证明编译，不单独构成 PASS。

## 2. 变更前检查（Pre-flight）

### 2.1 明确范围

开始改代码前必须写下：

- 目标：用户或系统最终可观察到什么变化。
- 功能 ID：从 [`feature-matrix.md`](feature-matrix.md) 选择全部受影响 ID；没有合适 ID 时先在功能规格中新增。
- 变更类型：产品 UI、跨端协议、网关、adapter、历史、认证/安全、移动运行时、原生、发布/运维、依赖或纯文档。
- 明确不做：避免顺手扩大范围。
- 风险：认证绕过、目录逃逸、权限放宽、secret 泄漏、进程失控、协议不兼容、数据丢失、移动布局/输入退化。

### 2.2 读取最小必要上下文

| 变更类型 | 必读 |
| --- | --- |
| 任意用户行为 | `product/functional-spec.md` 对应功能 ID + `feature-matrix.md` |
| API/枚举/状态/事件 | `reference/protocol-contract.md` + `architecture.md` |
| 认证、配对、CORS、cwd、token、网络、进程权限 | `security.md` + 协议契约 |
| 移动端任意改动 | 根 `AGENTS.md` + `mobile-agent-remote/AGENTS.md` |
| 移动 runtime/手势/键盘/设备框架 | 再读 `src/mobile/COMPONENTS.md` 和相关 Playwright 测试 |
| launchd/部署 | `macos-agent-gateway/README.md` + `security.md` |

### 2.3 检查工作区和基线

必须先确认：

```bash
git status --short
git diff -- <planned-paths>
```

- 标记哪些改动已存在且属于用户，禁止清理或覆盖无关改动。
- 不读取/展示 `.gateway-dev` 或 `.gateway-e2e` 数据。
- 非纯文档变更应运行与目标范围对应的最小基线测试；如果基线已失败，先记录失败，不得把原有失败归因于当前改动。
- 改依赖前核对两个项目各自的 `package.json`/`package-lock.json`；本仓库没有根 workspace。

### 2.4 先写验收条件

每项验收条件必须是可观察、可复现的陈述，格式建议：

```text
Given <前置状态>
When <用户或系统动作>
Then <可观察结果>
And <关键安全/失败条件>
```

至少包含：主流程、一个输入/权限失败路径、一个状态恢复或边界场景。安全敏感变更还要明确“不应发生什么”。

## 3. 影响分析

使用下表确定同步范围；命中一行即执行该行所有要求。

| 改动触点 | 必查实现 | 必更文档 | 必需验证 |
| --- | --- | --- | --- |
| Agent/permission/status/event 枚举 | 网关 `types/service/http/store`、移动映射、adapter parser | 功能规格 + 协议契约 + feature matrix | 网关 verify + 移动全量测试 |
| HTTP 路由或 payload | `http/service`、移动 request/types、错误处理 | 协议契约 + architecture | 网关集成测试 + 产品流测试 |
| 配对/token/CORS/body/cwd | `config/http/security/store` | security + 协议契约 | security + gateway 集成；补负向测试 |
| CLI 参数或 parser | 三个 adapter、`process.ts`、`protocol.ts` | 权限映射 + 功能状态 | adapter 参数测试 + parser fixture + verify |
| 原生历史格式 | `history.ts`、去重/移动展示 | 功能规格 + 协议契约 | history tests，含越权路径与坏行 |
| 会话 UI/交互 | `Prototype.tsx`、`prototype.css` | 功能规格/状态（行为变化时） | check runtime + build + product-flow + 视觉/交互 |
| 手机 runtime | 受保护文件、runtime lock | 嵌套 AGENTS/COMPONENTS（契约变化时） | runtime tests + iPhone/Pixel 10 视觉验收 |
| SecureCredentials | TS bridge + Swift + Java + 注册 | security + 功能规格 | Web build + 对应原生构建/模拟器/真机 |
| Sites worker/hosting | worker、prepare script、hosting JSON | README/architecture（部署变化时） | build + test:sites |
| launchd | service manager、plist、runtime copy | gateway README + security | unit test；获授权后实际 status/install 验证 |
| 依赖/工具链 | package + lock + 构建配置 | README/AGENTS（命令或要求变化时） | 两个受影响项目的完整门禁 |

## 4. 质量门禁

### G0：规范与追踪

- 所有变更均关联功能 ID。
- 用户可见行为变化已先更新功能规格。
- 跨端契约变化已更新协议契约。
- feature matrix 中实现路径、测试或人工验收已同步。
- 新增的规划/受限/占位能力使用准确状态，不以“按钮存在”标记为已实现。

### G1：网关门禁

适用于任何 `macos-agent-gateway/` 代码或跨端协议变更：

```bash
cd macos-agent-gateway
npm run verify
```

验收结果必须包含 typecheck、测试数量/失败数、build。涉及真实 CLI 行为时，unit test 之外还应在已安装的目标 CLI 上做受控 smoke test，但不得为了测试绕过白名单或权限。

### G2：移动构建与发布门禁

适用于任何 `mobile-agent-remote/` 产品代码、构建或依赖变更：

```bash
cd mobile-agent-remote
npm run check:runtime
npm run build
npm run test:sites
```

必须确认 build 生成：

- `dist/client/index.html`
- `dist/server/index.js`
- `dist/.openai/hosting.json`
- 源 `.openai/hosting.json`

### G3：移动交互门禁

适用于用户流程、会话 UI、请求逻辑、runtime、键盘、sheet、滚动或设备框架变化：

```bash
cd mobile-agent-remote
npm run test:runtime
```

该命令当前同时运行 `product-flow.spec.ts` 与 `mobile-runtime.spec.ts`。用户流程变化必须修改或新增 product-flow 测试；仅依靠 runtime fixture 不足以验收产品功能。

涉及视觉或响应式布局时，还必须人工检查：

- iPhone 与 Pixel 10。
- 未连接、加载中、空列表、错误、运行中、等待确认、完成/失败等受影响状态。
- 键盘打开/关闭、滚动到末尾、sheet 退出、返回列表和小屏安全区。
- 无内容遮挡、跳动、误触发、横向溢出和不可读对比度。

### G4：安全门禁

命中安全边界时必须同时证明：

- 未认证请求仍被拒绝，公开路由集合没有意外扩大。
- 非回环不能生成配对码；配对码一次性/过期/限流成立。
- realpath 后 cwd 仍在 roots 内，符号链接和相似前缀不能逃逸。
- 子进程仍为固定 executable/argv 且 `shell: false`。
- token、配对码、完整 prompt/tool input、本机隐私路径没有新增日志/响应泄漏。
- CORS、body/字段限制、数据库/目录权限没有降低。
- 任何权限放宽都经过显式产品/安全决策，不能伪装为兼容性修复。

### G5：原生门禁

改 Capacitor、Swift、Java、manifest、原生安全存储或网络策略时：

```bash
cd mobile-agent-remote
npm run native:sync
```

随后在对应 Xcode/Android Studio 工程完成构建和至少一个模拟器/真机流程。凭据变更至少验证：首次为空、保存后可读、重启后可读、清除后为空、错误/损坏数据处理、只接受固定 key。没有设备环境时结论最多为 `PASS WITH LIMITATIONS`。

### G6：运维/真实网络门禁

只有任务明确授权时才可安装 launchd、生成真实配对码或启动真实 Agent。相关变更应在受信任私网验证：

- service install/status/restart/uninstall。
- runtime copy 后能找到 Node 和三种 CLI。
- 白名单目录可访问，受保护目录给出 TCC 提示。
- 手机到 Mac 的 HTTPS/私网连接、CORS 与撤销 token。
- 卸载后 SQLite 与日志按合同保留。

公网发布还需完成 `security.md` 的“上线前必须完成”，否则不得给出生产就绪结论。

## 5. 测试设计规范

- 新增或修改验收测试时，在 test 名称中加入功能 ID（例如 `[SESSION-003] creating a session...`）或在相邻注释中标明；已有测试通过 feature matrix 建立映射，可逐步迁移。
- 测试主流程之外，至少覆盖一个负向/边界分支。
- adapter fixture 必须包含：正常 JSON、未知 JSON、非 JSON 文本、错误、终止，以及本次变更相关的 partial/delta/native ID。
- 安全测试断言结果和数据落点，不能只断言函数被调用。
- UI mock 必须遵循真实 `{data}`/`{error}` envelope、状态枚举和限制；不得构造生产协议不存在的方便字段。
- 不允许通过删除断言、`skip`、放宽 runtime lock 或降低输入限制来“修复”测试。
- flaky 测试应修复同步条件；不以无理由增加 sleep 或重复重跑作为验收证据。

## 6. Definition of Done

交付前逐项确认：

- [ ] 目标、非目标和功能 ID 已明确。
- [ ] 实现符合功能、协议、架构和安全 SSOT，没有未解释冲突。
- [ ] 新行为的主流程、失败路径和关键边界有测试或明确人工证据。
- [ ] 按影响范围完成 G0–G6 中所有适用门禁。
- [ ] 功能状态准确；占位/受限实现没有被写成已实现。
- [ ] 文档、README、环境变量和命令与当前代码同步。
- [ ] 没有提交 secret、本地数据库、生成目录或无关用户改动。
- [ ] 未执行的验证、原因、影响和后续动作已记录。
- [ ] 验收记录能让另一位开发者在同一环境复现结论。

## 7. 验收记录要求

使用 [`acceptance-record-template.md`](acceptance-record-template.md) 留存以下信息：

- 变更摘要、日期、分支/commit（若存在）。
- 功能 ID 和功能状态变化。
- 规范变更清单和兼容性判断。
- 实际执行的命令、结果、测试数。
- 人工流程、设备/浏览器/网络环境和证据路径。
- 未执行项、已知限制、回滚方式和最终结论。

记录可放在 PR/MR 描述、任务交付说明或团队指定系统；若写入仓库，建议放 `docs/quality/acceptance-records/YYYY-MM-DD-<topic>.md`。记录不得包含 token、配对码、私有会话正文、未脱敏本机路径或用户数据。

## 8. 不同改动的最低门禁速查

| 改动 | 最低门禁 |
| --- | --- |
| 纯文档 | G0；校验链接、路径、命令和事实 |
| 网关内部重构 | G0 + G1 |
| API/状态/事件 | G0 + G1 + G2 + G3；安全相关再加 G4 |
| 移动 UI/CSS | G0 + G2 + G3 |
| 移动 runtime | G0 + G2 + G3，双设备人工检查 |
| 配对/认证/cwd/进程权限 | G0 + G1 + G4；若影响 UI 再加 G2/G3 |
| 原生凭据/Capacitor | G0 + G2 + G3 + G5 |
| Sites/发布 | G0 + G2；真实部署再加 G6 |
| launchd/网络暴露 | G0 + G1 + G4；获授权后 G6 |
| 依赖升级 | 受影响子项目的全部自动化门禁；安全/原生依赖追加对应门禁 |
