<#
.SYNOPSIS
  Registers the Reconza Tally agent to start at login and locks down its config.

.DESCRIPTION
  Uses a Scheduled Task rather than a Windows Service: the agent has to be able
  to launch Tally into an interactive desktop session, which a Session-0 service
  cannot do.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install-windows.ps1
#>

[CmdletBinding()]
param(
  [string]$TaskName = "ReconzaTallyAgent",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
  } else {
    Write-Host "No scheduled task named '$TaskName'."
  }
  return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js is not on PATH. Install Node 22 or newer first." }

$nodeVersion = (& $node --version).TrimStart("v")
if ([version]($nodeVersion -split "-")[0] -lt [version]"22.6.0") {
  throw "Node $nodeVersion is too old; the agent needs 22.6.0+ for node:sqlite and TypeScript execution."
}

$entry = Join-Path $agentRoot "dist\agent.mjs"
if (-not (Test-Path $entry)) { $entry = Join-Path $agentRoot "src\index.ts" }
Write-Host "Entry point: $entry"

# --- Lock the config down to the current user -------------------------------
$configDir = Join-Path $env:APPDATA "ReconzaTallyAgent"
$configFile = Join-Path $configDir "config.json"
if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }

if (Test-Path $configFile) {
  # The agent token lives in here; strip inherited ACLs so other local accounts
  # can't read it.
  $acl = Get-Acl $configFile
  $acl.SetAccessRuleProtection($true, $false)
  $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "$env:USERDOMAIN\$env:USERNAME", "FullControl", "Allow")
  $acl.AddAccessRule($rule)
  Set-Acl -Path $configFile -AclObject $acl
  Write-Host "Restricted $configFile to $env:USERNAME."
} else {
  Write-Warning "No config yet. Run 'npm run setup' in $agentRoot before starting the agent."
}

# --- Register the task ------------------------------------------------------
$action = New-ScheduledTaskAction -Execute $node `
  -Argument "--disable-warning=ExperimentalWarning `"$entry`"" `
  -WorkingDirectory $agentRoot

$triggerLogon = New-ScheduledTaskTrigger -AtLogOn
# Restart the agent if it ever exits; the sync loop is meant to be always-on.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -RestartCount 999 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger $triggerLogon -Settings $settings -Principal $principal `
  -Description "Pushes Reconza vouchers into Tally over its local HTTP-XML interface." | Out-Null

Write-Host ""
Write-Host "Registered '$TaskName' to start at logon."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Status page:        http://localhost:9700"
