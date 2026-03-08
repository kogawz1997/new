const { loadJson, saveJsonDebounced } = require('./_persist');
const { prisma } = require('../prisma');

const memberships = new Map(); // userId -> { planId, expiresAt }

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

const scheduleSave = saveJsonDebounced('vip.json', () => ({
  memberships: Array.from(memberships.entries()).map(([userId, m]) => [
    userId,
    { ...m, expiresAt: m.expiresAt ? new Date(m.expiresAt).toISOString() : null },
  ]),
}));

function normalizeUserId(value) {
  return String(value || '').trim();
}

function normalizePlanId(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeMembership(row) {
  const userId = normalizeUserId(row?.userId);
  const planId = normalizePlanId(row?.planId);
  const expiresAt = normalizeDate(row?.expiresAt);
  if (!userId || !planId || !expiresAt) return null;
  return { userId, planId, expiresAt };
}

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[vipStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const rows = await prisma.vipMembership.findMany();
    if (rows.length === 0) {
      if (memberships.size > 0) {
        await queueDbWrite(
          async () => {
            for (const [userId, value] of memberships.entries()) {
              await prisma.vipMembership.upsert({
                where: { userId },
                update: {
                  planId: value.planId,
                  expiresAt: value.expiresAt,
                },
                create: {
                  userId,
                  planId: value.planId,
                  expiresAt: value.expiresAt,
                },
              });
            }
          },
          'backfill',
        );
      }
      return;
    }

    const hydrated = new Map();
    for (const row of rows) {
      const parsed = normalizeMembership(row);
      if (!parsed) continue;
      hydrated.set(parsed.userId, {
        planId: parsed.planId,
        expiresAt: parsed.expiresAt,
      });
    }

    if (startVersion === mutationVersion) {
      memberships.clear();
      for (const [userId, value] of hydrated.entries()) {
        memberships.set(userId, value);
      }
      scheduleSave();
      return;
    }

    for (const [userId, value] of hydrated.entries()) {
      if (!memberships.has(userId)) {
        memberships.set(userId, value);
      }
    }
    scheduleSave();
  } catch (error) {
    console.error('[vipStore] failed to hydrate from prisma:', error.message);
  }
}

function loadLegacySnapshot() {
  const persisted = loadJson('vip.json', null);
  if (!persisted) return;
  for (const [rawUserId, rawValue] of persisted.memberships || []) {
    const parsed = normalizeMembership({
      userId: rawUserId,
      planId: rawValue?.planId,
      expiresAt: rawValue?.expiresAt,
    });
    if (!parsed) continue;
    memberships.set(parsed.userId, {
      planId: parsed.planId,
      expiresAt: parsed.expiresAt,
    });
  }
}

function initVipStore() {
  if (!initPromise) {
    loadLegacySnapshot();
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushVipStoreWrites() {
  return dbWriteQueue;
}

function setMembership(userId, planId, expiresAt) {
  const parsed = normalizeMembership({ userId, planId, expiresAt });
  if (!parsed) return null;

  mutationVersion += 1;
  memberships.set(parsed.userId, {
    planId: parsed.planId,
    expiresAt: parsed.expiresAt,
  });
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.vipMembership.upsert({
        where: { userId: parsed.userId },
        update: {
          planId: parsed.planId,
          expiresAt: parsed.expiresAt,
        },
        create: {
          userId: parsed.userId,
          planId: parsed.planId,
          expiresAt: parsed.expiresAt,
        },
      });
    },
    'set-membership',
  );

  return getMembership(parsed.userId);
}

function getMembership(userId) {
  const key = normalizeUserId(userId);
  if (!key) return null;
  const value = memberships.get(key);
  if (!value) return null;
  return {
    planId: value.planId,
    expiresAt: value.expiresAt ? new Date(value.expiresAt) : null,
  };
}

function listMemberships() {
  return Array.from(memberships.entries()).map(([userId, m]) => ({
    userId,
    planId: m.planId,
    expiresAt: m.expiresAt ? new Date(m.expiresAt) : null,
  }));
}

function removeMembership(userId) {
  const key = normalizeUserId(userId);
  if (!key) return false;
  const existed = memberships.delete(key);
  if (!existed) return false;

  mutationVersion += 1;
  scheduleSave();
  queueDbWrite(
    async () => {
      await prisma.vipMembership.deleteMany({
        where: { userId: key },
      });
    },
    'remove-membership',
  );
  return true;
}

function replaceMemberships(nextMemberships = []) {
  mutationVersion += 1;
  memberships.clear();
  for (const row of Array.isArray(nextMemberships) ? nextMemberships : []) {
    const parsed = normalizeMembership(row);
    if (!parsed) continue;
    memberships.set(parsed.userId, {
      planId: parsed.planId,
      expiresAt: parsed.expiresAt,
    });
  }
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.vipMembership.deleteMany({});
      for (const [userId, value] of memberships.entries()) {
        await prisma.vipMembership.create({
          data: {
            userId,
            planId: value.planId,
            expiresAt: value.expiresAt,
          },
        });
      }
    },
    'replace-memberships',
  );
  return memberships.size;
}

initVipStore();

module.exports = {
  setMembership,
  getMembership,
  listMemberships,
  removeMembership,
  replaceMemberships,
  initVipStore,
  flushVipStoreWrites,
};
