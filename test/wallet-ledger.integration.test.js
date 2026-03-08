const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addCoins,
  removeCoins,
  setCoins,
  getWallet,
  listWalletLedger,
  createPurchase,
  setPurchaseStatusByCode,
  listPurchaseStatusHistory,
  listShopItems,
} = require('../src/store/memoryStore');
const { prisma } = require('../src/prisma');

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test('wallet ledger writes immutable rows for balance mutations', async () => {
  const userId = uniqueId('ledger-user');
  try {
    await setCoins(userId, 0, {
      reason: 'test-init',
      actor: 'test-suite',
    });
    await addCoins(userId, 100, {
      reason: 'test-add',
      actor: 'test-suite',
      reference: 'REF-ADD',
    });
    await removeCoins(userId, 30, {
      reason: 'test-remove',
      actor: 'test-suite',
      reference: 'REF-REMOVE',
    });

    const wallet = await getWallet(userId);
    assert.equal(wallet.balance, 70);

    const rows = await listWalletLedger(userId, 20);
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].reason, 'test-remove');
    assert.equal(rows[0].delta, -30);
    assert.equal(rows[0].balanceAfter, 70);
    assert.equal(rows[1].reason, 'test-add');
    assert.equal(rows[1].delta, 100);
    assert.equal(rows[1].balanceAfter, 100);
  } finally {
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.userWallet.deleteMany({ where: { userId } });
  }
});

test('purchase state machine enforces transitions and records history', async () => {
  const userId = uniqueId('purchase-user');
  let code = null;
  try {
    const items = await listShopItems();
    assert.ok(items.length > 0);
    const item = items[0];

    const purchase = await createPurchase(userId, item);
    code = purchase.code;

    await setPurchaseStatusByCode(code, 'delivering', {
      actor: 'test-suite',
      reason: 'move-to-delivering',
    });
    await setPurchaseStatusByCode(code, 'delivered', {
      actor: 'test-suite',
      reason: 'move-to-delivered',
    });

    await assert.rejects(
      () =>
        setPurchaseStatusByCode(code, 'pending', {
          actor: 'test-suite',
          reason: 'invalid-back-transition',
        }),
      /Invalid purchase status transition/i,
    );

    const history = await listPurchaseStatusHistory(code, 10);
    assert.ok(history.length >= 3);
    assert.equal(history[0].toStatus, 'delivered');
    assert.equal(history[1].toStatus, 'delivering');
    assert.equal(history[2].toStatus, 'pending');
  } finally {
    if (code) {
      await prisma.purchaseStatusHistory.deleteMany({
        where: { purchaseCode: code },
      });
      await prisma.purchase.deleteMany({
        where: { code },
      });
    }
  }
});
