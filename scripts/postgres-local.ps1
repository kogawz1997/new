param(
  [ValidateSet('init', 'start', 'stop', 'status', 'setup')]
  [string]$Action = 'status',
  [string]$ClusterDir = 'data/postgresql-main',
  [int]$Port = 55432,
  [string]$AdminUser = 'scum_platform_admin',
  [string]$AppUser = 'scum_platform_app',
  [string]$Database = 'scum_th_platform'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-PgBinDir {
  $candidates = @()
  if ($env:PG_BIN_DIR) {
    $candidates += $env:PG_BIN_DIR
  }
  $candidates += 'C:\Program Files\PostgreSQL\17\bin'
  $candidates += 'C:\Program Files\PostgreSQL\18\bin'
  foreach ($candidate in $candidates) {
    if (-not $candidate) { continue }
    if (Test-Path (Join-Path $candidate 'pg_ctl.exe')) {
      return $candidate
    }
  }
  throw 'PostgreSQL binaries not found. Set PG_BIN_DIR or install PostgreSQL.'
}

function New-Secret([int]$Length = 32) {
  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
}

function Get-ClusterState {
  param(
    [string]$BaseDir
  )
  $clusterPath = [IO.Path]::GetFullPath($BaseDir)
  $statePath = Join-Path (Split-Path -Parent $clusterPath) "$([IO.Path]::GetFileName($clusterPath))-runtime.json"
  $logPath = Join-Path (Split-Path -Parent $clusterPath) "$([IO.Path]::GetFileName($clusterPath)).log"
  $state = [ordered]@{
    clusterDir = $clusterPath
    statePath = $statePath
    logPath = $logPath
    port = $Port
    adminUser = $AdminUser
    appUser = $AppUser
    database = $Database
    adminPassword = $null
    appPassword = $null
  }
  if (Test-Path $statePath) {
    $loaded = Get-Content $statePath -Raw | ConvertFrom-Json
    foreach ($key in @('port', 'adminUser', 'appUser', 'database', 'adminPassword', 'appPassword')) {
      if ($null -ne $loaded.$key -and "$($loaded.$key)".Trim() -ne '') {
        $state[$key] = $loaded.$key
      }
    }
  }
  return $state
}

function Save-ClusterState {
  param(
    [hashtable]$State
  )
  $payload = [ordered]@{
    port = [int]$State.port
    adminUser = [string]$State.adminUser
    appUser = [string]$State.appUser
    database = [string]$State.database
    adminPassword = [string]$State.adminPassword
    appPassword = [string]$State.appPassword
    updatedAt = (Get-Date).ToString('o')
  }
  $dir = Split-Path -Parent $State.statePath
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $json = $payload | ConvertTo-Json -Depth 5
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($State.statePath, $json, $utf8NoBom)
}

function Invoke-PgCtl {
  param(
    [string]$PgBin,
    [string[]]$Arguments
  )
  & (Join-Path $PgBin 'pg_ctl.exe') @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pg_ctl failed with exit code $LASTEXITCODE"
  }
}

function Invoke-Psql {
  param(
    [string]$PgBin,
    [hashtable]$State,
    [string]$DatabaseName,
    [string]$Sql,
    [switch]$Capture
  )
  $env:PGPASSWORD = [string]$State.adminPassword
  try {
    $args = @(
      '-v', 'ON_ERROR_STOP=1',
      '-h', '127.0.0.1',
      '-p', ([string]$State.port),
      '-U', ([string]$State.adminUser),
      '-d', $DatabaseName,
      '-c', $Sql
    )
    if ($Capture) {
      $args = @('-t', '-A') + $args
      $result = & (Join-Path $PgBin 'psql.exe') @args
    } else {
      & (Join-Path $PgBin 'psql.exe') @args | Out-Null
      $result = $null
    }
    if ($LASTEXITCODE -ne 0) {
      throw "psql failed with exit code $LASTEXITCODE"
    }
    return $result
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

function Initialize-Cluster {
  param(
    [string]$PgBin,
    [hashtable]$State
  )
  if (Test-Path (Join-Path $State.clusterDir 'PG_VERSION')) {
    return
  }
  New-Item -ItemType Directory -Path $State.clusterDir -Force | Out-Null
  if (-not $State.adminPassword) {
    $State.adminPassword = New-Secret 36
  }
  if (-not $State.appPassword) {
    $State.appPassword = New-Secret 36
  }
  $pwFile = Join-Path (Split-Path -Parent $State.clusterDir) 'postgres-local-initdb.pw'
  try {
    Set-Content -Path $pwFile -Value ([string]$State.adminPassword) -NoNewline -Encoding ascii
    & (Join-Path $PgBin 'initdb.exe') `
      -D $State.clusterDir `
      -U ([string]$State.adminUser) `
      -E 'UTF8' `
      -A 'scram-sha-256' `
      "--pwfile=$pwFile"
    if ($LASTEXITCODE -ne 0) {
      throw "initdb failed with exit code $LASTEXITCODE"
    }
  } finally {
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
  }
  Save-ClusterState -State $State
}

function Start-Cluster {
  param(
    [string]$PgBin,
    [hashtable]$State
  )
  $statusOk = $false
  try {
    & (Join-Path $PgBin 'pg_ctl.exe') -D $State.clusterDir status | Out-Null
    $statusOk = ($LASTEXITCODE -eq 0)
  } catch {
    $statusOk = $false
  }
  if ($statusOk) {
    return
  }
  $logDir = Split-Path -Parent $State.logPath
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  }
  Invoke-PgCtl -PgBin $PgBin -Arguments @(
    '-D', $State.clusterDir,
    '-l', $State.logPath,
    '-o', "-p $($State.port) -h 127.0.0.1",
    'start'
  )
}

function Stop-Cluster {
  param(
    [string]$PgBin,
    [hashtable]$State
  )
  Invoke-PgCtl -PgBin $PgBin -Arguments @(
    '-D', $State.clusterDir,
    '-m', 'fast',
    'stop'
  )
}

function Ensure-AppDatabase {
  param(
    [string]$PgBin,
    [hashtable]$State
  )
  if (-not $State.appPassword) {
    $State.appPassword = New-Secret 36
  }
  $safeRoleName = [string]$State.appUser
  $safeDbName = [string]$State.database
  $appPasswordSql = ([string]$State.appPassword).Replace("'", "''")
  $appUserSql = $safeRoleName.Replace('"', '""')
  $databaseSql = $safeDbName.Replace('"', '""')
  $roleExists = ("$(Invoke-Psql -PgBin $PgBin -State $State -DatabaseName 'postgres' -Sql "SELECT 1 FROM pg_roles WHERE rolname = '$($safeRoleName.Replace("'", "''"))';" -Capture)".Trim() -eq '1')
  $databaseExists = ("$(Invoke-Psql -PgBin $PgBin -State $State -DatabaseName 'postgres' -Sql "SELECT 1 FROM pg_database WHERE datname = '$($safeDbName.Replace("'", "''"))';" -Capture)".Trim() -eq '1')
  if ($roleExists) {
    Invoke-Psql -PgBin $PgBin -State $State -DatabaseName 'postgres' -Sql "ALTER ROLE ""$appUserSql"" WITH LOGIN PASSWORD '$appPasswordSql';"
  } else {
    Invoke-Psql -PgBin $PgBin -State $State -DatabaseName 'postgres' -Sql "CREATE ROLE ""$appUserSql"" LOGIN PASSWORD '$appPasswordSql';"
  }

  if (-not $databaseExists) {
    Invoke-Psql -PgBin $PgBin -State $State -DatabaseName 'postgres' -Sql "CREATE DATABASE ""$databaseSql"" OWNER ""$appUserSql"";"
  }
  Save-ClusterState -State $State
}

function Get-StatusObject {
  param(
    [string]$PgBin,
    [hashtable]$State
  )
  $running = $false
  try {
    & (Join-Path $PgBin 'pg_ctl.exe') -D $State.clusterDir status | Out-Null
    $running = ($LASTEXITCODE -eq 0)
  } catch {
    $running = $false
  }
  return [ordered]@{
    ok = $true
    running = $running
    clusterDir = $State.clusterDir
    port = [int]$State.port
    adminUser = [string]$State.adminUser
    appUser = [string]$State.appUser
    database = [string]$State.database
    statePath = $State.statePath
    logPath = $State.logPath
    databaseUrl = "postgresql://$($State.appUser):<redacted>@127.0.0.1:$($State.port)/$($State.database)?schema=public"
  }
}

$pgBin = Resolve-PgBinDir
$state = Get-ClusterState -BaseDir $ClusterDir

switch ($Action) {
  'init' {
    Initialize-Cluster -PgBin $pgBin -State $state
    Get-StatusObject -PgBin $pgBin -State $state | ConvertTo-Json -Depth 5
  }
  'start' {
    Start-Cluster -PgBin $pgBin -State $state
    Get-StatusObject -PgBin $pgBin -State $state | ConvertTo-Json -Depth 5
  }
  'stop' {
    Stop-Cluster -PgBin $pgBin -State $state
    Get-StatusObject -PgBin $pgBin -State $state | ConvertTo-Json -Depth 5
  }
  'setup' {
    Initialize-Cluster -PgBin $pgBin -State $state
    Start-Cluster -PgBin $pgBin -State $state
    Ensure-AppDatabase -PgBin $pgBin -State $state
    Get-StatusObject -PgBin $pgBin -State $state | ConvertTo-Json -Depth 5
  }
  default {
    Get-StatusObject -PgBin $pgBin -State $state | ConvertTo-Json -Depth 5
  }
}
