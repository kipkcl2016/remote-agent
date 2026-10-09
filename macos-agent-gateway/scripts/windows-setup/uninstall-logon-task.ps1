#Requires -Version 5.1
<#
.SYNOPSIS
  停止并删除 Remote Agent 网关登录计划任务，并结束本机 127.0.0.1 上的网关监听进程。

.PARAMETER TaskName
  计划任务名称，默认 RemoteAgentGateway。

.PARAMETER Port
  网关端口，默认 17821。

.PARAMETER DryRun
  仅打印将执行的操作。
#>
[CmdletBinding()]
param(
  [string] $TaskName = "RemoteAgentGateway",
  [int] $Port = 17821,
  [switch] $DryRun
)

$ErrorActionPreference = "Stop"

function Stop-LoopbackGatewayListener([int] $listenPort) {
  $stopped = @()
  $connections = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '::1' }
  foreach ($conn in $connections) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.ProcessName -ne 'node') { continue }
    if ($DryRun) {
      Write-Host "[DryRun] 将结束 node 进程 PID $($proc.Id)（监听 $($conn.LocalAddress):$listenPort）"
      continue
    }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $stopped += $proc.Id
  }
  return $stopped
}

Write-Host "计划任务: $TaskName"
Write-Host "将停止 127.0.0.1:$Port 上的 node 监听（若存在）"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  if ($DryRun) {
    Write-Host "[DryRun] Stop-ScheduledTask / Unregister-ScheduledTask"
  } else {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "已删除计划任务: $TaskName"
  }
} else {
  Write-Host "未找到计划任务: $TaskName"
}

$pids = Stop-LoopbackGatewayListener -listenPort $Port
if (-not $DryRun -and $pids.Count) {
  Write-Host "已结束网关 node 进程: $($pids -join ', ')"
}

Write-Host "SQLite 与 %USERPROFILE%\.remote-agent 数据目录默认保留（与 macOS service:uninstall 一致）。"
