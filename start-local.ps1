param(
    [string]$Target = 'C:\fallout-local',
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$Source = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Source)) {
    $Source = (Get-Location).Path
}

Write-Host "Syncing project to $Target ..."
if (!(Test-Path $Target)) {
    New-Item -ItemType Directory -Path $Target | Out-Null
}

$null = robocopy $Source $Target /MIR /XD node_modules .git data

Set-Location $Target

if (-not $SkipInstall) {
    Write-Host 'Installing dependencies in local folder ...'
    npm install
}

Write-Host "Starting server from $Target ..."
npm start
