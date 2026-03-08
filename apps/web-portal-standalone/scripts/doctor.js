'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production' || process.argv.includes('--production');

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
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

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'player') return 'player';
  return 'player';
}

const PORTAL_MODE = normalizeMode(process.env.WEB_PORTAL_MODE || 'player');
const BASE_URL = String(process.env.WEB_PORTAL_BASE_URL || 'http://127.0.0.1:3300').trim();
const LEGACY_ADMIN_URL = String(
  process.env.WEB_PORTAL_LEGACY_ADMIN_URL || 'http://127.0.0.1:3200/admin',
).trim();
const DISCORD_REDIRECT_PATH = String(
  process.env.WEB_PORTAL_DISCORD_REDIRECT_PATH || '/admin/auth/discord/callback',
).trim();

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

const PLAYER_OPEN_ACCESS = envBool('WEB_PORTAL_PLAYER_OPEN_ACCESS', true);
const DISCORD_GUILD_ID = String(
  process.env.WEB_PORTAL_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || '',
).trim();
const REQUIRE_GUILD_MEMBER = PLAYER_OPEN_ACCESS
  ? false
  : envBool('WEB_PORTAL_REQUIRE_GUILD_MEMBER', false);
const ALLOWED_DISCORD_IDS = parseCsvSet(process.env.WEB_PORTAL_ALLOWED_DISCORD_IDS || '');

const SECURE_COOKIE = envBool('WEB_PORTAL_SECURE_COOKIE', IS_PRODUCTION);
const ENFORCE_ORIGIN_CHECK = envBool('WEB_PORTAL_ENFORCE_ORIGIN_CHECK', true);

function validate() {
  const errors = [];
  const warnings = [];

  let base;
  let legacy;

  try {
    base = new URL(BASE_URL);
  } catch {
    errors.push('WEB_PORTAL_BASE_URL ไม่ถูกต้อง (ต้องเป็น URL เต็ม)');
  }

  try {
    legacy = new URL(LEGACY_ADMIN_URL);
  } catch {
    errors.push('WEB_PORTAL_LEGACY_ADMIN_URL ไม่ถูกต้อง (ต้องเป็น URL เต็ม)');
  }

  if (PORTAL_MODE !== 'player') {
    warnings.push(`WEB_PORTAL_MODE=${PORTAL_MODE} ไม่รองรับ ระบบจะบังคับเป็น player`);
  }

  if (!DISCORD_CLIENT_ID) {
    errors.push('ต้องตั้ง WEB_PORTAL_DISCORD_CLIENT_ID');
  }

  if (!DISCORD_CLIENT_SECRET) {
    errors.push('ต้องตั้ง WEB_PORTAL_DISCORD_CLIENT_SECRET');
  }

  if (!DISCORD_REDIRECT_PATH || !DISCORD_REDIRECT_PATH.startsWith('/')) {
    errors.push('WEB_PORTAL_DISCORD_REDIRECT_PATH ต้องขึ้นต้นด้วย "/"');
  }

  if (REQUIRE_GUILD_MEMBER && !DISCORD_GUILD_ID) {
    errors.push('WEB_PORTAL_REQUIRE_GUILD_MEMBER=true แต่ยังไม่ตั้ง WEB_PORTAL_DISCORD_GUILD_ID');
  }

  if (!ENFORCE_ORIGIN_CHECK) {
    warnings.push('WEB_PORTAL_ENFORCE_ORIGIN_CHECK=false เสี่ยง CSRF');
  }

  if (PLAYER_OPEN_ACCESS && (ALLOWED_DISCORD_IDS.size > 0 || REQUIRE_GUILD_MEMBER)) {
    warnings.push('WEB_PORTAL_PLAYER_OPEN_ACCESS=true จะไม่ใช้ allowlist/guild-check');
  }

  if (!PLAYER_OPEN_ACCESS && !REQUIRE_GUILD_MEMBER && ALLOWED_DISCORD_IDS.size === 0) {
    warnings.push('ปิด open-access แล้วแต่ยังไม่ตั้ง allowlist/guild-check');
  }

  if (base && !isLoopbackHost(base.hostname) && base.protocol !== 'https:') {
    warnings.push('WEB_PORTAL_BASE_URL ไม่ใช่ HTTPS บน host ภายนอก');
  }

  if (legacy && !isLoopbackHost(legacy.hostname) && legacy.protocol !== 'https:') {
    warnings.push('WEB_PORTAL_LEGACY_ADMIN_URL ไม่ใช่ HTTPS บน host ภายนอก');
  }

  if (IS_PRODUCTION) {
    if (!SECURE_COOKIE) {
      errors.push('production ต้องตั้ง WEB_PORTAL_SECURE_COOKIE=true');
    }

    if (!ENFORCE_ORIGIN_CHECK) {
      errors.push('production ต้องตั้ง WEB_PORTAL_ENFORCE_ORIGIN_CHECK=true');
    }

    if (base && base.protocol !== 'https:') {
      errors.push('production ต้องใช้ WEB_PORTAL_BASE_URL เป็น https');
    }
  }

  return { errors, warnings };
}

function printReport(report) {
  console.log('[web-portal doctor] mode:', IS_PRODUCTION ? 'production-check' : `env:${NODE_ENV}`);
  console.log('[web-portal doctor] portal mode:', PORTAL_MODE);
  console.log('[web-portal doctor] base:', BASE_URL);
  console.log('[web-portal doctor] legacy admin:', LEGACY_ADMIN_URL);
  console.log('[web-portal doctor] player open access:', PLAYER_OPEN_ACCESS);

  if (report.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (report.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of report.errors) {
      console.log(`- ${error}`);
    }
  }

  if (report.errors.length === 0) {
    console.log('\nWEB_PORTAL_DOCTOR: PASS');
  } else {
    console.log('\nWEB_PORTAL_DOCTOR: FAIL');
  }
}

const report = validate();
printReport(report);
process.exit(report.errors.length === 0 ? 0 : 1);
