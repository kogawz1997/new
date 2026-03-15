const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { createPurchase, listShopItems } = require('../src/store/memoryStore');
const { claimWelcomePackForUser } = require('../src/services/welcomePackService');
const { startScumConsoleAgent } = require('../src/services/scumConsoleAgent');
const { prisma } = require('../src/prisma');
const {
  setAdminRestoreState,
} = require('../src/store/adminRestoreStateStore');
const {
  resetPlatformOpsState,
  updatePlatformOpsState,
} = require('../src/store/platformOpsStateStore');

const adminWebServerPath = path.resolve(__dirname, '../src/adminWebServer.js');

function freshAdminWebServerModule() {
  delete require.cache[adminWebServerPath];
  return require(adminWebServerPath);
}

function randomPort(base = 38000, span = 1000) {
  return base + Math.floor(Math.random() * span);
}

function resetAdminIntegrationRuntimeState() {
  setAdminRestoreState({
    status: 'idle',
    active: false,
    maintenance: false,
    backup: null,
    confirmBackup: null,
    rollbackBackup: null,
    actor: null,
    role: null,
    startedAt: null,
    endedAt: null,
    updatedAt: new Date().toISOString(),
    lastCompletedAt: null,
    durationMs: null,
    lastError: null,
    rollbackStatus: 'none',
    rollbackError: null,
    counts: null,
    currentCounts: null,
    diff: null,
    warnings: [],
  });
  resetPlatformOpsState();
  process.env.ADMIN_WEB_SSO_DISCORD_ENABLED = 'false';
  process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_ID = '';
  process.env.ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET = '';
  process.env.ADMIN_WEB_SSO_DISCORD_REDIRECT_URI = '';
  process.env.ADMIN_WEB_SSO_DISCORD_GUILD_ID = '';
}

resetAdminIntegrationRuntimeState();

test('admin API auth + validation integration flow', async (t) => {
  resetAdminIntegrationRuntimeState();
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
    resetAdminIntegrationRuntimeState();
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
  assert.match(String(setCookie || ''), /Path=\/admin/i);
  const cookie = String(setCookie).split(';')[0];

  const me = await request('/admin/api/me', 'GET', null, cookie);
  assert.equal(me.res.status, 200);
  assert.equal(me.data.ok, true);
  assert.equal(me.data.data.user, 'admin_test');
  assert.equal(me.res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(me.res.headers.get('x-frame-options'), 'DENY');

  const providers = await request('/admin/api/auth/providers', 'GET', null, cookie);
  assert.equal(providers.res.status, 200);
  assert.equal(providers.data.ok, true);
  assert.equal(String(providers.data.data?.sessionCookie?.path || ''), '/admin');
  assert.equal(String(providers.data.data?.sessionCookie?.name || ''), 'scum_admin_session');

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

  const observabilityExport = await fetch(
    `${baseUrl}/admin/api/observability/export?windowMs=60000&series=loginFailures,webhookErrorRate&format=json`,
    {
      headers: { cookie },
    },
  );
  const observabilityExportText = await observabilityExport.text();
  assert.equal(observabilityExport.status, 200);
  assert.match(
    String(observabilityExport.headers.get('content-disposition') || ''),
    /observability-/i,
  );
  assert.match(observabilityExportText, /"timeSeries"/);

  const dashboardCards = await request('/admin/api/dashboard/cards', 'GET', null, cookie);
  assert.equal(dashboardCards.res.status, 200);
  assert.equal(dashboardCards.data.ok, true);
  assert.ok(Array.isArray(dashboardCards.data.data?.cards));
  assert.ok(dashboardCards.data.data.cards.length >= 10);
  assert.equal(typeof dashboardCards.data.data?.metrics?.walletCount, 'number');
  assert.equal(Boolean(dashboardCards.data.data?.cache?.cached), false);

  const dashboardCardsCached = await request('/admin/api/dashboard/cards', 'GET', null, cookie);
  assert.equal(dashboardCardsCached.res.status, 200);
  assert.equal(dashboardCardsCached.data.ok, true);
  assert.equal(Boolean(dashboardCardsCached.data.data?.cache?.cached), true);

  const presetCreate = await request('/admin/api/audit/presets', 'POST', {
    name: 'Exact actor wallet preset',
    view: 'wallet',
    visibility: 'role',
    sharedRole: 'admin',
    actor: 'admin-web:admin_test',
    actorMode: 'exact',
    reference: 'probe-ref',
    referenceMode: 'contains',
    sortBy: 'delta',
    sortOrder: 'asc',
    pageSize: 25,
    windowMs: 24 * 60 * 60 * 1000,
  }, cookie);
  assert.equal(presetCreate.res.status, 200);
  assert.equal(presetCreate.data.ok, true);
  const presetId = String(presetCreate.data.data?.id || '');
  assert.ok(presetId.length > 0);
  assert.equal(String(presetCreate.data.data?.createdBy || ''), 'admin-web:admin_test');
  assert.equal(String(presetCreate.data.data?.visibility || ''), 'role');
  assert.equal(String(presetCreate.data.data?.sharedRole || ''), 'admin');
  assert.equal(String(presetCreate.data.data?.createdByUser || ''), 'admin_test');

  const presetList = await request('/admin/api/audit/presets', 'GET', null, cookie);
  assert.equal(presetList.res.status, 200);
  assert.equal(presetList.data.ok, true);
  assert.ok(Array.isArray(presetList.data.data));
  assert.ok(
    presetList.data.data.some(
      (row) => String(row?.id || '') === presetId && String(row?.name || '') === 'Exact actor wallet preset',
    ),
  );

  const healthz = await request('/healthz');
  assert.equal(healthz.res.status, 200);
  assert.equal(healthz.data.ok, true);
  assert.equal(healthz.data.data.service, 'admin-web');

  const adminHealth = await request('/admin/api/health', 'GET', null, cookie);
  assert.equal(adminHealth.res.status, 200);
  assert.equal(adminHealth.data.ok, true);
  assert.equal(typeof adminHealth.data.data?.runtimeSupervisor?.overall, 'string');
  assert.equal(typeof adminHealth.data.data?.backupRestore?.status, 'string');

  const runtimeSupervisor = await request('/admin/api/runtime/supervisor', 'GET', null, cookie);
  assert.equal(runtimeSupervisor.res.status, 200);
  assert.equal(runtimeSupervisor.data.ok, true);
  assert.ok(Array.isArray(runtimeSupervisor.data.data?.items));
  assert.equal(typeof runtimeSupervisor.data.data?.overall, 'string');

  const deadLetterList = await request('/admin/api/delivery/dead-letter', 'GET', null, cookie);
  assert.equal(deadLetterList.res.status, 200);
  assert.equal(deadLetterList.data.ok, true);
  assert.ok(Array.isArray(deadLetterList.data.data));

  const deliveryRuntime = await request('/admin/api/delivery/runtime', 'GET', null, cookie);
  assert.equal(deliveryRuntime.res.status, 200);
  assert.equal(deliveryRuntime.data.ok, true);
  assert.equal(typeof deliveryRuntime.data.data?.executionMode, 'string');
  assert.equal(typeof deliveryRuntime.data.data?.queueLength, 'number');
  assert.ok(deliveryRuntime.data.data?.settings);

  const deliveryPreview = await request('/admin/api/delivery/preview', 'POST', {
    gameItemId: 'Weapon_M1911',
    quantity: 1,
    steamId: '76561198000000000',
  }, cookie);
  assert.equal(deliveryPreview.res.status, 200);
  assert.equal(deliveryPreview.data.ok, true);
  assert.equal(String(deliveryPreview.data.data?.gameItemId || ''), 'Weapon_M1911');
  assert.ok(Array.isArray(deliveryPreview.data.data?.serverCommands));
  assert.ok(deliveryPreview.data.data.serverCommands.length > 0);
  assert.ok(Array.isArray(deliveryPreview.data.data?.singlePlayerCommands));

  const manifestCatalog = await request(
    '/admin/api/items/manifest-catalog?q=ak&category=weapons&limit=20',
    'GET',
    null,
    cookie,
  );
  assert.equal(manifestCatalog.res.status, 200);
  assert.equal(manifestCatalog.data.ok, true);
  assert.ok(Array.isArray(manifestCatalog.data.data.items));
  assert.equal(typeof manifestCatalog.data.data.meta.total, 'number');
  assert.equal(typeof manifestCatalog.data.data.meta.commandTemplate, 'string');

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

  const walletAdd = await request('/admin/api/wallet/add', 'POST', {
    userId: probeUserId,
    amount: 44,
  }, cookie);
  assert.equal(walletAdd.res.status, 200);
  assert.equal(walletAdd.data.ok, true);
  assert.equal(Number(walletAdd.data.data?.balance || 0), 123500);

  const walletRemove = await request('/admin/api/wallet/remove', 'POST', {
    userId: probeUserId,
    amount: 500,
  }, cookie);
  assert.equal(walletRemove.res.status, 200);
  assert.equal(walletRemove.data.ok, true);
  assert.equal(Number(walletRemove.data.data?.balance || 0), 123000);

  const pagedUserId = '999999999999999992';
  await request('/admin/api/wallet/set', 'POST', {
    userId: pagedUserId,
    balance: 500,
  }, cookie);
  await request('/admin/api/wallet/add', 'POST', {
    userId: pagedUserId,
    amount: 50,
  }, cookie);
  await request('/admin/api/wallet/remove', 'POST', {
    userId: pagedUserId,
    amount: 25,
  }, cookie);
  const auditDate = new Date();
  const auditDateLabel = [
    auditDate.getFullYear(),
    String(auditDate.getMonth() + 1).padStart(2, '0'),
    String(auditDate.getDate()).padStart(2, '0'),
  ].join('-');

  const auditWallet = await request(
    `/admin/api/audit/query?view=wallet&userId=${encodeURIComponent(probeUserId)}&reason=admin_wallet_remove&actor=${encodeURIComponent('admin-web:admin_test')}&dateFrom=${encodeURIComponent(auditDateLabel)}&dateTo=${encodeURIComponent(auditDateLabel)}&windowMs=all&limit=50`,
    'GET',
    null,
    cookie,
  );
  assert.equal(auditWallet.res.status, 200);
  assert.equal(auditWallet.data.ok, true);
  assert.equal(String(auditWallet.data.data?.view || ''), 'wallet');
  assert.ok(Array.isArray(auditWallet.data.data?.rows));
  assert.ok(
    auditWallet.data.data.rows.some((row) => String(row?.userId || '') === probeUserId),
  );
  assert.equal(String(auditWallet.data.data?.filters?.actor || ''), 'admin-web:admin_test');
  assert.equal(String(auditWallet.data.data?.filters?.actorMode || ''), 'contains');
  assert.match(String(auditWallet.data.data?.filters?.dateFrom || ''), /^20\d{2}-\d{2}-\d{2}T/);

  const auditWalletExact = await request(
    `/admin/api/audit/query?view=wallet&userId=${encodeURIComponent(probeUserId)}&actor=${encodeURIComponent('admin-web:admin_test')}&actorMode=exact&windowMs=all&page=1&pageSize=20`,
    'GET',
    null,
    cookie,
  );
  assert.equal(auditWalletExact.res.status, 200);
  assert.equal(auditWalletExact.data.ok, true);
  assert.equal(String(auditWalletExact.data.data?.filters?.actorMode || ''), 'exact');
  assert.ok(
    auditWalletExact.data.data.rows.every(
      (row) => String(row?.actor || '') === 'admin-web:admin_test',
    ),
  );

  const auditWalletPaged = await request(
    `/admin/api/audit/query?view=wallet&userId=${encodeURIComponent(pagedUserId)}&windowMs=all&page=2&pageSize=1`,
    'GET',
    null,
    cookie,
  );
  assert.equal(auditWalletPaged.res.status, 200);
  assert.equal(auditWalletPaged.data.ok, true);
  assert.ok(Number(auditWalletPaged.data.data?.total || 0) >= 3);
  assert.equal(Number(auditWalletPaged.data.data?.page || 0), 2);
  assert.equal(Number(auditWalletPaged.data.data?.pageSize || 0), 1);
  assert.ok(Number(auditWalletPaged.data.data?.totalPages || 0) >= 3);
  assert.equal(Number(auditWalletPaged.data.data?.returned || 0), 1);
  assert.equal(Boolean(auditWalletPaged.data.data?.hasPrev), true);
  assert.equal(Boolean(auditWalletPaged.data.data?.hasNext), true);
  assert.equal(String(auditWalletPaged.data.data?.paginationMode || ''), 'page');

  const auditWalletSorted = await request(
    `/admin/api/audit/query?view=wallet&userId=${encodeURIComponent(pagedUserId)}&windowMs=all&sortBy=delta&sortOrder=asc&page=1&pageSize=2`,
    'GET',
    null,
    cookie,
  );
  assert.equal(auditWalletSorted.res.status, 200);
  assert.equal(auditWalletSorted.data.ok, true);
  assert.equal(String(auditWalletSorted.data.data?.filters?.sortBy || ''), 'delta');
  assert.equal(String(auditWalletSorted.data.data?.filters?.sortOrder || ''), 'asc');
  assert.ok(String(auditWalletSorted.data.data?.nextCursor || '').length > 0);

  const firstSortedDelta = Number(auditWalletSorted.data.data?.rows?.[0]?.delta || 0);
  const cursorToken = String(auditWalletSorted.data.data?.nextCursor || '');
  const auditWalletCursor = await request(
    `/admin/api/audit/query?view=wallet&userId=${encodeURIComponent(pagedUserId)}&windowMs=all&sortBy=delta&sortOrder=asc&cursor=${encodeURIComponent(cursorToken)}&pageSize=2`,
    'GET',
    null,
    cookie,
  );
  assert.equal(auditWalletCursor.res.status, 200);
  assert.equal(auditWalletCursor.data.ok, true);
  assert.equal(String(auditWalletCursor.data.data?.paginationMode || ''), 'cursor');
  assert.equal(String(auditWalletCursor.data.data?.cursor || '').length > 0, true);
  assert.equal(String(auditWalletCursor.data.data?.prevCursor || '').length > 0, true);
  assert.ok(
    Number(auditWalletCursor.data.data?.rows?.[0]?.delta || 0) >= firstSortedDelta,
  );

  const auditCsv = await fetch(
    `${baseUrl}/admin/api/audit/export?view=wallet&userId=${encodeURIComponent(probeUserId)}&actor=${encodeURIComponent('admin-web:admin_test')}&windowMs=all&format=csv`,
    {
      headers: { cookie },
    },
  );
  const auditCsvText = await auditCsv.text();
  assert.equal(auditCsv.status, 200);
  assert.match(String(auditCsv.headers.get('content-disposition') || ''), /audit-wallet-/i);
  assert.match(auditCsvText, /เหตุผล|reason/i);

  const snapshotExport = await fetch(`${baseUrl}/admin/api/snapshot/export`, {
    headers: { cookie },
  });
  const snapshotExportText = await snapshotExport.text();
  assert.equal(snapshotExport.status, 200);
  assert.match(String(snapshotExport.headers.get('content-disposition') || ''), /snapshot-/i);
  assert.match(snapshotExportText, /\"wallets\"/);

  const vipSet = await request('/admin/api/vip/set', 'POST', {
    userId: probeUserId,
    planId: 'vip-7d',
    durationDays: 14,
  }, cookie);
  assert.equal(vipSet.res.status, 200);
  assert.equal(vipSet.data.ok, true);
  assert.equal(String(vipSet.data.data?.planId || ''), 'vip-7d');

  const snapshotAfterVipSet = await request('/admin/api/snapshot', 'GET', null, cookie);
  assert.equal(snapshotAfterVipSet.res.status, 200);
  const membershipAfterSet = (snapshotAfterVipSet.data?.data?.memberships || []).find(
    (row) => String(row?.userId || '') === probeUserId,
  );
  assert.equal(String(membershipAfterSet?.planId || ''), 'vip-7d');

  const vipRemove = await request('/admin/api/vip/remove', 'POST', {
    userId: probeUserId,
  }, cookie);
  assert.equal(vipRemove.res.status, 200);
  assert.equal(vipRemove.data.ok, true);

  const snapshotAfterVipRemove = await request('/admin/api/snapshot', 'GET', null, cookie);
  assert.equal(snapshotAfterVipRemove.res.status, 200);
  const membershipAfterRemove = (snapshotAfterVipRemove.data?.data?.memberships || []).find(
    (row) => String(row?.userId || '') === probeUserId,
  );
  assert.equal(membershipAfterRemove, undefined);

  const bountyCreate = await request('/admin/api/bounty/create', 'POST', {
    targetName: 'TargetFromAdminApi',
    amount: 777,
    createdBy: probeUserId,
  }, cookie);
  assert.equal(bountyCreate.res.status, 200);
  assert.equal(bountyCreate.data.ok, true);
  const bountyId = Number(bountyCreate.data.data?.id || 0);
  assert.ok(bountyId > 0);

  const bountyCancel = await request('/admin/api/bounty/cancel', 'POST', {
    id: bountyId,
  }, cookie);
  assert.equal(bountyCancel.res.status, 200);
  assert.equal(bountyCancel.data.ok, true);
  assert.equal(String(bountyCancel.data.data?.status || ''), 'cancelled');

  const redeemAdd = await request('/admin/api/redeem/add', 'POST', {
    code: 'ADMIN-API-TEST',
    type: 'coins',
    amount: 250,
  }, cookie);
  assert.equal(redeemAdd.res.status, 200);
  assert.equal(redeemAdd.data.ok, true);

  const redeemReset = await request('/admin/api/redeem/reset-usage', 'POST', {
    code: 'ADMIN-API-TEST',
  }, cookie);
  assert.equal(redeemReset.res.status, 200);
  assert.equal(redeemReset.data.ok, true);

  const redeemDelete = await request('/admin/api/redeem/delete', 'POST', {
    code: 'ADMIN-API-TEST',
  }, cookie);
  assert.equal(redeemDelete.res.status, 200);
  assert.equal(redeemDelete.data.ok, true);

  const eventCreate = await request('/admin/api/event/create', 'POST', {
    name: 'Admin API Audit Event',
    time: new Date().toISOString(),
    reward: '500 coins',
  }, cookie);
  assert.equal(eventCreate.res.status, 200);
  assert.equal(eventCreate.data.ok, true);
  const auditEventId = Number(eventCreate.data.data?.id || 0);
  const auditEventStatus = String(eventCreate.data.data?.status || '').trim();
  assert.ok(auditEventId > 0);

  const auditEvent = await request(
    `/admin/api/audit/query?view=event&reference=${encodeURIComponent(String(auditEventId))}&dateFrom=${encodeURIComponent(auditDateLabel)}&dateTo=${encodeURIComponent(auditDateLabel)}&windowMs=all&limit=20`,
    'GET',
    null,
    cookie,
  );
  assert.equal(auditEvent.res.status, 200);
  assert.equal(auditEvent.data.ok, true);
  assert.equal(String(auditEvent.data.data?.view || ''), 'event');
  assert.ok(Number(auditEvent.data.data?.total || 0) >= 1);
  assert.equal(String(auditEvent.data.data?.filters?.reference || ''), String(auditEventId));

  const auditEventExact = await request(
    `/admin/api/audit/query?view=event&reference=${encodeURIComponent(String(auditEventId))}&referenceMode=exact&status=${encodeURIComponent(auditEventStatus)}&statusMode=exact&windowMs=all&page=1&pageSize=10`,
    'GET',
    null,
    cookie,
  );
  assert.equal(auditEventExact.res.status, 200);
  assert.equal(auditEventExact.data.ok, true);
  assert.ok(
    auditEventExact.data.data.rows.some((row) => Number(row?.id || 0) === auditEventId),
  );
  assert.equal(String(auditEventExact.data.data?.filters?.referenceMode || ''), 'exact');
  assert.equal(String(auditEventExact.data.data?.filters?.statusMode || ''), 'exact');

  const welcomeUserA = '888888888888888881';
  const welcomeUserB = '888888888888888882';
  const welcomeClaimA = await claimWelcomePackForUser({
    userId: welcomeUserA,
    amount: 100,
    actor: 'test-suite',
    source: 'admin-api-test',
  });
  const welcomeClaimB = await claimWelcomePackForUser({
    userId: welcomeUserB,
    amount: 100,
    actor: 'test-suite',
    source: 'admin-api-test',
  });
  assert.equal(welcomeClaimA.ok, true);
  assert.equal(welcomeClaimB.ok, true);

  const welcomeRevoke = await request('/admin/api/welcome/revoke', 'POST', {
    userId: welcomeUserA,
  }, cookie);
  assert.equal(welcomeRevoke.res.status, 200);
  assert.equal(welcomeRevoke.data.ok, true);

  const welcomeClear = await request('/admin/api/welcome/clear', 'POST', {}, cookie);
  assert.equal(welcomeClear.res.status, 200);
  assert.equal(welcomeClear.data.ok, true);
  assert.ok(Number(welcomeClear.data?.data?.clearedCount || 0) >= 1);

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
  assert.equal(String(restoreDryRun.data.data.confirmBackup || ''), backupFile);
  assert.equal(typeof restoreDryRun.data.data?.diff?.summary?.changedCollections, 'number');

  const restoreStatusBefore = await request('/admin/api/backup/restore/status', 'GET', null, cookie);
  assert.equal(restoreStatusBefore.res.status, 200);
  assert.equal(restoreStatusBefore.data.ok, true);
  assert.equal(typeof restoreStatusBefore.data.data?.status, 'string');

  const restoreWithoutConfirm = await request('/admin/api/backup/restore', 'POST', {
    backup: backupFile,
    dryRun: false,
  }, cookie);
  assert.equal(restoreWithoutConfirm.res.status, 400);
  assert.equal(restoreWithoutConfirm.data.ok, false);
  assert.match(String(restoreWithoutConfirm.data.error || ''), /confirmBackup/i);

  const restoreLive = await request('/admin/api/backup/restore', 'POST', {
    backup: backupFile,
    dryRun: false,
    confirmBackup: backupFile,
  }, cookie);
  assert.equal(restoreLive.res.status, 200);
  assert.equal(restoreLive.data.ok, true);
  assert.equal(restoreLive.data.data.restored, true);
  assert.ok(String(restoreLive.data.data.rollbackBackup || '').endsWith('.json'));

  const snapshotAfterRestore = await request('/admin/api/snapshot', 'GET', null, cookie);
  assert.equal(snapshotAfterRestore.res.status, 200);
  const walletAfterRestore = (snapshotAfterRestore.data?.data?.wallets || []).find(
    (row) => String(row?.userId || '') === probeUserId,
  );
  assert.equal(Number(walletAfterRestore?.balance || 0), 123000);

  const restoreStatusAfter = await request('/admin/api/backup/restore/status', 'GET', null, cookie);
  assert.equal(restoreStatusAfter.res.status, 200);
  assert.equal(restoreStatusAfter.data.ok, true);
  assert.equal(restoreStatusAfter.data.data.status, 'succeeded');
  assert.equal(restoreStatusAfter.data.data.active, false);
  assert.equal(String(restoreStatusAfter.data.data.backup || ''), backupFile);
  assert.ok(String(restoreStatusAfter.data.data.rollbackBackup || '').endsWith('.json'));

  const presetDelete = await request('/admin/api/audit/presets/delete', 'POST', {
    id: presetId,
  }, cookie);
  assert.equal(presetDelete.res.status, 200);
  assert.equal(presetDelete.data.ok, true);

  const presetListAfterDelete = await request('/admin/api/audit/presets', 'GET', null, cookie);
  assert.equal(presetListAfterDelete.res.status, 200);
  assert.equal(presetListAfterDelete.data.ok, true);
  assert.equal(
    presetListAfterDelete.data.data.some((row) => String(row?.id || '') === presetId),
    false,
  );
});

test('admin platform APIs expose overview data while snapshot stays sanitized', async (t) => {
  resetAdminIntegrationRuntimeState();
  const port = randomPort(39050, 600);
  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_WEB_USER = 'admin_platform_test';
  process.env.ADMIN_WEB_PASSWORD = 'pass_platform_test';
  process.env.ADMIN_WEB_TOKEN = 'token_platform_test';
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

  const nowSeed = Date.now();
  const tenantId = `tenant-platform-${nowSeed}`;
  const subscriptionId = `sub-platform-${nowSeed}`;
  const licenseId = `license-platform-${nowSeed}`;
  const apiKeyId = `apikey-platform-${nowSeed}`;
  const webhookId = `hook-platform-${nowSeed}`;
  const offerId = `offer-platform-${nowSeed}`;
  const webhookSecret = 'platform-secret-1234567890';

  updatePlatformOpsState({
    lastMonitoringAt: '2026-03-15T10:00:00.000Z',
    lastAutoBackupAt: '2026-03-15T09:00:00.000Z',
    lastReconcileAt: '2026-03-15T08:00:00.000Z',
    lastAlertAtByKey: {
      'platform-seed-alert': '2026-03-15T07:00:00.000Z',
    },
  });

  const { startAdminWebServer } = freshAdminWebServerModule();
  const server = startAdminWebServer(fakeClient);
  if (!server.listening) {
    await once(server, 'listening');
  }

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await prisma.platformWebhookEndpoint.deleteMany({ where: { id: webhookId } }).catch(() => null);
    await prisma.platformApiKey.deleteMany({ where: { id: apiKeyId } }).catch(() => null);
    await prisma.platformMarketplaceOffer.deleteMany({ where: { id: offerId } }).catch(() => null);
    await prisma.platformLicense.deleteMany({ where: { id: licenseId } }).catch(() => null);
    await prisma.platformSubscription.deleteMany({ where: { id: subscriptionId } }).catch(() => null);
    await prisma.platformTenant.deleteMany({ where: { id: tenantId } }).catch(() => null);
    resetAdminIntegrationRuntimeState();
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

  const login = await request('/admin/api/login', 'POST', {
    username: 'admin_platform_test',
    password: 'pass_platform_test',
  });
  assert.equal(login.res.status, 200);
  const cookie = String(login.res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'expected cookie after platform login');

  const tenantRes = await request('/admin/api/platform/tenant', 'POST', {
    id: tenantId,
    name: 'Platform Integration Tenant',
    slug: tenantId,
    type: 'trial',
    status: 'active',
    locale: 'th',
    ownerEmail: 'tenant@example.com',
  }, cookie);
  assert.equal(tenantRes.res.status, 200);
  assert.equal(tenantRes.data.ok, true);

  const subscriptionRes = await request('/admin/api/platform/subscription', 'POST', {
    id: subscriptionId,
    tenantId,
    planId: 'starter',
    status: 'active',
    billingCycle: 'monthly',
    amountCents: 9900,
    currency: 'THB',
  }, cookie);
  assert.equal(subscriptionRes.res.status, 200);
  assert.equal(subscriptionRes.data.ok, true);

  const licenseRes = await request('/admin/api/platform/license', 'POST', {
    id: licenseId,
    tenantId,
    status: 'active',
    seats: 3,
    legalDocVersion: '2026.03',
  }, cookie);
  assert.equal(licenseRes.res.status, 200);
  assert.equal(licenseRes.data.ok, true);
  const rawLicenseKey = String(licenseRes.data.data?.licenseKey || '');
  assert.ok(rawLicenseKey.length >= 8);

  const licenseAcceptRes = await request('/admin/api/platform/license/accept-legal', 'POST', {
    licenseId,
    legalDocVersion: '2026.03',
  }, cookie);
  assert.equal(licenseAcceptRes.res.status, 200);
  assert.equal(licenseAcceptRes.data.ok, true);

  const apiKeyRes = await request('/admin/api/platform/apikey', 'POST', {
    id: apiKeyId,
    tenantId,
    name: 'Integration API Key',
    scopes: ['tenant:read', 'analytics:read', 'delivery:reconcile'],
  }, cookie);
  assert.equal(apiKeyRes.res.status, 200);
  assert.equal(apiKeyRes.data.ok, true);
  assert.equal(String(apiKeyRes.data.data?.apiKey?.id || ''), apiKeyId);
  assert.match(String(apiKeyRes.data.data?.rawKey || ''), /^sk_/);

  const webhookRes = await request('/admin/api/platform/webhook', 'POST', {
    id: webhookId,
    tenantId,
    name: 'Integration Webhook',
    eventType: '*',
    targetUrl: 'https://example.com/platform-webhook',
    secretValue: webhookSecret,
  }, cookie);
  assert.equal(webhookRes.res.status, 200);
  assert.equal(webhookRes.data.ok, true);
  assert.equal(String(webhookRes.data.data?.id || ''), webhookId);
  assert.equal(String(webhookRes.data.data?.secretValue || ''), webhookSecret);

  const offerRes = await request('/admin/api/platform/marketplace', 'POST', {
    id: offerId,
    tenantId,
    title: 'Full Platform Package',
    kind: 'package',
    status: 'active',
    priceCents: 19900,
    currency: 'THB',
    locale: 'th',
  }, cookie);
  assert.equal(offerRes.res.status, 200);
  assert.equal(offerRes.data.ok, true);

  const overviewRes = await request('/admin/api/platform/overview', 'GET', null, cookie);
  assert.equal(overviewRes.res.status, 200);
  assert.equal(overviewRes.data.ok, true);
  assert.equal(typeof overviewRes.data.data?.analytics?.subscriptions?.mrrCents, 'number');
  assert.ok(Array.isArray(overviewRes.data.data?.permissionCatalog));
  assert.ok(Array.isArray(overviewRes.data.data?.plans));
  assert.equal(String(overviewRes.data.data?.opsState?.lastMonitoringAt || '').length > 0, true);
  assert.equal(
    Object.keys(overviewRes.data.data?.opsState?.lastAlertAtByKey || {}).length >= 1,
    true,
  );

  const opsStateRes = await request('/admin/api/platform/ops-state', 'GET', null, cookie);
  assert.equal(opsStateRes.res.status, 200);
  assert.equal(opsStateRes.data.ok, true);
  assert.equal(String(opsStateRes.data.data?.lastAutoBackupAt || '').length > 0, true);

  const reconcileRes = await request('/admin/api/platform/reconcile', 'GET', null, cookie);
  assert.equal(reconcileRes.res.status, 200);
  assert.equal(reconcileRes.data.ok, true);
  assert.equal(typeof reconcileRes.data.data?.summary?.anomalies, 'number');

  const monitoringRes = await request('/admin/api/platform/monitoring/run', 'POST', {}, cookie);
  assert.equal(monitoringRes.res.status, 200);
  assert.equal(monitoringRes.data.ok, true);
  assert.equal(typeof monitoringRes.data.data?.generatedAt, 'string');

  const snapshotRes = await request('/admin/api/snapshot', 'GET', null, cookie);
  assert.equal(snapshotRes.res.status, 200);
  assert.equal(snapshotRes.data.ok, true);
  assert.equal(String(snapshotRes.data.data?.platformOpsState?.lastMonitoringAt || '').length > 0, true);

  const snapshotLicense = (snapshotRes.data.data?.platformLicenses || []).find(
    (row) => String(row?.id || '') === licenseId,
  );
  assert.ok(snapshotLicense, 'expected platform license in snapshot');
  assert.notEqual(String(snapshotLicense.licenseKey || ''), rawLicenseKey);
  assert.match(String(snapshotLicense.licenseKey || ''), /\*{2,}/);

  const snapshotApiKey = (snapshotRes.data.data?.platformApiKeys || []).find(
    (row) => String(row?.id || '') === apiKeyId,
  );
  assert.ok(snapshotApiKey, 'expected platform api key in snapshot');
  assert.equal('keyHash' in snapshotApiKey, false);
  assert.equal('rawKey' in snapshotApiKey, false);
  assert.deepEqual(snapshotApiKey.scopes, ['tenant:read', 'analytics:read', 'delivery:reconcile']);

  const snapshotWebhook = (snapshotRes.data.data?.platformWebhookEndpoints || []).find(
    (row) => String(row?.id || '') === webhookId,
  );
  assert.ok(snapshotWebhook, 'expected platform webhook in snapshot');
  assert.notEqual(String(snapshotWebhook.secretValue || ''), webhookSecret);
  assert.match(String(snapshotWebhook.secretValue || ''), /\*{2,}/);
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

test('admin API blocks mutating writes while backup restore maintenance is active', async (t) => {
  const port = randomPort(39900, 700);
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

  setAdminRestoreState({
    status: 'running',
    active: true,
    maintenance: true,
    backup: 'backup-maintenance.json',
    confirmBackup: 'backup-maintenance.json',
    rollbackBackup: 'backup-rollback.json',
    actor: 'test-suite',
    role: 'owner',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const { startAdminWebServer } = freshAdminWebServerModule();
  const server = startAdminWebServer(fakeClient);
  if (!server.listening) {
    await once(server, 'listening');
  }

  t.after(async () => {
    setAdminRestoreState({
      status: 'idle',
      active: false,
      maintenance: false,
      backup: null,
      confirmBackup: null,
      rollbackBackup: null,
      actor: null,
      role: null,
      startedAt: null,
      endedAt: null,
      updatedAt: new Date().toISOString(),
      lastCompletedAt: null,
      durationMs: null,
      lastError: null,
      rollbackStatus: 'none',
      rollbackError: null,
      counts: null,
      currentCounts: null,
      diff: null,
      warnings: [],
    });
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

  const login = await request('/admin/api/login', 'POST', {
    username: 'admin_test',
    password: 'pass_test',
  });
  assert.equal(login.res.status, 200);
  const cookie = String(login.res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie);

  const blockedWallet = await request('/admin/api/wallet/set', 'POST', {
    userId: 'restore-maint-user',
    balance: 99,
  }, cookie);
  assert.equal(blockedWallet.res.status, 503);
  assert.equal(blockedWallet.data.ok, false);
  assert.match(String(blockedWallet.data.error || ''), /restore/i);
  assert.equal(blockedWallet.data.data?.restore?.status, 'running');

  const restoreStatus = await request('/admin/api/backup/restore/status', 'GET', null, cookie);
  assert.equal(restoreStatus.res.status, 200);
  assert.equal(restoreStatus.data.ok, true);
  assert.equal(restoreStatus.data.data.status, 'running');
});

test('admin API delivery detail + test send routes work with local console agent', async (t) => {
  const port = randomPort(38900, 700);
  const agentPort = randomPort(39700, 700);
  const envKeys = [
    'ADMIN_WEB_HOST',
    'ADMIN_WEB_PORT',
    'ADMIN_WEB_USER',
    'ADMIN_WEB_PASSWORD',
    'ADMIN_WEB_TOKEN',
    'ADMIN_WEB_USERS_JSON',
    'ADMIN_WEB_2FA_ENABLED',
    'DELIVERY_EXECUTION_MODE',
    'SCUM_CONSOLE_AGENT_HOST',
    'SCUM_CONSOLE_AGENT_PORT',
    'SCUM_CONSOLE_AGENT_BASE_URL',
    'SCUM_CONSOLE_AGENT_TOKEN',
    'SCUM_CONSOLE_AGENT_BACKEND',
    'SCUM_CONSOLE_AGENT_EXEC_TEMPLATE',
    'WORKER_ENABLE_DELIVERY',
    'BOT_ENABLE_DELIVERY_WORKER',
  ];
  const savedEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );

  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_WEB_USER = 'admin_delivery_test';
  process.env.ADMIN_WEB_PASSWORD = 'pass_delivery_test';
  process.env.ADMIN_WEB_TOKEN = 'token_delivery_test';
  process.env.ADMIN_WEB_USERS_JSON = '';
  process.env.ADMIN_WEB_2FA_ENABLED = 'false';
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_HOST = '127.0.0.1';
  process.env.SCUM_CONSOLE_AGENT_PORT = String(agentPort);
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = `http://127.0.0.1:${agentPort}`;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-delivery-test';
  process.env.SCUM_CONSOLE_AGENT_BACKEND = 'exec';
  process.env.SCUM_CONSOLE_AGENT_EXEC_TEMPLATE = `node "${path.join(
    process.cwd(),
    'scripts',
    'agent-echo.js',
  )}" "{command}"`;
  process.env.WORKER_ENABLE_DELIVERY = 'false';
  process.env.BOT_ENABLE_DELIVERY_WORKER = 'false';

  const runtime = startScumConsoleAgent({
    env: {
      SCUM_CONSOLE_AGENT_HOST: '127.0.0.1',
      SCUM_CONSOLE_AGENT_PORT: String(agentPort),
      SCUM_CONSOLE_AGENT_TOKEN: 'agent-token-delivery-test',
      SCUM_CONSOLE_AGENT_BACKEND: 'exec',
      SCUM_CONSOLE_AGENT_EXEC_TEMPLATE: `node "${path.join(
        process.cwd(),
        'scripts',
        'agent-echo.js',
      )}" "{command}"`,
    },
  });
  await runtime.ready;

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
    await runtime.close();
    delete require.cache[adminWebServerPath];
    for (const key of envKeys) {
      if (savedEnv[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
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

  const login = await request('/admin/api/login', 'POST', {
    username: 'admin_delivery_test',
    password: 'pass_delivery_test',
  });
  assert.equal(login.res.status, 200);
  const cookie = String(login.res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'expected cookie after delivery test login');

  const testSend = await request('/admin/api/delivery/test-send', 'POST', {
    gameItemId: 'Weapon_M1911',
    quantity: 1,
    purchaseCode: 'ADMIN-TEST-SEND-001',
  }, cookie);
  assert.equal(testSend.res.status, 200);
  assert.equal(testSend.data.ok, true);
  assert.equal(String(testSend.data.data?.gameItemId || ''), 'Weapon_M1911');
  assert.ok(Array.isArray(testSend.data.data?.outputs));
  assert.match(String(testSend.data.data?.outputs?.[0]?.stdout || ''), /AGENT-ECHO:/);

  const runtimeStatus = await request('/admin/api/delivery/runtime', 'GET', null, cookie);
  assert.equal(runtimeStatus.res.status, 200);
  assert.equal(runtimeStatus.data.ok, true);
  assert.equal(String(runtimeStatus.data.data?.executionMode || ''), 'agent');
  assert.equal(Boolean(runtimeStatus.data.data?.readiness?.ready), true);
  assert.equal(Boolean(runtimeStatus.data.data?.agent?.preflight?.ok), true);
  assert.ok(Array.isArray(runtimeStatus.data.data?.preflightSummary?.checks));

  const preflightStatus = await request('/admin/api/delivery/preflight', 'POST', {
    gameItemId: 'Weapon_M1911',
    steamId: '76561198000000000',
  }, cookie);
  assert.equal(preflightStatus.res.status, 200);
  assert.equal(preflightStatus.data.ok, true);
  assert.equal(Boolean(preflightStatus.data.data?.ready), true);
  assert.ok(Array.isArray(preflightStatus.data.data?.checks));

  const simulateStatus = await request('/admin/api/delivery/simulate', 'POST', {
    gameItemId: 'Weapon_M1911',
    quantity: 2,
    steamId: '76561198000000000',
  }, cookie);
  assert.equal(simulateStatus.res.status, 200);
  assert.equal(simulateStatus.data.ok, true);
  assert.equal(Boolean(simulateStatus.data.data?.ready), true);
  assert.ok(Array.isArray(simulateStatus.data.data?.timeline));
  assert.ok(Array.isArray(simulateStatus.data.data?.steps));

  const capabilities = await request('/admin/api/delivery/capabilities', 'GET', null, cookie);
  assert.equal(capabilities.res.status, 200);
  assert.equal(capabilities.data.ok, true);
  assert.ok(Array.isArray(capabilities.data.data?.builtin));
  assert.ok(Array.isArray(capabilities.data.data?.presets));
  assert.ok(
    capabilities.data.data.builtin.some(
      (entry) => String(entry?.id || '') === 'announce-teleport-spawn',
    ),
  );

  const capabilityPresetId = `ADMIN_CAPABILITY_PRESET_${Date.now()}`;
  const capabilityPresetSave = await request('/admin/api/delivery/capability-preset', 'POST', {
    id: capabilityPresetId,
    name: 'Admin API Capability Preset',
    description: 'integration preset',
    commands: [
      '#Announce {announceText}',
      '#SpawnItem {steamId} {gameItemId} {quantity}',
    ],
    announceText: 'API DELIVERY TEST',
    steamId: '76561198000000000',
    gameItemId: 'Weapon_M1911',
    quantity: 1,
    tags: ['integration', 'delivery'],
  }, cookie);
  assert.equal(capabilityPresetSave.res.status, 200);
  assert.equal(capabilityPresetSave.data.ok, true);
  assert.equal(String(capabilityPresetSave.data.data?.id || ''), capabilityPresetId);
  assert.deepEqual(capabilityPresetSave.data.data?.commandTemplates, [
    '#Announce {announceText}',
    '#SpawnItem {steamId} {gameItemId} {quantity}',
  ]);

  const capabilitiesAfterSave = await request('/admin/api/delivery/capabilities', 'GET', null, cookie);
  assert.equal(capabilitiesAfterSave.res.status, 200);
  assert.equal(capabilitiesAfterSave.data.ok, true);
  assert.ok(
    capabilitiesAfterSave.data.data.presets.some(
      (entry) => String(entry?.id || '') === capabilityPresetId,
    ),
  );

  const capabilityDryRun = await request('/admin/api/delivery/capability-test', 'POST', {
    capabilityId: 'announce-teleport-spawn',
    dryRun: true,
  }, cookie);
  assert.equal(capabilityDryRun.res.status, 200);
  assert.equal(capabilityDryRun.data.ok, true);
  assert.equal(Boolean(capabilityDryRun.data.data?.ready), true);
  assert.equal(Boolean(capabilityDryRun.data.data?.dryRun), true);
  assert.equal(String(capabilityDryRun.data.data?.summary?.source || ''), 'builtin');
  assert.ok(Array.isArray(capabilityDryRun.data.data?.renderedCommands));
  assert.ok(capabilityDryRun.data.data.renderedCommands.length >= 4);

  const capabilityPresetDryRun = await request('/admin/api/delivery/capability-test', 'POST', {
    presetId: capabilityPresetId,
    dryRun: true,
  }, cookie);
  assert.equal(capabilityPresetDryRun.res.status, 200);
  assert.equal(capabilityPresetDryRun.data.ok, true);
  assert.equal(Boolean(capabilityPresetDryRun.data.data?.ready), true);
  assert.equal(Boolean(capabilityPresetDryRun.data.data?.dryRun), true);
  assert.equal(String(capabilityPresetDryRun.data.data?.summary?.source || ''), 'preset');
  assert.deepEqual(capabilityPresetDryRun.data.data?.renderedCommands, [
    '#Announce API DELIVERY TEST',
    '#SpawnItem Weapon_M1911 1',
  ]);

  const capabilityPresetDelete = await request('/admin/api/delivery/capability-preset/delete', 'POST', {
    presetId: capabilityPresetId,
  }, cookie);
  assert.equal(capabilityPresetDelete.res.status, 200);
  assert.equal(capabilityPresetDelete.data.ok, true);
  assert.equal(String(capabilityPresetDelete.data.data?.id || ''), capabilityPresetId);

  const templateKey = `ADMIN_TEST_TEMPLATE_${Date.now()}`;
  const templateSet = await request('/admin/api/delivery/command-template', 'POST', {
    lookupKey: templateKey,
    commands: ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  }, cookie);
  assert.equal(templateSet.res.status, 200);
  assert.equal(templateSet.data.ok, true);
  assert.equal(String(templateSet.data.data?.lookupKey || ''), templateKey);
  assert.deepEqual(templateSet.data.data?.commandTemplates, [
    '#SpawnItem {steamId} {gameItemId} {quantity}',
  ]);

  const templateGet = await request(
    `/admin/api/delivery/command-template?lookupKey=${encodeURIComponent(templateKey)}`,
    'GET',
    null,
    cookie,
  );
  assert.equal(templateGet.res.status, 200);
  assert.equal(templateGet.data.ok, true);
  assert.equal(Boolean(templateGet.data.data?.exists), true);

  const commandTemplateNotifications = await request(
    `/admin/api/notifications?type=command-template&entityKey=${encodeURIComponent(templateKey)}`,
    'GET',
    null,
    cookie,
  );
  assert.equal(commandTemplateNotifications.res.status, 200);
  assert.equal(commandTemplateNotifications.data.ok, true);
  assert.ok(
    Array.isArray(commandTemplateNotifications.data.data?.items)
      && commandTemplateNotifications.data.data.items.some(
        (row) => String(row?.entityKey || '') === templateKey,
      ),
  );

  const notificationIds = (commandTemplateNotifications.data.data?.items || [])
    .map((row) => String(row?.id || '').trim())
    .filter(Boolean);
  assert.ok(notificationIds.length > 0, 'expected at least one notification id');

  const ackNotifications = await request('/admin/api/notifications/ack', 'POST', {
    ids: notificationIds,
  }, cookie);
  assert.equal(ackNotifications.res.status, 200);
  assert.equal(ackNotifications.data.ok, true);
  assert.equal(Number(ackNotifications.data.data?.updated || 0) >= 1, true);

  const clearNotifications = await request('/admin/api/notifications/clear', 'POST', {
    acknowledgedOnly: true,
  }, cookie);
  assert.equal(clearNotifications.res.status, 200);
  assert.equal(clearNotifications.data.ok, true);

  const templateDelete = await request('/admin/api/delivery/command-template', 'POST', {
    lookupKey: templateKey,
    clear: true,
  }, cookie);
  assert.equal(templateDelete.res.status, 200);
  assert.equal(templateDelete.data.ok, true);
  assert.equal(Boolean(templateDelete.data.data?.exists), false);

  const initialShopItems = await listShopItems();
  const detailShopItem = initialShopItems.find(
    (row) => String(row?.kind || 'item').trim().toLowerCase() === 'item',
  );
  assert.ok(detailShopItem, 'expected at least one item-kind shop item');
  const purchase = await createPurchase(
    'admin-delivery-detail-user',
    detailShopItem,
  );

  const detail = await request(
    `/admin/api/delivery/detail?code=${encodeURIComponent(purchase.code)}&limit=20`,
    'GET',
    null,
    cookie,
  );
  assert.equal(detail.res.status, 200);
  assert.equal(detail.data.ok, true);
  assert.equal(String(detail.data.data?.purchase?.code || ''), purchase.code);
  assert.ok(detail.data.data?.preview);
  assert.ok(Array.isArray(detail.data.data?.statusHistory));
  assert.ok(Array.isArray(detail.data.data?.stepLog));

  const queuedPurchase = await createPurchase(
    'admin-delivery-queue-user',
    detailShopItem,
  );
  const enqueueRes = await request('/admin/api/delivery/enqueue', 'POST', {
    code: queuedPurchase.code,
  }, cookie);
  assert.equal(enqueueRes.res.status, 200);
  assert.equal(enqueueRes.data.ok, true);

  const queueRes = await request(
    `/admin/api/delivery/queue?limit=20&q=${encodeURIComponent(queuedPurchase.code)}`,
    'GET',
    null,
    cookie,
  );
  assert.equal(queueRes.res.status, 200);
  assert.equal(queueRes.data.ok, true);
  assert.ok(
    queueRes.data.data.some(
      (row) => String(row?.purchaseCode || '') === queuedPurchase.code,
    ),
  );

  const retryManyRes = await request('/admin/api/delivery/retry-many', 'POST', {
    codes: [queuedPurchase.code],
  }, cookie);
  assert.equal(retryManyRes.res.status, 200);
  assert.equal(retryManyRes.data.ok, true);
  assert.equal(Number(retryManyRes.data.data?.total || 0), 1);
  assert.equal(Number(retryManyRes.data.data?.queued || 0), 1);

  const deadRetryManyRes = await request('/admin/api/delivery/dead-letter/retry-many', 'POST', {
    codes: ['missing-dead-letter-code'],
  }, cookie);
  assert.equal(deadRetryManyRes.res.status, 200);
  assert.equal(deadRetryManyRes.data.ok, true);
  assert.equal(Number(deadRetryManyRes.data.data?.total || 0), 1);
  assert.equal(Number(deadRetryManyRes.data.data?.queued || 0), 0);
});
