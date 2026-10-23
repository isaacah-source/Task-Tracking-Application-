<#
.SYNOPSIS
  Sets up the weekly FSI Projects backup on this Windows computer.

.DESCRIPTION
  1. Installs the Microsoft Graph sign-in module for your account if it is missing.
  2. Runs one backup now, so you sign in (and, the first time, approve read access).
  3. Adds a Windows Task Scheduler task that runs Backup-FSIData.ps1 once a week. If the
     computer is off or asleep at that time, the backup runs at the next chance.

  Run it again to change the day or time; it replaces the existing task.
  To stop the backups: Unregister-ScheduledTask -TaskName "FSI Projects weekly backup"

.EXAMPLE
  .\Register-WeeklyBackup.ps1
  .\Register-WeeklyBackup.ps1 -Day Friday -Time "4:30pm" -BackupFolder "D:\FSI Backups"
#>
[CmdletBinding()]
param(
  [ValidateSet("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")]
  [string]$Day = "Monday",
  [string]$Time = "9:00am",
  [string]$BackupFolder = (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "FSI Backups"),
  [int]$Keep = 12,
  [string]$TaskName = "FSI Projects weekly backup"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "Backup-FSIData.ps1"
if (-not (Test-Path $script)) { throw "Backup-FSIData.ps1 must be in the same folder as this script." }

if (-not (Get-Module -ListAvailable Microsoft.Graph.Authentication)) {
  Write-Host "Installing the Microsoft Graph sign-in module for your account..."
  Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Force -AllowClobber
}

Write-Host "Running a first backup. Sign in with your FSI Microsoft account if asked."
& $script -BackupFolder $BackupFolder -Keep $Keep
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "The first backup failed; see $BackupFolder\backup.log. The weekly task was not set up." }

# PowerShell 7 if installed, otherwise the Windows PowerShell that comes with Windows.
$pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
$exe = if ($pwsh) { $pwsh.Source } else { (Get-Command powershell.exe).Source }
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -BackupFolder `"$BackupFolder`" -Keep $Keep"

$action = New-ScheduledTaskAction -Execute $exe -Argument $taskArgs -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $Time
# Runs while you are signed in to Windows, so a Microsoft sign-in window can appear if the
# saved sign-in has expired. StartWhenAvailable catches up a missed week.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Copies the FSI Projects SharePoint lists and Relationship Tracker workbook to $BackupFolder." -Force | Out-Null

Write-Host ""
Write-Host "Done. Backups run every $Day at $Time and go to: $BackupFolder"
Write-Host "Check Task Scheduler for '$TaskName', or the log at $BackupFolder\backup.log."
