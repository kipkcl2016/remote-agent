# 变更验收记录：iOS Simulator 原生完整 E2E

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-11 |
| 执行人 | Codex |
| 分支 / commit | 本地工作区，未创建 commit |
| 最终结论 | PASS |

## 目标与范围

- 目标：使用 Xcode/iPhone Simulator 完整验证原生配对、会话浏览和操作、多 Mac、安全凭据与缓存恢复，并留存可复跑的 XCUITest。
- 明确不做：不连接真实公网、不启动真实 Cursor/Claude/Codex 进程、不改变网关生产协议、不把 Simulator 结果替代 Android 或 iOS 真机发布验收。
- 关联功能 ID：`PAIR-002`、`DEVICE-002`、`DEVICE-004`、`SESSION-002`、`SESSION-003`、`SESSION-004`、`SESSION-005`、`SESSION-008`、`MOBILE-001`、`MOBILE-002`。
- 功能状态变化：无；本次补齐原生自动化和 Simulator 验收证据。

## 规范与兼容性

- 更新的 SSOT：功能规格、功能验收矩阵、根 README 和移动端持久交互约束。
- 协议兼容性：不涉及生产协议变更。测试 fixture 遵循现有 `{data}` / `{error}` envelope，只在测试进程暴露 `__pairing-code` 与 `__control`。
- 安全边界变化：配对码输入改为密码字段；fixture 只监听 `127.0.0.1`，每次运行动态生成配对码和 token，日志不输出二者。
- 架构或数据迁移：无。iOS Debug 环境仅在显式传入 `REMOTE_AGENT_UI_TEST_RESET_SECURE_STORE=1` 时清理三项固定测试凭据；Release 不包含该执行分支。

## 变更前基线与发现

| 检查 | 结果 | 备注 |
| --- | --- | --- |
| `git status --short` | 仓库基线文件均为未跟踪状态 | 保留既有工作区，未清理无关文件 |
| iOS XCUITest 空状态 | PASS | 断开态无模拟会话，只有一个“连接 Mac”入口 |
| 首次完整原生流程 | FAIL 后修复 | 发现 WKWebView 内容以约 536pt 布局在 402pt 屏幕，搜索/标签/按钮被横向裁切；另发现全屏设备 sheet 缺少稳定关闭入口 |

修复后 iOS 显式使用 mobile content mode，并把 viewport 固定为设备宽度；设备管理 sheet 增加右上角关闭按钮。截图确认页面不再横向溢出。

## 自动化验收

| 门禁 | 命令 | 结果与测试数 |
| --- | --- | --- |
| G0 规范与追踪 | 文档/矩阵检查 | PASS，功能 ID、实现锚点、测试索引和剩余缺口已同步 |
| G1 网关 | `cd macos-agent-gateway && npm run verify` | PASS，typecheck + 14/14 tests + build |
| G2 移动构建 | `npm run check:runtime && npm run build && npm run test:sites` | PASS，runtime 28 文件；Vite build；Sites 4/4 |
| G3 移动交互 | `npm run test:runtime` | PASS，Playwright 18/18 |
| G4 安全 | iOS 错误配对 + 日志/fixture 检查 | PASS，无效码停留在配对页；安全字段在 XCTest 日志中显示 `<redacted>`；fixture 不持久化或记录 secret |
| G5 原生 | `npm run test:ios:simulator` | PASS，iPhone Simulator / iOS Simulator SDK，XCUITest 3/3、0 失败 |
| G6 运维/网络 | 不适用 | 使用回环测试 fixture，未安装服务或改变真实网关状态 |

## 原生 E2E 场景

| Given / When / Then | 结果 | 证据 |
| --- | --- | --- |
| 无凭据冷启动时，不展示模拟会话且只有一个连接入口 | PASS | 本地验收证据（未随源码发布） |
| 输入无效一次性码时，显示过期/无效错误且不保存连接 | PASS | 本地验收证据（未随源码发布） |
| 成功配对第一台 Mac 后，显示 Cursor/Codex fixture 会话 | PASS | 本地验收证据（未随源码发布） |
| 切换 Codex、按标题搜索、创建会话后进入全屏详情并渲染 Markdown；继续指令显示后续结果 | PASS | 本地验收证据（未随源码发布） |
| 添加第二台 Mac 后切为当前连接，只显示该服务端的 Claude 会话 | PASS | 本地验收证据（未随源码发布） |
| 终止应用再启动时，从 Keychain 恢复上次连接，先显示对应缓存和 loading，再异步刷新 | PASS | 本地验收证据（未随源码发布） |
| 切回第一台、逐台移除后正确回退；移除最后一项回到断开态 | PASS | 本地验收证据（未随源码发布） |

完整结果包仅保存在本地验收环境，不随源码发布。

## 未执行项与剩余风险

- 未执行：Android 原生安全存储 E2E；iOS 真机网络切换、后台长时间恢复、坏 Keychain 数据和 8 条连接上限。
- 原因：本次任务范围是 iOS Simulator 完整功能验证，测试使用本机回环双网关 fixture。
- 影响：不影响本次 Simulator E2E 的 PASS 结论，但不构成 App Store/生产就绪或双平台真机结论。
- 后续动作：在发布候选包上补 Android Keystore 与 iOS 真机网络/后台/损坏数据测试。

## 回滚

- 产品层可回滚 viewport/content mode、配对字段遮罩和设备 sheet 关闭按钮。
- 测试层可删除 `RemoteAgentUITests` target、共享 scheme、fixture 与 runner；不涉及数据库迁移或真实设备授权。

## 最终结论

结论：`PASS`

依据：iOS Simulator 3 条原生 XCUITest 全部通过，覆盖主流程、无效配对负向路径和冷启动恢复边界；Web/Sites 22 项与网关 14 项回归同时通过，关键状态均有脱敏截图和可在 Xcode 中打开的结果包。
