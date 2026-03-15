const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');

const adminWebServerPath = path.resolve(__dirname, '../src/adminWebServer.js');
const ticketStorePath = path.resolve(__dirname, '../src/store/ticketStore.js');
const ticketServicePath = path.resolve(__dirname, '../src/services/ticketService.js');

function freshModule(modulePath) {
  delete require.cache[modulePath];
  return require(modulePath);
}

function randomPort(base = 38100, span = 1000) {
  return base + Math.floor(Math.random() * span);
}

async function waitUntil(predicate, timeoutMs = 5000, intervalMs = 25) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

function openSse(baseUrl, cookie, userAgent = 'admin-live-test') {
  return new Promise((resolve, reject) => {
    const url = new URL('/admin/api/live', baseUrl);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        headers: {
          Cookie: cookie,
          'User-Agent': userAgent,
        },
      },
      (res) => {
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
        });
        resolve({
          req,
          res,
          getBuffer: () => buffer,
          close: () => {
            req.destroy();
            res.destroy();
          },
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function createLoggedInSession(baseUrl, username, password, userAgent = 'admin-live-test') {
  const loginRes = await fetch(`${baseUrl}/admin/api/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': userAgent,
    },
    body: JSON.stringify({ username, password }),
  });
  const loginData = await loginRes.json().catch(() => ({}));
  assert.equal(loginRes.status, 200, `login failed: ${JSON.stringify(loginData)}`);
  const setCookie = loginRes.headers.get('set-cookie');
  assert.ok(setCookie, 'expected set-cookie from login');
  return String(setCookie).split(';')[0];
}

test('admin e2e: live update stream receives admin-action after API change', async (t) => {
  const port = randomPort();
  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_WEB_USER = 'owner_live';
  process.env.ADMIN_WEB_PASSWORD = 'pass_live';
  process.env.ADMIN_WEB_TOKEN = 'token_live';
  process.env.ADMIN_WEB_2FA_ENABLED = 'false';
  process.env.ADMIN_WEB_SESSION_BIND_USER_AGENT = 'true';

  const fakeClient = {
    guilds: { cache: new Map() },
    channels: { fetch: async () => null },
  };

  const { startAdminWebServer } = freshModule(adminWebServerPath);
  const server = startAdminWebServer(fakeClient);
  if (!server.listening) {
    await once(server, 'listening');
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const userAgent = 'admin-live-test';
  const cookie = await createLoggedInSession(baseUrl, 'owner_live', 'pass_live', userAgent);

  const sse = await openSse(baseUrl, cookie, userAgent);
  t.after(async () => {
    try {
      sse.close();
    } catch {}
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[adminWebServerPath];
  });

  await waitUntil(() => sse.getBuffer().includes('event: connected'));

  const walletSetRes = await fetch(`${baseUrl}/admin/api/wallet/set`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'user-agent': userAgent,
    },
    body: JSON.stringify({
      userId: '12345678901234567',
      balance: 777,
    }),
  });
  const walletSetData = await walletSetRes.json().catch(() => ({}));
  assert.equal(walletSetRes.status, 200, JSON.stringify(walletSetData));

  await waitUntil(() => sse.getBuffer().includes('event: admin-action'));
});

test('admin e2e: ticket claim -> close deletes channel in full flow', async (t) => {
  const port = randomPort(39200, 1000);
  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_WEB_USER = 'owner_ticket';
  process.env.ADMIN_WEB_PASSWORD = 'pass_ticket';
  process.env.ADMIN_WEB_TOKEN = 'token_ticket';
  process.env.ADMIN_WEB_2FA_ENABLED = 'false';
  process.env.ADMIN_WEB_SESSION_BIND_USER_AGENT = 'true';

  delete require.cache[ticketServicePath];
  const ticketStore = freshModule(ticketStorePath);
  if (typeof ticketStore.replaceTickets === 'function') {
    ticketStore.replaceTickets([], 1);
  }

  const channelId = 'ticket-e2e-001';
  ticketStore.createTicket({
    guildId: 'guild-e2e',
    userId: 'user-e2e',
    channelId,
    category: 'support',
    reason: 'integration test',
  });

  const sentMessages = [];
  let deleteCalled = false;
  const fakeChannel = {
    isTextBased: () => true,
    send: async (text) => {
      sentMessages.push(String(text));
      return true;
    },
    delete: async () => {
      deleteCalled = true;
      return true;
    },
    permissionOverwrites: {
      edit: async () => true,
    },
  };

  const fakeClient = {
    guilds: { cache: new Map() },
    channels: {
      fetch: async (id) => (id === channelId ? fakeChannel : null),
    },
  };

  const { startAdminWebServer } = freshModule(adminWebServerPath);
  const server = startAdminWebServer(fakeClient);
  if (!server.listening) {
    await once(server, 'listening');
  }

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[adminWebServerPath];
    delete require.cache[ticketServicePath];
    delete require.cache[ticketStorePath];
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const userAgent = 'admin-ticket-test';
  const cookie = await createLoggedInSession(baseUrl, 'owner_ticket', 'pass_ticket', userAgent);

  const claimRes = await fetch(`${baseUrl}/admin/api/ticket/claim`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'user-agent': userAgent,
    },
    body: JSON.stringify({
      channelId,
    }),
  });
  const claimData = await claimRes.json().catch(() => ({}));
  assert.equal(claimRes.status, 200, JSON.stringify(claimData));
  assert.equal(claimData.ok, true);

  const closeRes = await fetch(`${baseUrl}/admin/api/ticket/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'user-agent': userAgent,
    },
    body: JSON.stringify({
      channelId,
    }),
  });
  const closeData = await closeRes.json().catch(() => ({}));
  assert.equal(closeRes.status, 200, JSON.stringify(closeData));
  assert.equal(closeData.ok, true);

  assert.equal(deleteCalled, true, 'expected channel.delete to be called on close flow');
  assert.ok(
    sentMessages.some((line) => line.includes('ปิด ticket')),
    'expected close notification message',
  );
});
