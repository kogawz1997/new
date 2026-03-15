'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pipeline } = require('node:stream/promises');
const { URL, URLSearchParams } = require('node:url');

const { loadMergedEnvFiles } = require('../../src/utils/loadEnvFiles');
loadMergedEnvFiles({
  basePath: path.resolve(process.cwd(), '.env'),
  overlayPath: path.join(__dirname, '.env'),
});
const {
  safeJsonStringify,
  installBigIntJsonSerialization,
} = require('../../src/utils/jsonSerialization');
installBigIntJsonSerialization();

const {
  listShopItems,
  listUserPurchases,
  getWallet,
  listWalletLedger,
  canClaimDaily,
  claimDaily,
  canClaimWeekly,
  claimWeekly,
  listTopWallets,
  listPurchaseStatusHistory,
} = require('../../src/store/memoryStore');
const {
  getPlayerDashboard,
  listPlayerAccounts,
  getPlayerAccount,
  upsertPlayerAccount,
} = require('../../src/store/playerAccountStore');
const {
  redeemCodeForUser,
  requestRentBikeForUser,
  createBountyForUser,
  listActiveBountiesForUser,
} = require('../../src/services/playerOpsService');
const { resolveItemIconUrl } = require('../../src/services/itemIconService');
const {
  getResolvedCart,
  checkoutCart,
  buildBundleSummary,
  getDeliveryStatusText,
} = require('../../src/services/cartService');
const {
  normalizeShopKind,
  isGameItemShopKind,
  findShopItemByQuery,
  purchaseShopItemForUser,
} = require('../../src/services/shopService');
const {
  addCartItem,
  removeCartItem,
  clearCart,
  listCartItems,
} = require('../../src/store/cartStore');
const { transferCoins } = require('../../src/services/coinService');
const {
  checkRewardClaimForUser,
  claimRewardForUser,
} = require('../../src/services/rewardService');
const {
  setLink,
  getLinkBySteamId,
  getLinkByUserId,
} = require('../../src/store/linkStore');
const {
  canSpinWheel,
  getUserWheelState,
} = require('../../src/store/luckyWheelStore');
const {
  listPartyMessages,
  addPartyMessage,
  normalizePartyKey,
} = require('../../src/store/partyChatStore');
const { listCodes } = require('../../src/store/redeemStore');
const { getStats, listAllStats } = require('../../src/store/statsStore');
const { getStatus } = require('../../src/store/scumStore');
const {
  ensureRentBikeTables,
  listRentalVehicles,
  getDailyRent,
} = require('../../src/store/rentBikeStore');
const { awardWheelRewardForUser } = require('../../src/services/wheelService');
const { getPlatformPublicOverview } = require('../../src/services/platformService');
const config = require('../../src/config');

const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';

const HOST = String(process.env.WEB_PORTAL_HOST || '127.0.0.1').trim() || '127.0.0.1';
const PORT = asInt(process.env.WEB_PORTAL_PORT, 3300, 1, 65535);
const BASE_URL = String(process.env.WEB_PORTAL_BASE_URL || `http://${HOST}:${PORT}`).trim();
const PORTAL_MODE = normalizeMode(process.env.WEB_PORTAL_MODE || 'player');
const LEGACY_ADMIN_URL = String(
  process.env.WEB_PORTAL_LEGACY_ADMIN_URL || 'http://127.0.0.1:3200/admin',
).trim();

const SESSION_TTL_MS =
  asInt(process.env.WEB_PORTAL_SESSION_TTL_HOURS, 12, 1, 168) * 60 * 60 * 1000;
const SESSION_COOKIE_NAME =
  String(process.env.WEB_PORTAL_SESSION_COOKIE_NAME || 'scum_portal_session').trim()
    || 'scum_portal_session';
const SESSION_COOKIE_SAMESITE = normalizeSameSite(
  process.env.WEB_PORTAL_COOKIE_SAMESITE || 'lax',
);
const SESSION_COOKIE_PATH = normalizeCookiePath(
  process.env.WEB_PORTAL_SESSION_COOKIE_PATH || '/',
  '/',
);
const SESSION_COOKIE_DOMAIN = normalizeCookieDomain(
  process.env.WEB_PORTAL_COOKIE_DOMAIN || '',
);
const SECURE_COOKIE = envBool('WEB_PORTAL_SECURE_COOKIE', IS_PRODUCTION);
const ENFORCE_ORIGIN_CHECK = envBool('WEB_PORTAL_ENFORCE_ORIGIN_CHECK', true);

const DISCORD_CLIENT_ID = String(
  process.env.WEB_PORTAL_DISCORD_CLIENT_ID
    || process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_ID
    || process.env.DISCORD_CLIENT_ID
    || '',
).trim();
const DISCORD_CLIENT_SECRET = String(
  process.env.WEB_PORTAL_DISCORD_CLIENT_SECRET
    || process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET
    || '',
).trim();
const DISCORD_GUILD_ID = String(
  process.env.WEB_PORTAL_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || '',
).trim();
const PLAYER_OPEN_ACCESS = envBool('WEB_PORTAL_PLAYER_OPEN_ACCESS', true);
const REQUIRE_GUILD_MEMBER = PLAYER_OPEN_ACCESS
  ? false
  : envBool('WEB_PORTAL_REQUIRE_GUILD_MEMBER', Boolean(DISCORD_GUILD_ID));
const ALLOWED_DISCORD_IDS = parseCsvSet(
  process.env.WEB_PORTAL_ALLOWED_DISCORD_IDS || '',
);
const OAUTH_STATE_TTL_MS = asInt(
  process.env.WEB_PORTAL_OAUTH_STATE_TTL_MS,
  10 * 60 * 1000,
  60 * 1000,
  60 * 60 * 1000,
);
const DISCORD_REDIRECT_PATH = String(
  process.env.WEB_PORTAL_DISCORD_REDIRECT_PATH || '/auth/discord/callback',
).trim() || '/auth/discord/callback';

const CLEANUP_INTERVAL_MS = asInt(
  process.env.WEB_PORTAL_CLEANUP_INTERVAL_MS,
  60_000,
  10_000,
  10 * 60 * 1000,
);

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const LOGIN_HTML_PATH = path.join(__dirname, 'public', 'login.html');
const PLAYER_HTML_PATH = path.join(__dirname, 'public', 'player.html');
const LANDING_HTML_PATH = path.join(__dirname, 'public', 'landing.html');
const TRIAL_HTML_PATH = path.join(__dirname, 'public', 'trial.html');
const SHOWCASE_HTML_PATH = path.join(__dirname, 'public', 'showcase.html');
const DOCS_DIR_PATH = path.resolve(process.cwd(), 'docs');
const DEFAULT_MAP_PORTAL_URL = 'https://scum-map.com/th/map/bunkers_and_killboxes';
const DEFAULT_SCUM_ITEMS_DIR_PATH = path.resolve(process.cwd(), 'scum_items-main');
const SCUM_ITEMS_DIR_PATH = path.resolve(
  String(process.env.SCUM_ITEMS_DIR_PATH || DEFAULT_SCUM_ITEMS_DIR_PATH).trim()
    || DEFAULT_SCUM_ITEMS_DIR_PATH,
);
const STATIC_ICON_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg']);

const FAVICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">',
  '<stop offset="0%" stop-color="#d3af6a"/><stop offset="100%" stop-color="#b6ce84"/>',
  '</linearGradient></defs>',
  '<rect width="64" height="64" rx="12" fill="#10180f"/>',
  '<path d="M10 14h44v6H10zm0 30h44v6H10z" fill="url(#g)" opacity=".85"/>',
  '<path d="M45 20H24c-2.4 0-4 1.4-4 3.5 0 2.4 1.9 3.4 4.5 4.1l8 2.2c1.4.4 2.1 1 2.1 1.9 0 1-1 1.8-2.4 1.8H18v8h15.2c6.4 0 10.8-3.6 10.8-9.2 0-4.4-2.5-7.2-7.7-8.7l-7.5-2.1c-1.2-.3-1.7-.8-1.7-1.4 0-.8.8-1.3 1.9-1.3H45z" fill="url(#g)"/>',
  '</svg>',
].join('');

const sessions = new Map();
const oauthStates = new Map();
const partyChatLastSentAt = new Map();

const PARTY_CHAT_MIN_INTERVAL_MS = 900;
const PARTY_CHAT_MAX_LENGTH = 280;

let cachedLoginHtml = null;
let cachedPlayerHtml = null;
let cachedLandingHtml = null;
let cachedTrialHtml = null;
let cachedShowcaseHtml = null;
let cachedLoginHtmlMtimeMs = 0;
let cachedPlayerHtmlMtimeMs = 0;
let cachedLandingHtmlMtimeMs = 0;
let cachedTrialHtmlMtimeMs = 0;
let cachedShowcaseHtmlMtimeMs = 0;

function asInt(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeSameSite(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'strict') return 'Strict';
  if (raw === 'none') return 'None';
  return 'Lax';
}

function normalizeCookiePath(value, fallback = '/') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (!text.startsWith('/')) return fallback;
  return text;
}

function normalizeCookieDomain(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/[;\s]/.test(text)) return '';
  return text;
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'player') return 'player';
  return 'player';
}

function parseCsvSet(value) {
  const out = new Set();
  for (const item of String(value || '').split(',')) {
    const text = item.trim();
    if (text) out.add(text);
  }
  return out;
}

function isLoopbackHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePurchaseStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAmount(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeQuantity(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeHttpUrl(value) {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getFrameSrcOrigins() {
  const origins = new Set();
  const mapConfig = getMapPortalConfig();
  if (mapConfig.embedUrl) {
    try {
      origins.add(new URL(mapConfig.embedUrl).origin);
    } catch {
      // ignore invalid map URL
    }
  }
  return Array.from(origins);
}

function getMapPortalConfig() {
  const serverInfo = config.serverInfo || {};
  const externalUrl = normalizeHttpUrl(
    process.env.WEB_PORTAL_MAP_EXTERNAL_URL
      || process.env.WEB_PORTAL_MAP_URL
      || serverInfo.mapUrl
      || DEFAULT_MAP_PORTAL_URL,
  );
  const embedEnabled = envBool('WEB_PORTAL_MAP_EMBED_ENABLED', true);
  const embedUrl = embedEnabled
    ? normalizeHttpUrl(
        process.env.WEB_PORTAL_MAP_EMBED_URL
          || serverInfo.mapEmbedUrl
          || externalUrl
          || DEFAULT_MAP_PORTAL_URL,
      )
    : null;
  return {
    enabled: Boolean(externalUrl || embedUrl),
    embedEnabled: Boolean(embedEnabled && embedUrl),
    embedUrl: embedUrl || null,
    externalUrl: externalUrl || embedUrl || DEFAULT_MAP_PORTAL_URL,
  };
}

function isDiscordId(value) {
  return /^\d{15,25}$/.test(String(value || '').trim());
}

function buildDiscordAvatarUrl(profile = {}) {
  const userId = normalizeText(profile.id);
  const avatarHash = normalizeText(profile.avatar);
  if (!isDiscordId(userId)) return null;
  if (!avatarHash) return null;
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(
    userId,
  )}/${encodeURIComponent(avatarHash)}.${ext}?size=256`;
}

function getEconomyConfig() {
  const economy = config.economy || {};
  return {
    currencySymbol: String(economy.currencySymbol || 'Coins'),
    dailyReward: normalizeAmount(economy.dailyReward, 0),
    weeklyReward: normalizeAmount(economy.weeklyReward, 0),
  };
}

const DEFAULT_WHEEL_REWARDS = [
  { id: 'coin-100', label: '100 Coins', type: 'coins', amount: 100, weight: 30 },
  { id: 'coin-250', label: '250 Coins', type: 'coins', amount: 250, weight: 24 },
  { id: 'coin-500', label: '500 Coins', type: 'coins', amount: 500, weight: 16 },
  { id: 'coin-1000', label: '1,000 Coins', type: 'coins', amount: 1000, weight: 9 },
  { id: 'coin-2000', label: '2,000 Coins', type: 'coins', amount: 2000, weight: 4 },
  { id: 'miss', label: 'พลาดรางวัล', type: 'none', amount: 0, weight: 17 },
];

const DEFAULT_PLAYER_TIPS = [
  'ผูก SteamID ให้เรียบร้อยก่อนซื้อไอเทมในเกม',
  'อ่านกฎเซิร์ฟเวอร์ให้ครบก่อนเริ่มเล่น',
  'อย่าแชร์บัญชี Discord/Steam และอย่าเปิดเผยรหัสผ่าน',
  'หากพบปัญหาส่งของ ให้ใช้เลขออเดอร์แจ้งแอดมิน',
];

function normalizeWheelReward(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeText(raw.id || `reward-${index + 1}`).toLowerCase();
  const label = normalizeText(raw.label || raw.name || id);
  const rawType = normalizeText(raw.type || 'coins').toLowerCase();
  const type = rawType === 'item' || rawType === 'shop_item' || rawType === 'game_item'
    ? 'item'
    : rawType === 'none'
      ? 'none'
      : 'coins';
  const amount = normalizeAmount(raw.amount, 0);
  const weight = Math.max(1, normalizeAmount(raw.weight, 1));
  const itemId = normalizeText(raw.itemId || raw.shopItemId || raw.item);
  const gameItemId = normalizeText(raw.gameItemId || raw.scumItemId || itemId);
  const quantity = normalizeQuantity(raw.quantity, 1);
  const iconUrl = normalizeHttpUrl(raw.iconUrl)
    || resolveItemIconUrl({
      id: itemId || gameItemId || id,
      gameItemId,
      name: label,
    })
    || null;
  if (!id || !label) return null;
  if (type === 'item' && !itemId && !gameItemId) return null;
  return {
    id,
    label,
    type: type || 'coins',
    amount: type === 'coins' ? amount : 0,
    weight,
    itemId: type === 'item' ? (itemId || gameItemId) : null,
    gameItemId: type === 'item' ? (gameItemId || itemId || null) : null,
    quantity: type === 'item' ? quantity : 0,
    iconUrl,
  };
}

function getLuckyWheelConfig() {
  const luckyWheel = config.luckyWheel || {};
  const rewardsRaw = Array.isArray(luckyWheel.rewards) && luckyWheel.rewards.length > 0
    ? luckyWheel.rewards
    : DEFAULT_WHEEL_REWARDS;
  const rewards = rewardsRaw
    .map((row, index) => normalizeWheelReward(row, index))
    .filter(Boolean);
  const cooldownMs = Math.max(
    60 * 1000,
    normalizeAmount(luckyWheel.cooldownMs, 6 * 60 * 60 * 1000),
  );
  const tips = Array.isArray(luckyWheel.tips) && luckyWheel.tips.length > 0
    ? luckyWheel.tips.map((line) => normalizeText(line)).filter(Boolean)
    : DEFAULT_PLAYER_TIPS;
  return {
    enabled: luckyWheel.enabled !== false,
    cooldownMs,
    rewards: rewards.length > 0 ? rewards : DEFAULT_WHEEL_REWARDS,
    tips,
  };
}

function pickLuckyWheelReward(rewards) {
  const rows = Array.isArray(rewards) ? rewards : [];
  const normalized = rows
    .map((row, index) => normalizeWheelReward(row, index))
    .filter(Boolean);
  if (normalized.length === 0) {
    return normalizeWheelReward(DEFAULT_WHEEL_REWARDS[0], 0);
  }

  const totalWeight = normalized.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return normalized[0];

  let cursor = crypto.randomInt(totalWeight);
  for (const row of normalized) {
    cursor -= row.weight;
    if (cursor < 0) return row;
  }
  return normalized[normalized.length - 1];
}

function msToHoursMinutes(ms) {
  const totalMinutes = Math.ceil(Number(ms || 0) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} นาที`;
  return `${hours} ชม. ${minutes} นาที`;
}

function msToDaysHours(ms) {
  const totalHours = Math.ceil(Number(ms || 0) / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days <= 0) return `${hours} ชม.`;
  return `${days} วัน ${hours} ชม.`;
}

function msToCountdownText(ms) {
  const value = Math.max(0, normalizeAmount(ms, 0));
  if (value <= 0) return 'พร้อมหมุน';
  if (value < 60 * 60 * 1000) return msToHoursMinutes(value);
  return msToDaysHours(value);
}

async function buildWheelStatePayload(discordId, wheelConfig, limit = 20) {
  const [check, stateRaw] = await Promise.all([
    canSpinWheel(discordId, wheelConfig.cooldownMs),
    getUserWheelState(discordId, limit),
  ]);
  const state = stateRaw || {
    userId: String(discordId || ''),
    lastSpinAt: null,
    totalSpins: 0,
    history: [],
  };
  return {
    enabled: Boolean(wheelConfig.enabled),
    cooldownMs: normalizeAmount(wheelConfig.cooldownMs, 0),
    canSpin: Boolean(wheelConfig.enabled) && Boolean(check.ok),
    remainingMs: Boolean(check.ok) ? 0 : normalizeAmount(check.remainingMs, 0),
    remainingText: Boolean(check.ok)
      ? 'พร้อมหมุน'
      : msToCountdownText(check.remainingMs),
    nextSpinAt: check.nextSpinAt || null,
    lastSpinAt: state.lastSpinAt || null,
    totalSpins: normalizeAmount(state.totalSpins, 0),
    history: Array.isArray(state.history) ? state.history : [],
    rewards: wheelConfig.rewards.map((row) => ({
      id: row.id,
      label: row.label,
      type: row.type,
      amount: row.amount,
      weight: row.weight,
      itemId: row.itemId || null,
      gameItemId: row.gameItemId || null,
      quantity: row.quantity || 0,
      iconUrl: row.iconUrl || null,
    })),
  };
}

function getRentTimezone() {
  return normalizeText(config.rentBike?.timezone) || 'Asia/Phnom_Penh';
}

function getDatePartsInTimezone(date, timezone) {
  const safeDate = date instanceof Date ? date : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(safeDate);
  const out = {};
  for (const part of parts) {
    out[part.type] = part.value;
  }
  return out;
}

function getDateKeyInTimezone(timezone, date = new Date()) {
  const parts = getDatePartsInTimezone(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getNextMidnightIsoInTimezone(timezone, date = new Date()) {
  try {
    const currentLocal = new Date(
      date.toLocaleString('en-US', { timeZone: timezone }),
    );
    if (Number.isNaN(currentLocal.getTime())) return null;
    const nextLocalMidnight = new Date(currentLocal);
    nextLocalMidnight.setHours(24, 0, 0, 0);
    const diffMs = nextLocalMidnight.getTime() - currentLocal.getTime();
    return new Date(date.getTime() + diffMs).toISOString();
  } catch {
    return null;
  }
}

function walletReasonLabel(reason) {
  const key = normalizeText(reason).toLowerCase();
  const map = {
    daily_claim: 'รับรางวัลรายวัน',
    weekly_claim: 'รับรางวัลรายสัปดาห์',
    purchase_debit: 'ซื้อสินค้า',
    cart_checkout_debit: 'ชำระตะกร้า',
    redeem_code_coins: 'ใช้โค้ดแลกเหรียญ',
    wheel_spin_reward: 'วงล้อสุ่มรางวัล',
    wheel_spin_rollback: 'ย้อนกลับรางวัลวงล้อ',
    gift_transfer_out: 'โอนเหรียญออก',
    gift_transfer_in: 'รับเหรียญจากผู้เล่น',
    admin_wallet_set: 'แอดมินตั้งค่าเหรียญ',
    admin_wallet_add: 'แอดมินเพิ่มเหรียญ',
    admin_wallet_remove: 'แอดมินหักเหรียญ',
    wallet_add: 'เพิ่มเหรียญ',
    wallet_remove: 'หักเหรียญ',
    wallet_set: 'ตั้งค่ายอดเหรียญ',
    vip_purchase: 'ซื้อ VIP',
  };
  return map[key] || (key || 'unknown');
}

async function resolveSessionSteamLink(discordId) {
  const [link, account] = await Promise.all([
    Promise.resolve(getLinkByUserId(discordId)),
    getPlayerAccount(discordId),
  ]);
  const steamId = link?.steamId || normalizeText(account?.steamId) || null;
  const inGameName = normalizeText(link?.inGameName) || null;
  return {
    linked: Boolean(steamId),
    steamId,
    inGameName,
    linkedAt: link?.linkedAt || null,
  };
}

function buildNotificationItems(payload = {}) {
  const items = [];
  const purchases = Array.isArray(payload.purchases) ? payload.purchases : [];
  const ledgers = Array.isArray(payload.ledgers) ? payload.ledgers : [];
  const rentals = Array.isArray(payload.rentals) ? payload.rentals : [];

  for (const row of purchases.slice(0, 10)) {
    items.push({
      type: 'purchase',
      title: `คำสั่งซื้อ ${row.code || '-'}`,
      message: `${row.itemName || row.itemId || '-'} | สถานะ ${row.status || '-'}`,
      createdAt: row.createdAt || null,
    });
  }

  for (const row of ledgers.slice(0, 10)) {
    items.push({
      type: 'wallet',
      title: walletReasonLabel(row.reason),
      message: `${row.delta >= 0 ? '+' : ''}${row.delta || 0} | ยอดหลังทำรายการ ${row.balanceAfter || 0}`,
      createdAt: row.createdAt || null,
    });
  }

  for (const row of rentals.slice(0, 10)) {
    items.push({
      type: 'rentbike',
      title: `เช่ารถ: ${row.status || '-'}`,
      message: `order: ${row.orderId || '-'} | vehicle: ${row.vehicleInstanceId || '-'}`,
      createdAt: row.updatedAt || row.createdAt || null,
    });
  }

  items.sort((a, b) => {
    const at = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bt - at;
  });
  return items.slice(0, 30);
}

function buildSecurityHeaders(extra = {}, options = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  };

  if (SECURE_COOKIE) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  if (options.isHtml) {
    const frameSrcList = ["'self'", ...getFrameSrcOrigins()];
    headers['Content-Security-Policy'] = [
      "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      `frame-src ${frameSrcList.join(' ')}`,
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
  }

  return { ...headers, ...extra };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  let effectiveStatus = statusCode;
  let body = '';
  try {
    body = safeJsonStringify(payload);
  } catch (error) {
    effectiveStatus = 500;
    body = safeJsonStringify({
      ok: false,
      error: 'Internal serialization error',
    });
    console.error(
      '[web-portal-standalone] sendJson serialize failed:',
      error?.message || error,
    );
  }

  res.writeHead(
    effectiveStatus,
    buildSecurityHeaders({
      'Content-Type': 'application/json; charset=utf-8',
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
      },
      { isHtml: true },
    ),
  );
  res.end(html);
}

function sendFavicon(res) {
  res.writeHead(
    200,
    buildSecurityHeaders({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    }),
  );
  res.end(FAVICON_SVG);
}

function getIconContentType(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === '.png') return 'image/png';
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  return 'image/webp';
}

function resolveStaticScumIconPath(pathname) {
  const prefixes = ['/assets/scum-items/', '/player/assets/scum-items/'];
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
  const absPath = path.resolve(SCUM_ITEMS_DIR_PATH, relativeName);
  if (!absPath.startsWith(SCUM_ITEMS_DIR_PATH)) {
    return null;
  }
  return {
    absPath,
    ext,
  };
}

async function tryServeStaticScumIcon(req, res, pathname) {
  if (String(req.method || '').toUpperCase() !== 'GET') return false;
  const resolved = resolveStaticScumIconPath(pathname);
  if (!resolved) return false;
  try {
    const stat = await fs.promises.stat(resolved.absPath);
    if (!stat.isFile()) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return true;
    }
    res.writeHead(
      200,
      buildSecurityHeaders({
        'Content-Type': getIconContentType(resolved.ext),
        'Cache-Control': 'public, max-age=86400',
      }),
    );
    await pipeline(fs.createReadStream(resolved.absPath), res);
    return true;
  } catch {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return true;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
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
  if (SECURE_COOKIE) parts.push('Secure');
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
  if (SECURE_COOKIE) parts.push('Secure');
  return parts.join('; ');
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sessionId = String(cookies[SESSION_COOKIE_NAME] || '').trim();
  if (!sessionId) return null;

  const row = sessions.get(sessionId);
  if (!row) return null;

  const now = Date.now();
  if (row.expiresAt <= now) {
    sessions.delete(sessionId);
    return null;
  }

  row.expiresAt = now + SESSION_TTL_MS;
  return row;
}

function createSession(payload) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  sessions.set(sessionId, {
    ...payload,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return sessionId;
}

function removeSession(req) {
  const cookies = parseCookies(req);
  const sessionId = String(cookies[SESSION_COOKIE_NAME] || '').trim();
  if (!sessionId) return;
  sessions.delete(sessionId);
}

function cleanupRuntimeState() {
  const now = Date.now();

  for (const [sessionId, row] of sessions.entries()) {
    if (!row || row.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }

  for (const [state, row] of oauthStates.entries()) {
    if (!row || row.expiresAt <= now) {
      oauthStates.delete(state);
    }
  }
}

function getBaseOrigin() {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return null;
  }
}

function getForwardedProto(req) {
  const raw = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (!raw) return null;
  return raw;
}

function getCanonicalRedirectUrl(req) {
  let expected;
  try {
    expected = new URL(BASE_URL);
  } catch {
    return null;
  }

  const reqHost = String(req.headers.host || '').trim().toLowerCase();
  const expectedHost = String(expected.host || '').trim().toLowerCase();
  const forwardedProto = getForwardedProto(req);
  const reqProto = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const expectedProto = String(expected.protocol || 'http:').replace(':', '').toLowerCase();

  const hostMismatch = Boolean(reqHost) && reqHost !== expectedHost;
  const protoMismatch = Boolean(reqProto) && reqProto !== expectedProto;
  if (!hostMismatch && !protoMismatch) return null;

  try {
    return new URL(req.url || '/', BASE_URL).toString();
  } catch {
    return null;
  }
}

function verifyOrigin(req) {
  if (!ENFORCE_ORIGIN_CHECK) return true;

  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  const expectedOrigin = getBaseOrigin();
  if (!expectedOrigin) return false;

  const originHeader = String(req.headers.origin || '').trim();
  if (originHeader && originHeader !== expectedOrigin) return false;

  const referer = String(req.headers.referer || '').trim();
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (refererOrigin !== expectedOrigin) return false;
    } catch {
      return false;
    }
  }

  return true;
}

async function readRawBody(req, maxBytes) {
  const limit = Math.max(1024, Number(maxBytes || 1024 * 1024));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted')));
  });
}

async function readJsonBody(req) {
  const buf = await readRawBody(req, 1024 * 1024);
  if (!buf || buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

function loadHtmlTemplate(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function getFileMtimeMs(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return Number(stat.mtimeMs || 0);
  } catch {
    return 0;
  }
}

function getPlayerHtml() {
  const mtimeMs = getFileMtimeMs(PLAYER_HTML_PATH);
  if (!cachedPlayerHtml || !IS_PRODUCTION || mtimeMs > cachedPlayerHtmlMtimeMs) {
    cachedPlayerHtml = loadHtmlTemplate(PLAYER_HTML_PATH);
    cachedPlayerHtmlMtimeMs = mtimeMs;
  }
  return cachedPlayerHtml;
}

function getLandingHtml() {
  const mtimeMs = getFileMtimeMs(LANDING_HTML_PATH);
  if (!cachedLandingHtml || !IS_PRODUCTION || mtimeMs > cachedLandingHtmlMtimeMs) {
    cachedLandingHtml = loadHtmlTemplate(LANDING_HTML_PATH);
    cachedLandingHtmlMtimeMs = mtimeMs;
  }
  return cachedLandingHtml;
}

function getTrialHtml() {
  const mtimeMs = getFileMtimeMs(TRIAL_HTML_PATH);
  if (!cachedTrialHtml || !IS_PRODUCTION || mtimeMs > cachedTrialHtmlMtimeMs) {
    cachedTrialHtml = loadHtmlTemplate(TRIAL_HTML_PATH);
    cachedTrialHtmlMtimeMs = mtimeMs;
  }
  return cachedTrialHtml;
}

function renderMarkdownDocument(title, markdown) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;background:#0c1318;color:#e9f3f3;font-family:ui-sans-serif,system-ui,sans-serif}
    .shell{width:min(980px,calc(100% - 32px));margin:0 auto;padding:28px 0 44px}
    .card{background:#121d24;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:22px;box-shadow:0 24px 56px rgba(0,0,0,.28)}
    a{color:#8fd4c8}
    h1{margin:0 0 16px;font-size:32px}
    pre{white-space:pre-wrap;line-height:1.7;font-size:14px;color:#bcd0cf}
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <p><a href="/landing">กลับหน้า Landing</a></p>
      <h1>${escapeHtml(title)}</h1>
      <pre>${escapeHtml(markdown)}</pre>
    </div>
  </div>
</body>
</html>`;
}

function tryServePublicDoc(pathname, res) {
  if (!pathname.startsWith('/docs/')) return false;
  const relative = pathname.slice('/docs/'.length);
  if (!relative || !relative.toLowerCase().endsWith('.md')) return false;
  const absolute = path.resolve(DOCS_DIR_PATH, relative);
  if (!absolute.startsWith(DOCS_DIR_PATH)) return false;
  if (!fs.existsSync(absolute)) return false;
  const markdown = fs.readFileSync(absolute, 'utf8');
  sendHtml(
    res,
    200,
    renderMarkdownDocument(path.basename(relative), markdown),
  );
  return true;
}

function renderLoginPage(message) {
  const mtimeMs = getFileMtimeMs(LOGIN_HTML_PATH);
  if (!cachedLoginHtml || !IS_PRODUCTION || mtimeMs > cachedLoginHtmlMtimeMs) {
    cachedLoginHtml = loadHtmlTemplate(LOGIN_HTML_PATH);
    cachedLoginHtmlMtimeMs = mtimeMs;
  }
  const safe = escapeHtml(String(message || ''));
  return cachedLoginHtml.replace('__ERROR_MESSAGE__', safe);
}

// Keep the public showcase static and cacheable so sales/demo flows do not depend on auth or API calls.
function getShowcaseHtml() {
  const mtimeMs = getFileMtimeMs(SHOWCASE_HTML_PATH);
  if (!cachedShowcaseHtml || !IS_PRODUCTION || mtimeMs > cachedShowcaseHtmlMtimeMs) {
    cachedShowcaseHtml = loadHtmlTemplate(SHOWCASE_HTML_PATH);
    cachedShowcaseHtmlMtimeMs = mtimeMs;
  }
  return cachedShowcaseHtml;
}

function startOauthState() {
  cleanupRuntimeState();
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, {
    createdAt: Date.now(),
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });
  return state;
}

function getDiscordRedirectUri() {
  return new URL(DISCORD_REDIRECT_PATH, BASE_URL).toString();
}

function buildDiscordAuthorizeUrl(state) {
  const url = new URL(`${DISCORD_API_BASE}/oauth2/authorize`);
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', getDiscordRedirectUri());
  url.searchParams.set('response_type', 'code');

  const scopes = ['identify'];
  if (!PLAYER_OPEN_ACCESS && REQUIRE_GUILD_MEMBER && DISCORD_GUILD_ID) {
    scopes.push('guilds.members.read');
  }
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeDiscordCode(code) {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getDiscordRedirectUri(),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(`Discord token exchange failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDiscordProfile(accessToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new Error('Discord profile fetch failed');
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDiscordGuildMember(accessToken, guildId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `${DISCORD_API_BASE}/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      throw new Error(`Discord guild membership check failed (${res.status})`);
    }
    return res.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleDiscordStart(_req, res) {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return sendJson(res, 500, {
      ok: false,
      error: 'Discord OAuth env is not configured',
    });
  }

  const state = startOauthState();
  res.writeHead(302, { Location: buildDiscordAuthorizeUrl(state) });
  res.end();
}

async function handleDiscordCallback(_req, res, urlObj) {
  try {
    cleanupRuntimeState();

    const state = normalizeText(urlObj.searchParams.get('state'));
    const code = normalizeText(urlObj.searchParams.get('code'));
    const errorText = normalizeText(urlObj.searchParams.get('error'));

    if (errorText) {
      res.writeHead(302, {
        Location: '/player/login?error=Discord%20authorization%20denied',
      });
      return res.end();
    }

    if (!state || !oauthStates.has(state)) {
      res.writeHead(302, {
        Location: '/player/login?error=Invalid%20OAuth%20state',
      });
      return res.end();
    }
    oauthStates.delete(state);

    if (!code) {
      res.writeHead(302, {
        Location: '/player/login?error=Missing%20OAuth%20code',
      });
      return res.end();
    }

    const token = await exchangeDiscordCode(code);
    const profile = await fetchDiscordProfile(token.access_token);

    const discordId = normalizeText(profile.id);
    if (!isDiscordId(discordId)) {
      throw new Error('Discord profile missing id');
    }

    if (!PLAYER_OPEN_ACCESS) {
      if (ALLOWED_DISCORD_IDS.size > 0 && !ALLOWED_DISCORD_IDS.has(discordId)) {
        res.writeHead(302, {
          Location: '/player/login?error=Discord%20account%20not%20allowed',
        });
        return res.end();
      }

      if (REQUIRE_GUILD_MEMBER && DISCORD_GUILD_ID) {
        try {
          await fetchDiscordGuildMember(token.access_token, DISCORD_GUILD_ID);
        } catch (error) {
          console.warn('[web-portal-standalone] guild membership check failed:', error.message);
          res.writeHead(302, {
            Location: '/player/login?error=Discord%20guild%20membership%20required',
          });
          return res.end();
        }
      }
    }

    const user = [profile.global_name, profile.username]
      .map((value) => normalizeText(value))
      .find(Boolean)
      || discordId;

    const avatarUrl = buildDiscordAvatarUrl(profile);
    await upsertPlayerAccount({
      discordId,
      username: normalizeText(profile.username),
      displayName: normalizeText(profile.global_name) || user,
      avatarUrl,
      isActive: true,
    });

    const sessionId = createSession({
      user,
      role: 'player',
      discordId,
      authMethod: 'discord-oauth',
      avatarUrl,
    });

    res.writeHead(302, {
      Location: '/player',
      'Set-Cookie': buildSessionCookie(sessionId),
    });
    res.end();
  } catch (error) {
    console.error('[web-portal-standalone] discord callback failed:', error);
    res.writeHead(302, {
      Location: '/player/login?error=Discord%20login%20failed',
    });
    res.end();
  }
}

function filterShopItems(rows, options = {}) {
  const kindFilter = normalizeText(options.kind).toLowerCase();
  const query = normalizeText(options.q).toLowerCase();
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 120)));
  const out = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const kind = normalizeText(row?.kind).toLowerCase() === 'vip' ? 'vip' : 'item';
    if (kindFilter && kindFilter !== 'all' && kind !== kindFilter) continue;

    const haystack = [
      row?.id,
      row?.name,
      row?.description,
      row?.gameItemId,
    ]
      .map((value) => normalizeText(value).toLowerCase())
      .join(' ');
    if (query && !haystack.includes(query)) continue;

    const requiresSteamLink = isGameItemShopKind(kind);
    out.push({
      ...row,
      kind,
      iconUrl: normalizeText(row?.iconUrl) || resolveItemIconUrl(row),
      stock: row?.stock == null ? null : normalizeAmount(row.stock, 0),
      requiresSteamLink,
    });
    if (out.length >= limit) break;
  }

  return out;
}

function serializeCartResolved(resolved) {
  const rows = Array.isArray(resolved?.rows) ? resolved.rows : [];
  return {
    rows: rows.map((row) => ({
      itemId: row.itemId,
      quantity: normalizeQuantity(row.quantity, 1),
      lineTotal: normalizeAmount(row.lineTotal, 0),
      item: row.item
        ? {
            id: row.item.id,
            name: row.item.name,
            price: normalizeAmount(row.item.price, 0),
            kind: normalizeShopKind(row.item.kind),
            description: normalizeText(row.item.description),
            iconUrl: normalizeText(row.item.iconUrl) || resolveItemIconUrl(row.item),
            bundle: buildBundleSummary(row.item),
            stock: row.item.stock == null ? null : normalizeAmount(row.item.stock, 0),
            requiresSteamLink: isGameItemShopKind(row.item.kind),
          }
        : null,
    })),
    missingItemIds: Array.isArray(resolved?.missingItemIds) ? resolved.missingItemIds : [],
    totalPrice: normalizeAmount(resolved?.totalPrice, 0),
    totalUnits: normalizeAmount(resolved?.totalUnits, 0),
  };
}

async function buildPlayerNameLookup() {
  const rows = await listPlayerAccounts(2000).catch(() => []);
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const discordId = normalizeText(row?.discordId);
    if (!isDiscordId(discordId)) continue;
    const display = [
      normalizeText(row?.displayName),
      normalizeText(row?.username),
      discordId,
    ].find(Boolean) || discordId;
    map.set(discordId, display);
  }
  return map;
}

function normalizeSquadName(value) {
  const name = normalizeText(value);
  return name || null;
}

async function resolvePartyContext(discordId) {
  const userId = normalizeText(discordId);
  const statsRows = listAllStats();
  const rows = Array.isArray(statsRows) ? statsRows : [];
  const statsByUser = new Map();
  for (const row of rows) {
    const id = normalizeText(row?.userId);
    if (!id) continue;
    statsByUser.set(id, row);
  }
  const selfStat = statsByUser.get(userId) || null;
  const selfSquad = normalizeSquadName(selfStat?.squad);

  const nameMap = await buildPlayerNameLookup();
  const memberIds = new Set([userId]);
  let partyKey = null;
  let source = 'none';
  let title = 'ยังไม่เข้าปาร์ตี้';
  let chatEnabled = false;

  if (selfSquad) {
    const squadKey = selfSquad.toLowerCase();
    partyKey =
      normalizePartyKey(`squad:${squadKey}`)
      || normalizePartyKey(`squad:${squadKey.replace(/[^a-z0-9_-]/g, '')}`);
    source = 'stats.squad';
    title = `ปาร์ตี้ ${selfSquad}`;
    chatEnabled = Boolean(partyKey);
    for (const row of rows) {
      const rowUserId = normalizeText(row?.userId);
      if (!rowUserId) continue;
      const rowSquad = normalizeSquadName(row?.squad);
      if (!rowSquad) continue;
      if (rowSquad.toLowerCase() !== squadKey) continue;
      memberIds.add(rowUserId);
    }
  }

  const members = Array.from(memberIds)
    .map((id) => {
      const stat = statsByUser.get(id);
      const link = getLinkByUserId(id);
      return {
        discordId: id,
        displayName: nameMap.get(id) || id,
        steamId: normalizeText(link?.steamId) || null,
        inGameName: normalizeText(link?.inGameName) || null,
        squad: normalizeSquadName(stat?.squad),
        isSelf: id === userId,
      };
    })
    .sort((a, b) => {
      if (a.isSelf && !b.isSelf) return -1;
      if (!a.isSelf && b.isSelf) return 1;
      return String(a.displayName).localeCompare(String(b.displayName), 'th');
    });

  return {
    partyKey,
    squad: selfSquad,
    title,
    source,
    chatEnabled,
    memberCount: members.length,
    members,
  };
}

function sortLeaderboardRows(rows, type) {
  if (type === 'playtime') {
    rows.sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);
    return;
  }
  if (type === 'kd') {
    rows.sort((a, b) => b.kd - a.kd);
    return;
  }
  rows.sort((a, b) => b.kills - a.kills);
}

async function handlePlayerApi(req, res, urlObj) {
  const pathname = urlObj.pathname;
  const method = String(req.method || 'GET').toUpperCase();

  if (!verifyOrigin(req)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'Cross-site request denied',
    });
  }

  const session = getSession(req);
  if (!session || !isDiscordId(session.discordId)) {
    return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
  }

  if (pathname === '/player/api/me' && method === 'GET') {
    const [account, link] = await Promise.all([
      getPlayerAccount(session.discordId),
      resolveSessionSteamLink(session.discordId),
    ]);
    return sendJson(res, 200, {
      ok: true,
      data: {
        user: session.user,
        role: session.role,
        discordId: session.discordId,
        authMethod: session.authMethod,
        avatarUrl: normalizeText(session.avatarUrl)
          || normalizeText(account?.avatarUrl)
          || null,
        accountStatus: account?.isActive === false ? 'inactive' : 'active',
        steamLinked: Boolean(link?.linked),
      },
    });
  }

  if (pathname === '/player/api/logout' && method === 'POST') {
    removeSession(req);
    return sendJson(
      res,
      200,
      { ok: true, data: { loggedOut: true } },
      { 'Set-Cookie': buildClearSessionCookie() },
    );
  }

  if (pathname === '/player/api/server/info' && method === 'GET') {
    const serverInfo = config.serverInfo || {};
    const raidTimes = Array.isArray(config.raidTimes) ? config.raidTimes : [];
    const status = getStatus();
    const economy = getEconomyConfig();
    const luckyWheel = getLuckyWheelConfig();
    const mapPortal = getMapPortalConfig();
    const rulesShort = Array.isArray(serverInfo.rulesShort)
      ? serverInfo.rulesShort.map((line) => normalizeText(line)).filter(Boolean)
      : [];
    return sendJson(res, 200, {
      ok: true,
      data: {
        economy,
        serverInfo: {
          name: normalizeText(serverInfo.name) || 'SCUM Server',
          description: normalizeText(serverInfo.description),
          ip: normalizeText(serverInfo.ip),
          port: normalizeText(serverInfo.port),
          maxPlayers: normalizeAmount(serverInfo.maxPlayers, 0),
          rulesShort,
          website: normalizeText(serverInfo.website),
        },
        raidTimes: raidTimes.map((line) => normalizeText(line)).filter(Boolean),
        tips: luckyWheel.tips,
        luckyWheel: {
          enabled: luckyWheel.enabled,
          cooldownMs: luckyWheel.cooldownMs,
          rewards: luckyWheel.rewards.map((row) => ({
            id: row.id,
            label: row.label,
            type: row.type,
            amount: row.amount,
            weight: row.weight,
            itemId: row.itemId || null,
            gameItemId: row.gameItemId || null,
            quantity: row.quantity || 0,
            iconUrl: row.iconUrl || null,
          })),
        },
        mapPortal,
        status,
      },
    });
  }

  if (pathname === '/player/api/online' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      data: getStatus(),
    });
  }

  if (pathname === '/player/api/prices' && method === 'GET') {
    const economy = getEconomyConfig();
    return sendJson(res, 200, {
      ok: true,
      data: {
        currencySymbol: economy.currencySymbol,
        dailyReward: economy.dailyReward,
        weeklyReward: economy.weeklyReward,
        message:
          `สกุลเงินหลัก: ${economy.currencySymbol} | ` +
          `รายวัน: ${economy.dailyReward.toLocaleString()} | ` +
          `รายสัปดาห์: ${economy.weeklyReward.toLocaleString()}`,
      },
    });
  }

  if (pathname === '/player/api/leaderboard' && method === 'GET') {
    const typeRaw = normalizeText(urlObj.searchParams.get('type')).toLowerCase();
    const type = ['economy', 'kills', 'kd', 'playtime'].includes(typeRaw)
      ? typeRaw
      : 'kills';
    const limit = asInt(urlObj.searchParams.get('limit'), 10, 3, 50);
    const nameMap = await buildPlayerNameLookup();

    if (type === 'economy') {
      const rows = await listTopWallets(limit);
      const items = rows.map((row, index) => {
        const userId = normalizeText(row?.userId);
        return {
          rank: index + 1,
          userId,
          name: nameMap.get(userId) || userId,
          balance: normalizeAmount(row?.balance, 0),
        };
      });
      return sendJson(res, 200, {
        ok: true,
        data: {
          type,
          total: items.length,
          items,
        },
      });
    }

    const allStats = listAllStats().map((row) => {
      const kills = normalizeAmount(row?.kills, 0);
      const deaths = normalizeAmount(row?.deaths, 0);
      const playtimeMinutes = normalizeAmount(row?.playtimeMinutes, 0);
      const kd = deaths === 0 ? kills : kills / deaths;
      return {
        userId: normalizeText(row?.userId),
        kills,
        deaths,
        playtimeMinutes,
        kd,
      };
    });

    sortLeaderboardRows(allStats, type);
    const items = allStats.slice(0, limit).map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      name: nameMap.get(row.userId) || row.userId,
      kills: row.kills,
      deaths: row.deaths,
      kd: Number(row.kd.toFixed(2)),
      playtimeMinutes: row.playtimeMinutes,
      playtimeHours: Math.floor(row.playtimeMinutes / 60),
    }));

    return sendJson(res, 200, {
      ok: true,
      data: {
        type,
        total: items.length,
        items,
      },
    });
  }

  if (pathname === '/player/api/stats/me' && method === 'GET') {
    const stats = getStats(session.discordId);
    return sendJson(res, 200, {
      ok: true,
      data: {
        userId: session.discordId,
        kills: normalizeAmount(stats?.kills, 0),
        deaths: normalizeAmount(stats?.deaths, 0),
        kd: Number(
          (
            (normalizeAmount(stats?.deaths, 0) === 0
              ? normalizeAmount(stats?.kills, 0)
              : normalizeAmount(stats?.kills, 0) / normalizeAmount(stats?.deaths, 0))
          ).toFixed(2),
        ),
        playtimeMinutes: normalizeAmount(stats?.playtimeMinutes, 0),
      },
    });
  }

  if (pathname === '/player/api/profile' && method === 'GET') {
    const [account, link] = await Promise.all([
      getPlayerAccount(session.discordId),
      resolveSessionSteamLink(session.discordId),
    ]);
    return sendJson(res, 200, {
      ok: true,
      data: {
        discordId: session.discordId,
        user: session.user,
        role: session.role || 'player',
        avatarUrl: normalizeText(session.avatarUrl)
          || normalizeText(account?.avatarUrl)
          || null,
        username: normalizeText(account?.username)
          || normalizeText(session.user)
          || null,
        displayName: normalizeText(account?.displayName)
          || normalizeText(session.user)
          || null,
        accountStatus: account?.isActive === false ? 'inactive' : 'active',
        createdAt: account?.createdAt || null,
        updatedAt: account?.updatedAt || null,
        steamLink: link,
      },
    });
  }

  if (pathname === '/player/api/party' && method === 'GET') {
    const party = await resolvePartyContext(session.discordId);
    return sendJson(res, 200, {
      ok: true,
      data: party,
    });
  }

  if (pathname === '/player/api/party/chat' && method === 'GET') {
    const limit = asInt(urlObj.searchParams.get('limit'), 80, 1, 200);
    const party = await resolvePartyContext(session.discordId);
    const items =
      party.chatEnabled && party.partyKey
        ? await listPartyMessages(party.partyKey, limit)
        : [];
    return sendJson(res, 200, {
      ok: true,
      data: {
        party,
        total: items.length,
        items,
      },
    });
  }

  if (pathname === '/player/api/party/chat/send' && method === 'POST') {
    const body = await readJsonBody(req);
    const message = normalizeText(body.message || body.text);
    if (!message) {
      return sendJson(res, 400, {
        ok: false,
        error: 'missing-message',
        data: {
          message: 'กรุณาพิมพ์ข้อความก่อนส่ง',
        },
      });
    }
    if (message.length > PARTY_CHAT_MAX_LENGTH) {
      return sendJson(res, 400, {
        ok: false,
        error: 'message-too-long',
        data: {
          maxLength: PARTY_CHAT_MAX_LENGTH,
          message: `ข้อความยาวเกินไป (สูงสุด ${PARTY_CHAT_MAX_LENGTH} ตัวอักษร)`,
        },
      });
    }

    const party = await resolvePartyContext(session.discordId);
    if (!party.chatEnabled || !party.partyKey) {
      return sendJson(res, 400, {
        ok: false,
        error: 'party-chat-unavailable',
        data: {
          message: 'ยังไม่พบปาร์ตี้ของคุณในระบบ (ต้องมี squad ก่อน)',
        },
      });
    }

    const nowMs = Date.now();
    const previousMs = partyChatLastSentAt.get(session.discordId) || 0;
    if (nowMs - previousMs < PARTY_CHAT_MIN_INTERVAL_MS) {
      return sendJson(res, 429, {
        ok: false,
        error: 'party-chat-rate-limit',
        data: {
          retryAfterMs: PARTY_CHAT_MIN_INTERVAL_MS - (nowMs - previousMs),
          message: 'ส่งข้อความเร็วเกินไป กรุณารอสักครู่',
        },
      });
    }

    const me = party.members.find((row) => row.discordId === session.discordId);
    const displayName =
      normalizeText(me?.displayName) || normalizeText(session.user) || session.discordId;
    const addResult = await addPartyMessage(party.partyKey, {
      userId: session.discordId,
      displayName,
      message,
    });
    if (!addResult?.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: addResult?.reason || 'party-chat-send-failed',
      });
    }
    partyChatLastSentAt.set(session.discordId, nowMs);

    return sendJson(res, 200, {
      ok: true,
      data: {
        party,
        item: addResult.data,
      },
    });
  }

  if (pathname === '/player/api/wallet/ledger' && method === 'GET') {
    const limit = asInt(urlObj.searchParams.get('limit'), 50, 1, 500);
    const wallet = await getWallet(session.discordId);
    const rows = await listWalletLedger(session.discordId, limit);
    const items = rows.map((row) => ({
      id: row.id,
      delta: normalizeAmount(row.delta, 0) * (Number(row.delta || 0) < 0 ? -1 : 1),
      balanceBefore: normalizeAmount(row.balanceBefore, 0),
      balanceAfter: normalizeAmount(row.balanceAfter, 0),
      reason: normalizeText(row.reason),
      reasonLabel: walletReasonLabel(row.reason),
      reference: normalizeText(row.reference) || null,
      actor: normalizeText(row.actor) || null,
      meta: row.meta || null,
      createdAt: row.createdAt || null,
    }));
    return sendJson(res, 200, {
      ok: true,
      data: {
        wallet: {
          userId: session.discordId,
          balance: normalizeAmount(wallet.balance, 0),
        },
        total: items.length,
        items,
      },
    });
  }

  if (pathname === '/player/api/redeem/history' && method === 'GET') {
    const limit = asInt(urlObj.searchParams.get('limit'), 50, 1, 500);
    const rows = listCodes()
      .filter((row) => normalizeText(row.usedBy) === session.discordId)
      .sort((a, b) => {
        const at = a?.usedAt ? new Date(a.usedAt).getTime() : 0;
        const bt = b?.usedAt ? new Date(b.usedAt).getTime() : 0;
        return bt - at;
      })
      .slice(0, limit)
      .map((row) => ({
        code: row.code,
        type: row.type,
        amount: row.amount == null ? null : normalizeAmount(row.amount, 0),
        itemId: normalizeText(row.itemId) || null,
        usedBy: normalizeText(row.usedBy) || null,
        usedAt: row.usedAt || null,
      }));
    return sendJson(res, 200, {
      ok: true,
      data: {
        total: rows.length,
        items: rows,
      },
    });
  }

  if (pathname === '/player/api/rentbike/status' && method === 'GET') {
    const link = await resolveSessionSteamLink(session.discordId);
    if (!link.linked || !link.steamId) {
      return sendJson(res, 200, {
        ok: true,
        data: {
          linked: false,
          steamId: null,
          current: null,
          history: [],
          todayQuotaUsed: false,
          nextResetAt: getNextMidnightIsoInTimezone(getRentTimezone()),
        },
      });
    }

    await ensureRentBikeTables();
    const timezone = getRentTimezone();
    const dateKey = getDateKeyInTimezone(timezone);
    const [dailyRent, rentals] = await Promise.all([
      getDailyRent(link.steamId, dateKey),
      listRentalVehicles(400),
    ]);
    const history = rentals
      .filter((row) => normalizeText(row.userKey) === link.steamId)
      .sort((a, b) => {
        const at = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bt - at;
      });
    const current = history.find((row) =>
      ['pending', 'delivering', 'delivered'].includes(
        normalizeText(row.status).toLowerCase(),
      ),
    ) || null;
    return sendJson(res, 200, {
      ok: true,
      data: {
        linked: true,
        steamId: link.steamId,
        todayQuotaUsed: Boolean(dailyRent?.used),
        nextResetAt: getNextMidnightIsoInTimezone(timezone),
        current,
        history: history.slice(0, 50),
      },
    });
  }

  if (pathname === '/player/api/missions' && method === 'GET') {
    const [dailyCheck, weeklyCheck, rentLink] = await Promise.all([
      canClaimDaily(session.discordId),
      canClaimWeekly(session.discordId),
      resolveSessionSteamLink(session.discordId),
    ]);
    const timezone = getRentTimezone();
    const dateKey = getDateKeyInTimezone(timezone);
    let rentDaily = null;
    if (rentLink?.steamId) {
      await ensureRentBikeTables();
      rentDaily = await getDailyRent(rentLink.steamId, dateKey);
    }

    return sendJson(res, 200, {
      ok: true,
      data: {
        missions: [
          {
            id: 'daily-claim',
            title: 'ภารกิจรายวัน: รับเหรียญ',
            category: 'daily',
            completed: !dailyCheck?.ok,
            claimable: Boolean(dailyCheck?.ok),
            remainingMs: dailyCheck?.ok ? 0 : normalizeAmount(dailyCheck?.remainingMs, 0),
            remainingText: dailyCheck?.ok ? 'พร้อมรับ' : msToHoursMinutes(dailyCheck?.remainingMs),
          },
          {
            id: 'weekly-claim',
            title: 'ภารกิจรายสัปดาห์: รับเหรียญ',
            category: 'weekly',
            completed: !weeklyCheck?.ok,
            claimable: Boolean(weeklyCheck?.ok),
            remainingMs: weeklyCheck?.ok ? 0 : normalizeAmount(weeklyCheck?.remainingMs, 0),
            remainingText: weeklyCheck?.ok ? 'พร้อมรับ' : msToDaysHours(weeklyCheck?.remainingMs),
          },
          {
            id: 'rentbike-daily',
            title: 'สิทธิ์เช่ามอไซรายวัน',
            category: 'vehicle',
            completed: Boolean(rentDaily?.used),
            claimable: rentLink?.steamId ? !Boolean(rentDaily?.used) : false,
            remainingMs: Boolean(rentDaily?.used) ? 1 : 0,
            remainingText: Boolean(rentDaily?.used)
              ? `รีเซ็ต ${getDateKeyInTimezone(timezone)} 00:00 (${timezone})`
              : rentLink?.steamId
                ? 'พร้อมเช่า'
                : 'ต้องลิงก์ SteamID ก่อน',
          },
        ],
      },
    });
  }

  if (pathname === '/player/api/wheel/state' && method === 'GET') {
    const wheelConfig = getLuckyWheelConfig();
    const limit = asInt(urlObj.searchParams.get('limit'), 20, 1, 80);
    return sendJson(res, 200, {
      ok: true,
      data: await buildWheelStatePayload(session.discordId, wheelConfig, limit),
    });
  }

  if (pathname === '/player/api/wheel/spin' && method === 'POST') {
    const wheelConfig = getLuckyWheelConfig();
    if (!wheelConfig.enabled) {
      return sendJson(res, 403, {
        ok: false,
        error: 'wheel-disabled',
        data: {
          message: 'วงล้อสุ่มรางวัลถูกปิดอยู่ชั่วคราว',
        },
      });
    }

    const check = await canSpinWheel(session.discordId, wheelConfig.cooldownMs);
    if (!check.ok) {
      return sendJson(res, 429, {
        ok: false,
        error: 'wheel-cooldown',
        data: {
          remainingMs: normalizeAmount(check.remainingMs, 0),
          remainingText: msToCountdownText(check.remainingMs),
          nextSpinAt: check.nextSpinAt || null,
          message: 'ยังหมุนไม่ได้ในตอนนี้',
        },
      });
    }

    const reward = pickLuckyWheelReward(wheelConfig.rewards);
    if (!reward) {
      return sendJson(res, 500, {
        ok: false,
        error: 'wheel-reward-not-found',
      });
    }
    const wheelResult = await awardWheelRewardForUser({
      userId: session.discordId,
      reward,
      source: 'player-portal',
      actor: 'system',
    });
    if (!wheelResult.ok) {
      const error = wheelResult.reason || 'wheel-award-failed';
      const statusCode = error === 'steam-link-required-for-item-wheel' ? 400 : 500;
      return sendJson(res, statusCode, {
        ok: false,
        error,
        data: {
          message: error === 'steam-link-required-for-item-wheel'
            ? 'วงล้อมีรางวัลไอเทมในเกม กรุณาผูก SteamID ก่อนหมุน'
            : 'ไม่สามารถมอบรางวัลวงล้อได้',
        },
      });
    }

    const wheelState = await buildWheelStatePayload(
      session.discordId,
      wheelConfig,
      20,
    );
    const rewardData = wheelResult.reward || {};
    const rewardLabel = normalizeText(rewardData.label || reward.label || reward.id) || 'รางวัลพิเศษ';

    return sendJson(res, 200, {
      ok: true,
      data: {
        reward: {
          id: rewardData.id,
          label: rewardLabel,
          type: rewardData.type,
          amount: rewardData.amount,
          quantity: rewardData.type === 'item' ? rewardData.quantity : 0,
          itemId: rewardData.type === 'item' ? rewardData.itemId : null,
          gameItemId: rewardData.type === 'item' ? rewardData.gameItemId : null,
          iconUrl: rewardData.iconUrl,
          purchaseCode: rewardData.purchaseCode,
          deliveryQueued: rewardData.deliveryQueued,
          deliveryQueueReason: rewardData.deliveryQueueReason,
          at: rewardData.at,
          awardedCoins: rewardData.awardedCoins,
        },
        walletBalance: normalizeAmount(wheelResult.walletBalance, 0),
        message: wheelResult.message,
        state: wheelState,
      },
    });
  }

  if (pathname === '/player/api/notifications' && method === 'GET') {
    const limit = asInt(urlObj.searchParams.get('limit'), 30, 1, 100);
    const [purchasesRaw, ledgerRaw, rentLink] = await Promise.all([
      listUserPurchases(session.discordId),
      listWalletLedger(session.discordId, limit),
      resolveSessionSteamLink(session.discordId),
    ]);

    let rentalRaw = [];
    if (rentLink?.steamId) {
      await ensureRentBikeTables();
      const rentals = await listRentalVehicles(300);
      rentalRaw = rentals.filter((row) => normalizeText(row.userKey) === rentLink.steamId);
    }

    const items = buildNotificationItems({
      purchases: purchasesRaw.slice(0, limit),
      ledgers: ledgerRaw.slice(0, limit),
      rentals: rentalRaw.slice(0, limit),
    }).slice(0, limit);

    return sendJson(res, 200, {
      ok: true,
      data: {
        total: items.length,
        items,
      },
    });
  }

  if (pathname === '/player/api/linksteam/me' && method === 'GET') {
    const link = await resolveSessionSteamLink(session.discordId);
    return sendJson(res, 200, {
      ok: true,
      data: {
        linked: link.linked,
        steamId: link.steamId,
        inGameName: link.inGameName,
        linkedAt: link.linkedAt,
      },
    });
  }

  if (pathname === '/player/api/linksteam/history' && method === 'GET') {
    const link = await resolveSessionSteamLink(session.discordId);
    const items = [];
    if (link?.steamId) {
      items.push({
        action: 'bind',
        steamId: link.steamId,
        inGameName: link.inGameName || null,
        at: link.linkedAt || null,
      });
    }
    return sendJson(res, 200, {
      ok: true,
      data: {
        total: items.length,
        items,
      },
    });
  }

  if (pathname === '/player/api/linksteam/set' && method === 'POST') {
    const body = await readJsonBody(req);
    const steamId = normalizeText(body.steamId);
    const isSteamId = /^\d{15,25}$/.test(steamId);
    if (!isSteamId) {
      return sendJson(res, 400, {
        ok: false,
        error: 'invalid-steamid',
        data: {
          message: 'SteamID ต้องเป็นตัวเลข 15-25 หลัก',
        },
      });
    }

    const userCurrentLink = await resolveSessionSteamLink(session.discordId);
    if (userCurrentLink?.linked && normalizeText(userCurrentLink.steamId) !== steamId) {
      return sendJson(res, 403, {
        ok: false,
        error: 'steam-link-locked',
        data: {
          message:
            'บัญชีนี้ผูก SteamID ไปแล้ว เปลี่ยนไม่ได้เอง ต้องติดต่อแอดมินเท่านั้น',
          steamId: userCurrentLink.steamId,
        },
      });
    }

    if (userCurrentLink?.linked && normalizeText(userCurrentLink.steamId) === steamId) {
      return sendJson(res, 200, {
        ok: true,
        data: {
          linked: true,
          steamId: userCurrentLink.steamId,
          inGameName: userCurrentLink.inGameName || null,
          locked: true,
        },
      });
    }

    const existing = getLinkBySteamId(steamId);
    if (existing && normalizeText(existing.userId) !== session.discordId) {
      return sendJson(res, 409, {
        ok: false,
        error: 'steamid-already-bound',
        data: {
          message: 'SteamID นี้ถูกผูกกับบัญชีอื่นอยู่แล้ว',
        },
      });
    }
    const result = setLink({
      steamId,
      userId: session.discordId,
      inGameName: null,
    });
    if (!result?.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: result?.reason || 'invalid-steamid',
      });
    }
    return sendJson(res, 200, {
      ok: true,
      data: {
        linked: true,
        steamId: result.steamId,
        inGameName: null,
        locked: true,
      },
    });
  }

  if (pathname === '/player/api/linksteam/unset' && method === 'POST') {
    return sendJson(res, 403, {
      ok: false,
      error: 'steam-link-locked',
      data: {
        message:
          'ไม่สามารถยกเลิกการผูก SteamID ด้วยตัวเองได้ กรุณาติดต่อแอดมิน',
      },
    });
  }

  if (pathname === '/player/api/daily/claim' && method === 'POST') {
    const economy = getEconomyConfig();
    const check = await checkRewardClaimForUser({
      userId: session.discordId,
      type: 'daily',
    });
    if (!check?.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: 'daily-cooldown',
        data: {
          remainingMs: normalizeAmount(check?.remainingMs, 0),
          remainingText: msToHoursMinutes(check?.remainingMs),
        },
      });
    }
    const result = await claimRewardForUser({
      userId: session.discordId,
      type: 'daily',
    });
    if (!result.ok) {
      return sendJson(res, 500, {
        ok: false,
        error: result.reason || 'daily-claim-failed',
      });
    }
    return sendJson(res, 200, {
      ok: true,
      data: {
        reward: economy.dailyReward,
        balance: normalizeAmount(result.balance, 0),
        currencySymbol: economy.currencySymbol,
        message: result.message,
      },
    });
  }

  if (pathname === '/player/api/weekly/claim' && method === 'POST') {
    const economy = getEconomyConfig();
    const check = await checkRewardClaimForUser({
      userId: session.discordId,
      type: 'weekly',
    });
    if (!check?.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: 'weekly-cooldown',
        data: {
          remainingMs: normalizeAmount(check?.remainingMs, 0),
          remainingText: msToDaysHours(check?.remainingMs),
        },
      });
    }
    const result = await claimRewardForUser({
      userId: session.discordId,
      type: 'weekly',
    });
    if (!result.ok) {
      return sendJson(res, 500, {
        ok: false,
        error: result.reason || 'weekly-claim-failed',
      });
    }
    return sendJson(res, 200, {
      ok: true,
      data: {
        reward: economy.weeklyReward,
        balance: normalizeAmount(result.balance, 0),
        currencySymbol: economy.currencySymbol,
        message: result.message,
      },
    });
  }

  if (pathname === '/player/api/gift' && method === 'POST') {
    const body = await readJsonBody(req);
    const targetDiscordId = normalizeText(body.targetDiscordId || body.userId);
    const amount = normalizeAmount(body.amount, 0);
    if (!isDiscordId(targetDiscordId) || amount <= 0) {
      return sendJson(res, 400, {
        ok: false,
        error: 'invalid-input',
      });
    }
    if (targetDiscordId === session.discordId) {
      return sendJson(res, 400, {
        ok: false,
        error: 'cannot-gift-self',
      });
    }

    const result = await transferCoins({
      fromUserId: session.discordId,
      toUserId: targetDiscordId,
      amount,
      actor: `portal:${session.user}`,
      source: 'player-portal-gift',
      outReason: 'gift_transfer_out',
      inReason: 'gift_transfer_in',
      meta: {
        via: 'web-portal-standalone',
      },
    });
    if (!result.ok) {
      const status = result.reason === 'insufficient-balance' ? 400 : 500;
      return sendJson(res, status, {
        ok: false,
        error: result.reason || 'gift-failed',
        data: result,
      });
    }
    return sendJson(res, 200, {
      ok: true,
      data: result,
    });
  }

  if (pathname === '/player/api/dashboard' && method === 'GET') {
    const dashboard = await getPlayerDashboard(session.discordId);
    if (!dashboard?.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: dashboard?.reason || 'Cannot build player dashboard',
      });
    }

    const [dailyCheck, weeklyCheck, link] = await Promise.all([
      canClaimDaily(session.discordId),
      canClaimWeekly(session.discordId),
      resolveSessionSteamLink(session.discordId),
    ]);

    let rent = {
      linked: false,
      todayQuotaUsed: false,
      nextResetAt: getNextMidnightIsoInTimezone(getRentTimezone()),
      current: null,
    };
    if (link?.steamId) {
      await ensureRentBikeTables();
      const timezone = getRentTimezone();
      const dateKey = getDateKeyInTimezone(timezone);
      const [dailyRent, rentals] = await Promise.all([
        getDailyRent(link.steamId, dateKey),
        listRentalVehicles(250),
      ]);
      const history = rentals
        .filter((row) => normalizeText(row.userKey) === link.steamId)
        .sort((a, b) => {
          const at = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bt = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bt - at;
        });
      rent = {
        linked: true,
        todayQuotaUsed: Boolean(dailyRent?.used),
        nextResetAt: getNextMidnightIsoInTimezone(timezone),
        current: history.find((row) =>
          ['pending', 'delivering', 'delivered'].includes(
            normalizeText(row.status).toLowerCase(),
          ),
        ) || null,
      };
    }

    const serverInfo = config.serverInfo || {};
    const announcements = [
      normalizeText(serverInfo.description),
      ...(Array.isArray(config.raidTimes)
        ? config.raidTimes.map((row) => normalizeText(row)).filter(Boolean)
        : []),
    ].filter(Boolean);

    const latestPurchase = Array.isArray(dashboard.data?.recentPurchases)
      ? dashboard.data.recentPurchases[0] || null
      : null;

    return sendJson(res, 200, {
      ok: true,
      data: {
        ...dashboard.data,
        steamLink: link,
        latestOrder: latestPurchase,
        missionsSummary: {
          dailyClaimable: Boolean(dailyCheck?.ok),
          weeklyClaimable: Boolean(weeklyCheck?.ok),
          dailyRemainingMs: dailyCheck?.ok ? 0 : normalizeAmount(dailyCheck?.remainingMs, 0),
          weeklyRemainingMs: weeklyCheck?.ok
            ? 0
            : normalizeAmount(weeklyCheck?.remainingMs, 0),
        },
        rent,
        announcements,
      },
    });
  }

  if (pathname === '/player/api/shop/list' && method === 'GET') {
    const q = normalizeText(urlObj.searchParams.get('q'));
    const kind = normalizeText(urlObj.searchParams.get('kind') || 'all') || 'all';
    const limit = asInt(urlObj.searchParams.get('limit'), 120, 1, 1000);
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

  if ((pathname === '/player/api/shop/buy' || pathname === '/player/api/buy') && method === 'POST') {
    const body = await readJsonBody(req);
    const query = normalizeText(body.item || body.itemId || body.query);
    if (!query) {
      return sendJson(res, 400, {
        ok: false,
        error: 'missing-item',
      });
    }

    const item = await findShopItemByQuery(query);
    if (!item) {
      return sendJson(res, 404, {
        ok: false,
        error: 'item-not-found',
      });
    }

    const itemKind = normalizeShopKind(item.kind);
    const result = await purchaseShopItemForUser({
      userId: session.discordId,
      item,
      guildId: normalizeText(body.guildId) || null,
      actor: `portal:${session.user}`,
      source: 'player-portal-buy',
      resolveSteamLink: async () => resolveSessionSteamLink(session.discordId),
    });
    if (!result.ok) {
      if (result.reason === 'steam-link-required') {
        return sendJson(res, 400, {
          ok: false,
          error: 'steam-link-required',
          data: {
            message: 'ต้องผูก SteamID ก่อนซื้อสินค้าไอเทมในเกม',
          },
        });
      }
      if (result.reason === 'insufficient-balance') {
        return sendJson(res, 400, {
          ok: false,
          error: 'insufficient-balance',
          data: {
            required: normalizeAmount(item.price, 0),
            balance: normalizeAmount(result.balance, 0),
          },
        });
      }
      return sendJson(res, 500, {
        ok: false,
        error: 'purchase-failed',
        data: {
          message: 'ไม่สามารถสร้างคำสั่งซื้อได้ในตอนนี้ ระบบคืนเหรียญให้อัตโนมัติแล้ว',
        },
      });
    }

    const { purchase, delivery } = result;
    const price = normalizeAmount(item.price, 0);

    return sendJson(res, 200, {
      ok: true,
      data: {
        purchaseCode: purchase.code,
        item: {
          id: item.id,
          name: item.name,
          kind: itemKind,
          price,
          iconUrl: normalizeText(item.iconUrl) || resolveItemIconUrl(item),
          bundle: buildBundleSummary(item),
        },
        delivery: {
          queued: Boolean(delivery?.queued),
          reason: delivery?.reason || null,
          statusText: getDeliveryStatusText(delivery),
        },
      },
    });
  }

  if (pathname === '/player/api/purchase/list' && method === 'GET') {
    const statusFilter = normalizePurchaseStatus(urlObj.searchParams.get('status'));
    const limit = asInt(urlObj.searchParams.get('limit'), 40, 1, 200);
    const includeHistory = urlObj.searchParams.get('includeHistory') === '1';
    const [rows, shopRows] = await Promise.all([
      listUserPurchases(session.discordId),
      listShopItems(),
    ]);
    const shopMap = new Map(
      (Array.isArray(shopRows) ? shopRows : []).map((row) => [String(row.id), row]),
    );

    let items = rows
      .filter((row) => !statusFilter || normalizePurchaseStatus(row?.status) === statusFilter)
      .slice(0, limit)
      .map((row) => {
        const item = shopMap.get(String(row.itemId));
        const status = normalizePurchaseStatus(row.status) || 'unknown';
        return {
          ...row,
          status,
          statusText: status === 'delivered'
            ? 'ส่งของแล้ว'
            : status === 'delivery_failed'
              ? 'ส่งของไม่สำเร็จ'
              : status === 'delivering'
                ? 'กำลังส่งของ'
                : 'รอส่งของ',
          itemName: normalizeText(item?.name) || normalizeText(row.itemId),
          itemKind: normalizeShopKind(item?.kind),
          iconUrl: normalizeText(item?.iconUrl) || resolveItemIconUrl(item || row),
          bundle: buildBundleSummary(item || {}),
        };
      });

    if (includeHistory && items.length > 0) {
      const historyRows = await Promise.all(
        items.map((row) => listPurchaseStatusHistory(row.code, 20)),
      );
      items = items.map((row, index) => ({
        ...row,
        history: historyRows[index] || [],
      }));
    }

    return sendJson(res, 200, {
      ok: true,
      data: {
        userId: session.discordId,
        includeHistory,
        total: items.length,
        items,
      },
    });
  }

  if (pathname === '/player/api/cart' && method === 'GET') {
    const raw = listCartItems(session.discordId);
    const resolved = await getResolvedCart(session.discordId);
    return sendJson(res, 200, {
      ok: true,
      data: {
        raw,
        ...serializeCartResolved(resolved),
      },
    });
  }

  if (pathname === '/player/api/cart/add' && method === 'POST') {
    const body = await readJsonBody(req);
    const query = normalizeText(body.item || body.itemId || body.query);
    const quantity = normalizeQuantity(body.quantity, 1);
    if (!query) {
      return sendJson(res, 400, {
        ok: false,
        error: 'missing-item',
      });
    }

    const item = await findShopItemByQuery(query);
    if (!item) {
      return sendJson(res, 404, {
        ok: false,
        error: 'item-not-found',
      });
    }

    if (isGameItemShopKind(item.kind)) {
      const steamLink = await resolveSessionSteamLink(session.discordId);
      if (!steamLink.linked || !steamLink.steamId) {
        return sendJson(res, 400, {
          ok: false,
          error: 'steam-link-required',
          data: {
            message: 'ต้องผูก SteamID ก่อนใส่สินค้าไอเทมลงตะกร้า',
          },
        });
      }
    }

    addCartItem(session.discordId, item.id, quantity);
    const resolved = await getResolvedCart(session.discordId);
    return sendJson(res, 200, {
      ok: true,
      data: {
        action: 'add',
        itemId: item.id,
        quantity,
        ...serializeCartResolved(resolved),
      },
    });
  }

  if (pathname === '/player/api/cart/remove' && method === 'POST') {
    const body = await readJsonBody(req);
    const query = normalizeText(body.item || body.itemId || body.query);
    const quantity = normalizeQuantity(body.quantity, 1);
    if (!query) {
      return sendJson(res, 400, {
        ok: false,
        error: 'missing-item',
      });
    }

    const item = await findShopItemByQuery(query);
    const itemId = item?.id || query;
    const removed = removeCartItem(session.discordId, itemId, quantity);
    if (!removed) {
      return sendJson(res, 404, {
        ok: false,
        error: 'cart-item-not-found',
      });
    }
    const resolved = await getResolvedCart(session.discordId);
    return sendJson(res, 200, {
      ok: true,
      data: {
        action: 'remove',
        itemId,
        quantity,
        ...serializeCartResolved(resolved),
      },
    });
  }

  if (pathname === '/player/api/cart/clear' && method === 'POST') {
    clearCart(session.discordId);
    return sendJson(res, 200, {
      ok: true,
      data: {
        action: 'clear',
        rows: [],
        missingItemIds: [],
        totalPrice: 0,
        totalUnits: 0,
      },
    });
  }

  if (pathname === '/player/api/cart/checkout' && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const steamLink = await resolveSessionSteamLink(session.discordId);
    const resolvedBeforeCheckout = await getResolvedCart(session.discordId);
    const needsSteam = Array.isArray(resolvedBeforeCheckout?.rows)
      && resolvedBeforeCheckout.rows.some(
        (row) => isGameItemShopKind(row?.item?.kind),
      );
    if (needsSteam && (!steamLink.linked || !steamLink.steamId)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'steam-link-required',
        data: {
          ...serializeCartResolved(resolvedBeforeCheckout),
          message: 'ต้องผูก SteamID ก่อนชำระตะกร้าที่มีสินค้าไอเทมในเกม',
        },
      });
    }

    const result = await checkoutCart(session.discordId, {
      guildId: normalizeText(body.guildId) || null,
      actor: `portal:${session.user}`,
      source: 'player-portal-cart-checkout',
    });
    if (!result.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: result.reason || 'checkout-failed',
        data: {
          ...serializeCartResolved(result),
          walletBalance: normalizeAmount(result.walletBalance, 0),
        },
      });
    }

    return sendJson(res, 200, {
      ok: true,
      data: {
        ...serializeCartResolved(result),
        purchases: Array.isArray(result.purchases)
          ? result.purchases.map((entry) => ({
              purchaseCode: entry.purchase?.code || null,
              itemId: entry.itemId,
              itemName: entry.itemName,
              itemKind: entry.itemKind,
              bundle: entry.bundle || null,
              deliveryStatusText: getDeliveryStatusText(entry.delivery),
              delivery: entry.delivery || null,
            }))
          : [],
        failures: Array.isArray(result.failures) ? result.failures : [],
        refundedAmount: normalizeAmount(result.refundedAmount, 0),
      },
    });
  }

  if (pathname === '/player/api/bounty/list' && method === 'GET') {
    const items = listActiveBountiesForUser();
    return sendJson(res, 200, {
      ok: true,
      data: {
        total: items.length,
        items,
      },
    });
  }

  if (pathname === '/player/api/redeem' && method === 'POST') {
    const body = await readJsonBody(req);
    const code = normalizeText(body.code);
    if (!code) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Invalid request payload',
      });
    }

    const result = await redeemCodeForUser({
      userId: session.discordId,
      code,
      actor: `portal:${session.user}`,
      source: 'player-portal-standalone',
    });

    if (!result.ok) {
      const badRequestReasons = new Set([
        'invalid-input',
        'code-not-found',
        'code-already-used',
        'invalid-redeem-amount',
      ]);
      const status = badRequestReasons.has(result.reason) ? 400 : 500;
      return sendJson(res, status, {
        ok: false,
        error: result.reason || 'redeem-failed',
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

  if (pathname === '/player/api/rentbike/request' && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const result = await requestRentBikeForUser({
      discordUserId: session.discordId,
      guildId: normalizeText(body.guildId) || null,
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

  if (pathname === '/player/api/bounty/add' && method === 'POST') {
    const body = await readJsonBody(req);
    const targetName = normalizeText(body.targetName);
    const amount = Number(body.amount);
    const result = createBountyForUser({
      createdBy: session.discordId,
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

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}

function buildLegacyAdminUrl(pathname, search) {
  try {
    const base = new URL(LEGACY_ADMIN_URL);
    const basePath = base.pathname.replace(/\/+$/, '') || '/admin';
    const suffix = pathname.startsWith('/admin')
      ? pathname.slice('/admin'.length)
      : pathname;
    base.pathname = `${basePath}${suffix || ''}`;
    base.search = search || '';
    return base.toString();
  } catch {
    return null;
  }
}

function buildHealthPayload() {
  return {
    ok: true,
    data: {
      now: new Date().toISOString(),
      nodeEnv: NODE_ENV,
      mode: PORTAL_MODE,
      uptimeSec: Math.round(process.uptime()),
      sessions: sessions.size,
      oauthStates: oauthStates.size,
      secureCookie: SECURE_COOKIE,
      cookieName: SESSION_COOKIE_NAME,
      cookiePath: SESSION_COOKIE_PATH,
      cookieSameSite: SESSION_COOKIE_SAMESITE,
      enforceOriginCheck: ENFORCE_ORIGIN_CHECK,
      discordOAuthConfigured: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
      playerOpenAccess: PLAYER_OPEN_ACCESS,
      requireGuildMember: REQUIRE_GUILD_MEMBER,
      legacyAdminUrl: LEGACY_ADMIN_URL,
      landingUrl: '/landing',
      showcaseUrl: '/showcase',
      trialUrl: '/trial',
    },
  };
}

function isDiscordStartPath(pathname) {
  return pathname === '/auth/discord/start' || pathname === '/admin/auth/discord/start';
}

function isDiscordCallbackPath(pathname) {
  const normalizedPath = DISCORD_REDIRECT_PATH.startsWith('/')
    ? DISCORD_REDIRECT_PATH
    : `/${DISCORD_REDIRECT_PATH}`;
  return (
    pathname === '/auth/discord/callback'
    || pathname === '/admin/auth/discord/callback'
    || pathname === normalizedPath
  );
}

async function requestHandler(req, res) {
  const urlObj = new URL(req.url || '/', BASE_URL);
  const pathname = urlObj.pathname;
  const method = String(req.method || 'GET').toUpperCase();

  if (await tryServeStaticScumIcon(req, res, pathname)) {
    return;
  }

  // Admin routes must jump to the dedicated admin origin before generic
  // player canonicalization, otherwise local smoke checks get redirected
  // back to the player origin and never reach the real admin surface.
  if (pathname.startsWith('/admin')) {
    const target = buildLegacyAdminUrl(pathname, urlObj.search);
    if (!target) {
      return sendJson(res, 503, {
        ok: false,
        error: 'Legacy admin URL is invalid',
      });
    }
    res.writeHead(302, { Location: target });
    return res.end();
  }

  const canonicalRedirectUrl = getCanonicalRedirectUrl(req);
  if (canonicalRedirectUrl && (method === 'GET' || method === 'HEAD')) {
    res.writeHead(302, { Location: canonicalRedirectUrl });
    return res.end();
  }

  if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
    return sendFavicon(res);
  }

  if (pathname === '/healthz' && method === 'GET') {
    return sendJson(res, 200, buildHealthPayload());
  }

  if (method === 'GET' && tryServePublicDoc(pathname, res)) {
    return;
  }

  if (pathname === '/') {
    res.writeHead(302, { Location: '/player' });
    return res.end();
  }

  if (pathname === '/showcase/' && method === 'GET') {
    res.writeHead(302, { Location: '/showcase' });
    return res.end();
  }

  if (pathname === '/landing/' && method === 'GET') {
    res.writeHead(302, { Location: '/landing' });
    return res.end();
  }

  if (pathname === '/landing' && method === 'GET') {
    return sendHtml(res, 200, getLandingHtml());
  }

  if (pathname === '/showcase' && method === 'GET') {
    return sendHtml(res, 200, getShowcaseHtml());
  }

  if (pathname === '/trial/' && method === 'GET') {
    res.writeHead(302, { Location: '/trial' });
    return res.end();
  }

  if (pathname === '/trial' && method === 'GET') {
    return sendHtml(res, 200, getTrialHtml());
  }

  if (pathname === '/api/platform/public/overview' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      data: await getPlatformPublicOverview(),
    });
  }

  if (pathname === '/player/') {
    res.writeHead(302, { Location: '/player' });
    return res.end();
  }

  if (pathname === '/player/login/') {
    res.writeHead(302, { Location: '/player/login' });
    return res.end();
  }

  if (isDiscordStartPath(pathname) && method === 'GET') {
    return handleDiscordStart(req, res);
  }

  if (isDiscordCallbackPath(pathname) && method === 'GET') {
    return handleDiscordCallback(req, res, urlObj);
  }

  if ((pathname === '/login' || pathname === '/player/login') && method === 'GET') {
    const session = getSession(req);
    if (session) {
      res.writeHead(302, { Location: '/player' });
      return res.end();
    }
    return sendHtml(
      res,
      200,
      renderLoginPage(String(urlObj.searchParams.get('error') || '')),
    );
  }

  if (pathname === '/player' && method === 'GET') {
    const session = getSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/player/login' });
      return res.end();
    }
    return sendHtml(res, 200, getPlayerHtml());
  }

  if (pathname.startsWith('/player/api/')) {
    try {
      return await handlePlayerApi(req, res, urlObj);
    } catch (error) {
      if (res.headersSent || res.writableEnded) {
        console.error('[web-portal-standalone] player api error after response:', error?.message || error);
        return;
      }
      const status = Number(error?.statusCode || 500);
      return sendJson(res, status, {
        ok: false,
        error:
          status === 413
            ? 'Payload too large'
            : status >= 500
              ? 'Internal server error'
              : String(error?.message || 'Request failed'),
      });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
}

function buildStartupValidation() {
  const errors = [];
  const warnings = [];

  let base;
  let legacy;

  try {
    base = new URL(BASE_URL);
  } catch {
    errors.push('WEB_PORTAL_BASE_URL is invalid URL');
  }

  try {
    legacy = new URL(LEGACY_ADMIN_URL);
  } catch {
    errors.push('WEB_PORTAL_LEGACY_ADMIN_URL is invalid URL');
  }

  if (!DISCORD_CLIENT_ID) {
    errors.push('WEB_PORTAL_DISCORD_CLIENT_ID is required');
  }

  if (!DISCORD_CLIENT_SECRET) {
    errors.push('WEB_PORTAL_DISCORD_CLIENT_SECRET is required');
  }

  if (!PLAYER_OPEN_ACCESS && REQUIRE_GUILD_MEMBER && !DISCORD_GUILD_ID) {
    errors.push('WEB_PORTAL_REQUIRE_GUILD_MEMBER=true requires WEB_PORTAL_DISCORD_GUILD_ID');
  }

  if (PORTAL_MODE !== 'player') {
    warnings.push(`WEB_PORTAL_MODE=${PORTAL_MODE} is not supported, forcing player mode`);
  }

  if (!PLAYER_OPEN_ACCESS && ALLOWED_DISCORD_IDS.size === 0 && !REQUIRE_GUILD_MEMBER) {
    warnings.push('Access policy is restricted mode but no allowlist/guild guard configured');
  }

  if (PLAYER_OPEN_ACCESS && (ALLOWED_DISCORD_IDS.size > 0 || REQUIRE_GUILD_MEMBER)) {
    warnings.push('WEB_PORTAL_PLAYER_OPEN_ACCESS=true ignores allowlist/guild-member restrictions');
  }

  if (!ENFORCE_ORIGIN_CHECK) {
    warnings.push('WEB_PORTAL_ENFORCE_ORIGIN_CHECK=false increases CSRF risk');
  }

  if (SESSION_COOKIE_SAMESITE === 'Strict') {
    warnings.push('WEB_PORTAL_COOKIE_SAMESITE=Strict may break Discord OAuth redirect flow');
  }

  if (SESSION_COOKIE_SAMESITE === 'None' && !SECURE_COOKIE) {
    warnings.push('WEB_PORTAL_COOKIE_SAMESITE=None without secure cookie may be rejected by browsers');
  }

  if (base && legacy && base.origin === legacy.origin) {
    warnings.push('WEB_PORTAL_BASE_URL and WEB_PORTAL_LEGACY_ADMIN_URL share the same origin; prefer split origin/subdomain for cleaner cookie and routing isolation');
  }

  if (SESSION_TTL_MS > 24 * 60 * 60 * 1000) {
    warnings.push('WEB_PORTAL_SESSION_TTL_HOURS is longer than 24 hours; review whether player sessions should expire sooner');
  }

  if (base && !isLoopbackHost(base.hostname) && base.protocol !== 'https:') {
    warnings.push('WEB_PORTAL_BASE_URL is not HTTPS on non-loopback host');
  }

  if (legacy && !isLoopbackHost(legacy.hostname) && legacy.protocol !== 'https:') {
    warnings.push('WEB_PORTAL_LEGACY_ADMIN_URL is not HTTPS on non-loopback host');
  }

  if (IS_PRODUCTION) {
    if (!SECURE_COOKIE) {
      errors.push('WEB_PORTAL_SECURE_COOKIE must be true in production');
    }

    if (!ENFORCE_ORIGIN_CHECK) {
      errors.push('WEB_PORTAL_ENFORCE_ORIGIN_CHECK must be true in production');
    }

    if (base && base.protocol !== 'https:') {
      errors.push('WEB_PORTAL_BASE_URL must use https in production');
    }
  }

  return { errors, warnings };
}

function printStartupHints() {
  console.log(`[web-portal-standalone] listening at ${BASE_URL}`);
  console.log(`[web-portal-standalone] mode: ${PORTAL_MODE}`);
  console.log(`[web-portal-standalone] legacy admin: ${LEGACY_ADMIN_URL}`);
  console.log(`[web-portal-standalone] landing: ${new URL('/landing', BASE_URL).toString()}`);
  console.log(`[web-portal-standalone] showcase: ${new URL('/showcase', BASE_URL).toString()}`);
  console.log(`[web-portal-standalone] trial: ${new URL('/trial', BASE_URL).toString()}`);
  console.log(
    `[web-portal-standalone] cookie: name=${SESSION_COOKIE_NAME} path=${SESSION_COOKIE_PATH} secure=${SECURE_COOKIE} sameSite=${SESSION_COOKIE_SAMESITE}${SESSION_COOKIE_DOMAIN ? ` domain=${SESSION_COOKIE_DOMAIN}` : ''}`,
  );

  const validation = buildStartupValidation();

  if (validation.warnings.length > 0) {
    console.warn('[web-portal-standalone] startup warnings:');
    for (const warning of validation.warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (validation.errors.length > 0) {
    console.error('[web-portal-standalone] startup errors:');
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return false;
  }

  return true;
}

function startCleanupTimer() {
  const timer = setInterval(() => {
    cleanupRuntimeState();
  }, CLEANUP_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

const startupReady = printStartupHints();
if (!startupReady) {
  process.exit(1);
}

const server = http.createServer((req, res) => {
  void requestHandler(req, res);
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[web-portal-standalone] port ${PORT} is already in use`);
    process.exit(1);
  }
  console.error('[web-portal-standalone] server error:', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  startCleanupTimer();
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
