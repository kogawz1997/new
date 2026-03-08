const {
  getWallet,
  getShopItemById,
  createPurchase,
  removeCoins,
} = require('../store/memoryStore');
const {
  listCartItems,
  clearCart,
} = require('../store/cartStore');
const { enqueuePurchaseDelivery } = require('./rconDelivery');

function normalizeKind(value) {
  return String(value || 'item').trim().toLowerCase() === 'vip' ? 'vip' : 'item';
}

function normalizeQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.trunc(n));
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
      short: '-',
      long: 'ไอเทมในเกม: `-`',
      totalQty: 0,
    };
  }

  const totalQty = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const short = entries
    .slice(0, 2)
    .map((entry) => `${entry.gameItemId} x${entry.quantity}`)
    .join(', ');
  const shortText = entries.length > 2 ? `${short} (+${entries.length - 2})` : short;

  const longLines = [
    `ไอเทมในชุด: **${entries.length}** รายการ (รวม **${totalQty}** ชิ้น)`,
    ...entries
      .slice(0, maxRows)
      .map((entry) => `- \`${entry.gameItemId}\` x**${entry.quantity}**`),
  ];
  if (entries.length > maxRows) {
    longLines.push(`- และอีก **${entries.length - maxRows}** รายการ`);
  }

  return {
    short: shortText,
    long: longLines.join('\n'),
    totalQty,
  };
}

function getDeliveryStatusText(result) {
  if (result?.queued) {
    return 'เข้าคิวแล้ว';
  }
  if (result?.reason === 'item-not-configured') {
    return 'ยังไม่ได้ตั้งค่า RCON สำหรับไอเทมนี้';
  }
  if (result?.reason === 'delivery-disabled') {
    return 'ระบบส่งของอัตโนมัติถูกปิด';
  }
  return result?.reason || 'รอแอดมินจัดการ';
}

async function getResolvedCart(userId) {
  const rows = listCartItems(userId);
  const resolved = [];
  const missingItemIds = [];

  for (const row of rows) {
    const item = await getShopItemById(row.itemId);
    if (!item) {
      missingItemIds.push(row.itemId);
      continue;
    }
    const quantity = normalizeQty(row.quantity);
    resolved.push({
      itemId: row.itemId,
      quantity,
      item,
      lineTotal: Number(item.price || 0) * quantity,
    });
  }

  const totalPrice = resolved.reduce((sum, row) => sum + row.lineTotal, 0);
  const totalUnits = resolved.reduce((sum, row) => sum + row.quantity, 0);

  return {
    rows: resolved,
    missingItemIds,
    totalPrice,
    totalUnits,
  };
}

async function checkoutCart(userId, options = {}) {
  const guildId = options.guildId || null;
  const resolved = await getResolvedCart(userId);

  if (resolved.rows.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      ...resolved,
    };
  }

  const wallet = await getWallet(userId);
  if (wallet.balance < resolved.totalPrice) {
    return {
      ok: false,
      reason: 'insufficient',
      walletBalance: wallet.balance,
      ...resolved,
    };
  }

  await removeCoins(userId, resolved.totalPrice, {
    reason: 'cart_checkout_debit',
    actor: `discord:${userId}`,
    meta: {
      source: 'cart-checkout',
      units: resolved.totalUnits,
      rows: resolved.rows.length,
    },
  });

  const purchases = [];
  const failures = [];
  for (const row of resolved.rows) {
    for (let i = 0; i < row.quantity; i += 1) {
      try {
        const purchase = await createPurchase(userId, row.item);
        const delivery = await enqueuePurchaseDelivery(purchase, { guildId });
        purchases.push({
          itemId: row.item.id,
          itemName: row.item.name,
          itemKind: normalizeKind(row.item.kind),
          bundle: buildBundleSummary(row.item),
          purchase,
          delivery,
        });
      } catch (error) {
        failures.push({
          itemId: row.item.id,
          itemName: row.item.name,
          message: error?.message || String(error),
        });
      }
    }
  }

  clearCart(userId);

  return {
    ok: true,
    ...resolved,
    purchases,
    failures,
  };
}

module.exports = {
  normalizeKind,
  buildBundleSummary,
  getDeliveryStatusText,
  getResolvedCart,
  checkoutCart,
};
