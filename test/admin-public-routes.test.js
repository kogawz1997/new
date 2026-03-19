const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAdminPublicRoutes,
} = require('../src/admin/api/adminPublicRoutes');

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(body = null) {
      this.ended = true;
      this.body = body;
    },
  };
}

function buildRoutes(overrides = {}) {
  return createAdminPublicRoutes({
    tryServeAdminStaticAsset: async () => false,
    tryServeStaticScumIcon: async () => false,
    sendJson(res, statusCode, payload) {
      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    },
    sendText(res, statusCode, text) {
      res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
    },
    sendHtml(res, statusCode, html) {
      res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    },
    isAuthorized: () => true,
    getAuthContext: () => ({ user: 'owner', role: 'owner', tenantId: null }),
    getLoginHtml: () => '<login/>',
    getOwnerConsoleHtml: () => '<owner/>',
    getTenantConsoleHtml: () => '<tenant/>',
    getDashboardHtml: () => '<legacy/>',
    getPersistenceStatus: () => ({ ok: true }),
    getDeliveryMetricsSnapshot: () => ({ ok: true }),
    ensurePlatformApiKey: async () => null,
    requiredString: (value) => String(value || '').trim(),
    readJsonBody: async () => ({}),
    getTenantQuotaSnapshot: async () => ({}),
    getPlatformPublicOverview: async () => ({}),
    getPlatformAnalyticsOverview: async () => ({}),
    recordPlatformAgentHeartbeat: async () => ({ ok: true }),
    reconcileDeliveryState: async () => ({}),
    dispatchPlatformWebhookEvent: async () => ([]),
    ssoDiscordActive: false,
    cleanupDiscordOauthStates: () => {},
    buildDiscordAuthorizeUrl: () => 'https://discord.com/oauth2/authorize',
    getDiscordRedirectUri: () => 'https://example.com/admin/auth/discord/callback',
    exchangeDiscordOauthCode: async () => ({}),
    fetchDiscordProfile: async () => ({}),
    fetchDiscordGuildMember: async () => ({}),
    listDiscordGuildRolesFromClient: async () => ([]),
    resolveMappedMemberRole: () => 'mod',
    getAdminSsoRoleMappingSummary: () => ({}),
    ssoDiscordGuildId: '',
    ssoDiscordDefaultRole: 'mod',
    setDiscordOauthState: () => {},
    hasDiscordOauthState: () => true,
    deleteDiscordOauthState: () => {},
    getClientIp: () => '127.0.0.1',
    recordAdminSecuritySignal: () => {},
    createSession: () => ({ id: 'session-id' }),
    buildSessionCookie: () => 'session-id',
    ...overrides,
  });
}

test('admin public routes redirect global admins from /admin to /owner', async () => {
  const handler = buildRoutes({
    getAuthContext: () => ({ user: 'owner', role: 'owner', tenantId: null }),
  });
  const res = createMockRes();

  const handled = await handler({
    client: null,
    req: { method: 'GET', headers: {} },
    res,
    urlObj: new URL('https://admin.example.com/admin'),
    pathname: '/admin',
    host: 'admin.example.com',
    port: 3200,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/owner');
});

test('admin public routes redirect tenant-scoped admins from /admin to /tenant', async () => {
  const handler = buildRoutes({
    getAuthContext: () => ({ user: 'tenant-admin', role: 'admin', tenantId: 'tenant-1' }),
  });
  const res = createMockRes();

  const handled = await handler({
    client: null,
    req: { method: 'GET', headers: {} },
    res,
    urlObj: new URL('https://admin.example.com/admin'),
    pathname: '/admin',
    host: 'admin.example.com',
    port: 3200,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/tenant');
});

test('admin public routes block tenant-scoped admins from owner console page', async () => {
  const handler = buildRoutes({
    getAuthContext: () => ({ user: 'tenant-admin', role: 'admin', tenantId: 'tenant-1' }),
  });
  const res = createMockRes();

  const handled = await handler({
    client: null,
    req: { method: 'GET', headers: {} },
    res,
    urlObj: new URL('https://admin.example.com/owner'),
    pathname: '/owner',
    host: 'admin.example.com',
    port: 3200,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/tenant');
});

test('admin public routes serve tenant console html for tenant-scoped admins', async () => {
  const handler = buildRoutes({
    getAuthContext: () => ({ user: 'tenant-admin', role: 'admin', tenantId: 'tenant-1' }),
  });
  const res = createMockRes();

  const handled = await handler({
    client: null,
    req: { method: 'GET', headers: {} },
    res,
    urlObj: new URL('https://admin.example.com/tenant'),
    pathname: '/tenant',
    host: 'admin.example.com',
    port: 3200,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '<tenant/>');
});
