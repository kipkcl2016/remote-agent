# Remote Agent v0.6.0 Release Notes

## 概述

本版本将 **Android APK**、**macOS/移动端 package.json** 与 **GitHub Release 标签** 统一为 **0.6.0**，解决此前标签（v0.1.x）与 APK 显示版本（0.5.0）不一致的问题。

## 相对 v0.1.2 的变更

### 版本与制品

- 网关与移动端 npm 包版本：`0.6.0`
- Android：`versionName` **0.6.0**，`versionCode` **7**（覆盖安装旧 APK）
- Android `versionName` 与 `mobile-agent-remote/package.json` 对齐（Gradle 读取 package.json）
- CI 构建后校验 APK 的 `versionName` / `versionCode`

### 已包含在 main 上的功能与修复（v0.1.2 之后）

- **修复移动端查看 Cursor 原生历史时正文为空**（PR #15）：网关正确读取 Cursor 3.0+ `composer.composerHeaders`（ItemTable）索引，并按 `agent-transcripts` 加载用户/助手文本；白名单外仍为只读但可阅读正文
- 项目名称展示与项目会话相关改进（含 PR #13）
- Android Debug APK CI 构建（`remote-agent-android-debug.apk`）
- 发布流水线支持 `workflow_dispatch` 指定 ref 构建

## 制品说明

| 制品 | 说明 |
|------|------|
| `remote-agent-gateway-macOS.tar.gz` | macOS 网关包 |
| `remote-agent-gateway-Windows.zip` | Windows 网关包 |
| `remote-agent-gateway-Windows-setup-unsigned.zip` | Windows 未签名登录自启动脚本包 |
| `mobile-agent-remote-client.tar.gz` | 移动端 Web 静态资源 |
| `remote-agent-android-debug.apk` | **未签名 Debug APK**，仅供内测/开发安装 |

## 系统要求

与 v0.1.x 相同：Node.js >= 22.13；Android 安装需允许「未知来源」或使用 adb 覆盖安装。
