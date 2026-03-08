// Redeem code store:
// - in-memory map for fast reads
// - Prisma write-through for persistent source of truth
// - legacy JSON snapshot retained as fallback/backup

const { loadJson, saveJsonDebounced } = require('./_persist');
const { prisma } = require('../prisma');

const codes = new Map(); // code -> { type, amount, itemId, usedBy, usedAt }

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!['coins', 'item'].includes(type)) return null;
  return type;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.trunc(amount));
}

function normalizeItemId(value) {
  const itemId = String(value || '').trim();
  return itemId || null;
}

function normalizeUsedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeRecord(input = {}) {
  const type = normalizeType(input.type);
  if (!type) return null;

  const data = {
    type,
    amount: null,
    itemId: null,
    usedBy: input.usedBy ? String(input.usedBy) : null,
    usedAt: normalizeUsedAt(input.usedAt),
  };

  if (type === 'coins') {
    data.amount = normalizeAmount(input.amount);
    data.itemId = null;
  } else {
    data.itemId = normalizeItemId(input.itemId);
    data.amount = null;
  }

  return data;
}

function toSerializableCode(code, value) {
  return {
    code,
    type: value.type,
    amount: value.amount == null ? null : Number(value.amount),
    itemId: value.itemId || null,
    usedBy: value.usedBy || null,
    usedAt: value.usedAt ? new Date(value.usedAt).toISOString() : null,
  };
}

const scheduleSave = saveJsonDebounced('redeem.json', () => ({
  codes: Array.from(codes.entries()).map(([code, value]) => [
    code,
    {
      ...value,
      usedAt: value.usedAt ? new Date(value.usedAt).toISOString() : null,
    },
  ]),
}));

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[redeemStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const rows = await prisma.redeemCode.findMany({
      orderBy: [{ code: 'asc' }],
    });

    if (rows.length === 0) {
      if (codes.size > 0) {
        await queueDbWrite(
          async () => {
            for (const [code, value] of codes.entries()) {
              await prisma.redeemCode.upsert({
                where: { code },
                update: {
                  type: value.type,
                  amount: value.amount,
                  itemId: value.itemId,
                  usedBy: value.usedBy,
                  usedAt: value.usedAt,
                },
                create: {
                  code,
                  type: value.type,
                  amount: value.amount,
                  itemId: value.itemId,
                  usedBy: value.usedBy,
                  usedAt: value.usedAt,
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
      const code = normalizeCode(row.code);
      const value = normalizeRecord(row);
      if (!code || !value) continue;
      hydrated.set(code, value);
    }

    if (startVersion === mutationVersion) {
      codes.clear();
      for (const [code, value] of hydrated.entries()) {
        codes.set(code, value);
      }
      scheduleSave();
      return;
    }

    for (const [code, value] of hydrated.entries()) {
      if (!codes.has(code)) {
        codes.set(code, value);
      }
    }
    scheduleSave();
  } catch (error) {
    console.error('[redeemStore] failed to hydrate from prisma:', error.message);
  }
}

function loadLegacySnapshot() {
  const persisted = loadJson('redeem.json', null);
  if (!persisted) return;

  codes.clear();
  for (const [rawCode, rawValue] of persisted.codes || []) {
    const code = normalizeCode(rawCode);
    const value = normalizeRecord(rawValue || {});
    if (!code || !value) continue;
    codes.set(code, value);
  }
}

function initRedeemStore() {
  if (!initPromise) {
    loadLegacySnapshot();
    if (!codes.has('WELCOME1000')) {
      codes.set('WELCOME1000', {
        type: 'coins',
        amount: 1000,
        itemId: null,
        usedBy: null,
        usedAt: null,
      });
    }
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushRedeemStoreWrites() {
  return dbWriteQueue;
}

function getCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const value = codes.get(normalized);
  if (!value) return null;
  return {
    ...value,
    usedAt: value.usedAt ? new Date(value.usedAt) : null,
  };
}

function markUsed(code, userId) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const value = codes.get(normalized);
  if (!value) return null;

  mutationVersion += 1;
  const usedAt = new Date();
  value.usedBy = String(userId || '');
  value.usedAt = usedAt;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.redeemCode.upsert({
        where: { code: normalized },
        update: {
          type: value.type,
          amount: value.amount,
          itemId: value.itemId,
          usedBy: value.usedBy,
          usedAt,
        },
        create: {
          code: normalized,
          type: value.type,
          amount: value.amount,
          itemId: value.itemId,
          usedBy: value.usedBy,
          usedAt,
        },
      });
    },
    'mark-used',
  );

  return getCode(normalized);
}

function setCode(code, payload) {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, reason: 'invalid-code' };

  const value = normalizeRecord({
    type: payload?.type,
    amount: payload?.amount,
    itemId: payload?.itemId,
    usedBy: null,
    usedAt: null,
  });
  if (!value) {
    return { ok: false, reason: 'invalid-type' };
  }

  mutationVersion += 1;
  codes.set(normalized, value);
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.redeemCode.upsert({
        where: { code: normalized },
        update: {
          type: value.type,
          amount: value.amount,
          itemId: value.itemId,
          usedBy: null,
          usedAt: null,
        },
        create: {
          code: normalized,
          type: value.type,
          amount: value.amount,
          itemId: value.itemId,
          usedBy: null,
          usedAt: null,
        },
      });
    },
    'set-code',
  );

  return { ok: true, code: normalized, value: getCode(normalized) };
}

function deleteCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return false;

  const existed = codes.delete(normalized);
  if (!existed) return false;

  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.redeemCode.deleteMany({
        where: { code: normalized },
      });
    },
    'delete-code',
  );
  return true;
}

function resetCodeUsage(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const value = codes.get(normalized);
  if (!value) return null;

  mutationVersion += 1;
  value.usedBy = null;
  value.usedAt = null;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.redeemCode.upsert({
        where: { code: normalized },
        update: {
          type: value.type,
          amount: value.amount,
          itemId: value.itemId,
          usedBy: null,
          usedAt: null,
        },
        create: {
          code: normalized,
          type: value.type,
          amount: value.amount,
          itemId: value.itemId,
          usedBy: null,
          usedAt: null,
        },
      });
    },
    'reset-code-usage',
  );

  return getCode(normalized);
}

function listCodes() {
  return Array.from(codes.entries()).map(([code, value]) =>
    toSerializableCode(code, value),
  );
}

function replaceCodes(nextCodes = []) {
  mutationVersion += 1;
  codes.clear();

  for (const row of Array.isArray(nextCodes) ? nextCodes : []) {
    if (!row || typeof row !== 'object') continue;
    const code = normalizeCode(row.code);
    const value = normalizeRecord(row);
    if (!code || !value) continue;
    codes.set(code, value);
  }

  if (!codes.has('WELCOME1000')) {
    codes.set('WELCOME1000', {
      type: 'coins',
      amount: 1000,
      itemId: null,
      usedBy: null,
      usedAt: null,
    });
  }

  scheduleSave();
  queueDbWrite(
    async () => {
      await prisma.redeemCode.deleteMany({});
      for (const [code, value] of codes.entries()) {
        await prisma.redeemCode.create({
          data: {
            code,
            type: value.type,
            amount: value.amount,
            itemId: value.itemId,
            usedBy: value.usedBy,
            usedAt: value.usedAt,
          },
        });
      }
    },
    'replace-codes',
  );

  return codes.size;
}

initRedeemStore();

module.exports = {
  getCode,
  markUsed,
  setCode,
  deleteCode,
  resetCodeUsage,
  listCodes,
  codes,
  replaceCodes,
  initRedeemStore,
  flushRedeemStoreWrites,
};
