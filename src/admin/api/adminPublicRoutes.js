'use strict';

const crypto = require('node:crypto');

/**
 * Admin public/platform routes that do not belong to the authenticated admin API
 * surface. This keeps page routing, platform API, and Discord SSO out of the
 * main admin server entrypoint.
 */

function createAdminPublicRoutes(deps) {
  const {
    tryServeAdminStaticAsset,
    tryServeStaticScumIcon,
    sendJson,
    sendText,
    sendHtml,
    isAuthorized,
    getAuthContext,
    getLoginHtml,
    getOwnerConsoleHtml,
    getTenantConsoleHtml,
    getDashboardHtml,
    getPersistenceStatus,
    getDeliveryMetricsSnapshot,
    ensurePlatformApiKey,
    requiredString,
    readJsonBody,
    getTenantQuotaSnapshot,
    getPlatformPublicOverview,
    getPlatformAnalyticsOverview,
    recordPlatformAgentHeartbeat,
    reconcileDeliveryState,
    dispatchPlatformWebhookEvent,
    ssoDiscordActive,
    cleanupDiscordOauthStates,
    buildDiscordAuthorizeUrl,
    getDiscordRedirectUri,
    exchangeDiscordOauthCode,
    fetchDiscordProfile,
    fetchDiscordGuildMember,
    listDiscordGuildRolesFromClient,
    resolveMappedMemberRole,
    getAdminSsoRoleMappingSummary,
    ssoDiscordGuildId,
    ssoDiscordDefaultRole,
    setDiscordOauthState,
    hasDiscordOauthState,
    deleteDiscordOauthState,
    getClientIp,
    recordAdminSecuritySignal,
    createSession,
    buildSessionCookie,
  } = deps;

  return async function handleAdminPublicRoute(context) {
    const {
      client,
      req,
      res,
      urlObj,
      pathname,
      host,
      port,
    } = context;

    if (await tryServeAdminStaticAsset(req, res, pathname)) {
      return true;
    }

    if (await tryServeStaticScumIcon(req, res, pathname)) {
      return true;
    }

    if (req.method === 'GET' && pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return true;
    }

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(302, { Location: '/admin' });
      res.end();
      return true;
    }

    if (req.method === 'GET' && pathname === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        data: {
          now: new Date().toISOString(),
          service: 'admin-web',
          uptimeSec: Math.round(process.uptime()),
          persistence: getPersistenceStatus(),
          delivery: typeof getDeliveryMetricsSnapshot === 'function'
            ? getDeliveryMetricsSnapshot()
            : null,
        },
      });
      return true;
    }

    if (req.method === 'GET' && (pathname === '/admin/login' || pathname === '/admin/login/')) {
      if (isAuthorized(req, urlObj)) {
        res.writeHead(302, { Location: '/admin' });
        res.end();
        return true;
      }
      sendHtml(res, 200, getLoginHtml());
      return true;
    }

    if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
      if (!isAuthorized(req, urlObj)) {
        res.writeHead(302, { Location: '/admin/login' });
        res.end();
        return true;
      }
      const auth = getAuthContext(req, urlObj);
      const target = auth?.tenantId ? '/tenant' : '/owner';
      res.writeHead(302, { Location: target });
      res.end();
      return true;
    }

    if (req.method === 'GET' && (pathname === '/admin/legacy' || pathname === '/admin/legacy/')) {
      if (!isAuthorized(req, urlObj)) {
        res.writeHead(302, { Location: '/admin/login' });
        res.end();
        return true;
      }
      sendHtml(res, 200, getDashboardHtml());
      return true;
    }

    if (req.method === 'GET' && (pathname === '/owner' || pathname === '/owner/')) {
      if (!isAuthorized(req, urlObj)) {
        res.writeHead(302, { Location: '/admin/login' });
        res.end();
        return true;
      }
      const auth = getAuthContext(req, urlObj);
      if (auth?.tenantId) {
        res.writeHead(302, { Location: '/tenant' });
        res.end();
        return true;
      }
      sendHtml(res, 200, getOwnerConsoleHtml());
      return true;
    }

    if (req.method === 'GET' && (pathname === '/tenant' || pathname === '/tenant/')) {
      if (!isAuthorized(req, urlObj)) {
        res.writeHead(302, { Location: '/admin/login' });
        res.end();
        return true;
      }
      const auth = getAuthContext(req, urlObj);
      if (!auth?.tenantId) {
        res.writeHead(302, { Location: '/owner' });
        res.end();
        return true;
      }
      sendHtml(res, 200, getTenantConsoleHtml());
      return true;
    }

    if (req.method === 'GET' && pathname === '/platform/api/v1/public/overview') {
      sendJson(res, 200, {
        ok: true,
        data: await getPlatformPublicOverview(),
      });
      return true;
    }

    if (pathname.startsWith('/platform/api/v1/')) {
      try {
        if (req.method === 'GET' && pathname === '/platform/api/v1/tenant/self') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['tenant:read']);
          if (!platformAuth) return true;
          sendJson(res, 200, {
            ok: true,
            data: {
              tenant: platformAuth.tenant,
              apiKey: platformAuth.apiKey,
              scopes: platformAuth.scopes,
              quota: await getTenantQuotaSnapshot(platformAuth.tenant?.id),
            },
          });
          return true;
        }

        if (req.method === 'GET' && pathname === '/platform/api/v1/quota/self') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['tenant:read']);
          if (!platformAuth) return true;
          sendJson(res, 200, {
            ok: true,
            data: await getTenantQuotaSnapshot(platformAuth.tenant?.id),
          });
          return true;
        }

        if (req.method === 'GET' && pathname === '/platform/api/v1/analytics/overview') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['analytics:read']);
          if (!platformAuth) return true;
          sendJson(res, 200, {
            ok: true,
            data: await getPlatformAnalyticsOverview({
              tenantId: platformAuth.tenant?.id,
            }),
          });
          return true;
        }

        if (req.method === 'POST' && pathname === '/platform/api/v1/agent/heartbeat') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['agent:write']);
          if (!platformAuth) return true;
          const body = await readJsonBody(req);
          const result = await recordPlatformAgentHeartbeat({
            tenantId: platformAuth.tenant?.id,
            runtimeKey: requiredString(body, 'runtimeKey'),
            version: requiredString(body, 'version'),
            channel: requiredString(body, 'channel'),
            status: requiredString(body, 'status'),
            minRequiredVersion: requiredString(body, 'minRequiredVersion'),
            meta: body.meta,
          }, 'platform-api');
          if (!result.ok) {
            sendJson(res, 400, { ok: false, error: result.reason || 'platform-agent-heartbeat-failed' });
            return true;
          }
          sendJson(res, 200, { ok: true, data: result.runtime });
          return true;
        }

        if (req.method === 'POST' && pathname === '/platform/api/v1/delivery/reconcile') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['delivery:reconcile']);
          if (!platformAuth) return true;
          const body = await readJsonBody(req);
          sendJson(res, 200, {
            ok: true,
            data: await reconcileDeliveryState({
              tenantId: platformAuth.tenant?.id,
              windowMs: body.windowMs,
              pendingOverdueMs: body.pendingOverdueMs,
            }),
          });
          return true;
        }

        if (req.method === 'POST' && pathname === '/platform/api/v1/webhooks/test') {
          const platformAuth = await ensurePlatformApiKey(req, res, ['webhook:write']);
          if (!platformAuth) return true;
          const body = await readJsonBody(req);
          sendJson(res, 200, {
            ok: true,
            data: {
              tenantId: platformAuth.tenant?.id || null,
              eventType: requiredString(body.eventType) || 'platform.admin.test',
              results: await dispatchPlatformWebhookEvent(
                requiredString(body.eventType) || 'platform.admin.test',
                body.payload && typeof body.payload === 'object'
                  ? body.payload
                  : {
                    source: 'platform-api',
                    triggeredAt: new Date().toISOString(),
                  },
                { tenantId: platformAuth.tenant?.id || null },
              ),
            },
          });
          return true;
        }

        sendJson(res, 404, { ok: false, error: 'Resource not found' });
        return true;
      } catch (error) {
        sendJson(res, Number(error?.statusCode || 500), {
          ok: false,
          error:
            Number(error?.statusCode || 500) >= 500
              ? 'Internal platform API error'
              : String(error?.message || 'Bad request'),
        });
        return true;
      }
    }

    if (req.method === 'GET' && pathname === '/admin/auth/discord/start') {
      if (!ssoDiscordActive) {
        sendText(res, 404, 'SSO is disabled');
        return true;
      }
      cleanupDiscordOauthStates();
      const state = crypto.randomBytes(18).toString('hex');
      setDiscordOauthState(state, {
        createdAt: Date.now(),
      });
      const authorizeUrl = buildDiscordAuthorizeUrl({
        host,
        port,
        state,
      });
      res.writeHead(302, { Location: authorizeUrl });
      res.end();
      return true;
    }

    if (req.method === 'GET' && pathname === '/admin/auth/discord/callback') {
      if (!ssoDiscordActive) {
        sendText(res, 404, 'SSO is disabled');
        return true;
      }
      try {
        cleanupDiscordOauthStates();
        const code = String(urlObj.searchParams.get('code') || '').trim();
        const state = String(urlObj.searchParams.get('state') || '').trim();
        const errorText = String(urlObj.searchParams.get('error') || '').trim();
        if (errorText) {
          recordAdminSecuritySignal('sso-failed', {
            severity: 'warn',
            actor: 'discord-sso',
            authMethod: 'discord-sso',
            ip: getClientIp(req),
            path: pathname,
            reason: 'discord-authorization-denied',
            detail: 'Discord SSO authorization was denied',
            notify: true,
          });
          res.writeHead(302, {
            Location: `/admin/login?error=${encodeURIComponent('Discord authorization denied')}`,
          });
          res.end();
          return true;
        }
        const hasValidState = state && hasDiscordOauthState(state);
        if (!code || !state || !hasValidState) {
          recordAdminSecuritySignal('sso-failed', {
            severity: 'warn',
            actor: 'discord-sso',
            authMethod: 'discord-sso',
            ip: getClientIp(req),
            path: pathname,
            reason: 'invalid-sso-state',
            detail: 'Discord SSO callback failed validation',
            notify: true,
          });
          res.writeHead(302, {
            Location: `/admin/login?error=${encodeURIComponent('Invalid SSO state')}`,
          });
          res.end();
          return true;
        }
        deleteDiscordOauthState(state);

        const redirectUri = getDiscordRedirectUri(host, port);
        const tokenResult = await exchangeDiscordOauthCode(code, redirectUri);
        const profile = await fetchDiscordProfile(tokenResult.access_token);
        let resolvedRole = ssoDiscordDefaultRole;
        if (ssoDiscordGuildId) {
          const member = await fetchDiscordGuildMember(
            tokenResult.access_token,
            ssoDiscordGuildId,
          );
          const guildRoles = await listDiscordGuildRolesFromClient(client, ssoDiscordGuildId);
          resolvedRole = resolveMappedMemberRole(
            member?.roles || [],
            guildRoles,
            getAdminSsoRoleMappingSummary(process.env),
          );
        }

        const username = profile.username && profile.discriminator
          ? `${profile.username}#${profile.discriminator}`
          : String(profile.username || profile.id);
        req.__pendingAdminTenantId = null;
        const sessionId = createSession(username, resolvedRole, 'discord-sso', req);
        recordAdminSecuritySignal('sso-succeeded', {
          actor: username,
          targetUser: username,
          role: resolvedRole,
          authMethod: 'discord-sso',
          sessionId,
          ip: getClientIp(req),
          path: pathname,
          detail: 'Discord SSO login succeeded',
        });
        res.writeHead(302, {
          Location: '/admin',
          'Set-Cookie': buildSessionCookie(sessionId),
        });
        res.end();
        return true;
      } catch (error) {
        recordAdminSecuritySignal('sso-failed', {
          severity: 'warn',
          actor: 'discord-sso',
          authMethod: 'discord-sso',
          ip: getClientIp(req),
          path: pathname,
          reason: String(error?.message || 'discord-sso-failed'),
          detail: 'Discord SSO callback failed unexpectedly',
          notify: true,
        });
        res.writeHead(302, {
          Location: `/admin/login?error=${encodeURIComponent('Discord SSO failed')}`,
        });
        res.end();
        return true;
      }
    }

    return false;
  };
}

module.exports = {
  createAdminPublicRoutes,
};
