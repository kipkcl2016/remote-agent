@echo off
REM NON-PRODUCTION EXAMPLE — 供任务计划或 NSSM 调用的启动包装
REM 复制为 wrapper-start-gateway.cmd 并修改下方路径

setlocal
set "GATEWAY_ROOT=C:\Tools\remote-agent-gateway"
set "REMOTE_AGENT_ROOTS=C:\Users\me\Projects"
set "REMOTE_AGENT_HOST=127.0.0.1"
set "REMOTE_AGENT_PORT=17821"

cd /d "%GATEWAY_ROOT%"
node dist\index.js
