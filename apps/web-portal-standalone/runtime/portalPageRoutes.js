'use strict';

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function createPortalPageRoutes(deps) {
  const {
    allowCaptureAuth,
    captureAuthToken,
    createCaptureSession,
    buildSessionCookie,
    tryServePortalStaticAsset,
    tryServeStaticScumIcon,
    buildLegacyAdminUrl,
    getCanonicalRedirectUrl,
    sendJson,
    sendHtml,
    sendFavicon,
    buildHealthPayload,
    tryServePublicDoc,
    getLandingHtml,
    getShowcaseHtml,
    getTrialHtml,
    getPlayerHtml,
    getLegacyPlayerHtml,
    getPlatformPublicOverview,
    isDiscordStartPath,
    isDiscordCallbackPath,
    handleDiscordStart,
    handleDiscordCallback,
    getSession,
    renderLoginPage,
  } = deps;
  const servePortalStaticAsset = typeof tryServePortalStaticAsset === 'function'
    ? tryServePortalStaticAsset
    : async () => false;
  const serveLegacyPlayerHtml = typeof getLegacyPlayerHtml === 'function'
    ? getLegacyPlayerHtml
    : getPlayerHtml;

  return async function handlePortalPageRoute(context) {
    const {
      req,
      res,
      urlObj,
      pathname,
      method,
    } = context;

    if (await servePortalStaticAsset(req, res, pathname)) {
      return true;
    }

    if (await tryServeStaticScumIcon(req, res, pathname)) {
      return true;
    }

    if (pathname.startsWith('/admin')) {
      const target = buildLegacyAdminUrl(pathname, urlObj.search);
      if (!target) {
        sendJson(res, 503, {
          ok: false,
          error: 'Legacy admin URL is invalid',
        });
        return true;
      }
      sendRedirect(res, target);
      return true;
    }

    const canonicalRedirectUrl = getCanonicalRedirectUrl(req);
    if (canonicalRedirectUrl && (method === 'GET' || method === 'HEAD')) {
      sendRedirect(res, canonicalRedirectUrl);
      return true;
    }

    if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
      sendFavicon(res);
      return true;
    }

    if (allowCaptureAuth && pathname === '/player/capture-auth' && method === 'GET') {
      const token = String(urlObj.searchParams.get('token') || '').trim();
      if (!token || token !== String(captureAuthToken || '').trim()) {
        sendJson(res, 403, {
          ok: false,
          error: 'Capture auth token is invalid',
        });
        return true;
      }
      const sessionId = createCaptureSession();
      res.writeHead(302, {
        Location: '/player',
        'Set-Cookie': buildSessionCookie(sessionId),
      });
      res.end();
      return true;
    }

    if (pathname === '/healthz' && method === 'GET') {
      sendJson(res, 200, buildHealthPayload());
      return true;
    }

    if (method === 'GET' && tryServePublicDoc(pathname, res)) {
      return true;
    }

    if (pathname === '/') {
      sendRedirect(res, '/player');
      return true;
    }

    if (pathname === '/showcase/' && method === 'GET') {
      sendRedirect(res, '/showcase');
      return true;
    }

    if (pathname === '/landing/' && method === 'GET') {
      sendRedirect(res, '/landing');
      return true;
    }

    if (pathname === '/landing' && method === 'GET') {
      sendHtml(res, 200, getLandingHtml());
      return true;
    }

    if (pathname === '/showcase' && method === 'GET') {
      sendHtml(res, 200, getShowcaseHtml());
      return true;
    }

    if (pathname === '/trial/' && method === 'GET') {
      sendRedirect(res, '/trial');
      return true;
    }

    if (pathname === '/trial' && method === 'GET') {
      sendHtml(res, 200, getTrialHtml());
      return true;
    }

    if (pathname === '/api/platform/public/overview' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        data: await getPlatformPublicOverview(),
      });
      return true;
    }

    if (pathname === '/player/') {
      sendRedirect(res, '/player');
      return true;
    }

    if (pathname === '/player/legacy/' && method === 'GET') {
      sendRedirect(res, '/player/legacy');
      return true;
    }

    if (pathname === '/player/login/') {
      sendRedirect(res, '/player/login');
      return true;
    }

    if (isDiscordStartPath(pathname) && method === 'GET') {
      await handleDiscordStart(req, res);
      return true;
    }

    if (isDiscordCallbackPath(pathname) && method === 'GET') {
      await handleDiscordCallback(req, res, urlObj);
      return true;
    }

    if ((pathname === '/login' || pathname === '/player/login') && method === 'GET') {
      const session = getSession(req);
      if (session) {
        sendRedirect(res, '/player');
        return true;
      }
      sendHtml(
        res,
        200,
        renderLoginPage(String(urlObj.searchParams.get('error') || '')),
      );
      return true;
    }

    if (pathname === '/player' && method === 'GET') {
      const session = getSession(req);
      if (!session) {
        sendRedirect(res, '/player/login');
        return true;
      }
      sendHtml(res, 200, getPlayerHtml());
      return true;
    }

    if (pathname === '/player/legacy' && method === 'GET') {
      const session = getSession(req);
      if (!session) {
        sendRedirect(res, '/player/login');
        return true;
      }
      sendHtml(res, 200, serveLegacyPlayerHtml());
      return true;
    }

    return false;
  };
}

module.exports = {
  createPortalPageRoutes,
};
