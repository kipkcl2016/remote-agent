@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-logon-task.ps1" %*
exit /b %ERRORLEVEL%
