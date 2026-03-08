const { loadJson, saveJsonDebounced } = require('./_persist');
const { prisma } = require('../prisma');

const serverStatus = {
  onlinePlayers: 0,
  maxPlayers: 90,
  pingMs: null,
  uptimeMinutes: 0,
  lastUpdated: null,
};

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

const scheduleSave = saveJsonDebounced('scum-status.json', () => ({
  ...serverStatus,
  lastUpdated: serverStatus.lastUpdated
    ? new Date(serverStatus.lastUpdated).toISOString()
    : null,
}));

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeStatus(input = {}) {
  return {
    onlinePlayers: Number.isFinite(Number(input.onlinePlayers))
      ? Math.max(0, Math.trunc(Number(input.onlinePlayers)))
      : 0,
    maxPlayers: Number.isFinite(Number(input.maxPlayers))
      ? Math.max(0, Math.trunc(Number(input.maxPlayers)))
      : 90,
    pingMs:
      input.pingMs == null || !Number.isFinite(Number(input.pingMs))
        ? null
        : Math.max(0, Math.trunc(Number(input.pingMs))),
    uptimeMinutes: Number.isFinite(Number(input.uptimeMinutes))
      ? Math.max(0, Math.trunc(Number(input.uptimeMinutes)))
      : 0,
    lastUpdated: normalizeDate(input.lastUpdated),
  };
}

function applyStatus(next = {}) {
  if (typeof next.onlinePlayers === 'number') {
    serverStatus.onlinePlayers = next.onlinePlayers;
  }
  if (typeof next.maxPlayers === 'number') {
    serverStatus.maxPlayers = next.maxPlayers;
  }
  if (typeof next.pingMs === 'number' || next.pingMs == null) {
    serverStatus.pingMs = next.pingMs == null ? null : next.pingMs;
  }
  if (typeof next.uptimeMinutes === 'number') {
    serverStatus.uptimeMinutes = next.uptimeMinutes;
  }
  if (next.lastUpdated === null || next.lastUpdated instanceof Date) {
    serverStatus.lastUpdated = next.lastUpdated;
  }
}

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[scumStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const row = await prisma.scumStatus.findUnique({
      where: { id: 1 },
    });
    if (!row) {
      const hasLegacy =
        serverStatus.onlinePlayers !== 0 ||
        serverStatus.maxPlayers !== 90 ||
        serverStatus.pingMs != null ||
        serverStatus.uptimeMinutes !== 0 ||
        serverStatus.lastUpdated != null;
      if (hasLegacy) {
        await queueDbWrite(
          async () => {
            await prisma.scumStatus.upsert({
              where: { id: 1 },
              update: {
                onlinePlayers: serverStatus.onlinePlayers,
                maxPlayers: serverStatus.maxPlayers,
                pingMs: serverStatus.pingMs,
                uptimeMinutes: serverStatus.uptimeMinutes,
                lastUpdated: serverStatus.lastUpdated,
              },
              create: {
                id: 1,
                onlinePlayers: serverStatus.onlinePlayers,
                maxPlayers: serverStatus.maxPlayers,
                pingMs: serverStatus.pingMs,
                uptimeMinutes: serverStatus.uptimeMinutes,
                lastUpdated: serverStatus.lastUpdated,
              },
            });
          },
          'backfill',
        );
      }
      return;
    }

    const parsed = normalizeStatus(row);
    if (startVersion === mutationVersion) {
      applyStatus(parsed);
      scheduleSave();
    }
  } catch (error) {
    console.error('[scumStore] failed to hydrate from prisma:', error.message);
  }
}

function loadLegacySnapshot() {
  const persisted = loadJson('scum-status.json', null);
  if (!persisted) return;
  applyStatus(normalizeStatus(persisted));
}

function initScumStore() {
  if (!initPromise) {
    loadLegacySnapshot();
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushScumStoreWrites() {
  return dbWriteQueue;
}

function updateStatus({ onlinePlayers, maxPlayers, pingMs, uptimeMinutes }) {
  mutationVersion += 1;
  if (typeof onlinePlayers === 'number') serverStatus.onlinePlayers = onlinePlayers;
  if (typeof maxPlayers === 'number') serverStatus.maxPlayers = maxPlayers;
  if (typeof pingMs === 'number') serverStatus.pingMs = pingMs;
  if (typeof uptimeMinutes === 'number') serverStatus.uptimeMinutes = uptimeMinutes;
  serverStatus.lastUpdated = new Date();
  scheduleSave();

  const snapshot = getStatus();
  queueDbWrite(
    async () => {
      await prisma.scumStatus.upsert({
        where: { id: 1 },
        update: {
          onlinePlayers: snapshot.onlinePlayers,
          maxPlayers: snapshot.maxPlayers,
          pingMs: snapshot.pingMs,
          uptimeMinutes: snapshot.uptimeMinutes,
          lastUpdated: snapshot.lastUpdated,
        },
        create: {
          id: 1,
          onlinePlayers: snapshot.onlinePlayers,
          maxPlayers: snapshot.maxPlayers,
          pingMs: snapshot.pingMs,
          uptimeMinutes: snapshot.uptimeMinutes,
          lastUpdated: snapshot.lastUpdated,
        },
      });
    },
    'update-status',
  );
}

function getStatus() {
  return {
    ...serverStatus,
    lastUpdated: serverStatus.lastUpdated ? new Date(serverStatus.lastUpdated) : null,
  };
}

function replaceStatus(nextStatus = {}) {
  if (!nextStatus || typeof nextStatus !== 'object') return getStatus();

  mutationVersion += 1;
  const parsed = normalizeStatus(nextStatus);
  applyStatus({
    ...parsed,
    lastUpdated: parsed.lastUpdated || new Date(),
  });
  scheduleSave();

  const snapshot = getStatus();
  queueDbWrite(
    async () => {
      await prisma.scumStatus.upsert({
        where: { id: 1 },
        update: {
          onlinePlayers: snapshot.onlinePlayers,
          maxPlayers: snapshot.maxPlayers,
          pingMs: snapshot.pingMs,
          uptimeMinutes: snapshot.uptimeMinutes,
          lastUpdated: snapshot.lastUpdated,
        },
        create: {
          id: 1,
          onlinePlayers: snapshot.onlinePlayers,
          maxPlayers: snapshot.maxPlayers,
          pingMs: snapshot.pingMs,
          uptimeMinutes: snapshot.uptimeMinutes,
          lastUpdated: snapshot.lastUpdated,
        },
      });
    },
    'replace-status',
  );
  return getStatus();
}

initScumStore();

module.exports = {
  updateStatus,
  getStatus,
  replaceStatus,
  initScumStore,
  flushScumStoreWrites,
};
