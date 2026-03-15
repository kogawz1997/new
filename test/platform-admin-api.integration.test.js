const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');

const { prisma } = require('../src/prisma');

const adminWebServerPath = path.resolve(__dirname, '../src/adminWebServer.js');

function freshAdminWebServerModule() {
  delete require.cache[adminWebServerPath];
  return require(adminWebServerPath);
}

function randomPort() {
  return 38800 + Math.floor(Math.random() * 600);
}

async function cleanupPlatformTables() {
  await prisma.$transaction([
    prisma.platformMarketplaceOffer.deleteMany({}),
    prisma.platformAgentRuntime.deleteMany({}),
    prisma.platformWebhookEndpoint.deleteMany({}),
    prisma.platformApiKey.deleteMany({}),
    prisma.platformLicense.deleteMany({}),
    prisma.platformSubscription.deleteMany({}),
    prisma.platformTenant.deleteMany({}),
  ]);
}

test('admin platform routes and tenant public API flow work end-to-end', async (t) => {
  await cleanupPlatformTables();

  const port = randomPort();
  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_WEB_USER = 'platform_owner_test';
  process.env.ADMIN_WEB_PASSWORD = 'platform_owner_pass';
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
    await cleanupPlatformTables();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  async function request(pathname, method = 'GET', body = null, cookie = '', extraHeaders = {}) {
    const headers = { ...extraHeaders };
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

  const login = await request('/admin/api/login', 'POST', {
    username: 'platform_owner_test',
    password: 'platform_owner_pass',
  });
  assert.equal(login.res.status, 200);
  const cookie = String(login.res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie);

  const tenantCreate = await request('/admin/api/platform/tenant', 'POST', {
    id: 'tenant-admin-api',
    slug: 'tenant-admin-api',
    name: 'Tenant Admin API',
    type: 'trial',
    ownerEmail: 'tenant@example.com',
  }, cookie);
  assert.equal(tenantCreate.res.status, 200);
  assert.equal(tenantCreate.data.ok, true);

  const subscriptionCreate = await request('/admin/api/platform/subscription', 'POST', {
    tenantId: 'tenant-admin-api',
    planId: 'trial-14d',
    billingCycle: 'trial',
    amountCents: 0,
  }, cookie);
  assert.equal(subscriptionCreate.res.status, 200);
  assert.equal(subscriptionCreate.data.ok, true);

  const licenseCreate = await request('/admin/api/platform/license', 'POST', {
    tenantId: 'tenant-admin-api',
    seats: 2,
  }, cookie);
  assert.equal(licenseCreate.res.status, 200);
  assert.equal(licenseCreate.data.ok, true);

  const apiKeyCreate = await request('/admin/api/platform/apikey', 'POST', {
    tenantId: 'tenant-admin-api',
    name: 'Trial Key',
    scopes: ['tenant:read', 'analytics:read', 'agent:write', 'delivery:reconcile'],
  }, cookie);
  assert.equal(apiKeyCreate.res.status, 200);
  assert.equal(apiKeyCreate.data.ok, true);
  const rawKey = String(apiKeyCreate.data.data?.rawKey || '');
  assert.match(rawKey, /^sk_/);

  const overview = await request('/admin/api/platform/overview', 'GET', null, cookie);
  assert.equal(overview.res.status, 200);
  assert.equal(overview.data.ok, true);
  assert.ok(Array.isArray(overview.data.data?.plans));
  assert.ok(Array.isArray(overview.data.data?.permissionCatalog));

  const tenants = await request('/admin/api/platform/tenants', 'GET', null, cookie);
  assert.equal(tenants.res.status, 200);
  assert.equal(tenants.data.ok, true);
  assert.ok(Array.isArray(tenants.data.data));
  assert.ok(tenants.data.data.some((row) => String(row.id || '') === 'tenant-admin-api'));

  const tenantSelf = await request('/platform/api/v1/tenant/self', 'GET', null, '', {
    'x-platform-api-key': rawKey,
  });
  assert.equal(tenantSelf.res.status, 200);
  assert.equal(tenantSelf.data.ok, true);
  assert.equal(String(tenantSelf.data.data?.tenant?.id || ''), 'tenant-admin-api');

  const analytics = await request('/platform/api/v1/analytics/overview', 'GET', null, '', {
    authorization: `Bearer ${rawKey}`,
  });
  assert.equal(analytics.res.status, 200);
  assert.equal(analytics.data.ok, true);
  assert.equal(Number(analytics.data.data?.tenants?.total || 0) >= 1, true);

  const heartbeat = await request('/platform/api/v1/agent/heartbeat', 'POST', {
    runtimeKey: 'tenant-agent',
    version: '1.0.0',
    channel: 'stable',
  }, '', {
    'x-platform-api-key': rawKey,
  });
  assert.equal(heartbeat.res.status, 200);
  assert.equal(heartbeat.data.ok, true);
  assert.equal(String(heartbeat.data.data?.runtimeKey || ''), 'tenant-agent');

  const reconcile = await request('/platform/api/v1/delivery/reconcile', 'POST', {
    pendingOverdueMs: 1000,
  }, '', {
    'x-platform-api-key': rawKey,
  });
  assert.equal(reconcile.res.status, 200);
  assert.equal(reconcile.data.ok, true);
  assert.equal(typeof reconcile.data.data?.summary?.anomalies, 'number');

  const publicOverview = await request('/platform/api/v1/public/overview');
  assert.equal(publicOverview.res.status, 200);
  assert.equal(publicOverview.data.ok, true);
  assert.ok(Array.isArray(publicOverview.data.data?.legal?.docs));
});
