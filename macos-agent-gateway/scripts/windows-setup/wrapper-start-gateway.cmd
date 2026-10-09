@echo off
REM Remote Agent gateway — 供任务计划程序调用的启动包装（监听 127.0.0.1，OPS-003）
setlocal EnableExtensions

set "GATEWAY_ROOT=%~dp0"
if "%GATEWAY_ROOT:~-1%"=="\" set "GATEWAY_ROOT=%GATEWAY_ROOT:~0,-1%"

cd /d "%GATEWAY_ROOT%"

if not exist "%GATEWAY_ROOT%\gateway-task-config.cmd" (
  echo [Remote Agent] 缺少 gateway-task-config.cmd，请先运行 install-logon-task.ps1 >&2
  exit /b 1
)

call "%GATEWAY_ROOT%\gateway-task-config.cmd"

if not defined REMOTE_AGENT_HOST set "REMOTE_AGENT_HOST=127.0.0.1"
if not defined REMOTE_AGENT_PORT set "REMOTE_AGENT_PORT=17821"

if not exist "%GATEWAY_ROOT%\dist\index.js" (
  echo [Remote Agent] dist\index.js 不存在，请先在本目录执行 npm install --production 并完成构建产物部署 >&2
  exit /b 1
)

if not defined REMOTE_AGENT_DATA_DIR set "REMOTE_AGENT_DATA_DIR=%USERPROFILE%\.remote-agent"
if not exist "%REMOTE_AGENT_DATA_DIR%\logs" mkdir "%REMOTE_AGENT_DATA_DIR%\logs" 2>nul

node "%GATEWAY_ROOT%\dist\index.js" ^
  >> "%REMOTE_AGENT_DATA_DIR%\logs\gateway-task.log" ^
  2>> "%REMOTE_AGENT_DATA_DIR%\logs\gateway-task.error.log"

endlocal
