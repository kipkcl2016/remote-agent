#Requires -Version 5.1
<#
.SYNOPSIS
  注册 Remote Agent 网关「用户登录时」计划任务（未签名，默认 127.0.0.1）。

.PARAMETER ProjectRoot
  允许的项目根目录。可重复传参，或单个参数内用分号分隔多个绝对路径。

.PARAMETER GatewayRoot
  网关解压目录，默认为本脚本所在目录。

.PARAMETER TaskName
  计划任务名称，默认 RemoteAgentGateway。

.PARAMETER DryRun
  仅校验环境并打印将执行的操作，不写入配置或注册任务。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string[]] $ProjectRoot,

  [string] $GatewayRoot = $PSScriptRoot,

  [string] $TaskName = "RemoteAgentGateway",

  [switch] $DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-ProjectRoots([string[]] $roots) {
  $resolved = @()
  foreach ($item in $roots) {
    foreach ($part in ($item -split ';')) {
      $trimmed = $part.Trim()
      if (-not $trimmed) { continue }
      $path = [System.IO.Path]::GetFullPath($trimmed)
      if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "项目根目录不存在或不是文件夹: $path"
      }
      $resolved += $path
    }
  }
  if (-not $resolved.Count) {
    throw "至少需要一个有效的 ProjectRoot 路径"
  }
  return ($resolved | Select-Object -Unique)
}

$GatewayRoot = [System.IO.Path]::GetFullPath($GatewayRoot)
$wrapper = Join-Path $GatewayRoot "wrapper-start-gateway.cmd"
$config = Join-Path $GatewayRoot "gateway-task-config.cmd"
$distEntry = Join-Path $GatewayRoot "dist\index.js"

if (-not (Test-Path -LiteralPath $wrapper)) {
  throw "未找到 $wrapper，请使用包含 windows-setup 脚本的网关包"
}
if (-not (Test-Path -LiteralPath $distEntry)) {
  throw "未找到 $distEntry；请确认已解压完整网关包"
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = & $node -v
if ($nodeVersion -notmatch '^v(\d+)\.') {
  throw "无法解析 Node 版本: $nodeVersion"
}
$major = [int]$Matches[1]
if ($major -lt 22) {
  throw "需要 Node.js >= 22.13，当前: $nodeVersion ($node)"
}

$rootsList = Resolve-ProjectRoots -roots $ProjectRoot
$rootsJoined = ($rootsList -join ';')

$configBody = @"
@echo off
REM 由 install-logon-task.ps1 生成 — 请勿手工编辑（重新安装会覆盖）
set "REMOTE_AGENT_ROOTS=$rootsJoined"
set "REMOTE_AGENT_HOST=127.0.0.1"
set "REMOTE_AGENT_PORT=17821"
"@

Write-Host "网关目录: $GatewayRoot"
Write-Host "Node: $node ($nodeVersion)"
Write-Host "REMOTE_AGENT_ROOTS: $rootsJoined"
Write-Host "计划任务: $TaskName（用户 $env:USERNAME 登录时）"
Write-Host "监听: 127.0.0.1:17821"
Write-Host "未签名安装 — SmartScreen 可能对脚本提示警告（见 UNSIGNED-NOTICE.txt）"

if ($DryRun) {
  Write-Host "[DryRun] 将写入 $config"
  Write-Host "[DryRun] 将注册计划任务并执行 $wrapper"
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $GatewayRoot "node_modules"))) {
  Write-Warning "未检测到 node_modules；注册前请在本目录执行: npm install --production"
}

Set-Content -LiteralPath $config -Value $configBody -Encoding ASCII

$action = New-ScheduledTaskAction -Execute $wrapper -WorkingDirectory $GatewayRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "已存在同名任务，将覆盖注册: $TaskName"
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description "Remote Agent gateway (user logon, 127.0.0.1); unsigned OPS-003" -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "已注册并启动计划任务。配对请在本机另开终端运行 pair.bat"
Write-Host "卸载: powershell -File `"$GatewayRoot\uninstall-logon-task.ps1`""
