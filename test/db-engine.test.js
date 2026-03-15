const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getEngineFromDatabaseUrl,
  normalizeProvider,
  resolveDatabaseRuntime,
  resolveSqlitePath,
} = require('../src/utils/dbEngine');
const {
  parseCliArgs,
  renderSchemaForProvider,
  resolveProvider,
} = require('../scripts/prisma-with-provider');

test('db engine helpers resolve sqlite, postgresql, and mysql runtimes', () => {
  assert.equal(getEngineFromDatabaseUrl('file:./prisma/dev.db'), 'sqlite');
  assert.equal(getEngineFromDatabaseUrl('postgresql://user:pass@localhost:5432/app'), 'postgresql');
  assert.equal(getEngineFromDatabaseUrl('mysql://user:pass@localhost:3306/app'), 'mysql');
  assert.equal(getEngineFromDatabaseUrl('sqlserver://example'), 'unsupported');
  assert.equal(normalizeProvider('postgres'), 'postgresql');
  assert.equal(normalizeProvider('mysql'), 'mysql');
  assert.equal(normalizeProvider(''), 'sqlite');

  const sqliteRuntime = resolveDatabaseRuntime({
    databaseUrl: 'file:./prisma/dev.db',
    projectRoot: 'C:/repo',
  });
  assert.equal(sqliteRuntime.engine, 'sqlite');
  assert.equal(sqliteRuntime.provider, 'sqlite');
  assert.equal(sqliteRuntime.isSqlite, true);
  assert.equal(
    resolveSqlitePath('file:./prisma/dev.db', 'C:/repo').replace(/\\/g, '/'),
    'C:/repo/prisma/prisma/dev.db',
  );

  const postgresRuntime = resolveDatabaseRuntime({
    databaseUrl: 'postgresql://user:pass@localhost:5432/app',
    provider: 'postgres',
  });
  assert.equal(postgresRuntime.engine, 'postgresql');
  assert.equal(postgresRuntime.provider, 'postgresql');
  assert.equal(postgresRuntime.isServerEngine, true);

  const mysqlRuntime = resolveDatabaseRuntime({
    databaseUrl: 'mysql://user:pass@localhost:3306/app',
    provider: 'mysql',
  });
  assert.equal(mysqlRuntime.engine, 'mysql');
  assert.equal(mysqlRuntime.provider, 'mysql');
  assert.equal(mysqlRuntime.supportsFileBackup, false);
});

test('prisma wrapper parses args and renders provider-specific schema', () => {
  const parsed = parseCliArgs(['--provider', 'postgresql', 'migrate', 'deploy']);
  assert.equal(parsed.provider, 'postgresql');
  assert.deepEqual(parsed.args, ['migrate', 'deploy']);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-provider-test-'));
  const sourcePath = path.join(tmpDir, 'schema.prisma');
  const outputDir = path.join(tmpDir, 'out');
  fs.writeFileSync(sourcePath, `
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
`, 'utf8');

  const rendered = renderSchemaForProvider('postgresql', {
    sourcePath,
    outputDir,
  });
  assert.equal(rendered.provider, 'postgresql');
  assert.equal(fs.existsSync(rendered.outputPath), true);
  const output = fs.readFileSync(rendered.outputPath, 'utf8');
  assert.match(output, /provider\s*=\s*"postgresql"/);
});

test('prisma wrapper resolves provider from DATABASE_URL when not passed explicitly', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSchemaProvider = process.env.PRISMA_SCHEMA_PROVIDER;

  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
  delete process.env.PRISMA_SCHEMA_PROVIDER;

  try {
    assert.equal(resolveProvider(''), 'postgresql');
  } finally {
    if (previousDatabaseUrl == null) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousSchemaProvider == null) {
      delete process.env.PRISMA_SCHEMA_PROVIDER;
    } else {
      process.env.PRISMA_SCHEMA_PROVIDER = previousSchemaProvider;
    }
  }
});
