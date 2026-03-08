const { loadJson, saveJsonDebounced } = require('./_persist');
const { prisma } = require('../prisma');

const events = new Map(); // id -> event
const eventParticipants = new Map(); // eventId -> Set(userId)

let eventCounter = 1;
let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

const scheduleSave = saveJsonDebounced('events.json', () => ({
  eventCounter,
  events: Array.from(events.entries()),
  participants: Array.from(eventParticipants.entries()).map(([eventId, set]) => [
    eventId,
    Array.from(set || []),
  ]),
}));

function normalizeEvent(row = {}) {
  const id = Number(row.id || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id: Math.trunc(id),
    name: String(row.name || ''),
    time: String(row.time || ''),
    reward: String(row.reward || ''),
    status: String(row.status || 'scheduled'),
  };
}

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[eventStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const rows = await prisma.guildEvent.findMany({
      include: {
        participants: true,
      },
      orderBy: { id: 'asc' },
    });

    if (rows.length === 0) {
      if (events.size > 0) {
        await queueDbWrite(
          async () => {
            for (const ev of events.values()) {
              await prisma.guildEvent.upsert({
                where: { id: ev.id },
                update: {
                  name: ev.name,
                  time: ev.time,
                  reward: ev.reward,
                  status: ev.status,
                },
                create: {
                  id: ev.id,
                  name: ev.name,
                  time: ev.time,
                  reward: ev.reward,
                  status: ev.status,
                },
              });
              const participants = eventParticipants.get(ev.id) || new Set();
              for (const userId of participants) {
                await prisma.guildEventParticipant.upsert({
                  where: {
                    eventId_userId: {
                      eventId: ev.id,
                      userId,
                    },
                  },
                  update: {},
                  create: {
                    eventId: ev.id,
                    userId,
                  },
                });
              }
            }
          },
          'backfill',
        );
      }
      return;
    }

    const hydratedEvents = new Map();
    const hydratedParticipants = new Map();
    for (const row of rows) {
      const ev = normalizeEvent(row);
      if (!ev) continue;
      hydratedEvents.set(ev.id, ev);
      hydratedParticipants.set(
        ev.id,
        new Set(
          (Array.isArray(row.participants) ? row.participants : [])
            .map((p) => String(p.userId || '').trim())
            .filter(Boolean),
        ),
      );
    }

    if (startVersion === mutationVersion) {
      events.clear();
      eventParticipants.clear();
      for (const [id, ev] of hydratedEvents.entries()) {
        events.set(id, ev);
      }
      for (const [id, set] of hydratedParticipants.entries()) {
        eventParticipants.set(id, set);
      }
      const maxId = Math.max(0, ...Array.from(events.keys()).map((n) => Number(n)));
      eventCounter = Math.max(1, maxId + 1);
      scheduleSave();
      return;
    }

    for (const [id, ev] of hydratedEvents.entries()) {
      if (!events.has(id)) {
        events.set(id, ev);
      }
      if (!eventParticipants.has(id)) {
        eventParticipants.set(id, hydratedParticipants.get(id) || new Set());
      }
    }
    const maxId = Math.max(0, ...Array.from(events.keys()).map((n) => Number(n)));
    eventCounter = Math.max(eventCounter, maxId + 1);
    scheduleSave();
  } catch (error) {
    console.error('[eventStore] failed to hydrate from prisma:', error.message);
  }
}

function loadLegacySnapshot() {
  const persisted = loadJson('events.json', null);
  if (!persisted) return;

  if (typeof persisted.eventCounter === 'number') {
    eventCounter = persisted.eventCounter;
  }
  for (const [id, ev] of persisted.events || []) {
    const parsed = normalizeEvent({ ...ev, id: Number(ev?.id ?? id) });
    if (!parsed) continue;
    events.set(parsed.id, parsed);
  }
  for (const [eventId, arr] of persisted.participants || []) {
    eventParticipants.set(
      Number(eventId),
      new Set(
        (Array.isArray(arr) ? arr : [])
          .map((userId) => String(userId || '').trim())
          .filter(Boolean),
      ),
    );
  }
  const maxId = Math.max(0, ...Array.from(events.keys()).map((n) => Number(n)));
  eventCounter = Math.max(eventCounter, maxId + 1);
}

function initEventStore() {
  if (!initPromise) {
    loadLegacySnapshot();
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushEventStoreWrites() {
  return dbWriteQueue;
}

function createEvent({ name, time, reward }) {
  const id = eventCounter++;
  const ev = {
    id,
    name: String(name || ''),
    time: String(time || ''),
    reward: String(reward || ''),
    status: 'scheduled', // scheduled | started | ended
  };
  events.set(id, ev);
  eventParticipants.set(id, new Set());
  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.guildEvent.upsert({
        where: { id },
        update: {
          name: ev.name,
          time: ev.time,
          reward: ev.reward,
          status: ev.status,
        },
        create: {
          id,
          name: ev.name,
          time: ev.time,
          reward: ev.reward,
          status: ev.status,
        },
      });
    },
    'create-event',
  );
  return ev;
}

function getEvent(id) {
  return events.get(id) || null;
}

function listEvents() {
  return Array.from(events.values());
}

function joinEvent(id, userId) {
  const eventId = Number(id);
  const ev = events.get(eventId);
  if (!ev) return null;
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return null;
  const set = eventParticipants.get(eventId) || new Set();
  set.add(normalizedUserId);
  eventParticipants.set(eventId, set);
  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.guildEventParticipant.upsert({
        where: {
          eventId_userId: {
            eventId,
            userId: normalizedUserId,
          },
        },
        update: {},
        create: {
          eventId,
          userId: normalizedUserId,
        },
      });
    },
    'join-event',
  );
  return { ev, participants: set };
}

function startEvent(id) {
  const eventId = Number(id);
  const ev = events.get(eventId);
  if (!ev) return null;
  ev.status = 'started';
  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.guildEvent.updateMany({
        where: { id: eventId },
        data: {
          status: ev.status,
        },
      });
    },
    'start-event',
  );
  return ev;
}

function endEvent(id) {
  const eventId = Number(id);
  const ev = events.get(eventId);
  if (!ev) return null;
  ev.status = 'ended';
  mutationVersion += 1;
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.guildEvent.updateMany({
        where: { id: eventId },
        data: {
          status: ev.status,
        },
      });
    },
    'end-event',
  );
  return ev;
}

function getParticipants(id) {
  const eventId = Number(id);
  const set = eventParticipants.get(eventId);
  if (!set) return [];
  return Array.from(set);
}

function replaceEvents(nextEvents = [], nextParticipants = [], nextCounter = null) {
  mutationVersion += 1;
  events.clear();
  eventParticipants.clear();

  for (const row of Array.isArray(nextEvents) ? nextEvents : []) {
    const parsed = normalizeEvent(row);
    if (!parsed) continue;
    events.set(parsed.id, parsed);
    eventParticipants.set(parsed.id, new Set());
  }

  if (Array.isArray(nextParticipants)) {
    for (const row of nextParticipants) {
      if (!row || typeof row !== 'object') continue;
      const eventId = Number(row.eventId || row.id || 0);
      if (!Number.isFinite(eventId) || eventId <= 0) continue;
      const set = eventParticipants.get(eventId) || new Set();
      for (const userId of Array.isArray(row.participants) ? row.participants : []) {
        const normalized = String(userId || '').trim();
        if (normalized) set.add(normalized);
      }
      eventParticipants.set(eventId, set);
    }
  }

  if (Number.isFinite(Number(nextCounter)) && Number(nextCounter) > 0) {
    eventCounter = Math.max(1, Math.trunc(Number(nextCounter)));
  } else {
    const maxId = Math.max(0, ...Array.from(events.keys()).map((n) => Number(n)));
    eventCounter = maxId + 1;
  }
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.guildEventParticipant.deleteMany({});
      await prisma.guildEvent.deleteMany({});
      for (const ev of events.values()) {
        await prisma.guildEvent.create({
          data: {
            id: ev.id,
            name: ev.name,
            time: ev.time,
            reward: ev.reward,
            status: ev.status,
          },
        });
      }
      for (const [eventId, participants] of eventParticipants.entries()) {
        for (const userId of participants) {
          await prisma.guildEventParticipant.create({
            data: {
              eventId,
              userId,
            },
          });
        }
      }
    },
    'replace-events',
  );
  return events.size;
}

initEventStore();

module.exports = {
  createEvent,
  getEvent,
  listEvents,
  joinEvent,
  startEvent,
  endEvent,
  getParticipants,
  replaceEvents,
  initEventStore,
  flushEventStoreWrites,
};
