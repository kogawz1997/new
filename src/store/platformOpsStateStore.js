const fs = require('node:fs');

const { getFilePath } = require('./_persist');

const FILE_PATH = getFilePath('platform-ops-state.json');

let state = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function trimText(value, maxLen = 240) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function normalizeAlertMap(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = trimText(key, 160);
    const normalizedAt = normalizeIso(entry);
    if (!normalizedKey || !normalizedAt) continue;
    out[normalizedKey] = normalizedAt;
  }
  return out;
}

function buildDefaultState() {
  return {
    schemaVersion: 1,
    updatedAt: nowIso(),
    lastMonitoringAt: null,
    lastAutoBackupAt: null,
    lastReconcileAt: null,
    lastAlertAtByKey: {},
  };
}

function normalizeState(next = {}) {
  const merged = {
    ...buildDefaultState(),
    ...(state || {}),
    ...(next && typeof next === 'object' ? next : {}),
  };
  return {
    schemaVersion: 1,
    updatedAt: normalizeIso(merged.updatedAt) || nowIso(),
    lastMonitoringAt: normalizeIso(merged.lastMonitoringAt),
    lastAutoBackupAt: normalizeIso(merged.lastAutoBackupAt),
    lastReconcileAt: normalizeIso(merged.lastReconcileAt),
    lastAlertAtByKey: normalizeAlertMap(merged.lastAlertAtByKey),
  };
}

function writeStateToDisk() {
  const snapshot = normalizeState(state || {});
  const tmpPath = `${FILE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
  fs.renameSync(tmpPath, FILE_PATH);
}

function initPlatformOpsStateStore() {
  if (state) return state;
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, 'utf8');
      if (raw.trim()) {
        state = normalizeState(JSON.parse(raw));
        return state;
      }
    }
  } catch (error) {
    console.error('[platformOpsStateStore] failed to hydrate:', error.message);
  }
  state = buildDefaultState();
  return state;
}

function getPlatformOpsState() {
  initPlatformOpsStateStore();
  return normalizeState(state || {});
}

function updatePlatformOpsState(patch = {}) {
  initPlatformOpsStateStore();
  state = normalizeState({
    ...(state || {}),
    ...(patch && typeof patch === 'object' ? patch : {}),
    updatedAt: nowIso(),
  });
  try {
    writeStateToDisk();
  } catch (error) {
    console.error('[platformOpsStateStore] failed to persist:', error.message);
  }
  return getPlatformOpsState();
}

function resetPlatformOpsState() {
  state = buildDefaultState();
  try {
    writeStateToDisk();
  } catch (error) {
    console.error('[platformOpsStateStore] failed to reset:', error.message);
  }
  return getPlatformOpsState();
}

initPlatformOpsStateStore();

module.exports = {
  getPlatformOpsState,
  initPlatformOpsStateStore,
  resetPlatformOpsState,
  updatePlatformOpsState,
};
