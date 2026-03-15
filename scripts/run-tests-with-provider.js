'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { URL } = require('node:url');
require('dotenv').config();

const PROJECT_ROOT = process.cwd();
const GENERATED_SCHEMA_PATH = path.join(PROJECT_ROOT, 'node_modules', '.prisma', 'client', 'schema.prisma');

function readGeneratedProvider() {
  if (!fs.existsSync(GENERATED_SCHEMA_PATH)) {
    return String(process.env.PRISMA_SCHEMA_PROVIDER || process.env.DATABASE_PROVIDER || 'sqlite').trim().toLowerCase();
  }
  const text = fs.readFileSync(GENERATED_SCHEMA_PATH, 'utf8');
  const match = text.match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/m);
  return String(match?.[1] || process.env.PRISMA_SCHEMA_PROVIDER || process.env.DATABASE_PROVIDER || 'sqlite')
    .trim()
    .toLowerCase();
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
    stdio: options.stdio || 'inherit',
    shell: options.shell === true,
    encoding: options.encoding || 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status || 0) !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result;
}

function buildPostgresTestRuntime() {
  const rawUrl = String(process.env.DATABASE_URL || '').trim();
  if (!/^postgres(?:ql)?:\/\//i.test(rawUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL when generated client provider is postgresql');
  }
  const url = new URL(rawUrl);
  const schema = `test_runtime_${Date.now()}`;
  const baseUrl = new URL(rawUrl);
  baseUrl.search = '';
  url.searchParams.set('schema', schema);
  const pgBinDir = findPgBinDir();
  const sql = `DROP SCHEMA IF EXISTS "${schema}" CASCADE; CREATE SCHEMA "${schema}";`;
  runCommand(path.join(pgBinDir, 'psql.exe'), ['-v', 'ON_ERROR_STOP=1', baseUrl.toString(), '-c', sql]);
  runCommand(
    process.execPath,
    ['scripts/prisma-with-provider.js', '--provider', 'postgresql', 'db', 'push', '--skip-generate'],
    {
      env: {
        DATABASE_URL: url.toString(),
        DATABASE_PROVIDER: 'postgresql',
        PRISMA_SCHEMA_PROVIDER: 'postgresql',
      },
    },
  );
  return {
    databaseUrl: url.toString(),
    provider: 'postgresql',
    cleanup: () => {
      runCommand(path.join(pgBinDir, 'psql.exe'), ['-v', 'ON_ERROR_STOP=1', baseUrl.toString(), '-c', `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`]);
    },
  };
}

function buildTestRuntime() {
  const provider = readGeneratedProvider();
  if (provider === 'postgresql') {
    return buildPostgresTestRuntime();
  }
  return {
    databaseUrl: `file:${path.join(PROJECT_ROOT, 'prisma', 'prisma', 'test.db')}`,
    provider: 'sqlite',
    cleanup: null,
  };
}

function main() {
  const testRuntime = buildTestRuntime();
  const args = process.argv.slice(2);
  let result;
  try {
    result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...args], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: testRuntime.databaseUrl,
        DATABASE_PROVIDER: testRuntime.provider,
        PRISMA_SCHEMA_PROVIDER: testRuntime.provider,
        PRISMA_TEST_DATABASE_URL: testRuntime.databaseUrl,
        PRISMA_TEST_DATABASE_PROVIDER: testRuntime.provider,
      },
      stdio: 'inherit',
    });
  } finally {
    if (typeof testRuntime.cleanup === 'function') {
      try {
        testRuntime.cleanup();
      } catch (error) {
        console.error(`[run-tests-with-provider] cleanup failed: ${error.message}`);
      }
    }
  }
  process.exit(result?.status || 0);
}

try {
  main();
} catch (error) {
  console.error(`[run-tests-with-provider] ${error.message}`);
  process.exit(1);
}
