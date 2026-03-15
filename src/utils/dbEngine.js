const path = require('node:path');

function trimText(value) {
  return String(value || '').trim();
}

function stripWrappedQuotes(value) {
  const text = trimText(value);
  return text.replace(/^"|"$/g, '');
}

function normalizeProvider(value, fallback = 'sqlite') {
  const text = trimText(value).toLowerCase();
  if (text === 'postgres' || text === 'postgresql') return 'postgresql';
  if (text === 'mysql') return 'mysql';
  if (text === 'sqlite') return 'sqlite';
  return fallback;
}

function getEngineFromDatabaseUrl(databaseUrl) {
  const raw = trimText(databaseUrl);
  if (!raw) return 'sqlite';
  if (raw.startsWith('file:')) return 'sqlite';
  if (/^postgres(?:ql)?:\/\//i.test(raw)) return 'postgresql';
  if (/^mysql:\/\//i.test(raw)) return 'mysql';
  return 'unsupported';
}

function resolveSqlitePath(databaseUrl, projectRoot = process.cwd(), schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma')) {
  const raw = trimText(databaseUrl);
  if (!raw.startsWith('file:')) return null;
  const filePath = stripWrappedQuotes(raw.slice('file:'.length));
  if (!filePath) return null;
  const schemaDir = path.dirname(path.resolve(projectRoot, schemaPath));
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(schemaDir, filePath);
}

function resolveDatabaseRuntime(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const schemaPath = options.schemaPath || path.join(projectRoot, 'prisma', 'schema.prisma');
  const hasExplicitDatabaseUrl = options.databaseUrl != null;
  const rawUrl = trimText(
    options.databaseUrl == null ? process.env.DATABASE_URL || 'file:./prisma/dev.db' : options.databaseUrl,
  );
  const engine = getEngineFromDatabaseUrl(rawUrl);
  const requestedProvider = normalizeProvider(
    options.provider
      || (!hasExplicitDatabaseUrl
        ? process.env.PRISMA_SCHEMA_PROVIDER || process.env.DATABASE_PROVIDER
        : '')
      || engine,
    engine === 'unsupported' ? 'sqlite' : engine,
  );
  const filePath = engine === 'sqlite'
    ? resolveSqlitePath(rawUrl, projectRoot, schemaPath)
    : null;

  return {
    rawUrl,
    engine,
    provider: requestedProvider,
    filePath,
    isSqlite: engine === 'sqlite',
    isServerEngine: engine === 'postgresql' || engine === 'mysql',
    supportsFileBackup: engine === 'sqlite' && Boolean(filePath),
  };
}

module.exports = {
  getEngineFromDatabaseUrl,
  normalizeProvider,
  resolveDatabaseRuntime,
  resolveSqlitePath,
};
