'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadMergedEnvFiles } = require('../src/utils/loadEnvFiles');
const { prisma } = require('../src/prisma');

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
  ignoreEmptyOverlay: true,
  overrideExisting: false,
});

const isWindows = process.platform === 'win32';
const args = new Set(process.argv.slice(2));
const DEFAULT_TIMEOUT_MS = 8000;

function printHelpAndExit() {
  console.log('Usage: node scripts/preflight-prod.js [--skip-readiness] [--with-delivery-test]');
  console.log('');
  console.log('Runs production preflight checks: readiness baseline, DB ping, runtime health,');
  console.log('admin delivery runtime, agent preflight, and optional live delivery test-send.');
  process.exit(0);
}

if (args.has('--help') || args.has('-h')) {
  printHelpAndExit();
}

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeLoopbackHost(host) {
  const text = String(host || '').trim() || '127.0.0.1';
  if (text === '0.0.0.0' || text === '::') return '127.0.0.1';
  return text;
}

function buildHttpBaseUrl(host, port, fallbackPort) {
  const normalizedHost = normalizeLoopbackHost(host);
  const normalizedPort = Math.max(0, Number(port || fallbackPort || 0) || 0);
  if (normalizedPort <= 0) return null;
  return `http://${normalizedHost}:${Math.trunc(normalizedPort)}`;
}

function printOk(label, detail = '') {
  console.log(`[preflight] OK: ${label}${detail ? ` (${detail})` : ''}`);
}

function printSkip(label, detail = '') {
  console.log(`[preflight] SKIP: ${label}${detail ? ` (${detail})` : ''}`);
}

function printFail(label, detail = '') {
  console.error(`[preflight] FAIL: ${label}${detail ? ` (${detail})` : ''}`);
}

function assertOrThrow(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
  );
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
      redirect: 'manual',
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  } finally {
    clearTimeout(timeout);
  }
}

function runNpmScript(scriptName) {
  const command = isWindows ? 'cmd' : 'npm';
  const commandArgs = isWindows
    ? ['/c', 'npm', 'run', scriptName]
    : ['run', scriptName];
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`npm run ${scriptName} failed with exit code ${result.status || 1}`);
  }
}

async function checkRuntimeHealth(label, url, validator = null) {
  assertOrThrow(url, `${label} URL is not configured`);
  const { res, json } = await fetchJson(`${trimTrailingSlash(url)}/healthz`);
  assertOrThrow(res.status === 200, `${label} health returned ${res.status}`);
  assertOrThrow(json?.ok === true, `${label} health payload is not ok=true`);
  if (typeof validator === 'function') {
    validator(json);
  }
  printOk(label, trimTrailingSlash(url));
  return json;
}

async function loginAdmin(adminBaseUrl) {
  const username = String(process.env.ADMIN_WEB_USER || 'admin').trim() || 'admin';
  const password = String(
    process.env.ADMIN_WEB_PASSWORD || process.env.ADMIN_WEB_TOKEN || '',
  ).trim();
  assertOrThrow(password, 'ADMIN_WEB_PASSWORD (or ADMIN_WEB_TOKEN fallback) is required for preflight admin login');

  const { res, json } = await fetchJson(`${trimTrailingSlash(adminBaseUrl)}/admin/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      password,
    }),
  });
  assertOrThrow(res.status === 200, `admin login returned ${res.status}`);
  assertOrThrow(json?.ok === true, 'admin login did not return ok=true');
  const setCookie = String(res.headers.get('set-cookie') || '').split(';')[0];
  assertOrThrow(setCookie, 'admin login did not return session cookie');
  printOk('admin login');
  return setCookie;
}

async function checkAdminDeliveryRuntime(adminBaseUrl, cookie) {
  const { res, json } = await fetchJson(
    `${trimTrailingSlash(adminBaseUrl)}/admin/api/delivery/runtime`,
    {
      headers: {
        cookie,
      },
    },
  );
  assertOrThrow(res.status === 200, `admin delivery runtime returned ${res.status}`);
  assertOrThrow(json?.ok === true, 'admin delivery runtime did not return ok=true');
  const readiness = json.data?.readiness || null;
  if (envFlag('WORKER_ENABLE_DELIVERY', false)) {
    assertOrThrow(readiness?.ready === true, `delivery runtime is not ready (${readiness?.reason || 'unknown'})`);
  }
  printOk(
    'admin delivery runtime',
    `${json.data?.executionMode || 'unknown'}${readiness?.reason ? ` / ${readiness.reason}` : ''}`,
  );
  return json.data;
}

async function maybeRunDeliveryTestSend(adminBaseUrl, cookie) {
  const enabled =
    args.has('--with-delivery-test')
    || envFlag('PREFLIGHT_DELIVERY_TEST_ENABLED', false);
  if (!enabled) {
    printSkip(
      'delivery test-send',
      'set PREFLIGHT_DELIVERY_TEST_ENABLED=true or pass --with-delivery-test',
    );
    return null;
  }

  const itemId = String(process.env.PREFLIGHT_DELIVERY_TEST_ITEM_ID || '').trim();
  const gameItemId = String(
    process.env.PREFLIGHT_DELIVERY_TEST_GAME_ITEM_ID || 'Weapon_M1911',
  ).trim();
  const quantity = Math.max(
    1,
    Math.trunc(Number(process.env.PREFLIGHT_DELIVERY_TEST_QUANTITY || 1) || 1),
  );
  const userId = String(process.env.PREFLIGHT_DELIVERY_TEST_USER_ID || '').trim();
  const steamId = String(process.env.PREFLIGHT_DELIVERY_TEST_STEAM_ID || '').trim();

  assertOrThrow(itemId || gameItemId, 'delivery test-send requires PREFLIGHT_DELIVERY_TEST_ITEM_ID or PREFLIGHT_DELIVERY_TEST_GAME_ITEM_ID');

  const { res, json } = await fetchJson(
    `${trimTrailingSlash(adminBaseUrl)}/admin/api/delivery/test-send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        itemId: itemId || undefined,
        gameItemId: gameItemId || undefined,
        quantity,
        userId: userId || undefined,
        steamId: steamId || undefined,
        purchaseCode: `PREFLIGHT-${Date.now()}`,
      }),
      timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 15000),
    },
  );
  assertOrThrow(res.status === 200, `delivery test-send returned ${res.status}`);
  assertOrThrow(json?.ok === true, 'delivery test-send did not return ok=true');
  const outputs = Array.isArray(json.data?.outputs) ? json.data.outputs : [];
  assertOrThrow(outputs.length > 0, 'delivery test-send returned no outputs');
  printOk(
    'delivery test-send',
    `${json.data?.itemId || json.data?.gameItemId || gameItemId} x${quantity}`,
  );
  return json.data;
}

async function main() {
  try {
    if (!args.has('--skip-readiness')) {
      runNpmScript('readiness:prod');
      printOk('readiness:prod');
    } else {
      printSkip('readiness:prod', 'skipped by --skip-readiness');
    }

    await prisma.$queryRawUnsafe('SELECT 1');
    printOk('database', String(process.env.DATABASE_URL || '').trim());

    const adminBaseUrl = buildHttpBaseUrl(
      process.env.ADMIN_WEB_HOST || '127.0.0.1',
      process.env.ADMIN_WEB_PORT || 3200,
      3200,
    );
    const portalBaseUrl = buildHttpBaseUrl(
      process.env.WEB_PORTAL_HOST || '127.0.0.1',
      process.env.WEB_PORTAL_PORT || 3300,
      3300,
    );
    const botHealthBase = buildHttpBaseUrl(
      process.env.BOT_HEALTH_HOST || '127.0.0.1',
      process.env.BOT_HEALTH_PORT || 0,
      0,
    );
    const workerHealthBase = buildHttpBaseUrl(
      process.env.WORKER_HEALTH_HOST || '127.0.0.1',
      process.env.WORKER_HEALTH_PORT || 0,
      0,
    );
    const watcherHealthBase = buildHttpBaseUrl(
      process.env.SCUM_WATCHER_HEALTH_HOST || '127.0.0.1',
      process.env.SCUM_WATCHER_HEALTH_PORT || 0,
      0,
    );
    const agentHealthBase = trimTrailingSlash(
      process.env.SCUM_CONSOLE_AGENT_BASE_URL
        || buildHttpBaseUrl(
          process.env.SCUM_CONSOLE_AGENT_HOST || '127.0.0.1',
          process.env.SCUM_CONSOLE_AGENT_PORT || 0,
          0,
        )
        || '',
    );

    await checkRuntimeHealth('admin web', adminBaseUrl);
    await checkRuntimeHealth('player portal', portalBaseUrl);

    assertOrThrow(botHealthBase, 'BOT_HEALTH_PORT must be set for production preflight');
    await checkRuntimeHealth('bot runtime', botHealthBase);

    if (envFlag('WORKER_ENABLE_RENTBIKE', false) || envFlag('WORKER_ENABLE_DELIVERY', false)) {
      assertOrThrow(workerHealthBase, 'WORKER_HEALTH_PORT must be set when worker runtime is expected');
      await checkRuntimeHealth('worker runtime', workerHealthBase, (payload) => {
        assertOrThrow(payload.ready === true, `worker runtime is not ready (${payload.status || 'unknown'})`);
      });
    } else {
      printSkip('worker runtime', 'worker features disabled');
    }

    if (String(process.env.SCUM_LOG_PATH || '').trim()) {
      assertOrThrow(watcherHealthBase, 'SCUM_WATCHER_HEALTH_PORT must be set when SCUM_LOG_PATH is configured');
      await checkRuntimeHealth('watcher runtime', watcherHealthBase);
    } else {
      printSkip('watcher runtime', 'SCUM_LOG_PATH is empty');
    }

    const deliveryMode = String(
      process.env.DELIVERY_EXECUTION_MODE || 'rcon',
    ).trim().toLowerCase() || 'rcon';
    if (deliveryMode === 'agent') {
      assertOrThrow(agentHealthBase, 'SCUM_CONSOLE_AGENT_BASE_URL/PORT must be set for agent mode');
      await checkRuntimeHealth('console agent', agentHealthBase, (payload) => {
        assertOrThrow(payload.ready === true, `console agent is not ready (${payload.statusCode || payload.status || 'unknown'})`);
      });
      const { res, json } = await fetchJson(`${agentHealthBase}/preflight`, {
        timeoutMs: 12000,
      });
      assertOrThrow(res.status === 200, `console agent preflight returned ${res.status}`);
      assertOrThrow(json?.ok === true, 'console agent preflight did not return ok=true');
      assertOrThrow(json?.ready === true, `console agent preflight not ready (${json?.errorCode || json?.statusCode || 'unknown'})`);
      printOk('console agent preflight', json?.statusCode || 'READY');
    } else {
      printSkip('console agent', `delivery mode is ${deliveryMode}`);
    }

    const adminCookie = await loginAdmin(adminBaseUrl);
    await checkAdminDeliveryRuntime(adminBaseUrl, adminCookie);
    await maybeRunDeliveryTestSend(adminBaseUrl, adminCookie);

    console.log('\n[preflight] PASS');
  } catch (error) {
    printFail('preflight', error?.message || String(error));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => null);
  }
}

void main();
