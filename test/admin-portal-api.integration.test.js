const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');

const { createPurchase, listShopItems } = require('../src/store/memoryStore');
const { setCode, deleteCode } = require('../src/store/redeemStore');

const adminWebServerPath = path.resolve(__dirname, '../src/adminWebServer.js');

function freshAdminWebServerModule() {
  delete require.cache[adminWebServerPath];
  return require(adminWebServerPath);
}

function randomPort(base = 40100, span = 800) {
  return base + Math.floor(Math.random() * span);
}

test('admin portal API (token + forwarded discord id) integration flow', async (t) => {
  const port = randomPort();
  const token = 'portal_test_token_abcdefghijklmnopqrstuvwxyz';
  const discordId = `9${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 18);
  const redeemCode = `P${Date.now()}${Math.floor(Math.random() * 1000)}`.toUpperCase();

  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_WEB_USER = 'admin_test';
  process.env.ADMIN_WEB_PASSWORD = 'pass_test';
  process.env.ADMIN_WEB_TOKEN = token;
  process.env.ADMIN_WEB_USERS_JSON = '';
  process.env.ADMIN_WEB_2FA_ENABLED = 'false';

  const fakeClient = {
    guilds: { cache: new Map() },
    channels: { fetch: async () => null },
  };

  const { startAdminWebServer } = freshAdminWebServerModule();
  const server = startAdminWebServer(fakeClient);
  if (!server.listening) {
    await once(server, 'listening');
  }

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[adminWebServerPath];
    deleteCode(redeemCode);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const portalHeaders = {
    'x-admin-token': token,
    'x-forwarded-discord-id': discordId,
    'x-forwarded-user': `portal-${discordId}`,
  };

  async function get(pathname) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      headers: portalHeaders,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function post(pathname, body) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        ...portalHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  const items = await listShopItems();
  assert.ok(items.length > 0);
  await createPurchase(discordId, items[0]);

  const dashboard = await get('/admin/api/portal/player/dashboard');
  assert.equal(dashboard.res.status, 200);
  assert.equal(dashboard.data.ok, true);
  assert.equal(String(dashboard.data.data.discordId), discordId);

  const shop = await get('/admin/api/portal/shop/list?kind=all&limit=20');
  assert.equal(shop.res.status, 200);
  assert.equal(shop.data.ok, true);
  assert.ok(Array.isArray(shop.data.data.items));
  assert.ok(shop.data.data.items.length > 0);

  const purchases = await get('/admin/api/portal/purchase/list?limit=20');
  assert.equal(purchases.res.status, 200);
  assert.equal(purchases.data.ok, true);
  assert.ok(Array.isArray(purchases.data.data.items));
  assert.ok(
    purchases.data.data.items.some(
      (row) => String(row.userId || '') === discordId,
    ),
  );

  setCode(redeemCode, {
    type: 'coins',
    amount: 222,
  });
  const redeem = await post('/admin/api/portal/redeem', { code: redeemCode });
  assert.equal(redeem.res.status, 200);
  assert.equal(redeem.data.ok, true);
  assert.equal(String(redeem.data.data.type), 'coins');

  const bountyAdd = await post('/admin/api/portal/bounty/add', {
    targetName: 'PortalTarget',
    amount: 444,
  });
  assert.equal(bountyAdd.res.status, 200);
  assert.equal(bountyAdd.data.ok, true);
  assert.ok(Number(bountyAdd.data.data?.bounty?.id) > 0);

  const bountyList = await get('/admin/api/portal/bounty/list');
  assert.equal(bountyList.res.status, 200);
  assert.equal(bountyList.data.ok, true);
  assert.ok(Array.isArray(bountyList.data.data.items));
  assert.ok(
    bountyList.data.data.items.some(
      (row) => String(row.targetName || '') === 'PortalTarget',
    ),
  );

  const rentbike = await post('/admin/api/portal/rentbike/request', {});
  assert.ok([200, 400].includes(rentbike.res.status));
  if (rentbike.res.status === 400) {
    assert.equal(rentbike.data.ok, false);
  }
});
