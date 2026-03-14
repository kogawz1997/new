'use strict';

const path = require('node:path');
const { loadMergedEnvFiles } = require('../src/utils/loadEnvFiles');

const DEFAULT_TIMEOUT_MS = 10000;

loadMergedEnvFiles({
  basePath: path.resolve(process.cwd(), '.env'),
  overlayPath: path.resolve(process.cwd(), 'apps/web-portal-standalone/.env'),
  ignoreEmptyOverlay: true,
  overrideExisting: false,
});

function isLikelyPlaceholder(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  const patterns = [
    'your_',
    'example',
    'changeme',
    'replace',
    'rotate_in_',
    'rotate_me',
    'token_here',
    'password_here',
    'put_a_',
    'placeholder',
    'xxx',
  ];
  return patterns.some((pattern) => text.includes(pattern));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, directValue] = token.split('=');
    const normalizedKey = key.slice(2);
    if (directValue != null) {
      out[normalizedKey] = directValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[normalizedKey] = next;
      i += 1;
    } else {
      out[normalizedKey] = 'true';
    }
  }
  return out;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function asInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function buildUrl(base, pathname) {
  const normalizedBase = trimTrailingSlash(base);
  const normalizedPath = String(pathname || '').startsWith('/')
    ? String(pathname)
    : `/${String(pathname || '')}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
        'User-Agent': 'scum-post-deploy-smoke/1.0',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function assertStatus(res, expected, label) {
  if (!expected.includes(res.status)) {
    throw new Error(`${label} expected status ${expected.join('/')} but got ${res.status}`);
  }
}

async function assertJsonOk(url, timeoutMs, label) {
  const res = await fetchWithTimeout(url, timeoutMs);
  assertStatus(res, [200], label);
  const json = await res.json().catch(() => null);
  if (!json || json.ok !== true) {
    throw new Error(`${label} expected JSON { ok: true }`);
  }
}

function parseLocation(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isCanonicalPortalRedirect(res, expectedBase, expectedPath) {
  if (!isRedirectStatus(res.status)) return false;
  const location = parseLocation(res.headers.get('location'));
  if (!location) return false;
  const expected = new URL(expectedPath, trimTrailingSlash(expectedBase));
  return location.origin === expected.origin && location.pathname === expected.pathname;
}

async function assertJsonOkOrCanonicalRedirect(url, timeoutMs, label, expectedBase, expectedPath) {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (res.status === 200) {
    const json = await res.json().catch(() => null);
    if (!json || json.ok !== true) {
      throw new Error(`${label} expected JSON { ok: true }`);
    }
    return { mode: 'json', res };
  }
  if (isCanonicalPortalRedirect(res, expectedBase, expectedPath)) {
    return { mode: 'canonical-redirect', res };
  }
  throw new Error(`${label} expected status 200 or canonical redirect but got ${res.status}`);
}

async function assertStatusOrCanonicalRedirect(
  url,
  timeoutMs,
  label,
  expectedStatuses,
  expectedBase,
  expectedPath,
) {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (expectedStatuses.includes(res.status)) {
    return { mode: 'direct', res };
  }
  if (isCanonicalPortalRedirect(res, expectedBase, expectedPath)) {
    return { mode: 'canonical-redirect', res };
  }
  throw new Error(`${label} expected status ${expectedStatuses.join('/')} or canonical redirect but got ${res.status}`);
}

function printCheckOk(label, detail) {
  console.log(`[smoke] OK: ${label}${detail ? ` (${detail})` : ''}`);
}

function printCheckSkip(label, detail) {
  console.log(`[smoke] SKIP: ${label}${detail ? ` (${detail})` : ''}`);
}

function buildOptionalHealthUrl({
  directUrl,
  host,
  port,
}) {
  if (directUrl) {
    return trimTrailingSlash(String(directUrl));
  }
  const parsedPort = Number(port);
  if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
    return null;
  }
  const safeHost = String(host || '127.0.0.1').trim() || '127.0.0.1';
  return `http://${safeHost}:${Math.trunc(parsedPort)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log('Usage: node scripts/post-deploy-smoke.js [--admin-base URL] [--player-base URL] [--timeout-ms N] [--bot-health-url URL] [--worker-health-url URL] [--watcher-health-url URL]');
    process.exit(0);
  }

  const localAdminBase = `http://${(process.env.ADMIN_WEB_HOST || '127.0.0.1') === '0.0.0.0' ? '127.0.0.1' : (process.env.ADMIN_WEB_HOST || '127.0.0.1')}:${process.env.ADMIN_WEB_PORT || '3200'}/admin`;
  const adminBaseInput =
    args['admin-base']
    || process.env.SMOKE_ADMIN_BASE_URL
    || localAdminBase;
  const playerBaseInput =
    args['player-base']
    || process.env.SMOKE_PLAYER_BASE_URL
    || `http://${(process.env.WEB_PORTAL_HOST || '127.0.0.1') === '0.0.0.0' ? '127.0.0.1' : (process.env.WEB_PORTAL_HOST || '127.0.0.1')}:${process.env.WEB_PORTAL_PORT || '3300'}`;
  const timeoutMs = asInt(args['timeout-ms'] || process.env.SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 2000, 60000);
  const botHealthBase = buildOptionalHealthUrl({
    directUrl: args['bot-health-url'] || process.env.SMOKE_BOT_HEALTH_URL,
    host: process.env.BOT_HEALTH_HOST || '127.0.0.1',
    port: process.env.BOT_HEALTH_PORT || 0,
  });
  const workerHealthBase = buildOptionalHealthUrl({
    directUrl: args['worker-health-url'] || process.env.SMOKE_WORKER_HEALTH_URL,
    host: process.env.WORKER_HEALTH_HOST || '127.0.0.1',
    port: process.env.WORKER_HEALTH_PORT || 0,
  });
  const watcherHealthBase = buildOptionalHealthUrl({
    directUrl: args['watcher-health-url'] || process.env.SMOKE_WATCHER_HEALTH_URL,
    host: process.env.SCUM_WATCHER_HEALTH_HOST || '127.0.0.1',
    port: process.env.SCUM_WATCHER_HEALTH_PORT || 0,
  });

  const adminParsed = new URL(adminBaseInput);
  const playerParsed = new URL(playerBaseInput);

  const adminOrigin = `${adminParsed.protocol}//${adminParsed.host}`;
  const adminPath = trimTrailingSlash(adminParsed.pathname) || '/admin';
  const adminBase = `${adminOrigin}${adminPath}`;
  const playerBase = trimTrailingSlash(playerParsed.toString());
  const expectedPlayerCanonicalBase = trimTrailingSlash(
    process.env.WEB_PORTAL_BASE_URL || playerBase,
  );
  const expectedLegacyAdmin = trimTrailingSlash(process.env.WEB_PORTAL_LEGACY_ADMIN_URL || adminBase);
  const playerDiscordClientId = String(
    process.env.WEB_PORTAL_DISCORD_CLIENT_ID
      || process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_ID
      || process.env.DISCORD_CLIENT_ID
      || '',
  ).trim();
  const playerDiscordClientSecret = String(
    process.env.WEB_PORTAL_DISCORD_CLIENT_SECRET
      || process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET
      || '',
  ).trim();
  const adminSsoEnabled = String(process.env.ADMIN_WEB_SSO_DISCORD_ENABLED || '')
    .trim()
    .toLowerCase();
  const adminDiscordClientId = String(process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_ID || '').trim();
  const adminDiscordClientSecret = String(
    process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET || '',
  ).trim();

  console.log('[smoke] admin base :', adminBase);
  console.log('[smoke] player base:', playerBase);
  console.log('[smoke] timeout ms :', timeoutMs);
  if (botHealthBase) console.log('[smoke] bot health  :', botHealthBase);
  if (workerHealthBase) console.log('[smoke] worker health:', workerHealthBase);
  if (watcherHealthBase) console.log('[smoke] watcher health:', watcherHealthBase);

  await assertJsonOk(buildUrl(adminOrigin, '/healthz'), timeoutMs, 'admin healthz');
  printCheckOk('admin healthz');

  const adminLoginRes = await fetchWithTimeout(buildUrl(adminBase, '/login'), timeoutMs);
  assertStatus(adminLoginRes, [200], 'admin login page');
  printCheckOk('admin login page');

  const playerHealthz = await assertJsonOkOrCanonicalRedirect(
    buildUrl(playerBase, '/healthz'),
    timeoutMs,
    'player healthz',
    expectedPlayerCanonicalBase,
    '/healthz',
  );
  printCheckOk(
    'player healthz',
    playerHealthz.mode === 'canonical-redirect'
      ? `canonical redirect -> ${String(playerHealthz.res.headers.get('location') || '')}`
      : '',
  );

  const playerLogin = await assertStatusOrCanonicalRedirect(
    buildUrl(playerBase, '/player/login'),
    timeoutMs,
    'player login page',
    [200],
    expectedPlayerCanonicalBase,
    '/player/login',
  );
  printCheckOk(
    'player login page',
    playerLogin.mode === 'canonical-redirect'
      ? `canonical redirect -> ${String(playerLogin.res.headers.get('location') || '')}`
      : '',
  );

  const playerRootRes = await fetchWithTimeout(buildUrl(playerBase, '/'), timeoutMs);
  assertStatus(playerRootRes, [301, 302, 307, 308], 'player root redirect');
  const rootLocation = String(playerRootRes.headers.get('location') || '');
  const rootRedirectUrl = parseLocation(rootLocation);
  const canonicalRoot = trimTrailingSlash(expectedPlayerCanonicalBase);
  const canonicalRootWithSlash = `${canonicalRoot}/`;
  if (
    !rootLocation.includes('/player')
    && rootLocation !== canonicalRoot
    && rootLocation !== canonicalRootWithSlash
    && (!rootRedirectUrl || rootRedirectUrl.origin !== new URL(expectedPlayerCanonicalBase).origin)
  ) {
    throw new Error(`player root redirect expected /player but got ${rootLocation || '(empty)'}`);
  }
  printCheckOk('player root redirect', rootLocation);

  const legacyRedirectRes = await fetchWithTimeout(buildUrl(playerBase, '/admin'), timeoutMs);
  assertStatus(legacyRedirectRes, [301, 302, 307, 308], 'legacy admin redirect');
  const legacyLocation = trimTrailingSlash(String(legacyRedirectRes.headers.get('location') || ''));
  if (!legacyLocation.toLowerCase().startsWith(expectedLegacyAdmin.toLowerCase())) {
    throw new Error(
      `legacy admin redirect expected prefix ${expectedLegacyAdmin} but got ${legacyLocation || '(empty)'}`,
    );
  }
  printCheckOk('legacy admin redirect', legacyLocation);

  const meRes = await assertStatusOrCanonicalRedirect(
    buildUrl(playerBase, '/player/api/me'),
    timeoutMs,
    'player api me (unauthenticated)',
    [401],
    expectedPlayerCanonicalBase,
    '/player/api/me',
  );
  printCheckOk(
    'player api auth gate',
    meRes.mode === 'canonical-redirect'
      ? `canonical redirect -> ${String(meRes.res.headers.get('location') || '')}`
      : '',
  );

  if (
    playerDiscordClientId
    && !isLikelyPlaceholder(playerDiscordClientId)
    && playerDiscordClientSecret
    && !isLikelyPlaceholder(playerDiscordClientSecret)
  ) {
    const playerOauthStartRes = await fetchWithTimeout(
      buildUrl(playerBase, '/auth/discord/start'),
      timeoutMs,
    );
    assertStatus(playerOauthStartRes, [301, 302, 307, 308], 'player oauth start');
    const location = String(playerOauthStartRes.headers.get('location') || '');
    if (
      !location.startsWith('https://discord.com/')
      && !location.startsWith(`${expectedPlayerCanonicalBase}/auth/discord/start`)
    ) {
      throw new Error(`player oauth start expected redirect to Discord but got ${location || '(empty)'}`);
    }
    printCheckOk('player oauth start', location);
  } else {
    printCheckSkip('player oauth start', 'Discord OAuth secret/client id not configured');
  }

  if (
    adminSsoEnabled === 'true'
    && adminDiscordClientId
    && !isLikelyPlaceholder(adminDiscordClientId)
    && adminDiscordClientSecret
    && !isLikelyPlaceholder(adminDiscordClientSecret)
  ) {
    const adminOauthStartRes = await fetchWithTimeout(
      buildUrl(adminBase, '/auth/discord/start'),
      timeoutMs,
    );
    assertStatus(adminOauthStartRes, [301, 302, 307, 308], 'admin oauth start');
    const location = String(adminOauthStartRes.headers.get('location') || '');
    if (!location.startsWith('https://discord.com/')) {
      throw new Error(`admin oauth start expected redirect to Discord but got ${location || '(empty)'}`);
    }
    printCheckOk('admin oauth start', location);
  } else {
    printCheckSkip('admin oauth start', 'Admin Discord SSO is disabled or incomplete');
  }

  if (botHealthBase) {
    await assertJsonOk(buildUrl(botHealthBase, '/healthz'), timeoutMs, 'bot healthz');
    printCheckOk('bot healthz');
  }
  if (workerHealthBase) {
    await assertJsonOk(buildUrl(workerHealthBase, '/healthz'), timeoutMs, 'worker healthz');
    printCheckOk('worker healthz');
  }
  if (watcherHealthBase) {
    await assertJsonOk(buildUrl(watcherHealthBase, '/healthz'), timeoutMs, 'watcher healthz');
    printCheckOk('watcher healthz');
  }

  console.log('[smoke] PASS');
}

main().catch((error) => {
  const cause = error && typeof error === 'object' && error.cause
    ? ` | cause: ${error.cause.message || String(error.cause)}`
    : '';
  console.error('[smoke] FAIL:', `${error.message || error}${cause}`);
  process.exit(1);
});
