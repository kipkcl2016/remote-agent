@echo off
REM NON-PRODUCTION EXAMPLE — 使用 NSSM 注册服务（需自行下载 nssm.exe 并修改路径）
REM 强烈建议：ObjectName 使用目标用户，而非 LocalSystem

setlocal
set "NSSM=C:\Tools\nssm\nssm.exe"
set "GATEWAY_ROOT=C:\Tools\remote-agent-gateway"
set "NODE=C:\Program Files\nodejs\node.exe"
set "WRAPPER=%GATEWAY_ROOT%\wrapper-start-gateway.cmd"
set "SVC=RemoteAgentGateway-Example"

if not exist "%NSSM%" (
  echo 请先安装 NSSM: https://nssm.cc/
  exit /b 1
)

"%NSSM%" install %SVC% "%COMSPEC%" "/c" "%WRAPPER%"
"%NSSM%" set %SVC% AppDirectory "%GATEWAY_ROOT%"
"%NSSM%" set %SVC% DisplayName "Remote Agent Gateway (EXAMPLE)"
"%NSSM%" set %SVC% Description "NON-PRODUCTION example service"
REM 将 YOURDOMAIN\YourUser 与密码替换为实际服务运行账户（推荐：日常开发用户）
REM "%NSSM%" set %SVC% ObjectName "YOURDOMAIN\YourUser" "password"
"%NSSM%" set %SVC% AppStdout "%GATEWAY_ROOT%\logs\stdout.log"
"%NSSM%" set %SVC% AppStderr "%GATEWAY_ROOT%\logs\stderr.log"
"%NSSM%" set %SVC% AppRotateFiles 1

echo 请检查 ObjectName 后执行: "%NSSM%" start %SVC%
