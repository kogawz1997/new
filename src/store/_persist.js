const fs = require('node:fs');
const path = require('node:path');
const { resolveDatabaseRuntime } = require('../utils/dbEngine');

function isTruthy(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = process.env.BOT_DATA_DIR
  ? path.resolve(process.env.BOT_DATA_DIR)
  : path.join(PROJECT_ROOT, 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getFilePath(filename) {
  ensureDataDir();
  return path.join(DATA_DIR, filename);
}

function atomicWriteJson(filePath, obj) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function resolveDbRuntime() {
  const runtime = resolveDatabaseRuntime({
    projectRoot: PROJECT_ROOT,
  });
  if (runtime.isSqlite && runtime.filePath) {
    const dir = path.dirname(runtime.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return runtime;
}

const DB_RUNTIME = resolveDbRuntime();
const DB_PATH = DB_RUNTIME.filePath || null;
const REQUIRE_DB = isTruthy(process.env.PERSIST_REQUIRE_DB);
const IS_PRODUCTION =
  String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const LEGACY_SNAPSHOTS_ENABLED = (() => {
  const raw = String(process.env.PERSIST_LEGACY_SNAPSHOTS || '').trim();
  if (raw) return isTruthy(raw);
  if (REQUIRE_DB || IS_PRODUCTION) return false;
  return true;
})();

if (IS_PRODUCTION && !REQUIRE_DB) {
  throw new Error(
    '[persist] NODE_ENV=production requires PERSIST_REQUIRE_DB=true',
  );
}

if (IS_PRODUCTION && LEGACY_SNAPSHOTS_ENABLED) {
  throw new Error(
    '[persist] NODE_ENV=production requires PERSIST_LEGACY_SNAPSHOTS=false',
  );
}

const persistenceMode = REQUIRE_DB
  ? 'db-only'
  : LEGACY_SNAPSHOTS_ENABLED
    ? 'legacy-file-snapshot'
    : 'disabled';
const fallbackReason = LEGACY_SNAPSHOTS_ENABLED
  ? null
  : REQUIRE_DB
    ? 'db-only-mode'
    : 'snapshots-disabled';

function loadFromFile(filename) {
  const filePath = getFilePath(filename);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw || !raw.trim()) return null;
  return JSON.parse(raw);
}

function saveToFile(filename, obj) {
  const filePath = getFilePath(filename);
  atomicWriteJson(filePath, obj);
}

function loadJson(filename, fallback) {
  if (!LEGACY_SNAPSHOTS_ENABLED) {
    return fallback;
  }

  try {
    const fromFile = loadFromFile(filename);
    return fromFile == null ? fallback : fromFile;
  } catch (err) {
    console.error(`Failed to load ${filename}`, err);
    return fallback;
  }
}

const timers = new Map(); // filename -> timeout

function saveJsonDebounced(filename, producer, waitMs = 300) {
  return function scheduleSave() {
    if (!LEGACY_SNAPSHOTS_ENABLED) return;
    const prev = timers.get(filename);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      try {
        const payload = producer();
        saveToFile(filename, payload);
      } catch (err) {
        console.error(`Failed to save ${filename}`, err);
      }
    }, waitMs);
    timers.set(filename, t);
  };
}

function isDbPersistenceEnabled() {
  return REQUIRE_DB;
}

function getPersistenceStatus() {
  return {
    mode: persistenceMode,
    requireDb: REQUIRE_DB,
    databaseEngine: DB_RUNTIME.engine,
    databaseProvider: DB_RUNTIME.provider,
    databaseUrl: DB_RUNTIME.rawUrl,
    dbPath: DB_PATH,
    dataDir: DATA_DIR,
    legacySnapshotsEnabled: LEGACY_SNAPSHOTS_ENABLED,
    fallbackReason,
  };
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  loadJson,
  saveJsonDebounced,
  getFilePath,
  isDbPersistenceEnabled,
  getPersistenceStatus,
};
