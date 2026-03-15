$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "[platform-bootstrap] $Message" -ForegroundColor Cyan
}

function Invoke-Step([string[]]$Command) {
  & $Command[0] $Command[1..($Command.Length - 1)]
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $($Command -join ' ')"
  }
}

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

Write-Step "Installing npm dependencies"
Invoke-Step @('npm.cmd', 'install')

Write-Step "Generating Prisma client"
Invoke-Step @('npx.cmd', 'prisma', 'generate', '--schema', 'prisma/schema.prisma')

Write-Step "Applying Prisma migrations when available"
try {
  Invoke-Step @('npx.cmd', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma')
} catch {
  Write-Host "[platform-bootstrap] prisma migrate deploy skipped or baseline-required, continuing with platform schema upgrade" -ForegroundColor Yellow
}

Write-Step "Applying platform foundation schema upgrade"
Invoke-Step @('node', 'scripts/platform-schema-upgrade.js')

Write-Step "Running doctor"
Invoke-Step @('npm.cmd', 'run', 'doctor')

Write-Step "Running security check"
Invoke-Step @('npm.cmd', 'run', 'security:check')

Write-Step "Running readiness gate"
Invoke-Step @('npm.cmd', 'run', 'readiness:full')

Write-Step "Platform bootstrap complete"
Write-Host "Next: review docs/GO_LIVE_CHECKLIST_TH.md and docs/SPLIT_ORIGIN_AND_2FA_GUIDE.md, then verify /landing, /showcase, /trial, /admin" -ForegroundColor Green
Write-Host "Optional: npm run security:scaffold-split-env -- --admin-origin https://admin.example.com --player-origin https://player.example.com" -ForegroundColor DarkGray
Write-Host "Optional: npm run security:apply-split-env -- --write" -ForegroundColor DarkGray
Write-Host "Optional: npm run security:activate-split-env -- --admin-origin https://admin.example.com --player-origin https://player.example.com --write --with-readiness" -ForegroundColor DarkGray
