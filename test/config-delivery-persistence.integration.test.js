const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const { prisma } = require('../src/prisma');
const {
  initDeliveryPersistenceStore,
  replaceDeliveryQueue,
  listDeliveryQueue,
  replaceDeliveryDeadLetters,
  listDeliveryDeadLetters,
  flushDeliveryPersistenceWrites,
} = require('../src/services/rconDelivery');

test('config + delivery non-store persistence writes through prisma', async () => {
  const originalConfig = config.getConfigSnapshot();
  await config.initConfigStore?.();
  await initDeliveryPersistenceStore?.();

  const nowIso = new Date().toISOString();

  try {
    await prisma.botConfig.deleteMany();
    await prisma.deliveryQueueJob.deleteMany();
    await prisma.deliveryDeadLetter.deleteMany();

    const nextName = `SCUM Test ${Date.now()}`;
    config.updateConfigPatch({
      serverInfo: { name: nextName },
    });
    await config.flushConfigWrites?.();

    const persistedConfig = await prisma.botConfig.findUnique({
      where: { id: 1 },
    });
    assert.ok(persistedConfig, 'bot config row should exist');

    const parsed = JSON.parse(persistedConfig.configJson || '{}');
    assert.equal(parsed.serverInfo?.name, nextName);

    replaceDeliveryQueue([
      {
        purchaseCode: 'Q-PERSIST-1',
        userId: 'u-1',
        itemId: 'item-1',
        itemName: 'Item 1',
        gameItemId: 'Game_Item_1',
        quantity: 2,
        deliveryItems: [{ gameItemId: 'Game_Item_1', quantity: 2 }],
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    replaceDeliveryDeadLetters([
      {
        purchaseCode: 'Q-PERSIST-1',
        userId: 'u-1',
        itemId: 'item-1',
        itemName: 'Item 1',
        attempts: 3,
        reason: 'delivery failed for test',
        deliveryItems: [{ gameItemId: 'Game_Item_1', quantity: 2 }],
        meta: { source: 'test' },
        createdAt: nowIso,
      },
    ]);

    await flushDeliveryPersistenceWrites();

    const queueRows = await prisma.deliveryQueueJob.findMany();
    const deadRows = await prisma.deliveryDeadLetter.findMany();

    assert.equal(queueRows.length, 1);
    assert.equal(deadRows.length, 1);
    assert.equal(listDeliveryQueue().length, 1);
    assert.equal(listDeliveryDeadLetters().length, 1);

    const queueItems = JSON.parse(queueRows[0].deliveryItemsJson || '[]');
    assert.equal(queueItems[0].gameItemId, 'Game_Item_1');

    const deadItems = JSON.parse(deadRows[0].deliveryItemsJson || '[]');
    assert.equal(deadItems[0].quantity, 2);
  } finally {
    config.setFullConfig(originalConfig);
    await config.flushConfigWrites?.();

    replaceDeliveryQueue([]);
    replaceDeliveryDeadLetters([]);
    await flushDeliveryPersistenceWrites();
  }
});
