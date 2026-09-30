# 功能追踪与验收矩阵（验收覆盖 SSOT）

> 功能状态来自 [`../product/functional-spec.md`](../product/functional-spec.md)。本矩阵负责把稳定功能 ID 追踪到实现、自动化和人工验收。修改任一功能时，必须更新对应行；新增功能先分配 ID，再写代码。

## 1. 覆盖标记

| 标记 | 含义 |
| --- | --- |
| **A** | 有直接自动化覆盖主合同和关键失败路径 |
| **P** | 有部分自动化，但仍缺关键平台、负向或端到端分支 |
| **M** | 当前主要依赖人工验收 |
| **—** | 占位/规划能力尚无可宣称的完整验收 |

覆盖标记不是功能状态。已实现功能仍可能因原生/真实网络环境而需要人工证据；受限实现即使测试通过也不能升级为已实现，除非功能规格中的限制已消除。

## 2. 连接、配对与设备

| 功能 ID | 状态 | 实现锚点 | 当前自动化证据 | 覆盖 | 变更后最低人工验收 |
| --- | --- | --- | --- | --- | --- |
| `CONN-001` | 受限实现 | `Prototype.tsx` 的凭据加载、15s 后台同步、15s request timeout、标题右侧紧凑连接状态入口；网关 `/v1/config` | `product-flow.spec.ts`：断开态、connected gateway、缓存加载/失败、状态入口与标题同行且无冗余设备图/说明；`gateway.test.ts`：config | P | 无 token、有效 token、错误 URL、超时、长连接名截断；已连接后断网不会立即切离线的限制必须复核 |
| `PAIR-001` | 已实现 | `pair.ts`、`PairingManager`、`POST /v1/pairing/start` | `security.test.ts`：一次性/过期；`gateway.test.ts`：完整配对 | A | Mac 本机生成码；确认非回环无法生成；输出不进入持久日志 |
| `PAIR-002` | 已实现 | `Prototype.tsx#pairDevice`、`credential-store.ts`、`POST /v1/pairing/confirm` | `gateway.test.ts`：API 成功；`product-flow.spec.ts`：添加第二台 Mac、保存并自动同步、旧凭据迁移；iOS XCUITest：动态配对码成功、错误码拒绝且输入/日志遮罩 | A | 同 origin 更新 token、8 条上限；Android 原生错误/过期码复核 |
| `DEVICE-001` | 已实现 | `GatewayStore.listDevices/authenticateDevice`、设备 BottomSheet | `gateway.test.ts`：列表/current/lastSeen 鉴权路径 | P | 多设备排序、当前设备标记、最后使用时间、空列表 |
| `DEVICE-002` | 已实现 | `removeGatewayConnection`、`disconnectDevice`、当前授权撤销后的后备连接切换 | `product-flow.spec.ts`：多连接移除后切换；iOS XCUITest：移除当前项自动回退、移除最后一项回到单一入口 | P | 服务端授权保留与 Android 真机复核 |
| `DEVICE-003` | 已实现 | `/v1/devices/:id/revoke`、`revokePairedDevice` | `gateway.test.ts`：撤销当前 token 后 401 | P | 撤销其他设备、撤销当前设备、失败提示；确认无二次确认仍符合本期规格 |
| `DEVICE-004` | 已实现 | `credential-store.ts` 版本化连接库/activeId、设备页连接选择器、按 origin 的摘要缓存 | `product-flow.spec.ts`：旧凭据迁移、添加第二台、切换、重载默认恢复、缓存隔离、移除回退；iOS XCUITest：Keychain 保存两台 Mac、切换、进程终止后恢复 activeId | A | 失败连接、同 origin 更新 token、8 条上限；Android 冷启动与安全存储复核 |

## 3. Agent、权限和生命周期

| 功能 ID | 状态 | 实现锚点 | 当前自动化证据 | 覆盖 | 变更后最低人工验收 |
| --- | --- | --- | --- | --- | --- |
| `AGENT-001` | 受限实现 | `agent-registry.ts`、`ProcessAgentAdapter.detect`、`GET /v1/agents` | `gateway.test.ts` 使用 fake adapter；未覆盖真实 PATH/版本超时 | P | 分别验证已安装/缺失 CLI 和版本输出；移动端仍显示全部 Agent 的限制不得被误报 |
| `AGENT-002` | 已实现 | `security.ts`、`adapters/*.ts`、`adapters/process.ts` | `security.test.ts` 覆盖 cwd；`protocol.test.ts` 覆盖输出解析；`codex.test.ts` 覆盖新建/续接 argv；Cursor/Claude 尚缺 argv 快照/真实 spawn 测试 | P | 三种 CLI 各跑一个受控 plan/ask smoke；确认 `shell:false`、固定 argv、越界 cwd 拒绝 |
| `PERMISSION-001` | 受限实现 | 三个 adapter 的 `buildArgs`、设置开关与 create/resume body | 目前没有直接断言三种模式 argv 的测试 | M | 对每个 Agent 核对 plan/ask/auto 实际参数和写权限；UI 只发送 ask/auto；刷新恢复默认开启 |
| `AGENT-003` | 已实现 | `ProcessAgentAdapter.launch/cancel`、`GatewayService.stop/record` | `gateway.test.ts` 覆盖完成路径；未覆盖真实 SIGTERM→SIGKILL、spawn error | P | 正常完成、非零退出、stderr、取消、网关停止；确认只产生一个有效终止结果 |
| `AGENT-004` | 受限实现 | `agent-usage.ts`、`GET /v1/agents/usage`、`Prototype.tsx` Agent Tab 内额度摘要 | `agent-usage.test.ts`：Codex/Cursor 窗口解析、失败回退与缓存；`gateway.test.ts`：认证路由；`product-flow.spec.ts`：Tab 内真实剩余比例、最紧张窗口和无法获取态 | P | 本机 Codex ChatGPT 登录读取 5 小时/周窗口与重置时间；Cursor IDE 登录态读取本月 included 剩余；Claude 未登录/API/无接口回退；额度接口失败时会话同步不受阻；Android/iOS 小屏布局 |

## 4. 会话与事件

| 功能 ID | 状态 | 实现锚点 | 当前自动化证据 | 覆盖 | 变更后最低人工验收 |
| --- | --- | --- | --- | --- | --- |
| `SESSION-001` | 已实现 | `loadRemoteState`、稳定身份去重、原始 `updatedAt` 排序、网关每 Agent/项目 20 条上限、`GatewayStore.listSessions`、`NativeHistoryService.list` | `product-flow.spec.ts`：重复 ID、最近/项目 20 条上限；`history.test.ts` 三 Agent；`codex-threads.test.ts` 标题/缓存 | A | 网关+原生合并、两级去重、原始时间排序、2,000 条与多项目边界 |
| `SESSION-002` | 已实现 | `visibleSessions`、filters、statusSummary、`SessionStateIndicator`、未读持久化、标题栏内搜索与浏览方式切换 | `product-flow.spec.ts`：三 Agent 过滤、搜索、状态汇总、两行紧凑会话行、运行旋转状态、完成未读蓝点及查看后隐藏、紧凑标题操作区；iOS XCUITest：Codex Tab、标题搜索和新会话入口状态 | A | 标题、项目、模式、Agent 搜索；清空/关闭搜索；空结果、进行中和未读准确；运行/未读/已读完成三态；窄屏操作区无溢出 |
| `SESSION-003` | 已实现 | 统计行右侧 `new-session-button`、Tab 到 `draftAgent` 映射、`createSession`、`POST /v1/sessions`、`GatewayService.startSession` | `gateway.test.ts`：创建生命周期；`product-flow.spec.ts`：按钮与统计同行、各 Agent Tab/搜索态持续显示、Tab 默认 Agent、创建后进入详情；iOS XCUITest：原生表单创建后直接进入全屏详情 | A | 全部/Cursor/Claude/Codex 默认值，搜索及最近/项目视图；三 Agent、空 prompt、缺 cwd、越界 cwd、未安装 CLI、受限/自动模式 |
| `SESSION-004` | 已实现 | 安全区详情标题栏、标题内联更新时间/状态/分支、用户问题 sticky 锚点、无断层吸顶边界、两行折叠与方向覆盖动画、近底部自动跟随保护、网关事件轮询、原生 snapshot 轮询、Markdown、`appendGatewayEvents`、session/events APIs | `product-flow.spec.ts`：标题内更新时间且无独立元信息行、标题与内容无断层、普通/运行中吸顶边界坐标、长问题折叠/展开/切换复位、多轮问题正向/反向吸顶覆盖、减少动态效果、离底后不被新输出拉回、Markdown/GFM、网关和原生 Codex 流式结果、终态停止刷新、默认折叠的 stderr 诊断；`gateway.test.ts`：事件存取与原生 snapshot；iOS XCUITest：全屏安全 Markdown 与流式结果可见 | P | user/assistant/delta/tool/approval/error/empty；长问题、小屏、活动状态条偏移、增量无重复、终态停止轮询、断网错误与恢复 |
| `SESSION-005` | 已实现 | `sendDetailReply`、continue API、`GatewayService.continueSession` | `gateway.test.ts`：继续启动；`codex.test.ts`：续接允许非 Git cwd；`product-flow.spec.ts`：全屏继续并合并 delta；iOS XCUITest：详情内继续输入并显示后续结果 | A | running/无 nativeId 禁用；completed/failed/cancelled 续接；并发请求拒绝；权限/cwd 沿用 |
| `SESSION-006` | 受限实现 | cancel API、`GatewayService.cancelSession` | 无直接 cancel HTTP/进程测试；移动端无入口 | M | API 取消活动进程、重复/非活动取消失败、状态和事件一致；UI 限制仍明确 |
| `SESSION-007` | 已实现 | `ProjectResolver`、会话 `projectId/projectName`、移动端项目视图、同名项目路径消歧与折叠状态 | `project-resolver.test.ts`：Git 子目录、同名路径、越界与已删除 cwd；`history.test.ts`/`gateway.test.ts`：项目字段；`product-flow.spec.ts`：多 Agent 分组、折叠记忆、cwd 预填、benchmark 同名 `workspace` 保持独立且显示 Agent/任务/套件标签 | A | 真实三 Agent 历史、项目数量/排序、同名 basename 消歧、筛选/搜索、折叠与项目内新会话；Android/iOS 小屏布局 |
| `SESSION-008` | 已实现 | `readSessionCache/writeSessionCache`、按服务端 origin 分键、同步状态与重试 | `product-flow.spec.ts`：同 URL 先缓存后替换、两条保存连接分别缓存、不同 URL 隔离、失败保留与重试、缓存无 token/cwd；iOS XCUITest：终止进程后先显示当前 Mac 缓存与 loading，再异步刷新 | A | 离线旧缓存、存储空间受限；确认真实设备备份策略 |
| `FILE-001` | 已实现 | `session-files.ts`、会话/原生历史 file read 路由、Markdown 本机链接桥接、Blob 预览页 | `session-files.test.ts`：相对/绝对/`file://`、符号链接逃逸、目录、缺失、超限；`gateway.test.ts`：认证二进制响应；`product-flow.spec.ts`：内联图片、文本预览、缺失错误与返回 | P | PNG/JPEG/PDF/文本/未知二进制；Android/iOS 下载行为、20 MiB 边界、断网重试、TCC 错误 |
| `STREAM-001` | 已实现 | `GatewayStore.addEvent/listEvents`、JSON events route | `gateway.test.ts`：持久化事件和 JSON 获取 | A | `after` 游标、升序、上限、坏 payload 容错、重启后可读 |
| `STREAM-002` | 受限实现 | `openEventStream`、`EventHub` | `gateway.test.ts`：SSE 建连/首块；未覆盖补发、heartbeat、实时事件、重连 | P | after/Last-Event-ID 补发、新事件、15s heartbeat、关闭清理；移动端未消费的限制明确 |
| `APPROVAL-001` | 界面占位 | parser approval 分支、`GatewayService.record`、移动端 approval 文案 | 无 approval 专项测试 | — | 只能展示等待 Mac，不出现手机批准/拒绝入口，不把 ask 描述为完整审批 |

## 5. 原生历史

| 功能 ID | 状态 | 实现锚点 | 当前自动化证据 | 覆盖 | 变更后最低人工验收 |
| --- | --- | --- | --- | --- | --- |
| `HISTORY-001` | 已实现 | `NativeHistoryService.list/get/snapshot`、`CodexThreadCatalog`、Cursor composerHeaders + chats fallback、Claude scanner、Codex JSONL 生命周期校正与 fallback | `history.test.ts`：三 Agent、白名单外只读可见、Cursor 两代摘要、Codex 运行/完成转换、忽略 archived；`cursor-composers.test.ts`：IDE 标题/归档/多根 cwd；`codex-threads.test.ts`：桌面标题优先、app-server 状态映射与 15 秒缓存 | A | 真实三种历史目录、app-server 失败、缺目录/坏 JSON、Codex 仅活跃分页、超过 24 小时活动任务的保守回退 |
| `HISTORY-002` | 受限实现 | `messages/snapshot`、Claude/Codex message reader、移动端原生详情轮询、清洗/截断 | `history.test.ts`：Claude/Codex 文本、增量消息与 Cursor 空数组；`gateway.test.ts`：snapshot 运行/完成与新增消息；`product-flow.spec.ts`：原生 Codex 详情增量刷新、运行态禁用输入和终态停止 | P | 用户/助手顺序、工具/system 排除、注入上下文清洗、长文本、Cursor 无正文提示、真实电脑端长任务输出 |
| `HISTORY-003` | 受限实现 | resume route、`resumeNativeSession`、详情只读 composer、三个 adapter resume argv | `gateway.test.ts`：Codex resume；`codex.test.ts`：非 Git cwd 的 Codex resume argv；`history.test.ts`：Cursor resumable 标记；`product-flow.spec.ts`：列表隐藏来源标签、不可续接详情显示“仅查看”并禁用输入 | P | Claude/Codex/new Cursor 实际续接；old Cursor 409；白名单外/坏 ID 404；只读输入禁用；新网关会话去重 |

## 6. 移动运行时、设置、交付和运维

| 功能 ID | 状态 | 实现锚点 | 当前自动化证据 | 覆盖 | 变更后最低人工验收 |
| --- | --- | --- | --- | --- | --- |
| `MOBILE-001` | 已实现 | `src/mobile/`、runtime lock、`App.tsx`、Capacitor `SystemBars: DARK`、原生 mobile viewport/content mode、iPad ≥700px 可读宽度约束 | `mobile-runtime.spec.ts` 8 项：Carousel、拖动、sheet、键盘、Pixel safe area、FlowStack；`check:runtime` 28 文件；安卓真机截图：深色背景上的浅色时间/网络/电量；iOS XCUITest/截图：402pt iPhone 无横向裁切、设备 sheet 显式关闭；iPad (A16) 横竖屏主控件可见且 Release 冷启动通过 | A | iPhone/Pixel 10/iPad，浅色/深色系统主题下的系统栏可见性、触摸/鼠标、横竖屏/窗口缩放、键盘/安全区、scroll/sheet、设备切换和视觉回归 |
| `MOBILE-002` | 已实现 | `credential-store.ts`、Swift/Java plugin 固定 key/32 KiB 上限、原生注册 | Web 迁移/切换产品流；iOS XCUITest：首次为空、保存后可读、进程重启后恢复、切换与逐项清除；Swift/Java 原生构建 | P | Android：空/写/读/迁移/切换/清除；两端坏密文/非法 key；确认日志和备份策略无明文 |
| `MOBILE-003` | 已实现 | `@capacitor/app` backButton、`closeSessionDetail` | `product-flow.spec.ts`：可视返回；Android 真机 ADB 返回键人工验收 | P | 键盘/sheet/详情/搜索逐层返回；首页最小化；Android 返回手势；iOS/Web 无回归 |
| `SETTING-001` | 受限实现 | `alwaysConfirm`、设置 toggle、create/resume body | 无直接测试 permission body 或刷新行为 | M | 默认 ask、关闭后 auto、新建/原生续接都生效、刷新恢复默认且文案准确 |
| `SETTING-002` | 界面占位 | `notifications` toggle | 无系统行为和自动化 | — | 只验证 toggle 不崩溃；不得宣称已通知。接入通知前新增功能验收和平台测试 |
| `DIST-001` | 已实现 | Vite、prepare script、worker、hosting JSON | `sites-worker.test.mjs` 4 项；build | A | 静态资源、未知 GET app fallback、API/write 不 fallback、四个必需产物存在 |
| `OPS-001` | 已实现 | `service-manager.ts`、launchd plist/runtime copy | `service-manager.test.ts` 3 项：转义/0.0.0.0、TCC、路径 | P | 获授权后 install/status/restart/uninstall、CLI PATH、私网连接、数据保留和 TCC 提示 |

## 7. 自动化测试索引

### 网关

| 测试文件 | 当前主要覆盖 |
| --- | --- |
| `macos-agent-gateway/test/gateway.test.ts` | health、401、配对、设备、Agent/config、原生历史、创建/继续/续接、JSON 事件、SSE 建连、撤销 |
| `macos-agent-gateway/test/security.test.ts` | 配对码一次性/过期、cwd 白名单、token hash |
| `macos-agent-gateway/test/session-files.test.ts` | 会话文件相对/绝对/`file://` 解析、realpath 边界、类型与大小限制 |
| `macos-agent-gateway/test/history.test.ts` | 三种历史扫描、白名单外只读可见、可续接性、Claude/Codex 文本 |
| `macos-agent-gateway/test/codex-threads.test.ts` | Codex 桌面标题映射、分页字段和 15 秒缓存 |
| `macos-agent-gateway/test/protocol.test.ts` | Codex/Claude/Cursor CLI 输出解析、native ID、tool、非 JSON |
| `macos-agent-gateway/test/codex.test.ts` | Codex 新建/续接固定 argv、沙箱映射和非 Git cwd 兼容参数 |
| `macos-agent-gateway/test/service-manager.test.ts` | plist 固定路径/转义、0.0.0.0、TCC 目录、服务路径 |

### 移动端

| 测试文件 | 当前主要覆盖 |
| --- | --- |
| `mobile-agent-remote/tests/product-flow.spec.ts` | 断开态单一连接入口、多 Mac 迁移/添加/切换/默认恢复/移除回退/缓存隔离、项目分组、Agent 过滤、详情/继续、创建后全屏流输出、stderr 诊断默认折叠 |
| `mobile-agent-remote/tests/mobile-runtime.spec.ts` | Carousel 手势、拖动抑制、sheet exit、键盘联动、Android nav safe area、FlowStack |
| `mobile-agent-remote/tests/sites-worker.test.mjs` | 静态资源、SPA fallback、API/write 保护、Sites 产物 |
| `mobile-agent-remote/ios/App/RemoteAgentUITests/RemoteAgentUITests.swift` | iOS 原生空状态、标题右侧紧凑状态入口打开/关闭设备管理、成功/错误配对、Agent Tab/搜索、新建/全屏 Markdown/继续、双 Mac 保存切换、Keychain 冷启动恢复、缓存优先刷新、移除回退 |
| `mobile-agent-remote/tests/native-gateway-fixture.mjs` | 仅回环的动态配对挑战、双网关隔离、会话/事件/继续响应和可控延迟；不记录配对码或 token |

## 8. 当前最高优先级覆盖缺口

以下缺口在相关代码被触碰时必须优先补齐：

1. 三种 adapter 对 `plan/ask/auto` 和 resume 的 argv 单测。
2. cancel HTTP、SIGTERM/SIGKILL 和终止事件去重测试。
3. 设备授权列表/撤销、同 origin 更新 token 和 8 条连接上限的产品流测试。
4. 混合会话去重、approval/error/tool 展示和断网恢复测试。
5. SSE 的补发、实时 publish、heartbeat、断开清理和游标恢复测试。
6. 原生历史注入上下文清理、文本截断、读取窗口与安全 ID 负向测试。
7. Android SecureCredentials 平台测试，以及 iOS/Android 坏密文和非法 key 的原生负向测试。

功能没有被改动时，这些缺口可以保留并在交付中如实说明；一旦相关行为发生变化，不得继续用旧的部分覆盖作为完整验收依据。
