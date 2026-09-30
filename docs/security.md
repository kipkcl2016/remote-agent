# 安全模型与部署要求

> 本文是认证、网络、目录、凭据和进程权限的安全 SSOT。产品状态见
> [`product/functional-spec.md`](product/functional-spec.md)，字段级认证与输入边界见
> [`reference/protocol-contract.md`](reference/protocol-contract.md)。安全相关代码变更必须执行
> [`quality/change-and-acceptance.md`](quality/change-and-acceptance.md) 的 G4 门禁。

## 默认边界

- 网关默认只监听 `127.0.0.1:17821`。
- 配对码只能从 Mac 本机的回环连接生成，5 分钟过期且只能使用一次。
- 移动端以密码字段遮罩配对码输入；测试、截图和持久日志不得包含配对码或明文设备 token。
- 网关数据库目录权限为 `0700`，设备令牌只保存 SHA-256 哈希，数据库文件权限为 `0600`。
- 任务工作目录必须位于 `REMOTE_AGENT_ROOTS` 指定的真实路径内；符号链接逃逸会被拒绝。
- 会话文件接口必须先认证并重新校验会话 cwd；请求文件 realpath 后必须仍在该 cwd 内，只允许不超过 20 MiB 的普通文件。文件路径不得写入错误响应、持久日志或缓存，目录、设备文件和符号链接逃逸均拒绝。
- Agent 子进程不经过 shell，客户端无法覆盖可执行文件或任意追加 CLI 参数。
- 原生历史标题和消息可返回白名单外的记录；续接、启动和会话文件读取仍必须重新通过 `REMOTE_AGENT_ROOTS`，不能因历史可见而扩大执行或文件权限。
- CORS 只允许 `REMOTE_AGENT_ALLOWED_ORIGINS` 中的来源。
- 每台移动设备使用独立令牌；已配对设备可查看授权列表并在服务端撤销任意设备。
- iOS 原生连接库使用 Keychain 的 `AfterFirstUnlockThisDeviceOnly` 访问级别；Android 使用 Android Keystore 中不可导出的 AES/GCM 密钥加密应用私有存储。连接库最多保存 8 个网关 origin/token，记录 activeId、Mac 名称和最后使用时间；原生插件只接受固定的版本化连接库 key 及迁移期旧 URL/token key。

## 跨设备连接

默认回环监听适合 Mac 本机浏览器联调。真实 iOS/Android 设备推荐以下两种方式之一：

1. 私有覆盖网络：Mac 与手机加入同一个受信任网络，并通过 HTTPS Serve/代理转发到 `127.0.0.1:17821`。
2. HTTPS 反向代理：TLS 在 Mac 或受管边缘终止，代理只转发到本机回环端口，并额外限制来源/IP。

若显式设置 `REMOTE_AGENT_HOST=0.0.0.0`，必须同时保证网络隔离和 TLS。普通 HTTP 只适合受控的本地联调，不具备链路加密，移动端会明确显示“已配对 · 本地网络”。

`npm run service:install` 创建的 launchd 内测服务会显式监听 `0.0.0.0`。它只适用于受信任的私有网络，不能直接暴露到公网。若白名单项目位于 `Desktop`、`Documents` 或 `Downloads`，macOS TCC 可能阻止后台 Node/Agent 访问；需授予安装输出中的 Node 路径“完全磁盘访问权限”，或使用 `~/Projects` 等非受保护目录。

## 当前已知限制

- Web 联调版仍把设备令牌放在 `localStorage`，不要把 Web 版用于不受信任的共享浏览器。
- 多连接升级会在首次成功读取后把旧版单 URL/token 原子迁移到版本化连接库；写入新库失败时保留旧凭据，避免凭据丢失。
- Cursor 的 `acp-sessions/store.db` 和 `chats/*/*/store.db` 是内部内容寻址结构；网关不解析其中的消息正文。Cursor 列表现优先读取 IDE `state.vscdb` 的 `composerHeaders` 索引（标题、归档状态、工作区路径）；Glass/composer 会话默认可续接（仍受白名单约束）。正文从 `~/.cursor/projects/*/agent-transcripts` 的 JSONL 读取用户/助手文本。Composer DB 不可用时才回退 `meta.json` 扫描；旧版 `acp-sessions` 在回退路径下保持只读。
- Claude/Codex 原生 JSONL 只规范化用户与助手文本，工具的完整参数不会作为历史消息返回。
- 实时事件当前会把部分 CLI 工具 input 和 approval 原始对象写入 SQLite 并返回已认证移动端，尚未建立独立字段白名单、脱敏和大小限制；不要把现有事件库用于高敏感会话。
- `ask` 模式仍以非交互式受限执行代替逐工具审批；需要长期 Agent 协议后才能提供手机端逐项批准。
- `full`（完全允许）会放宽 CLI 侧工具/命令确认（Cursor `--force`、Claude bypass、Codex danger-full-access），但仍不能绕过 `REMOTE_AGENT_ROOTS` 工作目录白名单；只适用于受信任内测场景。
- 内测包尚未接入 APNs/FCM、锁屏隐私控制与应用商店签名流程。
- 文件预览通过当前设备 Bearer token 按需读取，不做离线持久缓存；普通 HTTP 局域网连接上的文件内容不具备链路加密，仍只适用于受控内测。

## 上线前必须完成

- TLS、审计日志脱敏、依赖漏洞扫描与正式签名/密钥轮换流程。
- Agent 二进制路径固定/签名校验与版本兼容矩阵。
- 对 tool input/output、上传文件和会话消息实施独立大小限制与敏感信息策略。
- 在真实 iOS/Android 设备上验证后台恢复、网络切换、推送和锁屏隐私。

完成上述列表前，验收结论不得使用“生产就绪”或“可直接暴露公网”。每次安全变更还必须在
[`quality/feature-matrix.md`](quality/feature-matrix.md) 中更新对应功能的负向测试和人工证据。
