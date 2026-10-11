# Tailscale Serve 一键暴露（Mac 优先）

相对竞品 d-kimuson 的 `serve --tailscale`：本仓库网关与手机控制台分离，**不另建认证**。
手机仍走现有「设备」页：HTTPS 网关地址 + 一次性 8 位配对码 → 设备令牌。

## 前提

1. Mac（或 Windows）已安装 [Tailscale](https://tailscale.com/download)，并 `tailscale up` 登录。
2. Tailnet 已启用 **HTTPS Certificates**（MagicDNS 下的 `*.ts.net` 证书）。首次 `tailscale serve` 可能弹出指引链接。
3. 本机网关已在监听，默认 `127.0.0.1:17821`（`npm run dev` 或 `service:install`）。
4. 手机安装同一 Tailscale 账号 / 同一 tailnet。

## 一键命令

```bash
cd macos-agent-gateway
# 网关已在跑时：
npm run serve:tailscale
```

效果：

- 检查 Tailscale CLI（缺失则打印安装链接）
- `tailscale serve --bg --https=443 http://127.0.0.1:17821`
- 打印 MagicDNS **HTTPS URL**、（默认）请求 `/v1/pairing/start` 得到 **8 位配对码**
- 终端打印 QR（内容为 URL + `code=` 文本；手机仍在 App 内手动填地址与码，**不发明第二套认证**）

常用参数：

```bash
npm run serve:tailscale -- --port 17821 --https-port 443
npm run serve:tailscale -- --no-pair          # 只开 Serve，稍后 npm run pair
npm run serve:tailscale -- --reset            # 清除本机 Serve 配置
```

## 手机步骤

1. 手机 Tailscale 已连接同一 tailnet。
2. 打开 Remote Agent →「设备」。
3. **Mac 网关地址**填打印的 `https://<magicdns>`（可扫 QR 后复制）。
4. 输入 8 位配对码 →「配对并保存连接」。
5. Claude ACP 手机批准/拒绝路径不变（仍走已配对 Bearer；Serve 只换传输层）。

## 安全说明

- Serve **仅 tailnet 内**可达；不要用 Funnel 把网关打到公网。
- 推荐网关继续监听 **127.0.0.1**，由 Tailscale 终止 TLS 并反代——比 `REMOTE_AGENT_HOST=0.0.0.0` 更小暴露面。
- 配对码仍只能从 **回环** 创建（`POST /v1/pairing/start`），手机不能自己生成码。

## Windows 诚实说明

| 能力 | macOS | Windows |
| --- | --- | --- |
| `npm run serve:tailscale` | 支持（可用 App 内 CLI 路径） | 支持（需 `tailscale.exe` 在 PATH） |
| `npm run service:install`（launchd） | 支持 | **不可用**；用 `start-gateway.bat` / 任务计划 |
| QR 终端渲染 | 需 `npx`/网络拉 `qrcode`；失败则打印明文 | 同上 |

## 失败模式

| 现象 | 处理 |
| --- | --- |
| 未找到 Tailscale CLI | 打开 https://tailscale.com/download ；macOS 查 `/Applications/Tailscale.app/.../Tailscale` |
| `BackendState` 非 Running | `tailscale up` |
| Serve 提示 HTTPS / 证书 | Admin Console 开启 HTTPS Certificates 后重试 |
| 网关 health 失败 | 先 `npm run dev` / `service:install` |
| 配对 403 / 失败 | 确认从本机回环请求；网关已启动 |
| HTTPS 端口已被其他代理占用 | `npm run serve:tailscale -- --reset` 后重来，或换 `--https-port` |
| QR 未渲染 | 检查网络/`npx`；直接复制打印的 URL 与配对码 |

## 与 Claude ACP 手机批准的关系

本功能只配置 **传输（Tailscale HTTPS）** 与 **配对入口体验**。不修改 ACP approval 事件、`POST /v1/sessions/:id/approvals/:challengeId` 或手机批准按钮逻辑。
