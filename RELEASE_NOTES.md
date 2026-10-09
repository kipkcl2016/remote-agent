# Remote Agent v0.1.0 Release Notes

## 发布内容

本次发布为 Remote Agent 的首个打包版本，包含代码审查修复和跨平台支持。

### 包含的制品

1. **macOS 网关包** (`remote-agent-gateway-macOS.tar.gz`)
   - 编译好的 TypeScript 网关服务
   - 启动脚本 `start-gateway.sh` 和配对脚本 `pair.sh`
   - 完整的使用说明

2. **Windows 网关包** (`remote-agent-gateway-Windows.zip` / `remote-agent-gateway-Windows-setup-unsigned.zip`)
   - 编译好的 TypeScript 网关服务
   - 启动脚本 `start-gateway.bat` 和配对脚本 `pair.bat`
   - 未签名登录自启动脚本 `install-logon-task.ps1`、`uninstall-logon-task.ps1`（任务计划，默认 `127.0.0.1`）
   - 完整的使用说明

3. **移动端客户端包** (`mobile-agent-remote-client.tar.gz`)
   - 编译好的 Web 客户端静态文件
   - 可部署到任何静态文件服务器

## 系统要求

- Node.js >= 22.13
- macOS 10.15+ 或 Windows 10/11
- 已安装 Cursor Agent / Claude Code / Codex CLI（可选）

## 快速开始

### macOS

```bash
# 解压
tar xzf remote-agent-gateway-macOS.tar.gz
cd remote-agent-gateway

# 安装依赖
npm install --production

# 启动网关
./start-gateway.sh /path/to/your/projects

# 在另一个终端生成配对码
./pair.sh
```

### Windows

```cmd
REM 解压 remote-agent-gateway-Windows.zip
cd remote-agent-gateway

REM 安装依赖
npm install --production

REM 启动网关
start-gateway.bat C:\path\to\your\projects

REM 在另一个终端生成配对码
pair.bat
```

## 主要特性

- ✅ 8 位配对码设备认证
- ✅ 多设备管理（最多 8 个）
- ✅ 统一的 Cursor/Claude/Codex 会话界面
- ✅ 目录白名单与权限控制
- ✅ SQLite 本地存储
- ✅ HTTP/SSE 实时通信
- ✅ 跨平台支持（macOS/Windows）

## 已知限制

### Windows 平台

1. **服务安装不可用**
   - launchd 是 macOS 专用功能
   - Windows 用户需手动启动网关或使用任务计划/NSSM 自启动；推荐默认与风险说明见 [Windows 自启动与签名规划](docs/ops/windows-service-and-signing.md)

2. **默认历史路径**
   - Cursor: `%APPDATA%\Cursor`
   - Claude: `%USERPROFILE%\.claude`
   - Codex: `%USERPROFILE%\.codex`
   - 如需自定义，使用环境变量覆盖

3. **路径分隔符**
   - Windows 使用反斜杠 `\` 和分号 `;`
   - 启动脚本已自动处理

### 通用限制

1. **未签名构建**
   - macOS 包未经过 Apple 公证
   - Windows 包未经过代码签名
   - 首次运行可能触发安全警告

2. **网络安全**
   - 默认仅监听 `127.0.0.1`（本机）
   - 跨设备使用需配置 HTTPS 反向代理或 Tailscale
   - 不要将 HTTP 网关直接暴露到公网

3. **Capacitor 原生构建**
   - iOS/Android 原生包需要本地构建
   - 需要 Xcode 和 Android Studio 环境

## 安全建议

- 仅在受信任的私有网络使用
- 生产环境使用 HTTPS
- 定期更新设备令牌
- 限制白名单目录范围
- 及时撤销不再使用的设备

## 技术改进

本版本包含以下代码审查修复：

- 升级配对码从 6 位到 8 位
- 添加 HTTP 超时和连接限制
- 修复缓冲区分配和 SQLite WAL 检查点
- 改进 Agent 子进程取消处理
- 修复 tool_use 输入对象处理
- 升级 Capacitor 到 8.5.3
- 降级 TypeScript 到稳定版 5.9.3
- 审计并修复依赖漏洞
- 添加跨平台路径支持

## 构建信息

- 构建分支: `release/v0.1.0`
- 基于提交: 包含所有代码审查修复
- 构建时间: 2026-10-08
- 测试覆盖: 29/29 通过

## 反馈

如有问题或建议，请在 GitHub 提交 issue：
https://github.com/kipkcl2016/remote-agent/issues

---

更多文档参见：
- [功能说明](docs/product/feature-guide.md)
- [架构文档](docs/architecture.md)
- [安全说明](docs/security.md)
- [Windows 自启动与代码签名规划](docs/ops/windows-service-and-signing.md)
