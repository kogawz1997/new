const crypto = require('node:crypto');
const { prisma } = require('../prisma');

const MAX_AUDIT_ITEMS = 3000;
const audits = [];

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

function normalizeAudit(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : new Date();
  const generatedId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const id = String(entry.id || `audit-${generatedId}`);
  return {
    id,
    createdAt,
    tenantId: entry.tenantId ? String(entry.tenantId) : null,
    level: String(entry.level || 'info'),
    action: String(entry.action || 'event'),
    purchaseCode: entry.purchaseCode ? String(entry.purchaseCode) : null,
    itemId: entry.itemId ? String(entry.itemId) : null,
    userId: entry.userId ? String(entry.userId) : null,
    steamId: entry.steamId ? String(entry.steamId) : null,
    attempt: entry.attempt == null ? null : Number(entry.attempt),
    message: entry.message ? String(entry.message) : '',
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : null,
  };
}

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[deliveryAuditStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function trimOldAuditRows() {
  const total = await prisma.deliveryAudit.count();
  if (total <= MAX_AUDIT_ITEMS) return;
  const overflow = total - MAX_AUDIT_ITEMS;
  const rows = await prisma.deliveryAudit.findMany({
    orderBy: { createdAt: 'asc' },
    take: overflow,
  });
  if (rows.length === 0) return;
  await prisma.deliveryAudit.deleteMany({
    where: {
      id: {
        in: rows.map((row) => row.id),
      },
    },
  });
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const rows = await prisma.deliveryAudit.findMany({
      orderBy: { createdAt: 'asc' },
      take: MAX_AUDIT_ITEMS,
    });
    if (rows.length === 0) {
      if (audits.length > 0) {
        await queueDbWrite(
          async () => {
            for (const entry of audits) {
              await prisma.deliveryAudit.upsert({
                where: { id: entry.id },
                update: {
                  createdAt: entry.createdAt,
                  tenantId: entry.tenantId,
                  level: entry.level,
                  action: entry.action,
                  purchaseCode: entry.purchaseCode,
                  itemId: entry.itemId,
                  userId: entry.userId,
                  steamId: entry.steamId,
                  attempt: entry.attempt,
                  message: entry.message,
                  metaJson: entry.meta ? JSON.stringify(entry.meta) : null,
                },
                create: {
                  id: entry.id,
                  createdAt: entry.createdAt,
                  tenantId: entry.tenantId,
                  level: entry.level,
                  action: entry.action,
                  purchaseCode: entry.purchaseCode,
                  itemId: entry.itemId,
                  userId: entry.userId,
                  steamId: entry.steamId,
                  attempt: entry.attempt,
                  message: entry.message,
                  metaJson: entry.meta ? JSON.stringify(entry.meta) : null,
                },
              });
            }
            await trimOldAuditRows();
          },
          'backfill',
        );
      }
      return;
    }

    const hydrated = [];
    for (const row of rows) {
      const parsed = normalizeAudit({
        id: row.id,
        createdAt: row.createdAt,
        tenantId: row.tenantId,
        level: row.level,
        action: row.action,
        purchaseCode: row.purchaseCode,
        itemId: row.itemId,
        userId: row.userId,
        steamId: row.steamId,
        attempt: row.attempt,
        message: row.message,
        meta: row.metaJson ? JSON.parse(row.metaJson) : null,
      });
      if (!parsed) continue;
      hydrated.push(parsed);
    }

    if (startVersion === mutationVersion) {
      audits.length = 0;
      for (const entry of hydrated) {
        audits.push(entry);
      }
      if (audits.length > MAX_AUDIT_ITEMS) {
        audits.splice(0, audits.length - MAX_AUDIT_ITEMS);
      }
      return;
    }

    const existingIds = new Set(audits.map((entry) => entry.id));
    for (const entry of hydrated) {
      if (!existingIds.has(entry.id)) {
        audits.push(entry);
      }
    }
    audits.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (audits.length > MAX_AUDIT_ITEMS) {
      audits.splice(0, audits.length - MAX_AUDIT_ITEMS);
    }
  } catch (error) {
    console.error('[deliveryAuditStore] failed to hydrate from prisma:', error.message);
  }
}

function initDeliveryAuditStore() {
  if (!initPromise) {
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushDeliveryAuditStoreWrites() {
  return dbWriteQueue;
}

function addDeliveryAudit(entry) {
  const normalized = normalizeAudit(entry);
  if (!normalized) return null;
  audits.push(normalized);
  if (audits.length > MAX_AUDIT_ITEMS) {
    audits.splice(0, audits.length - MAX_AUDIT_ITEMS);
  }
  mutationVersion += 1;

  queueDbWrite(
    async () => {
      await prisma.deliveryAudit.upsert({
        where: { id: normalized.id },
        update: {
          createdAt: normalized.createdAt,
          tenantId: normalized.tenantId,
          level: normalized.level,
          action: normalized.action,
          purchaseCode: normalized.purchaseCode,
          itemId: normalized.itemId,
          userId: normalized.userId,
          steamId: normalized.steamId,
          attempt: normalized.attempt,
          message: normalized.message,
          metaJson: normalized.meta ? JSON.stringify(normalized.meta) : null,
        },
        create: {
          id: normalized.id,
          createdAt: normalized.createdAt,
          tenantId: normalized.tenantId,
          level: normalized.level,
          action: normalized.action,
          purchaseCode: normalized.purchaseCode,
          itemId: normalized.itemId,
          userId: normalized.userId,
          steamId: normalized.steamId,
          attempt: normalized.attempt,
          message: normalized.message,
          metaJson: normalized.meta ? JSON.stringify(normalized.meta) : null,
        },
      });
      await trimOldAuditRows();
    },
    'add-delivery-audit',
  );
  return normalized;
}

function listDeliveryAudit(limit = 500) {
  const max = Math.max(1, Number(limit || 500));
  return audits
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, max)
    .map((a) => ({ ...a }));
}

function clearDeliveryAudit() {
  audits.length = 0;
  mutationVersion += 1;
  queueDbWrite(
    async () => {
      await prisma.deliveryAudit.deleteMany({});
    },
    'clear-delivery-audit',
  );
}

function replaceDeliveryAudit(nextAudits = []) {
  audits.length = 0;
  mutationVersion += 1;
  for (const row of Array.isArray(nextAudits) ? nextAudits : []) {
    const normalized = normalizeAudit(row);
    if (!normalized) continue;
    audits.push(normalized);
  }
  if (audits.length > MAX_AUDIT_ITEMS) {
    audits.splice(0, audits.length - MAX_AUDIT_ITEMS);
  }

  queueDbWrite(
    async () => {
      await prisma.deliveryAudit.deleteMany({});
      for (const entry of audits) {
        await prisma.deliveryAudit.create({
          data: {
            id: entry.id,
            createdAt: entry.createdAt,
            tenantId: entry.tenantId,
            level: entry.level,
            action: entry.action,
            purchaseCode: entry.purchaseCode,
            itemId: entry.itemId,
            userId: entry.userId,
            steamId: entry.steamId,
            attempt: entry.attempt,
            message: entry.message,
            metaJson: entry.meta ? JSON.stringify(entry.meta) : null,
          },
        });
      }
    },
    'replace-delivery-audit',
  );
  return audits.length;
}

initDeliveryAuditStore();

module.exports = {
  addDeliveryAudit,
  listDeliveryAudit,
  clearDeliveryAudit,
  replaceDeliveryAudit,
  initDeliveryAuditStore,
  flushDeliveryAuditStoreWrites,
};
