const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { URL } = require('node:url');

const config = require('./config');
const { prisma } = require('./prisma');
const {
  addCoins,
  removeCoins,
  setCoins,
  listShopItems,
  listUserPurchases,
  addShopItem,
  deleteShopItem,
  setShopItemPrice,
  setPurchaseStatusByCode,
  findPurchaseByCode,
  listKnownPurchaseStatuses,
  listPurchaseStatusHistory,
} = require('./store/memoryStore');
const {
  normalizePurchaseStatus,
  listAllowedPurchaseTransitions,
  validatePurchaseStatusTransition,
} = require('./services/purchaseStateMachine');
const {
  tickets,
  claimTicket,
  closeTicket,
  replaceTickets,
} = require('./store/ticketStore');
const { listAllStats, addKill, addDeath, addPlaytimeMinutes, replaceStats } = require('./store/statsStore');
const { listWeaponStats, replaceWeaponStats } = require('./store/weaponStatsStore');
const { listBounties, createBounty, cancelBounty, replaceBounties } = require('./store/bountyStore');
const { listEvents, createEvent, startEvent, endEvent, joinEvent, getParticipants, replaceEvents } = require('./store/eventStore');
const { giveaways, replaceGiveaways } = require('./store/giveawayStore');
const { listLinks, setLink, unlinkBySteamId, unlinkByUserId, replaceLinks } = require('./store/linkStore');
const { getStatus, updateStatus, replaceStatus } = require('./store/scumStore');
const { listMemberships, setMembership, removeMembership, replaceMemberships } = require('./store/vipStore');
const { listAllPunishments, addPunishment, replacePunishments } = require('./store/moderationStore');
const { listCodes, setCode, deleteCode, resetCodeUsage, replaceCodes } = require('./store/redeemStore');
const { listClaimed, revokeClaim, clearClaims, replaceClaims } = require('./store/welcomePackStore');
const { listDailyRents, listRentalVehicles } = require('./store/rentBikeStore');
const { listTopPanels, replaceTopPanels } = require('./store/topPanelStore');
const { listAllCarts, replaceCarts } = require('./store/cartStore');
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
const { replaceDeliveryAudit } = require('./store/deliveryAuditStore');
const { replaceRentBikeData } = require('./store/rentBikeStore');
const {
  enqueuePurchaseDeliveryByCode,
  listDeliveryQueue,
  listDeliveryDeadLetters,
  replaceDeliveryQueue,
  replaceDeliveryDeadLetters,
  retryDeliveryNow,
  retryDeliveryDeadLetter,
  removeDeliveryDeadLetter,
  cancelDeliveryJob,
  listDeliveryAudit,
  getDeliveryMetricsSnapshot,
} = require('./services/rconDelivery');
const {
  queueLeaderboardRefreshForAllGuilds,
} = require('./services/leaderboardPanels');
const {
  adminLiveBus,
  publishAdminLiveUpdate,
} = require('./services/adminLiveBus');
const {
  listItemIconCatalog,
  resolveItemIconUrl,
} = require('./services/itemIconService');
const {
  redeemCodeForUser,
  requestRentBikeForUser,
  createBountyForUser,
  listActiveBountiesForUser,
} = require('./services/playerOpsService');
const { DATA_DIR, getPersistenceStatus } = require('./store/_persist');
const { getWebhookMetricsSnapshot } = require('./scumWebhookServer');

const dashboardHtmlPath = path.join(__dirname, 'admin', 'dashboard.html');
const loginHtmlPath = path.join(__dirname, 'admin', 'login.html');
let adminServer = null;
let cachedDashboardHtml = null;
let cachedLoginHtml = null;
let resolvedToken = null;
const sessions = new Map();
let adminUsersReadyPromise = null;

const SESSION_COOKIE_NAME = 'scum_admin_session';
const SESSION_TTL_MS = Math.max(
  10 * 60 * 1000,
  Number(process.env.ADMIN_WEB_SESSION_TTL_HOURS || 12) * 60 * 60 * 1000,
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
const metricsSeries = {
  deliveryQueueLength: [],
  deliveryFailRate: [],
  loginFailures: [],
  webhookErrorRate: [],
};
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
const BACKUP_DIR = path.resolve(
  String(process.env.ADMIN_WEB_BACKUP_DIR || path.join(DATA_DIR, 'backups')),
);
const DISCORD_API_BASE = 'https://discord.com/api/v10';

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
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

function compactSeries(series, now = Date.now()) {
  const cutoff = now - METRICS_SERIES_RETENTION_MS;
  while (series.length > 0 && series[0].at < cutoff) {
    series.shift();
  }
}

function recordSeriesPoint(key, value, now = Date.now()) {
  const series = metricsSeries[key];
  if (!Array.isArray(series)) return;
  series.push({
    at: now,
    value: Number.isFinite(Number(value)) ? Number(value) : 0,
  });
  compactSeries(series, now);
}

function captureMetricsSeries(now = Date.now()) {
  const delivery = typeof getDeliveryMetricsSnapshot === 'function'
    ? getDeliveryMetricsSnapshot(now)
    : { queueLength: 0, failRate: 0 };
  const login = getLoginFailureMetrics(now);
  const webhook = typeof getWebhookMetricsSnapshot === 'function'
    ? getWebhookMetricsSnapshot(now)
    : { errorRate: 0 };

  recordSeriesPoint('deliveryQueueLength', Number(delivery.queueLength || 0), now);
  recordSeriesPoint('deliveryFailRate', Number(delivery.failRate || 0), now);
  recordSeriesPoint('loginFailures', Number(login.failures || 0), now);
  recordSeriesPoint('webhookErrorRate', Number(webhook.errorRate || 0), now);
}

function clampMetricsWindowMs(value) {
  const parsed = asInt(value, null);
  if (parsed == null) return null;
  return Math.max(60 * 1000, Math.min(parsed, METRICS_SERIES_RETENTION_MS));
}

function parseMetricsSeriesKeys(value) {
  const requested = parseCsvSet(value);
  if (requested.size === 0) return [];
  return METRICS_SERIES_KEYS.filter((key) => requested.has(key));
}

function listMetricsSeries(options = {}) {
  const seriesKeys = Array.isArray(options.keys) && options.keys.length > 0
    ? options.keys
    : METRICS_SERIES_KEYS;
  const windowMs = clampMetricsWindowMs(options.windowMs);
  const cutoff = windowMs == null ? null : Date.now() - windowMs;
  const out = {};
  for (const key of seriesKeys) {
    if (!METRICS_SERIES_KEYS.includes(key)) continue;
    const series = Array.isArray(metricsSeries[key]) ? metricsSeries[key] : [];
    const filtered = cutoff == null
      ? series
      : series.filter((point) => Number(point?.at || 0) >= cutoff);
    out[key] = filtered.map((point) => ({
      at: new Date(point.at).toISOString(),
      value: Number(point.value || 0),
    }));
  }
  return out;
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
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (SESSION_SECURE_COOKIE) parts.push('Secure');
  return parts.join('; ');
}

function buildClearSessionCookie() {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    'Max-Age=0',
  ];
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
  const value = String(body?.[key] || '').trim();
  return value || null;
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

function normalizeTickets() {
  return Array.from(tickets.values())
    .map((t) => ({
      ...t,
      createdAt: t.createdAt ? new Date(t.createdAt) : null,
      closedAt: t.closedAt ? new Date(t.closedAt) : null,
    }))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function normalizeEvents() {
  return listEvents().map((ev) => ({
    ...ev,
    participants: getParticipants(ev.id),
    participantsCount: getParticipants(ev.id).length,
  }));
}

function normalizeGiveaways() {
  return Array.from(giveaways.values()).map((g) => {
    const entrants = Array.from(g.entrants || []);
    return {
      ...g,
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

function normalizeWallet(wallet) {
  return {
    ...wallet,
    lastDaily: wallet.lastDaily == null ? null : Number(wallet.lastDaily),
    lastWeekly: wallet.lastWeekly == null ? null : Number(wallet.lastWeekly),
  };
}

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

function listBackupFiles() {
  ensureBackupDir();
  const rows = fs
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
  return rows;
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
  const parsed = JSON.parse(raw);
  return {
    file,
    absolutePath: absolute,
    payload: parsed,
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

  await prisma.$transaction([
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
    const kind = String(row.kind || 'item').toLowerCase() === 'vip' ? 'vip' : 'item';
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
}

async function restoreSnapshotData(snapshot = {}) {
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
  replaceDeliveryQueue(Array.isArray(snapshot.deliveryQueue) ? snapshot.deliveryQueue : []);
  replaceDeliveryDeadLetters(Array.isArray(snapshot.deliveryDeadLetters) ? snapshot.deliveryDeadLetters : []);
  await replaceRentBikeData(
    Array.isArray(snapshot.dailyRents) ? snapshot.dailyRents : [],
    Array.isArray(snapshot.rentalVehicles) ? snapshot.rentalVehicles : [],
  );

  if (snapshot.config && typeof config.setFullConfig === 'function') {
    config.setFullConfig(snapshot.config);
  }
}

function buildObservabilitySnapshot(options = {}) {
  captureMetricsSeries();
  const windowMs = clampMetricsWindowMs(options.windowMs);
  const seriesKeys = Array.isArray(options.seriesKeys) ? options.seriesKeys : [];
  const deliveryMetrics = typeof getDeliveryMetricsSnapshot === 'function'
    ? getDeliveryMetricsSnapshot()
    : { queueLength: listDeliveryQueue(1000).length };
  const loginMetrics = getLoginFailureMetrics();
  const webhookMetrics = typeof getWebhookMetricsSnapshot === 'function'
    ? getWebhookMetricsSnapshot()
    : { attempts: 0, errors: 0, errorRate: 0 };

  return {
    generatedAt: new Date().toISOString(),
    delivery: deliveryMetrics,
    adminLogin: loginMetrics,
    webhook: webhookMetrics,
    timeSeriesWindowMs: windowMs || METRICS_SERIES_RETENTION_MS,
    timeSeries: listMetricsSeries({
      windowMs,
      keys: seriesKeys,
    }),
  };
}

async function buildSnapshot(client) {
  const [
    shopItems,
    wallets,
    purchases,
    walletLedgers,
    purchaseStatusHistory,
    playerAccounts,
    dailyRents,
    rentalVehicles,
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
  ]);

  const shopItemsWithIcon = shopItems.map((item) => ({
    ...item,
    resolvedIconUrl: resolveItemIconUrl(item),
  }));

  const guilds = Array.from(client.guilds.cache.values()).map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g.memberCount,
    channelsCount: g.channels.cache.size,
    rolesCount: g.roles.cache.size,
  }));

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
    rentBikeRuntime: getRentBikeRuntime(),
    deliveryQueue: listDeliveryQueue(500),
    deliveryDeadLetters: listDeliveryDeadLetters(1000),
    deliveryAudit: listDeliveryAudit(1000),
    observability: buildObservabilitySnapshot(),
    backups: listBackupFiles().slice(0, 50),
    topPanels: listTopPanels(),
    carts: listAllCarts(),
    config: normalizeConfig(),
  };
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

async function handlePostAction(client, pathname, body, res, auth) {
  if (pathname === '/admin/api/wallet/set') {
    const userId = requiredString(body, 'userId');
    const balance = asInt(body.balance);
    if (!userId || balance == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const newBalance = await setCoins(userId, balance, {
      reason: 'admin_wallet_set',
      actor: `admin-web:${auth?.user || 'unknown'}`,
      meta: {
        role: auth?.role || 'unknown',
      },
    });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-wallet-set');
    return sendJson(res, 200, { ok: true, data: { userId, balance: newBalance } });
  }

  if (pathname === '/admin/api/wallet/add') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const newBalance = await addCoins(userId, amount, {
      reason: 'admin_wallet_add',
      actor: `admin-web:${auth?.user || 'unknown'}`,
      meta: {
        role: auth?.role || 'unknown',
      },
    });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-wallet-add');
    return sendJson(res, 200, { ok: true, data: { userId, balance: newBalance } });
  }

  if (pathname === '/admin/api/wallet/remove') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const newBalance = await removeCoins(userId, amount, {
      reason: 'admin_wallet_remove',
      actor: `admin-web:${auth?.user || 'unknown'}`,
      meta: {
        role: auth?.role || 'unknown',
      },
    });
    queueLeaderboardRefreshForAllGuilds(client, 'admin-wallet-remove');
    return sendJson(res, 200, { ok: true, data: { userId, balance: newBalance } });
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

    const item = await addShopItem(id, name, price, description, {
      kind,
      gameItemId: kind === 'item' ? primaryDeliveryItem?.gameItemId || gameItemId : null,
      quantity: kind === 'item'
        ? Math.max(1, Number(primaryDeliveryItem?.quantity || quantity || 1))
        : 1,
      iconUrl: kind === 'item'
        ? primaryDeliveryItem?.iconUrl || iconUrl
        : null,
      deliveryItems: resolvedDeliveryItems,
    });
    return sendJson(res, 200, { ok: true, data: item });
  }

  if (pathname === '/admin/api/shop/price') {
    const idOrName = requiredString(body, 'idOrName');
    const price = asInt(body.price);
    if (!idOrName || price == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const item = await setShopItemPrice(idOrName, price);
    if (!item) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: item });
  }

  if (pathname === '/admin/api/shop/delete') {
    const idOrName = requiredString(body, 'idOrName');
    if (!idOrName) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const removed = await deleteShopItem(idOrName);
    if (!removed) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: removed });
  }

  if (pathname === '/admin/api/purchase/status') {
    const code = requiredString(body, 'code');
    const status = requiredString(body, 'status');
    if (!code || !status) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const purchase = await findPurchaseByCode(code);
    if (!purchase) return sendJson(res, 404, { ok: false, error: 'Resource not found' });

    const targetStatus = normalizePurchaseStatus(status);
    const currentStatus = normalizePurchaseStatus(purchase.status);
    const validation = validatePurchaseStatusTransition(currentStatus, targetStatus, {
      force: body?.force === true,
    });
    if (!validation.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Invalid purchase status transition',
        data: {
          code,
          currentStatus,
          targetStatus,
          reason: validation.reason,
          allowedTransitions: listAllowedPurchaseTransitions(currentStatus),
          knownStatuses: listKnownPurchaseStatuses(),
        },
      });
    }

    const updated = await setPurchaseStatusByCode(code, targetStatus, {
      force: body?.force === true,
      actor: `admin-web:${auth?.user || 'unknown'}`,
      reason: requiredString(body, 'reason') || 'admin-manual-status-update',
      meta: {
        role: auth?.role || 'unknown',
      },
      recordIfSame: body?.recordIfSame === true,
    });
    if (!updated) return sendJson(res, 404, { ok: false, error: 'Resource not found' });

    const history = await listPurchaseStatusHistory(updated.code, 20);
    return sendJson(res, 200, {
      ok: true,
      data: {
        purchase: updated,
        history,
      },
    });
  }

  if (pathname === '/admin/api/ticket/claim') {
    const channelId = requiredString(body, 'channelId');
    const staffId = requiredString(body, 'staffId') || auth?.user || 'admin-web';
    if (!channelId || !staffId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const ticket = claimTicket(channelId, staffId);
    if (!ticket) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    await tryNotifyTicket(client, ticket, 'claim', staffId);
    return sendJson(res, 200, { ok: true, data: ticket });
  }

  if (pathname === '/admin/api/ticket/close') {
    const channelId = requiredString(body, 'channelId');
    if (!channelId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const ticket = closeTicket(channelId);
    if (!ticket) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    await tryNotifyTicket(client, ticket, 'close');
    return sendJson(res, 200, { ok: true, data: ticket });
  }

  if (pathname === '/admin/api/bounty/create') {
    const targetName = requiredString(body, 'targetName');
    const amount = asInt(body.amount);
    const createdBy = requiredString(body, 'createdBy') || auth?.user || 'admin-web';
    if (!targetName || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const bounty = createBounty({ targetName, amount, createdBy });
    return sendJson(res, 200, { ok: true, data: bounty });
  }

  if (pathname === '/admin/api/bounty/cancel') {
    const id = asInt(body.id);
    if (id == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = cancelBounty(id, 'admin-web', true);
    if (!result.ok) return sendJson(res, 404, { ok: false, error: `ไม่สามารถยกเลิกค่าหัวได้ (${result.reason})` });
    return sendJson(res, 200, { ok: true, data: result.bounty });
  }

  if (pathname === '/admin/api/event/create') {
    const name = requiredString(body, 'name');
    const time = requiredString(body, 'time');
    const reward = requiredString(body, 'reward');
    if (!name || !time || !reward) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const ev = createEvent({ name, time, reward });
    return sendJson(res, 200, { ok: true, data: ev });
  }

  if (pathname === '/admin/api/event/start') {
    const id = asInt(body.id);
    if (id == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const ev = startEvent(id);
    if (!ev) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: ev });
  }

  if (pathname === '/admin/api/event/end') {
    const id = asInt(body.id);
    if (id == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const ev = endEvent(id);
    if (!ev) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: ev });
  }

  if (pathname === '/admin/api/event/join') {
    const id = asInt(body.id);
    const userId = requiredString(body, 'userId');
    if (id == null || !userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = joinEvent(id, userId);
    if (!result) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, {
      ok: true,
      data: {
        event: result.ev,
        participantsCount: result.participants.size,
      },
    });
  }

  if (pathname === '/admin/api/link/set') {
    const steamId = requiredString(body, 'steamId');
    const userId = requiredString(body, 'userId');
    const inGameName = requiredString(body, 'inGameName');
    if (!steamId || !userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const result = setLink({ steamId, userId, inGameName: inGameName || null });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: `ไม่สามารถบันทึกลิงก์ได้ (${result.reason})` });
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/link/remove') {
    const steamId = requiredString(body, 'steamId');
    const userId = requiredString(body, 'userId');
    if (!steamId && !userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const removed = steamId ? unlinkBySteamId(steamId) : unlinkByUserId(userId);
    if (!removed) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: removed });
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
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    setMembership(userId, planId, expiresAt);
    return sendJson(res, 200, { ok: true, data: { userId, planId, expiresAt } });
  }

  if (pathname === '/admin/api/vip/remove') {
    const userId = requiredString(body, 'userId');
    if (!userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    removeMembership(userId);
    return sendJson(res, 200, { ok: true, data: { userId } });
  }

  if (pathname === '/admin/api/redeem/add') {
    const code = requiredString(body, 'code');
    const type = requiredString(body, 'type');
    if (!code || !type) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const amount = body.amount == null || body.amount === '' ? null : asInt(body.amount, null);
    const itemId = requiredString(body, 'itemId');
    const result = setCode(code, { type, amount, itemId });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: `ไม่สามารถบันทึกโค้ดได้ (${result.reason})` });
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (pathname === '/admin/api/redeem/delete') {
    const code = requiredString(body, 'code');
    if (!code) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const removed = deleteCode(code);
    if (!removed) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: { code } });
  }

  if (pathname === '/admin/api/redeem/reset-usage') {
    const code = requiredString(body, 'code');
    if (!code) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const item = resetCodeUsage(code);
    if (!item) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: item });
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
    const entry = addPunishment(userId, type, reason, staffId, durationMinutes);
    return sendJson(res, 200, { ok: true, data: entry });
  }

  if (pathname === '/admin/api/welcome/revoke') {
    const userId = requiredString(body, 'userId');
    if (!userId) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const removed = revokeClaim(userId);
    if (!removed) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: { userId } });
  }

  if (pathname === '/admin/api/welcome/clear') {
    clearClaims();
    return sendJson(res, 200, { ok: true, data: { cleared: true } });
  }

  if (pathname === '/admin/api/stats/add-kill') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const stat = addKill(userId, amount);
    queueLeaderboardRefreshForAllGuilds(client, 'admin-add-kill');
    return sendJson(res, 200, { ok: true, data: stat });
  }

  if (pathname === '/admin/api/stats/add-death') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const stat = addDeath(userId, amount);
    queueLeaderboardRefreshForAllGuilds(client, 'admin-add-death');
    return sendJson(res, 200, { ok: true, data: stat });
  }

  if (pathname === '/admin/api/stats/add-playtime') {
    const userId = requiredString(body, 'userId');
    const minutes = asInt(body.minutes);
    if (!userId || minutes == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const stat = addPlaytimeMinutes(userId, minutes);
    queueLeaderboardRefreshForAllGuilds(client, 'admin-add-playtime');
    return sendJson(res, 200, { ok: true, data: stat });
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
    updateStatus({ onlinePlayers, maxPlayers, pingMs, uptimeMinutes });
    return sendJson(res, 200, { ok: true, data: getStatus() });
  }

  if (pathname === '/admin/api/backup/create') {
    const note = requiredString(body, 'note') || null;
    const includeSnapshot = body?.includeSnapshot !== false;
    const snapshot = includeSnapshot ? await buildSnapshot(client) : {};
    const payload = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      createdBy: auth?.user || 'unknown',
      role: auth?.role || 'unknown',
      note,
      snapshot,
    };
    const saved = saveBackupPayload(payload);
    return sendJson(res, 200, {
      ok: true,
      data: {
        ...saved,
        note,
      },
    });
  }

  if (pathname === '/admin/api/backup/restore') {
    const backupName = requiredString(body, 'backup');
    const dryRun = body?.dryRun === true;
    if (!backupName) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    }
    const loaded = readBackupPayloadByName(backupName);
    const snapshot = loaded?.payload?.snapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return sendJson(res, 400, { ok: false, error: 'Backup payload is invalid' });
    }
    if (dryRun) {
      return sendJson(res, 200, {
        ok: true,
        data: {
          dryRun: true,
          backup: loaded.file,
          counts: {
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
            carts: Array.isArray(snapshot.carts) ? snapshot.carts.length : 0,
          },
        },
      });
    }
    await restoreSnapshotData(snapshot);
    publishAdminLiveUpdate('backup-restore', {
      backup: loaded.file,
      actor: auth?.user || 'unknown',
      role: auth?.role || 'unknown',
    });
    return sendJson(res, 200, {
      ok: true,
      data: {
        restored: true,
        backup: loaded.file,
      },
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

function startAdminWebServer(client) {
  if (adminServer) return adminServer;

  const host = String(process.env.ADMIN_WEB_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = asInt(process.env.ADMIN_WEB_PORT, 3200) || 3200;
  const allowedOrigins = buildAllowedOrigins(host, port);
  const token = getAdminToken();
  ensureMetricsSeriesTimer();
  if (!liveBusBound) {
    adminLiveBus.on('update', (evt) => {
      broadcastLiveUpdate(evt?.type || 'update', evt?.payload || {});
    });
    liveBusBound = true;
  }

  adminServer = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || '/', `http://${host}:${port}`);
    const { pathname } = urlObj;

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

        if (req.method === 'GET' && pathname === '/admin/api/auth/providers') {
          return sendJson(res, 200, {
            ok: true,
            data: {
              loginSource: 'database',
              password: true,
              discordSso: SSO_DISCORD_ACTIVE,
              twoFactor: ADMIN_WEB_2FA_ACTIVE,
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
          return sendJson(res, 200, {
            ok: true,
            data: {
              now: new Date().toISOString(),
              guilds: client.guilds.cache.size,
              role: auth.role,
            },
          });
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
            data: buildObservabilitySnapshot({
              windowMs,
              seriesKeys,
            }),
          });
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

        if (req.method === 'GET' && pathname === '/admin/api/delivery/dead-letter') {
          const auth = ensureRole(req, urlObj, 'mod', res);
          if (!auth) return undefined;
          const limit = asInt(urlObj.searchParams.get('limit'), 500) || 500;
          return sendJson(res, 200, {
            ok: true,
            data: listDeliveryDeadLetters(limit),
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
          const data = await buildSnapshot(client);
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'GET' && pathname === '/admin/api/backup/list') {
          const auth = ensureRole(req, urlObj, 'owner', res);
          if (!auth) return undefined;
          return sendJson(res, 200, {
            ok: true,
            data: listBackupFiles(),
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
    adminServer = null;
  });

  adminServer.listen(port, host, () => {
    console.log(`[admin-web] เปิดใช้งานที่ http://${host}:${port}/admin`);
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
