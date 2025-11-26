# PowerShell script to set up PM2 auto-start on Windows
# Run this script as Administrator

Write-Host "Setting up PM2 auto-start for Windows..." -ForegroundColor Green
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Get the current directory (project root)
$projectPath = $PSScriptRoot
if (-not $projectPath) {
    $projectPath = Get-Location
}

Write-Host "Project path: $projectPath" -ForegroundColor Cyan
Write-Host ""

# Get Node.js path
$nodePath = (Get-Command node).Source
$nodeDir = Split-Path $nodePath -Parent
Write-Host "Node.js path: $nodePath" -ForegroundColor Cyan
Write-Host ""

# Get PM2 path
$pm2Path = (Get-Command pm2).Source
Write-Host "PM2 path: $pm2Path" -ForegroundColor Cyan
Write-Host ""

# Create the startup script
$startupScript = @"
@echo off
cd /d "$projectPath"
call npm run pm2:start
call npm run pm2:save
"@

$startupScriptPath = "$projectPath\scripts\pm2-startup.bat"
$startupScript | Out-File -FilePath $startupScriptPath -Encoding ASCII
Write-Host "Created startup script: $startupScriptPath" -ForegroundColor Green
Write-Host ""

# Create Task Scheduler task
$taskName = "PM2-Exco-Dashboard"
$taskDescription = "Auto-start Exco Dashboard with PM2 on Windows boot"

Write-Host "Creating Windows Task Scheduler task..." -ForegroundColor Yellow

# Delete existing task if it exists
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

# Create the action (what to run)
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$startupScriptPath`""

# Create the trigger (when to run - at system startup)
$trigger = New-ScheduledTaskTrigger -AtStartup

# Create the principal (run as current user)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

# Create the settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false

# Register the task
Register-ScheduledTask -TaskName $taskName -Description $taskDescription -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null

Write-Host "Task created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Task Name: $taskName" -ForegroundColor Cyan
Write-Host "The app will now auto-start when Windows boots." -ForegroundColor Green
Write-Host ""
Write-Host "To verify the task:" -ForegroundColor Yellow
Write-Host "  - Open Task Scheduler" -ForegroundColor Cyan
Write-Host "  - Look for task: '$taskName'" -ForegroundColor Cyan
Write-Host ""
Write-Host "To test the startup script manually:" -ForegroundColor Yellow
Write-Host "  .\scripts\pm2-startup.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "To remove the auto-start task:" -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor Cyan

