# macOS Agent Gateway

本地运行的零框架 Node.js 网关，使用内置 HTTP、SQLite 和子进程 API，适配 Cursor Agent、Claude Code 与 Codex。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REMOTE_AGENT_HOST` | `127.0.0.1` | 监听地址 |
| `REMOTE_AGENT_PORT` | `17821` | 监听端口 |
| `REMOTE_AGENT_DATA_DIR` | `~/.remote-agent` | SQLite 数据目录 |
| `REMOTE_AGENT_ROOTS` | 当前目录 | 允许新建和续接 Agent 的根目录，macOS 用 `:` 分隔多个路径；其他目录的历史仍可只读浏览 |
| `REMOTE_AGENT_ALLOWED_ORIGINS` | Web + Capacitor 本机来源 | 允许的来源，逗号分隔 |
| `REMOTE_AGENT_*_HISTORY_DIR` | 各 Agent 默认目录 | 覆盖原生历史位置 |

## 命令

```bash
npm run dev       # 开发运行
npm run pair      # 在 Mac 本机生成一次性配对码
npm run typecheck
npm test
npm run build
npm start         # 运行 dist/index.js
npm run service:install -- /absolute/project/root # 安装并启动登录后台服务
npm run service:status                            # 查看 launchd 状态
npm run service:uninstall                         # 停止并移除服务，保留数据
```

### 多个白名单根目录（含 Codex worktree）

续接、新建任务与 `files/read` 仍要求会话 `cwd` 落在 **`REMOTE_AGENT_ROOTS` 中显式列出的路径** 内；不会自动信任整个 home 目录。Codex 在 `~/.codex/worktrees/...` 下的工作副本需要把该目录作为第二个根加入白名单，例如：

```bash
npm run build
npm run service:install -- "$HOME/projects" "$HOME/.codex/worktrees"
```

LaunchAgent 会把多个根写入 `REMOTE_AGENT_ROOTS`（macOS 上用 `:` 连接，与手动设置 `REMOTE_AGENT_ROOTS=$HOME/projects:$HOME/.codex/worktrees` 等价）。开发时也可：

```bash
REMOTE_AGENT_ROOTS="$HOME/projects:$HOME/.codex/worktrees" npm run dev
```

使用 `npm run pair` 时，脚本会调用回环地址上的 `/v1/pairing/start`；配对码不会写入数据库或日志。

后台服务默认监听 `0.0.0.0:17821` 供同一私有网络内的手机访问，并把编译产物复制到
`~/.remote-agent/runtime`，避免 launchd 无法执行 `Documents` 中的源码。若项目位于
`Desktop`、`Documents` 或 `Downloads`，macOS 仍可能阻止后台 Agent 读取工作目录；请在
“系统设置 → 隐私与安全性 → 完全磁盘访问权限”中授权安装输出所显示的 Node 路径，或将项目放到
`~/Projects`。公网访问必须放在 HTTPS 反向代理或受信任的私有网络之后。
