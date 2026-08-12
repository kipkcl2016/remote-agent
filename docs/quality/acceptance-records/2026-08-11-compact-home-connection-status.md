# 变更验收记录：首页紧凑连接状态

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-11 |
| 执行人 | Codex |
| 分支 / commit | 本地工作区，未创建 commit |
| 最终结论 | PASS WITH LIMITATIONS |

## 目标与范围

- 目标：删除首页标题下方独立设备行，只把连接状态灯和当前连接名放在“远程 Agent”标题最右侧；继续保留设备管理入口。
- 明确不做：不修改网关协议、连接存储、配对、缓存、Agent 会话或设备管理内容。
- 关联功能 ID：`CONN-001`、`DEVICE-004`、`MOBILE-001`。
- 功能状态变化：无。

## 规范与兼容性

- 更新的 SSOT：`docs/product/functional-spec.md`、`docs/quality/feature-matrix.md`、移动端持久交互规则。
- 协议兼容性：不涉及，纯客户端视觉与交互布局调整。
- 安全边界变化：无。连接安全级别仍在设备管理中可见。
- 架构或数据迁移：无；回滚只需恢复原首页设备行 JSX/CSS。

## 变更前基线

| 命令/检查 | 结果 | 备注 |
| --- | --- | --- |
| `git status --short` | 仓库基线文件为未跟踪状态 | 保留既有工作区，未清理无关文件 |
| 参考截图检查 | PASS | 已打开用户提供的 664 × 220 标注截图 |

## 自动化验收

| 门禁 | 命令 | 结果与测试数 |
| --- | --- | --- |
| G0 规范与追踪 | 文档、矩阵、Design QA | PASS；`design-qa.md` 最终结果为 `passed` |
| G1 网关 | 网关验证 | 不涉及，网关未改 |
| G2 移动构建 | `npm run check:runtime && npm run build`；`npm run test:sites` | PASS；runtime 28 文件、TypeScript/Vite/Sites build、Sites 4/4 |
| G3 移动交互 | iOS `testDisconnectedHomeHasOneConnectionEntry` | PASS，1/1；状态入口打开设备管理并可显式关闭 |
| G4 安全 | 安全负向测试 | 不涉及，认证与凭据未改 |
| G5 原生 | iOS Simulator build；Android `assembleDebug` | PASS，iOS `BUILD SUCCEEDED`，Android `BUILD SUCCESSFUL` |
| G6 运维/网络 | launchd/网络变更检查 | 不涉及 |

## 人工验收

| 场景（Given/When/Then） | 环境 | 结果 | 证据 |
| --- | --- | --- | --- |
| 已连接 Mac，首页只显示标题、状态灯和单行连接名，下一分区上移 | iPhone Simulator（型号已泛化） | PASS | 本地验收证据（未随源码发布） |
| 标注源图与新标题区并排检查，独立设备图、说明、锁图标和箭头消失 | 归一化对比 | PASS | 本地验收证据（未随源码发布） |
| 覆盖安装新版 APK，首页标题与连接名同行，点击状态入口打开设备管理 | Android 真机（设备标识已脱敏） | PASS | 本地验收证据（未随源码发布） |

## 未执行项与剩余风险

- 未执行：本次未直接调用 Playwright CLI 的完整 `npm run test:runtime`。
- 原因：Product Design 工作流要求只使用用户选择的浏览器；当前在应用内浏览器没有可用的自动控制接口，未擅自切换到独立 Playwright 浏览器。
- 影响：更新的网页布局断言已写入 `tests/product-flow.spec.ts` 但未在本轮执行；TypeScript/Vite 构建、iOS 原生交互测试和 Android 真机点按已覆盖本次变更核心路径。
- 后续动作：如需补齐完整 G3，可在用户允许直接使用 Playwright CLI 后执行 `npm run test:runtime`。

## 最终结论

结论：`PASS WITH LIMITATIONS`

依据：首页紧凑状态入口已在 iOS connected/disconnected 状态和 Android 真机上验证，设备管理入口保持可用，双端原生构建、运行时锁和 Sites 测试通过；限制仅为本轮未运行独立 Playwright 全量产品流。
