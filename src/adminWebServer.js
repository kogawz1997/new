const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const config = require('./config');
const { prisma } = require('./prisma');
const {
  addCoins,
  removeCoins,
  setCoins,
  listShopItems,
  addShopItem,
  deleteShopItem,
  setShopItemPrice,
  setPurchaseStatusByCode,
} = require('./store/memoryStore');
const { tickets, claimTicket, closeTicket } = require('./store/ticketStore');
const { listAllStats, addKill, addDeath, addPlaytimeMinutes } = require('./store/statsStore');
const { listWeaponStats } = require('./store/weaponStatsStore');
const { listBounties, createBounty, cancelBounty } = require('./store/bountyStore');
const { listEvents, createEvent, startEvent, endEvent, joinEvent, getParticipants } = require('./store/eventStore');
const { giveaways } = require('./store/giveawayStore');
const { listLinks, setLink, unlinkBySteamId, unlinkByUserId } = require('./store/linkStore');
const { getStatus, updateStatus } = require('./store/scumStore');
const { listMemberships, setMembership, removeMembership } = require('./store/vipStore');
const { listAllPunishments, addPunishment } = require('./store/moderationStore');
const { listCodes, setCode, deleteCode, resetCodeUsage } = require('./store/redeemStore');
const { listClaimed, revokeClaim, clearClaims } = require('./store/welcomePackStore');
const { listDailyRents, listRentalVehicles } = require('./store/rentBikeStore');
const { listTopPanels } = require('./store/topPanelStore');
const {
  getRentBikeRuntime,
  runRentBikeMidnightReset,
} = require('./services/rentBikeService');
const {
  enqueuePurchaseDeliveryByCode,
  listDeliveryQueue,
  retryDeliveryNow,
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

const dashboardHtmlPath = path.join(__dirname, 'admin', 'dashboard.html');
const loginHtmlPath = path.join(__dirname, 'admin', 'login.html');
let adminServer = null;
let cachedDashboardHtml = null;
let cachedLoginHtml = null;
let resolvedToken = null;
const sessions = new Map();

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
const loginAttemptsByIp = new Map();
const loginFailureEvents = [];
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

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
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

function createSession() {
  cleanupSessions();
  const sessionId = crypto.randomBytes(24).toString('hex');
  sessions.set(sessionId, {
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

function hasValidSession(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return false;
  }
  return true;
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

function isAuthorized(req, urlObj) {
  if (hasValidSession(req)) return true;
  const requestToken = getRequestToken(req, urlObj);
  const expected = getAdminToken();
  return requestToken !== '' && secureEqual(requestToken, expected);
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
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      body += chunk;
      if (body.length > ADMIN_WEB_MAX_BODY_BYTES) {
        done = true;
        reject(new Error('เนื้อหาคำขอใหญ่เกินกำหนด'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('รูปแบบ JSON ไม่ถูกต้อง'));
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

function buildObservabilitySnapshot() {
  const deliveryMetrics = typeof getDeliveryMetricsSnapshot === 'function'
    ? getDeliveryMetricsSnapshot()
    : { queueLength: listDeliveryQueue(1000).length };
  const loginMetrics = getLoginFailureMetrics();

  return {
    generatedAt: new Date().toISOString(),
    delivery: deliveryMetrics,
    adminLogin: loginMetrics,
  };
}

async function buildSnapshot(client) {
  const [shopItems, wallets, purchases, dailyRents, rentalVehicles] = await Promise.all([
    listShopItems(),
    prisma.userWallet.findMany({
      orderBy: { balance: 'desc' },
      take: 500,
    }),
    prisma.purchase.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
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
    wallets: wallets.map(normalizeWallet),
    shopItems: shopItemsWithIcon,
    purchases,
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
    deliveryAudit: listDeliveryAudit(1000),
    observability: buildObservabilitySnapshot(),
    topPanels: listTopPanels(),
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

async function handlePostAction(client, pathname, body, res) {
  if (pathname === '/admin/api/wallet/set') {
    const userId = requiredString(body, 'userId');
    const balance = asInt(body.balance);
    if (!userId || balance == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const newBalance = await setCoins(userId, balance);
    queueLeaderboardRefreshForAllGuilds(client, 'admin-wallet-set');
    return sendJson(res, 200, { ok: true, data: { userId, balance: newBalance } });
  }

  if (pathname === '/admin/api/wallet/add') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const newBalance = await addCoins(userId, amount);
    queueLeaderboardRefreshForAllGuilds(client, 'admin-wallet-add');
    return sendJson(res, 200, { ok: true, data: { userId, balance: newBalance } });
  }

  if (pathname === '/admin/api/wallet/remove') {
    const userId = requiredString(body, 'userId');
    const amount = asInt(body.amount);
    if (!userId || amount == null) return sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
    const newBalance = await removeCoins(userId, amount);
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
    const updated = await setPurchaseStatusByCode(code, status);
    if (!updated) return sendJson(res, 404, { ok: false, error: 'Resource not found' });
    return sendJson(res, 200, { ok: true, data: updated });
  }

  if (pathname === '/admin/api/ticket/claim') {
    const channelId = requiredString(body, 'channelId');
    const staffId = requiredString(body, 'staffId');
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
    const createdBy = requiredString(body, 'createdBy') || 'admin-web';
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
    const staffId = requiredString(body, 'staffId') || 'admin-web';
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
    const reason = requiredString(body, 'reason') || 'admin-web';
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

  return sendJson(res, 404, { ok: false, error: 'Resource not found' });
}

function startAdminWebServer(client) {
  if (adminServer) return adminServer;

  const host = String(process.env.ADMIN_WEB_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = asInt(process.env.ADMIN_WEB_PORT, 3200) || 3200;
  const allowedOrigins = buildAllowedOrigins(host, port);
  const token = getAdminToken();
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

          const usernameOk = secureEqual(username, ADMIN_WEB_USER);
          const passwordOk = secureEqual(password, getAdminLoginPassword());
          if (!usernameOk || !passwordOk) {
            recordLoginAttempt(req, false);
            return sendJson(res, 401, { ok: false, error: 'Invalid username or password' });
          }

          recordLoginAttempt(req, true);
          const sessionId = createSession();
          return sendJson(
            res,
            200,
            {
              ok: true,
              data: {
                user: ADMIN_WEB_USER,
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

        if (req.method === 'GET' && pathname === '/admin/api/me') {
          if (!isAuthorized(req, urlObj)) {
            return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          }
          return sendJson(res, 200, {
            ok: true,
            data: {
              user: ADMIN_WEB_USER,
              session: hasValidSession(req),
            },
          });
        }

        if (!isAuthorized(req, urlObj)) {
          return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        }

        if (req.method === 'GET' && pathname === '/admin/api/health') {
          return sendJson(res, 200, {
            ok: true,
            data: {
              now: new Date().toISOString(),
              guilds: client.guilds.cache.size,
            },
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/observability') {
          return sendJson(res, 200, {
            ok: true,
            data: buildObservabilitySnapshot(),
          });
        }

        if (req.method === 'GET' && pathname === '/admin/api/live') {
          openLiveStream(req, res);
          return undefined;
        }

        if (req.method === 'GET' && pathname === '/admin/api/items/catalog') {
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

        if (req.method === 'GET' && pathname === '/admin/api/snapshot') {
          const data = await buildSnapshot(client);
          return sendJson(res, 200, { ok: true, data });
        }

        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const out = await handlePostAction(client, pathname, body, res);
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            res.writableEnded &&
            pathname !== '/admin/api/login' &&
            pathname !== '/admin/api/logout'
          ) {
            publishAdminLiveUpdate('admin-action', { path: pathname });
          }
          return out;
        }

        return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      } catch (error) {
        console.error('[admin-web] คำขอผิดพลาด', error);
        return sendJson(res, 500, { ok: false, error: error.message || 'เซิร์ฟเวอร์ภายในผิดพลาด' });
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

  adminServer.listen(port, host, () => {
    console.log(`[admin-web] เปิดใช้งานที่ http://${host}:${port}/admin`);
    console.log(`[admin-web] login user: ${ADMIN_WEB_USER}`);
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
  });

  return adminServer;
}

module.exports = {
  startAdminWebServer,
};
