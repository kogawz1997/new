'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveSqliteDbPath(databaseUrl) {
  const raw = String(databaseUrl || '').trim();
  if (!raw.startsWith('file:')) return null;
  const filePath = raw.slice('file:'.length).replace(/^"|"$/g, '');
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runPrismaMigrateDeploy() {
  return spawnSync(process.execPath, ['scripts/prisma-with-provider.js', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
}

function copyFileAtomic(source, target) {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const sqliteDbPath = resolveSqliteDbPath(databaseUrl);
  let backupPath = null;

  if (sqliteDbPath && fs.existsSync(sqliteDbPath)) {
    const backupDir = path.resolve(process.cwd(), 'data', 'backups', 'db-migrations');
    ensureDir(backupDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(backupDir, `sqlite-pre-migrate-${timestamp}.db`);
    copyFileAtomic(sqliteDbPath, backupPath);
    console.log(`[db-migrate-safe] sqlite backup created: ${backupPath}`);
  } else if (sqliteDbPath) {
    console.log('[db-migrate-safe] sqlite database does not exist yet; skipping pre-migration backup');
  } else {
    console.log('[db-migrate-safe] non-sqlite DATABASE_URL detected; automatic DB file rollback is not available');
  }

  const result = runPrismaMigrateDeploy();
  if (result.status === 0) {
    console.log('[db-migrate-safe] migrate deploy completed');
    if (backupPath) {
      console.log(`[db-migrate-safe] rollback backup retained at: ${backupPath}`);
    }
    return;
  }

  if (backupPath && sqliteDbPath) {
    copyFileAtomic(backupPath, sqliteDbPath);
    console.error(`[db-migrate-safe] migrate failed; restored sqlite backup from ${backupPath}`);
  }
  process.exit(result.status || 1);
}

main();
