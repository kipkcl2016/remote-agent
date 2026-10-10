# ACP Phase 0 调研结论（Issue #1）

> 状态：Phase 0 闭环文档；**Phase 1 Claude PoC + 手机 approval resolve 已在代码落地（见 APPROVAL-001）**  
> 基线日期：2026-10-09（实现跟进：2026-10-10）  
> 关联：[GitHub Issue #1](https://github.com/kipkcl2016/remote-agent/issues/1)、[`functional-spec.md` §7](../product/functional-spec.md#7-已知缺口与演进顺序)、[`architecture.md`](../architecture.md)、[`security.md`](../security.md)

## 0. 术语澄清

| 名称 | 含义 |
| --- | --- |
| **开放标准 ACP** | [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol)：编辑器/客户端与编码 Agent 之间的 **stdio + JSON-RPC** 契约（Zed + JetBrains 等共建）。 |
| **`~/.cursor/acp-sessions`** | Cursor **旧本地存储目录名**，与开放标准 ACP **无关**（见 [`security.md`](../security.md)）。 |
| **Remote Agent 目标** | macOS Gateway 作为 **ACP Client**，子进程为各 Agent 的 **ACP Server**（或官方 ACP 适配器），手机仍只走现有 HTTP/SSE，不直接握 ACP。 |

```text
手机 ── HTTP/SSE/配对/白名单 ──▶ macOS Gateway（未来：ACP Client）
                                      │ stdio JSON-RPC（NDJSON）
                                      ▼
                            Agent 子进程（ACP Server / 官方 adapter）
```

## 1. Phase 0 检查清单

### 1.1 目标 Agent 的 ACP 支持与启用方式

稳定 **线协议版本为 `1`**（`initialize` 时通过 `protocolVersion` 协商）；仓库同时维护 **v2 草案**，生产集成应锁定 v1，直至 v2 稳定。（来源：[ACP README — Versioning](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/README.md)）

| Agent | ACP 形态 | 典型启动命令 | 如何启用 | 成熟度与备注 |
| --- | --- | --- | --- | --- |
| **Cursor** | CLI **原生 ACP Server** | `agent acp` 或 `cursor-agent acp`（安装路径因发行渠道而异） | 需已安装 Cursor CLI；可先 `agent login` / `CURSOR_API_KEY` 等完成鉴权后再启动 ACP（见 [Cursor CLI — ACP](https://cursor.com/docs/cli/acp)） | **官方一等支持**；NDJSON over stdio；模式 `agent` / `plan` / `ask`；工具审批走 `session/request_permission`。另有 **Cursor 扩展方法**（如阻塞式 `cursor/ask_question`、`cursor/create_plan`），Client 必须回复 JSON-RPC 响应，否则 Agent 会卡住。 |
| **Claude Code** | 经 **官方 npm 适配器**（Claude Agent SDK） | `npx -y @agentclientprotocol/claude-agent-acp` | 本机需可用的 Claude Code / Agent SDK 环境与登录态；JetBrains 注册表与 [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) 文档 | **官方维护适配器**；权限展示与 [AIR permission extension](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/docs/air-extensions.md) 较完整，利于后续手机审批。子 Agent 需能力协商。 |
| **Codex** | 经 **官方 npm 适配器**（内部桥接 Codex App Server） | `npx -y @agentclientprotocol/codex-acp` | ChatGPT 登录 / API Key / 网关鉴权（`CODEX_API_KEY` 等）；无头服务可设 `NO_BROWSER=1`（见 [codex-acp README](https://github.com/agentclientprotocol/codex-acp)） | **官方维护适配器**；`INITIAL_AGENT_MODE` 等环境变量与沙箱模式对齐；与本仓库现有 **Codex app-server JSON-RPC**（历史/额度）概念相近，但 **会话执行路径仍是另一套长连接**。 |
| **其他（PoC 外）** | 各异 | 见 [ACP Agents 列表](https://agentclientprotocol.com/overview/agents) | Gemini：`gemini --acp`；Copilot：`copilot --acp --stdio`；OpenCode、Kimi 等 | 产品当前枚举仅 `cursor \| claude \| codex`；Phase 2 前不纳入网关契约。 |

**JetBrains / IntelliJ 侧参考**：IDE 作为 ACP Client，通过 `acp.json` 的 `agent_servers` 拉起子进程（`command` + `args` + `env`），与 Remote Agent「网关拉起 Agent 子进程」模式同构。（[JetBrains — ACP in AI Assistant](https://www.jetbrains.com/help/ai-assistant/acp.html)）

### 1.2 `@agentclientprotocol/sdk` 在 Node 网关中的可行性

| 维度 | 结论 |
| --- | --- |
| **运行时** | 网关已要求 **Node ≥ 22.13**（`macos-agent-gateway/package.json`），满足官方 TypeScript SDK 的 Node 场景；传输为 **stdio + 换行分隔 JSON**（与 Cursor 文档一致）。 |
| **包与版本** | npm 包 [`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk) 当前主线 **1.x**（示例：1.7.0）；**peer：`zod` ^3.25 \|\| ^4**。Rust/TS SDK 已宣布 1.0 稳定线（[SDK 1.0 公告](https://agentclientprotocol.com/announcements/sdk-1-0-releases.md)）。 |
| **集成方式** | 构建 **Client** 时使用 `client({ name })`，注册 `requestPermission`、`sessionUpdate` 等 handler，经 `connectWith(stream, …)` 绑定子进程 stdio（[TypeScript 库文档](https://agentclientprotocol.com/libraries/typescript.md)）。也可参考 Cursor 文档中的 [最小 Node 客户端](https://cursor.com/docs/cli/acp)（手写 JSON-RPC），但 **推荐 SDK** 以降低协议漂移成本。 |
| **协议版本** | Phase 1 PoC **仅协商 `protocolVersion: 1`**。`@agentclientprotocol/sdk/experimental/v2` 为草案 API，**不在 Phase 1 使用**（[npm README — Experimental v2](https://www.npmjs.com/package/@agentclientprotocol/sdk)）。 |
| **与现有代码关系** | 今日 adapter 解析 **短进程 stdout JSONL**（`macos-agent-gateway/src/adapters/protocol.ts`）；ACP 路径应新增 **并行模块**（长连接 JSON-RPC），复用 `AdapterEvent` → SQLite/SSE 的 `record()` 管线，**不删除**现有 CLI adapter（Issue 非目标）。 |
| **风险** | launchd 后台进程内再 `npx` 拉适配器：冷启动与离线 npm 缓存；需固定 adapter 版本并随 `package` 捆绑或 `npm ci` 预装。 |

### 1.3 事件映射：ACP → 网关现有事件

网关封闭事件类型（[`protocol-contract.md`](../reference/protocol-contract.md) §2.4）：`status | output | tool | approval | completed | error`。

#### A. Agent → Client：`session/update`（通知）

| ACP `sessionUpdate` | 建议网关 `type` | `payload` 要点 | 会话 `status` 副作用 |
| --- | --- | --- | --- |
| `agent_message_chunk` | `output` | `stream: "assistant_delta"`, `text` | 保持 `running` |
| `user_message_chunk` | `output` 或忽略 | 网关已持久化用户 `messages` API 事件；replay 时可 `stream: "user"` | — |
| `agent_thought_chunk` | `output`（可选） | `stream: "reasoning"` 或折叠进诊断 | `running` |
| `tool_call` | `tool` | `id←toolCallId`, `name`, `status: pending`, `kind` | `running` |
| `tool_call_update` | `tool` | 合并 `status`, `rawInput`/`rawOutput` 摘要 | `running`；`failed` 时可附 `error` |
| `plan` | `output` 或 `status` | `stream: "plan"`, `entries` | `running` |
| `current_mode_update` | `status` | `phase: "mode"`, `modeId` | `running` |
| `config_option_update` / `available_commands_update` / `session_info_update` | `status` | 元数据，供调试或未来 UI | 通常不变 |
| `usage_update` | 不写入会话事件（可选） | 可喂给现有 **额度探测** 缓存策略，避免重复存 SQLite | — |

#### B. Agent → Client：需 Client 响应的请求

| ACP 方法 | 建议网关行为 | 映射到现有模型 |
| --- | --- | --- |
| `session/request_permission` | 见 §1.4 安全策略；**必须**在超时内响应，否则工具阻塞 | `approval` 事件 + `waiting_approval`；Phase 1 可由网关自动决策；Phase 2 手机 challenge/resolve |
| `fs/*`（若 Agent 委托 Client 读写的文件能力） | **默认关闭** `clientCapabilities.fs`；文件由 Agent 在本机执行，网关仅用 **受控 `files/read` HTTP** 给手机预览 | 不扩大 `REMOTE_AGENT_ROOTS` |
| `terminal/*` | Phase 1 建议 `terminal: false`；终端在 Agent 进程侧执行 | 工具事件仍可从 `tool_call` 呈现 |
| **Cursor 扩展** `cursor/ask_question`, `cursor/create_plan` | 阻塞式：**必须**响应；PoC 若选 Cursor 需专用 handler（默认拒绝/跳过策略需产品定义） | `approval` + 自定义 `raw` |
| **Cursor 扩展** 通知类 `cursor/update_todos` 等 | 可映射为 `output` 或忽略 | — |

#### C. Client → Agent：与网关生命周期对齐

| 网关动作 | ACP 方法 | 映射 |
| --- | --- | --- |
| 新建会话 | `session/new`（`cwd` 已白名单校验） | 对应今日 `launch`；`nativeId` ← `sessionId` |
| 续接 | `session/resume` 或 `session/load`（以 Agent 能力为准） | 对应 `resume` + `nativeId` |
| 用户跟进 | `session/prompt` | 对应 `POST .../messages` |
| 取消 | `session/cancel` + 待处理 permission 填 `cancelled` | 对应 `cancel` API |
| 回合结束 | `session/prompt` 响应 `stopReason` | `completed`（`end_turn`）或 `error` / `cancelled` |

#### D. 权限模式 → ACP 会话模式（PoC 配置草案）

| 网关 `permissionMode` | Claude 适配器（SDK 权限） | Codex 适配器（`INITIAL_AGENT_MODE` 等） | Cursor ACP `mode` |
| --- | --- | --- | --- |
| `plan` / `ask` | plan / 受限 | `read-only` | `plan` 或 `ask` |
| `auto` | acceptEdits 类 | `workspace-write` / `agent` | `agent` + 网关对非只读工具 **仍可按策略自动 allow-once** |
| `full` | bypass（仍受 cwd 白名单） | `agent-full-access` | `agent` + 更宽松的 auto-allow（**不得**放开 cwd） |

（Codex 环境变量表见 [codex-acp README — Runtime options](https://github.com/agentclientprotocol/codex-acp/blob/main/README.md)。）

### 1.4 安全边界：自动 vs 必须确认

原则：**手机不持有 Agent 密钥、不能提交任意 shell**；**`REMOTE_AGENT_ROOTS` 不可被 ACP 绕过**（[`security.md`](../security.md)）。

| 能力 / 场景 | Phase 1（PoC）建议 | Phase 2 目标 |
| --- | --- | --- |
| **会话 `cwd` / `session/new`** | 网关 **先** `realpath` + 白名单，再传给 Agent；拒绝白名单外路径 | 同左 |
| **Agent 内文件/命令** | 在 Mac 上由 Agent/适配器执行；网关 **不向手机暴露** 完整 tool input 策略外泄控制（延续今日 SQLite 风险提示） | 字段白名单与脱敏 |
| **`session/request_permission`** `kind: read` 且路径落在会话 cwd 子树内 | `auto`/`full`：可 **自动 `allow-once`**；`ask`/`plan`：**自动 `reject-once`** 或进入 `waiting_approval` 并由 **Mac 本机**默认策略处理（与今日「等待 Mac 确认」一致） | 手机 **challenge/resolve API** |
| **写/删/移/执行**（`edit`/`delete`/`move`/`execute`） | `ask`/`plan`：**不得**静默 `allow_always`；`auto`：仅当 **realpath 仍在会话 cwd 且位于 `REMOTE_AGENT_ROOTS`** 时自动允许单次；`full`：可在 cwd 内放宽 CLI 侧确认，**仍拒绝**白名单外路径 | 手机可选批准 |
| **`allow_always` / `reject_always`** | PoC **禁止**把手机「批准」或 auto/full 映射为 `allow_always`（只选 `allow_once`；没有则拒绝/转手机）；防止 launchd 无人值守扩大攻击面 | 可配置 + 审计 |
| **ACP Client `fs` 能力** | **禁用**（`readTextFile`/`writeTextFile: false`），避免 Agent 借 Client 读网关进程可见的任意文件 | 若启用，必须逐路径校验 cwd |
| **额外工作区根**（ACP additional directories） | **不暴露**或严格等于白名单根集合的子集 | 产品定义 |
| **Cursor 阻塞式扩展** | 无 UI 时 **不得**挂起整个会话：需超时后 `cancelled`/`rejected` 或 PoC 不选 Cursor | 专用移动端卡片 |

**硬约束（不可回退）**：无论 `full` 或 ACP `allow_always`，**网关不得在 `REMOTE_AGENT_ROOTS` 外创建会话、续接写任务或 `files/read` 越权**；历史可见 ≠ 可执行（[`security.md`](../security.md) 默认边界）。

### 1.5 Phase 1 单 Agent PoC 建议

**推荐目标：Claude Code + `@agentclientprotocol/claude-agent-acp`**

| 维度 | 说明 |
| --- | --- |
| **理由** | ① 官方适配器，JetBrains 注册表可复现；② **权限扩展**与 `session/request_permission` 文档齐全，与 Issue 缺口「结构化 approval」路径一致；③ **无 Cursor 专有阻塞扩展**，更适合 headless launchd 网关；④ 与现有 `claude` CLI adapter 同属 `AgentKind`，便于 A/B 与回退。 |
| **粗略工作量** | **约 5–8 人日**（1 名熟悉网关工程师）：SDK 接入、子进程监管、事件映射、权限策略桥接、单测 + 一条端到端手动验收；不含移动端审批 UI。 |
| **主要风险** | 长进程内存/泄漏；`npx` 启动延迟；Claude SDK/适配器版本漂移；permission 自动策略与用户预期不一致。 |
| **回退** | 保留现有 `claude -p --output-format stream-json` 短进程路径；ACP 启动失败或 capability 不足时 **降级**到 CLI adapter（配置开关）。 |

**备选（次选）：Codex + `@agentclientprotocol/codex-acp`**

- 优势：与本仓库 **Codex app-server** 运维经验接近；`INITIAL_AGENT_MODE` 与沙箱枚举清晰。  
- 劣势：栈更深（ACP adapter → App Server）；ChatGPT 鉴权在无头环境更敏感；与现有 **exec JSONL** 重复度高。

**Phase 1 不建议首选 Cursor ACP**

- 阻塞式 `cursor/ask_question` / `cursor/create_plan` 在无人值守网关必须额外实现，否则 **易死锁**（[Cursor ACP 文档](https://cursor.com/docs/cli/acp)）。可在 Phase 2 多 Agent 扩展时再接入。

## 2. Phase 0 结论摘要

1. **协议**：生产锁定 **ACP v1** + `@agentclientprotocol/sdk` 1.x；v2 仅跟踪草案。  
2. **三 Agent 均可 ACP 接入**：Cursor 原生；Claude/Codex 经官方 npm 适配器。  
3. **事件映射可行**：`session/update` 与 `session/request_permission` 可落入现有六种事件与会话状态机，Cursor 扩展需额外处理。  
4. **安全**：权限响应由网关集中策略化；**cwd 白名单先于** `session/new`；不启用 Client 侧 fs/terminal 除非有等价路径校验。  
5. **PoC**：**Claude + claude-agent-acp**；失败回退短进程 CLI。  
6. **阻塞项（Phase 1 前需对齐）**：  
   - 手机侧仍无 challenge/resolve → Phase 1 只能 Mac 侧自动/等待策略；  
   - launchd 环境需 **预装** adapter 与 `zod`，避免运行时 `npx` 拉包失败；  
   - 若未来选 Cursor ACP，需产品定义阻塞扩展的无人值守行为。

## 3. 参考链接

- 协议仓库：<https://github.com/agentclientprotocol/agent-client-protocol>  
- 协议文档索引：<https://agentclientprotocol.com/llms.txt>  
- Tool calls / Permission：<https://agentclientprotocol.com/protocol/v1/tool-calls.md>  
- Prompt turn：<https://agentclientprotocol.com/protocol/v1/prompt-turn.md>  
- TypeScript SDK：<https://agentclientprotocol.com/libraries/typescript.md>  
- claude-agent-acp：<https://github.com/agentclientprotocol/claude-agent-acp>  
- codex-acp：<https://github.com/agentclientprotocol/codex-acp>  
- Cursor CLI ACP：<https://cursor.com/docs/cli/acp>  
- JetBrains ACP：<https://www.jetbrains.com/help/ai-assistant/acp.html>  
- IntelliJ 博客（用法背景）：<https://blog.jetbrains.com/idea/2026/08/how-to-use-ai-agents-in-intellij-idea-with-acp/>
