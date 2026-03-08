Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "[setup] $Message" -ForegroundColor Cyan
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Ensure-FileFromExample {
  param(
    [string]$TargetPath,
    [string]$ExamplePath
  )
  if (Test-Path -LiteralPath $TargetPath) {
    Write-Step "Found existing $TargetPath"
    return
  }
  if (-not (Test-Path -LiteralPath $ExamplePath)) {
    Write-Step "Skip: example file not found ($ExamplePath)"
    return
  }
  Copy-Item -LiteralPath $ExamplePath -Destination $TargetPath
  Write-Step "Created $TargetPath from example"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
Set-Location $repoRoot

Write-Step "Repository: $repoRoot"
Require-Command "node"
Require-Command "npm"

Write-Step "Checking env files"
Ensure-FileFromExample -TargetPath ".env" -ExamplePath ".env.example"
Ensure-FileFromExample `
  -TargetPath "apps/web-portal-standalone/.env" `
  -ExamplePath "apps/web-portal-standalone/.env.example"

Write-Step "Installing npm dependencies"
& npm install

Write-Step "Preparing Prisma client"
& npx prisma generate --schema prisma/schema.prisma

Write-Step "Applying Prisma schema (db push)"
& npx prisma db push --schema prisma/schema.prisma

Write-Host ""
Write-Host "Setup completed." -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "1) Edit .env and set DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID"
Write-Host "2) Edit SCUM_LOG_PATH and SCUM_WEBHOOK_SECRET in .env"
Write-Host "3) Edit apps/web-portal-standalone/.env for Discord OAuth values"
Write-Host "4) Register commands: npm run register-commands"
Write-Host "5) Start bot: npm run start:bot"
Write-Host "6) Start worker: npm run start:worker"
Write-Host "7) Start watcher: npm run watch-scum"
Write-Host "8) Start player portal: npm run start:web-standalone"
Write-Host "Portal URL: http://127.0.0.1:3300/player"
Write-Host "Admin URL: http://127.0.0.1:3200/admin/login"

