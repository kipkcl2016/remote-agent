# Remote Agent 文档中心

> 本目录是产品功能、跨端契约、安全边界和质量验收的文档入口。当前基线日期：**2026-08-10**。

## 从哪里开始

| 任务 | 必读文档 | 文档职责 |
| --- | --- | --- |
| 理解产品现状 | [`product/functional-spec.md`](product/functional-spec.md) | 功能范围、状态、用户流程、业务规则；**功能 SSOT** |
| 改 HTTP、SSE、状态或 Agent adapter | [`reference/protocol-contract.md`](reference/protocol-contract.md) | 枚举、权限映射、API、事件、输入限制；**跨端契约 SSOT** |
| 改模块关系、数据流或持久化 | [`architecture.md`](architecture.md) | 系统边界、组件职责和数据流；**架构 SSOT** |
| 改认证、网络、凭据、目录或进程权限 | [`security.md`](security.md) | 威胁边界、部署要求和上线门槛；**安全 SSOT** |
| 开始任何代码改动或准备交付 | [`quality/change-and-acceptance.md`](quality/change-and-acceptance.md) | 前置检查、影响分析、质量门禁和 DoD；**变更流程 SSOT** |
| 确定某功能应检查什么 | [`quality/feature-matrix.md`](quality/feature-matrix.md) | 功能 ID → 代码 → 测试 → 人工验收的追踪矩阵；**验收覆盖 SSOT** |
| 留存一次变更的验收记录 | [`quality/acceptance-record-template.md`](quality/acceptance-record-template.md) | 可复制的验收记录模板 |
| 查看当前基线结论 | [`quality/acceptance-records/2026-08-10-current-baseline.md`](quality/acceptance-records/2026-08-10-current-baseline.md) | 本次自动化结果、静态核对与未执行限制 |
| 让 AI Agent 修改仓库 | [`../AGENTS.md`](../AGENTS.md) | AI 的硬约束、阅读路由和最低验证命令 |
| 修改移动端设备运行时 | [`../mobile-agent-remote/AGENTS.md`](../mobile-agent-remote/AGENTS.md) | 手机框架、键盘、滚动、手势与受保护文件约束 |

## SSOT 规则

“SSOT”表示某类决策的唯一规范来源，不表示一份文档复制所有细节：

- 产品是否应该有某功能、功能状态和用户可观察行为，以 `product/functional-spec.md` 为准。
- 线上传输字段、枚举、HTTP/SSE 行为和 Agent 权限映射，以 `reference/protocol-contract.md` 为准。
- 安全约束以 `security.md` 为准。其他文档与其冲突时，执行更严格的安全要求并修正文档冲突。
- 组件归属和依赖方向以 `architecture.md` 为准。
- 需要跑什么检查、如何形成验收结论，以 `quality/` 下两份 SSOT 为准。
- TypeScript 类型、测试和运行代码是“当前实现证据”，不是绕过规范的理由。代码与 SSOT 不一致时，先判断是实现缺陷还是已批准的需求变化；不得静默修改文档让缺陷看起来合理。

## 规范用语

- **必须 / 不得**：强制要求，违反即不能验收通过。
- **应 / 应当**：默认要求；偏离时必须记录理由、风险和后续动作。
- **可以**：允许选择，不构成强制行为。

功能状态只有以下四种：

| 状态 | 定义 |
| --- | --- |
| **已实现** | 用户主流程和关键失败路径已有代码，并达到该功能在追踪矩阵中的最低验收要求 |
| **受限实现** | 有可用能力，但平台、入口、协议或异常处理尚不完整；限制必须写明 |
| **界面占位** | 界面或配置已出现，但没有产生宣称中的完整系统行为 |
| **规划中** | 仅为后续方向，不得在 README、演示或 UI 中描述为当前能力 |

## 功能 ID 规则

功能 ID 使用 `<DOMAIN>-<三位序号>`，例如 `SESSION-003`。当前 domain 包括：
`CONN`、`PAIR`、`DEVICE`、`AGENT`、`PERMISSION`、`SESSION`、`STREAM`、`APPROVAL`、
`HISTORY`、`MOBILE`、`SETTING`、`DIST`、`OPS`。

- ID 一经进入功能规格就保持稳定，不因文件移动、重构或文案变化而重编号。
- 已移除功能在变更记录中保留 ID 和移除背景，不把旧 ID 复用于新语义。
- 能独立发布或验收的用户行为应拆成独立 ID；纯实现细节不单独建功能 ID。
- 新 ID 必须同时进入功能规格与 feature matrix；测试名称或相邻注释应引用相应 ID。

## 每次变更的闭环

```mermaid
flowchart LR
  A["选择功能 ID"] --> B["读取对应 SSOT"]
  B --> C["运行变更前基线"]
  C --> D["实现与补测试"]
  D --> E["更新功能状态和追踪矩阵"]
  E --> F["按质量门禁验收"]
  F --> G["记录证据与剩余风险"]
```

完整操作步骤见 [`quality/change-and-acceptance.md`](quality/change-and-acceptance.md)。任何影响用户行为或跨端契约的代码变更，都必须能回答：

1. 影响了哪些功能 ID？
2. 哪一份 SSOT 定义了预期行为？
3. 哪些自动化和人工验收证明它仍然成立？
4. 是否新增了未覆盖风险或受限实现？

## 当前可复现基线

在 2026-08-10 的仓库快照中，以下检查通过：

```bash
cd macos-agent-gateway && npm run verify
cd ../mobile-agent-remote && npm run check:runtime && npm run build && npm run test:sites
npm run test:runtime
```

- 网关：11 项 Node 测试通过，typecheck/build 通过。
- 移动端：11 项 Playwright 测试通过，其中 3 项产品流、8 项运行时交互。
- Sites worker：4 项测试通过。

该数字仅描述基线，不是固定门槛；新增功能和缺陷修复应增加相应测试，不能为了维持数字删除覆盖。
