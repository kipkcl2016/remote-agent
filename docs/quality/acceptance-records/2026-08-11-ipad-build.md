# 变更验收记录：iPad 自适应安装版本

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-11 |
| 执行人 | Codex |
| 分支 / commit | 本地工作区，未创建 commit |
| 最终结论 | PASS（Simulator）；真机 IPA 受签名账号阻塞 |

## 目标与范围

- 目标：生成适配 iPad 的 Universal iOS 版本，验证横竖屏布局并交付可安装到 Xcode Simulator 的 Release 包。
- 关联功能 ID：`MOBILE-001`、`MOBILE-002`。
- 明确不做：不冒充 App Store/Ad Hoc 包，不更改网关协议或安全存储边界。

## 实现与兼容性

- Xcode target 保持 `TARGETED_DEVICE_FAMILY = 1,2`，最低 iOS 15.0，支持 iPhone 与 iPad，而不是维护第二套平板工程。
- 完整 iPad 窗口把首页、底部导航、新会话入口、全屏详情和 sheet 对齐到居中的可读工作区；低于 700px 的分屏窗口继续使用手机密度。
- iPad 横竖屏方向均由 Info.plist 声明；新增 XCUITest 检查旋转及主控件可视范围。
- 安全存储、连接缓存、API 和协议均未变化。

## 自动化与安装验收

| 门禁 | 结果 |
| --- | --- |
| `npm run check:runtime` | PASS，28 个受保护运行时文件 |
| `npm run build` | PASS，TypeScript + Vite + Sites 产物 |
| `npm run test:sites` | PASS，4/4 |
| `npm run test:runtime` | PASS，18/18 |
| iPad XCUITest 完整套件 | PASS，4/4、0 失败；配对/筛选/新会话/Markdown 流/多 Mac/缓存/移除连接 + 横竖屏；iPad (A16) / iPadOS 26.5 / Xcode 26.5 |
| Release `iphonesimulator` build | PASS，`UIDeviceFamily = [1,2]`，本地签名验证通过 |
| Release 安装与冷启动 | PASS，重新安装到 iPad (A16) Simulator 后无安全存储错误 |

## 交付物

- Simulator 安装包、横竖屏截图和 Xcode 结果仅保存在本地验收环境，不随源码发布。
- 安装包校验信息仅保存在本地验收环境。
- Xcode 结果包校验信息仅保存在本地验收环境。

## 真机 IPA 限制

本机有 `Apple Development` 证书，但 Xcode 没有登录对应 Team，且不存在 `com.remoteagent.mobile` 的 development provisioning profile。使用自动签名归档时 Xcode 明确返回 `No Account for Team` 与 `No profiles ... were found`，因此本次没有生成不可安装的伪 IPA。登录对应 Apple Developer 账号并连接/注册目标 iPad 后，即可从同一 Universal 工程 Archive 并导出开发 IPA。

## 最终结论

结论：`PASS（iPad Simulator 安装版本）`

依据：Release 包可安装并启动，iPad 原生 XCUITest 4/4 与 Web/移动回归 22/22 均通过；实体 iPad 安装仍需补齐 Apple Developer 账号与描述文件，不能由 Simulator 结果替代。
