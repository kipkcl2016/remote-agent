# 变更验收记录：紧凑会话行与状态标记

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-11 |
| 执行人 | Codex |
| 分支 / commit | 本地工作区，未创建 commit |
| 最终结论 | PASS |

## 目标与范围

- 目标：从会话列表移除“原生历史 / 只读记录”、权限模式和“已完成 / 未读”文字，把会话行压缩为标题、项目和更新时间；运行中显示旋转图标，完成未读显示蓝点，查看后隐藏。
- 目标：不可续接或暂不可操作时，在详情底部输入框说明原因并禁用输入；只读历史显示“仅查看”。
- 明确不做：不改变服务端会话状态、未读持久化、完成时间、续接授权或顶部状态汇总。
- 关联功能 ID：`SESSION-002`、`SESSION-005`、`HISTORY-001`、`HISTORY-003`、`MOBILE-001`。

## 自动化验收

| 门禁 | 命令 | 结果与测试数 |
| --- | --- | --- |
| G0 规范与追踪 | 功能规格、功能矩阵、移动端持久交互规则 | PASS |
| G2 移动构建 | `npm run check:runtime`、`npm run build`、`npm run test:sites` | PASS；runtime 28 文件，Sites 4/4 |
| G3 移动交互 | `npm run test:runtime` | PASS，22/22；覆盖紧凑行、运行状态、未读蓝点、查看后清除及只读 composer |
| G5 Android | `npx cap copy android`、`./gradlew assembleDebug`、ADB 覆盖安装 | PASS；`BUILD SUCCESSFUL`，真机安装成功 |
| G5 iOS | `npx cap copy ios`、iPhone Simulator `xcodebuild` | PASS；Universal target `BUILD SUCCEEDED`，产物同时声明 iPhone/iPad |

## 视觉与原生验收

| 场景 | 环境 | 结果 | 证据 |
| --- | --- | --- | --- |
| 完成未读会话只显示蓝点，已读完成会话无状态标记，行内无来源/权限/完成文字 | Android 真机（设备标识已脱敏） | PASS | 本地验收证据（未随源码发布） |
| 断开态标题、筛选和安全区在窄屏正常 | iPhone Simulator（型号已泛化） | PASS | 本地验收证据（未随源码发布） |
| Universal 布局保持可读工作区且底栏对齐 | iPad Simulator（型号已泛化） | PASS | 本地验收证据（未随源码发布） |
| 只读历史进入详情后显示“仅查看”并禁用输入 | Playwright iPhone 视口 | PASS | `product-flow.spec.ts` 的 `HISTORY-001/HISTORY-003` 回归用例 |

## 交付物

- Android Debug APK：本地构建产物（不随源码发布）
- 构建校验信息仅保存在本地验收环境。

## 剩余说明

- Android 真机保存的网关地址当前不可达，因此真机使用上次缓存核对会话列表；在线详情的只读输入状态由完整产品流测试覆盖。
- 首次覆盖安装后 WebView 有一次性资源准备延迟；再次冷启动 4 秒内已完整显示首页，本轮变更未引入持续启动阻塞。

## 最终结论

结论：`PASS`

依据：状态展示、未读生命周期和只读输入均有端到端断言；Web、Android、iPhone 与 iPad 构建/运行检查均通过，安卓真机会话列表视觉符合目标。
