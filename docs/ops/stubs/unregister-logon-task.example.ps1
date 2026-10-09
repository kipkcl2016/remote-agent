# NON-PRODUCTION EXAMPLE — 删除示例登录任务
$TaskName = "RemoteAgentGateway-Example"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "已尝试删除任务: $TaskName"
