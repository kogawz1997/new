'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadMergedEnvFiles } = require('../src/utils/loadEnvFiles');
const { validateCommandTemplate } = require('../src/utils/commandTemplate');

const ROOT_DIR = process.cwd();
const ROOT_ENV_PATH = path.join(ROOT_DIR, '.env');
const PORTAL_ENV_PATH = path.join(
  ROOT_DIR,
  'apps',
  'web-portal-standalone',
  '.env',
);

loadMergedEnvFiles({
  basePath: ROOT_ENV_PATH,
  overlayPath: fs.existsSync(PORTAL_ENV_PATH) ? PORTAL_ENV_PATH : null,
});

const checks = [];
const warnings = [];
const isProduction =
  String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

function runCheck(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
  }
}

function isTruthy(value, fallback = false) {
  if (value == null || String(value).trim() === '') return fallback;
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function isLoopbackHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseUrlOrThrow(value, label) {
  try {
    return new URL(String(value || '').trim());
  } catch {
    throw new Error(`${label} must be a full URL`);
  }
}

function readPort(value, fallback = 0) {
  const raw = String(value == null || value === '' ? fallback : value).trim();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid port value: ${raw}`);
  }
  return Math.max(0, Math.trunc(parsed));
}

function pushPort(portMap, port, label) {
  if (!port) return;
  if (!portMap.has(port)) {
    portMap.set(port, [label]);
    return;
  }
  portMap.get(port).push(label);
}

function addPortConflictChecks() {
  const portMap = new Map();
  pushPort(
    portMap,
    readPort(process.env.ADMIN_WEB_PORT, 3200),
    'admin-web',
  );
  pushPort(
    portMap,
    readPort(process.env.SCUM_WEBHOOK_PORT, 3100),
    'scum-webhook',
  );
  pushPort(
    portMap,
    readPort(process.env.WEB_PORTAL_PORT, 3300),
    'player-web',
  );
  pushPort(
    portMap,
    readPort(process.env.BOT_HEALTH_PORT, 0),
    'bot-health',
  );
  pushPort(
    portMap,
    readPort(process.env.WORKER_HEALTH_PORT, 0),
    'worker-health',
  );
  pushPort(
    portMap,
    readPort(process.env.SCUM_WATCHER_HEALTH_PORT, 0),
    'watcher-health',
  );
  pushPort(
    portMap,
    readPort(process.env.SCUM_CONSOLE_AGENT_PORT, 0),
    'scum-console-agent',
  );

  for (const [port, labels] of portMap.entries()) {
    if (labels.length > 1) {
      throw new Error(`Port ${port} is reused by: ${labels.join(', ')}`);
    }
  }
}

function addAdminReverseProxyChecks() {
  const isProduction =
    String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const adminHost = String(process.env.ADMIN_WEB_HOST || '127.0.0.1').trim();
  const secureCookie = isTruthy(process.env.ADMIN_WEB_SECURE_COOKIE, false);
  const trustProxy = isTruthy(process.env.ADMIN_WEB_TRUST_PROXY, false);
  const hstsEnabled = isTruthy(process.env.ADMIN_WEB_HSTS_ENABLED, false);
  const enforceOrigin = isTruthy(
    process.env.ADMIN_WEB_ENFORCE_ORIGIN_CHECK,
    true,
  );
  const origins = parseCsvList(process.env.ADMIN_WEB_ALLOWED_ORIGINS);

  if (enforceOrigin && origins.length === 0) {
    throw new Error(
      'ADMIN_WEB_ALLOWED_ORIGINS must be set when ADMIN_WEB_ENFORCE_ORIGIN_CHECK=true',
    );
  }

  for (const origin of origins) {
    const parsed = parseUrlOrThrow(origin, `ADMIN_WEB_ALLOWED_ORIGINS entry (${origin})`);
    if (isProduction && parsed.protocol !== 'https:') {
      throw new Error(`ADMIN origin must use https in production: ${origin}`);
    }
  }

  const hasExternalOrigin = origins.some((origin) => {
    const parsed = new URL(origin);
    return !isLoopbackHost(parsed.hostname);
  });

  if (hasExternalOrigin && !secureCookie) {
    throw new Error(
      'ADMIN_WEB_SECURE_COOKIE=true is required when admin is exposed via external origin',
    );
  }

  if (hasExternalOrigin && !trustProxy) {
    throw new Error(
      'ADMIN_WEB_TRUST_PROXY=true is required when admin is behind reverse proxy',
    );
  }

  if (hasExternalOrigin && !hstsEnabled) {
    throw new Error(
      'ADMIN_WEB_HSTS_ENABLED=true is required when admin is exposed via external origin',
    );
  }

  if (!isLoopbackHost(adminHost) && hasExternalOrigin) {
    warnings.push(
      'ADMIN_WEB_HOST is public while reverse proxy origins are configured; prefer loopback bind behind proxy',
    );
  }
}

function addPortalReverseProxyChecks() {
  const isProduction =
    String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const baseUrl = parseUrlOrThrow(
    process.env.WEB_PORTAL_BASE_URL || 'http://127.0.0.1:3300',
    'WEB_PORTAL_BASE_URL',
  );
  const legacyAdminUrl = parseUrlOrThrow(
    process.env.WEB_PORTAL_LEGACY_ADMIN_URL || 'http://127.0.0.1:3200/admin',
    'WEB_PORTAL_LEGACY_ADMIN_URL',
  );
  const secureCookie = isTruthy(process.env.WEB_PORTAL_SECURE_COOKIE, isProduction);
  const originCheck = isTruthy(process.env.WEB_PORTAL_ENFORCE_ORIGIN_CHECK, true);
  const adminOrigins = parseCsvList(process.env.ADMIN_WEB_ALLOWED_ORIGINS);

  if (isProduction && baseUrl.protocol !== 'https:') {
    throw new Error('WEB_PORTAL_BASE_URL must use https in production');
  }

  if (isProduction && legacyAdminUrl.protocol !== 'https:') {
    throw new Error('WEB_PORTAL_LEGACY_ADMIN_URL must use https in production');
  }

  if (!secureCookie && !isLoopbackHost(baseUrl.hostname)) {
    throw new Error(
      'WEB_PORTAL_SECURE_COOKIE=true is required when player portal is exposed externally',
    );
  }

  if (!originCheck) {
    throw new Error('WEB_PORTAL_ENFORCE_ORIGIN_CHECK=true is required');
  }

  const adminOrigin = legacyAdminUrl.origin;
  const adminCookiePath = String(
    process.env.ADMIN_WEB_SESSION_COOKIE_PATH || '/admin',
  ).trim() || '/admin';
  if (
    adminOrigins.length > 0
    && !adminOrigins.includes(adminOrigin)
  ) {
    throw new Error(
      `WEB_PORTAL_LEGACY_ADMIN_URL origin (${adminOrigin}) is not listed in ADMIN_WEB_ALLOWED_ORIGINS`,
    );
  }

  if (baseUrl.origin === adminOrigin) {
    warnings.push(
      'Player portal and admin portal share the same origin; verify path routing and cookie scope carefully',
    );
    if (adminCookiePath === '/' || !adminCookiePath.startsWith('/admin')) {
      warnings.push(
        'When admin/player share the same origin, set ADMIN_WEB_SESSION_COOKIE_PATH=/admin for tighter cookie isolation',
      );
    }
  }
}

function addAuthHardeningChecks() {
  const adminOrigins = parseCsvList(process.env.ADMIN_WEB_ALLOWED_ORIGINS);
  const hasExternalAdminOrigin = adminOrigins.some((origin) => {
    try {
      return !isLoopbackHost(new URL(origin).hostname);
    } catch {
      return false;
    }
  });
  const adminTwoFactorEnabled = isTruthy(process.env.ADMIN_WEB_2FA_ENABLED, false);
  const adminTwoFactorSecret = String(process.env.ADMIN_WEB_2FA_SECRET || '').trim();
  const adminSessionTtlHours = Number(process.env.ADMIN_WEB_SESSION_TTL_HOURS || 12);
  const portalSessionTtlHours = Number(process.env.WEB_PORTAL_SESSION_TTL_HOURS || 12);

  if (hasExternalAdminOrigin && (!adminTwoFactorEnabled || !adminTwoFactorSecret)) {
    warnings.push(
      'Admin web is exposed externally without active 2FA; enable ADMIN_WEB_2FA_ENABLED=true and set ADMIN_WEB_2FA_SECRET',
    );
  }

  if (Number.isFinite(adminSessionTtlHours) && adminSessionTtlHours > 24) {
    warnings.push(
      `ADMIN_WEB_SESSION_TTL_HOURS=${adminSessionTtlHours} is longer than 24 hours; review admin session lifetime`,
    );
  }

  if (Number.isFinite(portalSessionTtlHours) && portalSessionTtlHours > 24) {
    warnings.push(
      `WEB_PORTAL_SESSION_TTL_HOURS=${portalSessionTtlHours} is longer than 24 hours; review player session lifetime`,
    );
  }
}

function parseRequiredUrl(value, label) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return parseUrlOrThrow(text, label);
}

function normalizePathname(value, fallback) {
  const text = String(value || '').trim() || fallback;
  return text.startsWith('/') ? text : `/${text}`;
}

function addDiscordRedirectChecks() {
  const portalBaseUrl = parseRequiredUrl(
    process.env.WEB_PORTAL_BASE_URL || 'http://127.0.0.1:3300',
    'WEB_PORTAL_BASE_URL',
  );
  const portalRedirectPath = normalizePathname(
    process.env.WEB_PORTAL_DISCORD_REDIRECT_PATH,
    '/auth/discord/callback',
  );
  const portalRedirectUrl = new URL(portalRedirectPath, portalBaseUrl);
  const portalClientId = String(
    process.env.WEB_PORTAL_DISCORD_CLIENT_ID
      || process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_ID
      || process.env.DISCORD_CLIENT_ID
      || '',
  ).trim();
  const portalClientSecret = String(
    process.env.WEB_PORTAL_DISCORD_CLIENT_SECRET
      || process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET
      || '',
  ).trim();

  if (!portalClientId) {
    throw new Error('WEB_PORTAL_DISCORD_CLIENT_ID (or fallback client id) is required');
  }
  if (!portalClientSecret) {
    throw new Error('WEB_PORTAL_DISCORD_CLIENT_SECRET (or fallback secret) is required');
  }
  if (
    portalRedirectUrl.pathname !== '/admin/auth/discord/callback'
    && portalRedirectUrl.pathname !== '/auth/discord/callback'
  ) {
    warnings.push(
      `Player portal redirect path is custom (${portalRedirectUrl.pathname}); verify the same URI is registered in Discord Developer Portal`,
    );
  }
  if (isProduction && portalRedirectUrl.protocol !== 'https:') {
    throw new Error('Player portal Discord redirect must use https in production');
  }

  const adminSsoEnabled = isTruthy(process.env.ADMIN_WEB_SSO_DISCORD_ENABLED, false);
  if (!adminSsoEnabled) return;

  const adminClientId = String(process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_ID || '').trim();
  const adminClientSecret = String(
    process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET || '',
  ).trim();
  if (!adminClientId) {
    throw new Error('ADMIN_WEB_SSO_DISCORD_CLIENT_ID is required when ADMIN_WEB_SSO_DISCORD_ENABLED=true');
  }
  if (!adminClientSecret) {
    throw new Error('ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET is required when ADMIN_WEB_SSO_DISCORD_ENABLED=true');
  }

  const adminOrigins = parseCsvList(process.env.ADMIN_WEB_ALLOWED_ORIGINS);
  const hasExternalAdminOrigin = adminOrigins.some((origin) => {
    const parsed = new URL(origin);
    return !isLoopbackHost(parsed.hostname);
  });
  const configuredRedirect = String(process.env.ADMIN_WEB_SSO_DISCORD_REDIRECT_URI || '').trim();
  if (!configuredRedirect && (isProduction || hasExternalAdminOrigin)) {
    throw new Error(
      'ADMIN_WEB_SSO_DISCORD_REDIRECT_URI is required when admin Discord SSO is used behind reverse proxy or in production',
    );
  }

  const adminRedirectUrl = configuredRedirect
    ? parseUrlOrThrow(configuredRedirect, 'ADMIN_WEB_SSO_DISCORD_REDIRECT_URI')
    : new URL(
        `/admin/auth/discord/callback`,
        `http://${String(process.env.ADMIN_WEB_HOST || '127.0.0.1').trim()}:${readPort(
          process.env.ADMIN_WEB_PORT,
          3200,
        )}`,
      );

  if (adminRedirectUrl.pathname !== '/admin/auth/discord/callback') {
    throw new Error(
      `ADMIN_WEB_SSO_DISCORD_REDIRECT_URI must end with /admin/auth/discord/callback (current=${adminRedirectUrl.pathname})`,
    );
  }
  if (isProduction && adminRedirectUrl.protocol !== 'https:') {
    throw new Error('Admin Discord SSO redirect must use https in production');
  }
  if (adminOrigins.length > 0 && !adminOrigins.includes(adminRedirectUrl.origin)) {
    throw new Error(
      `ADMIN_WEB_SSO_DISCORD_REDIRECT_URI origin (${adminRedirectUrl.origin}) is not listed in ADMIN_WEB_ALLOWED_ORIGINS`,
    );
  }
  if (
    adminClientId === portalClientId
    && adminRedirectUrl.toString() === portalRedirectUrl.toString()
  ) {
    warnings.push(
      'Admin SSO and player portal reuse the exact same Discord redirect URI; verify this is intentional',
    );
  }
}

function addRconChecks() {
  const deliveryMode = String(
    process.env.DELIVERY_EXECUTION_MODE || 'rcon',
  ).trim().toLowerCase() || 'rcon';
  const needsRcon =
    isTruthy(process.env.BOT_ENABLE_RENTBIKE_SERVICE, true)
    || isTruthy(process.env.BOT_ENABLE_DELIVERY_WORKER, true)
    || isTruthy(process.env.WORKER_ENABLE_RENTBIKE, true)
    || isTruthy(process.env.WORKER_ENABLE_DELIVERY, true);

  if (!needsRcon) return;

  if (deliveryMode === 'agent') {
    const token = String(process.env.SCUM_CONSOLE_AGENT_TOKEN || '').trim();
    const baseUrl = String(process.env.SCUM_CONSOLE_AGENT_BASE_URL || '').trim();
    const host = String(process.env.SCUM_CONSOLE_AGENT_HOST || '127.0.0.1').trim();
    const port = readPort(process.env.SCUM_CONSOLE_AGENT_PORT, 3213);
    const backend = String(
      process.env.SCUM_CONSOLE_AGENT_BACKEND || 'exec',
    ).trim().toLowerCase() || 'exec';

    if (!token || token.length < 16) {
      throw new Error(
        'SCUM_CONSOLE_AGENT_TOKEN is required and should be at least 16 chars when DELIVERY_EXECUTION_MODE=agent',
      );
    }
    if (baseUrl) {
      const parsed = parseUrlOrThrow(baseUrl, 'SCUM_CONSOLE_AGENT_BASE_URL');
      if (isProduction && parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
        throw new Error('SCUM_CONSOLE_AGENT_BASE_URL must use https in production when not loopback');
      }
    } else {
      if (!host) {
        throw new Error('SCUM_CONSOLE_AGENT_HOST is required when DELIVERY_EXECUTION_MODE=agent');
      }
      if (!port) {
        throw new Error('SCUM_CONSOLE_AGENT_PORT is required when DELIVERY_EXECUTION_MODE=agent');
      }
    }
    if (backend === 'exec') {
      const template = String(process.env.SCUM_CONSOLE_AGENT_EXEC_TEMPLATE || '').trim();
      if (!template || !template.includes('{command}')) {
        throw new Error(
          'SCUM_CONSOLE_AGENT_EXEC_TEMPLATE must include {command} when SCUM_CONSOLE_AGENT_BACKEND=exec',
        );
      }
      validateCommandTemplate(template);
    }
    if (backend === 'process' && isTruthy(process.env.SCUM_CONSOLE_AGENT_AUTOSTART, false)) {
      const serverExe = String(process.env.SCUM_CONSOLE_AGENT_SERVER_EXE || '').trim();
      if (!serverExe) {
        throw new Error(
          'SCUM_CONSOLE_AGENT_SERVER_EXE is required when backend=process and autostart is enabled',
        );
      }
    }
    return;
  }

  const template = String(process.env.RCON_EXEC_TEMPLATE || '').trim();
  if (!template) {
    throw new Error('RCON_EXEC_TEMPLATE is required when delivery/rent services are enabled');
  }
  if (!template.includes('{command}')) {
    throw new Error('RCON_EXEC_TEMPLATE must include {command}');
  }
  validateCommandTemplate(template);

  const host = String(process.env.RCON_HOST || '').trim();
  const port = String(process.env.RCON_PORT || '').trim();
  const password = String(process.env.RCON_PASSWORD || '').trim();

  if (template.includes('{host}') && !host) {
    throw new Error('RCON_HOST is required by RCON_EXEC_TEMPLATE');
  }
  if (template.includes('{port}')) {
    const parsedPort = Number(port);
    if (!port || !Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error(`RCON_PORT must be a valid TCP port when used by RCON_EXEC_TEMPLATE (current=${port || 'empty'})`);
    }
  }
  if (template.includes('{password}') && !password) {
    throw new Error('RCON_PASSWORD is required by RCON_EXEC_TEMPLATE');
  }
}

runCheck('load dotenv', () => {
  require('dotenv');
});

runCheck('load @prisma/client', () => {
  require('@prisma/client');
});

runCheck('load discord.js', () => {
  require('discord.js');
});

runCheck('root .env exists', () => {
  if (!fs.existsSync(ROOT_ENV_PATH)) {
    throw new Error(`Missing ${ROOT_ENV_PATH}`);
  }
});

runCheck('portal .env exists', () => {
  if (!fs.existsSync(PORTAL_ENV_PATH)) {
    throw new Error(`Missing ${PORTAL_ENV_PATH}`);
  }
});

runCheck('DATABASE_URL format (file:...)', () => {
  const value = (process.env.DATABASE_URL || 'file:./prisma/dev.db').trim();
  if (!value.startsWith('file:')) {
    throw new Error(`Expected file:... DATABASE_URL, got ${value}`);
  }
});

runCheck('prisma schema exists', () => {
  const schemaPath = path.resolve(process.cwd(), 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Missing ${schemaPath}`);
  }
});

runCheck('admin reverse proxy / origins config', () => {
  addAdminReverseProxyChecks();
});

runCheck('player portal reverse proxy / origins config', () => {
  addPortalReverseProxyChecks();
});

runCheck('Discord OAuth redirect consistency', () => {
  addDiscordRedirectChecks();
});

runCheck('auth/session hardening posture', () => {
  addAuthHardeningChecks();
});

runCheck('RCON runtime consistency', () => {
  addRconChecks();
});

runCheck('port matrix has no conflicts', () => {
  addPortConflictChecks();
});

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  if (c.ok) {
    console.log(`OK: ${c.name}`);
  } else {
    console.error(`ERROR: ${c.name} -> ${c.error}`);
  }
}

for (const warning of warnings) {
  console.warn(`WARN: ${warning}`);
}

if (failed.length) {
  process.exit(1);
}
