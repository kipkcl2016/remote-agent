# 变更验收记录：多 Mac 连接与首页入口精简

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-11 |
| 执行人 | Codex |
| 分支 / commit | 本地工作区，未创建 commit |
| 最终结论 | PASS WITH LIMITATIONS |

## 目标与范围

- 目标：首页断开态只保留一个“连接 Mac”主入口；安全保存多条 Mac 连接，启动恢复上次使用项，并允许在设备页新增、切换或移除。
- 明确不做：不改变网关认证协议、服务端设备授权、Agent 权限或进程生命周期；不把 Web `localStorage` 描述为生产安全存储。
- 关联功能 ID：`PAIR-002`、`DEVICE-002`、`DEVICE-004`、`SESSION-008`、`MOBILE-002`。
- 功能状态变化：`DEVICE-002: 规划中 → 已实现`；`DEVICE-004: 规划中 → 已实现`。

## 规范与兼容性

- 更新的 SSOT：功能规格、架构、安全模型、功能验收矩阵、根 README 和移动端持久交互约束。
- 协议兼容性：网关 HTTP 协议不变；客户端存储处于迁移期，首次读取旧 URL/token 后写入版本化连接库并删除旧 key。
- 安全边界变化：iOS/Android 原生插件新增一个固定允许的连接库 key；iOS 仍使用 Keychain，Android 仍使用 Keystore AES/GCM；连接库最大 32 KiB、最多 8 项。
- 架构或数据迁移：有。回滚旧客户端不会读取新连接库；迁移前的旧 key 在新库成功写入后会删除，因此回滚需重新配对。

## 变更前基线

| 命令/检查 | 结果 | 备注 |
| --- | --- | --- |
| `git status --short` | 仓库基线文件均为未跟踪状态 | 保留既有工作区，未清理或覆盖无关文件 |
| `npm run build` | PASS | 首次多连接实现可通过 TypeScript 与 Vite 构建 |
| `npm run test:runtime` | 15/16 PASS | 唯一旧断言仍期待已移除的第二个“连接 Mac”悬浮入口，随后按新规格更新 |

## 自动化验收

| 门禁 | 命令 | 结果与测试数 |
| --- | --- | --- |
| G0 规范与追踪 | 文档/矩阵检查 | PASS，`DEVICE-002/004` 已闭环为已实现 |
| G1 网关 | `cd macos-agent-gateway && npm run verify` | PASS，typecheck + 14/14 tests + build；协议未改 |
| G2 移动构建 | `check:runtime && build && test:sites` | PASS，runtime 28 文件；Sites 4/4 |
| G3 移动交互 | `npm run test:runtime` | PASS，18/18；含单一入口、迁移、新增、切换、重载恢复、移除回退和缓存隔离 |
| G4 安全 | 存储迁移与缓存负向断言 | PASS，旧 key 成功迁移后清除；会话缓存不含 token/cwd；原生插件拒绝任意 key |
| G5 原生 | `native:sync`、Gradle `testDebugUnitTest assembleDebug`、iOS Simulator build | PASS；Android 使用 Corretto 21 和本机 SDK；iOS 输出 `BUILD SUCCEEDED` |
| G6 运维/网络 | 网关服务变更检查 | 不涉及；本次未修改或重装 launchd 服务 |

## 人工验收

| 场景（Given/When/Then） | 环境 | 结果 | 证据 |
| --- | --- | --- | --- |
| 已保存两台 Mac，打开设备页时展示当前项、另一项、切换/新增/移除入口 | iPhone Web 预览 | PASS | 本地验收证据（未随源码发布） |
| v0.5.0 Android APK 版本与签名校验 | Android build-tools 36 | PASS | versionCode 6 / versionName 0.5.0；APK Signature Scheme v2 验证通过 |
| Android 真机覆盖安装并冷启动切换两台真实 Mac | Android 真机 | 未执行 | 验收时 `adb devices -l` 为空 |

## 未执行项与剩余风险

- 未执行：Android/iOS 真机安全存储迁移、真实冷启动默认恢复、最后一条连接移除和真实两台 Mac 网络切换。
- 原因：Android 手机未连接 ADB；当前没有可用的 iOS 真机和第二台真实网关。
- 影响：Web 产品流和两端原生构建均通过，但 Keychain/Keystore 的真实迁移、系统杀进程后的恢复和网络失败切换仍需真机确认。
- 后续动作：手机重新连接并解锁后安装本地构建的 Android Debug APK，至少完成“保留旧连接升级 → 添加第二台 → 切换 → 强制结束/重开 → 移除当前项”流程。

## 最终结论

结论：`PASS WITH LIMITATIONS`

依据：首页单一连接入口、多连接安全存储模型、旧凭据迁移、设备页新增/切换/移除、默认恢复和按服务端缓存隔离均已有自动化证据；Web、网关、Android 和 iOS 构建门禁通过。仅保留 Android/iOS 真机安全存储与冷启动检查限制。
