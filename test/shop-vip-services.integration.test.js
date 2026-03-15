const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addShopItem,
  deleteShopItem,
  setCoins,
  getWallet,
  getShopItemById,
  listWalletLedger,
  createPurchase,
} = require('../src/store/memoryStore');
const { addCartItem, clearCart, flushCartStoreWrites } = require('../src/store/cartStore');
const { purchaseShopItemForUser } = require('../src/services/shopService');
const { checkoutCart } = require('../src/services/cartService');
const { buyVipForUser, getVipPlan } = require('../src/services/vipService');
const { updatePurchaseStatusForActor } = require('../src/services/purchaseService');
const { getMembership, removeMembership } = require('../src/store/vipStore');
const { prisma } = require('../src/prisma');

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test('purchaseShopItemForUser rolls back coins when purchase creation fails', async () => {
  const userId = uniqueId('shop-user');
  const itemId = uniqueId('shop-item');

  try {
    await setCoins(userId, 1000, {
      reason: 'test-init',
      actor: 'test-suite',
    });
    const item = await addShopItem(itemId, 'Test Weapon', 300, 'test item', {
      kind: 'item',
      deliveryItems: [{ gameItemId: 'Weapon_M1911', quantity: 1 }],
    });

    const result = await purchaseShopItemForUser({
      userId,
      item,
      requireSteamLink: false,
      actor: 'test-suite',
      source: 'shop-service-test',
      createQueuedPurchaseFn: async () => {
        throw new Error('forced-create-failure');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'purchase-create-failed');
    assert.equal(result.rolledBack, true);

    const wallet = await getWallet(userId);
    assert.equal(wallet.balance, 1000);

    const ledger = await listWalletLedger(userId, 10);
    const reasons = ledger.map((row) => row.reason);
    assert.ok(reasons.includes('purchase_debit'));
    assert.ok(reasons.includes('purchase_rollback'));
  } finally {
    await deleteShopItem(itemId).catch(() => null);
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.userWallet.deleteMany({ where: { userId } });
  }
});

test('checkoutCart refunds only failed rows after batch debit', async () => {
  const userId = uniqueId('cart-user');
  const itemIdA = uniqueId('cart-item-a');
  const itemIdB = uniqueId('cart-item-b');

  try {
    await setCoins(userId, 1000, {
      reason: 'test-init',
      actor: 'test-suite',
    });
    await addShopItem(itemIdA, 'Item A', 100, 'item a', {
      kind: 'item',
      deliveryItems: [{ gameItemId: 'Weapon_M1911', quantity: 1 }],
    });
    await addShopItem(itemIdB, 'Item B', 200, 'item b', {
      kind: 'item',
      deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1 }],
    });

    addCartItem(userId, itemIdA, 1);
    addCartItem(userId, itemIdB, 1);

    let callCount = 0;
    const result = await checkoutCart(userId, {
      actor: 'test-suite',
      source: 'cart-service-test',
      createQueuedPurchaseFn: async ({ item }) => {
        callCount += 1;
        if (item.id === itemIdB) {
          throw new Error('forced-cart-failure');
        }
        return {
          item,
          purchase: { code: `P-CART-${callCount}` },
          delivery: { queued: false, reason: 'manual' },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.purchases.length, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.refundedAmount, 200);

    const wallet = await getWallet(userId);
    assert.equal(wallet.balance, 900);

    await flushCartStoreWrites();
    const cartRows = await prisma.cartEntry.findMany({ where: { userId } });
    assert.equal(cartRows.length, 0);

    const ledger = await listWalletLedger(userId, 10);
    const reasons = ledger.map((row) => row.reason);
    assert.ok(reasons.includes('cart_checkout_debit'));
    assert.ok(reasons.includes('cart_checkout_partial_refund'));
  } finally {
    clearCart(userId);
    await flushCartStoreWrites();
    await deleteShopItem(itemIdA).catch(() => null);
    await deleteShopItem(itemIdB).catch(() => null);
    await prisma.cartEntry.deleteMany({ where: { userId } });
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.userWallet.deleteMany({ where: { userId } });
  }
});

test('buyVipForUser rolls back debit when membership activation fails', async () => {
  const userId = uniqueId('vip-user');
  const plan = getVipPlan('vip-7d');
  assert.ok(plan);

  try {
    await setCoins(userId, 50000, {
      reason: 'test-init',
      actor: 'test-suite',
    });

    const result = await buyVipForUser({
      userId,
      plan,
      actor: 'test-suite',
      source: 'vip-service-test',
      setMembershipFn: () => {
        throw new Error('forced-membership-failure');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'vip-activation-failed');
    assert.equal(result.rolledBack, true);

    const wallet = await getWallet(userId);
    assert.equal(wallet.balance, 50000);

    const membership = await prisma.vipMembership.findUnique({ where: { userId } });
    assert.equal(membership, null);
  } finally {
    await prisma.vipMembership.deleteMany({ where: { userId } });
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.userWallet.deleteMany({ where: { userId } });
  }
});

test('purchaseShopItemForUser activates VIP immediately and marks purchase delivered', async () => {
  const userId = uniqueId('shop-vip-user');
  const itemId = 'vip-7d';
  let item = null;

  try {
    item = await getShopItemById(itemId);
    if (!item) {
    item = await addShopItem(itemId, 'VIP 7 วัน', 5000, 'vip item', {
      kind: 'vip',
    });
    }
    await setCoins(userId, 50000, {
      reason: 'test-init',
      actor: 'test-suite',
    });

    const result = await purchaseShopItemForUser({
      userId,
      item,
      actor: 'test-suite',
      source: 'shop-vip-test',
    });

    assert.equal(result.ok, true);
    assert.equal(String(result.kind || ''), 'vip');
    assert.equal(String(result.purchase?.status || ''), 'delivered');
    assert.equal(Boolean(result.delivery?.queued), false);
    assert.equal(String(result.delivery?.reason || ''), 'vip-activated');

    const membership = getMembership(userId);
    assert.ok(membership);
    assert.equal(String(membership?.planId || ''), 'vip-7d');

    const wallet = await getWallet(userId);
    assert.equal(wallet.balance, 45000);
  } finally {
    removeMembership(userId);
    await prisma.purchaseStatusHistory.deleteMany({
      where: {
        purchase: {
          userId,
        },
      },
    }).catch(() => null);
    await prisma.purchase.deleteMany({
      where: {
        userId,
      },
    }).catch(() => null);
    await prisma.walletLedger.deleteMany({ where: { userId } }).catch(() => null);
    await prisma.userWallet.deleteMany({ where: { userId } }).catch(() => null);
    await deleteShopItem(itemId).catch(() => null);
  }
});

test('updatePurchaseStatusForActor validates transitions and returns history', async () => {
  const userId = uniqueId('purchase-status-user');
  const itemId = uniqueId('purchase-status-item');
  let purchase = null;

  try {
    await addShopItem(itemId, 'Status Test Item', 50, 'status item', {
      kind: 'item',
      deliveryItems: [{ gameItemId: 'Weapon_M1911', quantity: 1 }],
    });
    purchase = await createPurchase(userId, {
      id: itemId,
      price: 50,
    });

    const delivered = await updatePurchaseStatusForActor({
      code: purchase.code,
      status: 'delivered',
      actor: 'test-suite',
      reason: 'service-transition',
    });
    assert.equal(delivered.ok, true);
    assert.equal(String(delivered.purchase?.status || ''), 'delivered');
    assert.ok(Array.isArray(delivered.history));
    assert.equal(String(delivered.history?.[0]?.reason || ''), 'service-transition');

    const invalid = await updatePurchaseStatusForActor({
      code: purchase.code,
      status: 'pending',
      actor: 'test-suite',
      reason: 'invalid-transition',
    });
    assert.equal(invalid.ok, false);
    assert.equal(String(invalid.reason || ''), 'transition-not-allowed');
  } finally {
    await prisma.purchaseStatusHistory.deleteMany({
      where: {
        purchaseCode: purchase?.code || '',
      },
    }).catch(() => null);
    await prisma.purchase.deleteMany({
      where: {
        userId,
      },
    }).catch(() => null);
    await deleteShopItem(itemId).catch(() => null);
  }
});

test('addShopItem persists delivery profile metadata for item delivery behavior', async () => {
  const itemId = uniqueId('shop-profile-item');

  try {
    const created = await addShopItem(itemId, 'Profile Item', 250, 'profile item', {
      kind: 'item',
      deliveryItems: [{ gameItemId: 'Weapon_M1911', quantity: 1 }],
      deliveryProfile: 'teleport_spawn',
      deliveryTeleportMode: 'vehicle',
      deliveryTeleportTarget: 'AdminBike',
      deliveryReturnTarget: 'Admin Anchor',
      deliveryPreCommands: ['#TeleportTo {teleportTargetQuoted}'],
      deliveryPostCommands: ['#TeleportTo {returnTargetQuoted}'],
    });

    assert.equal(created.deliveryProfile, 'teleport_spawn');
    assert.equal(created.deliveryTeleportMode, 'vehicle');
    assert.equal(created.deliveryTeleportTarget, 'AdminBike');
    assert.equal(created.deliveryReturnTarget, 'Admin Anchor');
    assert.deepEqual(created.deliveryPreCommands, [
      '#TeleportTo {teleportTargetQuoted}',
    ]);
    assert.deepEqual(created.deliveryPostCommands, [
      '#TeleportTo {returnTargetQuoted}',
    ]);

    const fetched = await getShopItemById(itemId);
    assert.equal(fetched.deliveryProfile, 'teleport_spawn');
    assert.equal(fetched.deliveryTeleportMode, 'vehicle');
    assert.equal(fetched.deliveryTeleportTarget, 'AdminBike');
    assert.equal(fetched.deliveryReturnTarget, 'Admin Anchor');
    assert.deepEqual(fetched.deliveryPreCommands, [
      '#TeleportTo {teleportTargetQuoted}',
    ]);
    assert.deepEqual(fetched.deliveryPostCommands, [
      '#TeleportTo {returnTargetQuoted}',
    ]);
  } finally {
    await deleteShopItem(itemId).catch(() => null);
  }
});
