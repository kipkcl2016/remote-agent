# 变更验收记录：项目分组与会话摘要缓存

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-11 |
| 执行人 | Codex |
| 分支 / commit | 本地工作区，未创建 commit |
| 最终结论 | PASS WITH LIMITATIONS |

## 目标与范围

- 目标：跨 Cursor、Claude、Codex 按项目浏览会话；同一网关重连时先显示上次摘要缓存并异步刷新。
- 明确不做：不缓存 token、cwd、消息正文或事件；不改变配对、权限、Agent 启动和续接语义。
- 关联功能 ID：`SESSION-001`、`SESSION-007`、`SESSION-008`、`CONN-001`。
- 功能状态变化：`SESSION-007: 规划中 → 已实现`；`SESSION-008: 规划中 → 已实现`。

## 规范与兼容性

- 更新的 SSOT：功能规格、协议契约、架构、功能验收矩阵。
- 协议兼容性：向后兼容；会话响应新增可选 `projectId/projectName`，旧客户端忽略，新客户端在旧网关上回退到 cwd 哈希分组。
- 安全边界变化：无认证或目录授权放宽。项目 ID 是规范化项目路径的 SHA-256；移动缓存排除 token、cwd、消息和事件，并按网关 origin 精确隔离。
- 架构或数据迁移：无 SQLite 迁移；回滚移动端和网关代码即可，旧缓存键可被安全忽略。

## 变更前基线

| 命令/检查 | 结果 | 备注 |
| --- | --- | --- |
| `git status --short` | 仓库基线文件均为未跟踪状态 | 保留现有工作区，未清理或覆盖无关文件 |
| 网关 `npm test` | PASS，13/13 | 新增项目识别前基线 |
| 移动端既有门禁 | PASS | 上一版本 12 项交互、4 项站点测试通过 |

## 自动化验收

| 门禁 | 命令 | 结果与测试数 |
| --- | --- | --- |
| G0 规范与追踪 | 文档/矩阵检查 | PASS，新增并闭环 `SESSION-007/008` |
| G1 网关 | `npm run verify` | PASS，typecheck + 14/14 tests + build |
| G2 移动构建 | `check:runtime`、`build`、`test:sites` | PASS，runtime 28 文件；Sites 4/4 |
| G3 移动交互 | `npm run test:runtime` | PASS，16/16；含分组、缓存命中/隔离/失败恢复 |
| G4 安全 | 项目解析与缓存负向断言 | PASS，越界 cwd 拒绝；同名路径不合并；缓存不含 token/cwd |
| G5 原生 | `native:sync`、Gradle unit/assemble、iOS simulator build | PASS，Android APK 和 iOS Simulator App 均构建成功 |
| G6 运维/网络 | 已授权 `service:install` + `service:status` | PASS，LaunchAgent 更新后为 running |

## 人工验收

| 场景（Given/When/Then） | 环境 | 结果 | 证据 |
| --- | --- | --- | --- |
| 已安装网关更新后查询项目字段 | 本机 LaunchAgent | PASS | 服务状态 running；协议集成测试同时覆盖响应字段 |
| v0.4.0 Android 覆盖安装并检查真实项目卡片 | Android 真机 | 未执行 | 验收时 USB 设备已不在 ADB 列表 |
| iOS 原生工程可编译 | iOS 26.5 Simulator SDK | PASS | `xcodebuild` 输出 `BUILD SUCCEEDED` |

## 未执行项与剩余风险

- 未执行：Android 真机安装、项目卡片/缓存提示视觉截图和真实重启缓存命中。
- 原因：构建完成时已连接手机从 ADB 列表断开。
- 影响：代码、协议和原生构建门禁均通过，但最终结论保留真机视觉与冷启动人工限制。
- 后续动作：手机重新连接并解锁后，安装本地构建的 Android Debug APK，切换“项目”视图并重启应用验证缓存提示。

## 最终结论

结论：`PASS WITH LIMITATIONS`

依据：项目识别、跨 Agent 分组、折叠记忆、项目内新会话、缓存优先渲染、服务端隔离和失败重试均有端到端自动化证据；网关、Web、Android 构建和 iOS 模拟器构建通过。仅剩 Android 真机安装与视觉/冷启动检查因 USB 断开未执行。
