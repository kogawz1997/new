const crypto = require('node:crypto');
const { economy, shop } = require('../config');
const { prisma } = require('../prisma');
const {
  normalizePurchaseStatus,
  validatePurchaseStatusTransition,
  listKnownPurchaseStatuses,
} = require('../services/purchaseStateMachine');

function normalizeShopKind(value, fallback = 'item') {
  const raw = String(value || fallback)
    .trim()
    .toLowerCase();
  if (raw === 'vip') return 'vip';
  return 'item';
}

function normalizeShopQuantity(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
}

function normalizeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function inferShopKindById(id) {
  const key = String(id || '').trim().toLowerCase();
  if (key.startsWith('vip')) return 'vip';
  return 'item';
}

function parseJsonArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return [];
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toMetaJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ raw: String(value) });
  }
}

function parseMetaJson(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function normalizeDeliveryItem(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const gameItemId = normalizeOptionalText(entry.gameItemId || entry.id);
  if (!gameItemId) return null;
  const quantity = normalizeShopQuantity(entry.quantity, 1);
  const iconUrl = normalizeOptionalText(entry.iconUrl);
  return { gameItemId, quantity, iconUrl };
}

function compactDeliveryItems(entries) {
  const out = [];
  const byKey = new Map();
  for (const rawEntry of entries) {
    const normalized = normalizeDeliveryItem(rawEntry);
    if (!normalized) continue;

    const key = normalized.gameItemId.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, normalized);
      out.push(normalized);
      continue;
    }

    existing.quantity += normalized.quantity;
    if (!existing.iconUrl && normalized.iconUrl) {
      existing.iconUrl = normalized.iconUrl;
    }
  }
  return out;
}

function normalizeDeliveryItems(value, fallback = {}) {
  const fromValue = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value]
      : [];
  const fromJson = parseJsonArray(value);
  const fallbackItem = normalizeDeliveryItem({
    gameItemId: fallback.gameItemId,
    quantity: fallback.quantity,
    iconUrl: fallback.iconUrl,
  });

  const combined = compactDeliveryItems([...fromValue, ...fromJson]);
  if (combined.length > 0) return combined;
  return fallbackItem ? [fallbackItem] : [];
}

function resolveShopMetaForWrite(meta = {}, fallbackId = '') {
  const resolvedKind = normalizeShopKind(meta.kind, inferShopKindById(fallbackId));
  const deliveryItems = resolvedKind === 'item'
    ? normalizeDeliveryItems(meta.deliveryItems, {
        gameItemId: meta.gameItemId,
        quantity: meta.quantity,
        iconUrl: meta.iconUrl,
      })
    : [];
  const primary = deliveryItems[0] || null;
  return { resolvedKind, deliveryItems, primary };
}

function toShopItemView(rawItem) {
  if (!rawItem) return null;

  const kind = normalizeShopKind(rawItem.kind, inferShopKindById(rawItem.id));
  const deliveryItems = kind === 'item'
    ? normalizeDeliveryItems(rawItem.deliveryItemsJson, {
        gameItemId: rawItem.gameItemId,
        quantity: rawItem.quantity,
        iconUrl: rawItem.iconUrl,
      })
    : [];
  const primary = deliveryItems[0] || null;

  return {
    ...rawItem,
    kind,
    gameItemId: kind === 'item'
      ? normalizeOptionalText(primary?.gameItemId || rawItem.gameItemId)
      : null,
    quantity: kind === 'item'
      ? normalizeShopQuantity(primary?.quantity || rawItem.quantity, 1)
      : 1,
    iconUrl: kind === 'item'
      ? normalizeOptionalText(primary?.iconUrl || rawItem.iconUrl)
      : null,
    deliveryItems,
  };
}

function toWalletLedgerView(row) {
  if (!row) return null;
  return {
    ...row,
    meta: parseMetaJson(row.metaJson),
  };
}

function toPurchaseStatusHistoryView(row) {
  if (!row) return null;
  return {
    ...row,
    meta: parseMetaJson(row.metaJson),
  };
}

async function mutateWalletWithLedger(userId, updater, options = {}) {
  const id = String(userId || '').trim();
  if (!id) {
    throw new Error('userId is required');
  }

  return prisma.$transaction(async (tx) => {
    let wallet = await tx.userWallet.findUnique({ where: { userId: id } });
    if (!wallet) {
      wallet = await tx.userWallet.create({
        data: { userId: id, balance: 0, lastDaily: null, lastWeekly: null },
      });
    }

    const before = Number(wallet.balance || 0);
    const mutation = updater(wallet) || {};
    const nextBalance = Math.max(0, normalizeInteger(mutation.balance, before));

    const data = {
      ...(mutation.data && typeof mutation.data === 'object' ? mutation.data : {}),
      balance: nextBalance,
    };

    const updated = await tx.userWallet.update({
      where: { userId: id },
      data,
    });

    const delta = nextBalance - before;
    if (delta !== 0 || options.recordZeroDelta === true) {
      await tx.walletLedger.create({
        data: {
          userId: id,
          delta,
          balanceBefore: before,
          balanceAfter: nextBalance,
          reason: String(options.reason || 'wallet_update'),
          reference: normalizeOptionalText(options.reference),
          actor: normalizeOptionalText(options.actor),
          metaJson: toMetaJson(options.meta),
        },
      });
    }

    return updated;
  });
}

async function getWallet(userId) {
  const id = String(userId);
  let wallet = await prisma.userWallet.findUnique({ where: { userId: id } });
  if (!wallet) {
    wallet = await prisma.userWallet.create({
      data: { userId: id, balance: 0, lastDaily: null, lastWeekly: null },
    });
  }
  return wallet;
}

async function addCoins(userId, amount, options = {}) {
  const delta = Math.max(0, normalizeInteger(amount, 0));
  const updated = await mutateWalletWithLedger(
    userId,
    (wallet) => ({
      balance: Number(wallet.balance || 0) + delta,
    }),
    {
      reason: options.reason || 'wallet_add',
      reference: options.reference,
      actor: options.actor,
      meta: options.meta,
      recordZeroDelta: options.recordZeroDelta,
    },
  );
  return updated.balance;
}

async function removeCoins(userId, amount, options = {}) {
  const delta = Math.max(0, normalizeInteger(amount, 0));
  const updated = await mutateWalletWithLedger(
    userId,
    (wallet) => ({
      balance: Math.max(0, Number(wallet.balance || 0) - delta),
    }),
    {
      reason: options.reason || 'wallet_remove',
      reference: options.reference,
      actor: options.actor,
      meta: options.meta,
      recordZeroDelta: options.recordZeroDelta,
    },
  );
  return updated.balance;
}

async function setCoins(userId, amount, options = {}) {
  const targetBalance = Math.max(0, normalizeInteger(amount, 0));
  const updated = await mutateWalletWithLedger(
    userId,
    () => ({
      balance: targetBalance,
    }),
    {
      reason: options.reason || 'wallet_set',
      reference: options.reference,
      actor: options.actor,
      meta: options.meta,
      recordZeroDelta: options.recordZeroDelta,
    },
  );
  return updated.balance;
}

async function canClaimDaily(userId) {
  const wallet = await getWallet(userId);
  const now = BigInt(Date.now());
  if (wallet.lastDaily == null) return { ok: true };
  const diff = now - wallet.lastDaily;
  if (diff >= BigInt(economy.dailyCooldownMs)) return { ok: true };
  const remaining = BigInt(economy.dailyCooldownMs) - diff;
  return { ok: false, remainingMs: Number(remaining) };
}

async function claimDaily(userId) {
  const reward = Math.max(0, normalizeInteger(economy.dailyReward, 0));
  const now = BigInt(Date.now());
  const updated = await mutateWalletWithLedger(
    userId,
    (wallet) => ({
      balance: Number(wallet.balance || 0) + reward,
      data: {
        lastDaily: now,
      },
    }),
    {
      reason: 'daily_claim',
      actor: 'system',
      meta: { reward },
      recordZeroDelta: true,
    },
  );
  return updated.balance;
}

async function canClaimWeekly(userId) {
  const wallet = await getWallet(userId);
  const now = BigInt(Date.now());
  if (wallet.lastWeekly == null) return { ok: true };
  const diff = now - wallet.lastWeekly;
  if (diff >= BigInt(economy.weeklyCooldownMs)) return { ok: true };
  const remaining = BigInt(economy.weeklyCooldownMs) - diff;
  return { ok: false, remainingMs: Number(remaining) };
}

async function claimWeekly(userId) {
  const reward = Math.max(0, normalizeInteger(economy.weeklyReward, 0));
  const now = BigInt(Date.now());
  const updated = await mutateWalletWithLedger(
    userId,
    (wallet) => ({
      balance: Number(wallet.balance || 0) + reward,
      data: {
        lastWeekly: now,
      },
    }),
    {
      reason: 'weekly_claim',
      actor: 'system',
      meta: { reward },
      recordZeroDelta: true,
    },
  );
  return updated.balance;
}

async function listShopItems() {
  const items = await prisma.shopItem.findMany();
  if (items.length === 0) {
    await prisma.$transaction(
      shop.initialItems.map((i) => {
        const { resolvedKind, deliveryItems, primary } = resolveShopMetaForWrite(
          {
            kind: i.kind,
            gameItemId: i.gameItemId,
            quantity: i.quantity,
            iconUrl: i.iconUrl,
            deliveryItems: i.deliveryItems,
          },
          i.id,
        );
        return prisma.shopItem.upsert({
          where: { id: i.id },
          update: {
            name: i.name,
            price: i.price,
            description: i.description,
            kind: resolvedKind,
            gameItemId: primary?.gameItemId || null,
            quantity: primary?.quantity || 1,
            iconUrl: primary?.iconUrl || null,
            deliveryItemsJson:
              resolvedKind === 'item' && deliveryItems.length > 0
                ? JSON.stringify(deliveryItems)
                : null,
          },
          create: {
            id: i.id,
            name: i.name,
            price: i.price,
            description: i.description,
            kind: resolvedKind,
            gameItemId: primary?.gameItemId || null,
            quantity: primary?.quantity || 1,
            iconUrl: primary?.iconUrl || null,
            deliveryItemsJson:
              resolvedKind === 'item' && deliveryItems.length > 0
                ? JSON.stringify(deliveryItems)
                : null,
          },
        });
      }),
    );
    const fresh = await prisma.shopItem.findMany();
    return fresh.map((item) => toShopItemView(item));
  }
  return items.map((item) => toShopItemView(item));
}

async function getShopItemById(id) {
  const item = await prisma.shopItem.findUnique({ where: { id: String(id) } });
  return toShopItemView(item);
}

async function getShopItemByName(name) {
  const lower = String(name).toLowerCase();
  const all = await prisma.shopItem.findMany();
  const found = all.find((i) => {
    if (i.name.toLowerCase() === lower) return true;
    if (i.id.toLowerCase() === lower) return true;
    if (String(i.gameItemId || '').toLowerCase() === lower) return true;

    const kind = normalizeShopKind(i.kind, inferShopKindById(i.id));
    if (kind !== 'item') return false;

    const deliveryItems = normalizeDeliveryItems(i.deliveryItemsJson, {
      gameItemId: i.gameItemId,
      quantity: i.quantity,
      iconUrl: i.iconUrl,
    });
    return deliveryItems.some(
      (entry) => String(entry.gameItemId || '').toLowerCase() === lower,
    );
  });
  return toShopItemView(found || null);
}

async function addShopItem(id, name, price, description, meta = {}) {
  const existing = await prisma.shopItem.findUnique({
    where: { id: String(id) },
  });
  if (existing) {
    throw new Error('มี item id นี้อยู่แล้ว');
  }

  const { resolvedKind, deliveryItems, primary } = resolveShopMetaForWrite(
    meta,
    id,
  );

  if (resolvedKind === 'item' && deliveryItems.length === 0) {
    throw new Error('สินค้าประเภท item ต้องมี deliveryItems อย่างน้อย 1 รายการ');
  }

  const created = await prisma.shopItem.create({
    data: {
      id: String(id),
      name,
      price: Number(price || 0),
      description: description || '',
      kind: resolvedKind,
      gameItemId: primary?.gameItemId || null,
      quantity: primary?.quantity || 1,
      iconUrl: primary?.iconUrl || null,
      deliveryItemsJson:
        resolvedKind === 'item' && deliveryItems.length > 0
          ? JSON.stringify(deliveryItems)
          : null,
    },
  });
  return toShopItemView(created);
}

async function deleteShopItem(idOrName) {
  const item =
    (await getShopItemById(idOrName)) || (await getShopItemByName(idOrName));
  if (!item) return null;
  await prisma.shopItem.delete({ where: { id: item.id } });
  return item;
}

async function setShopItemPrice(idOrName, newPrice) {
  const item =
    (await getShopItemById(idOrName)) || (await getShopItemByName(idOrName));
  if (!item) return null;
  const updated = await prisma.shopItem.update({
    where: { id: item.id },
    data: { price: Number(newPrice || 0) },
  });
  return toShopItemView(updated);
}

async function createPurchase(userId, item) {
  const payload = {
    userId: String(userId),
    itemId: String(item.id),
    price: Number(item.price || 0),
    status: 'pending',
    statusUpdatedAt: new Date(),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code =
      typeof crypto.randomUUID === 'function'
        ? `P${crypto.randomUUID()}`
        : `P${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.purchase.create({
          data: {
            code,
            ...payload,
          },
        });

        await tx.purchaseStatusHistory.create({
          data: {
            purchaseCode: created.code,
            fromStatus: null,
            toStatus: 'pending',
            reason: 'purchase-created',
            actor: 'system',
            metaJson: null,
          },
        });

        return created;
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
    }
  }

  throw new Error('Failed to generate unique purchase code');
}

async function findPurchaseByCode(code) {
  return prisma.purchase.findUnique({ where: { code: String(code) } });
}

async function setPurchaseStatusByCode(code, status, options = {}) {
  const p = await findPurchaseByCode(code);
  if (!p) return null;

  const currentStatus = normalizePurchaseStatus(p.status);
  const nextStatus = normalizePurchaseStatus(status);
  const validation = validatePurchaseStatusTransition(currentStatus, nextStatus, {
    force: options.force === true,
  });

  if (!validation.ok) {
    const allowed = Array.isArray(validation.allowed)
      ? validation.allowed.join(', ')
      : 'n/a';
    throw new Error(
      `Invalid purchase status transition: ${currentStatus || '<empty>'} -> ${nextStatus || '<empty>'} (reason=${validation.reason}; allowed=${allowed})`,
    );
  }

  if (currentStatus === nextStatus && options.recordIfSame !== true) {
    return p;
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.purchase.update({
      where: { code: p.code },
      data: {
        status: nextStatus,
        statusUpdatedAt: now,
      },
    });

    await tx.purchaseStatusHistory.create({
      data: {
        purchaseCode: p.code,
        fromStatus: currentStatus || null,
        toStatus: nextStatus,
        reason: normalizeOptionalText(options.reason),
        actor: normalizeOptionalText(options.actor),
        metaJson: toMetaJson(options.meta),
      },
    });

    return updated;
  });
}

async function listUserPurchases(userId) {
  return prisma.purchase.findMany({
    where: { userId: String(userId) },
    orderBy: { createdAt: 'desc' },
  });
}

async function listTopWallets(limit = 10) {
  return prisma.userWallet.findMany({
    orderBy: { balance: 'desc' },
    take: Math.max(1, Number(limit || 10)),
  });
}

async function listWalletLedger(userId, limit = 100) {
  const max = Math.max(1, Math.min(1000, normalizeInteger(limit, 100)));
  const rows = await prisma.walletLedger.findMany({
    where: { userId: String(userId) },
    orderBy: { createdAt: 'desc' },
    take: max,
  });
  return rows.map((row) => toWalletLedgerView(row));
}

async function listPurchaseStatusHistory(code, limit = 100) {
  const max = Math.max(1, Math.min(1000, normalizeInteger(limit, 100)));
  const rows = await prisma.purchaseStatusHistory.findMany({
    where: { purchaseCode: String(code) },
    orderBy: { createdAt: 'desc' },
    take: max,
  });
  return rows.map((row) => toPurchaseStatusHistoryView(row));
}

module.exports = {
  getWallet,
  addCoins,
  removeCoins,
  setCoins,
  canClaimDaily,
  claimDaily,
  canClaimWeekly,
  claimWeekly,
  listShopItems,
  getShopItemById,
  getShopItemByName,
  addShopItem,
  deleteShopItem,
  setShopItemPrice,
  createPurchase,
  findPurchaseByCode,
  setPurchaseStatusByCode,
  listUserPurchases,
  listTopWallets,
  listWalletLedger,
  listPurchaseStatusHistory,
  listKnownPurchaseStatuses,
};
