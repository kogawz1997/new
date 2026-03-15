const {
  getWallet,
  getShopItemById,
  getShopItemByName,
  createPurchase,
  setPurchaseStatusByCode,
  addShopItem,
  deleteShopItem,
  setShopItemPrice,
} = require('../store/memoryStore');
const { getLinkByUserId } = require('../store/linkStore');
const {
  getMembership,
  setMembership,
  removeMembership,
} = require('../store/vipStore');
const { debitCoins, creditCoins } = require('./coinService');
const { enqueuePurchaseDelivery } = require('./rconDelivery');
const { assertTenantQuotaAvailable } = require('./platformService');
const { getVipPlan } = require('./vipService');

function normalizeShopKind(value) {
  const raw = String(value || 'item').trim().toLowerCase();
  if (!raw) return 'item';
  if (raw === 'vip') return 'vip';
  if (raw === 'item') return 'item';
  return raw;
}

function isVipShopKind(value) {
  return normalizeShopKind(value) === 'vip';
}

function isGameItemShopKind(value) {
  return normalizeShopKind(value) === 'item';
}

function normalizeQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.trunc(n));
}

function normalizeDeliveryProfile(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'spawn_only') return 'spawn_only';
  if (raw === 'teleport_spawn') return 'teleport_spawn';
  if (raw === 'announce_teleport_spawn') return 'announce_teleport_spawn';
  return null;
}

function normalizeDeliveryTeleportMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'player') return 'player';
  if (raw === 'vehicle') return 'vehicle';
  return null;
}

function normalizeCommandList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }
  return raw
    .split(/\r?\n/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeDeliveryItems(item) {
  const direct = Array.isArray(item?.deliveryItems) ? item.deliveryItems : [];
  const normalized = direct
    .map((entry) => {
      const gameItemId = String(entry?.gameItemId || '').trim();
      if (!gameItemId) return null;
      return {
        gameItemId,
        quantity: normalizeQty(entry?.quantity),
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) return normalized;

  const fallbackId = String(item?.gameItemId || '').trim();
  if (!fallbackId) return [];
  return [{ gameItemId: fallbackId, quantity: normalizeQty(item?.quantity) }];
}

function buildBundleSummary(item, maxRows = 4) {
  const entries = normalizeDeliveryItems(item);
  if (entries.length === 0) {
    return {
      entries: [],
      totalQty: 0,
      short: '-',
      long: 'รายการส่งของ: `-`',
      lines: ['**รายการส่งของ:** `-`'],
    };
  }

  const totalQty = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const short = entries
    .slice(0, 2)
    .map((entry) => `${entry.gameItemId} x${entry.quantity}`)
    .join(', ');
  const shortText = entries.length > 2 ? `${short} (+${entries.length - 2})` : short;
  const lines = [
    `**รายการส่งของ:** **${entries.length}** รายการ (รวม **${totalQty}** ชิ้น)`,
    ...entries
      .slice(0, maxRows)
      .map((entry) => `- \`${entry.gameItemId}\` x**${entry.quantity}**`),
  ];
  if (entries.length > maxRows) {
    lines.push(`- และอีก **${entries.length - maxRows}** รายการ`);
  }

  return {
    entries,
    totalQty,
    short: shortText,
    long: [`รายการส่งของ: **${entries.length}** รายการ (รวม **${totalQty}** ชิ้น)`, ...lines.slice(1)]
      .join('\n'),
    lines,
  };
}

function getDeliveryStatusText(result) {
  if (result?.queued) {
    return 'เข้าคิวแล้ว';
  }
  if (result?.reason === 'item-not-configured') {
    return 'ยังไม่ตั้งค่าคำสั่งส่งของอัตโนมัติ';
  }
  if (result?.reason === 'delivery-disabled') {
    return 'ปิดระบบส่งของอัตโนมัติอยู่';
  }
  return result?.reason || 'ไม่ทราบสถานะ';
}

async function findShopItemByQuery(query) {
  const text = String(query || '').trim();
  if (!text) return null;
  return (await getShopItemById(text)) || (await getShopItemByName(text));
}

async function createQueuedPurchase(params = {}) {
  const userId = String(params.userId || '').trim();
  const item = params.item;
  if (!userId || !item?.id) {
    throw new Error('invalid-purchase-input');
  }

  const createPurchaseFn = params.createPurchaseFn || createPurchase;
  const enqueuePurchaseDeliveryFn =
    params.enqueuePurchaseDeliveryFn || enqueuePurchaseDelivery;

  const purchase = await createPurchaseFn(userId, item, {
    tenantId: params.tenantId || item?.tenantId || null,
  });
  const delivery = await enqueuePurchaseDeliveryFn(purchase, {
    guildId: params.guildId || null,
    tenantId: params.tenantId || item?.tenantId || purchase?.tenantId || null,
    ...(params.deliveryOptions && typeof params.deliveryOptions === 'object'
      ? params.deliveryOptions
      : {}),
  });

  return {
    item,
    kind: normalizeShopKind(item.kind),
    bundle: buildBundleSummary(item),
    purchase,
    delivery,
  };
}

async function createVipPurchase(params = {}) {
  const userId = String(params.userId || '').trim();
  const item = params.item;
  if (!userId || !item?.id) {
    throw new Error('invalid-vip-purchase-input');
  }

  const actor = String(params.actor || '').trim() || 'system';
  const source = String(params.source || '').trim() || 'shop-service';
  const createPurchaseFn = params.createPurchaseFn || createPurchase;
  const setPurchaseStatusByCodeFn =
    params.setPurchaseStatusByCodeFn || setPurchaseStatusByCode;
  const getMembershipFn = params.getMembershipFn || getMembership;
  const setMembershipFn = params.setMembershipFn || setMembership;
  const removeMembershipFn = params.removeMembershipFn || removeMembership;

  const vipPlan = params.vipPlan || getVipPlan(item.id);
  if (!vipPlan) {
    throw new Error('vip-plan-not-found');
  }

  const purchase = await createPurchaseFn(userId, item, {
    tenantId: params.tenantId || item?.tenantId || null,
  });

  const previousMembership = getMembershipFn(userId);
  const now = params.now instanceof Date ? params.now : new Date();
  const membershipBaseAt =
    previousMembership?.expiresAt instanceof Date
    && previousMembership.expiresAt.getTime() > now.getTime()
      ? previousMembership.expiresAt
      : now;
  const expiresAt = new Date(
    membershipBaseAt.getTime() + Number(vipPlan.durationDays || 0) * 24 * 60 * 60 * 1000,
  );
  const membership = setMembershipFn(userId, vipPlan.id, expiresAt);
  if (!membership) {
    throw new Error('vip-membership-write-failed');
  }

  try {
    const completedPurchase = await setPurchaseStatusByCodeFn(purchase.code, 'delivered', {
      actor,
      reason: 'vip-activated',
      meta: {
        source,
        planId: vipPlan.id,
        durationDays: Number(vipPlan.durationDays || 0),
      },
    });

    return {
      item,
      kind: normalizeShopKind(item.kind),
      bundle: buildBundleSummary(item),
      purchase: completedPurchase || purchase,
      delivery: {
        queued: false,
        backend: 'vip-membership',
        reason: 'vip-activated',
      },
      membership,
      vipPlan,
    };
  } catch (error) {
    if (previousMembership?.expiresAt instanceof Date) {
      setMembershipFn(userId, previousMembership.planId, previousMembership.expiresAt);
    } else {
      removeMembershipFn(userId);
    }
    throw error;
  }
}

async function purchaseShopItemForUser(params = {}) {
  const userId = String(params.userId || '').trim();
  const actor = String(params.actor || '').trim() || 'system';
  const source = String(params.source || '').trim() || 'shop-service';
  if (!userId) {
    return { ok: false, reason: 'invalid-user-id' };
  }

  const item = params.item || (await findShopItemByQuery(params.query));
  if (!item) {
    return { ok: false, reason: 'item-not-found' };
  }
  const tenantId = String(params.tenantId || item?.tenantId || '').trim() || null;

  const kind = normalizeShopKind(item.kind);
  if (isGameItemShopKind(kind) && params.requireSteamLink !== false) {
    const resolveSteamLink = params.resolveSteamLink
      || (async (targetUserId) => getLinkByUserId(targetUserId));
    const link = await resolveSteamLink(userId);
    if (!link?.steamId) {
      return {
        ok: false,
        reason: 'steam-link-required',
        item,
        kind,
      };
    }
  }

  if (tenantId) {
    const quotaCheck = await assertTenantQuotaAvailable(tenantId, 'purchases30d', 1);
    if (!quotaCheck.ok) {
      return {
        ok: false,
        reason: quotaCheck.reason || 'tenant-quota-exceeded',
        item,
        kind,
        tenantId,
        quotaKey: quotaCheck.quotaKey || 'purchases30d',
        quota: quotaCheck.quota || null,
        quotaSnapshot: quotaCheck.snapshot || null,
      };
    }
  }

  const price = Math.max(0, Number(item.price || 0));
  const debitCoinsFn = params.debitCoinsFn || debitCoins;
  const creditCoinsFn = params.creditCoinsFn || creditCoins;
  const createQueuedPurchaseFn = params.createQueuedPurchaseFn || createQueuedPurchase;
  const createVipPurchaseFn = params.createVipPurchaseFn || createVipPurchase;

  let balance = null;
  let debitApplied = 0;
  if (price > 0) {
    const debit = await debitCoinsFn({
      userId,
      amount: price,
      reason: params.debitReason || 'purchase_debit',
      actor,
      reference: params.reference || null,
      meta: {
        source,
        itemId: item.id,
        itemName: item.name,
        ...(params.meta && typeof params.meta === 'object' ? params.meta : {}),
      },
    });
    if (!debit.ok) {
      return {
        ok: false,
        reason: debit.reason || 'purchase-debit-failed',
        item,
        kind,
        price,
        balance: Number(debit.balance || 0),
      };
    }
    balance = Number(debit.balance || 0);
    debitApplied = price;
  } else {
    balance = Number((await getWallet(userId))?.balance || 0);
  }

  try {
    const purchaseFactory = isVipShopKind(kind)
      ? createVipPurchaseFn
      : createQueuedPurchaseFn;
    const result = await purchaseFactory({
      userId,
      item,
      guildId: params.guildId || null,
      tenantId,
      actor,
      source,
      deliveryOptions: params.deliveryOptions,
      createPurchaseFn: params.createPurchaseFn,
      enqueuePurchaseDeliveryFn: params.enqueuePurchaseDeliveryFn,
      setPurchaseStatusByCodeFn: params.setPurchaseStatusByCodeFn,
      getMembershipFn: params.getMembershipFn,
      setMembershipFn: params.setMembershipFn,
      removeMembershipFn: params.removeMembershipFn,
      vipPlan: params.vipPlan,
      now: params.now,
    });
    return {
      ok: true,
      ...result,
      price,
      balance,
    };
  } catch (error) {
    if (debitApplied > 0) {
      await creditCoinsFn({
        userId,
        amount: debitApplied,
        reason: params.rollbackReason || 'purchase_rollback',
        actor,
        reference: params.reference || null,
        meta: {
          source,
          itemId: item.id,
          itemName: item.name,
          rollbackReason: String(error?.message || error),
        },
      }).catch(() => null);
    }
    return {
      ok: false,
      reason: 'purchase-create-failed',
      item,
      kind,
      price,
      error: String(error?.message || error),
      rolledBack: debitApplied > 0,
    };
  }
}

async function addShopItemForAdmin(params = {}) {
  const id = String(params.id || '').trim();
  const name = String(params.name || '').trim();
  const price = Number(params.price);
  const description = String(params.description || '').trim();
  const kind = normalizeShopKind(params.kind);
  const quantity = normalizeQty(params.quantity);
  const gameItemId = String(params.gameItemId || '').trim() || null;
  const iconUrl = String(params.iconUrl || '').trim() || null;
  const deliveryItems = Array.isArray(params.deliveryItems) ? params.deliveryItems : [];
  const deliveryProfile = normalizeDeliveryProfile(params.deliveryProfile);
  const deliveryTeleportMode = normalizeDeliveryTeleportMode(
    params.deliveryTeleportMode,
  );
  const deliveryTeleportTarget = String(
    params.deliveryTeleportTarget || '',
  ).trim() || null;
  const deliveryPreCommands = normalizeCommandList(params.deliveryPreCommands);
  const deliveryPostCommands = normalizeCommandList(params.deliveryPostCommands);
  const deliveryReturnTarget = String(params.deliveryReturnTarget || '').trim() || null;

  if (!id || !name || !Number.isFinite(price) || price <= 0 || !description) {
    return { ok: false, reason: 'invalid-input' };
  }
  if (isGameItemShopKind(kind) && !gameItemId && deliveryItems.length === 0) {
    return { ok: false, reason: 'game-item-required' };
  }

  try {
    const item = await addShopItem(id, name, Math.trunc(price), description, {
      kind,
      gameItemId: isGameItemShopKind(kind) ? gameItemId : null,
      quantity: isGameItemShopKind(kind) ? quantity : 1,
      iconUrl,
      deliveryItems: isGameItemShopKind(kind) ? deliveryItems : [],
      deliveryProfile: isGameItemShopKind(kind) ? deliveryProfile : null,
      deliveryTeleportMode: isGameItemShopKind(kind) ? deliveryTeleportMode : null,
      deliveryTeleportTarget: isGameItemShopKind(kind) ? deliveryTeleportTarget : null,
      deliveryPreCommands: isGameItemShopKind(kind) ? deliveryPreCommands : [],
      deliveryPostCommands: isGameItemShopKind(kind) ? deliveryPostCommands : [],
      deliveryReturnTarget: isGameItemShopKind(kind) ? deliveryReturnTarget : null,
    });
    return { ok: true, item };
  } catch (error) {
    return {
      ok: false,
      reason: 'create-failed',
      error: String(error?.message || error),
    };
  }
}

async function setShopItemPriceForAdmin(params = {}) {
  const idOrName = String(params.idOrName || '').trim();
  const price = Number(params.price);
  if (!idOrName || !Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  const item = await setShopItemPrice(idOrName, Math.trunc(price));
  if (!item) {
    return { ok: false, reason: 'not-found' };
  }
  return { ok: true, item };
}

async function deleteShopItemForAdmin(params = {}) {
  const idOrName = String(params.idOrName || '').trim();
  if (!idOrName) {
    return { ok: false, reason: 'invalid-input' };
  }
  const item = await deleteShopItem(idOrName);
  if (!item) {
    return { ok: false, reason: 'not-found' };
  }
  return { ok: true, item };
}

module.exports = {
  normalizeShopKind,
  isVipShopKind,
  isGameItemShopKind,
  normalizeDeliveryItems,
  buildBundleSummary,
  getDeliveryStatusText,
  findShopItemByQuery,
  createQueuedPurchase,
  purchaseShopItemForUser,
  addShopItemForAdmin,
  setShopItemPriceForAdmin,
  deleteShopItemForAdmin,
};
