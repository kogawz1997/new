'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config();

const { updateEnvFile } = require('../src/utils/envFileEditor');
const { resolveDatabaseRuntime } = require('../src/utils/dbEngine');

const PROJECT_ROOT = process.cwd();
const ROOT_ENV_PATH = path.join(PROJECT_ROOT, '.env');
const SPLIT_ENV_PATH = path.join(PROJECT_ROOT, '.env.production.split');
const DEFAULT_CLUSTER_STATE_PATH = path.join(PROJECT_ROOT, 'data', 'postgresql-main-runtime.json');
const TEMP_DIR = path.join(PROJECT_ROOT, 'artifacts', 'cutover');
const PRISMA_SCHEMA_PATH = path.join(PROJECT_ROOT, 'prisma', 'schema.prisma');

const TABLE_PRIORITY = [
  'UserWallet',
  'Purchase',
  'GuildEvent',
  'Giveaway',
  'WalletLedger',
  'PurchaseStatusHistory',
  'GuildEventParticipant',
  'GiveawayEntrant',
];

const SERIAL_COLUMNS = [
  ['Purchase', 'id'],
  ['WalletLedger', 'id'],
  ['PurchaseStatusHistory', 'id'],
  ['Punishment', 'id'],
  ['Bounty', 'id'],
];

function readPrismaSchema() {
  return fs.readFileSync(PRISMA_SCHEMA_PATH, 'utf8');
}

function buildDateTimeColumnMap(schemaText = readPrismaSchema()) {
  const map = new Map();
  const modelPattern = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match = modelPattern.exec(schemaText);
  while (match) {
    const modelName = String(match[1] || '').trim();
    const body = String(match[2] || '');
    const tableMapMatch = body.match(/@@map\("([^"]+)"\)/);
    const tableName = tableMapMatch ? String(tableMapMatch[1] || '').trim() : modelName;
    const dateColumns = new Set();
    for (const rawLine of body.split(/\r?\n/)) {
      const line = String(rawLine || '').trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const fieldMatch = line.match(/^(\w+)\s+([A-Za-z][A-Za-z0-9_]*)(?:\?|\[\])?/);
      if (!fieldMatch) continue;
      const fieldType = String(fieldMatch[2] || '').trim();
      if (fieldType !== 'DateTime') continue;
      const mappedColumnMatch = line.match(/@map\("([^"]+)"\)/);
      dateColumns.add(mappedColumnMatch ? String(mappedColumnMatch[1] || '').trim() : String(fieldMatch[1] || '').trim());
    }
    if (dateColumns.size > 0) {
      map.set(tableName, dateColumns);
    }
    match = modelPattern.exec(schemaText);
  }
  return map;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    writeEnv: false,
    sourceSqlite: '',
    clusterState: DEFAULT_CLUSTER_STATE_PATH,
    rootEnv: ROOT_ENV_PATH,
    splitEnv: SPLIT_ENV_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const part = String(argv[index] || '').trim();
    if (!part) continue;
    if (part === '--write-env') {
      options.writeEnv = true;
      continue;
    }
    if (part === '--source-sqlite' && index + 1 < argv.length) {
      options.sourceSqlite = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (part === '--cluster-state' && index + 1 < argv.length) {
      options.clusterState = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
  }
  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function findPgBinDir() {
  const candidates = [
    process.env.PG_BIN_DIR,
    'C:\\Program Files\\PostgreSQL\\17\\bin',
    'C:\\Program Files\\PostgreSQL\\18\\bin',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'psql.exe'))) {
      return candidate;
    }
  }
  throw new Error('PostgreSQL bin directory not found');
}

function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    shell: options.shell === true,
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status || 0) !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}: ${String(result.stderr || '').trim() || String(result.stdout || '').trim()}`,
    );
  }
  return result;
}

function loadClusterState(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Cluster state file not found: ${resolved}`);
  }
  const state = JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''));
  const appUser = String(state.appUser || '').trim();
  const appPassword = String(state.appPassword || '').trim();
  const database = String(state.database || '').trim();
  const port = Number(state.port || 0);
  if (!appUser || !appPassword || !database || !Number.isFinite(port) || port <= 0) {
    throw new Error(`Cluster state file is incomplete: ${resolved}`);
  }
  const encodedUser = encodeURIComponent(appUser);
  const encodedPassword = encodeURIComponent(appPassword);
  return {
    ...state,
    resolvedPath: resolved,
    databaseUrl: `postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:${port}/${database}?schema=public`,
    psqlDatabaseUrl: `postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:${port}/${database}`,
  };
}

function resolveSourceSqlitePath(explicitSource = '') {
  if (explicitSource) {
    return path.resolve(PROJECT_ROOT, explicitSource);
  }
  const runtime = resolveDatabaseRuntime({
    provider: 'sqlite',
    projectRoot: PROJECT_ROOT,
  });
  if (!runtime.filePath) {
    throw new Error('Current DATABASE_URL is not a SQLite file path');
  }
  return runtime.filePath;
}

function sqliteJson(sourceDbPath, sql) {
  const result = runCommand('sqlite3', ['-json', sourceDbPath, sql]);
  const text = String(result.stdout || '').trim();
  if (!text) return [];
  return JSON.parse(text);
}

function sqliteCsv(sourceDbPath, sql, outputPath) {
  const result = runCommand('sqlite3', ['-header', '-csv', sourceDbPath, sql]);
  fs.writeFileSync(outputPath, result.stdout || '', 'utf8');
}

function quoteIdentifier(value) {
  return `"${String(value || '').replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value || '').replaceAll("'", "''")}'`;
}

function sortTables(tables) {
  const priorityMap = new Map(TABLE_PRIORITY.map((name, index) => [name, index]));
  return [...tables].sort((left, right) => {
    const leftPriority = priorityMap.has(left) ? priorityMap.get(left) : 999;
    const rightPriority = priorityMap.has(right) ? priorityMap.get(right) : 999;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.localeCompare(right);
  });
}

function listSourceTables(sourceDbPath) {
  const rows = sqliteJson(
    sourceDbPath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name ASC;",
  );
  return sortTables(
    rows
      .map((row) => String(row?.name || '').trim())
      .filter(Boolean),
  );
}

function listTableColumns(sourceDbPath, tableName) {
  const rows = sqliteJson(sourceDbPath, `PRAGMA table_info(${quoteIdentifier(tableName)});`);
  return rows
    .sort((left, right) => Number(left?.cid || 0) - Number(right?.cid || 0))
    .map((row) => String(row?.name || '').trim())
    .filter(Boolean);
}

function buildSelectColumnExpression(tableName, columnName, dateTimeColumnMap) {
  const dateColumns = dateTimeColumnMap.get(tableName);
  if (!dateColumns || !dateColumns.has(columnName)) {
    return quoteIdentifier(columnName);
  }
  const identifier = quoteIdentifier(columnName);
  return `
    CASE
      WHEN typeof(${identifier}) IN ('integer', 'real') AND ABS(${identifier}) >= 100000000000
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', ${identifier} / 1000.0, 'unixepoch')
      WHEN typeof(${identifier}) IN ('integer', 'real') AND ABS(${identifier}) >= 1000000000
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', ${identifier}, 'unixepoch')
      ELSE ${identifier}
    END AS ${identifier}
  `.trim();
}

function psql(pgBinDir, databaseUrl, sql) {
  return runCommand(path.join(pgBinDir, 'psql.exe'), ['-v', 'ON_ERROR_STOP=1', databaseUrl, '-c', sql]);
}

function ensureRawTables(pgBinDir, databaseUrl, tables = []) {
  const set = new Set(tables);
  if (set.has('admin_web_users')) {
    psql(
      pgBinDir,
      databaseUrl,
      `
      CREATE TABLE IF NOT EXISTS admin_web_users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'mod',
        tenant_id TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      `,
    );
  }
  if (set.has('platform_tenant_configs')) {
    psql(
      pgBinDir,
      databaseUrl,
      `
      CREATE TABLE IF NOT EXISTS platform_tenant_configs (
        tenant_id TEXT PRIMARY KEY,
        config_patch_json TEXT,
        portal_env_patch_json TEXT,
        feature_flags_json TEXT,
        updated_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      `,
    );
  }
}

function importTable(pgBinDir, databaseUrl, sourceDbPath, tableName, dateTimeColumnMap) {
  const columns = listTableColumns(sourceDbPath, tableName);
  if (columns.length === 0) return { tableName, rowCount: 0 };
  ensureDir(TEMP_DIR);
  const csvPath = path.join(TEMP_DIR, `${tableName}.csv`);
  const selectSql = `SELECT ${columns.map((columnName) => buildSelectColumnExpression(tableName, columnName, dateTimeColumnMap)).join(', ')} FROM ${quoteIdentifier(tableName)};`;
  sqliteCsv(sourceDbPath, selectSql, csvPath);
  const postgresCsvPath = csvPath.replaceAll('\\', '/');
  const columnSql = columns.map(quoteIdentifier).join(', ');
  const copySql = `\\copy ${quoteIdentifier(tableName)} (${columnSql}) FROM ${quoteLiteral(postgresCsvPath)} WITH (FORMAT csv, HEADER true)`;
  psql(pgBinDir, databaseUrl, copySql);
  return { tableName, rowCount: Math.max(0, fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean).length - 1) };
}

function resetSerialColumns(pgBinDir, databaseUrl) {
  for (const [tableName, columnName] of SERIAL_COLUMNS) {
    psql(
      pgBinDir,
      databaseUrl,
      `
      SELECT setval(
        pg_get_serial_sequence(${quoteLiteral(`"${tableName}"`)}, ${quoteLiteral(columnName)}),
        COALESCE((SELECT MAX(${quoteIdentifier(columnName)}) FROM ${quoteIdentifier(tableName)}), 1),
        COALESCE((SELECT MAX(${quoteIdentifier(columnName)}) FROM ${quoteIdentifier(tableName)}), 0) > 0
      );
      `,
    );
  }
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-cutover-${timestamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function main() {
  const options = parseArgs();
  const pgBinDir = findPgBinDir();
  const clusterState = loadClusterState(options.clusterState);
  const sourceDbPath = resolveSourceSqlitePath(options.sourceSqlite);
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`SQLite source not found: ${sourceDbPath}`);
  }

  psql(pgBinDir, clusterState.psqlDatabaseUrl, 'SELECT 1;');

  runCommand(
    process.execPath,
    ['scripts/prisma-with-provider.js', '--provider', 'postgresql', 'db', 'push', '--skip-generate'],
    {
      env: {
        DATABASE_URL: clusterState.databaseUrl,
        PRISMA_SCHEMA_PROVIDER: 'postgresql',
        DATABASE_PROVIDER: 'postgresql',
      },
      capture: false,
    },
  );

  const tables = listSourceTables(sourceDbPath);
  const dateTimeColumnMap = buildDateTimeColumnMap();
  ensureRawTables(pgBinDir, clusterState.psqlDatabaseUrl, tables);
  const imported = [];
  for (const tableName of tables) {
    imported.push(importTable(pgBinDir, clusterState.psqlDatabaseUrl, sourceDbPath, tableName, dateTimeColumnMap));
  }
  resetSerialColumns(pgBinDir, clusterState.psqlDatabaseUrl);

  let rootBackup = null;
  let splitBackup = null;
  if (options.writeEnv) {
    rootBackup = backupFile(options.rootEnv);
    splitBackup = backupFile(options.splitEnv);
    const patch = {
      DATABASE_URL: clusterState.databaseUrl,
      DATABASE_PROVIDER: 'postgresql',
      PRISMA_SCHEMA_PROVIDER: 'postgresql',
      PERSIST_REQUIRE_DB: 'true',
    };
    updateEnvFile(options.rootEnv, patch);
    if (fs.existsSync(options.splitEnv)) {
      updateEnvFile(options.splitEnv, patch);
    }
  }

  runCommand(
    process.execPath,
    ['scripts/prisma-with-provider.js', '--provider', 'postgresql', 'generate'],
    {
      env: {
        DATABASE_URL: clusterState.databaseUrl,
        PRISMA_SCHEMA_PROVIDER: 'postgresql',
        DATABASE_PROVIDER: 'postgresql',
      },
      capture: false,
    },
  );

  const summary = {
    ok: true,
    sourceDbPath,
    targetDatabaseUrl: clusterState.databaseUrl.replace(/:([^:@/]+)@/, ':<redacted>@'),
    importedTables: imported,
    envUpdated: options.writeEnv,
    envBackups: {
      root: rootBackup,
      split: splitBackup,
    },
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[cutover-sqlite-to-postgres] ${error.message}`);
    process.exit(1);
  }
}
