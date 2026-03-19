const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

function pickPort() {
  const base = 3400;
  const spread = 300;
  return base + Math.floor(Math.random() * spread);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.ok === true) {
          return;
        }
      }
    } catch {
      // keep waiting
    }
    await delay(250);
  }
  throw new Error('portal did not become healthy in time');
}

async function waitForRoute(path, baseUrl, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await request(path, baseUrl);
      if (res.status > 0) {
        return;
      }
    } catch {
      // keep waiting
    }
    await delay(250);
  }
  throw new Error(`route ${path} did not respond in time`);
}

async function request(path, baseUrl) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual' });
}

test('web-portal-standalone player-only mode: routes and api behavior', async () => {
  const port = pickPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const legacyAdminUrl = 'http://127.0.0.1:3999/admin';

  const child = spawn(process.execPath, ['apps/web-portal-standalone/server.js'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      WEB_PORTAL_MODE: 'player',
      WEB_PORTAL_HOST: '127.0.0.1',
      WEB_PORTAL_PORT: String(port),
      WEB_PORTAL_BASE_URL: baseUrl,
      WEB_PORTAL_LEGACY_ADMIN_URL: legacyAdminUrl,
      WEB_PORTAL_DISCORD_CLIENT_ID: 'test-client-id',
      WEB_PORTAL_DISCORD_CLIENT_SECRET: 'test-client-secret',
      WEB_PORTAL_PLAYER_OPEN_ACCESS: 'true',
      WEB_PORTAL_SECURE_COOKIE: 'false',
      WEB_PORTAL_ENFORCE_ORIGIN_CHECK: 'true',
      BOT_ENABLE_ADMIN_WEB: 'false',
    },
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  try {
    await waitForHealth(baseUrl);

    const health = await request('/healthz', baseUrl);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody?.data?.mode, 'player');
    assert.equal(healthBody?.data?.legacyAdminUrl, legacyAdminUrl);
    assert.equal(healthBody?.data?.cookieName, 'scum_portal_session');
    assert.equal(healthBody?.data?.cookiePath, '/');

    const root = await request('/', baseUrl);
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/player');

    const showcase = await request('/showcase', baseUrl);
    assert.equal(showcase.status, 200);
    const showcaseHtml = await showcase.text();
    assert.match(showcaseHtml, /SCUM Platform Showcase/i);
    assert.match(showcaseHtml, /Role-based platform surfaces/i);

    const showcaseSlash = await request('/showcase/', baseUrl);
    assert.equal(showcaseSlash.status, 302);
    assert.equal(showcaseSlash.headers.get('location'), '/showcase');

    const landing = await request('/landing', baseUrl);
    assert.equal(landing.status, 200);
    const landingHtml = await landing.text();
    assert.match(landingHtml, /SCUM Platform Landing/i);

    const trial = await request('/trial', baseUrl);
    assert.equal(trial.status, 200);
    const trialHtml = await trial.text();
    assert.match(trialHtml, /SCUM Platform Trial/i);

    const publicOverview = await request('/api/platform/public/overview', baseUrl);
    assert.equal(publicOverview.status, 200);
    const publicOverviewBody = await publicOverview.json();
    assert.equal(publicOverviewBody?.ok, true);
    assert.ok(Array.isArray(publicOverviewBody?.data?.billing?.plans));
    assert.ok(Array.isArray(publicOverviewBody?.data?.legal?.docs));

    const legalDoc = await request('/docs/LEGAL_TERMS_TH.md', baseUrl);
    assert.equal(legalDoc.status, 200);
    const legalDocHtml = await legalDoc.text();
    assert.match(legalDocHtml, /ข้อกำหนดการใช้งานแพลตฟอร์ม/i);

    const admin = await request('/admin', baseUrl);
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.get('location'), legacyAdminUrl);

    const adminLogin = await request('/admin/login', baseUrl);
    assert.equal(adminLogin.status, 302);
    assert.equal(adminLogin.headers.get('location'), `${legacyAdminUrl}/login`);

    const adminApiLive = await request('/admin/api/live', baseUrl);
    assert.equal(adminApiLive.status, 302);
    assert.equal(adminApiLive.headers.get('location'), `${legacyAdminUrl}/api/live`);

    const login = await request('/player/login', baseUrl);
    assert.equal(login.status, 200);
    const loginHtml = await login.text();
    assert.match(loginHtml, /Discord/i);

    for (const path of [
      '/player/api/dashboard',
      '/player/api/shop/list',
      '/player/api/purchase/list',
      '/player/api/bounty/list',
    ]) {
      const res = await request(path, baseUrl);
      assert.equal(res.status, 401, `${path} should be unauthorized before login`);
      const body = await res.json().catch(() => ({}));
      assert.equal(body?.ok, false);
      assert.equal(body?.error, 'Unauthorized');
    }
  } finally {
    child.kill('SIGTERM');
    await delay(500);
  }

  if (stderr.trim()) {
    assert.ok(!/EADDRINUSE/i.test(stderr), `unexpected stderr: ${stderr}`);
  }
});

test('web-portal-standalone routes local /admin traffic to legacy admin before player canonical redirect', async () => {
  const port = pickPort();
  const localBase = `http://127.0.0.1:${port}`;
  const canonicalBase = 'https://player.example.com';
  const legacyAdminUrl = 'https://admin.example.com/admin';

  const child = spawn(process.execPath, ['apps/web-portal-standalone/server.js'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      WEB_PORTAL_MODE: 'player',
      WEB_PORTAL_HOST: '127.0.0.1',
      WEB_PORTAL_PORT: String(port),
      WEB_PORTAL_BASE_URL: canonicalBase,
      WEB_PORTAL_LEGACY_ADMIN_URL: legacyAdminUrl,
      WEB_PORTAL_DISCORD_CLIENT_ID: '1478651427088760842',
      WEB_PORTAL_DISCORD_CLIENT_SECRET: 'test-client-secret-1234567890',
      WEB_PORTAL_PLAYER_OPEN_ACCESS: 'true',
      WEB_PORTAL_SECURE_COOKIE: 'true',
      WEB_PORTAL_ENFORCE_ORIGIN_CHECK: 'true',
      PERSIST_REQUIRE_DB: 'true',
      PERSIST_LEGACY_SNAPSHOTS: 'false',
      BOT_ENABLE_ADMIN_WEB: 'false',
    },
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  try {
    await waitForRoute('/admin', localBase);

    const admin = await request('/admin', localBase);
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.get('location'), legacyAdminUrl);

    const adminApiLive = await request('/admin/api/live', localBase);
    assert.equal(adminApiLive.status, 302);
    assert.equal(adminApiLive.headers.get('location'), `${legacyAdminUrl}/api/live`);
  } finally {
    child.kill('SIGTERM');
    await delay(500);
  }

  if (stderr.trim()) {
    assert.ok(!/EADDRINUSE/i.test(stderr), `unexpected stderr: ${stderr}`);
  }
});
