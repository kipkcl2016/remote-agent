# NON-PRODUCTION EXAMPLE — Remote Agent Windows gateway logon task
# 用途：用户登录时后台启动网关（通过 wrapper-start-gateway.example.cmd 设置 REMOTE_AGENT_*）
# 使用前：复制 wrapper-start-gateway.example.cmd 为 wrapper-start-gateway.cmd 并修改路径；
#         在网关目录执行 npm install --production

$ErrorActionPreference = "Stop"

$GatewayRoot = "C:\Tools\remote-agent-gateway"
$Wrapper = Join-Path $GatewayRoot "wrapper-start-gateway.cmd"
$TaskName = "RemoteAgentGateway-Example"

if (-not (Test-Path -LiteralPath $Wrapper)) {
  throw "请先复制 docs/ops/stubs/wrapper-start-gateway.example.cmd 为 $Wrapper 并修改其中的路径"
}

$action = New-ScheduledTaskAction -Execute $Wrapper -WorkingDirectory $GatewayRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Limited -Description "NON-PRODUCTION: Remote Agent gateway at logon" -Force

Write-Host "已注册登录任务: $TaskName（运行 $Wrapper）"
