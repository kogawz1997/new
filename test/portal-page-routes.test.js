const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPortalPageRoutes,
} = require('../apps/web-portal-standalone/runtime/portalPageRoutes');

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    ended: false,
    body: null,
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
  return createPortalPageRoutes({
    allowCaptureAuth: false,
    captureAuthToken: '',
    createCaptureSession: () => 'capture-session-id',
    buildSessionCookie: () => 'scum_portal_session=capture-session-id; Path=/; HttpOnly',
    tryServePortalStaticAsset: async () => false,
    tryServeStaticScumIcon: async () => false,
    buildLegacyAdminUrl: (pathname) => `https://admin.example.com${pathname}`,
    getCanonicalRedirectUrl: () => null,
    sendJson: (res, statusCode, payload) => {
      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    },
    sendHtml: (res, statusCode, html) => {
      res.writeHead(statusCode, { 'content-type': 'text/html' });
      res.end(html);
    },
    sendFavicon: (res) => {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg/>');
    },
    buildHealthPayload: () => ({ ok: true, data: { status: 'ready' } }),
    tryServePublicDoc: () => false,
    getLandingHtml: () => '<landing/>',
    getShowcaseHtml: () => '<showcase/>',
    getTrialHtml: () => '<trial/>',
    getPlayerHtml: () => '<player/>',
    getLegacyPlayerHtml: () => '<legacy-player/>',
    getPlatformPublicOverview: async () => ({ tenantCount: 1 }),
    isDiscordStartPath: (pathname) => pathname === '/auth/discord/start',
    isDiscordCallbackPath: (pathname) => pathname === '/auth/discord/callback',
    handleDiscordStart: async (req, res) => {
      res.writeHead(302, { Location: 'https://discord.com/oauth2/authorize' });
      res.end();
    },
    handleDiscordCallback: async (req, res) => {
      res.writeHead(302, { Location: '/player' });
      res.end();
    },
    getSession: () => null,
    renderLoginPage: (message) => `<login message="${message}"/>`,
    ...overrides,
  });
}

test('portal page routes redirect legacy admin paths to dedicated admin origin', async () => {
  const handler = buildRoutes();
  const res = createMockRes();

  const handled = await handler({
    req: { headers: {} },
    res,
    urlObj: new URL('https://player.example.com/admin'),
    pathname: '/admin',
    method: 'GET',
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, 'https://admin.example.com/admin');
});

test('portal page routes gate /player behind session', async () => {
  const handler = buildRoutes();
  const res = createMockRes();

  const handled = await handler({
    req: { headers: {} },
    res,
    urlObj: new URL('https://player.example.com/player'),
    pathname: '/player',
    method: 'GET',
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/player/login');
});

test('portal page routes serve legacy player html behind session', async () => {
  const handler = buildRoutes({
    getSession: () => ({ user: 'player' }),
  });
  const res = createMockRes();

  const handled = await handler({
    req: { headers: {} },
    res,
    urlObj: new URL('https://player.example.com/player/legacy'),
    pathname: '/player/legacy',
    method: 'GET',
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '<legacy-player/>');
});

test('portal page routes serve landing html directly', async () => {
  const handler = buildRoutes();
  const res = createMockRes();

  const handled = await handler({
    req: { headers: {} },
    res,
    urlObj: new URL('https://player.example.com/landing'),
    pathname: '/landing',
    method: 'GET',
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '<landing/>');
});

test('portal page routes allow capture-only dashboard auth with a valid token', async () => {
  const handler = buildRoutes({
    allowCaptureAuth: true,
    captureAuthToken: 'capture-token',
    createCaptureSession: () => 'capture-session-id',
    buildSessionCookie: () => 'scum_portal_session=capture-session-id; Path=/; HttpOnly',
  });
  const res = createMockRes();

  const handled = await handler({
    req: { headers: {} },
    res,
    urlObj: new URL('https://player.example.com/player/capture-auth?token=capture-token'),
    pathname: '/player/capture-auth',
    method: 'GET',
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/player');
  assert.equal(res.headers['Set-Cookie'], 'scum_portal_session=capture-session-id; Path=/; HttpOnly');
});
