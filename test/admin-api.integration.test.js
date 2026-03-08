const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { createPurchase, listShopItems } = require('../src/store/memoryStore');

const adminWebServerPath = path.resolve(__dirname, '../src/adminWebServer.js');

function freshAdminWebServerModule() {
  delete require.cache[adminWebServerPath];
  return require(adminWebServerPath);
}

function randomPort(base = 38000, span = 1000) {
  return base + Math.floor(Math.random() * span);
}

test('admin API auth + validation integration flow', async (t) => {
  const port = randomPort();
  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_WEB_USER = 'admin_test';
  process.env.ADMIN_WEB_PASSWORD = 'pass_test';
  process.env.ADMIN_WEB_TOKEN = 'token_test';
  process.env.ADMIN_WEB_USERS_JSON = '';
  process.env.ADMIN_WEB_2FA_ENABLED = 'false';

  const fakeClient = {
    guilds: {
      cache: new Map(),
    },
    channels: {
      fetch: async () => null,
    },
  };

  const { startAdminWebServer } = freshAdminWebServerModule();
  const server = startAdminWebServer(fakeClient);
  if (!server.listening) {
    await once(server, 'listening');
  }

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[adminWebServerPath];
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  async function request(pathname, method = 'GET', body = null, cookie = '') {
    const headers = {};
    if (body != null) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  const missing = await request('/admin/api/login', 'POST', {});
  assert.equal(missing.res.status, 400);
  assert.equal(missing.data.ok, false);

  const wrong = await request('/admin/api/login', 'POST', {
    username: 'admin_test',
    password: 'wrong',
  });
  assert.equal(wrong.res.status, 401);
  assert.equal(wrong.data.error, 'Invalid username or password');

  const unauthorizedMe = await request('/admin/api/me');
  assert.equal(unauthorizedMe.res.status, 401);

  const tokenByQuery = await request('/admin/api/me?token=token_test');
  assert.equal(tokenByQuery.res.status, 401);

  const tokenByHeaderRes = await fetch(`${baseUrl}/admin/api/me`, {
    headers: {
      'x-admin-token': 'token_test',
    },
  });
  const tokenByHeaderData = await tokenByHeaderRes.json().catch(() => ({}));
  assert.equal(tokenByHeaderRes.status, 200);
  assert.equal(tokenByHeaderData.ok, true);

  const login = await request('/admin/api/login', 'POST', {
    username: 'admin_test',
    password: 'pass_test',
  });
  assert.equal(login.res.status, 200);
  assert.equal(login.data.ok, true);
  const setCookie = login.res.headers.get('set-cookie');
  assert.ok(setCookie, 'expected Set-Cookie header after login');
  const cookie = String(setCookie).split(';')[0];

  const me = await request('/admin/api/me', 'GET', null, cookie);
  assert.equal(me.res.status, 200);
  assert.equal(me.data.ok, true);
  assert.equal(me.data.data.user, 'admin_test');
  assert.equal(me.res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(me.res.headers.get('x-frame-options'), 'DENY');

  const invalidWallet = await request(
    '/admin/api/wallet/set',
    'POST',
    {},
    cookie,
  );
  assert.equal(invalidWallet.res.status, 400);
  assert.equal(invalidWallet.data.error, 'Invalid request payload');

  const csrfAttempt = await fetch(`${baseUrl}/admin/api/wallet/set`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'http://evil.example',
      'sec-fetch-site': 'cross-site',
    },
    body: JSON.stringify({
      userId: '12345678901234567',
      balance: 100,
    }),
  });
  const csrfData = await csrfAttempt.json().catch(() => ({}));
  assert.equal(csrfAttempt.status, 403);
  assert.equal(csrfData.ok, false);

  const observability = await request('/admin/api/observability', 'GET', null, cookie);
  assert.equal(observability.res.status, 200);
  assert.equal(observability.data.ok, true);
  assert.equal(typeof observability.data.data.delivery.queueLength, 'number');
  assert.equal(typeof observability.data.data.adminLogin.failures, 'number');
  assert.equal(typeof observability.data.data.webhook.errorRate, 'number');
  assert.equal(
    typeof observability.data.data.timeSeriesWindowMs,
    'number',
  );

  const observabilityFiltered = await request(
    '/admin/api/observability?windowMs=60000&series=loginFailures,webhookErrorRate',
    'GET',
    null,
    cookie,
  );
  assert.equal(observabilityFiltered.res.status, 200);
  assert.equal(observabilityFiltered.data.ok, true);
  assert.deepEqual(
    Object.keys(observabilityFiltered.data.data.timeSeries || {}).sort(),
    ['loginFailures', 'webhookErrorRate'],
  );
  assert.equal(observabilityFiltered.data.data.timeSeriesWindowMs, 60000);

  const healthz = await request('/healthz');
  assert.equal(healthz.res.status, 200);
  assert.equal(healthz.data.ok, true);
  assert.equal(healthz.data.data.service, 'admin-web');

  const deadLetterList = await request('/admin/api/delivery/dead-letter', 'GET', null, cookie);
  assert.equal(deadLetterList.res.status, 200);
  assert.equal(deadLetterList.data.ok, true);
  assert.ok(Array.isArray(deadLetterList.data.data));

  const purchaseStatuses = await request('/admin/api/purchase/statuses', 'GET', null, cookie);
  assert.equal(purchaseStatuses.res.status, 200);
  assert.equal(purchaseStatuses.data.ok, true);
  assert.ok(Array.isArray(purchaseStatuses.data.data.knownStatuses));
  assert.ok(purchaseStatuses.data.data.knownStatuses.includes('pending'));

  const initialShopItems = await listShopItems();
  assert.ok(initialShopItems.length > 0);
  const purchaseForTransition = await createPurchase(
    'admin-api-transition-user',
    initialShopItems[0],
  );

  const statusDelivered = await request('/admin/api/purchase/status', 'POST', {
    code: purchaseForTransition.code,
    status: 'delivered',
    reason: 'integration-test-transition',
  }, cookie);
  assert.equal(statusDelivered.res.status, 200);
  assert.equal(statusDelivered.data.ok, true);
  assert.equal(
    String(statusDelivered.data.data?.purchase?.status || ''),
    'delivered',
  );

  const invalidTransition = await request('/admin/api/purchase/status', 'POST', {
    code: purchaseForTransition.code,
    status: 'pending',
    reason: 'integration-test-invalid-transition',
  }, cookie);
  assert.equal(invalidTransition.res.status, 400);
  assert.equal(invalidTransition.data.ok, false);
  assert.equal(
    String(invalidTransition.data?.data?.reason || ''),
    'transition-not-allowed',
  );

  const probeUserId = '999999999999999991';
  const walletSetA = await request('/admin/api/wallet/set', 'POST', {
    userId: probeUserId,
    balance: 123456,
  }, cookie);
  assert.equal(walletSetA.res.status, 200);
  assert.equal(walletSetA.data.ok, true);

  const backupCreate = await request('/admin/api/backup/create', 'POST', {
    note: 'integration-test-backup',
    includeSnapshot: true,
  }, cookie);
  assert.equal(backupCreate.res.status, 200);
  assert.equal(backupCreate.data.ok, true);
  assert.ok(String(backupCreate.data.data.file || '').endsWith('.json'));
  const backupFile = String(backupCreate.data.data.file || '').trim();
  assert.ok(backupFile.length > 0);

  const backupList = await request('/admin/api/backup/list', 'GET', null, cookie);
  assert.equal(backupList.res.status, 200);
  assert.equal(backupList.data.ok, true);
  assert.ok(Array.isArray(backupList.data.data));
  assert.ok(
    backupList.data.data.some((row) => String(row?.file || '') === backupFile),
    'expected created backup to appear in list',
  );

  const walletSetB = await request('/admin/api/wallet/set', 'POST', {
    userId: probeUserId,
    balance: 654321,
  }, cookie);
  assert.equal(walletSetB.res.status, 200);
  assert.equal(walletSetB.data.ok, true);

  const snapshotBeforeRestore = await request('/admin/api/snapshot', 'GET', null, cookie);
  assert.equal(snapshotBeforeRestore.res.status, 200);
  const walletBeforeRestore = (snapshotBeforeRestore.data?.data?.wallets || []).find(
    (row) => String(row?.userId || '') === probeUserId,
  );
  assert.equal(Number(walletBeforeRestore?.balance || 0), 654321);

  const restoreDryRun = await request('/admin/api/backup/restore', 'POST', {
    backup: backupFile,
    dryRun: true,
  }, cookie);
  assert.equal(restoreDryRun.res.status, 200);
  assert.equal(restoreDryRun.data.ok, true);
  assert.equal(restoreDryRun.data.data.dryRun, true);

  const restoreLive = await request('/admin/api/backup/restore', 'POST', {
    backup: backupFile,
    dryRun: false,
  }, cookie);
  assert.equal(restoreLive.res.status, 200);
  assert.equal(restoreLive.data.ok, true);
  assert.equal(restoreLive.data.data.restored, true);

  const snapshotAfterRestore = await request('/admin/api/snapshot', 'GET', null, cookie);
  assert.equal(snapshotAfterRestore.res.status, 200);
  const walletAfterRestore = (snapshotAfterRestore.data?.data?.wallets || []).find(
    (row) => String(row?.userId || '') === probeUserId,
  );
  assert.equal(Number(walletAfterRestore?.balance || 0), 123456);
});

test('admin API rejects malformed JSON and oversized UTF-8 body with proper status', async (t) => {
  const port = randomPort(39200, 700);
  const originalMaxBody = process.env.ADMIN_WEB_MAX_BODY_BYTES;

  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_WEB_USER = 'admin_test';
  process.env.ADMIN_WEB_PASSWORD = 'pass_test';
  process.env.ADMIN_WEB_TOKEN = 'token_test';
  process.env.ADMIN_WEB_USERS_JSON = '';
  process.env.ADMIN_WEB_2FA_ENABLED = 'false';
  process.env.ADMIN_WEB_MAX_BODY_BYTES = '110';

  const fakeClient = {
    guilds: {
      cache: new Map(),
    },
    channels: {
      fetch: async () => null,
    },
  };

  const { startAdminWebServer } = freshAdminWebServerModule();
  const server = startAdminWebServer(fakeClient);
  if (!server.listening) {
    await once(server, 'listening');
  }

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[adminWebServerPath];
    if (originalMaxBody == null) {
      delete process.env.ADMIN_WEB_MAX_BODY_BYTES;
    } else {
      process.env.ADMIN_WEB_MAX_BODY_BYTES = originalMaxBody;
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  const malformed = await fetch(`${baseUrl}/admin/api/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"username":"admin_test"',
  });
  const malformedData = await malformed.json().catch(() => ({}));
  assert.equal(malformed.status, 400);
  assert.equal(malformedData.ok, false);

  const oversized = await fetch(`${baseUrl}/admin/api/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      username: 'admin_test',
      password: 'ก'.repeat(5000),
    }),
  });
  const oversizedData = await oversized.json().catch(() => ({}));
  assert.equal(oversized.status, 413);
  assert.equal(oversizedData.ok, false);
});
