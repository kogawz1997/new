const test = require('node:test');
const assert = require('node:assert/strict');

const {
  setMembership,
  removeMembership,
  flushVipStoreWrites,
} = require('../src/store/vipStore');
const {
  createTicket,
  claimTicket,
  closeTicket,
  flushTicketStoreWrites,
} = require('../src/store/ticketStore');
const {
  createEvent,
  joinEvent,
  startEvent,
  endEvent,
  flushEventStoreWrites,
} = require('../src/store/eventStore');
const { updateStatus, flushScumStoreWrites } = require('../src/store/scumStore');
const { prisma } = require('../src/prisma');

function uniqueText(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test('vip/ticket/event/scum stores write through to prisma', async () => {
  const userId = uniqueText('vip-user');
  const channelId = uniqueText('ticket-channel');
  const eventUserId = uniqueText('event-user');

  let eventId = null;

  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    setMembership(userId, 'vip-7d', expiresAt);
    await flushVipStoreWrites();

    let vipRow = await prisma.vipMembership.findUnique({ where: { userId } });
    assert.ok(vipRow);
    assert.equal(vipRow.planId, 'vip-7d');

    removeMembership(userId);
    await flushVipStoreWrites();
    vipRow = await prisma.vipMembership.findUnique({ where: { userId } });
    assert.equal(vipRow, null);

    createTicket({
      guildId: 'guild-1',
      userId,
      channelId,
      category: 'help',
      reason: 'integration test',
    });
    claimTicket(channelId, 'staff-1');
    closeTicket(channelId);
    await flushTicketStoreWrites();

    const ticketRow = await prisma.ticketRecord.findUnique({
      where: { channelId },
    });
    assert.ok(ticketRow);
    assert.equal(ticketRow.status, 'closed');
    assert.equal(ticketRow.claimedBy, 'staff-1');
    assert.ok(ticketRow.closedAt);

    const ev = createEvent({
      name: 'Test Event',
      time: 'คืนนี้',
      reward: '1000 coins',
    });
    eventId = ev.id;
    joinEvent(eventId, eventUserId);
    startEvent(eventId);
    endEvent(eventId);
    await flushEventStoreWrites();

    const eventRow = await prisma.guildEvent.findUnique({
      where: { id: eventId },
    });
    assert.ok(eventRow);
    assert.equal(eventRow.status, 'ended');

    const participant = await prisma.guildEventParticipant.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId: eventUserId,
        },
      },
    });
    assert.ok(participant);

    updateStatus({
      onlinePlayers: 12,
      maxPlayers: 64,
      pingMs: 35,
      uptimeMinutes: 321,
    });
    await flushScumStoreWrites();

    const scumRow = await prisma.scumStatus.findUnique({ where: { id: 1 } });
    assert.ok(scumRow);
    assert.equal(scumRow.onlinePlayers, 12);
    assert.equal(scumRow.maxPlayers, 64);
    assert.equal(scumRow.pingMs, 35);
    assert.equal(scumRow.uptimeMinutes, 321);
  } finally {
    await prisma.vipMembership.deleteMany({ where: { userId } });
    await prisma.ticketRecord.deleteMany({ where: { channelId } });
    if (eventId != null) {
      await prisma.guildEventParticipant.deleteMany({ where: { eventId } });
      await prisma.guildEvent.deleteMany({ where: { id: eventId } });
    }
  }
});
