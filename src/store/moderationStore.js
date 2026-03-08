const { loadJson, saveJsonDebounced } = require('./_persist');
const { prisma } = require('../prisma');

const recentMessages = new Map(); // userId -> [timestamps] (ไม่ต้อง persist)
const punishments = new Map(); // userId -> [entries]

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

const scheduleSave = saveJsonDebounced('moderation.json', () => ({
  punishments: Array.from(punishments.entries()).map(([userId, arr]) => [
    userId,
    (arr || []).map((e) => ({
      ...e,
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
    })),
  ]),
}));

function normalizeDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date;
}

function normalizeEntry(entry = {}) {
  return {
    type: String(entry.type || 'note'),
    reason: String(entry.reason || ''),
    staffId: String(entry.staffId || ''),
    durationMinutes:
      entry.durationMinutes == null ? null : Number(entry.durationMinutes),
    createdAt: normalizeDate(entry.createdAt),
  };
}

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[moderationStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const rows = await prisma.punishment.findMany({
      orderBy: [{ createdAt: 'asc' }],
    });
    if (rows.length === 0) {
      if (punishments.size > 0) {
        await queueDbWrite(
          async () => {
            for (const [userId, entries] of punishments.entries()) {
              for (const entry of entries) {
                await prisma.punishment.create({
                  data: {
                    userId,
                    type: entry.type,
                    reason: entry.reason,
                    staffId: entry.staffId,
                    durationMinutes: entry.durationMinutes,
                    createdAt: normalizeDate(entry.createdAt),
                  },
                });
              }
            }
          },
          'backfill',
        );
      }
      return;
    }

    const hydrated = new Map();
    for (const row of rows) {
      const userId = String(row.userId || '').trim();
      if (!userId) continue;
      const arr = hydrated.get(userId) || [];
      arr.push(normalizeEntry(row));
      hydrated.set(userId, arr);
    }

    if (startVersion === mutationVersion) {
      punishments.clear();
      for (const [userId, entries] of hydrated.entries()) {
        punishments.set(userId, entries);
      }
      scheduleSave();
      return;
    }

    for (const [userId, entries] of hydrated.entries()) {
      if (!punishments.has(userId)) {
        punishments.set(userId, entries);
      }
    }
    scheduleSave();
  } catch (error) {
    console.error('[moderationStore] failed to hydrate from prisma:', error.message);
  }
}

function loadLegacySnapshot() {
  const persisted = loadJson('moderation.json', null);
  if (!persisted) return;
  for (const [userIdRaw, arr] of persisted.punishments || []) {
    const userId = String(userIdRaw || '').trim();
    if (!userId || !Array.isArray(arr)) continue;
    punishments.set(
      userId,
      arr.map((entry) => normalizeEntry(entry)),
    );
  }
}

function initModerationStore() {
  if (!initPromise) {
    loadLegacySnapshot();
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushModerationStoreWrites() {
  return dbWriteQueue;
}

function pushMessage(userId, timestamp) {
  const arr = recentMessages.get(userId) || [];
  arr.push(timestamp);
  recentMessages.set(userId, arr);
}

function getRecentMessages(userId, sinceMs) {
  const arr = recentMessages.get(userId) || [];
  const filtered = arr.filter((t) => Date.now() - t <= sinceMs);
  recentMessages.set(userId, filtered);
  return filtered;
}

function addPunishment(userId, type, reason, staffId, durationMinutes) {
  const key = String(userId || '').trim();
  if (!key) return null;
  const arr = punishments.get(key) || [];
  const entry = normalizeEntry({
    type,
    reason,
    staffId,
    durationMinutes,
    createdAt: new Date(),
  });
  arr.push(entry);
  punishments.set(key, arr);
  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.punishment.create({
        data: {
          userId: key,
          type: entry.type,
          reason: entry.reason,
          staffId: entry.staffId,
          durationMinutes: entry.durationMinutes,
          createdAt: entry.createdAt,
        },
      });
    },
    'add-punishment',
  );
  return entry;
}

function getPunishments(userId) {
  return punishments.get(userId) || [];
}

function listAllPunishments() {
  return Array.from(punishments.entries()).map(([userId, entries]) => ({
    userId,
    entries: entries || [],
  }));
}

function replacePunishments(nextRows = []) {
  mutationVersion += 1;
  punishments.clear();
  for (const row of Array.isArray(nextRows) ? nextRows : []) {
    if (!row || typeof row !== 'object') continue;
    const userId = String(row.userId || '').trim();
    if (!userId) continue;
    const entries = Array.isArray(row.entries) ? row.entries : [];
    punishments.set(userId, entries.map((entry) => normalizeEntry(entry)));
  }
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.punishment.deleteMany({});
      for (const [userId, entries] of punishments.entries()) {
        for (const entry of entries) {
          await prisma.punishment.create({
            data: {
              userId,
              type: entry.type,
              reason: entry.reason,
              staffId: entry.staffId,
              durationMinutes: entry.durationMinutes,
              createdAt: entry.createdAt,
            },
          });
        }
      }
    },
    'replace-punishments',
  );
  return punishments.size;
}

initModerationStore();

module.exports = {
  pushMessage,
  getRecentMessages,
  addPunishment,
  getPunishments,
  listAllPunishments,
  replacePunishments,
  initModerationStore,
  flushModerationStoreWrites,
};
