const { loadJson, saveJsonDebounced } = require('./_persist');
const { prisma } = require('../prisma');

const PANEL_TYPES = new Set([
  'topKiller',
  'topGunKill',
  'topKd',
  'topPlaytime',
  'topEconomy',
]);
const panelsByGuild = new Map(); // guildId -> panel refs

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

function normalizePanelType(panelType) {
  const raw = String(panelType || '').trim();
  if (!raw) return null;
  if (raw === 'top-killer') return 'topKiller';
  if (raw === 'top-gun-kill' || raw === 'top-gun') return 'topGunKill';
  if (raw === 'top-kd') return 'topKd';
  if (raw === 'top-playtime') return 'topPlaytime';
  if (raw === 'top-economy') return 'topEconomy';
  if (PANEL_TYPES.has(raw)) return raw;
  return null;
}

function normalizeRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const channelId = String(ref.channelId || '').trim();
  const messageId = String(ref.messageId || '').trim();
  if (!channelId || !messageId) return null;
  return {
    channelId,
    messageId,
    updatedAt: ref.updatedAt ? new Date(ref.updatedAt).toISOString() : new Date().toISOString(),
  };
}

function normalizeState(input) {
  const state = {
    topKiller: null,
    topGunKill: null,
    topKd: null,
    topPlaytime: null,
    topEconomy: null,
  };
  if (!input || typeof input !== 'object') return state;

  state.topKiller = normalizeRef(input.topKiller);
  state.topGunKill = normalizeRef(input.topGunKill);
  state.topKd = normalizeRef(input.topKd);
  state.topPlaytime = normalizeRef(input.topPlaytime);
  state.topEconomy = normalizeRef(input.topEconomy);
  return state;
}

const scheduleSave = saveJsonDebounced('top-panels.json', () => ({
  guilds: Array.from(panelsByGuild.entries()),
}));

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[topPanelStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const rows = await prisma.topPanelMessage.findMany({
      orderBy: [{ guildId: 'asc' }, { panelType: 'asc' }],
    });
    if (rows.length === 0) {
      if (panelsByGuild.size > 0) {
        await queueDbWrite(
          async () => {
            for (const [guildId, state] of panelsByGuild.entries()) {
              for (const panelType of PANEL_TYPES.values()) {
                const ref = state?.[panelType];
                if (!ref) continue;
                await prisma.topPanelMessage.upsert({
                  where: {
                    guildId_panelType: {
                      guildId,
                      panelType,
                    },
                  },
                  update: {
                    channelId: ref.channelId,
                    messageId: ref.messageId,
                    updatedAt: new Date(ref.updatedAt),
                  },
                  create: {
                    guildId,
                    panelType,
                    channelId: ref.channelId,
                    messageId: ref.messageId,
                    updatedAt: new Date(ref.updatedAt),
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

    const hydrated = new Map();
    for (const row of rows) {
      const guildId = String(row.guildId || '').trim();
      const panelType = normalizePanelType(row.panelType);
      if (!guildId || !panelType) continue;
      const state = hydrated.get(guildId) || normalizeState(null);
      state[panelType] = normalizeRef({
        channelId: row.channelId,
        messageId: row.messageId,
        updatedAt: row.updatedAt,
      });
      hydrated.set(guildId, state);
    }

    if (startVersion === mutationVersion) {
      panelsByGuild.clear();
      for (const [guildId, state] of hydrated.entries()) {
        panelsByGuild.set(guildId, state);
      }
      scheduleSave();
      return;
    }

    for (const [guildId, state] of hydrated.entries()) {
      if (!panelsByGuild.has(guildId)) {
        panelsByGuild.set(guildId, state);
      }
    }
    scheduleSave();
  } catch (error) {
    console.error('[topPanelStore] failed to hydrate from prisma:', error.message);
  }
}

function loadLegacySnapshot() {
  const persisted = loadJson('top-panels.json', null);
  if (!persisted?.guilds || !Array.isArray(persisted.guilds)) return;
  for (const [guildIdRaw, stateRaw] of persisted.guilds) {
    const guildId = String(guildIdRaw || '').trim();
    if (!guildId) continue;
    panelsByGuild.set(guildId, normalizeState(stateRaw));
  }
}

function initTopPanelStore() {
  if (!initPromise) {
    loadLegacySnapshot();
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushTopPanelStoreWrites() {
  return dbWriteQueue;
}

function getGuildState(guildId, createIfMissing = false) {
  const key = String(guildId || '').trim();
  if (!key) return null;
  let state = panelsByGuild.get(key) || null;
  if (!state && createIfMissing) {
    state = normalizeState(null);
    panelsByGuild.set(key, state);
    scheduleSave();
  }
  return state;
}

function setTopPanelMessage(guildId, panelType, channelId, messageId) {
  const key = normalizePanelType(panelType);
  if (!key) return null;
  const state = getGuildState(guildId, true);
  if (!state) return null;
  state[key] = normalizeRef({ channelId, messageId, updatedAt: new Date().toISOString() });
  mutationVersion += 1;
  scheduleSave();

  const guildKey = String(guildId || '').trim();
  const ref = state[key];
  queueDbWrite(
    async () => {
      if (!ref) return;
      await prisma.topPanelMessage.upsert({
        where: {
          guildId_panelType: {
            guildId: guildKey,
            panelType: key,
          },
        },
        update: {
          channelId: ref.channelId,
          messageId: ref.messageId,
          updatedAt: new Date(ref.updatedAt),
        },
        create: {
          guildId: guildKey,
          panelType: key,
          channelId: ref.channelId,
          messageId: ref.messageId,
          updatedAt: new Date(ref.updatedAt),
        },
      });
    },
    'set-top-panel',
  );
  return state[key];
}

function getTopPanelMessage(guildId, panelType) {
  const key = normalizePanelType(panelType);
  if (!key) return null;
  const state = getGuildState(guildId, false);
  if (!state) return null;
  return state[key] || null;
}

function removeTopPanelMessage(guildId, panelType) {
  const key = normalizePanelType(panelType);
  if (!key) return false;
  const state = getGuildState(guildId, false);
  if (!state || !state[key]) return false;
  state[key] = null;
  mutationVersion += 1;
  scheduleSave();

  const guildKey = String(guildId || '').trim();
  queueDbWrite(
    async () => {
      await prisma.topPanelMessage.deleteMany({
        where: {
          guildId: guildKey,
          panelType: key,
        },
      });
    },
    'remove-top-panel',
  );
  return true;
}

function getTopPanelsForGuild(guildId) {
  const state = getGuildState(guildId, false);
  if (!state) {
    return {
      topKiller: null,
      topGunKill: null,
      topKd: null,
      topPlaytime: null,
      topEconomy: null,
    };
  }
  return {
    topKiller: state.topKiller || null,
    topGunKill: state.topGunKill || null,
    topKd: state.topKd || null,
    topPlaytime: state.topPlaytime || null,
    topEconomy: state.topEconomy || null,
  };
}

function listTopPanels() {
  return Array.from(panelsByGuild.entries()).map(([guildId, state]) => ({
    guildId,
    topKiller: state?.topKiller || null,
    topGunKill: state?.topGunKill || null,
    topKd: state?.topKd || null,
    topPlaytime: state?.topPlaytime || null,
    topEconomy: state?.topEconomy || null,
  }));
}

function replaceTopPanels(nextPanels = []) {
  mutationVersion += 1;
  panelsByGuild.clear();
  for (const row of Array.isArray(nextPanels) ? nextPanels : []) {
    if (!row || typeof row !== 'object') continue;
    const guildId = String(row.guildId || '').trim();
    if (!guildId) continue;
    panelsByGuild.set(guildId, normalizeState(row));
  }
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.topPanelMessage.deleteMany({});
      for (const [guildId, state] of panelsByGuild.entries()) {
        for (const panelType of PANEL_TYPES.values()) {
          const ref = state?.[panelType];
          if (!ref) continue;
          await prisma.topPanelMessage.create({
            data: {
              guildId,
              panelType,
              channelId: ref.channelId,
              messageId: ref.messageId,
              updatedAt: new Date(ref.updatedAt),
            },
          });
        }
      }
    },
    'replace-top-panels',
  );
  return panelsByGuild.size;
}

initTopPanelStore();

module.exports = {
  normalizePanelType,
  setTopPanelMessage,
  getTopPanelMessage,
  removeTopPanelMessage,
  getTopPanelsForGuild,
  listTopPanels,
  replaceTopPanels,
  initTopPanelStore,
  flushTopPanelStoreWrites,
};
