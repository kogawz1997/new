'use strict';

/**
 * Centralize player-portal env parsing and static path assembly.
 */

function createPortalEnvRuntime(deps = {}) {
  const {
    path,
    processEnv = process.env,
    asInt,
    envBool,
    normalizeCookieDomain,
    normalizeCookiePath,
    normalizeMode,
    normalizeSameSite,
  } = deps;

  const nodeEnv = String(processEnv.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';
  const host = String(processEnv.WEB_PORTAL_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = asInt(processEnv.WEB_PORTAL_PORT, 3300, 1, 65535);
  const baseUrl = String(processEnv.WEB_PORTAL_BASE_URL || `http://${host}:${port}`).trim();
  const portalMode = normalizeMode(processEnv.WEB_PORTAL_MODE || 'player');
  const legacyAdminUrl = String(
    processEnv.WEB_PORTAL_LEGACY_ADMIN_URL || 'http://127.0.0.1:3200/admin',
  ).trim();
  const sessionTtlMs =
    asInt(processEnv.WEB_PORTAL_SESSION_TTL_HOURS, 12, 1, 168) * 60 * 60 * 1000;
  const sessionCookieName =
    String(processEnv.WEB_PORTAL_SESSION_COOKIE_NAME || 'scum_portal_session').trim()
      || 'scum_portal_session';
  const sessionCookieSameSite = normalizeSameSite(
    processEnv.WEB_PORTAL_COOKIE_SAMESITE || 'lax',
  );
  const sessionCookiePath = normalizeCookiePath(
    processEnv.WEB_PORTAL_SESSION_COOKIE_PATH || '/',
    '/',
  );
  const sessionCookieDomain = normalizeCookieDomain(
    processEnv.WEB_PORTAL_COOKIE_DOMAIN || '',
  );
  const secureCookie = envBool('WEB_PORTAL_SECURE_COOKIE', isProduction);
  const enforceOriginCheck = envBool('WEB_PORTAL_ENFORCE_ORIGIN_CHECK', true);
  const discordClientId = String(
    processEnv.WEB_PORTAL_DISCORD_CLIENT_ID
      || processEnv.ADMIN_WEB_SSO_DISCORD_CLIENT_ID
      || processEnv.DISCORD_CLIENT_ID
      || '',
  ).trim();
  const discordClientSecret = String(
    processEnv.WEB_PORTAL_DISCORD_CLIENT_SECRET
      || processEnv.ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET
      || '',
  ).trim();
  const discordGuildId = String(
    processEnv.WEB_PORTAL_DISCORD_GUILD_ID || processEnv.DISCORD_GUILD_ID || '',
  ).trim();
  const playerOpenAccess = envBool('WEB_PORTAL_PLAYER_OPEN_ACCESS', true);
  const requireGuildMember = playerOpenAccess
    ? false
    : envBool('WEB_PORTAL_REQUIRE_GUILD_MEMBER', Boolean(discordGuildId));
  const oauthStateTtlMs = asInt(
    processEnv.WEB_PORTAL_OAUTH_STATE_TTL_MS,
    10 * 60 * 1000,
    60 * 1000,
    60 * 60 * 1000,
  );
  const discordRedirectPath = String(
    processEnv.WEB_PORTAL_DISCORD_REDIRECT_PATH || '/auth/discord/callback',
  ).trim() || '/auth/discord/callback';
  const cleanupIntervalMs = asInt(
    processEnv.WEB_PORTAL_CLEANUP_INTERVAL_MS,
    60_000,
    10_000,
    10 * 60 * 1000,
  );
  const publicAssetsDirPath = path.join(__dirname, '..', 'public', 'assets');
  const loginHtmlPath = path.join(__dirname, '..', 'public', 'login.html');
  const playerHtmlPath = path.join(__dirname, '..', 'public', 'player-core.html');
  const legacyPlayerHtmlPath = path.join(__dirname, '..', 'public', 'player.html');
  const landingHtmlPath = path.join(__dirname, '..', 'public', 'landing.html');
  const trialHtmlPath = path.join(__dirname, '..', 'public', 'trial.html');
  const showcaseHtmlPath = path.join(__dirname, '..', 'public', 'showcase.html');
  const docsDirPath = path.resolve(process.cwd(), 'docs');
  const defaultMapPortalUrl = 'https://scum-map.com/th/map/bunkers_and_killboxes';
  const defaultScumItemsDirPath = path.resolve(process.cwd(), 'scum_items-main');
  const scumItemsDirPath = path.resolve(
    String(processEnv.SCUM_ITEMS_DIR_PATH || defaultScumItemsDirPath).trim()
      || defaultScumItemsDirPath,
  );
  const partyChatMinIntervalMs = 900;
  const partyChatMaxLength = 280;

  return {
    nodeEnv,
    isProduction,
    host,
    port,
    baseUrl,
    portalMode,
    legacyAdminUrl,
    sessionTtlMs,
    sessionCookieName,
    sessionCookieSameSite,
    sessionCookiePath,
    sessionCookieDomain,
    secureCookie,
    enforceOriginCheck,
    discordClientId,
    discordClientSecret,
    discordGuildId,
    playerOpenAccess,
    requireGuildMember,
    oauthStateTtlMs,
    discordRedirectPath,
    cleanupIntervalMs,
    publicAssetsDirPath,
    discordApiBase: 'https://discord.com/api/v10',
    loginHtmlPath,
    playerHtmlPath,
    legacyPlayerHtmlPath,
    landingHtmlPath,
    trialHtmlPath,
    showcaseHtmlPath,
    docsDirPath,
    defaultMapPortalUrl,
    defaultScumItemsDirPath,
    scumItemsDirPath,
    partyChatMinIntervalMs,
    partyChatMaxLength,
  };
}

module.exports = {
  createPortalEnvRuntime,
};
