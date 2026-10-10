# Contributing

感谢关注 Remote Agent。本文件面向贡献者与维护者；用户向说明见根目录 [README.md](README.md)。

## 目录 / Layout

- `mobile-agent-remote/`：移动端 Web UI 与 Capacitor iOS/Android 原生工程
- `macos-agent-gateway/`：运行在 Mac（及 Windows 包）上的本地 TypeScript 网关
- `docs/README.md`：产品、协议、安全与验收文档总入口
- `docs/product/feature-guide.md`：面向使用/验收的完整功能说明
- `docs/product/functional-spec.md`：功能状态与业务规则 SSOT
- `docs/product/screenshots/`：手机端界面截图
- `docs/reference/protocol-contract.md`：HTTP/SSE、状态、事件与权限映射 SSOT
- `docs/quality/`：变更门禁、功能追踪矩阵与验收模板
- `docs/architecture.md`：架构与数据流
- `docs/security.md`：安全边界与部署要求
- `docs/ops/windows-service-and-signing.md`：Windows 自启动与签名规划

## 变更门禁 / Contributor gate

开始开发前先从 [文档中心](docs/README.md) 选择受影响的功能 ID，并按
[变更前检查与验收规范](docs/quality/change-and-acceptance.md) 完成对应门禁。

覆盖要求见 [`docs/quality/feature-matrix.md`](docs/quality/feature-matrix.md)。

## 本地验证 / Verify

```bash
cd macos-agent-gateway && npm run typecheck && npm test && npm run build
cd ../mobile-agent-remote && npm run check:runtime && npm run build && npm run test:sites && npm run test:runtime
```

iOS Simulator 验收：

```bash
cd mobile-agent-remote && npm run test:ios:simulator
```
