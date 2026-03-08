const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addCartItem,
  removeCartItem,
  clearCart,
  flushCartStoreWrites,
} = require('../src/store/cartStore');
const {
  setCode,
  markUsed,
  resetCodeUsage,
  deleteCode,
  flushRedeemStoreWrites,
} = require('../src/store/redeemStore');
const { prisma } = require('../src/prisma');

function uniqueText(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test('cart store writes through to prisma CartEntry', async () => {
  const userId = uniqueText('cart-user');
  const firstItem = uniqueText('item-a');
  const secondItem = uniqueText('item-b');

  try {
    addCartItem(userId, firstItem, 2);
    addCartItem(userId, secondItem, 1);
    await flushCartStoreWrites();

    let rows = await prisma.cartEntry.findMany({
      where: { userId },
      orderBy: { itemId: 'asc' },
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => ({ itemId: row.itemId, quantity: row.quantity })),
      [
        { itemId: firstItem, quantity: 2 },
        { itemId: secondItem, quantity: 1 },
      ].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    );

    removeCartItem(userId, firstItem, 1);
    await flushCartStoreWrites();

    rows = await prisma.cartEntry.findMany({
      where: { userId },
      orderBy: { itemId: 'asc' },
    });
    assert.equal(rows.length, 2);
    const first = rows.find((row) => row.itemId === firstItem);
    assert.equal(first?.quantity, 1);

    clearCart(userId);
    await flushCartStoreWrites();

    rows = await prisma.cartEntry.findMany({ where: { userId } });
    assert.equal(rows.length, 0);
  } finally {
    await prisma.cartEntry.deleteMany({ where: { userId } });
  }
});

test('redeem store writes through to prisma RedeemCode', async () => {
  const code = uniqueText('redeem').toUpperCase();
  const userId = uniqueText('redeem-user');

  try {
    const created = setCode(code, {
      type: 'coins',
      amount: 456,
    });
    assert.equal(created.ok, true);
    await flushRedeemStoreWrites();

    let row = await prisma.redeemCode.findUnique({ where: { code } });
    assert.ok(row);
    assert.equal(row.type, 'coins');
    assert.equal(row.amount, 456);
    assert.equal(row.usedBy, null);

    markUsed(code, userId);
    await flushRedeemStoreWrites();

    row = await prisma.redeemCode.findUnique({ where: { code } });
    assert.ok(row);
    assert.equal(row.usedBy, userId);
    assert.ok(row.usedAt);

    resetCodeUsage(code);
    await flushRedeemStoreWrites();

    row = await prisma.redeemCode.findUnique({ where: { code } });
    assert.ok(row);
    assert.equal(row.usedBy, null);
    assert.equal(row.usedAt, null);

    const removed = deleteCode(code);
    assert.equal(removed, true);
    await flushRedeemStoreWrites();

    row = await prisma.redeemCode.findUnique({ where: { code } });
    assert.equal(row, null);
  } finally {
    await prisma.redeemCode.deleteMany({ where: { code } });
  }
});
