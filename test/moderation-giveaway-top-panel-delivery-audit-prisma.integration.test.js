const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addPunishment,
  replacePunishments,
  flushModerationStoreWrites,
} = require('../src/store/moderationStore');
const {
  createGiveaway,
  addEntrant,
  removeGiveaway,
  flushGiveawayStoreWrites,
} = require('../src/store/giveawayStore');
const {
  setTopPanelMessage,
  removeTopPanelMessage,
  flushTopPanelStoreWrites,
} = require('../src/store/topPanelStore');
const {
  addDeliveryAudit,
  clearDeliveryAudit,
  flushDeliveryAuditStoreWrites,
} = require('../src/store/deliveryAuditStore');
const { prisma } = require('../src/prisma');

function uniqueText(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test('moderation/giveaway/top-panel/delivery-audit stores write through to prisma', async () => {
  const userId = uniqueText('mod-user');
  const messageId = uniqueText('ga-msg');
  const guildId = uniqueText('guild');
  const channelId = uniqueText('channel');
  const panelGuild = uniqueText('panel-guild');
  const panelChannel = uniqueText('panel-channel');
  const panelMessage = uniqueText('panel-message');
  const auditId = uniqueText('audit-id');

  try {
    addPunishment(userId, 'warn', 'test warn', 'staff-1', null);
    await flushModerationStoreWrites();

    let punishmentRows = await prisma.punishment.findMany({
      where: { userId },
    });
    assert.equal(punishmentRows.length >= 1, true);
    assert.equal(punishmentRows[0].type, 'warn');

    replacePunishments([]);
    await flushModerationStoreWrites();
    punishmentRows = await prisma.punishment.findMany({ where: { userId } });
    assert.equal(punishmentRows.length, 0);

    createGiveaway({
      messageId,
      channelId,
      guildId,
      prize: 'VIP 7 วัน',
      winnersCount: 1,
      endsAt: new Date(Date.now() + 3600_000),
    });
    addEntrant(messageId, userId);
    await flushGiveawayStoreWrites();

    let giveawayRow = await prisma.giveaway.findUnique({ where: { messageId } });
    assert.ok(giveawayRow);
    let entrantRow = await prisma.giveawayEntrant.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
    });
    assert.ok(entrantRow);

    removeGiveaway(messageId);
    await flushGiveawayStoreWrites();
    giveawayRow = await prisma.giveaway.findUnique({ where: { messageId } });
    entrantRow = await prisma.giveawayEntrant.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
    });
    assert.equal(giveawayRow, null);
    assert.equal(entrantRow, null);

    setTopPanelMessage(
      panelGuild,
      'topKiller',
      panelChannel,
      panelMessage,
    );
    await flushTopPanelStoreWrites();
    let panelRow = await prisma.topPanelMessage.findUnique({
      where: {
        guildId_panelType: {
          guildId: panelGuild,
          panelType: 'topKiller',
        },
      },
    });
    assert.ok(panelRow);
    assert.equal(panelRow.channelId, panelChannel);
    assert.equal(panelRow.messageId, panelMessage);

    removeTopPanelMessage(panelGuild, 'topKiller');
    await flushTopPanelStoreWrites();
    panelRow = await prisma.topPanelMessage.findUnique({
      where: {
        guildId_panelType: {
          guildId: panelGuild,
          panelType: 'topKiller',
        },
      },
    });
    assert.equal(panelRow, null);

    addDeliveryAudit({
      id: auditId,
      level: 'info',
      action: 'delivery_test',
      userId,
      message: 'integration delivery audit',
      meta: { source: 'test' },
    });
    await flushDeliveryAuditStoreWrites();
    let auditRow = await prisma.deliveryAudit.findUnique({
      where: { id: auditId },
    });
    assert.ok(auditRow);
    assert.equal(auditRow.action, 'delivery_test');

    clearDeliveryAudit();
    await flushDeliveryAuditStoreWrites();
    auditRow = await prisma.deliveryAudit.findUnique({
      where: { id: auditId },
    });
    assert.equal(auditRow, null);
  } finally {
    await prisma.punishment.deleteMany({ where: { userId } });
    await prisma.giveawayEntrant.deleteMany({ where: { messageId } });
    await prisma.giveaway.deleteMany({ where: { messageId } });
    await prisma.topPanelMessage.deleteMany({
      where: {
        guildId: panelGuild,
      },
    });
    await prisma.deliveryAudit.deleteMany({ where: { id: auditId } });
  }
});
