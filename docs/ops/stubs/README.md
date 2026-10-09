# 非生产示例脚本（NON-PRODUCTION）

本目录脚本仅供学习与手工试验，**不是**官方安装路径或 SSOT。

**正式发布（Phase B）** 请使用 CI 制品 `remote-agent-gateway-Windows-setup-unsigned.zip` 解压目录内的：

- `install-logon-task.ps1` / `uninstall-logon-task.ps1`
- `wrapper-start-gateway.cmd`
- `UNSIGNED-NOTICE.txt`

源码位于 [`macos-agent-gateway/scripts/windows-setup/`](../../macos-agent-gateway/scripts/windows-setup/)。

- 使用前请复制 stubs 到本机并修改路径、用户名、白名单目录。
- 不要在 CI 或发布包中直接引用本目录路径。
- 生产方案见 [`../windows-service-and-signing.md`](../windows-service-and-signing.md)。
