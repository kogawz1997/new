const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');

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
});
