const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const { prisma } = require('../src/prisma');
const {
  acceptPlatformLicenseLegal,
  createMarketplaceOffer,
  createPlatformApiKey,
  createPlatformWebhookEndpoint,
  createSubscription,
  createTenant,
  getPlatformAnalyticsOverview,
  getPlatformPublicOverview,
  issuePlatformLicense,
  recordPlatformAgentHeartbeat,
  reconcileDeliveryState,
  verifyPlatformApiKey,
} = require('../src/services/platformService');

async function cleanupPlatformTables() {
  await prisma.$transaction([
    prisma.platformMarketplaceOffer.deleteMany({}),
    prisma.platformAgentRuntime.deleteMany({}),
    prisma.platformWebhookEndpoint.deleteMany({}),
    prisma.platformApiKey.deleteMany({}),
    prisma.platformLicense.deleteMany({}),
    prisma.platformSubscription.deleteMany({}),
    prisma.platformTenant.deleteMany({}),
    prisma.deliveryAudit.deleteMany({}),
    prisma.deliveryDeadLetter.deleteMany({}),
    prisma.deliveryQueueJob.deleteMany({}),
    prisma.purchase.deleteMany({
      where: {
        code: {
          startsWith: 'PLATFORM-TEST-',
        },
      },
    }),
  ]);
}

function randomPort() {
  return 39500 + Math.floor(Math.random() * 500);
}

test('platform service manages tenant lifecycle, webhook delivery, analytics, and reconcile output', async (t) => {
  await cleanupPlatformTables();
  t.after(async () => {
    await cleanupPlatformTables();
  });

  const received = [];
  const port = randomPort();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk || '');
    });
    req.on('end', () => {
      received.push({
        url: req.url,
        headers: req.headers,
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const tenant = await createTenant({
    id: 'tenant-test-platform',
    slug: 'tenant-platform',
    name: 'Tenant Platform',
    type: 'reseller',
    ownerEmail: 'ops@example.com',
  }, 'test');
  assert.equal(tenant.ok, true);

  const subscription = await createSubscription({
    tenantId: tenant.tenant.id,
    planId: 'platform-starter',
    amountCents: 490000,
  }, 'test');
  assert.equal(subscription.ok, true);

  const license = await issuePlatformLicense({
    tenantId: tenant.tenant.id,
    seats: 5,
  }, 'test');
  assert.equal(license.ok, true);
  assert.match(String(license.license.licenseKey || ''), /^[A-F0-9-]{10,}$/);

  const accepted = await acceptPlatformLicenseLegal({
    licenseId: license.license.id,
  }, 'test');
  assert.equal(accepted.ok, true);
  assert.ok(accepted.license.legalAcceptedAt);

  const apiKey = await createPlatformApiKey({
    tenantId: tenant.tenant.id,
    name: 'Tenant Integration',
    scopes: ['tenant:read', 'analytics:read', 'agent:write', 'delivery:reconcile'],
  }, 'test');
  assert.equal(apiKey.ok, true);
  assert.match(String(apiKey.rawKey || ''), /^sk_/);

  const verified = await verifyPlatformApiKey(apiKey.rawKey, ['analytics:read']);
  assert.equal(verified.ok, true);
  assert.equal(String(verified.tenant?.id || ''), tenant.tenant.id);

  const webhook = await createPlatformWebhookEndpoint({
    tenantId: tenant.tenant.id,
    name: 'Agent Hook',
    eventType: 'platform.agent.heartbeat',
    targetUrl: `http://127.0.0.1:${port}/hook`,
  }, 'test');
  assert.equal(webhook.ok, true);

  const agent = await recordPlatformAgentHeartbeat({
    tenantId: tenant.tenant.id,
    runtimeKey: 'agent-stable',
    version: '1.0.0',
    channel: 'stable',
    meta: { os: 'windows' },
  }, 'test');
  assert.equal(agent.ok, true);
  assert.equal(String(agent.runtime.status || ''), 'online');

  const outdatedAgent = await recordPlatformAgentHeartbeat({
    tenantId: tenant.tenant.id,
    runtimeKey: 'agent-old',
    version: '0.8.0',
    minRequiredVersion: '1.0.0',
  }, 'test');
  assert.equal(outdatedAgent.ok, true);
  assert.equal(String(outdatedAgent.runtime.status || ''), 'outdated');

  assert.equal(received.length >= 2, true);
  assert.match(String(received[0]?.headers?.['x-scum-platform-event'] || ''), /platform\.agent\.heartbeat/i);

  const offer = await createMarketplaceOffer({
    tenantId: tenant.tenant.id,
    title: 'Managed Delivery Package',
    kind: 'service',
    priceCents: 150000,
  }, 'test');
  assert.equal(offer.ok, true);

  await prisma.purchase.createMany({
    data: [
      {
        code: 'PLATFORM-TEST-DELIVERED',
        userId: 'user-platform-1',
        itemId: 'item-platform-1',
        price: 100,
        status: 'delivered',
      },
      {
        code: 'PLATFORM-TEST-FAILED',
        userId: 'user-platform-1',
        itemId: 'item-platform-1',
        price: 100,
        status: 'delivery_failed',
      },
      {
        code: 'PLATFORM-TEST-STUCK',
        userId: 'user-platform-2',
        itemId: 'item-platform-2',
        price: 100,
        status: 'pending',
        createdAt: new Date(Date.now() - 30 * 60 * 1000),
        statusUpdatedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    ],
  });

  const analytics = await getPlatformAnalyticsOverview();
  assert.equal(Number(analytics.tenants.total || 0) >= 1, true);
  assert.equal(Number(analytics.subscriptions.total || 0) >= 1, true);
  assert.equal(Number(analytics.licenses.acceptedLegal || 0) >= 1, true);
  assert.equal(Number(analytics.marketplace.offers || 0) >= 1, true);
  assert.equal(Number(analytics.delivery.purchaseCount30d || 0) >= 3, true);

  const reconcile = await reconcileDeliveryState({
    pendingOverdueMs: 5 * 60 * 1000,
  });
  assert.equal(Number(reconcile.summary.anomalies || 0) >= 3, true);
  assert.ok(
    reconcile.anomalies.some((entry) => String(entry.type || '') === 'delivered-without-audit'),
  );
  assert.ok(
    reconcile.anomalies.some((entry) => String(entry.type || '') === 'failed-without-dead-letter'),
  );

  const publicOverview = await getPlatformPublicOverview();
  assert.equal(Boolean(publicOverview.trial?.enabled), true);
  assert.ok(Array.isArray(publicOverview.billing?.plans));
  assert.ok(Array.isArray(publicOverview.legal?.docs));
  assert.match(String(publicOverview.legal.docs?.[0]?.url || ''), /^\/docs\//);
});
