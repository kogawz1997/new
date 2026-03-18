const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const { prisma } = require('../prisma');
const { listShopItems } = require('../store/memoryStore');
const {
  listTickets,
  replaceTickets,
  flushTicketStoreWrites,
} = require('../store/ticketStore');
const {
  listAllStats,
  replaceStats,
  flushStatsStoreWrites,
} = require('../store/statsStore');
const {
  listWeaponStats,
  replaceWeaponStats,
  flushWeaponStatsStoreWrites,
} = require('../store/weaponStatsStore');
const {
  listBounties,
  replaceBounties,
  flushBountyStoreWrites,
} = require('../store/bountyStore');
const {
  listEvents,
  getParticipants,
  replaceEvents,
  flushEventStoreWrites,
} = require('../store/eventStore');
const {
  listGiveaways,
  replaceGiveaways,
  flushGiveawayStoreWrites,
} = require('../store/giveawayStore');
const { listLinks, replaceLinks, flushLinkStoreWrites } = require('../store/linkStore');
const {
  getStatus,
  replaceStatus,
  flushScumStoreWrites,
} = require('../store/scumStore');
const {
  listMemberships,
  replaceMemberships,
  flushVipStoreWrites,
} = require('../store/vipStore');
const {
  listAllPunishments,
  replacePunishments,
  flushModerationStoreWrites,
} = require('../store/moderationStore');
const {
  listCodes,
  replaceCodes,
  flushRedeemStoreWrites,
} = require('../store/redeemStore');
const {
  listClaimed,
  replaceClaims,
  flushWelcomePackStoreWrites,
} = require('../store/welcomePackStore');
const {
  listDailyRents,
  listRentalVehicles,
  replaceRentBikeData,
} = require('../store/rentBikeStore');
const {
  listLuckyWheelStates,
  replaceLuckyWheelStates,
} = require('../store/luckyWheelStore');
const {
  listAllPartyMessages,
  replacePartyMessages,
} = require('../store/partyChatStore');
const {
  listTopPanels,
  replaceTopPanels,
  flushTopPanelStoreWrites,
} = require('../store/topPanelStore');
const {
  listAllCarts,
  replaceCarts,
  flushCartStoreWrites,
} = require('../store/cartStore');
const { getRentBikeRuntime } = require('./rentBikeService');
const {
  listDeliveryQueue,
  listDeliveryDeadLetters,
  listDeliveryAudit,
  getDeliveryRuntimeStatus,
  flushDeliveryPersistenceWrites,
  replaceDeliveryQueue,
  replaceDeliveryDeadLetters,
} = require('./rconDelivery');
const {
  replaceDeliveryAudit,
  flushDeliveryAuditStoreWrites,
} = require('../store/deliveryAuditStore');
const {
  listAdminNotifications,
  replaceAdminNotifications,
} = require('../store/adminNotificationStore');
const {
  listAdminSecurityEvents,
  replaceAdminSecurityEvents,
} = require('../store/adminSecurityEventStore');
const {
  listAdminRequestLogs,
} = require('../store/adminRequestLogStore');
const {
  listAdminCommandCapabilityPresets,
  replaceAdminCommandCapabilityPresets,
} = require('../store/adminCommandCapabilityPresetStore');
const { resolveItemIconUrl } = require('./itemIconService');
const { getRuntimeSupervisorSnapshot } = require('./runtimeSupervisorService');
const {
  listMarketplaceOffers,
  listPlatformAgentRuntimes,
  listPlatformApiKeys,
  listPlatformLicenses,
  listPlatformSubscriptions,
  listPlatformTenants,
  listPlatformWebhookEndpoints,
} = require('./platformService');
const { getPlatformOpsState } = require('../store/platformOpsStateStore');
const { publishAdminLiveUpdate } = require('./adminLiveBus');
const { acquireRuntimeLock, releaseRuntimeLock } = require('./runtimeLock');
const { DATA_DIR, getPersistenceStatus } = require('../store/_persist');
const {
  getAdminRestoreState,
  setAdminRestoreState,
} = require('../store/adminRestoreStateStore');

const BACKUP_DIR = path.resolve(
  String(process.env.ADMIN_WEB_BACKUP_DIR || path.join(DATA_DIR, 'backups')).trim()
    || path.join(DATA_DIR, 'backups'),
);
const RESTORE_LOCK_NAME = 'admin-backup-restore';
const RESTORE_PREVIEW_TTL_MS = Math.max(
  30 * 1000,
  Math.trunc(Number(process.env.ADMIN_WEB_RESTORE_PREVIEW_TTL_MS || 10 * 60 * 1000) || (10 * 60 * 1000)),
);
const CURRENT_BACKUP_SCHEMA_VERSION = 1;
const LEGACY_BACKUP_SCHEMA_VERSION = 0;
const SUPPORTED_BACKUP_SCHEMA_VERSIONS = Object.freeze([
  LEGACY_BACKUP_SCHEMA_VERSION,
  CURRENT_BACKUP_SCHEMA_VERSION,
]);

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeWallet(wallet) {
  return {
    ...wallet,
    lastDaily: wallet.lastDaily == null ? null : Number(wallet.lastDaily),
    lastWeekly: wallet.lastWeekly == null ? null : Number(wallet.lastWeekly),
  };
}

function normalizeTickets() {
  return listTickets()
    .map((ticket) => ({
      ...ticket,
      createdAt: ticket.createdAt ? new Date(ticket.createdAt) : null,
      closedAt: ticket.closedAt ? new Date(ticket.closedAt) : null,
    }))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function normalizeEvents() {
  return listEvents().map((eventRow) => {
    const participants = getParticipants(eventRow.id);
    return {
      ...eventRow,
      participants,
      participantsCount: participants.length,
    };
  });
}

function normalizeGiveaways() {
  return listGiveaways().map((giveaway) => {
    const entrants = Array.from(giveaway.entrants || []);
    return {
      ...giveaway,
      entrants,
      entrantsCount: entrants.length,
    };
  });
}

function normalizeConfig() {
  if (typeof config.getConfigSnapshot === 'function') {
    return config.getConfigSnapshot();
  }
  return {
    economy: config.economy,
    channels: config.channels,
    roles: config.roles,
    restartSchedule: config.restartSchedule,
    raidTimes: config.raidTimes,
    vipPlans: config.vip?.plans || [],
    killFeed: config.killFeed || {},
  };
}

function primeSnapshotStoreReaders() {
  listTickets();
  listBounties();
  listEvents();
  listLinks();
  listMemberships();
  listWeaponStats();
  listAllStats();
  listGiveaways();
  listAllPunishments();
  listCodes();
  listClaimed();
  listTopPanels();
  listAllCarts();
  getStatus();
  listDeliveryQueue(1);
  listDeliveryDeadLetters(1);
  listDeliveryAudit(1);
}

async function flushSnapshotStoreState() {
  primeSnapshotStoreReaders();
  await Promise.all([
    flushTicketStoreWrites(),
    flushBountyStoreWrites(),
    flushEventStoreWrites(),
    flushLinkStoreWrites(),
    flushVipStoreWrites(),
    flushWeaponStatsStoreWrites(),
    flushStatsStoreWrites(),
    flushGiveawayStoreWrites(),
    flushModerationStoreWrites(),
    flushRedeemStoreWrites(),
    flushWelcomePackStoreWrites(),
    flushTopPanelStoreWrites(),
    flushCartStoreWrites(),
    flushScumStoreWrites(),
    flushDeliveryAuditStoreWrites(),
    flushDeliveryPersistenceWrites(),
  ]);
}

// Backups are file-based on purpose so admins can inspect/export them without needing
// a separate artifact store during recovery work.
function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function makeBackupId() {
  const datePart = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const randPart = crypto.randomBytes(3).toString('hex');
  return `backup-${datePart}-${randPart}`;
}

function sanitizeBackupName(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) return null;
  if (value.includes('..')) return null;
  return value;
}

function listAdminBackupFiles() {
  ensureBackupDir();
  return fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const absolute = path.join(BACKUP_DIR, entry.name);
      const stat = fs.statSync(absolute);
      return {
        id: entry.name.replace(/\.json$/i, ''),
        file: entry.name,
        sizeBytes: stat.size,
        createdAt: stat.birthtime?.toISOString?.() || stat.ctime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function saveBackupPayload(payload, backupId = null) {
  ensureBackupDir();
  const id = backupId || makeBackupId();
  const file = `${id}.json`;
  const absolute = path.join(BACKUP_DIR, file);
  fs.writeFileSync(absolute, JSON.stringify(payload, jsonReplacer, 2), 'utf8');
  const stat = fs.statSync(absolute);
  return {
    id,
    file,
    absolutePath: absolute,
    sizeBytes: stat.size,
    createdAt: stat.birthtime?.toISOString?.() || stat.ctime.toISOString(),
  };
}

function buildBackupPayload({
  actor = 'unknown',
  role = 'unknown',
  note = null,
  snapshot = {},
  meta = null,
} = {}) {
  return {
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    createdBy: actor,
    role,
    note,
    meta: meta && typeof meta === 'object' ? meta : undefined,
    snapshot,
  };
}

function normalizeBackupSchemaVersion(value) {
  if (value == null || value === '') return LEGACY_BACKUP_SCHEMA_VERSION;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeAdminBackupPayload(rawPayload = null) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw createRestoreError('Backup payload is invalid', 400);
  }
  const wrappedSnapshot = rawPayload.snapshot;
  const isWrappedSnapshot =
    wrappedSnapshot && typeof wrappedSnapshot === 'object' && !Array.isArray(wrappedSnapshot);
  const schemaVersion = isWrappedSnapshot
    ? normalizeBackupSchemaVersion(rawPayload.schemaVersion)
    : LEGACY_BACKUP_SCHEMA_VERSION;
  if (!SUPPORTED_BACKUP_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw createRestoreError('Backup schemaVersion is not supported by this runtime', 400, {
      supportedSchemaVersions: SUPPORTED_BACKUP_SCHEMA_VERSIONS,
      receivedSchemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : null,
    });
  }
  const snapshot = isWrappedSnapshot ? wrappedSnapshot : rawPayload;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw createRestoreError('Backup payload is invalid', 400);
  }
  return {
    schemaVersion,
    compatibilityMode:
      schemaVersion === CURRENT_BACKUP_SCHEMA_VERSION
        ? 'current'
        : isWrappedSnapshot
          ? 'legacy-wrapped'
          : 'legacy-unwrapped',
    createdAt: isWrappedSnapshot ? rawPayload.createdAt || null : null,
    createdBy: isWrappedSnapshot ? rawPayload.createdBy || null : null,
    role: isWrappedSnapshot ? rawPayload.role || null : null,
    note: isWrappedSnapshot ? rawPayload.note || null : null,
    meta:
      isWrappedSnapshot && rawPayload.meta && typeof rawPayload.meta === 'object'
        ? rawPayload.meta
        : null,
    snapshot,
  };
}

function createRestoreError(message, statusCode = 500, data = null) {
  const error = new Error(String(message || 'Backup restore failed'));
  error.statusCode = Number(statusCode || 500);
  if (data && typeof data === 'object') {
    error.data = data;
  }
  return error;
}

// Full runtime snapshots/backups are intentionally global until the service grows
// topology-aware export/restore semantics for every tenant-scoped collection.
function assertGlobalSnapshotOperation(options = {}) {
  const scopedTenantId = String(
    options.tenantId
      || options.defaultTenantId
      || options.scopeTenantId
      || options.authTenantId
      || '',
  ).trim();
  if (!scopedTenantId) return;
  throw createRestoreError(
    'Tenant-scoped admin cannot manage shared runtime snapshots or backups',
    403,
    { tenantId: scopedTenantId },
  );
}

function createRestorePreviewToken() {
  return crypto.randomBytes(18).toString('hex');
}

function issueRestorePreviewState(backupFile) {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + RESTORE_PREVIEW_TTL_MS).toISOString();
  const previewToken = createRestorePreviewToken();
  const nextState = setAdminRestoreState({
    ...getAdminRestoreState(),
    previewToken,
    previewBackup: String(backupFile || '').trim() || null,
    previewIssuedAt: issuedAt,
    previewExpiresAt: expiresAt,
  });
  return {
    previewToken,
    previewBackup: nextState.previewBackup,
    previewIssuedAt: nextState.previewIssuedAt,
    previewExpiresAt: nextState.previewExpiresAt,
  };
}

function validateRestorePreviewState(backupFile, previewToken) {
  const backup = String(backupFile || '').trim();
  const token = String(previewToken || '').trim();
  const restoreState = getAdminRestoreState();
  const expiresAtMs = restoreState.previewExpiresAt
    ? new Date(restoreState.previewExpiresAt).getTime()
    : 0;

  if (!token) {
    throw createRestoreError('previewToken is required; run a restore dry-run first', 400, {
      restoreState,
    });
  }
  if (!restoreState.previewToken || restoreState.previewToken !== token) {
    throw createRestoreError('previewToken is invalid or no longer current', 400, {
      restoreState,
    });
  }
  if (!restoreState.previewBackup || restoreState.previewBackup !== backup) {
    throw createRestoreError('previewToken does not match the selected backup', 400, {
      restoreState,
    });
  }
  if (!expiresAtMs || expiresAtMs < Date.now()) {
    throw createRestoreError('previewToken has expired; run restore dry-run again', 400, {
      restoreState,
    });
  }

  return restoreState;
}

function readBackupPayloadByName(inputName) {
  const safeName = sanitizeBackupName(inputName);
  if (!safeName) {
    throw new Error('Invalid backup name');
  }
  const file = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
  const absolute = path.join(BACKUP_DIR, file);
  if (!fs.existsSync(absolute)) {
    throw new Error('Backup file not found');
  }
  const raw = fs.readFileSync(absolute, 'utf8');
  return {
    file,
    absolutePath: absolute,
    payload: JSON.parse(raw),
  };
}

async function replacePrismaTablesFromSnapshot(snapshot = {}) {
  const wallets = Array.isArray(snapshot.wallets) ? snapshot.wallets : [];
  const shopItems = Array.isArray(snapshot.shopItems) ? snapshot.shopItems : [];
  const purchases = Array.isArray(snapshot.purchases) ? snapshot.purchases : [];
  const walletLedgers = Array.isArray(snapshot.walletLedgers)
    ? snapshot.walletLedgers
    : [];
  const purchaseStatusHistory = Array.isArray(snapshot.purchaseStatusHistory)
    ? snapshot.purchaseStatusHistory
    : [];
  const playerAccounts = Array.isArray(snapshot.playerAccounts)
    ? snapshot.playerAccounts
    : [];
  const platformTenants = Array.isArray(snapshot.platformTenants)
    ? snapshot.platformTenants
    : [];
  const platformSubscriptions = Array.isArray(snapshot.platformSubscriptions)
    ? snapshot.platformSubscriptions
    : [];
  const platformLicenses = Array.isArray(snapshot.platformLicenses)
    ? snapshot.platformLicenses
    : [];
  const platformApiKeys = Array.isArray(snapshot.platformApiKeys)
    ? snapshot.platformApiKeys
    : [];
  const platformWebhookEndpoints = Array.isArray(snapshot.platformWebhookEndpoints)
    ? snapshot.platformWebhookEndpoints
    : [];
  const platformAgentRuntimes = Array.isArray(snapshot.platformAgentRuntimes)
    ? snapshot.platformAgentRuntimes
    : [];
  const platformMarketplaceOffers = Array.isArray(snapshot.platformMarketplaceOffers)
    ? snapshot.platformMarketplaceOffers
    : [];

  await prisma.$transaction([
    prisma.platformMarketplaceOffer.deleteMany({}),
    prisma.platformAgentRuntime.deleteMany({}),
    prisma.platformWebhookEndpoint.deleteMany({}),
    prisma.platformApiKey.deleteMany({}),
    prisma.platformLicense.deleteMany({}),
    prisma.platformSubscription.deleteMany({}),
    prisma.platformTenant.deleteMany({}),
    prisma.walletLedger.deleteMany({}),
    prisma.purchaseStatusHistory.deleteMany({}),
    prisma.playerAccount.deleteMany({}),
    prisma.userWallet.deleteMany({}),
    prisma.purchase.deleteMany({}),
    prisma.shopItem.deleteMany({}),
  ]);

  for (const row of wallets) {
    if (!row || typeof row !== 'object') continue;
    const userId = String(row.userId || '').trim();
    if (!userId) continue;
    await prisma.userWallet.create({
      data: {
        userId,
        balance: Number(row.balance || 0),
        lastDaily:
          row.lastDaily == null || row.lastDaily === ''
            ? null
            : BigInt(Math.trunc(Number(row.lastDaily))),
        lastWeekly:
          row.lastWeekly == null || row.lastWeekly === ''
            ? null
            : BigInt(Math.trunc(Number(row.lastWeekly))),
      },
    });
  }

  for (const row of shopItems) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    if (!id) continue;
    const deliveryItems = Array.isArray(row.deliveryItems)
      ? row.deliveryItems
          .map((entry) => ({
            gameItemId: String(entry?.gameItemId || '').trim(),
            quantity: Math.max(1, Number(entry?.quantity || 1)),
            iconUrl: entry?.iconUrl ? String(entry.iconUrl) : null,
          }))
          .filter((entry) => entry.gameItemId)
      : [];
    const primary = deliveryItems[0] || null;
    const rawKind = String(row.kind || 'item').trim().toLowerCase();
    const kind =
      rawKind === 'vip'
        ? 'vip'
        : rawKind === 'item'
          ? 'item'
          : rawKind || 'item';
    await prisma.shopItem.create({
      data: {
        id,
        name: String(row.name || id),
        price: Number(row.price || 0),
        description: String(row.description || ''),
        kind,
        gameItemId: kind === 'item'
          ? String(primary?.gameItemId || row.gameItemId || '').trim() || null
          : null,
        quantity: kind === 'item'
          ? Math.max(1, Number(primary?.quantity || row.quantity || 1))
          : 1,
        iconUrl: kind === 'item'
          ? (primary?.iconUrl || (row.iconUrl ? String(row.iconUrl) : null))
          : null,
        deliveryItemsJson:
          kind === 'item' && deliveryItems.length > 0
            ? JSON.stringify(deliveryItems)
            : null,
      },
    });
  }

  for (const row of purchases) {
    if (!row || typeof row !== 'object') continue;
    const code = String(row.code || '').trim();
    const userId = String(row.userId || '').trim();
    const itemId = String(row.itemId || '').trim();
    if (!code || !userId || !itemId) continue;
    await prisma.purchase.create({
      data: {
        code,
        userId,
        itemId,
        price: Number(row.price || 0),
        status: String(row.status || 'pending'),
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        statusUpdatedAt: row.statusUpdatedAt
          ? new Date(row.statusUpdatedAt)
          : row.createdAt
            ? new Date(row.createdAt)
            : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }

  for (const row of walletLedgers) {
    if (!row || typeof row !== 'object') continue;
    const userId = String(row.userId || '').trim();
    if (!userId) continue;
    await prisma.walletLedger.create({
      data: {
        userId,
        delta: Number(row.delta || 0),
        balanceBefore: Number(row.balanceBefore || 0),
        balanceAfter: Number(row.balanceAfter || 0),
        reason: String(row.reason || 'restore'),
        reference: row.reference ? String(row.reference) : null,
        actor: row.actor ? String(row.actor) : null,
        metaJson: row.metaJson ? String(row.metaJson) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
      },
    });
  }

  for (const row of purchaseStatusHistory) {
    if (!row || typeof row !== 'object') continue;
    const purchaseCode = String(row.purchaseCode || '').trim();
    if (!purchaseCode) continue;
    await prisma.purchaseStatusHistory.create({
      data: {
        purchaseCode,
        fromStatus: row.fromStatus ? String(row.fromStatus) : null,
        toStatus: String(row.toStatus || 'pending'),
        reason: row.reason ? String(row.reason) : null,
        actor: row.actor ? String(row.actor) : null,
        metaJson: row.metaJson ? String(row.metaJson) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
      },
    });
  }

  for (const row of playerAccounts) {
    if (!row || typeof row !== 'object') continue;
    const discordId = String(row.discordId || '').trim();
    if (!discordId) continue;
    await prisma.playerAccount.create({
      data: {
        discordId,
        username: row.username ? String(row.username) : null,
        displayName: row.displayName ? String(row.displayName) : null,
        avatarUrl: row.avatarUrl ? String(row.avatarUrl) : null,
        steamId: row.steamId ? String(row.steamId) : null,
        isActive: row.isActive !== false,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }

  for (const row of platformTenants) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    const slug = String(row.slug || '').trim();
    const name = String(row.name || '').trim();
    if (!id || !slug || !name) continue;
    await prisma.platformTenant.create({
      data: {
        id,
        slug,
        name,
        type: row.type ? String(row.type) : 'direct',
        status: row.status ? String(row.status) : 'active',
        locale: row.locale ? String(row.locale) : 'th',
        ownerName: row.ownerName ? String(row.ownerName) : null,
        ownerEmail: row.ownerEmail ? String(row.ownerEmail) : null,
        parentTenantId: row.parentTenantId ? String(row.parentTenantId) : null,
        metadataJson: row.metadataJson ? String(row.metadataJson) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }

  for (const row of platformSubscriptions) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    const tenantId = String(row.tenantId || '').trim();
    const planId = String(row.planId || '').trim();
    if (!id || !tenantId || !planId) continue;
    await prisma.platformSubscription.create({
      data: {
        id,
        tenantId,
        planId,
        billingCycle: row.billingCycle ? String(row.billingCycle) : 'monthly',
        status: row.status ? String(row.status) : 'active',
        currency: row.currency ? String(row.currency) : 'THB',
        amountCents: Number(row.amountCents || 0),
        startedAt: row.startedAt ? new Date(row.startedAt) : new Date(),
        renewsAt: row.renewsAt ? new Date(row.renewsAt) : null,
        canceledAt: row.canceledAt ? new Date(row.canceledAt) : null,
        externalRef: row.externalRef ? String(row.externalRef) : null,
        metadataJson: row.metadataJson ? String(row.metadataJson) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }

  for (const row of platformLicenses) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    const tenantId = String(row.tenantId || '').trim();
    const licenseKey = String(row.licenseKey || '').trim();
    if (!id || !tenantId || !licenseKey) continue;
    await prisma.platformLicense.create({
      data: {
        id,
        tenantId,
        licenseKey,
        status: row.status ? String(row.status) : 'active',
        seats: Number(row.seats || 1),
        issuedAt: row.issuedAt ? new Date(row.issuedAt) : new Date(),
        expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
        legalDocVersion: row.legalDocVersion ? String(row.legalDocVersion) : null,
        legalAcceptedAt: row.legalAcceptedAt ? new Date(row.legalAcceptedAt) : null,
        metadataJson: row.metadataJson ? String(row.metadataJson) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }

  for (const row of platformApiKeys) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    const tenantId = String(row.tenantId || '').trim();
    const name = String(row.name || '').trim();
    const keyPrefix = String(row.keyPrefix || '').trim();
    const keyHash = String(row.keyHash || '').trim();
    if (!id || !tenantId || !name || !keyPrefix || !keyHash) continue;
    await prisma.platformApiKey.create({
      data: {
        id,
        tenantId,
        name,
        keyPrefix,
        keyHash,
        scopesJson: row.scopesJson ? String(row.scopesJson) : '[]',
        status: row.status ? String(row.status) : 'active',
        lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : null,
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }

  for (const row of platformWebhookEndpoints) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    const tenantId = String(row.tenantId || '').trim();
    const name = String(row.name || '').trim();
    const eventType = String(row.eventType || '').trim();
    const targetUrl = String(row.targetUrl || '').trim();
    const secretValue = String(row.secretValue || '').trim();
    if (!id || !tenantId || !name || !eventType || !targetUrl || !secretValue) continue;
    await prisma.platformWebhookEndpoint.create({
      data: {
        id,
        tenantId,
        name,
        eventType,
        targetUrl,
        secretValue,
        enabled: row.enabled !== false,
        lastSuccessAt: row.lastSuccessAt ? new Date(row.lastSuccessAt) : null,
        lastFailureAt: row.lastFailureAt ? new Date(row.lastFailureAt) : null,
        lastError: row.lastError ? String(row.lastError) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }

  for (const row of platformAgentRuntimes) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    const tenantId = String(row.tenantId || '').trim();
    const runtimeKey = String(row.runtimeKey || '').trim();
    const version = String(row.version || '').trim();
    if (!id || !tenantId || !runtimeKey || !version) continue;
    await prisma.platformAgentRuntime.create({
      data: {
        id,
        tenantId,
        runtimeKey,
        channel: row.channel ? String(row.channel) : null,
        version,
        minRequiredVersion: row.minRequiredVersion ? String(row.minRequiredVersion) : null,
        status: row.status ? String(row.status) : 'online',
        lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : new Date(),
        metaJson: row.metaJson ? String(row.metaJson) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }

  for (const row of platformMarketplaceOffers) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '').trim();
    const tenantId = String(row.tenantId || '').trim();
    const title = String(row.title || '').trim();
    if (!id || !tenantId || !title) continue;
    await prisma.platformMarketplaceOffer.create({
      data: {
        id,
        tenantId,
        title,
        kind: row.kind ? String(row.kind) : 'service',
        priceCents: Number(row.priceCents || 0),
        currency: row.currency ? String(row.currency) : 'THB',
        status: row.status ? String(row.status) : 'active',
        locale: row.locale ? String(row.locale) : 'th',
        metaJson: row.metaJson ? String(row.metaJson) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      },
    });
  }
}

// Restore applies DB-backed entities first, then file-backed/runtime stores, so the
// admin surface can fall back to a coherent snapshot instead of a half-restored mix.
async function restoreAdminSnapshotData(snapshot = {}) {
  await replacePrismaTablesFromSnapshot(snapshot);

  replaceTickets(
    Array.isArray(snapshot.tickets) ? snapshot.tickets : [],
    Number(snapshot.ticketCounter || 0) || null,
  );
  replaceBounties(Array.isArray(snapshot.bounties) ? snapshot.bounties : []);
  replaceEvents(
    Array.isArray(snapshot.events) ? snapshot.events : [],
    Array.isArray(snapshot.events)
      ? snapshot.events.map((eventRow) => ({
          eventId: eventRow?.id,
          participants: Array.isArray(eventRow?.participants)
            ? eventRow.participants
            : [],
        }))
      : [],
    Number(snapshot.eventCounter || 0) || null,
  );
  replaceLinks(Array.isArray(snapshot.links) ? snapshot.links : []);
  replaceMemberships(Array.isArray(snapshot.memberships) ? snapshot.memberships : []);
  replaceWeaponStats(Array.isArray(snapshot.weaponStats) ? snapshot.weaponStats : []);
  replaceStats(Array.isArray(snapshot.stats) ? snapshot.stats : []);
  replaceGiveaways(Array.isArray(snapshot.giveaways) ? snapshot.giveaways : []);
  replacePunishments(Array.isArray(snapshot.punishments) ? snapshot.punishments : []);
  replaceCodes(Array.isArray(snapshot.redeemCodes) ? snapshot.redeemCodes : []);
  replaceClaims(Array.isArray(snapshot.welcomeClaims) ? snapshot.welcomeClaims : []);
  replaceTopPanels(Array.isArray(snapshot.topPanels) ? snapshot.topPanels : []);
  replaceCarts(Array.isArray(snapshot.carts) ? snapshot.carts : []);
  replaceStatus(snapshot.status || {});
  replaceDeliveryAudit(Array.isArray(snapshot.deliveryAudit) ? snapshot.deliveryAudit : []);
  replaceAdminNotifications(
    Array.isArray(snapshot.adminNotifications) ? snapshot.adminNotifications : [],
  );
  replaceAdminSecurityEvents(
    Array.isArray(snapshot.adminSecurityEvents) ? snapshot.adminSecurityEvents : [],
  );
  replaceAdminCommandCapabilityPresets(
    Array.isArray(snapshot.adminCommandCapabilityPresets)
      ? snapshot.adminCommandCapabilityPresets
      : [],
  );
  replaceDeliveryQueue(Array.isArray(snapshot.deliveryQueue) ? snapshot.deliveryQueue : []);
  replaceDeliveryDeadLetters(
    Array.isArray(snapshot.deliveryDeadLetters) ? snapshot.deliveryDeadLetters : [],
  );
  await replaceRentBikeData(
    Array.isArray(snapshot.dailyRents) ? snapshot.dailyRents : [],
    Array.isArray(snapshot.rentalVehicles) ? snapshot.rentalVehicles : [],
  );
  await replaceLuckyWheelStates(
    Array.isArray(snapshot.luckyWheelStates) ? snapshot.luckyWheelStates : [],
  );
  await replacePartyMessages(
    Array.isArray(snapshot.partyChatMessages) ? snapshot.partyChatMessages : [],
  );

  // Most tenant-aware stores persist through async write queues; restore should only
  // report success after those queues drain or surface an error.
  await Promise.all([
    flushTicketStoreWrites(),
    flushBountyStoreWrites(),
    flushEventStoreWrites(),
    flushLinkStoreWrites(),
    flushVipStoreWrites(),
    flushWeaponStatsStoreWrites(),
    flushStatsStoreWrites(),
    flushGiveawayStoreWrites(),
    flushModerationStoreWrites(),
    flushRedeemStoreWrites(),
    flushWelcomePackStoreWrites(),
    flushTopPanelStoreWrites(),
    flushCartStoreWrites(),
    flushScumStoreWrites(),
    flushDeliveryAuditStoreWrites(),
    flushDeliveryPersistenceWrites(),
  ]);

  if (snapshot.config && typeof config.setFullConfig === 'function') {
    config.setFullConfig(snapshot.config);
  }
}

function buildRestoreCounts(snapshot = {}) {
  return {
    wallets: Array.isArray(snapshot.wallets) ? snapshot.wallets.length : 0,
    walletLedgers: Array.isArray(snapshot.walletLedgers)
      ? snapshot.walletLedgers.length
      : 0,
    shopItems: Array.isArray(snapshot.shopItems) ? snapshot.shopItems.length : 0,
    purchases: Array.isArray(snapshot.purchases) ? snapshot.purchases.length : 0,
    purchaseStatusHistory: Array.isArray(snapshot.purchaseStatusHistory)
      ? snapshot.purchaseStatusHistory.length
      : 0,
    playerAccounts: Array.isArray(snapshot.playerAccounts)
      ? snapshot.playerAccounts.length
      : 0,
    tickets: Array.isArray(snapshot.tickets) ? snapshot.tickets.length : 0,
    bounties: Array.isArray(snapshot.bounties) ? snapshot.bounties.length : 0,
    events: Array.isArray(snapshot.events) ? snapshot.events.length : 0,
    links: Array.isArray(snapshot.links) ? snapshot.links.length : 0,
    memberships: Array.isArray(snapshot.memberships) ? snapshot.memberships.length : 0,
    weaponStats: Array.isArray(snapshot.weaponStats) ? snapshot.weaponStats.length : 0,
    stats: Array.isArray(snapshot.stats) ? snapshot.stats.length : 0,
    giveaways: Array.isArray(snapshot.giveaways) ? snapshot.giveaways.length : 0,
    punishments: Array.isArray(snapshot.punishments) ? snapshot.punishments.length : 0,
    redeemCodes: Array.isArray(snapshot.redeemCodes) ? snapshot.redeemCodes.length : 0,
    welcomeClaims: Array.isArray(snapshot.welcomeClaims) ? snapshot.welcomeClaims.length : 0,
    carts: Array.isArray(snapshot.carts) ? snapshot.carts.length : 0,
    topPanels: Array.isArray(snapshot.topPanels) ? snapshot.topPanels.length : 0,
    dailyRents: Array.isArray(snapshot.dailyRents) ? snapshot.dailyRents.length : 0,
    rentalVehicles: Array.isArray(snapshot.rentalVehicles)
      ? snapshot.rentalVehicles.length
      : 0,
    luckyWheelStates: Array.isArray(snapshot.luckyWheelStates)
      ? snapshot.luckyWheelStates.length
      : 0,
    partyChatMessages: Array.isArray(snapshot.partyChatMessages)
      ? snapshot.partyChatMessages.length
      : 0,
    deliveryQueue: Array.isArray(snapshot.deliveryQueue) ? snapshot.deliveryQueue.length : 0,
    deliveryDeadLetters: Array.isArray(snapshot.deliveryDeadLetters)
      ? snapshot.deliveryDeadLetters.length
      : 0,
    deliveryAudit: Array.isArray(snapshot.deliveryAudit) ? snapshot.deliveryAudit.length : 0,
    adminNotifications: Array.isArray(snapshot.adminNotifications)
      ? snapshot.adminNotifications.length
      : 0,
    adminSecurityEvents: Array.isArray(snapshot.adminSecurityEvents)
      ? snapshot.adminSecurityEvents.length
      : 0,
    adminCommandCapabilityPresets: Array.isArray(snapshot.adminCommandCapabilityPresets)
      ? snapshot.adminCommandCapabilityPresets.length
      : 0,
  };
}

function buildRestoreWarnings(targetSnapshot = {}, currentSnapshot = {}) {
  const warnings = [];
  if (targetSnapshot.config && currentSnapshot.config) {
    try {
      if (JSON.stringify(targetSnapshot.config) !== JSON.stringify(currentSnapshot.config)) {
        warnings.push('config-will-be-restored');
      }
    } catch {
      warnings.push('config-will-be-restored');
    }
  }
  if (Array.isArray(targetSnapshot.deliveryQueue) && targetSnapshot.deliveryQueue.length > 0) {
    warnings.push('delivery-queue-will-be-replaced');
  }
  if (
    Array.isArray(targetSnapshot.deliveryDeadLetters)
    && targetSnapshot.deliveryDeadLetters.length > 0
  ) {
    warnings.push('delivery-dead-letter-will-be-replaced');
  }
  if (Array.isArray(targetSnapshot.wallets) && targetSnapshot.wallets.length > 0) {
    warnings.push('wallet-balances-will-be-restored');
  }
  if (Array.isArray(targetSnapshot.purchases) && targetSnapshot.purchases.length > 0) {
    warnings.push('purchase-history-will-be-restored');
  }
  return warnings;
}

function buildRestoreDiff(currentSnapshot = {}, targetSnapshot = {}) {
  const currentCounts = buildRestoreCounts(currentSnapshot);
  const targetCounts = buildRestoreCounts(targetSnapshot);
  const countKeys = Array.from(
    new Set([...Object.keys(currentCounts), ...Object.keys(targetCounts)]),
  ).sort();
  const counts = {};
  let changedCollections = 0;

  for (const key of countKeys) {
    const current = Number(currentCounts[key] || 0);
    const target = Number(targetCounts[key] || 0);
    const delta = target - current;
    const changed = current !== target;
    if (changed) changedCollections += 1;
    counts[key] = {
      current,
      target,
      delta,
      changed,
    };
  }

  return {
    currentCounts,
    targetCounts,
    counts,
    summary: {
      changedCollections,
      currentCollections: countKeys.length,
      targetCollections: countKeys.length,
    },
    warnings: buildRestoreWarnings(targetSnapshot, currentSnapshot),
  };
}

function compareRestoreConfig(targetConfig, restoredConfig) {
  const targetPresent =
    targetConfig && typeof targetConfig === 'object' && !Array.isArray(targetConfig);
  const restoredPresent =
    restoredConfig && typeof restoredConfig === 'object' && !Array.isArray(restoredConfig);
  if (!targetPresent && !restoredPresent) return true;
  if (!targetPresent || !restoredPresent) return false;
  try {
    return JSON.stringify(targetConfig, jsonReplacer) === JSON.stringify(restoredConfig, jsonReplacer);
  } catch {
    return false;
  }
}

function buildRestoreVerificationPlan(targetSnapshot = {}, options = {}) {
  const warnings = Array.isArray(options.warnings) ? options.warnings.filter(Boolean) : [];
  const expectedCounts = options.expectedCounts || buildRestoreCounts(targetSnapshot);
  return {
    expectedCounts,
    warnings,
    checks: [
      {
        id: 'collections-match',
        label: 'Rebuild an admin snapshot and compare collection counts with the backup',
      },
      {
        id: 'config-match',
        label: 'Compare the active runtime config against the backup snapshot',
      },
      {
        id: 'rollback-backup-created',
        label: 'Confirm a rollback backup exists before destructive restore writes run',
      },
    ],
  };
}

function buildRestoreVerification(targetSnapshot = {}, restoredSnapshot = {}, options = {}) {
  const diff = buildRestoreDiff(restoredSnapshot, targetSnapshot);
  const mismatchedCollections = Object.entries(diff.counts || {})
    .filter(([, row]) => row?.changed === true)
    .map(([key]) => key)
    .sort();
  const countsMatch = mismatchedCollections.length === 0;
  const configMatch = compareRestoreConfig(targetSnapshot.config, restoredSnapshot.config);
  const rollbackBackupCreated = String(options.rollbackBackup || '').trim().length > 0;
  const checks = [
    {
      id: 'collections-match',
      label: 'Collection counts match the backup snapshot',
      ok: countsMatch,
      detail: countsMatch
        ? 'All tracked collection counts match the backup snapshot'
        : `Mismatched collections: ${mismatchedCollections.join(', ')}`,
    },
    {
      id: 'config-match',
      label: 'Runtime config matches the backup snapshot',
      ok: configMatch,
      detail: configMatch
        ? 'Runtime config matches the backup snapshot'
        : 'Runtime config differs from the backup snapshot',
    },
    {
      id: 'rollback-backup-created',
      label: 'Rollback backup was created before restore writes',
      ok: rollbackBackupCreated,
      detail: rollbackBackupCreated
        ? `Rollback backup ${options.rollbackBackup} is available`
        : 'Rollback backup was not created',
    },
  ];
  return {
    checkedAt: new Date().toISOString(),
    ready: checks.every((check) => check.ok === true),
    countsMatch,
    configMatch,
    rollbackBackupCreated,
    checks,
    summary: {
      changedCollections: Number(diff.summary?.changedCollections || 0),
      mismatchedCollections,
    },
  };
}

async function buildRestorePreviewData(loaded, options = {}) {
  const normalizedPayload = normalizeAdminBackupPayload(loaded?.payload);
  const snapshot = normalizedPayload.snapshot;
  const currentSnapshot = options.currentSnapshot || await buildAdminSnapshot({
    client: options.client || null,
    observabilitySnapshot: options.observabilitySnapshot || null,
  });
  const diff = buildRestoreDiff(currentSnapshot, snapshot);
  const warnings = [...(diff.warnings || [])];
  if (normalizedPayload.schemaVersion === LEGACY_BACKUP_SCHEMA_VERSION) {
    warnings.push(`legacy-backup-schema:${normalizedPayload.compatibilityMode}`);
  }
  const verificationPlan = buildRestoreVerificationPlan(snapshot, {
    warnings,
    expectedCounts: diff.targetCounts,
  });
  const previewState =
    options.issuePreviewToken === true
      ? issueRestorePreviewState(loaded.file)
      : getAdminRestoreState();
  return {
    dryRun: true,
    backup: loaded.file,
    schemaVersion: normalizedPayload.schemaVersion,
    compatibilityMode: normalizedPayload.compatibilityMode,
    backupCreatedAt: normalizedPayload.createdAt || null,
    backupCreatedBy: normalizedPayload.createdBy || null,
    note: normalizedPayload.note || null,
    confirmBackup: loaded.file,
    counts: diff.targetCounts,
    currentCounts: diff.currentCounts,
    diff,
    warnings,
    verificationPlan,
    previewToken: previewState.previewToken || null,
    previewIssuedAt: previewState.previewIssuedAt || null,
    previewExpiresAt: previewState.previewExpiresAt || null,
    restoreState: getAdminRestoreState(),
  };
}

function createRestoreOperationId() {
  return `restore-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

// Snapshots intentionally capture both business data and operator-facing runtime state
// so restore previews can show the blast radius before anything mutates.
async function buildAdminSnapshot(options = {}) {
  assertGlobalSnapshotOperation(options);
  const {
    client = null,
    observabilitySnapshot = null,
    includePlatformSecrets = false,
  } = options;
  await flushSnapshotStoreState();
  const [
    shopItems,
    wallets,
    purchases,
    walletLedgers,
    purchaseStatusHistory,
    playerAccounts,
    dailyRents,
    rentalVehicles,
    luckyWheelStates,
    partyChatMessages,
    deliveryRuntime,
    runtimeSupervisor,
    platformTenants,
    platformSubscriptions,
    platformLicenses,
    platformApiKeys,
    platformWebhookEndpoints,
    platformAgentRuntimes,
    platformMarketplaceOffers,
  ] = await Promise.all([
    listShopItems(),
    prisma.userWallet.findMany({
      orderBy: { balance: 'desc' },
      take: 500,
    }),
    prisma.purchase.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.walletLedger.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2000,
    }),
    prisma.purchaseStatusHistory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2000,
    }),
    prisma.playerAccount.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    }),
    listDailyRents(1000),
    listRentalVehicles(1000),
    listLuckyWheelStates(2000),
    listAllPartyMessages(5000),
    getDeliveryRuntimeStatus().catch(() => null),
    getRuntimeSupervisorSnapshot().catch(() => null),
    includePlatformSecrets
      ? prisma.platformTenant.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })
      : listPlatformTenants({ limit: 500 }),
    includePlatformSecrets
      ? prisma.platformSubscription.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })
      : listPlatformSubscriptions({ limit: 500, allowGlobal: true }),
    includePlatformSecrets
      ? prisma.platformLicense.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })
      : listPlatformLicenses({ limit: 500, allowGlobal: true }),
    includePlatformSecrets
      ? prisma.platformApiKey.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })
      : listPlatformApiKeys({ limit: 500, allowGlobal: true }),
    includePlatformSecrets
      ? prisma.platformWebhookEndpoint.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })
      : listPlatformWebhookEndpoints({ limit: 500, allowGlobal: true }),
    includePlatformSecrets
      ? prisma.platformAgentRuntime.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })
      : listPlatformAgentRuntimes({ limit: 500, allowGlobal: true }),
    includePlatformSecrets
      ? prisma.platformMarketplaceOffer.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })
      : listMarketplaceOffers({ limit: 500, allowGlobal: true }),
  ]);

  const shopItemsWithIcon = shopItems.map((item) => ({
    ...item,
    resolvedIconUrl: resolveItemIconUrl(item),
  }));

  const guildCache = client?.guilds?.cache;
  const guilds = guildCache
    ? Array.from(guildCache.values()).map((guild) => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        channelsCount: guild.channels?.cache?.size || 0,
        rolesCount: guild.roles?.cache?.size || 0,
      }))
    : [];

  return {
    generatedAt: new Date().toISOString(),
    guilds,
    status: getStatus(),
    persistence: getPersistenceStatus(),
    wallets: wallets.map(normalizeWallet),
    walletLedgers,
    shopItems: shopItemsWithIcon,
    purchases,
    purchaseStatusHistory,
    playerAccounts,
    tickets: normalizeTickets(),
    bounties: listBounties(),
    events: normalizeEvents(),
    links: listLinks(),
    memberships: listMemberships(),
    weaponStats: listWeaponStats(),
    stats: listAllStats(),
    giveaways: normalizeGiveaways(),
    punishments: listAllPunishments(),
    redeemCodes: listCodes(),
    welcomeClaims: listClaimed(),
    dailyRents,
    rentalVehicles,
    luckyWheelStates,
    partyChatMessages,
    rentBikeRuntime: getRentBikeRuntime(),
    deliveryRuntime,
    runtimeSupervisor,
    platformTenants,
    platformSubscriptions,
    platformLicenses,
    platformApiKeys,
    platformWebhookEndpoints,
    platformAgentRuntimes,
    platformMarketplaceOffers,
    platformOpsState: getPlatformOpsState(),
    backupRestore: getAdminRestoreState(),
    deliveryQueue: listDeliveryQueue(500),
    deliveryDeadLetters: listDeliveryDeadLetters(1000),
    deliveryAudit: listDeliveryAudit(1000),
    adminNotifications: listAdminNotifications({ limit: 300 }),
    adminSecurityEvents: listAdminSecurityEvents({ limit: 300 }),
    adminRequestLogs: listAdminRequestLogs({ limit: 300 }),
    adminCommandCapabilityPresets: listAdminCommandCapabilityPresets(300),
    observability: observabilitySnapshot || {},
    backups: listAdminBackupFiles().slice(0, 50),
    topPanels: listTopPanels(),
    carts: listAllCarts(),
    config: normalizeConfig(),
  };
}

async function createAdminBackup(options = {}) {
  assertGlobalSnapshotOperation(options);
  const {
    client = null,
    actor = 'unknown',
    role = 'unknown',
    note = null,
    includeSnapshot = true,
    observabilitySnapshot = null,
  } = options;
  const snapshot = includeSnapshot
    ? await buildAdminSnapshot({
      client,
      observabilitySnapshot,
      includePlatformSecrets: true,
    })
    : {};
  const payload = buildBackupPayload({
    actor,
    role,
    note,
    snapshot,
  });
  const saved = saveBackupPayload(payload);
  return {
    ...saved,
    note,
  };
}

async function previewAdminBackupRestore(backupName, options = {}) {
  assertGlobalSnapshotOperation(options);
  const loaded = readBackupPayloadByName(backupName);
  return buildRestorePreviewData(loaded, {
    ...options,
    issuePreviewToken: options.issuePreviewToken !== false,
  });
}

function matchesRestoreConfirmation(input, backupFile) {
  const actual = String(input || '').trim();
  const expected = String(backupFile || '').trim();
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  const expectedBase = expected.replace(/\.json$/i, '');
  return actual === expectedBase;
}

// Restore runs under maintenance mode with rollback backup creation so operators have
// a reversible path when a snapshot turns out to be wrong for the target environment.
async function restoreAdminBackup(backupName, options = {}) {
  assertGlobalSnapshotOperation(options);
  const loaded = readBackupPayloadByName(backupName);
  const normalizedPayload = normalizeAdminBackupPayload(loaded?.payload);
  const snapshot = normalizedPayload.snapshot;

  const confirmBackup = String(options.confirmBackup || '').trim();
  if (!matchesRestoreConfirmation(confirmBackup, loaded.file)) {
    throw createRestoreError('confirmBackup must match the backup filename', 400, {
      expectedConfirmBackup: loaded.file,
    });
  }
  validateRestorePreviewState(loaded.file, options.previewToken);

  const lock = acquireRuntimeLock(RESTORE_LOCK_NAME, 'admin-backup-restore');
  if (!lock.ok) {
    throw createRestoreError('A backup restore is already in progress', 409, {
      reason: lock.reason || 'already-locked',
      lock: lock.data || null,
      restoreState: getAdminRestoreState(),
    });
  }

  const startedAt = new Date().toISOString();
  const operationId = createRestoreOperationId();
  const actor = String(options.actor || 'unknown').trim() || 'unknown';
  const role = String(options.role || 'unknown').trim() || 'unknown';

  let currentSnapshot = null;
  let rollbackBackup = null;
  let restoreStarted = false;
  let preview = null;
  let verification = null;

  setAdminRestoreState({
    status: 'running',
    active: true,
    maintenance: true,
    operationId,
    backup: loaded.file,
    confirmBackup: loaded.file,
    rollbackBackup: null,
    actor,
    role,
    note: normalizedPayload.note || null,
    startedAt,
    endedAt: null,
    updatedAt: startedAt,
    lastCompletedAt: null,
    durationMs: null,
    lastError: null,
    rollbackStatus: 'pending',
    rollbackError: null,
    counts: null,
    currentCounts: null,
    diff: null,
    warnings: [],
    verification: null,
    previewToken: null,
    previewBackup: null,
    previewIssuedAt: null,
    previewExpiresAt: null,
  });

  try {
    currentSnapshot = await buildAdminSnapshot({
      client: options.client || null,
      observabilitySnapshot: options.observabilitySnapshot || null,
    });
    preview = await buildRestorePreviewData(loaded, {
      ...options,
      currentSnapshot,
    });

    const rollbackPayload = buildBackupPayload({
      actor,
      role,
      note: `auto-rollback-before-restore:${loaded.file}`,
      snapshot: currentSnapshot,
      meta: {
        type: 'auto-rollback-backup',
        sourceBackup: loaded.file,
        operationId,
      },
    });
    rollbackBackup = saveBackupPayload(rollbackPayload).file;

    const runningState = setAdminRestoreState({
      status: 'running',
      active: true,
      maintenance: true,
      operationId,
      backup: loaded.file,
      confirmBackup: loaded.file,
      rollbackBackup,
      actor,
      role,
      note: loaded?.payload?.note || null,
      startedAt,
      endedAt: null,
      updatedAt: new Date().toISOString(),
      lastCompletedAt: null,
      durationMs: null,
      lastError: null,
      rollbackStatus: 'pending',
      rollbackError: null,
      counts: preview.targetCounts,
      currentCounts: preview.currentCounts,
      diff: preview.diff,
      warnings: preview.warnings,
      verification: null,
      previewToken: null,
      previewBackup: null,
      previewIssuedAt: null,
      previewExpiresAt: null,
    });

    publishAdminLiveUpdate('backup-restore-started', {
      backup: loaded.file,
      rollbackBackup,
      actor,
      role,
      operationId,
      warnings: runningState.warnings,
    });

    restoreStarted = true;
    await restoreAdminSnapshotData(snapshot);
    const restoredSnapshot = await buildAdminSnapshot({
      client: options.client || null,
      observabilitySnapshot: options.observabilitySnapshot || null,
    });
    verification = buildRestoreVerification(snapshot, restoredSnapshot, {
      rollbackBackup,
    });
    if (!verification.ready) {
      throw createRestoreError('Backup restore verification failed', 500, {
        verification,
      });
    }

    const endedAt = new Date().toISOString();
    const durationMs = Math.max(0, new Date(endedAt) - new Date(startedAt));
    setAdminRestoreState({
      status: 'succeeded',
      active: false,
      maintenance: false,
      operationId,
      backup: loaded.file,
      confirmBackup: loaded.file,
      rollbackBackup,
      actor,
      role,
      note: loaded?.payload?.note || null,
      startedAt,
      endedAt,
      updatedAt: endedAt,
      lastCompletedAt: endedAt,
      durationMs,
      lastError: null,
      rollbackStatus: 'not-needed',
      rollbackError: null,
      counts: preview.targetCounts,
      currentCounts: preview.currentCounts,
      diff: preview.diff,
      warnings: preview.warnings,
      verification,
      previewToken: null,
      previewBackup: null,
      previewIssuedAt: null,
      previewExpiresAt: null,
    });

    publishAdminLiveUpdate('backup-restore', {
      backup: loaded.file,
      rollbackBackup,
      actor,
      role,
      operationId,
      durationMs,
      verification,
    });

    return {
      restored: true,
      backup: loaded.file,
      rollbackBackup,
      startedAt,
      endedAt,
      durationMs,
      counts: preview.targetCounts,
      currentCounts: preview.currentCounts,
      diff: preview.diff,
      warnings: preview.warnings,
      verification,
    };
  } catch (error) {
    let rollbackStatus = restoreStarted ? 'failed' : 'not-needed';
    let rollbackError = null;

    if (restoreStarted && currentSnapshot) {
      try {
        await restoreAdminSnapshotData(currentSnapshot);
        rollbackStatus = 'succeeded';
        publishAdminLiveUpdate('backup-restore-rollback', {
          backup: loaded.file,
          rollbackBackup,
          actor,
          role,
          operationId,
        });
      } catch (rollbackFailure) {
        rollbackStatus = 'failed';
        rollbackError = String(rollbackFailure?.message || rollbackFailure);
        publishAdminLiveUpdate('backup-restore-rollback-failed', {
          backup: loaded.file,
          rollbackBackup,
          actor,
          role,
          operationId,
          error: rollbackError,
        });
      }
    }

    const endedAt = new Date().toISOString();
    const durationMs = Math.max(0, new Date(endedAt) - new Date(startedAt));
    const failedState = setAdminRestoreState({
      status: 'failed',
      active: false,
      maintenance: false,
      operationId,
      backup: loaded.file,
      confirmBackup: loaded.file,
      rollbackBackup,
      actor,
      role,
      note: loaded?.payload?.note || null,
      startedAt,
      endedAt,
      updatedAt: endedAt,
      lastCompletedAt: endedAt,
      durationMs,
      lastError: String(error?.message || error),
      rollbackStatus,
      rollbackError,
      counts: preview?.targetCounts || null,
      currentCounts: preview?.currentCounts || null,
      diff: preview?.diff || null,
      warnings: preview?.warnings || [],
      verification,
      previewToken: null,
      previewBackup: null,
      previewIssuedAt: null,
      previewExpiresAt: null,
    });

    publishAdminLiveUpdate('backup-restore-failed', {
      backup: loaded.file,
      rollbackBackup,
      actor,
      role,
      operationId,
      durationMs,
      rollbackStatus,
      error: failedState.lastError,
    });

    throw createRestoreError('Backup restore failed', 500, {
      restore: failedState,
    });
  } finally {
    releaseRuntimeLock(RESTORE_LOCK_NAME);
  }
}

module.exports = {
  buildAdminSnapshot,
  createAdminBackup,
  getAdminRestoreState,
  jsonReplacer,
  listAdminBackupFiles,
  normalizeAdminBackupPayload,
  previewAdminBackupRestore,
  restoreAdminBackup,
  restoreAdminSnapshotData,
};
