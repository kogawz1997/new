const { loadJson, saveJsonDebounced } = require('./_persist');
const { prisma } = require('../prisma');

const tickets = new Map(); // channelId -> ticket
let ticketCounter = 1;

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

const scheduleSave = saveJsonDebounced('tickets.json', () => ({
  ticketCounter,
  tickets: Array.from(tickets.entries()).map(([channelId, t]) => [
    channelId,
    {
      ...t,
      createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : null,
      closedAt: t.closedAt ? new Date(t.closedAt).toISOString() : null,
    },
  ]),
}));

function normalizeDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date;
}

function normalizeTicket(row = {}) {
  const channelId = String(row.channelId || '').trim();
  if (!channelId) return null;
  return {
    id: Number.isFinite(Number(row.id)) ? Math.max(0, Math.trunc(Number(row.id))) : 0,
    guildId: row.guildId ? String(row.guildId) : null,
    userId: row.userId ? String(row.userId) : null,
    channelId,
    category: row.category ? String(row.category) : null,
    reason: row.reason ? String(row.reason) : null,
    status: String(row.status || 'open'),
    claimedBy: row.claimedBy ? String(row.claimedBy) : null,
    createdAt: normalizeDate(row.createdAt, new Date()),
    closedAt: normalizeDate(row.closedAt, null),
  };
}

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[ticketStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const rows = await prisma.ticketRecord.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });

    if (rows.length === 0) {
      if (tickets.size > 0) {
        await queueDbWrite(
          async () => {
            for (const value of tickets.values()) {
              await prisma.ticketRecord.upsert({
                where: { channelId: value.channelId },
                update: {
                  id: value.id,
                  guildId: value.guildId,
                  userId: value.userId,
                  category: value.category,
                  reason: value.reason,
                  status: value.status,
                  claimedBy: value.claimedBy,
                  createdAt: value.createdAt,
                  closedAt: value.closedAt,
                },
                create: {
                  channelId: value.channelId,
                  id: value.id,
                  guildId: value.guildId,
                  userId: value.userId,
                  category: value.category,
                  reason: value.reason,
                  status: value.status,
                  claimedBy: value.claimedBy,
                  createdAt: value.createdAt,
                  closedAt: value.closedAt,
                },
              });
            }
          },
          'backfill',
        );
      }
      return;
    }

    const hydrated = new Map();
    for (const row of rows) {
      const parsed = normalizeTicket(row);
      if (!parsed) continue;
      hydrated.set(parsed.channelId, parsed);
    }

    if (startVersion === mutationVersion) {
      tickets.clear();
      for (const [channelId, value] of hydrated.entries()) {
        tickets.set(channelId, value);
      }
      const maxId = Math.max(0, ...Array.from(tickets.values()).map((t) => Number(t.id || 0)));
      ticketCounter = Math.max(1, maxId + 1);
      scheduleSave();
      return;
    }

    for (const [channelId, value] of hydrated.entries()) {
      if (!tickets.has(channelId)) {
        tickets.set(channelId, value);
      }
    }
    const maxId = Math.max(0, ...Array.from(tickets.values()).map((t) => Number(t.id || 0)));
    ticketCounter = Math.max(ticketCounter, maxId + 1);
    scheduleSave();
  } catch (error) {
    console.error('[ticketStore] failed to hydrate from prisma:', error.message);
  }
}

function loadLegacySnapshot() {
  const persisted = loadJson('tickets.json', null);
  if (!persisted) return;
  if (typeof persisted.ticketCounter === 'number') ticketCounter = persisted.ticketCounter;
  for (const [channelId, raw] of persisted.tickets || []) {
    const parsed = normalizeTicket({ ...raw, channelId });
    if (!parsed) continue;
    tickets.set(parsed.channelId, parsed);
  }
  const maxId = Math.max(0, ...Array.from(tickets.values()).map((t) => Number(t.id || 0)));
  ticketCounter = Math.max(ticketCounter, maxId + 1);
}

function initTicketStore() {
  if (!initPromise) {
    loadLegacySnapshot();
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushTicketStoreWrites() {
  return dbWriteQueue;
}

function createTicket({ guildId, userId, channelId, category, reason }) {
  const id = ticketCounter++;
  const t = normalizeTicket({
    id,
    guildId,
    userId,
    channelId,
    category,
    reason,
    status: 'open',
    claimedBy: null,
    createdAt: new Date(),
    closedAt: null,
  });
  tickets.set(t.channelId, t);
  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.ticketRecord.upsert({
        where: { channelId: t.channelId },
        update: {
          id: t.id,
          guildId: t.guildId,
          userId: t.userId,
          category: t.category,
          reason: t.reason,
          status: t.status,
          claimedBy: t.claimedBy,
          createdAt: t.createdAt,
          closedAt: t.closedAt,
        },
        create: {
          channelId: t.channelId,
          id: t.id,
          guildId: t.guildId,
          userId: t.userId,
          category: t.category,
          reason: t.reason,
          status: t.status,
          claimedBy: t.claimedBy,
          createdAt: t.createdAt,
          closedAt: t.closedAt,
        },
      });
    },
    'create-ticket',
  );
  return t;
}

function getTicketByChannel(channelId) {
  return tickets.get(channelId) || null;
}

function claimTicket(channelId, staffId) {
  const t = tickets.get(channelId);
  if (!t) return null;
  t.status = 'claimed';
  t.claimedBy = String(staffId || '');
  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.ticketRecord.updateMany({
        where: { channelId },
        data: {
          status: t.status,
          claimedBy: t.claimedBy,
        },
      });
    },
    'claim-ticket',
  );
  return t;
}

function closeTicket(channelId) {
  const t = tickets.get(channelId);
  if (!t) return null;
  t.status = 'closed';
  t.closedAt = new Date();
  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.ticketRecord.updateMany({
        where: { channelId },
        data: {
          status: t.status,
          closedAt: t.closedAt,
        },
      });
    },
    'close-ticket',
  );
  return t;
}

function replaceTickets(nextTickets = [], nextCounter = null) {
  mutationVersion += 1;
  tickets.clear();
  for (const row of Array.isArray(nextTickets) ? nextTickets : []) {
    const parsed = normalizeTicket(row);
    if (!parsed) continue;
    tickets.set(parsed.channelId, parsed);
  }

  if (Number.isFinite(Number(nextCounter)) && Number(nextCounter) > 0) {
    ticketCounter = Math.max(1, Math.trunc(Number(nextCounter)));
  } else {
    const maxId = Math.max(0, ...Array.from(tickets.values()).map((t) => Number(t.id || 0)));
    ticketCounter = maxId + 1;
  }
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.ticketRecord.deleteMany({});
      for (const value of tickets.values()) {
        await prisma.ticketRecord.create({
          data: {
            channelId: value.channelId,
            id: value.id,
            guildId: value.guildId,
            userId: value.userId,
            category: value.category,
            reason: value.reason,
            status: value.status,
            claimedBy: value.claimedBy,
            createdAt: value.createdAt,
            closedAt: value.closedAt,
          },
        });
      }
    },
    'replace-tickets',
  );
  return tickets.size;
}

initTicketStore();

module.exports = {
  tickets,
  createTicket,
  getTicketByChannel,
  claimTicket,
  closeTicket,
  replaceTickets,
  initTicketStore,
  flushTicketStoreWrites,
};
