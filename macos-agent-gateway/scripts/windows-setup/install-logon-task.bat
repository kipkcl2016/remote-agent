@echo off
setlocal
REM 未签名 — 见 UNSIGNED-NOTICE.txt
if "%~1"=="" (
  echo 用法: %~nx0 ^<项目根目录^> [更多根目录...]
  echo 示例: %~nx0 C:\Users\me\Projects
  echo 或:   powershell -File "%~dp0install-logon-task.ps1" -ProjectRoot C:\Users\me\Projects
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-logon-task.ps1" -ProjectRoot %*
exit /b %ERRORLEVEL%
