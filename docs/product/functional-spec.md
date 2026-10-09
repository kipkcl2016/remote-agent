# Remote Agent 功能规格（功能 SSOT）

> 状态：当前实现基线  
> 基线日期：2026-09-30  
> 功能状态、用户流程和可观察行为以本文为准；面向使用/验收的完整说明见 [`feature-guide.md`](feature-guide.md)；字段级协议见 [`../reference/protocol-contract.md`](../reference/protocol-contract.md)，验收覆盖见 [`../quality/feature-matrix.md`](../quality/feature-matrix.md)。

## 1. 产品定位

Remote Agent 让已授权的移动设备在不持有 Agent API 密钥、不接收任意 shell 能力的前提下，查看 Mac 上的 Cursor、Claude Code、Codex 会话，并在白名单工作目录中发起或继续任务。

系统由三部分组成：

- 移动端控制台：Web UI 与 Capacitor iOS/Android 壳，负责配对、会话浏览、任务输入和状态展示。
- macOS Agent Gateway：负责认证、工作目录校验、会话/事件持久化、原生历史读取和 Agent 子进程生命周期。
- 本机 Agent CLI：Cursor Agent、Claude Code、Codex；网关只通过固定 adapter 调用它们。

目标用户是拥有 Mac 开发环境、已安装至少一种受支持 Agent CLI，并希望在可信移动设备上远程查看或启动开发任务的单用户开发者。

## 2. 当前范围与非目标

当前 MVP 包含：

- 一次性配对、独立设备 token 和授权撤销。
- 在本机安全保存多个已配对 Mac，并记住、切换或移除连接。
- Cursor、Claude、Codex 的安装检测、固定参数启动、会话续接与部分原生历史读取。
- 三种 Agent 的紧凑额度状态集成在 Agent Tab 内；仅在 CLI 提供安全、可机器读取的数据时展示真实剩余比例，否则明确提示无法获取。
- 会话列表、筛选、搜索、详情、输出/工具事件展示、新会话和继续输入。
- 按项目聚合三种 Agent 会话，并在同一服务端重连时先显示本地摘要缓存、再后台同步。
- 网关 SQLite 持久化、JSON 事件拉取、SSE 服务端接口。
- iOS/Android 安全凭据存储、Capacitor 工程和静态 Sites 打包。
- macOS launchd 内测服务的安装、状态查看和卸载。

当前明确不是完整能力：

- 手机逐项批准工具调用。
- APNs/FCM 系统通知、后台推送、锁屏隐私策略。
- 用户账号、云端中继、多用户/多 Mac 管理。
- 文件上传、任意终端、任意 executable/CLI 参数。
- 公网开箱即用部署、正式签名、应用商店发布或生产级密钥轮换。
- Cursor 原生消息：旧 acp/chats store 正文仍不解析（agent-transcripts 已支持）。

## 3. 功能目录

### 3.1 连接、配对与设备

| 功能 ID | 功能 | 状态 | 当前行为与边界 |
| --- | --- | --- | --- |
| `CONN-001` | 网关地址与连接状态 | 已实现 | 用户输入 `http(s)` 网关 origin；请求 15 秒超时。已持有 token 时每 15 秒同步会话、历史、配置、设备和 Agent 安装状态；首页标题右侧仅以状态灯和当前连接名表示在线/离线，详细连接类型在设备管理中查看。任一轮同步失败会立即切换为离线 UI，并保留同服务端会话摘要缓存与失败提示 |
| `PAIR-001` | Mac 生成一次性配对码 | 已实现 | `npm run pair` 仅通过回环地址请求 6 位码；默认 5 分钟过期且消费一次后立即失效，不持久化配对码 |
| `PAIR-002` | 移动设备配对并保存凭据 | 已实现 | 移动端以密码字段提交 6 位码与设备名换取 token；成功后把网关 origin、token、Mac 名称与最后使用时间保存为一条连接并开始同步。Web 用 `localStorage`，原生使用安全存储 |
| `DEVICE-001` | 查看已授权设备 | 已实现 | 已认证设备可查看设备名、最后使用时间和“当前设备”标记；每次成功鉴权更新当前设备 `lastSeenAt` |
| `DEVICE-002` | 从本机移除连接 | 已实现 | 设备页只删除当前 Mac 的本地凭据，不撤销服务端授权；存在其他已保存连接时自动切换到最近使用的一台，否则返回未连接态 |
| `DEVICE-003` | 撤销设备授权 | 已实现 | 任一已认证设备可撤销列表中的任一设备；撤销前需在设备列表中二次确认。撤销当前设备后当前 token 立即失效并清理本地凭据 |
| `DEVICE-004` | 保存与切换多个 Mac | 已实现 | 移动端安全保存最多 8 条连接并持久化 activeId；启动默认恢复上次使用项，设备页展示名称与 origin，可切换历史连接或添加另一台 Mac；旧版单 URL/token 首次读取时自动迁移 |

### 3.2 Agent 与权限

| 功能 ID | 功能 | 状态 | 当前行为与边界 |
| --- | --- | --- | --- |
| `AGENT-001` | 检测受支持 Agent | 已实现 | 网关通过 PATH 检测 `cursor-agent`、`claude`、`codex` 并读取版本；移动端在会话同步时读取 `GET /v1/agents`，在 Agent Tab 与新会话表单中禁用未安装项，并在可用时展示版本或命令名 |
| `AGENT-002` | 安全启动 Agent 子进程 | 已实现 | executable 与参数由 adapter 固定，`shell: false`，cwd 先经过真实路径白名单校验；客户端不能提供命令、参数或环境变量 |
| `PERMISSION-001` | `plan / ask / auto / full` 权限模式 | 受限实现 | API 支持四个值。新建会话表单可显式选择「受限执行 / 自动执行 / 完全允许」（`ask` / `auto` / `full`），默认跟随设置页“默认受限执行”。`ask` 在三个短进程 CLI 中等同 plan/只读；`auto` 为白名单内可写/Smart Auto；`full` 映射 Cursor `--force`、Claude `bypassPermissions`、Codex `danger-full-access`，但仍不能越出 `REMOTE_AGENT_ROOTS`。`ask` 不是手机审批 |
| `AGENT-003` | Agent 进程生命周期 | 已实现 | 网关记录启动、输出、工具、审批提示、完成和错误事件；支持 SIGTERM 取消，5 秒未退出再 SIGKILL；网关关闭时取消活动进程 |
| `AGENT-004` | Agent 剩余额度 | 受限实现 | 已认证移动端每 60 秒读取一次网关额度快照；额度摘要集成在 Cursor/Claude/Codex Tab 的第二行，可用时显示最紧张窗口的真实剩余比例，Claude/Codex API 模式显示“API模式”，其余不可用时显示“无法获取”，不再占用独立卡片区域。Codex 在 ChatGPT 登录下通过官方 app-server `account/rateLimits/read` 读取窗口；API Key 登录则显示 API模式。Cursor 通过本机 IDE 登录态调用 Dashboard `GetCurrentPeriodUsage` 读取本月 included 剩余比例；API 模式无套餐额度窗口，不得猜测剩余值。探测失败不得阻塞会话同步，也不得回传账号、密钥或原始上游响应 |

### 3.3 会话与实时输出

| 功能 ID | 功能 | 状态 | 当前行为与边界 |
| --- | --- | --- | --- |
| `SESSION-001` | 统一最近会话列表 | 已实现 | 合并网关会话与原生历史；已有 `agent:nativeId` 对应的网关会话会遮蔽同一原生记录，并按 `source + agent + session id` 再次去重。原生历史先按 Agent/项目各保留最近 20 条，移动端最多接收 2,000 条；最近视图只展示最近 20 条，不会因单个高频项目挤掉其他项目 |
| `SESSION-002` | Agent 筛选与本地搜索 | 已实现 | 支持全部/Cursor/Claude/Codex 筛选；Tab 不显示历史总数，并在 Agent 名称下紧凑显示额度摘要，状态区汇总当前筛选内“进行中”和“已完成 · 未读”。会话行只保留标题、项目和更新时间：运行中显示旋转图标，完成未读显示蓝点，进入详情后清除蓝点，已读完成不显示状态文字或标记。搜索标题、项目目录名、模式标签和 Agent 名，不向网关发搜索请求；“最近 / 项目”切换与搜索入口位于同一标题操作区。首次启用未读能力时既有完成历史作为已读，之后完成且未打开的会话计为未读，打开详情后按服务端持久清除 |
| `SESSION-003` | 发起新会话 | 已实现 | “新会话”位于进行中/已完成统计同一行右侧，不再遮挡列表；已连接时在全部 Agent Tab、搜索态及最近/项目视图持续显示。Cursor/Claude/Codex Tab 打开表单时默认选中当前 Agent，“全部”沿用最近选择；工作目录可从已同步会话的项目下拉选择（按 `projectId` 去重，展示消歧后的项目名并写入对应 cwd），也可继续手填绝对路径；权限可在表单内选择受限执行 / 自动执行 / 完全允许；网关校验输入、持久化会话/用户事件后启动 Agent，移动端进入全屏详情 |
| `SESSION-004` | 查看会话详情 | 已实现 | 详情标题栏避开原生系统状态栏，更新时间、状态与分支收进副标题行，不再单独占用内容上方一行。网关会话在活动时优先通过 SSE 订阅增量事件（`Last-Event-ID` / `after` 游标、断线重连）；SSE 多次失败时回退约每 1 秒的 JSON 轮询直至终态。原生 Codex 会话仍约每秒读取 snapshot；终态再同步一次后停止。用户/助手正文按安全 Markdown（含 GFM）渲染，原始 HTML 不执行；用户问题在滚过其原始位置后吸附于内容区顶部，并紧贴内容区顶边或运行状态条底边，不保留正文卡片间距；长问题默认折叠为两行并可点击展开/收起，切换问题后重新折叠；下一条用户问题到达时以覆盖动画替换，向上滚动时以反向覆盖恢复对应的上一条；系统启用“减少动态效果”时关闭该动画。用户查看旧内容时新增输出不强制拉回底部。工具调用、审批提示和终止错误单独展示；CLI `stderr` 作为可展开的诊断日志合并展示，默认折叠 |
| `SESSION-005` | 继续网关会话 | 已实现 | 仅当移动端看到已完成/失败（取消当前映射为完成）且已有 `nativeId` 时允许继续；沿用原会话权限模式和 cwd |
| `SESSION-006` | 取消运行中会话 | 已实现 | 运行中/等待确认的网关会话详情提供「取消」按钮，调用 `POST /v1/sessions/:id/cancel`；取消后在详情与列表中显示「已取消」，不再映射为「已完成」 |
| `SESSION-007` | 按项目浏览会话 | 已实现 | 移动端可通过会话标题栏右侧的紧凑控件在“最近 / 项目”间切换；项目优先按 Git 根目录识别，非 Git 目录按规范化 cwd 分组，同名不同路径保持独立。不同 `projectId` 同名时使用最短可区分父路径作为显示标签，benchmark 的重复 `workspace` 显示为“Agent · 任务 · 套件”，把主要区分信息留在省略号之前且不做错误合并；项目和项目内会话均按最近活动排序，每个 Tab 的单个项目最多 20 条，项目可折叠并记忆状态；项目内“新会话”自动预填最近会话的 cwd |
| `SESSION-008` | 同服务端会话摘要缓存 | 已实现 | 已安全恢复凭据且网关 URL 与缓存完全匹配时，移动端先显示最多 200 条上次会话摘要并提示正在同步，随后异步替换为最新数据；缓存不包含 token、cwd、消息正文或事件，其他服务端不得复用该缓存；同步失败保留缓存并提供重试 |
| `FILE-001` | 查看会话生成的本机文件 | 已实现 | 会话正文中的相对路径、绝对路径和 `file://` Markdown 文件链接由移动端改走已认证网关；网关以会话 cwd 为唯一根目录做 realpath 校验，只返回普通文件，拒绝目录、符号链接逃逸、缺失文件和超过 20 MiB 的文件。图片可嵌入正文并全屏查看，PDF/文本在应用内预览，其他类型提供下载；HTTP(S)、锚点和邮件链接仍按外部链接处理 |
| `STREAM-001` | 持久化事件与增量拉取 | 已实现 | 事件写入 SQLite，使用全局递增 `seq`；JSON 接口支持 `after` 读取，默认单次最多 500 条、内部上限 2,000 条 |
| `STREAM-002` | SSE 实时事件 | 已实现 | 网关支持历史补发、事件 id、订阅和 15 秒 heartbeat；移动端网关会话详情优先消费 SSE（`Last-Event-ID` 重连、按 `seq` 去重），连接不可用时回退 JSON 轮询 |
| `APPROVAL-001` | 工具审批展示与处理 | 界面占位 | parser 可识别 approval 类事件，状态变为 `waiting_approval`，移动端提示“等待 Mac 端确认”；没有 challenge/resolve API，也不能在手机批准或拒绝 |

### 3.4 原生历史

| 功能 ID | 功能 | 状态 | 当前行为与边界 |
| --- | --- | --- | --- |
| `HISTORY-001` | 扫描原生会话摘要 | 已实现 | Cursor 优先读取 IDE `composerHeaders`（与侧栏标题/归档一致），缺库时回退 chats/acp；Claude 扫描本机历史；Codex 使用官方 app-server `thread/list`（仅活跃会话，不含 archived）取得与桌面端一致的 `thread.name`，并以最近 24 小时 rollout 的生命周期事件校正跨进程 `notLoaded` 状态，失败时回退 `~/.codex/sessions` JSONL。所有 cwd 的历史均可见，白名单外记录标记为只读，不能从手机续接或启动 Agent |
| `HISTORY-002` | 查看原生历史消息 | 受限实现 | Claude/Codex/Cursor 均返回用户和助手文本（剔除工具块与已知注入上下文，截断过长文本）。Cursor 从 `~/.cursor/projects/*/agent-transcripts/<id>/<id>.jsonl` 读取，并剥离 `<user_query>` / `<timestamp>` 包装。运行中的原生 Codex 详情约每秒重读最新消息并在终态后停止，属于近实时轮询而非 SSE 推送；缺 transcript 的旧 Cursor 记录仍为空 |
| `HISTORY-003` | 续接原生会话 | 受限实现 | Claude、Codex 和新版 Cursor Glass/composer 会话可续接；旧 Cursor `acp-sessions` 和白名单外记录只读。列表不再占用一行显示“原生历史 / 只读记录”；不可续接时详情底部输入框显示“仅查看”并保持禁用。续接后创建一个新的网关会话承载事件 |

### 3.5 移动运行时、设置与交付

| 功能 ID | 功能 | 状态 | 当前行为与边界 |
| --- | --- | --- | --- |
| `MOBILE-001` | 移动运行时与自适应交互 | 已实现 | 支持 iPhone/Pixel 10 外壳、状态栏、安全区、模拟键盘、滚动、Carousel、FlowStack、BottomSheet 和拖动抑制；Android/iOS 原生系统栏固定使用适配深色应用背景的浅色时间、网络和电量图标，并保留 SystemBars 安全区；原生 iOS WebView 固定使用 mobile content mode 与设备宽度 viewport，避免横向裁切；Universal iOS target 支持 iPhone/iPad，完整 iPad 窗口在横竖屏中使用居中的 760pt 可读工作区，并同步约束底部导航、会话详情、sheet 与新会话入口；28 个文件由 runtime lock 保护 |
| `MOBILE-002` | iOS/Android 安全凭据 | 已实现 | iOS 用 `AfterFirstUnlockThisDeviceOnly` Keychain；Android 用不可导出 Keystore AES-256-GCM 密钥加密私有 SharedPreferences；允许的 key 固定为旧版 URL/token 与版本化连接库，不接受客户端任意 key |
| `MOBILE-003` | Android 系统返回导航 | 已实现 | Android 返回键/返回手势按层级依次关闭键盘、底部 sheet、会话详情或搜索；位于首页时最小化应用。详情左上角仍保留放大的可视返回按钮；Web/iOS 行为不变 |
| `SETTING-001` | 默认受限执行开关 | 已实现 | 默认开启，影响之后新建或从原生历史续接的会话；Web 使用 `localStorage`，原生使用安全存储键 `remote-agent.app.preferences.v1` |
| `SETTING-002` | Agent 状态通知开关 | 受限实现 | 设置页可切换且默认开启，并随偏好持久化；尚无浏览器通知、APNs 或 FCM 行为 |
| `DIST-001` | Web/Sites 构建 | 已实现 | Vite 构建静态客户端并生成 Sites worker/hosting 文件；缺失静态资源不回退，未知 GET 页面路由回退 app shell，API/write 请求不回退 |
| `OPS-001` | launchd 后台服务 | 已实现 | 构建后复制运行时到 `~/.remote-agent/runtime`，安装/启动用户 LaunchAgent，提供 status/uninstall；内测配置监听 `0.0.0.0`，卸载保留 SQLite 与日志 |

## 4. 核心用户流程与验收口径

### 4.1 首次配对

前置条件：Mac 网关已启动；用户能在 Mac 本机运行 `npm run pair`；移动设备可以访问网关地址。

1. Mac 生成 6 位一次性码和过期时间。
2. 用户在移动端填写网关 URL 与 6 位码。
3. 网关验证格式、有效期、一次性消费和每地址 10 次/分钟的尝试限制。
4. 成功后创建独立设备记录，只存 token hash；明文 token 只返回一次。
5. 移动端安全保存凭据，加载主状态，并显示 Mac hostname、连接安全级别和会话。

验收必须同时覆盖：有效码成功、错误/过期/复用码失败、非回环地址不能生成码、无 token 的受保护请求为 401，以及 token 不以明文写入 SQLite/日志。

### 4.2 浏览和查找会话

1. 已配对移动端先检查与当前网关 URL 精确匹配的会话摘要缓存；命中时立即展示并标注“正在同步”，未命中时显示加载态。
2. 移动端并行获取网关会话、原生历史、网关配置和设备列表；成功后原子替换缓存数据并更新时间。
3. 合并两类会话，先对 `agent:nativeId` 去重，再按 `source + agent + session id` 去除网关或原生扫描中的重复记录。
4. 合并结果按原始 `updatedAt` 降序；用户可在“最近 / 项目”视图间切换，按 Agent 过滤或按可见元数据搜索。项目按最近会话排序，折叠状态保存在当前设备。
5. 断开状态不得展示模拟会话；必须保留明确连接入口。同步失败时允许保留同服务端旧缓存，但必须清晰标注缓存状态和失败提示。

验收必须覆盖：三种 Agent 的过滤、项目分组/折叠、同名不同路径、Git 子目录归组、缓存命中/未命中/服务端不匹配、后台同步成功/失败、空结果、断开态、同一原生会话去重，以及白名单外历史可见但不可续接。

### 4.3 新建会话

1. 用户输入非空 prompt、选择已有项目或填写 Mac 上存在的绝对 cwd、Agent 和默认权限。
2. 网关再次验证 agent、permission、长度和 cwd；前端校验不能替代网关校验。
3. 网关先创建 `queued` 会话和用户事件，再切到 `running` 并启动固定 adapter。
4. 移动端关闭 sheet，进入全屏详情并增量读取输出。
5. executable 缺失、cwd 越界、CLI 启动失败或协议错误都必须显示可理解错误，且不得泄漏 secret。

### 4.4 查看与继续会话

1. 网关会话详情从 `after=lastSeq` 拉取新事件，并同步最新状态；原生 Codex 详情通过 snapshot 接口同步日志推断状态和最近消息，运行期间禁止并发续接。
2. 连续的 assistant delta/stdout 合并显示；工具、审批提示和终止错误单独呈现；连续 `stderr` 合并为默认折叠的诊断日志。
3. 只有可续接且没有活动进程的会话才能再次启动 Agent。
4. 每条用户问题作为对应回答段落的吸顶锚点；超过两行时默认折叠，点击可展开/收起，切换到其他问题时恢复折叠；滚动到下一条问题时用向上的短促覆盖动画切换吸顶内容，反向滚动时以相反方向恢复上一条；系统偏好减少动态效果时直接替换。活动会话仅在用户仍接近底部时自动跟随新输出。
5. 继续指令记为新的用户事件；同一网关会话保留 id，原生历史续接则生成新网关会话。
6. Markdown 本机文件链接不直接交给手机浏览器；移动端按当前网关/原生历史会话请求受控文件流。相对路径以会话 cwd 解析，绝对路径与 `file://` 也必须落在同一 cwd 内；图片、PDF、文本可预览，其他普通文件可下载。

验收必须覆盖：增量事件不重复、连续 delta 合并、多轮用户问题正向/反向吸顶切换、查看旧内容时不被新输出拉回底部、文件相对/绝对/`file://` 路径、内联图片、文本预览、缺失/越界/超限拒绝、失败后可续接、缺少 `nativeId` 时禁用、运行中不能并发继续。

### 4.5 设备管理

- 首页断开态只保留会话空态中的一个“连接 Mac”主入口；标题右侧用状态灯和单行连接名作为设备管理入口，不重复同名操作，也不展示设备图、连接说明或箭头；未在线时不展示新会话悬浮按钮。
- 设备管理 sheet 必须保留可触达的显式关闭按钮，不能只依赖遮罩或拖拽关闭。
- 配对新 Mac 后追加或更新对应 origin 的连接并设为当前连接；最多保留最近使用的 8 条。
- 应用启动恢复 activeId 指向的上次连接；用户可在设备页查看已保存名称/origin 并切换，切换后使用该服务端独立的会话摘要缓存并后台刷新。
- 本机移除只清理当前 Mac 的本地凭据，不删除服务端设备记录；若仍有连接则自动选择最近使用的一台。
- 撤销其他设备后，该设备下一次请求必须变为 401。
- 撤销当前设备后必须清理当前本地连接；若仍有其他连接则自动切换，否则回到断开态。
- 撤销服务端授权前必须二次确认，避免误触。

验收必须覆盖：旧单连接迁移、添加第二台 Mac、切换后重启仍恢复上次连接、不同服务端缓存隔离、移除当前项自动回退和最后一项移除回到单一连接入口。

## 5. 业务规则

### 5.1 统一枚举

- Agent：`cursor | claude | codex`
- 权限：`plan | ask | auto | full`
- 会话：`queued | running | waiting_approval | completed | failed | cancelled`
- 事件：`status | output | tool | approval | completed | error`

字段级定义和兼容规则见 [`../reference/protocol-contract.md`](../reference/protocol-contract.md)。

### 5.2 状态展示映射

| 网关状态 | 当前移动端状态 | 展示 |
| --- | --- | --- |
| `queued`, `running` | `running` | 运行中 |
| `waiting_approval` | `attention` | 等待确认 |
| `completed` | `done` | 已完成 |
| `cancelled` | `cancelled` | 已取消 |
| `failed` | `failed` | 失败 |

改变映射时必须同步协议文档、产品流测试和追踪矩阵；不得只改颜色或文案。

### 5.3 标题、排序和限制

- 新网关会话标题来自 prompt 的折叠空白版本，超过 60 字符时截断为 59 字符加省略号。
- Codex 原生标题优先使用 app-server 的 `thread.name`，与 Codex 桌面端一致；JSONL 回退标题清除注入型上下文并限制为 80 字符。原生消息文本限制为 20,000 字符。
- 网关会话按 `updatedAt` 降序；移动端合并后按相对时间重新排序。相对时间只有“刚刚/分钟/小时/天”，不是精确时间。
- HTTP body 默认不超过 1 MiB；prompt 不超过 50,000 字符；cwd 不超过 4,096 字符；设备名不超过 80 字符。
- 会话 API 最多返回 250 条；原生历史最多返回 2,000 条，并在网关按每个 Agent/项目 20 条预裁剪；最近视图只展示 20 条。

## 6. 非功能要求

### 6.1 安全

- 默认回环监听、Bearer 认证、精确 CORS、真实路径白名单、固定进程参数、token hash 和原生安全存储属于不可回退约束。
- HTTP 只适合受控本地网络；公网必须 TLS，并完成 [`../security.md`](../security.md) 的上线清单。

### 6.2 可靠性

- SQLite 开启 WAL 和外键；会话事件先持久化再发布给订阅者。
- 子进程退出必须产生完成、失败或取消结果；网关 SIGINT/SIGTERM 时先取消活动进程再关闭数据库。
- 外部 CLI JSONL、历史文件和 HTTP body 都视为不可信输入，应有格式和大小边界。

### 6.3 可访问性与移动体验

- 交互控件必须具备可识别的 label/状态；动态输出使用 live region，错误使用 alert。
- 文本输入必须使用键盘感知组件；fixed chrome、safe area、Android 导航栏和 iOS home indicator 的约束以移动端 `AGENTS.md` 为准。
- iPhone 与 Pixel 10 都是移动运行时变更的验收设备。

## 7. 已知缺口与演进顺序

以下均不是已交付功能：

### 7.1 ACP 长期 Agent 协议（Issue #1）

1. 用长期 Agent 协议替代短进程 CLI，并实现结构化 approval challenge/resolve。  
   - **Phase 0（已完成）**：调研文档 [`architecture/acp-phase0.md`](../architecture/acp-phase0.md)——各 Agent ACP 启用方式、TS SDK 可行性、事件映射、`REMOTE_AGENT_ROOTS` 安全边界、Phase 1 单 Agent PoC 建议（**Claude + `@agentclientprotocol/claude-agent-acp`**，失败回退现有 `claude` 短进程 adapter）。  
   - **Phase 1（未开始）**：网关内最小 ACP Client，单 Agent PoC，事件写入现有 SQLite/SSE。  
   - **Phase 2（未开始）**：多 Agent、手机 approval resolve、旧 CLI 降级为回退路径。

2. 接入 APNs/FCM、深链、后台恢复和锁屏隐私（含 `SETTING-002` 的真实通知行为）。
3. 完成生产 TLS、审计脱敏、依赖扫描、正式签名和密钥轮换。
4. 会话合并改用原始 `updatedAt` 精确排序。

实现任一缺口时，应先把对应功能状态和验收标准改为目标行为，再修改代码；若引入新能力，分配新的稳定功能 ID，已发布 ID 不复用。同步更新 [`feature-guide.md`](feature-guide.md) 中面向人的说明。
