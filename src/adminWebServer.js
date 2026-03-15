const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { URL } = require('node:url');

const config = require('./config');
const { prisma } = require('./prisma');
const {
  listShopItems,
  listUserPurchases,
  listKnownPurchaseStatuses,
} = require('./store/memoryStore');
const {
  normalizePurchaseStatus,
  listAllowedPurchaseTransitions,
} = require('./services/purchaseStateMachine');
const { listEvents, getParticipants } = require('./store/eventStore');
const {
  createServerEvent,
  joinServerEvent,
  startServerEvent,
  finishServerEvent,
} = require('./services/eventService');
const { getStatus } = require('./store/scumStore');
const {
  upsertPlayerAccount,
  bindPlayerSteamId,
  unbindPlayerSteamId,
  getPlayerDashboard,
  listPlayerAccounts,
} = require('./store/playerAccountStore');
const {
  getRentBikeRuntime,
  runRentBikeMidnightReset,
} = require('./services/rentBikeService');
const {
  enqueuePurchaseDeliveryByCode,
  listDeliveryQueue,
  listFilteredDeliveryQueue,
  listFilteredDeliveryDeadLetters,
  retryDeliveryNow,
  retryDeliveryNowMany,
  retryDeliveryDeadLetter,
  retryDeliveryDeadLetterMany,
  removeDeliveryDeadLetter,
  cancelDeliveryJob,
  getDeliveryMetricsSnapshot,
  getDeliveryRuntimeStatus,
  getDeliveryPreflightReport,
  previewDeliveryCommands,
  simulateDeliveryPlan,
  sendTestDeliveryCommand,
  listScumAdminCommandCapabilities,
  testScumAdminCommandCapability,
  getDeliveryCommandOverride,
  setDeliveryCommandOverride,
  getDeliveryDetailsByPurchaseCode,
} = require('./services/rconDelivery');
const {
  queueLeaderboardRefreshForAllGuilds,
} = require('./services/leaderboardPanels');
const {
  adminLiveBus,
  publishAdminLiveUpdate,
} = require('./services/adminLiveBus');
const {
  listAdminNotifications,
  acknowledgeAdminNotifications,
  clearAdminNotifications,
} = require('./store/adminNotificationStore');
const {
  listAdminCommandCapabilityPresets,
  getAdminCommandCapabilityPresetById,
  saveAdminCommandCapabilityPreset,
  deleteAdminCommandCapabilityPreset,
} = require('./store/adminCommandCapabilityPresetStore');
const {
  listItemIconCatalog,
  resolveItemIconUrl,
} = require('./services/itemIconService');
const {
  listWikiWeaponCatalog,
  getWikiWeaponCatalogMeta,
} = require('./services/wikiWeaponCatalog');
const {
  listManifestItemCatalog,
  getManifestItemCatalogMeta,
} = require('./services/wikiItemManifestCatalog');
const {
  redeemCodeForUser,
  requestRentBikeForUser,
  createBountyForUser,
  listActiveBountiesForUser,
  cancelBountyForUser,
  createRedeemCodeForAdmin,
  deleteRedeemCodeForAdmin,
  resetRedeemCodeUsageForAdmin,
} = require('./services/playerOpsService');
const {
  updatePurchaseStatusForActor,
} = require('./services/purchaseService');
const {
  addShopItemForAdmin,
  setShopItemPriceForAdmin,
  deleteShopItemForAdmin,
} = require('./services/shopService');
const {
  creditCoins,
  debitCoins,
  setCoinsExact,
} = require('./services/coinService');
const {
  grantVipForUser,
  revokeVipForUser,
} = require('./services/vipService');
const {
  buildAdminSnapshot,
  createAdminBackup,
  listAdminBackupFiles,
  previewAdminBackupRestore,
  restoreAdminBackup,
  getAdminRestoreState,
} = require('./services/adminSnapshotService');
const {
  buildAuditDataset: buildAuditDatasetService,
  buildAuditExportPayload: buildAuditExportPayloadService,
  buildAuditCsv: buildAuditCsvService,
  listAuditPresets: listAuditPresetsService,
  saveAuditPreset: saveAuditPresetService,
  deleteAuditPreset: deleteAuditPresetService,
} = require('./services/adminAuditService');
const {
  createObservabilitySeriesState,
  clampObservabilityWindowMs,
  parseObservabilitySeriesKeys,
  captureObservabilitySeries,
  listObservabilitySeries,
  buildAdminObservabilitySnapshot,
  buildObservabilityExportPayload,
  buildObservabilityCsv,
} = require('./services/adminObservabilityService');
const {
  buildAdminDashboardCards,
} = require('./services/adminDashboardService');
const {
  getRuntimeSupervisorSnapshot,
  startRuntimeSupervisorMonitor,
  stopRuntimeSupervisorMonitor,
} = require('./services/runtimeSupervisorService');
const {
  acceptPlatformLicenseLegal,
  createMarketplaceOffer,
  createPlatformApiKey,
  createPlatformWebhookEndpoint,
  createSubscription,
  createTenant,
  getPlanCatalog,
  getPlatformAnalyticsOverview,
  getPlatformPermissionCatalog,
  getPlatformPublicOverview,
  getPlatformTenantById,
  issuePlatformLicense,
  listMarketplaceOffers,
  listPlatformAgentRuntimes,
  listPlatformApiKeys,
  listPlatformLicenses,
  listPlatformSubscriptions,
  listPlatformTenants,
  listPlatformWebhookEndpoints,
  recordPlatformAgentHeartbeat,
  reconcileDeliveryState,
  verifyPlatformApiKey,
} = require('./services/platformService');
const {
  runPlatformMonitoringCycle,
  startPlatformMonitoring,
  stopPlatformMonitoring,
} = require('./services/platformMonitoringService');
const { getPlatformOpsState } = require('./store/platformOpsStateStore');
const {
  revokeWelcomePackClaimForAdmin,
  clearWelcomePackClaimsForAdmin,
} = require('./services/welcomePackService');
const {
  claimSupportTicket,
  closeSupportTicket,
} = require('./services/ticketService');
const {
  bindSteamLinkForUser,
  removeSteamLink,
} = require('./services/linkService');
const { createPunishmentEntry } = require('./services/moderationService');
const {
  addKillsForUser,
  addDeathsForUser,
  addPlaytimeForUser,
} = require('./services/statsService');
const { updateScumStatusForAdmin } = require('./services/scumStatusService');
const { getPersistenceStatus } = require('./store/_persist');
const {
  isAdminRestoreMaintenanceActive,
} = require('./store/adminRestoreStateStore');
const { getWebhookMetricsSnapshot } = require('./scumWebhookServer');

const dashboardHtmlPath = path.join(__dirname, 'admin', 'dashboard.html');
const loginHtmlPath = path.join(__dirname, 'admin', 'login.html');
const defaultScumItemsDirPath = path.resolve(process.cwd(), 'scum_items-main');
const scumItemsDirPath = path.resolve(
  String(process.env.SCUM_ITEMS_DIR_PATH || defaultScumItemsDirPath).trim()
    || defaultScumItemsDirPath,
);
let adminServer = null;
let cachedDashboardHtml = null;
let cachedLoginHtml = null;
let resolvedToken = null;
const sessions = new Map();
let adminUsersReadyPromise = null;

const SESSION_COOKIE_NAME =
  String(process.env.ADMIN_WEB_SESSION_COOKIE_NAME || 'scum_admin_session').trim()
    || 'scum_admin_session';
const SESSION_TTL_MS = Math.max(
  10 * 60 * 1000,
  Number(process.env.ADMIN_WEB_SESSION_TTL_HOURS || 12) * 60 * 60 * 1000,
);
const SESSION_COOKIE_PATH = normalizeCookiePath(
  process.env.ADMIN_WEB_SESSION_COOKIE_PATH || '/admin',
  '/admin',
);
const SESSION_COOKIE_SAMESITE = normalizeSameSite(
  process.env.ADMIN_WEB_SESSION_COOKIE_SAMESITE || 'strict',
  'Strict',
);
const SESSION_COOKIE_DOMAIN = normalizeCookieDomain(
  process.env.ADMIN_WEB_SESSION_COOKIE_DOMAIN || '',
);
const ADMIN_WEB_MAX_BODY_BYTES = Math.max(
  8 * 1024,
  Number(process.env.ADMIN_WEB_MAX_BODY_BYTES || 1024 * 1024),
);
const LIVE_HEARTBEAT_MS = Math.max(
  10000,
  Number(process.env.ADMIN_WEB_LIVE_HEARTBEAT_MS || 20000),
);
const SESSION_SECURE_COOKIE = envBool('ADMIN_WEB_SECURE_COOKIE', false);
const ADMIN_WEB_HSTS_ENABLED = envBool(
  'ADMIN_WEB_HSTS_ENABLED',
  SESSION_SECURE_COOKIE,
);
const ADMIN_WEB_HSTS_MAX_AGE_SEC = Math.max(
  300,
  Number(process.env.ADMIN_WEB_HSTS_MAX_AGE_SEC || 31536000),
);
const ADMIN_WEB_TRUST_PROXY = envBool('ADMIN_WEB_TRUST_PROXY', false);
const ADMIN_WEB_ALLOW_TOKEN_QUERY = envBool('ADMIN_WEB_ALLOW_TOKEN_QUERY', false);
const ADMIN_WEB_ENFORCE_ORIGIN_CHECK = envBool(
  'ADMIN_WEB_ENFORCE_ORIGIN_CHECK',
  true,
);
const ADMIN_WEB_ALLOWED_ORIGINS = String(
  process.env.ADMIN_WEB_ALLOWED_ORIGINS || '',
).trim();
const ADMIN_WEB_CSP = String(
  process.env.ADMIN_WEB_CSP ||
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
).trim();
const ADMIN_WEB_USER =
  String(process.env.ADMIN_WEB_USER || 'admin').trim() || 'admin';
const LOGIN_RATE_LIMIT_WINDOW_MS = Math.max(
  10_000,
  Number(process.env.ADMIN_WEB_LOGIN_WINDOW_MS || 60_000),
);
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Math.max(
  3,
  Number(process.env.ADMIN_WEB_LOGIN_MAX_ATTEMPTS || 8),
);
let resolvedLoginPassword = null;
const liveClients = new Set();
let liveHeartbeatTimer = null;
let liveBusBound = false;
let metricsSeriesTimer = null;
const metricsSeries = createObservabilitySeriesState();
const METRICS_SERIES_KEYS = Object.freeze(Object.keys(metricsSeries));
const loginAttemptsByIp = new Map();
const loginFailureEvents = [];
const discordOauthStates = new Map();
let lastLoginSpikeAlertAt = 0;
const LOGIN_SPIKE_WINDOW_MS = Math.max(
  60 * 1000,
  Number(process.env.ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS || 5 * 60 * 1000),
);
const LOGIN_SPIKE_THRESHOLD = Math.max(
  3,
  Number(process.env.ADMIN_WEB_LOGIN_SPIKE_THRESHOLD || 10),
);
const LOGIN_SPIKE_IP_THRESHOLD = Math.max(
  3,
  Number(process.env.ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD || 5),
);
const LOGIN_SPIKE_ALERT_COOLDOWN_MS = Math.max(
  15 * 1000,
  Number(process.env.ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS || 60 * 1000),
);
const ROLE_ORDER = {
  mod: 1,
  admin: 2,
  owner: 3,
};
const ADMIN_WEB_USER_ROLE = normalizeRole(
  process.env.ADMIN_WEB_USER_ROLE || 'owner',
);

function shouldBypassRestoreMaintenance(pathname) {
  const pathValue = String(pathname || '').trim();
  return (
    pathValue === '/admin/api/login'
    || pathValue === '/admin/api/logout'
    || pathValue === '/admin/api/backup/restore'
  );
}

function sendRestoreMaintenanceUnavailable(res) {
  return sendJson(res, 503, {
    ok: false,
    error: 'Backup restore is in progress',
    data: {
      restore: getAdminRestoreState(),
    },
  });
}
const ADMIN_WEB_TOKEN_ROLE = normalizeRole(
  process.env.ADMIN_WEB_TOKEN_ROLE || 'owner',
);
const ADMIN_WEB_USERS_JSON = String(process.env.ADMIN_WEB_USERS_JSON || '').trim();
const ADMIN_WEB_2FA_ENABLED = envBool('ADMIN_WEB_2FA_ENABLED', false);
const ADMIN_WEB_2FA_SECRET = String(process.env.ADMIN_WEB_2FA_SECRET || '').trim();
const ADMIN_WEB_2FA_ACTIVE = ADMIN_WEB_2FA_ENABLED && ADMIN_WEB_2FA_SECRET.length > 0;
const ADMIN_WEB_2FA_WINDOW_STEPS = Math.max(
  0,
  Number(process.env.ADMIN_WEB_2FA_WINDOW_STEPS || 1),
);
const SSO_DISCORD_ENABLED = envBool('ADMIN_WEB_SSO_DISCORD_ENABLED', false);
const SSO_DISCORD_CLIENT_ID = String(
  process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_ID || '',
).trim();
const SSO_DISCORD_CLIENT_SECRET = String(
  process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET || '',
).trim();
const SSO_DISCORD_ACTIVE =
  SSO_DISCORD_ENABLED &&
  SSO_DISCORD_CLIENT_ID.length > 0 &&
  SSO_DISCORD_CLIENT_SECRET.length > 0;
const SSO_DISCORD_REDIRECT_URI = String(
  process.env.ADMIN_WEB_SSO_DISCORD_REDIRECT_URI || '',
).trim();
const SSO_DISCORD_GUILD_ID = String(
  process.env.ADMIN_WEB_SSO_DISCORD_GUILD_ID || '',
).trim();
const SSO_DISCORD_DEFAULT_ROLE = normalizeRole(
  process.env.ADMIN_WEB_SSO_DEFAULT_ROLE || 'mod',
);
const SSO_STATE_TTL_MS = Math.max(
  60 * 1000,
  Number(process.env.ADMIN_WEB_SSO_STATE_TTL_MS || 10 * 60 * 1000),
);
const METRICS_SERIES_INTERVAL_MS = Math.max(
  2_000,
  Number(process.env.ADMIN_WEB_METRICS_SERIES_INTERVAL_MS || 15_000),
);
const METRICS_SERIES_RETENTION_MS = Math.max(
  10 * 60 * 1000,
  Number(process.env.ADMIN_WEB_METRICS_SERIES_RETENTION_MS || 24 * 60 * 60 * 1000),
);
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const STATIC_ICON_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg']);

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeCookiePath(value, fallback = '/') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (!text.startsWith('/')) return fallback;
  return text;
}

function normalizeSameSite(value, fallback = 'Lax') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'strict') return 'Strict';
  if (raw === 'none') return 'None';
  if (raw === 'lax') return 'Lax';
  return fallback;
}

function normalizeCookieDomain(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/[;\s]/.test(text)) return '';
  return text;
}

function normalizeRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'owner') return 'owner';
  if (raw === 'admin') return 'admin';
  return 'mod';
}

function hasRoleAtLeast(actualRole, requiredRole) {
  const actual = ROLE_ORDER[normalizeRole(actualRole)] || 0;
  const required = ROLE_ORDER[normalizeRole(requiredRole)] || 0;
  return actual >= required;
}

function parseCsvSet(value) {
  const out = new Set();
  for (const item of String(value || '').split(',')) {
    const text = item.trim();
    if (text) out.add(text);
  }
  return out;
}

function decodeBase32(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  if (!clean) return Buffer.alloc(0);
  let bits = '';
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function computeTotp(secretBuffer, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

function verifyTotpCode(secretText, otpInput, windowSteps = 1) {
  const secret = decodeBase32(secretText);
  if (!secret.length) return false;
  const otp = String(otpInput || '').trim();
  if (!/^\d{6}$/.test(otp)) return false;
  const nowCounter = Math.floor(Date.now() / 1000 / 30);
  const drift = Math.max(0, Math.trunc(Number(windowSteps || 0)));
  for (let i = -drift; i <= drift; i += 1) {
    const code = computeTotp(secret, nowCounter + i);
    if (secureEqual(code, otp)) return true;
  }
  return false;
}

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

// Keep HTTP hardening in one place so HTML, JSON, downloads, and SSE all inherit the
// same baseline protections without each handler reimplementing headers.
function buildSecurityHeaders(extraHeaders = {}, options = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (ADMIN_WEB_HSTS_ENABLED) {
    headers['Strict-Transport-Security'] = `max-age=${ADMIN_WEB_HSTS_MAX_AGE_SEC}; includeSubDomains`;
  }
  if (options.isHtml && ADMIN_WEB_CSP) {
    headers['Content-Security-Policy'] = ADMIN_WEB_CSP;
  }
  return { ...headers, ...extraHeaders };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, jsonReplacer);
  res.writeHead(
    statusCode,
    buildSecurityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
    }),
  );
  res.end(body);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(
    statusCode,
    buildSecurityHeaders(
      {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
      },
      { isHtml: true },
    ),
  );
  res.end(html);
}

function sendText(res, statusCode, text) {
  res.writeHead(
    statusCode,
    buildSecurityHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    }),
  );
  res.end(text);
}

function sendDownload(res, statusCode, body, options = {}) {
  const filename = String(options.filename || 'download.txt').trim() || 'download.txt';
  const contentType = String(options.contentType || 'application/octet-stream').trim()
    || 'application/octet-stream';
  const cacheControl = String(options.cacheControl || 'no-store').trim() || 'no-store';
  res.writeHead(
    statusCode,
    buildSecurityHeaders({
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'Content-Disposition': `attachment; filename=\"${filename.replace(/"/g, '')}\"`,
    }),
  );
  res.end(body);
}

function getIconContentType(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === '.png') return 'image/png';
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  return 'image/webp';
}

function resolveStaticScumIconPath(pathname) {
  const prefixes = ['/assets/scum-items/', '/admin/assets/scum-items/'];
  let matchedPrefix = null;
  for (const prefix of prefixes) {
    if (String(pathname || '').startsWith(prefix)) {
      matchedPrefix = prefix;
      break;
    }
  }
  if (!matchedPrefix) return null;
  let relativeName = '';
  try {
    relativeName = decodeURIComponent(
      String(pathname || '').slice(matchedPrefix.length),
    );
  } catch {
    return null;
  }
  if (!relativeName || relativeName.includes('/') || relativeName.includes('\\')) {
    return null;
  }
  if (relativeName.includes('..')) {
    return null;
  }
  const ext = path.extname(relativeName).toLowerCase();
  if (!STATIC_ICON_EXT.has(ext)) {
    return null;
  }
  const absPath = path.resolve(scumItemsDirPath, relativeName);
  if (!absPath.startsWith(scumItemsDirPath)) {
    return null;
  }
  return {
    absPath,
    ext,
  };
}

async function tryServeStaticScumIcon(req, res, pathname) {
  if (req.method !== 'GET') return false;
  const resolved = resolveStaticScumIconPath(pathname);
  if (!resolved) return false;
  try {
    const stat = await fs.promises.stat(resolved.absPath);
    if (!stat.isFile()) {
      sendText(res, 404, 'Not found');
      return true;
    }
    res.writeHead(200, {
      ...buildSecurityHeaders({
        'Content-Type': getIconContentType(resolved.ext),
        'Cache-Control': 'public, max-age=86400',
      }),
    });
    await pipeline(fs.createReadStream(resolved.absPath), res);
    return true;
  } catch {
    sendText(res, 404, 'Not found');
    return true;
  }
}

function writeLiveEvent(res, eventType, payload) {
  if (!res || res.writableEnded) return;
  const body = JSON.stringify(
    {
      type: String(eventType || 'update'),
      payload: payload && typeof payload === 'object' ? payload : {},
      at: new Date().toISOString(),
    },
    jsonReplacer,
  );
  res.write(`event: ${String(eventType || 'update')}\n`);
  res.write(`data: ${body}\n\n`);
}

function stopLiveHeartbeatIfIdle() {
  if (liveClients.size > 0) return;
  if (!liveHeartbeatTimer) return;
  clearInterval(liveHeartbeatTimer);
  liveHeartbeatTimer = null;
}

function ensureLiveHeartbeat() {
  if (liveHeartbeatTimer) return;
  liveHeartbeatTimer = setInterval(() => {
    for (const res of liveClients) {
      writeLiveEvent(res, 'heartbeat', { now: Date.now() });
    }
  }, LIVE_HEARTBEAT_MS);
  if (typeof liveHeartbeatTimer.unref === 'function') {
    liveHeartbeatTimer.unref();
  }
}

function broadcastLiveUpdate(eventType, payload = {}) {
  if (liveClients.size === 0) return;
  for (const res of liveClients) {
    writeLiveEvent(res, eventType, payload);
  }
}

function openLiveStream(req, res) {
  res.writeHead(200, buildSecurityHeaders({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  }));
  res.write(': connected\n\n');
  liveClients.add(res);
  ensureLiveHeartbeat();
  writeLiveEvent(res, 'connected', {
    clients: liveClients.size,
  });

  const cleanup = () => {
    liveClients.delete(res);
    stopLiveHeartbeatIfIdle();
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
}

function captureMetricsSeries(now = Date.now()) {
  captureObservabilitySeries({
    seriesState: metricsSeries,
    retentionMs: METRICS_SERIES_RETENTION_MS,
    now,
    getDeliveryMetricsSnapshot,
    getLoginFailureMetrics,
    getWebhookMetricsSnapshot,
  });
}

function clampMetricsWindowMs(value) {
  return clampObservabilityWindowMs(value, METRICS_SERIES_RETENTION_MS);
}

function parseMetricsSeriesKeys(value) {
  return parseObservabilitySeriesKeys(value, METRICS_SERIES_KEYS);
}

function listMetricsSeries(options = {}) {
  return listObservabilitySeries({
    seriesState: metricsSeries,
    retentionMs: METRICS_SERIES_RETENTION_MS,
    keys: Array.isArray(options.keys) ? options.keys : [],
    windowMs: options.windowMs,
  });
}

function ensureMetricsSeriesTimer() {
  if (metricsSeriesTimer) return;
  captureMetricsSeries();
  metricsSeriesTimer = setInterval(() => {
    captureMetricsSeries();
  }, METRICS_SERIES_INTERVAL_MS);
  if (typeof metricsSeriesTimer.unref === 'function') {
    metricsSeriesTimer.unref();
  }
}

function stopMetricsSeriesTimer() {
  if (!metricsSeriesTimer) return;
  clearInterval(metricsSeriesTimer);
  metricsSeriesTimer = null;
}

function closeAllLiveStreams() {
  if (liveClients.size === 0) {
    stopLiveHeartbeatIfIdle();
    return;
  }
  for (const res of liveClients) {
    try {
      if (!res.writableEnded) {
        res.end();
      }
      if (typeof res.destroy === 'function') {
        res.destroy();
      }
    } catch {}
  }
  liveClients.clear();
  stopLiveHeartbeatIfIdle();
}

function getDashboardHtml() {
  if (!cachedDashboardHtml) {
    cachedDashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf8');
  }
  return cachedDashboardHtml;
}

function getLoginHtml() {
  if (!cachedLoginHtml) {
    cachedLoginHtml = fs.readFileSync(loginHtmlPath, 'utf8');
  }
  return cachedLoginHtml;
}

function getAdminToken() {
  if (resolvedToken) return resolvedToken;
  const fromEnv = String(process.env.ADMIN_WEB_TOKEN || '').trim();
  if (fromEnv) {
    resolvedToken = fromEnv;
    return resolvedToken;
  }
  resolvedToken = crypto.randomBytes(18).toString('hex');
  console.warn('[admin-web] ยังไม่ได้ตั้งค่า ADMIN_WEB_TOKEN จึงสร้างโทเค็นเซสชันชั่วคราว:');
  console.warn(`[admin-web] ${resolvedToken}`);
  return resolvedToken;
}

function getAdminLoginPassword() {
  if (resolvedLoginPassword) return resolvedLoginPassword;

  const fromEnv = String(process.env.ADMIN_WEB_PASSWORD || '').trim();
  if (fromEnv) {
    resolvedLoginPassword = fromEnv;
    return resolvedLoginPassword;
  }

  // Backward compatibility: use token as password when explicit password is not set.
  resolvedLoginPassword = getAdminToken();
  return resolvedLoginPassword;
}

function parseAdminUsersFromEnv() {
  let users = [];
  if (ADMIN_WEB_USERS_JSON) {
    try {
      const parsed = JSON.parse(ADMIN_WEB_USERS_JSON);
      if (Array.isArray(parsed)) {
        users = parsed
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const username = String(row.username || '').trim();
            const password = String(row.password || '').trim();
            if (!username || !password) return null;
            return {
              username,
              password,
              role: normalizeRole(row.role || 'mod'),
            };
          })
          .filter(Boolean);
      }
    } catch (error) {
      console.warn('[admin-web] ADMIN_WEB_USERS_JSON parse failed:', error.message);
    }
  }

  if (users.length === 0) {
    users.push({
      username: ADMIN_WEB_USER,
      password: getAdminLoginPassword(),
      role: ADMIN_WEB_USER_ROLE,
    });
  }

  return users;
}

function createAdminPasswordHash(password) {
  const pass = String(password || '');
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(pass, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyAdminPassword(password, passwordHash) {
  const pass = String(password || '');
  const stored = String(passwordHash || '').trim();
  if (!stored) return false;

  // Backward compatibility with legacy plain-text passwords.
  if (!stored.startsWith('scrypt$')) {
    return secureEqual(pass, stored);
  }

  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  const actual = crypto.scryptSync(pass, salt, expected.length);
  return secureEqual(actual.toString('hex'), expected.toString('hex'));
}

async function ensureAdminUsersTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_web_users (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'mod',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function seedAdminUsersFromEnv() {
  const users = parseAdminUsersFromEnv();
  for (const user of users) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO admin_web_users (
        username,
        password_hash,
        role,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(username) DO NOTHING;
      `,
      String(user.username || '').trim(),
      createAdminPasswordHash(user.password),
      normalizeRole(user.role),
    );
  }
}

async function listAdminUsersFromDb(limit = 100) {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT
      username,
      role,
      is_active AS isActive
    FROM admin_web_users
    WHERE is_active = 1
    ORDER BY username ASC
    LIMIT ?;
    `,
    Math.max(1, Math.trunc(Number(limit || 100))),
  );

  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    username: String(row?.username || '').trim(),
    role: normalizeRole(row?.role || 'mod'),
    isActive: Number(row?.isActive || 0) === 1,
  }));
}

async function ensureAdminUsersReady() {
  if (adminUsersReadyPromise) return adminUsersReadyPromise;

  adminUsersReadyPromise = (async () => {
    await ensureAdminUsersTable();
    await seedAdminUsersFromEnv();
    const users = await listAdminUsersFromDb(1);
    if (!users.length) {
      throw new Error('No active admin users in database');
    }
  })().catch((error) => {
    adminUsersReadyPromise = null;
    throw error;
  });

  return adminUsersReadyPromise;
}

async function getUserByCredentials(username, password) {
  const name = String(username || '').trim();
  const pass = String(password || '');
  if (!name || !pass) return null;

  await ensureAdminUsersReady();
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT
      username,
      password_hash AS passwordHash,
      role,
      is_active AS isActive
    FROM admin_web_users
    WHERE username = ?
    LIMIT 1;
    `,
    name,
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row || Number(row.isActive || 0) !== 1) return null;
  if (!verifyAdminPassword(pass, row.passwordHash)) return null;

  return {
    username: String(row.username || '').trim(),
    role: normalizeRole(row.role || 'mod'),
    authMethod: 'password-db',
  };
}

function getSsoDiscordRole(roleIds = []) {
  const ownerIds = parseCsvSet(process.env.ADMIN_WEB_SSO_DISCORD_OWNER_ROLE_IDS);
  const adminIds = parseCsvSet(process.env.ADMIN_WEB_SSO_DISCORD_ADMIN_ROLE_IDS);
  const modIds = parseCsvSet(process.env.ADMIN_WEB_SSO_DISCORD_MOD_ROLE_IDS);
  const source = new Set(Array.isArray(roleIds) ? roleIds.map((v) => String(v)) : []);
  for (const id of ownerIds) {
    if (source.has(id)) return 'owner';
  }
  for (const id of adminIds) {
    if (source.has(id)) return 'admin';
  }
  for (const id of modIds) {
    if (source.has(id)) return 'mod';
  }
  return SSO_DISCORD_DEFAULT_ROLE;
}

function getDiscordRedirectUri(host, port) {
  if (SSO_DISCORD_REDIRECT_URI) return SSO_DISCORD_REDIRECT_URI;
  return `http://${host}:${port}/admin/auth/discord/callback`;
}

function cleanupDiscordOauthStates() {
  const now = Date.now();
  for (const [state, payload] of discordOauthStates.entries()) {
    if (!payload || now - payload.createdAt > SSO_STATE_TTL_MS) {
      discordOauthStates.delete(state);
    }
  }
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '').trim();
  if (!raw) return {};
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function getClientIp(req) {
  if (ADMIN_WEB_TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    if (forwarded) return forwarded;
  }
  return String(req.socket?.remoteAddress || '').trim() || 'unknown';
}

function cleanupLoginAttempts(now = Date.now()) {
  for (const [ip, entry] of loginAttemptsByIp.entries()) {
    if (!entry || now - entry.firstAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
      loginAttemptsByIp.delete(ip);
    }
  }
}

function cleanupLoginFailureEvents(now = Date.now()) {
  const cutoff = now - LOGIN_SPIKE_WINDOW_MS;
  while (loginFailureEvents.length > 0 && loginFailureEvents[0].at < cutoff) {
    loginFailureEvents.shift();
  }
}

function getLoginFailureMetrics(now = Date.now()) {
  cleanupLoginFailureEvents(now);
  const byIp = new Map();
  for (const event of loginFailureEvents) {
    const ip = event?.ip || 'unknown';
    byIp.set(ip, (byIp.get(ip) || 0) + 1);
  }
  const hotIps = Array.from(byIp.entries())
    .filter(([, count]) => count >= LOGIN_SPIKE_IP_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([ip, count]) => ({ ip, count }));
  return {
    windowMs: LOGIN_SPIKE_WINDOW_MS,
    failures: loginFailureEvents.length,
    threshold: LOGIN_SPIKE_THRESHOLD,
    perIpThreshold: LOGIN_SPIKE_IP_THRESHOLD,
    hotIps,
  };
}

function maybeAlertLoginFailureSpike(now = Date.now()) {
  const metrics = getLoginFailureMetrics(now);
  const hasGlobalSpike = metrics.failures >= LOGIN_SPIKE_THRESHOLD;
  const hasIpSpike = metrics.hotIps.length > 0;
  if (!hasGlobalSpike && !hasIpSpike) return;
  if (now - lastLoginSpikeAlertAt < LOGIN_SPIKE_ALERT_COOLDOWN_MS) return;
  lastLoginSpikeAlertAt = now;

  const payload = {
    source: 'admin-login',
    kind: hasGlobalSpike ? 'global-spike' : 'ip-spike',
    windowMs: metrics.windowMs,
    failures: metrics.failures,
    threshold: metrics.threshold,
    hotIps: metrics.hotIps.slice(0, 5),
  };
  console.warn(
    `[admin-web][alert] login failure spike: failures=${metrics.failures} windowMs=${metrics.windowMs}`,
  );
  publishAdminLiveUpdate('ops-alert', payload);
}

function getLoginRateLimitState(req) {
  const now = Date.now();
  cleanupLoginAttempts(now);
  const ip = getClientIp(req);
  const entry = loginAttemptsByIp.get(ip);
  if (!entry) {
    return { limited: false, ip, retryAfterMs: 0 };
  }

  if (entry.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterMs = Math.max(
      0,
      LOGIN_RATE_LIMIT_WINDOW_MS - (now - entry.firstAt),
    );
    return { limited: retryAfterMs > 0, ip, retryAfterMs };
  }

  return { limited: false, ip, retryAfterMs: 0 };
}

function recordLoginAttempt(req, success) {
  const now = Date.now();
  cleanupLoginAttempts(now);
  cleanupLoginFailureEvents(now);
  const ip = getClientIp(req);

  if (success) {
    loginAttemptsByIp.delete(ip);
    return;
  }

  loginFailureEvents.push({ at: now, ip });
  maybeAlertLoginFailureSpike(now);

  const existing = loginAttemptsByIp.get(ip);
  if (!existing || now - existing.firstAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginAttemptsByIp.set(ip, { count: 1, firstAt: now });
    return;
  }

  loginAttemptsByIp.set(ip, { count: existing.count + 1, firstAt: existing.firstAt });
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function cleanupSessions() {
  const now = Date.now();
  for (const [sid, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now) {
      sessions.delete(sid);
    }
  }
}

// Sessions remain lightweight and in-memory on purpose here; production hardening is
// enforced by secure cookies, RBAC, rate-limits, and the readiness/security checks.
function createSession(user, role = 'mod', authMethod = 'password') {
  cleanupSessions();
  const sessionId = crypto.randomBytes(24).toString('hex');
  sessions.set(sessionId, {
    user: String(user || ADMIN_WEB_USER),
    role: normalizeRole(role),
    authMethod: String(authMethod || 'password'),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return sessionId;
}

function invalidateSession(sessionId) {
  if (!sessionId) return;
  sessions.delete(sessionId);
}

function getSessionId(req) {
  const cookies = parseCookies(req);
  return String(cookies[SESSION_COOKIE_NAME] || '').trim();
}

function getSessionFromRequest(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function hasValidSession(req) {
  return getSessionFromRequest(req) != null;
}

function buildSessionCookie(sessionId) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    `Path=${SESSION_COOKIE_PATH}`,
    `SameSite=${SESSION_COOKIE_SAMESITE}`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (SESSION_COOKIE_DOMAIN) parts.push(`Domain=${SESSION_COOKIE_DOMAIN}`);
  if (SESSION_SECURE_COOKIE) parts.push('Secure');
  return parts.join('; ');
}

function buildClearSessionCookie() {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    `Path=${SESSION_COOKIE_PATH}`,
    `SameSite=${SESSION_COOKIE_SAMESITE}`,
    'Max-Age=0',
  ];
  if (SESSION_COOKIE_DOMAIN) parts.push(`Domain=${SESSION_COOKIE_DOMAIN}`);
  if (SESSION_SECURE_COOKIE) parts.push('Secure');
  return parts.join('; ');
}

function getRequestToken(req, urlObj) {
  const tokenHeader = String(req.headers['x-admin-token'] || '').trim();
  if (tokenHeader) return tokenHeader;

  const auth = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }

  const tokenQuery = String(urlObj.searchParams.get('token') || '').trim();
  if (tokenQuery && ADMIN_WEB_ALLOW_TOKEN_QUERY) return tokenQuery;
  return '';
}

function getAuthContext(req, urlObj) {
  const session = getSessionFromRequest(req);
  if (session) {
    return {
      mode: 'session',
      user: session.user || ADMIN_WEB_USER,
      role: normalizeRole(session.role || 'mod'),
      authMethod: session.authMethod || 'password',
    };
  }

  const requestToken = getRequestToken(req, urlObj);
  const expected = getAdminToken();
  if (requestToken !== '' && secureEqual(requestToken, expected)) {
    return {
      mode: 'token',
      user: 'token',
      role: ADMIN_WEB_TOKEN_ROLE,
      authMethod: 'token',
    };
  }
  return null;
}

function isAuthorized(req, urlObj) {
  return getAuthContext(req, urlObj) != null;
}

function ensureRole(req, urlObj, minRole, res) {
  const auth = getAuthContext(req, urlObj);
  if (!auth) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return null;
  }
  if (!hasRoleAtLeast(auth.role, minRole)) {
    sendJson(res, 403, {
      ok: false,
      error: `Forbidden: ${minRole} role required`,
      role: auth.role,
    });
    return null;
  }
  return auth;
}

function getForwardedDiscordId(req) {
  const value = String(req.headers['x-forwarded-discord-id'] || '').trim();
  if (!/^\d{15,25}$/.test(value)) return '';
  return value;
}

function ensurePortalTokenAuth(req, urlObj, res) {
  const auth = getAuthContext(req, urlObj);
  if (!auth) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return null;
  }
  if (auth.mode !== 'token') {
    sendJson(res, 403, {
      ok: false,
      error: 'Portal endpoint requires token auth',
    });
    return null;
  }
  const discordId = getForwardedDiscordId(req);
  if (!discordId) {
    sendJson(res, 400, {
      ok: false,
      error: 'Missing x-forwarded-discord-id header',
    });
    return null;
  }
  return {
    auth,
    discordId,
    forwardedUser: String(req.headers['x-forwarded-user'] || '').trim() || 'portal',
  };
}

function getPlatformApiKeyFromRequest(req) {
  const headerKey = String(req.headers['x-platform-api-key'] || '').trim();
  if (headerKey) return headerKey;
  const authHeader = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }
  return '';
}

async function ensurePlatformApiKey(req, res, requiredScopes = []) {
  const rawKey = getPlatformApiKeyFromRequest(req);
  const auth = await verifyPlatformApiKey(rawKey, requiredScopes);
  if (!auth?.ok) {
    const status = auth?.reason === 'insufficient-scope' ? 403 : 401;
    sendJson(res, status, {
      ok: false,
      error: auth?.reason || 'invalid-platform-api-key',
      missingScopes: Array.isArray(auth?.missingScopes) ? auth.missingScopes : [],
    });
    return null;
  }
  return auth;
}

function filterShopItems(rows, options = {}) {
  const kindFilter = String(options.kind || '').trim().toLowerCase();
  const query = String(options.q || '').trim().toLowerCase();
  const limit = Math.max(
    1,
    Math.min(1000, Number(options.limit || 200)),
  );
  const out = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const kind = String(row?.kind || 'item').trim().toLowerCase() === 'vip'
      ? 'vip'
      : 'item';
    if (kindFilter && kindFilter !== 'all' && kind !== kindFilter) continue;

    const haystack = [
      row?.id,
      row?.name,
      row?.description,
      row?.gameItemId,
    ]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    if (query && !haystack.includes(query)) continue;

    out.push({
      ...row,
      kind,
      iconUrl: row?.iconUrl || resolveItemIconUrl(row),
    });
    if (out.length >= limit) break;
  }

  return out;
}

function requiredRoleForPostPath(pathname) {
  const ownerOnly = new Set([
    '/admin/api/config/set',
    '/admin/api/config/reset',
    '/admin/api/welcome/clear',
    '/admin/api/rentbike/reset-now',
    '/admin/api/backup/create',
    '/admin/api/backup/restore',
    '/admin/api/platform/tenant',
    '/admin/api/platform/subscription',
    '/admin/api/platform/license',
    '/admin/api/platform/license/accept-legal',
    '/admin/api/platform/apikey',
    '/admin/api/platform/webhook',
    '/admin/api/platform/marketplace',
  ]);
  if (ownerOnly.has(pathname)) return 'owner';

  const modAllowed = new Set([
    '/admin/api/ticket/claim',
    '/admin/api/ticket/close',
    '/admin/api/moderation/add',
    '/admin/api/stats/add-kill',
    '/admin/api/stats/add-death',
    '/admin/api/stats/add-playtime',
    '/admin/api/scum/status',
    '/admin/api/platform/reconcile',
    '/admin/api/platform/monitoring/run',
  ]);
  if (modAllowed.has(pathname)) return 'mod';
  return 'admin';
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return '';
  }
}

function buildAllowedOrigins(host, port) {
  const out = new Set();
  const add = (value) => {
    const normalized = normalizeOrigin(value);
    if (normalized) out.add(normalized);
  };

  add(`http://127.0.0.1:${port}`);
  add(`http://localhost:${port}`);
  if (host && host !== '0.0.0.0' && host !== '::') {
    add(`http://${host}:${port}`);
  }

  for (const item of ADMIN_WEB_ALLOWED_ORIGINS.split(',')) {
    add(item);
  }

  return out;
}

function getRequestOrigin(req) {
  const fromOrigin = normalizeOrigin(req.headers.origin);
  if (fromOrigin) return fromOrigin;
  const referrer = String(req.headers.referer || '').trim();
  if (!referrer) return '';
  try {
    return new URL(referrer).origin.toLowerCase();
  } catch {
    return '';
  }
}

function isSafeHttpMethod(method) {
  const text = String(method || '').toUpperCase();
  return text === 'GET' || text === 'HEAD' || text === 'OPTIONS';
}

function violatesBrowserOriginPolicy(req, allowedOrigins) {
  if (!ADMIN_WEB_ENFORCE_ORIGIN_CHECK) return false;
  const fetchSite = String(req.headers['sec-fetch-site'] || '')
    .trim()
    .toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    return true;
  }

  const origin = getRequestOrigin(req);
  if (!origin) return false;
  return !allowedOrigins.has(origin);
}

function asInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function requiredString(body, key) {
  const source = typeof key === 'undefined' ? body : body?.[key];
  const value = String(source || '').trim();
  return value || null;
}

function parseStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const text = String(value || '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed)
        ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }
  return text
    .split(/[\r\n,]+/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function createHttpError(statusCode, message) {
  const error = new Error(String(message || 'Request error'));
  error.statusCode = Number(statusCode) || 500;
  return error;
}

function parseDeliveryItemsBody(input) {
  let candidate = input;
  if (typeof candidate === 'string') {
    const raw = candidate.trim();
    if (!raw) return [];
    try {
      candidate = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(candidate)) return [];

  const out = [];
  for (const row of candidate) {
    if (!row || typeof row !== 'object') continue;
    const gameItemId = String(row.gameItemId || row.id || '').trim();
    if (!gameItemId) continue;
    const quantity = Math.max(1, asInt(row.quantity, 1) || 1);
    const iconUrl = String(row.iconUrl || '').trim() || null;
    out.push({ gameItemId, quantity, iconUrl });
  }
  return out;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      body += chunk;
      bytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk));
      if (bytes > ADMIN_WEB_MAX_BODY_BYTES) {
        done = true;
        reject(createHttpError(413, 'เนื้อหาคำขอใหญ่เกินกำหนด'));
        req.resume();
      }
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(createHttpError(400, 'รูปแบบ JSON ไม่ถูกต้อง'));
      }
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function getCurrentObservabilitySnapshot(options = {}) {
  return buildAdminObservabilitySnapshot({
    windowMs: options.windowMs,
    seriesKeys: Array.isArray(options.seriesKeys) ? options.seriesKeys : [],
    retentionMs: METRICS_SERIES_RETENTION_MS,
    captureSeries: () => captureMetricsSeries(),
    getDeliveryMetricsSnapshot,
    getLoginFailureMetrics,
    getWebhookMetricsSnapshot,
    listDeliveryQueue,
    listSeries: ({ windowMs, keys }) => listMetricsSeries({ windowMs, keys }),
  });
}

async function tryNotifyTicket(client, ticket, action, staffId) {
  try {
    if (!ticket?.channelId) return;
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel) return;
    if (action === 'claim') {
      if (!channel.isTextBased || !channel.isTextBased()) return;
      await channel.send(`รับเรื่อง ticket จากเว็บแอดมินโดย <@${staffId}>`).catch(() => null);
      return;
    }
    if (action === 'close') {
      if (channel.isTextBased && channel.isTextBased()) {
        await channel.send('ปิด ticket จากเว็บแอดมิน (กำลังลบห้อง)').catch(() => null);
      }

      try {
        const reason = ticket?.id
          ? `Ticket #${ticket.id} closed from admin web`
          : 'Ticket closed from admin web';
        await channel.delete(reason);
        return;
      } catch (error) {
        if (ticket.userId && channel.permissionOverwrites?.edit) {
          await channel.permissionOverwrites
            .edit(ticket.userId, { SendMessages: false })
            .catch(() => null);
        }
        if (channel.isTextBased && channel.isTextBased()) {
          await channel
            .send('ปิด ticket แล้ว (แต่ลบห้องไม่สำเร็จ)')
            .catch(() => null);
        }
      }
    }
  } catch {
    // Best effort only.
  }
}

// POST actions are centralized here so restore-maintenance gating, RBAC, validation,
// and audit/live-update hooks stay consistent across the admin surface.
async function handlePostAction(client, pathname, body, res, auth) {
  if (pathname === '/admin/api/wallet/set') {
    const userId = requiredString(body, 'userId');
    const balance = asInt(body.balance);
    if (!userId || balance == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await setCoinsExact({
      userId,
      amount: balance,
      reason: 'admin_wallet_set',
      actor: `admin-web:${auth?.user || 'unknown'}`,
      meta: {
        role: auth?.role || 'unknown',
      },
    });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-wallet-set');
    return sendJson(res, 200, { ok: true, data: { userId, balance: result.balance } });
  }

  if (pathname === '/admin/api/wallet/add') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await creditCoins({
      userId,
      amount,
      reason: 'admin_wallet_add',
      actor: `admin-web:${auth?.user || 'unknown'}`,
      meta: {
        role: auth?.role || 'unknown',
      },
    });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-wallet-add');
    return sendJson(res, 200, { ok: true, data: { userId, balance: result.balance } });
  }

  if (pathname === '/admin/api/wallet/remove') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await debitCoins({
      userId,
      amount,
      reason: 'admin_wallet_remove',
      actor: `admin-web:${auth?.user || 'unknown'}`,
      meta: {
        role: auth?.role || 'unknown',
      },
    });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-wallet-remove');
    return sendJson(res, 200, { ok: true, data: { userId, balance: result.balance } });
  }

  if (pathname === '/admin/api/shop/add') {
    const id = requiredString(body, 'id');
    const name = requiredString(body, 'name');
    const price = asInt(body.price);
    const description = String(body.description || '').trim();
    const kindRaw = requiredString(body, 'kind') || 'item';
    const kind = String(kindRaw).trim().toLowerCase() === 'vip' ? 'vip' : 'item';
    const gameItemId = requiredString(body, 'gameItemId');
    const quantity = asInt(body.quantity) ?? 1;
    const iconUrl = requiredString(body, 'iconUrl');
    const deliveryProfile = requiredString(body, 'deliveryProfile');
    const deliveryTeleportMode = requiredString(body, 'deliveryTeleportMode');
    const deliveryTeleportTarget = requiredString(body, 'deliveryTeleportTarget');
    const deliveryPreCommands = body.deliveryPreCommands;
    const deliveryPostCommands = body.deliveryPostCommands;
    const deliveryReturnTarget = requiredString(body, 'deliveryReturnTarget');
    const deliveryItems = parseDeliveryItemsBody(body.deliveryItems);
    const fallbackDeliveryItem = gameItemId
      ? [{ gameItemId, quantity: Math.max(1, Number(quantity || 1)), iconUrl }]
      : [];
    const resolvedDeliveryItems = kind === 'item'
      ? (deliveryItems.length > 0 ? deliveryItems : fallbackDeliveryItem)
      : [];
    const primaryDeliveryItem = resolvedDeliveryItems[0] || null;

    if (!id || !name || price == null) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    if (kind === 'item' && resolvedDeliveryItems.length === 0) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Request failed',
      });
    }

    const result = await addShopItemForAdmin({
      id,
      name,
      price,
      description,
      kind,
      gameItemId: kind === 'item' ? primaryDeliveryItem?.gameItemId || gameItemId : null,
      quantity: kind === 'item'
        ? Math.max(1, Number(primaryDeliveryItem?.quantity || quantity || 1))
        : 1,
      iconUrl: kind === 'item'
        ? primaryDeliveryItem?.iconUrl || iconUrl
        : null,
      deliveryItems: resolvedDeliveryItems,
      deliveryProfile: kind === 'item' ? deliveryProfile : null,
      deliveryTeleportMode: kind === 'item' ? deliveryTeleportMode : null,
      deliveryTeleportTarget: kind === 'item' ? deliveryTeleportTarget : null,
      deliveryPreCommands: kind === 'item' ? deliveryPreCommands : [],
      deliveryPostCommands: kind === 'item' ? deliveryPostCommands : [],
      deliveryReturnTarget: kind === 'item' ? deliveryReturnTarget : null,
    });
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.error || result.reason || 'Request failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.item });
  }

  if (pathname === '/admin/api/shop/price') {
    const idOrName = requiredString(body, 'idOrName');
    const price = asInt(body.price);
    if (!idOrName || price == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await setShopItemPriceForAdmin({ idOrName, price });
    if (!result.ok && result.reason === 'not-found') return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Invalid request payload' });
    return sendJson(res, 200, { ok: true, data: result.item });
  }

  if (pathname === '/admin/api/shop/delete') {
    const idOrName = requiredString(body, 'idOrName');
    if (!idOrName) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await deleteShopItemForAdmin({ idOrName });
    if (!result.ok && result.reason === 'not-found') return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Invalid request payload' });
    return sendJson(res, 200, { ok: true, data: result.item });
  }

  if (pathname === '/admin/api/purchase/status') {
    const code = requiredString(body, 'code');
    const status = requiredString(body, 'status');
    if (!code || !status) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await updatePurchaseStatusForActor({
      code,
      status,
      force: body?.force === true,
      actor: `admin-web:${auth?.user || 'unknown'}`,
      reason: requiredString(body, 'reason') || 'admin-manual-status-update',
      meta: {
        role: auth?.role || 'unknown',
      },
      recordIfSame: body?.recordIfSame === true,
      historyLimit: 20,
    });
    if (!result.ok && result.reason === 'not-found') {
      return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    }
    if (!result.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Invalid purchase status transition',
        data: {
          code,
          currentStatus: result.currentStatus || '',
          targetStatus: result.targetStatus || '',
          reason: result.reason,
          allowedTransitions: Array.isArray(result.allowedTransitions)
            ? result.allowedTransitions
            : [],
          knownStatuses: Array.isArray(result.knownStatuses)
            ? result.knownStatuses
            : listKnownPurchaseStatuses(),
        },
      });
    }
    return sendJson(res, 200, {
      ok: true,
      data: {
        purchase: result.purchase,
        history: result.history,
      },
    });
  }

  if (pathname === '/admin/api/ticket/claim') {
    const channelId = requiredString(body, 'channelId');
    const staffId = requiredString(body, 'staffId') || auth?.user || 'admin-web';
    if (!channelId || !staffId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = claimSupportTicket({ channelId, staffId });
    if (!result.ok && result.reason === 'not-found') return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Invalid request payload' });
    await tryNotifyTicket(client, result.ticket, 'claim', staffId);
    return sendJson(res, 200, { ok: true, data: result.ticket });
  }

  if (pathname === '/admin/api/ticket/close') {
    const channelId = requiredString(body, 'channelId');
    if (!channelId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = closeSupportTicket({ channelId });
    if (!result.ok && result.reason === 'not-found') return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Invalid request payload' });
    await tryNotifyTicket(client, result.ticket, 'close');
    return sendJson(res, 200, { ok: true, data: result.ticket });
  }

  if (pathname === '/admin/api/bounty/create') {
    const targetName = requiredString(body, 'targetName');
    const amount = asInt(body.amount);
    const createdBy = requiredString(body, 'createdBy') || auth?.user || 'admin-web';
    if (!targetName || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = createBountyForUser({ targetName, amount, createdBy });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: `ไม่สามารถสร้างค่าหัวได้ (${result.reason})` });
    return sendJson(res, 200, { ok: true, data: result.bounty });
  }

  if (pathname === '/admin/api/bounty/cancel') {
    const id = asInt(body.id);
    if (id == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = cancelBountyForUser({
      id,
      requesterId: auth?.user || 'admin-web',
      isStaff: true,
    });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: `ไม่สามารถยกเลิกค่าหัวได้ (${result.reason})` });
    return sendJson(res, 200, { ok: true, data: result.bounty });
  }

  if (pathname === '/admin/api/event/create') {
    const name = requiredString(body, 'name');
    const time = requiredString(body, 'time');
    const reward = requiredString(body, 'reward');
    if (!name || !time || !reward) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await createServerEvent({ name, time, reward });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    return sendJson(res, 200, { ok: true, data: result.event });
  }

  if (pathname === '/admin/api/event/start') {
    const id = asInt(body.id);
    if (id == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await startServerEvent({ id });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: result.event });
  }

  if (pathname === '/admin/api/event/end') {
    const id = asInt(body.id);
    if (id == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await finishServerEvent({
      id,
      winnerUserId: requiredString(body, 'winnerUserId') || null,
      coins: asInt(body.coins) || 0,
      actor: 'admin-web',
    });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, {
      ok: true,
      data: {
        ...result.event,
        participantsCount: result.participants.length,
        rewardGranted: result.rewardGranted,
        rewardError: result.rewardError || null,
      },
    });
  }

  if (pathname === '/admin/api/event/join') {
    const id = asInt(body.id);
    const userId = requiredString(body, 'userId');
    if (id == null || !userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await joinServerEvent({ id, userId });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, {
      ok: true,
      data: {
        event: result.event,
        participantsCount: result.participantsCount,
      },
    });
  }

  if (pathname === '/admin/api/link/set') {
    const steamId = requiredString(body, 'steamId');
    const userId = requiredString(body, 'userId');
    const inGameName = requiredString(body, 'inGameName');
    if (!steamId || !userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = bindSteamLinkForUser({
      steamId,
      userId,
      inGameName: inGameName || null,
      allowReplace: true,
      allowSteamReuse: true,
    });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: `ไม่สามารถบันทึกลิงก์ได้ (${result.reason})` });
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/link/remove') {
    const steamId = requiredString(body, 'steamId');
    const userId = requiredString(body, 'userId');
    if (!steamId && !userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = removeSteamLink({ steamId, userId });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: result.removed });
  }

  if (pathname === '/admin/api/player/account/upsert') {
    const userId = requiredString(body, 'userId');
    if (!userId) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = await upsertPlayerAccount({
      discordId: userId,
      username: requiredString(body, 'username'),
      displayName: requiredString(body, 'displayName'),
      avatarUrl: requiredString(body, 'avatarUrl'),
      steamId: requiredString(body, 'steamId'),
      isActive: body?.isActive !== false,
    });
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.data });
  }

  if (pathname === '/admin/api/player/steam/bind') {
    const userId = requiredString(body, 'userId');
    const steamId = requiredString(body, 'steamId');
    if (!userId || !steamId) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = await bindPlayerSteamId(userId, steamId);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.data });
  }

  if (pathname === '/admin/api/player/steam/unbind') {
    const userId = requiredString(body, 'userId');
    if (!userId) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = await unbindPlayerSteamId(userId);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.data });
  }

  if (pathname === '/admin/api/vip/set') {
    const userId = requiredString(body, 'userId');
    const planId = requiredString(body, 'planId');
    const durationDays = asInt(body.durationDays);
    if (!userId || !planId || durationDays == null) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = await grantVipForUser({
      userId,
      planId,
      durationDays,
    });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    return sendJson(res, 200, {
      ok: true,
      data: { userId, planId: result.plan.id, expiresAt: result.expiresAt },
    });
  }

  if (pathname === '/admin/api/vip/remove') {
    const userId = requiredString(body, 'userId');
    if (!userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = await revokeVipForUser({ userId });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: result.reason || 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: { userId } });
  }

  if (pathname === '/admin/api/redeem/add') {
    const code = requiredString(body, 'code');
    const type = requiredString(body, 'type');
    if (!code || !type) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const amount = body.amount == null || body.amount === '' ? null : asInt(body.amount, null);
    const itemId = requiredString(body, 'itemId');
    const result = createRedeemCodeForAdmin({ code, type, amount, itemId });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: `ไม่สามารถบันทึกโค้ดได้ (${result.reason})` });
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/redeem/delete') {
    const code = requiredString(body, 'code');
    if (!code) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = deleteRedeemCodeForAdmin({ code });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: { code: result.code } });
  }

  if (pathname === '/admin/api/redeem/reset-usage') {
    const code = requiredString(body, 'code');
    if (!code) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = resetRedeemCodeUsageForAdmin({ code });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: result.data });
  }

  if (pathname === '/admin/api/moderation/add') {
    const userId = requiredString(body, 'userId');
    const type = requiredString(body, 'type');
    const reason = requiredString(body, 'reason');
    const staffId = requiredString(body, 'staffId') || auth?.user || 'admin-web';
    const durationMinutes = body.durationMinutes == null || body.durationMinutes === ''
      ? null
      : asInt(body.durationMinutes);
    if (!userId || !type || !reason) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = createPunishmentEntry({
      userId,
      type,
      reason,
      staffId,
      durationMinutes,
    });
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.entry });
  }

  if (pathname === '/admin/api/welcome/revoke') {
    const userId = requiredString(body, 'userId');
    if (!userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = revokeWelcomePackClaimForAdmin({ userId });
    if (!result.ok) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: { userId: result.userId } });
  }

  if (pathname === '/admin/api/welcome/clear') {
    const result = clearWelcomePackClaimsForAdmin();
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/stats/add-kill') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = addKillsForUser({ userId, amount });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-add-kill');
    return sendJson(res, 200, { ok: true, data: result.stat });
  }

  if (pathname === '/admin/api/stats/add-death') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = addDeathsForUser({ userId, amount });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-add-death');
    return sendJson(res, 200, { ok: true, data: result.stat });
  }

  if (pathname === '/admin/api/stats/add-playtime') {
    const userId = requiredString(body, 'userId');
    const minutes = asInt(body.minutes);
    if (!userId || minutes == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = addPlaytimeForUser({ userId, minutes });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-add-playtime');
    return sendJson(res, 200, { ok: true, data: result.stat });
  }

  if (pathname === '/admin/api/config/patch') {
    const patch = body?.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    if (typeof config.updateConfigPatch !== 'function') {
      return sendJson(res, 500, { ok: false, error: 'Operation is not available' });
    }
    const next = config.updateConfigPatch(patch);
    return sendJson(res, 200, { ok: true, data: next });
  }

  if (pathname === '/admin/api/config/set') {
    const nextConfig = body?.config;
    if (!nextConfig || typeof nextConfig !== 'object' || Array.isArray(nextConfig)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    if (typeof config.setFullConfig !== 'function') {
      return sendJson(res, 500, { ok: false, error: 'Operation is not available' });
    }
    const next = config.setFullConfig(nextConfig);
    return sendJson(res, 200, { ok: true, data: next });
  }

  if (pathname === '/admin/api/config/reset') {
    if (typeof config.resetConfigToDefault !== 'function') {
      return sendJson(res, 500, { ok: false, error: 'Operation is not available' });
    }
    const next = config.resetConfigToDefault();
    return sendJson(res, 200, { ok: true, data: next });
  }

  if (pathname === '/admin/api/delivery/enqueue') {
    const code = requiredString(body, 'code');
    if (!code) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = await enqueuePurchaseDeliveryByCode(code, {
      guildId: requiredString(body, 'guildId') || undefined,
    });
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'ไม่สามารถเพิ่มคิวส่งของได้' });
    }
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/delivery/retry') {
    const code = requiredString(body, 'code');
    if (!code) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = retryDeliveryNow(code);
    if (!result) {
      return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    }
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/delivery/retry-many') {
    const codes = parseStringArray(body?.codes);
    if (codes.length === 0) {
      return sendJson(res, 400, { ok: false, error: 'codes is required' });
    }
    const result = retryDeliveryNowMany(codes);
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/delivery/dead-letter/retry') {
    const code = requiredString(body, 'code');
    if (!code) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = await retryDeliveryDeadLetter(code, {
      guildId: requiredString(body, 'guildId') || undefined,
    });
    if (!result?.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: result?.reason || 'ไม่สามารถ retry dead-letter ได้',
      });
    }
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/delivery/dead-letter/retry-many') {
    const codes = parseStringArray(body?.codes);
    if (codes.length === 0) {
      return sendJson(res, 400, { ok: false, error: 'codes is required' });
    }
    const result = await retryDeliveryDeadLetterMany(codes, {
      guildId: requiredString(body, 'guildId') || undefined,
    });
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/delivery/dead-letter/delete') {
    const code = requiredString(body, 'code');
    if (!code) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const removed = removeDeliveryDeadLetter(code);
    if (!removed) {
      return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    }
    return sendJson(res, 200, { ok: true, data: removed });
  }

  if (pathname === '/admin/api/delivery/cancel') {
    const code = requiredString(body, 'code');
    if (!code) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const result = cancelDeliveryJob(code, requiredString(body, 'reason') || 'admin-web');
    if (!result) {
      return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    }
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/delivery/preview') {
    const itemId = requiredString(body, 'itemId');
    const gameItemId = requiredString(body, 'gameItemId');
    if (!itemId && !gameItemId) {
      return sendJson(res, 400, { ok: false, error: 'itemId or gameItemId is required' });
    }
    try {
      const data = await previewDeliveryCommands({
        itemId: itemId || undefined,
        gameItemId: gameItemId || undefined,
        itemName: requiredString(body, 'itemName') || undefined,
        quantity: asInt(body.quantity, undefined) || undefined,
        steamId: requiredString(body, 'steamId') || undefined,
        userId: requiredString(body, 'userId') || undefined,
        purchaseCode: requiredString(body, 'purchaseCode') || undefined,
      });
      return sendJson(res, 200, { ok: true, data });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: String(error?.message || 'ไม่สามารถพรีวิวคำสั่งส่งของได้'),
      });
    }
  }

  if (pathname === '/admin/api/delivery/preflight') {
    try {
      const data = await getDeliveryPreflightReport({
        itemId: requiredString(body, 'itemId') || undefined,
        gameItemId: requiredString(body, 'gameItemId') || undefined,
        itemName: requiredString(body, 'itemName') || undefined,
        quantity: asInt(body.quantity, undefined) || undefined,
        steamId: requiredString(body, 'steamId') || undefined,
        userId: requiredString(body, 'userId') || undefined,
        purchaseCode: requiredString(body, 'purchaseCode') || undefined,
        inGameName: requiredString(body, 'inGameName') || undefined,
        teleportMode: requiredString(body, 'teleportMode') || undefined,
        teleportTarget: requiredString(body, 'teleportTarget') || undefined,
        returnTarget: requiredString(body, 'returnTarget') || undefined,
      });
      return sendJson(res, 200, { ok: true, data });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: String(error?.message || 'ไม่สามารถตรวจ preflight ส่งของได้'),
      });
    }
  }

  if (pathname === '/admin/api/delivery/simulate') {
    const itemId = requiredString(body, 'itemId');
    const gameItemId = requiredString(body, 'gameItemId');
    if (!itemId && !gameItemId) {
      return sendJson(res, 400, { ok: false, error: 'itemId or gameItemId is required' });
    }
    try {
      const data = await simulateDeliveryPlan({
        itemId: itemId || undefined,
        gameItemId: gameItemId || undefined,
        itemName: requiredString(body, 'itemName') || undefined,
        quantity: asInt(body.quantity, undefined) || undefined,
        steamId: requiredString(body, 'steamId') || undefined,
        userId: requiredString(body, 'userId') || undefined,
        purchaseCode: requiredString(body, 'purchaseCode') || undefined,
        inGameName: requiredString(body, 'inGameName') || undefined,
        teleportMode: requiredString(body, 'teleportMode') || undefined,
        teleportTarget: requiredString(body, 'teleportTarget') || undefined,
        returnTarget: requiredString(body, 'returnTarget') || undefined,
      });
      return sendJson(res, 200, { ok: true, data });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: String(error?.message || 'ไม่สามารถ simulate delivery plan ได้'),
      });
    }
  }

  if (pathname === '/admin/api/delivery/command-template') {
    try {
      const data = setDeliveryCommandOverride({
        lookupKey: requiredString(body, 'lookupKey') || undefined,
        itemId: requiredString(body, 'itemId') || undefined,
        gameItemId: requiredString(body, 'gameItemId') || undefined,
        command: body?.command,
        commands: body?.commands,
        clear: body?.clear === true,
        actor: auth?.user || 'unknown',
      });
      return sendJson(res, 200, { ok: true, data });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: String(error?.message || 'ไม่สามารถบันทึก command template ได้'),
      });
    }
  }

  if (pathname === '/admin/api/delivery/test-send') {
    const itemId = requiredString(body, 'itemId');
    const gameItemId = requiredString(body, 'gameItemId');
    if (!itemId && !gameItemId) {
      return sendJson(res, 400, { ok: false, error: 'itemId or gameItemId is required' });
    }
    try {
      const data = await sendTestDeliveryCommand({
        itemId: itemId || undefined,
        gameItemId: gameItemId || undefined,
        itemName: requiredString(body, 'itemName') || undefined,
        quantity: asInt(body.quantity, undefined) || undefined,
        steamId: requiredString(body, 'steamId') || undefined,
        userId: requiredString(body, 'userId') || undefined,
        purchaseCode: requiredString(body, 'purchaseCode') || undefined,
      });
      return sendJson(res, 200, { ok: true, data });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: String(error?.message || 'ไม่สามารถส่ง test item ได้'),
      });
    }
  }

  if (pathname === '/admin/api/delivery/capability-preset') {
    try {
      const data = saveAdminCommandCapabilityPreset({
        id: requiredString(body, 'id') || undefined,
        name: requiredString(body, 'name') || undefined,
        description: requiredString(body, 'description') || undefined,
        commands: body?.commands,
        defaults: {
          announceText: requiredString(body, 'announceText') || undefined,
          steamId: requiredString(body, 'steamId') || undefined,
          gameItemId: requiredString(body, 'gameItemId') || undefined,
          quantity: asInt(body.quantity, undefined) || undefined,
          teleportTarget: requiredString(body, 'teleportTarget') || undefined,
          returnTarget: requiredString(body, 'returnTarget') || undefined,
          inGameName: requiredString(body, 'inGameName') || undefined,
          itemName: requiredString(body, 'itemName') || undefined,
        },
        tags: parseStringArray(body?.tags),
      }, `admin-web:${auth?.user || 'unknown'}`);
      return sendJson(res, 200, { ok: true, data });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: String(error?.message || 'ไม่สามารถบันทึก capability preset ได้'),
      });
    }
  }

  if (pathname === '/admin/api/delivery/capability-preset/delete') {
    const presetId = requiredString(body, 'presetId') || requiredString(body, 'id');
    if (!presetId) {
      return sendJson(res, 400, { ok: false, error: 'presetId is required' });
    }
    const removed = deleteAdminCommandCapabilityPreset(presetId);
    if (!removed) {
      return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    }
    return sendJson(res, 200, {
      ok: true,
      data: {
        id: removed.id,
        name: removed.name,
      },
    });
  }

  if (pathname === '/admin/api/delivery/capability-test') {
    const presetId = requiredString(body, 'presetId');
    const preset = presetId ? getAdminCommandCapabilityPresetById(presetId) : null;
    if (presetId && !preset) {
      return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    }
    try {
      const data = await testScumAdminCommandCapability({
        capabilityId: requiredString(body, 'capabilityId') || undefined,
        presetId: preset?.id || null,
        name: preset?.name || undefined,
        description: preset?.description || undefined,
        commands: body?.commands || preset?.commandTemplates || undefined,
        dryRun: body?.dryRun === true,
        announceText: requiredString(body, 'announceText') || preset?.defaults?.announceText || undefined,
        steamId: requiredString(body, 'steamId') || preset?.defaults?.steamId || undefined,
        gameItemId: requiredString(body, 'gameItemId') || preset?.defaults?.gameItemId || undefined,
        quantity: asInt(body.quantity, undefined) || preset?.defaults?.quantity || undefined,
        teleportTarget: requiredString(body, 'teleportTarget') || preset?.defaults?.teleportTarget || undefined,
        returnTarget: requiredString(body, 'returnTarget') || preset?.defaults?.returnTarget || undefined,
        inGameName: requiredString(body, 'inGameName') || preset?.defaults?.inGameName || undefined,
        itemId: requiredString(body, 'itemId') || undefined,
        itemName: requiredString(body, 'itemName') || preset?.defaults?.itemName || undefined,
        purchaseCode: requiredString(body, 'purchaseCode') || undefined,
        userId: requiredString(body, 'userId') || undefined,
      });
      return sendJson(res, 200, { ok: true, data });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: String(error?.message || 'ไม่สามารถทดสอบ SCUM admin capability ได้'),
      });
    }
  }

  if (pathname === '/admin/api/rentbike/reset-now') {
    const reason = requiredString(body, 'reason') || `admin-web:${auth?.user || 'unknown'}`;
    await runRentBikeMidnightReset(reason);
    return sendJson(res, 200, {
      ok: true,
      data: {
        resetTriggered: true,
        reason,
        runtime: getRentBikeRuntime(),
      },
    });
  }

  if (pathname === '/admin/api/scum/status') {
    const onlinePlayers = asInt(body.onlinePlayers, undefined);
    const maxPlayers = asInt(body.maxPlayers, undefined);
    const pingMs = asInt(body.pingMs, undefined);
    const uptimeMinutes = asInt(body.uptimeMinutes, undefined);
    const result = updateScumStatusForAdmin({
      onlinePlayers,
      maxPlayers,
      pingMs,
      uptimeMinutes,
    });
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'Request failed' });
    }
    return sendJson(res, 200, { ok: true, data: getStatus() });
  }

  if (pathname === '/admin/api/backup/create') {
    const note = requiredString(body, 'note') || null;
    const saved = await createAdminBackup({
      client,
      actor: auth?.user || 'unknown',
      role: auth?.role || 'unknown',
      note,
      includeSnapshot: body?.includeSnapshot !== false,
      observabilitySnapshot: getCurrentObservabilitySnapshot(),
    });
    publishAdminLiveUpdate('backup-create', {
      backup: saved?.id || saved?.file || null,
      actor: auth?.user || 'unknown',
      role: auth?.role || 'unknown',
      note,
    });
    return sendJson(res, 200, {
      ok: true,
      data: saved,
    });
  }

  if (pathname === '/admin/api/backup/restore') {
    const backupName = requiredString(body, 'backup');
    const dryRun = body?.dryRun === true;
    if (!backupName) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    if (dryRun) {
      try {
        return sendJson(res, 200, {
          ok: true,
          data: await previewAdminBackupRestore(backupName, {
            client,
            observabilitySnapshot: getCurrentObservabilitySnapshot(),
          }),
        });
      } catch (error) {
        return sendJson(res, Number(error?.statusCode || 400), {
          ok: false,
          error: String(error?.message || 'Backup restore preview failed'),
          data: error?.data || null,
        });
      }
    }
    try {
      const restoreData = await restoreAdminBackup(backupName, {
        client,
        actor: auth?.user || 'unknown',
        role: auth?.role || 'unknown',
        confirmBackup: requiredString(body, 'confirmBackup') || '',
        observabilitySnapshot: getCurrentObservabilitySnapshot(),
      });
      return sendJson(res, 200, {
        ok: true,
        data: restoreData,
      });
    } catch (error) {
      return sendJson(res, Number(error?.statusCode || 500), {
        ok: false,
        error:
          Number(error?.statusCode || 500) >= 500
            ? 'Backup restore failed'
            : String(error?.message || 'Backup restore failed'),
        data: error?.data || null,
      });
    }
  }

  if (pathname === '/admin/api/platform/tenant') {
    const result = await createTenant({
      id: requiredString(body, 'id'),
      slug: requiredString(body, 'slug'),
      name: requiredString(body, 'name'),
      type: requiredString(body, 'type'),
      status: requiredString(body, 'status'),
      locale: requiredString(body, 'locale'),
      ownerName: requiredString(body, 'ownerName'),
      ownerEmail: requiredString(body, 'ownerEmail'),
      parentTenantId: requiredString(body, 'parentTenantId'),
      metadata: body.metadata,
    }, `admin-web:${auth?.user || 'unknown'}`);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'platform-tenant-failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.tenant });
  }

  if (pathname === '/admin/api/platform/subscription') {
    const result = await createSubscription({
      id: requiredString(body, 'id'),
      tenantId: requiredString(body, 'tenantId'),
      planId: requiredString(body, 'planId'),
      billingCycle: requiredString(body, 'billingCycle'),
      status: requiredString(body, 'status'),
      currency: requiredString(body, 'currency'),
      amountCents: body.amountCents,
      intervalDays: body.intervalDays,
      startedAt: body.startedAt,
      renewsAt: body.renewsAt,
      canceledAt: body.canceledAt,
      externalRef: requiredString(body, 'externalRef'),
      metadata: body.metadata,
    }, `admin-web:${auth?.user || 'unknown'}`);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'platform-subscription-failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.subscription });
  }

  if (pathname === '/admin/api/platform/license') {
    const result = await issuePlatformLicense({
      id: requiredString(body, 'id'),
      tenantId: requiredString(body, 'tenantId'),
      licenseKey: requiredString(body, 'licenseKey'),
      status: requiredString(body, 'status'),
      seats: body.seats,
      issuedAt: body.issuedAt,
      expiresAt: body.expiresAt,
      legalDocVersion: requiredString(body, 'legalDocVersion'),
      legalAcceptedAt: body.legalAcceptedAt,
      metadata: body.metadata,
    }, `admin-web:${auth?.user || 'unknown'}`);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'platform-license-failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.license });
  }

  if (pathname === '/admin/api/platform/license/accept-legal') {
    const result = await acceptPlatformLicenseLegal({
      licenseId: requiredString(body, 'licenseId'),
      legalDocVersion: requiredString(body, 'legalDocVersion'),
      metadata: body.metadata,
    }, `admin-web:${auth?.user || 'unknown'}`);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'platform-license-legal-failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.license });
  }

  if (pathname === '/admin/api/platform/apikey') {
    const result = await createPlatformApiKey({
      id: requiredString(body, 'id'),
      tenantId: requiredString(body, 'tenantId'),
      name: requiredString(body, 'name'),
      status: requiredString(body, 'status'),
      scopes: parseStringArray(body.scopes),
    }, `admin-web:${auth?.user || 'unknown'}`);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'platform-apikey-failed' });
    }
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/platform/webhook') {
    const result = await createPlatformWebhookEndpoint({
      id: requiredString(body, 'id'),
      tenantId: requiredString(body, 'tenantId'),
      name: requiredString(body, 'name'),
      eventType: requiredString(body, 'eventType'),
      targetUrl: requiredString(body, 'targetUrl'),
      secretValue: requiredString(body, 'secretValue'),
      enabled: body.enabled !== false,
    }, `admin-web:${auth?.user || 'unknown'}`);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'platform-webhook-failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.webhook });
  }

  if (pathname === '/admin/api/platform/marketplace') {
    const result = await createMarketplaceOffer({
      id: requiredString(body, 'id'),
      tenantId: requiredString(body, 'tenantId'),
      title: requiredString(body, 'title'),
      kind: requiredString(body, 'kind'),
      priceCents: body.priceCents,
      currency: requiredString(body, 'currency'),
      status: requiredString(body, 'status'),
      locale: requiredString(body, 'locale'),
      meta: body.meta,
    }, `admin-web:${auth?.user || 'unknown'}`);
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: result.reason || 'platform-marketplace-failed' });
    }
    return sendJson(res, 200, { ok: true, data: result.offer });
  }

  if (pathname === '/admin/api/platform/reconcile') {
    const result = await reconcileDeliveryState({
      windowMs: body.windowMs,
      pendingOverdueMs: body.pendingOverdueMs,
    });
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/platform/monitoring/run') {
    const result = await runPlatformMonitoringCycle({
      client,
      force: true,
    });
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/notifications/ack') {
    const ids = parseStringArray(body?.ids);
    if (ids.length === 0) {
      return sendJson(res, 400, { ok: false, error: 'ids is required' });
    }
    return sendJson(res, 200, {
      ok: true,
      data: acknowledgeAdminNotifications(ids, auth?.user || 'unknown'),
    });
  }

  if (pathname === '/admin/api/notifications/clear') {
    return sendJson(res, 200, {
      ok: true,
      data: clearAdminNotifications({
        acknowledgedOnly: body?.acknowledgedOnly === true,
      }),
    });
  }

  return sendJson(res, 404, { ok: false, error: 'Resource not found' });
}

async function exchangeDiscordOauthCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: SSO_DISCORD_CLIENT_ID,
    client_secret: SSO_DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Discord token exchange failed (${res.status})`);
  }
  if (!data.access_token) {
    throw new Error('Discord token response missing access_token');
  }
  return data;
}

async function fetchDiscordProfile(accessToken) {
  const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error('Discord profile fetch failed');
  }
  return data;
}

async function fetchDiscordGuildMember(accessToken, guildId) {
  if (!guildId) return null;
  const res = await fetch(
    `${DISCORD_API_BASE}/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!res.ok) {
    throw new Error('Discord guild member fetch failed');
  }
  return res.json().catch(() => null);
}

function buildDiscordAuthorizeUrl({ host, port, state }) {
  const redirectUri = getDiscordRedirectUri(host, port);
  const scopes = SSO_DISCORD_GUILD_ID
    ? 'identify guilds.members.read'
    : 'identify';
  const url = new URL(`${DISCORD_API_BASE}/oauth2/authorize`);
  url.searchParams.set('client_id', SSO_DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', state);
  return url.toString();
}

// The admin web server bundles static UI, JSON APIs, SSE live updates, and auth flows
// because operators need one coherent control plane during incidents.
function startAdminWebServer(client) {
  if (adminServer) return adminServer;

  const host = String(process.env.ADMIN_WEB_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = asInt(process.env.ADMIN_WEB_PORT, 3200) || 3200;
  const allowedOrigins = buildAllowedOrigins(host, port);
  const token = getAdminToken();
  ensureMetricsSeriesTimer();
  startPlatformMonitoring({ client });
  if (!liveBusBound) {
    adminLiveBus.on('update', (evt) => {
      broadcastLiveUpdate(evt?.type || 'update', evt?.payload || {});
    });
    liveBusBound = true;
  }

  adminServer = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || '/', `http://${host}:${port}`);
    const { pathname } = urlObj;

    if (await tryServeStaticScumIcon(req, res, pathname)) {
      return;
    }

    if (req.method === 'GET' && pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }

    if (req.method === 'GET' && pathname === '/healthz') {
      return sendJson(res, 200, {
        ok: true,
        data: {
          now: new Date().toISOString(),
          service: 'admin-web',
          uptimeSec: Math.round(process.uptime()),
          persistence: getPersistenceStatus(),
          delivery: typeof getDeliveryMetricsSnapshot === 'function'
            ? getDeliveryMetricsSnapshot()
            : null,
        },
      });
    }

    if (req.method === 'GET' && (pathname === '/admin/login' || pathname === '/admin/login/')) {
      if (isAuthorized(req, urlObj)) {
        res.writeHead(302, { Location: '/admin' });
        return res.end();
      }
      return sendHtml(res, 200, getLoginHtml());
    }

    if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
      if (!isAuthorized(req, urlObj)) {
        res.writeHead(302, { Location: '/admin/login' });
        return res.end();
      }
      return sendHtml(res, 200, getDashboardHtml());
    }

    if (req.method === 'GET' && pathname === '/platform/api/v1/public/overview') {
      return sendJson(res, 200, {
        ok: true,
        data: await getPlatformPublicOverview(),
      });
    }

    if (pathname.startsWith('/platform/api/v1/')) {
      try {
        if (req.method === 'GET' && pathname === '/platform/api/v1/tenant/self') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['tenant:read']);
          if (!platformAuth) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: {
              tenant: platformAuth.tenant,
              apiKey: platformAuth.apiKey,
              scopes: platformAuth.scopes,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/platform/api/v1/analytics/overview') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['analytics:read']);
          if (!platformAuth) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: await getPlatformAnalyticsOverview(),
          });
        }

        if (req.method === 'POST' && pathname === '/platform/api/v1/agent/heartbeat') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['agent:write']);
          if (!platformAuth) return undefined;
          const body = await readJsonBody(req);
          const result = await recordPlatformAgentHeartbeat({
            tenantId: platformAuth.tenant?.id,
            runtimeKey: requiredString(body, 'runtimeKey'),
            version: requiredString(body, 'version'),
            channel: requiredString(body, 'channel'),
            status: requiredString(body, 'status'),
            minRequiredVersion: requiredString(body, 'minRequiredVersion'),
            meta: body.meta,
          }, 'platform-api');
          if (!result.ok) {
            return sendJson(res, 400, { ok: false, error: result.reason || 'platform-agent-heartbeat-failed' });
          }
          return sendJson(res, 200, { ok: true, data: result.runtime });
        }

        if (req.method === 'POST' && pathname === '/platform/api/v1/delivery/reconcile') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['delivery:reconcile']);
          if (!platformAuth) return undefined;
          const body = await readJsonBody(req);
          return sendJson(res, 200, {
            ok: true,
            data: await reconcileDeliveryState({
              windowMs: body.windowMs,
              pendingOverdueMs: body.pendingOverdueMs,
            }),
          });
        }

        return sendJson(res, 404, { ok: false, error: 'Resource not found' });
      } catch (error) {
        return sendJson(res, Number(error?.statusCode || 500), {
          ok: false,
          error:
            Number(error?.statusCode || 500) >= 500
              ? 'Internal platform API error'
              : String(error?.message || 'Bad request'),
        });
      }
    }

    if (req.method === 'GET' && pathname === '/admin/auth/discord/start') {
      if (!SSO_DISCORD_ACTIVE) {
        return sendText(res, 404, 'SSO is disabled');
      }
      cleanupDiscordOauthStates();
      const state = crypto.randomBytes(18).toString('hex');
      discordOauthStates.set(state, {
        createdAt: Date.now(),
      });
      const authorizeUrl = buildDiscordAuthorizeUrl({
        host,
        port,
        state,
      });
      res.writeHead(302, { Location: authorizeUrl });
      return res.end();
    }

    if (req.method === 'GET' && pathname === '/admin/auth/discord/callback') {
      if (!SSO_DISCORD_ACTIVE) {
        return sendText(res, 404, 'SSO is disabled');
      }
      try {
        cleanupDiscordOauthStates();
        const code = String(urlObj.searchParams.get('code') || '').trim();
        const state = String(urlObj.searchParams.get('state') || '').trim();
        const errorText = String(urlObj.searchParams.get('error') || '').trim();
        if (errorText) {
          res.writeHead(302, {
            Location: `/admin/login?error=${encodeURIComponent('Discord authorization denied')}`,
          });
          return res.end();
        }
        if (!code || !state || !discordOauthStates.has(state)) {
          res.writeHead(302, {
            Location: `/admin/login?error=${encodeURIComponent('Invalid SSO state')}`,
          });
          return res.end();
        }
        discordOauthStates.delete(state);

        const redirectUri = getDiscordRedirectUri(host, port);
        const tokenResult = await exchangeDiscordOauthCode(code, redirectUri);
        const profile = await fetchDiscordProfile(tokenResult.access_token);
        let resolvedRole = SSO_DISCORD_DEFAULT_ROLE;
        if (SSO_DISCORD_GUILD_ID) {
          const member = await fetchDiscordGuildMember(
            tokenResult.access_token,
            SSO_DISCORD_GUILD_ID,
          );
          resolvedRole = getSsoDiscordRole(member?.roles || []);
        }

        const username = profile.username && profile.discriminator
          ? `${profile.username}#${profile.discriminator}`
          : String(profile.username || profile.id);
        const sessionId = createSession(username, resolvedRole, 'discord-sso');
        res.writeHead(302, {
          Location: '/admin',
          'Set-Cookie': buildSessionCookie(sessionId),
        });
        return res.end();
      } catch (error) {
        console.error('[admin-web] discord sso callback failed', error);
        res.writeHead(302, {
          Location: `/admin/login?error=${encodeURIComponent('Discord SSO failed')}`,
        });
        return res.end();
      }
    }

    if (pathname.startsWith('/admin/api/')) {
      try {
        if (
          hasValidSession(req) &&
          !isSafeHttpMethod(req.method) &&
          violatesBrowserOriginPolicy(req, allowedOrigins)
        ) {
          return sendJson(res, 403, {
            ok: false,
            error: 'Cross-site request denied',
          });
        }

        if (req.method === 'POST' && pathname === '/admin/api/login') {
          const rateLimit = getLoginRateLimitState(req);
          if (rateLimit.limited) {
            const retryAfterSec = Math.max(
              1,
              Math.ceil(rateLimit.retryAfterMs / 1000),
            );
            return sendJson(
              res,
              429,
              {
                ok: false,
                error: `Too many login attempts. Please wait ${retryAfterSec}s and try again.`,
              },
              {
                'Retry-After': String(retryAfterSec),
              },
            );
          }

          const body = await readJsonBody(req);
          const username = requiredString(body, 'username');
          const password = requiredString(body, 'password');
          if (!username || !password) {
            return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
          }

          const user = await getUserByCredentials(username, password);
          if (!user) {
            recordLoginAttempt(req, false);
            return sendJson(res, 401, { ok: false, error: 'Invalid username or password' });
          }

          if (ADMIN_WEB_2FA_ACTIVE) {
            const otp = requiredString(body, 'otp');
            if (!otp) {
              recordLoginAttempt(req, false);
              return sendJson(res, 401, {
                ok: false,
                error: 'OTP required',
                requiresOtp: true,
              });
            }
            if (!verifyTotpCode(ADMIN_WEB_2FA_SECRET, otp, ADMIN_WEB_2FA_WINDOW_STEPS)) {
              recordLoginAttempt(req, false);
              return sendJson(res, 401, { ok: false, error: 'Invalid 2FA code' });
            }
          }

          recordLoginAttempt(req, true);
          const sessionId = createSession(user.username, user.role, user.authMethod);
          return sendJson(
            res,
            200,
            {
              ok: true,
              data: {
                user: user.username,
                role: user.role,
                sessionTtlHours: Math.round(SESSION_TTL_MS / (60 * 60 * 1000)),
              },
            },
            {
              'Set-Cookie': buildSessionCookie(sessionId),
            },
          );
        }

        if (req.method === 'POST' && pathname === '/admin/api/logout') {
          const sessionId = getSessionId(req);
          invalidateSession(sessionId);
          return sendJson(
            res,
            200,
            { ok: true, data: { loggedOut: true } },
            { 'Set-Cookie': buildClearSessionCookie() },
          );
        }

        if (
          req.method === 'POST'
          && !shouldBypassRestoreMaintenance(pathname)
          && isAdminRestoreMaintenanceActive()
        ) {
          return sendRestoreMaintenanceUnavailable(res);
        }

        if (req.method === 'GET' && pathname === '/admin/api/auth/providers') {
          return sendJson(res, 200, {
            ok: true,
            data: {
              loginSource: 'database',
              password: true,
              discordSso: SSO_DISCORD_ACTIVE,
              twoFactor: ADMIN_WEB_2FA_ACTIVE,
              sessionCookie: {
                name: SESSION_COOKIE_NAME,
                path: SESSION_COOKIE_PATH,
                sameSite: SESSION_COOKIE_SAMESITE,
                secure: SESSION_SECURE_COOKIE,
                domain: SESSION_COOKIE_DOMAIN || null,
              },
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/me') {
          const auth = getAuthContext(req, urlObj);
          if (!auth) {
            return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          }
          return sendJson(res, 200, {
            ok: true,
            data: {
              user: auth.user,
              role: auth.role,
              authMethod: auth.authMethod,
              session: hasValidSession(req),
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/health') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const runtimeSupervisor = await getRuntimeSupervisorSnapshot().catch(() => null);
          return sendJson(res, 200, {
            ok: true,
            data: {
              now: new Date().toISOString(),
              guilds: client.guilds.cache.size,
              role: auth.role,
              runtimeSupervisor,
              backupRestore: getAdminRestoreState(),
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/backup/restore/status') {
          const auth = ensureRole(req, urlObj, 'owner', res);
          if (!auth) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: getAdminRestoreState(),
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/overview') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: {
              analytics: await getPlatformAnalyticsOverview(),
              publicOverview: await getPlatformPublicOverview(),
              permissionCatalog: getPlatformPermissionCatalog(),
              plans: getPlanCatalog(),
              opsState: getPlatformOpsState(),
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/ops-state') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: getPlatformOpsState(),
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/tenants') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await listPlatformTenants({
            limit: asInt(urlObj.searchParams.get('limit'), 100) || 100,
            status: requiredString(urlObj.searchParams.get('status')),
            type: requiredString(urlObj.searchParams.get('type')),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/subscriptions') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await listPlatformSubscriptions({
            limit: asInt(urlObj.searchParams.get('limit'), 100) || 100,
            tenantId: requiredString(urlObj.searchParams.get('tenantId')),
            status: requiredString(urlObj.searchParams.get('status')),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/licenses') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await listPlatformLicenses({
            limit: asInt(urlObj.searchParams.get('limit'), 100) || 100,
            tenantId: requiredString(urlObj.searchParams.get('tenantId')),
            status: requiredString(urlObj.searchParams.get('status')),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/apikeys') {
          const auth = ensureRole(req, urlObj, 'owner', res);
          if (!auth) return undefined;
          const data = await listPlatformApiKeys({
            limit: asInt(urlObj.searchParams.get('limit'), 100) || 100,
            tenantId: requiredString(urlObj.searchParams.get('tenantId')),
            status: requiredString(urlObj.searchParams.get('status')),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/webhooks') {
          const auth = ensureRole(req, urlObj, 'owner', res);
          if (!auth) return undefined;
          const data = await listPlatformWebhookEndpoints({
            limit: asInt(urlObj.searchParams.get('limit'), 100) || 100,
            tenantId: requiredString(urlObj.searchParams.get('tenantId')),
            eventType: requiredString(urlObj.searchParams.get('eventType')),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/agents') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await listPlatformAgentRuntimes({
            limit: asInt(urlObj.searchParams.get('limit'), 100) || 100,
            tenantId: requiredString(urlObj.searchParams.get('tenantId')),
            status: requiredString(urlObj.searchParams.get('status')),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/marketplace') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await listMarketplaceOffers({
            limit: asInt(urlObj.searchParams.get('limit'), 100) || 100,
            tenantId: requiredString(urlObj.searchParams.get('tenantId')),
            status: requiredString(urlObj.searchParams.get('status')),
            locale: requiredString(urlObj.searchParams.get('locale')),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/platform/reconcile') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await reconcileDeliveryState({
            windowMs: asInt(urlObj.searchParams.get('windowMs'), null),
            pendingOverdueMs: asInt(urlObj.searchParams.get('pendingOverdueMs'), null),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/runtime/supervisor') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const forceRefresh =
            String(urlObj.searchParams.get('refresh') || '').trim() === '1'
            || String(urlObj.searchParams.get('refresh') || '').trim().toLowerCase() === 'true';
          const data = await getRuntimeSupervisorSnapshot({ forceRefresh });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/observability') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const windowMs = clampMetricsWindowMs(
            urlObj.searchParams.get('windowMs'),
          );
          const seriesKeys = parseMetricsSeriesKeys(
            urlObj.searchParams.get('series'),
          );
          return sendJson(res, 200, {
            ok: true,
            data: getCurrentObservabilitySnapshot({
              windowMs,
              seriesKeys,
            }),
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/observability/export') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const windowMs = clampMetricsWindowMs(
            urlObj.searchParams.get('windowMs'),
          );
          const seriesKeys = parseMetricsSeriesKeys(
            urlObj.searchParams.get('series'),
          );
          const format = String(urlObj.searchParams.get('format') || 'json').trim().toLowerCase();
          const data = getCurrentObservabilitySnapshot({
            windowMs,
            seriesKeys,
          });
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          if (format === 'csv') {
            return sendDownload(
              res,
              200,
              buildObservabilityCsv(data),
              {
                filename: `observability-${timestamp}.csv`,
                contentType: 'text/csv; charset=utf-8',
              },
            );
          }
          return sendDownload(
            res,
            200,
            `${JSON.stringify(buildObservabilityExportPayload(data), jsonReplacer, 2)}\n`,
            {
              filename: `observability-${timestamp}.json`,
              contentType: 'application/json; charset=utf-8',
            },
          );
        }

        if (req.method === 'GET' && pathname === '/admin/api/live') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          openLiveStream(req, res);
          return undefined;
        }

        if (req.method === 'GET' && pathname === '/admin/api/items/catalog') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const query = String(urlObj.searchParams.get('q') || '').trim();
          const limit = asInt(urlObj.searchParams.get('limit'), 120);
          const items = listItemIconCatalog(query, limit || 120);
          return sendJson(res, 200, {
            ok: true,
            data: {
              total: items.length,
              query,
              items,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/items/weapons-catalog') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const query = String(urlObj.searchParams.get('q') || '').trim();
          const limit = asInt(urlObj.searchParams.get('limit'), 200);
          const items = listWikiWeaponCatalog(query, limit || 200);
          return sendJson(res, 200, {
            ok: true,
            data: {
              query,
              total: items.length,
              meta: getWikiWeaponCatalogMeta(),
              items,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/items/manifest-catalog') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const query = String(urlObj.searchParams.get('q') || '').trim();
          const category = String(urlObj.searchParams.get('category') || '').trim();
          const limit = asInt(urlObj.searchParams.get('limit'), 300);
          const items = listManifestItemCatalog({
            query,
            category,
            limit: limit || 300,
          });
          return sendJson(res, 200, {
            ok: true,
            data: {
              query,
              category,
              total: items.length,
              meta: getManifestItemCatalogMeta(),
              items,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/shop/list') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const q = String(urlObj.searchParams.get('q') || '').trim();
          const kind = String(urlObj.searchParams.get('kind') || 'all').trim();
          const limit = asInt(urlObj.searchParams.get('limit'), 200) || 200;
          const rows = await listShopItems();
          const items = filterShopItems(rows, { q, kind, limit });
          return sendJson(res, 200, {
            ok: true,
            data: {
              query: q,
              kind,
              total: items.length,
              items,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/purchase/list') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const userId = requiredString(urlObj.searchParams.get('userId'));
          if (!userId) {
            return sendJson(res, 400, {
              ok: false,
              error: 'Invalid request payload',
            });
          }
          const limit = Math.max(
            1,
            Math.min(1000, asInt(urlObj.searchParams.get('limit'), 100) || 100),
          );
          const statusFilter = normalizePurchaseStatus(
            String(urlObj.searchParams.get('status') || ''),
          );
          const rows = await listUserPurchases(userId);
          const items = rows
            .filter((row) => !statusFilter || normalizePurchaseStatus(row.status) === statusFilter)
            .slice(0, limit);
          return sendJson(res, 200, {
            ok: true,
            data: {
              userId,
              total: items.length,
              items,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/portal/player/dashboard') {
          const portal = ensurePortalTokenAuth(req, urlObj, res);
          if (!portal) return undefined;
          const dashboard = await getPlayerDashboard(portal.discordId);
          if (!dashboard.ok) {
            return sendJson(res, 400, {
              ok: false,
              error: dashboard.reason || 'Cannot build player dashboard',
            });
          }
          return sendJson(res, 200, {
            ok: true,
            data: dashboard.data,
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/portal/shop/list') {
          const portal = ensurePortalTokenAuth(req, urlObj, res);
          if (!portal) return undefined;
          const q = String(urlObj.searchParams.get('q') || '').trim();
          const kind = String(urlObj.searchParams.get('kind') || 'all').trim();
          const limit = asInt(urlObj.searchParams.get('limit'), 120) || 120;
          const rows = await listShopItems();
          const items = filterShopItems(rows, { q, kind, limit });
          return sendJson(res, 200, {
            ok: true,
            data: {
              query: q,
              kind,
              total: items.length,
              items,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/portal/purchase/list') {
          const portal = ensurePortalTokenAuth(req, urlObj, res);
          if (!portal) return undefined;
          const limit = Math.max(
            1,
            Math.min(200, asInt(urlObj.searchParams.get('limit'), 40) || 40),
          );
          const statusFilter = normalizePurchaseStatus(
            String(urlObj.searchParams.get('status') || ''),
          );
          const rows = await listUserPurchases(portal.discordId);
          const items = rows
            .filter((row) => !statusFilter || normalizePurchaseStatus(row.status) === statusFilter)
            .slice(0, limit);
          return sendJson(res, 200, {
            ok: true,
            data: {
              userId: portal.discordId,
              total: items.length,
              items,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/portal/bounty/list') {
          const portal = ensurePortalTokenAuth(req, urlObj, res);
          if (!portal) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: {
              total: listActiveBountiesForUser().length,
              items: listActiveBountiesForUser(),
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/delivery/queue') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const limit = asInt(urlObj.searchParams.get('limit'), 500) || 500;
          const errorCode = String(urlObj.searchParams.get('errorCode') || '').trim();
          const q = String(urlObj.searchParams.get('q') || '').trim();
          return sendJson(res, 200, {
            ok: true,
            data: listFilteredDeliveryQueue({
              limit,
              errorCode,
              q,
            }),
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/delivery/dead-letter') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const limit = asInt(urlObj.searchParams.get('limit'), 500) || 500;
          return sendJson(res, 200, {
            ok: true,
            data: listFilteredDeliveryDeadLetters({
              limit,
              errorCode: String(urlObj.searchParams.get('errorCode') || '').trim(),
              q: String(urlObj.searchParams.get('q') || '').trim(),
            }),
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/delivery/runtime') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await getDeliveryRuntimeStatus();
          return sendJson(res, 200, {
            ok: true,
            data,
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/delivery/capabilities') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: {
              builtin: listScumAdminCommandCapabilities(),
              presets: listAdminCommandCapabilityPresets(200),
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/delivery/command-template') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          try {
            const data = getDeliveryCommandOverride({
              lookupKey: String(urlObj.searchParams.get('lookupKey') || '').trim() || undefined,
              itemId: String(urlObj.searchParams.get('itemId') || '').trim() || undefined,
              gameItemId: String(urlObj.searchParams.get('gameItemId') || '').trim() || undefined,
            });
            return sendJson(res, 200, {
              ok: true,
              data,
            });
          } catch (error) {
            return sendJson(res, 400, {
              ok: false,
              error: String(error?.message || 'ไม่สามารถโหลด command template ได้'),
            });
          }
        }

        if (req.method === 'GET' && pathname === '/admin/api/delivery/detail') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const purchaseCode = String(urlObj.searchParams.get('code') || '').trim();
          if (!purchaseCode) {
            return sendJson(res, 400, {
              ok: false,
              error: 'code is required',
            });
          }
          try {
            const data = await getDeliveryDetailsByPurchaseCode(
              purchaseCode,
              asInt(urlObj.searchParams.get('limit'), 50) || 50,
            );
            const hasData = Boolean(
              data?.purchase
                || data?.queueJob
                || data?.deadLetter
                || (Array.isArray(data?.auditRows) && data.auditRows.length > 0),
            );
            if (!hasData) {
              return sendJson(res, 404, {
                ok: false,
                error: 'Resource not found',
              });
            }
            return sendJson(res, 200, {
              ok: true,
              data,
            });
          } catch (error) {
            return sendJson(res, 400, {
              ok: false,
              error: String(error?.message || 'ไม่สามารถโหลดรายละเอียด delivery ได้'),
            });
          }
        }

        if (req.method === 'GET' && pathname === '/admin/api/notifications') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const acknowledgedRaw = String(urlObj.searchParams.get('acknowledged') || '').trim().toLowerCase();
          const acknowledged =
            acknowledgedRaw === 'true'
              ? true
              : acknowledgedRaw === 'false'
                ? false
                : null;
          return sendJson(res, 200, {
            ok: true,
            data: {
              items: listAdminNotifications({
                limit: asInt(urlObj.searchParams.get('limit'), 100) || 100,
                type: String(urlObj.searchParams.get('type') || '').trim(),
                kind: String(urlObj.searchParams.get('kind') || '').trim(),
                severity: String(urlObj.searchParams.get('severity') || '').trim(),
                entityKey: String(urlObj.searchParams.get('entityKey') || '').trim(),
                acknowledged,
              }),
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/purchase/statuses') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const current = normalizePurchaseStatus(
            String(urlObj.searchParams.get('current') || ''),
          );
          return sendJson(res, 200, {
            ok: true,
            data: {
              knownStatuses: listKnownPurchaseStatuses(),
              currentStatus: current || null,
              allowedTransitions: current
                ? listAllowedPurchaseTransitions(current)
                : [],
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/audit/query') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await buildAuditDatasetService({
            prisma,
            listEvents,
            getParticipants,
            view: urlObj.searchParams.get('view'),
            query: urlObj.searchParams.get('q'),
            userId: urlObj.searchParams.get('userId'),
            reason: urlObj.searchParams.get('reason'),
            status: urlObj.searchParams.get('status'),
            statusMode: urlObj.searchParams.get('statusMode'),
            actor: urlObj.searchParams.get('actor'),
            actorMode: urlObj.searchParams.get('actorMode'),
            reference: urlObj.searchParams.get('reference'),
            referenceMode: urlObj.searchParams.get('referenceMode'),
            windowMs: urlObj.searchParams.get('windowMs'),
            dateFrom: urlObj.searchParams.get('dateFrom'),
            dateTo: urlObj.searchParams.get('dateTo'),
            sortBy: urlObj.searchParams.get('sortBy'),
            sortOrder: urlObj.searchParams.get('sortOrder'),
            cursor: urlObj.searchParams.get('cursor'),
            page: urlObj.searchParams.get('page'),
            pageSize: urlObj.searchParams.get('pageSize') || urlObj.searchParams.get('limit'),
          });
          return sendJson(res, 200, {
            ok: true,
            data: {
              ...data,
              exportPayload: buildAuditExportPayloadService(data),
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/audit/presets') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await listAuditPresetsService({
            prisma,
            authUser: auth.user,
            authRole: auth.role,
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'POST' && pathname === '/admin/api/audit/presets') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const body = await readJsonBody(req);
          try {
            const data = await saveAuditPresetService({
              prisma,
              actor: `admin-web:${auth?.user || 'unknown'}`,
              authUser: auth.user,
              authRole: auth.role,
              id: body?.id,
              payload: body,
            });
            return sendJson(res, 200, { ok: true, data });
          } catch (error) {
            return sendJson(res, Number(error?.statusCode || 400), {
              ok: false,
              error: String(error?.message || 'Invalid request payload'),
            });
          }
        }

        if (req.method === 'POST' && pathname === '/admin/api/audit/presets/delete') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const body = await readJsonBody(req);
          try {
            const removed = await deleteAuditPresetService({
              prisma,
              id: body?.id,
              authUser: auth.user,
              authRole: auth.role,
            });
            if (!removed) {
              return sendJson(res, 404, {
                ok: false,
                error: 'Resource not found',
              });
            }
            return sendJson(res, 200, {
              ok: true,
              data: { id: String(body?.id || '').trim() },
            });
          } catch (error) {
            return sendJson(res, Number(error?.statusCode || 400), {
              ok: false,
              error: String(error?.message || 'Invalid request payload'),
            });
          }
        }

        if (req.method === 'GET' && pathname === '/admin/api/audit/export') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const format = String(urlObj.searchParams.get('format') || 'json').trim().toLowerCase();
          const data = await buildAuditDatasetService({
            prisma,
            listEvents,
            getParticipants,
            view: urlObj.searchParams.get('view'),
            query: urlObj.searchParams.get('q'),
            userId: urlObj.searchParams.get('userId'),
            reason: urlObj.searchParams.get('reason'),
            status: urlObj.searchParams.get('status'),
            statusMode: urlObj.searchParams.get('statusMode'),
            actor: urlObj.searchParams.get('actor'),
            actorMode: urlObj.searchParams.get('actorMode'),
            reference: urlObj.searchParams.get('reference'),
            referenceMode: urlObj.searchParams.get('referenceMode'),
            windowMs: urlObj.searchParams.get('windowMs'),
            dateFrom: urlObj.searchParams.get('dateFrom'),
            dateTo: urlObj.searchParams.get('dateTo'),
            sortBy: urlObj.searchParams.get('sortBy'),
            sortOrder: urlObj.searchParams.get('sortOrder'),
            exportAll: true,
            pageSize: 5000,
          });
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          if (format === 'csv') {
            return sendDownload(
              res,
              200,
              buildAuditCsvService(data),
              {
                filename: `audit-${data.view}-${timestamp}.csv`,
                contentType: 'text/csv; charset=utf-8',
              },
            );
          }
          return sendDownload(
            res,
            200,
            `${JSON.stringify(buildAuditExportPayloadService(data), jsonReplacer, 2)}\n`,
            {
              filename: `audit-${data.view}-${timestamp}.json`,
              contentType: 'application/json; charset=utf-8',
            },
          );
        }

        if (req.method === 'GET' && pathname === '/admin/api/dashboard/cards') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await buildAdminDashboardCards({
            prisma,
            client,
            forceRefresh:
              String(urlObj.searchParams.get('refresh') || '').trim() === '1'
              || String(urlObj.searchParams.get('refresh') || '').trim().toLowerCase() === 'true',
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/player/accounts') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const limit = asInt(urlObj.searchParams.get('limit'), 200) || 200;
          const rows = await listPlayerAccounts(limit);
          return sendJson(res, 200, {
            ok: true,
            data: rows,
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/player/dashboard') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const userId = requiredString(urlObj.searchParams.get('userId'));
          if (!userId) {
            return sendJson(res, 400, {
              ok: false,
              error: 'Invalid request payload',
            });
          }
          const dashboard = await getPlayerDashboard(userId);
          if (!dashboard.ok) {
            return sendJson(res, 400, {
              ok: false,
              error: dashboard.reason || 'Cannot build player dashboard',
            });
          }
          return sendJson(res, 200, {
            ok: true,
            data: dashboard.data,
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/snapshot') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await buildAdminSnapshot({
            client,
            observabilitySnapshot: getCurrentObservabilitySnapshot(),
          });
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/snapshot/export') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const data = await buildAdminSnapshot({
            client,
            observabilitySnapshot: getCurrentObservabilitySnapshot(),
          });
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          return sendDownload(
            res,
            200,
            `${JSON.stringify({ ok: true, data }, jsonReplacer, 2)}\n`,
            {
              filename: `snapshot-${timestamp}.json`,
              contentType: 'application/json; charset=utf-8',
            },
          );
        }

        if (req.method === 'GET' && pathname === '/admin/api/backup/list') {
          const auth = ensureRole(req, urlObj, 'owner', res);
          if (!auth) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: listAdminBackupFiles(),
          });
        }

        if (req.method === 'POST' && pathname === '/admin/api/portal/redeem') {
          const portal = ensurePortalTokenAuth(req, urlObj, res);
          if (!portal) return undefined;
          const body = await readJsonBody(req);
          const code = requiredString(body, 'code');
          if (!code) {
            return sendJson(res, 400, {
              ok: false,
              error: 'Invalid request payload',
            });
          }

          const result = await redeemCodeForUser({
            userId: portal.discordId,
            code,
            actor: `portal:${portal.forwardedUser}`,
            source: 'player-portal',
          });
          if (!result.ok) {
            const status =
              result.reason === 'code-not-found' || result.reason === 'code-already-used'
                ? 400
                : 500;
            return sendJson(res, status, {
              ok: false,
              error: result.reason,
              data: result,
            });
          }
          return sendJson(res, 200, {
            ok: true,
            data: {
              ...result,
              message:
                result.type === 'coins'
                  ? `ใช้โค้ดสำเร็จ ได้รับ ${result.amount} เหรียญ`
                  : 'ใช้โค้ดสำเร็จ',
            },
          });
        }

        if (req.method === 'POST' && pathname === '/admin/api/portal/rentbike/request') {
          const portal = ensurePortalTokenAuth(req, urlObj, res);
          if (!portal) return undefined;
          const body = await readJsonBody(req).catch(() => ({}));
          const result = await requestRentBikeForUser({
            discordUserId: portal.discordId,
            guildId: requiredString(body, 'guildId') || null,
          });
          if (!result.ok) {
            return sendJson(res, 400, {
              ok: false,
              error: result.reason || 'rentbike-failed',
              data: result,
            });
          }
          return sendJson(res, 200, {
            ok: true,
            data: result,
          });
        }

        if (req.method === 'POST' && pathname === '/admin/api/portal/bounty/add') {
          const portal = ensurePortalTokenAuth(req, urlObj, res);
          if (!portal) return undefined;
          const body = await readJsonBody(req);
          const targetName = requiredString(body, 'targetName');
          const amount = Number(body?.amount);
          const result = createBountyForUser({
            createdBy: portal.discordId,
            targetName,
            amount,
          });
          if (!result.ok) {
            return sendJson(res, 400, {
              ok: false,
              error: result.reason || 'bounty-create-failed',
            });
          }
          return sendJson(res, 200, {
            ok: true,
            data: result,
          });
        }

        if (req.method === 'POST') {
          const requiredRole = requiredRoleForPostPath(pathname);
          const auth = ensureRole(req, urlObj, requiredRole, res);
          if (!auth) return undefined;
          const body = await readJsonBody(req);
          const out = await handlePostAction(client, pathname, body, res, auth);
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            res.writableEnded &&
            pathname !== '/admin/api/login' &&
            pathname !== '/admin/api/logout'
          ) {
            publishAdminLiveUpdate('admin-action', {
              path: pathname,
              user: auth.user,
              role: auth.role,
            });
          }
          return out;
        }

        return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      } catch (error) {
        const statusCode = Number(error?.statusCode || 500);
        if (statusCode >= 500) {
          console.error('[admin-web] คำขอผิดพลาด', error);
        } else {
          console.warn('[admin-web] invalid request', error?.message || error);
        }
        return sendJson(res, statusCode, {
          ok: false,
          error:
            statusCode >= 500
              ? 'เซิร์ฟเวอร์ภายในผิดพลาด'
              : String(error?.message || 'คำขอไม่ถูกต้อง'),
        });
      }
    }

    return sendText(res, 404, 'ไม่พบหน้า');
  });

  adminServer.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[admin-web] port ${port} is already in use`);
      return;
    }
    console.error('[admin-web] เซิร์ฟเวอร์ผิดพลาด', err);
  });

  adminServer.on('close', () => {
    closeAllLiveStreams();
    stopMetricsSeriesTimer();
    stopPlatformMonitoring();
    stopRuntimeSupervisorMonitor();
    adminServer = null;
  });

  adminServer.listen(port, host, () => {
    console.log(`[admin-web] เปิดใช้งานที่ http://${host}:${port}/admin`);
    startRuntimeSupervisorMonitor();
    ensureAdminUsersReady()
      .then(async () => {
        const users = await listAdminUsersFromDb(50);
        console.log(
          `[admin-web] login users (db): ${users
            .map((user) => `${user.username}(${user.role})`)
            .join(', ')}`,
        );
      })
      .catch((error) => {
        console.error('[admin-web] failed to initialize admin users from db', error);
      });
    if ((host !== '127.0.0.1' && host !== 'localhost') && !SESSION_SECURE_COOKIE) {
      console.warn(
        '[admin-web] SESSION cookie is not secure. Set ADMIN_WEB_SECURE_COOKIE=true for HTTPS production.',
      );
    }
    console.log(
      `[admin-web] session cookie: name=${SESSION_COOKIE_NAME} path=${SESSION_COOKIE_PATH} sameSite=${SESSION_COOKIE_SAMESITE} secure=${SESSION_SECURE_COOKIE}${SESSION_COOKIE_DOMAIN ? ` domain=${SESSION_COOKIE_DOMAIN}` : ''}`,
    );
    if (!process.env.ADMIN_WEB_PASSWORD) {
      console.log(
        '[admin-web] ยังไม่ได้ตั้งค่า ADMIN_WEB_PASSWORD จึงใช้ ADMIN_WEB_TOKEN (หรือโทเค็นชั่วคราว) เป็นรหัสผ่านล็อกอิน',
      );
    }
    if (!process.env.ADMIN_WEB_TOKEN) {
      console.log(`[admin-web] โทเค็น/รหัสผ่านชั่วคราว: ${token}`);
    }
    if (ADMIN_WEB_2FA_ACTIVE) {
      console.log('[admin-web] 2FA (TOTP) is enabled');
    } else if (ADMIN_WEB_2FA_ENABLED) {
      console.warn('[admin-web] ADMIN_WEB_2FA_ENABLED=true but ADMIN_WEB_2FA_SECRET is empty');
    }
    if (SSO_DISCORD_ACTIVE) {
      console.log(
        `[admin-web] Discord SSO enabled: http://${host}:${port}/admin/auth/discord/start`,
      );
    } else if (SSO_DISCORD_ENABLED) {
      console.warn('[admin-web] ADMIN_WEB_SSO_DISCORD_ENABLED=true but client id/secret missing');
    }
  });

  return adminServer;
}

module.exports = {
  startAdminWebServer,
};
