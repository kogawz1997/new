const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

function normalizeText(value) {
  return String(value || '').trim();
}

function isNodeTestRuntime() {
  if (normalizeText(process.env.NODE_ENV).toLowerCase() === 'test') {
    return true;
  }
  return process.execArgv.some((arg) => String(arg || '').startsWith('--test'));
}

function normalizeFileDatabasePath(databaseUrl) {
  const raw = normalizeText(databaseUrl);
  if (!raw.startsWith('file:')) return '';
  const filePath = raw.slice('file:'.length).replace(/^"|"$/g, '');
  if (!filePath) return '';
  return path.resolve(process.cwd(), 'prisma', filePath);
}

function shouldForceIsolatedTestDatabase() {
  if (!isNodeTestRuntime()) return false;
  const rawUrl = normalizeText(process.env.DATABASE_URL);
  if (!rawUrl) return true;
  if (/^postgres(?:ql)?:\/\//i.test(rawUrl) || /^mysql:\/\//i.test(rawUrl)) {
    return true;
  }
  if (!rawUrl.startsWith('file:')) {
    return true;
  }
  const resolvedPath = normalizeFileDatabasePath(rawUrl);
  const sharedDbPaths = new Set([
    path.resolve(process.cwd(), 'prisma', 'dev.db'),
    path.resolve(process.cwd(), 'prisma', 'production.db'),
    path.resolve(process.cwd(), 'prisma', 'prisma', 'dev.db'),
    path.resolve(process.cwd(), 'prisma', 'prisma', 'production.db'),
    path.resolve(process.cwd(), 'prisma', 'test.db'),
  ]);
  return !resolvedPath || sharedDbPaths.has(resolvedPath);
}

function ensureTestDatabaseDefaults() {
  if (!isNodeTestRuntime()) return;
  process.env.NODE_ENV = 'test';
  const explicitTestDatabaseUrl = normalizeText(process.env.PRISMA_TEST_DATABASE_URL);
  if (explicitTestDatabaseUrl) {
    process.env.DATABASE_URL = explicitTestDatabaseUrl;
    process.env.DATABASE_PROVIDER = normalizeText(process.env.PRISMA_TEST_DATABASE_PROVIDER) || 'postgresql';
    process.env.PRISMA_SCHEMA_PROVIDER = normalizeText(process.env.PRISMA_TEST_DATABASE_PROVIDER) || 'postgresql';
    return;
  }
  const forceIsolatedDatabase = shouldForceIsolatedTestDatabase();
  if (forceIsolatedDatabase) {
    process.env.DATABASE_URL = `file:${path.join(process.cwd(), 'prisma', 'prisma', 'test.db')}`;
  }
  if (forceIsolatedDatabase || !normalizeText(process.env.DATABASE_PROVIDER)) {
    process.env.DATABASE_PROVIDER = 'sqlite';
  }
  if (forceIsolatedDatabase || !normalizeText(process.env.PRISMA_SCHEMA_PROVIDER)) {
    process.env.PRISMA_SCHEMA_PROVIDER = 'sqlite';
  }
}

let cachedClient = null;
let cachedKey = '';

function getClientKey() {
  ensureTestDatabaseDefaults();
  return JSON.stringify({
    databaseUrl: String(process.env.DATABASE_URL || '').trim(),
    provider: String(process.env.PRISMA_SCHEMA_PROVIDER || process.env.DATABASE_PROVIDER || '').trim(),
    nodeEnv: String(process.env.NODE_ENV || '').trim(),
  });
}

function createPrismaClient() {
  return new PrismaClient();
}

function getPrismaClient() {
  const nextKey = getClientKey();
  if (!cachedClient || cachedKey !== nextKey) {
    if (cachedClient) {
      cachedClient.$disconnect().catch(() => {});
    }
    cachedClient = createPrismaClient();
    cachedKey = nextKey;
  }
  return cachedClient;
}

async function disconnectPrismaClient() {
  if (!cachedClient) return;
  const client = cachedClient;
  cachedClient = null;
  cachedKey = '';
  await client.$disconnect();
}

const prisma = new Proxy({}, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = client[property];
    return typeof value === 'function' ? value.bind(client) : value;
  },
  set(_target, property, value) {
    const client = getPrismaClient();
    client[property] = value;
    return true;
  },
  has(_target, property) {
    const client = getPrismaClient();
    return property in client;
  },
  ownKeys() {
    return Reflect.ownKeys(getPrismaClient());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Object.getOwnPropertyDescriptor(getPrismaClient(), property);
    if (descriptor) return descriptor;
    return {
      configurable: true,
      enumerable: true,
      writable: false,
      value: getPrismaClient()[property],
    };
  },
});

module.exports = {
  prisma,
  getPrismaClient,
  disconnectPrismaClient,
};
