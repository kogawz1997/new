'use strict';

/**
 * Compose the player portal helper/auth/route runtime from the standalone
 * entrypoint. Keep server.js focused on env loading and process bootstrap.
 */

const crypto = require('node:crypto');

const {
  safeJsonStringify,
} = require('../../../src/utils/jsonSerialization');
const {
  listShopItems,
  listUserPurchases,
  getWallet,
  listWalletLedger,
  canClaimDaily,
  claimDaily,
  canClaimWeekly,
  claimWeekly,
  listTopWallets,
  listPurchaseStatusHistory,
} = require('../../../src/store/memoryStore');
const {
  getPlayerDashboard,
  listPlayerAccounts,
  getPlayerAccount,
  upsertPlayerAccount,
} = require('../../../src/store/playerAccountStore');
const {
  redeemCodeForUser,
  requestRentBikeForUser,
  createBountyForUser,
  listActiveBountiesForUser,
} = require('../../../src/services/playerOpsService');
const { resolveItemIconUrl } = require('../../../src/services/itemIconService');
const {
  getResolvedCart,
  checkoutCart,
  buildBundleSummary,
  getDeliveryStatusText,
} = require('../../../src/services/cartService');
const {
  normalizeShopKind,
  isGameItemShopKind,
  findShopItemByQuery,
  purchaseShopItemForUser,
} = require('../../../src/services/shopService');
const {
  addCartItem,
  removeCartItem,
  clearCart,
  listCartItems,
} = require('../../../src/store/cartStore');
const { transferCoins } = require('../../../src/services/coinService');
const {
  checkRewardClaimForUser,
  claimRewardForUser,
} = require('../../../src/services/rewardService');
const {
  setLink,
  getLinkBySteamId,
  getLinkByUserId,
} = require('../../../src/store/linkStore');
const {
  canSpinWheel,
  getUserWheelState,
} = require('../../../src/store/luckyWheelStore');
const {
  listPartyMessages,
  addPartyMessage,
  normalizePartyKey,
} = require('../../../src/store/partyChatStore');
const { listCodes } = require('../../../src/store/redeemStore');
const { getStats, listAllStats } = require('../../../src/store/statsStore');
const { getStatus } = require('../../../src/store/scumStore');
const {
  ensureRentBikeTables,
  listRentalVehicles,
  getDailyRent,
} = require('../../../src/store/rentBikeStore');
const { awardWheelRewardForUser } = require('../../../src/services/wheelService');
const { getPlatformPublicOverview } = require('../../../src/services/platformService');
const config = require('../../../src/config');

const { createPortalAuthRuntime } = require('../auth/portalAuthRuntime');
const {
  createPlayerCommerceRoutes,
} = require('../api/playerCommerceRoutes');
const {
  createPlayerGeneralRoutes,
} = require('../api/playerGeneralRoutes');
const {
  buildLegacyAdminUrl,
  buildPortalHealthPayload,
  buildPortalRuntimeSettings,
  isDiscordCallbackPath,
  isDiscordStartPath,
  printPortalStartupHints,
} = require('./portalRuntime');
const {
  asInt,
  buildDiscordAvatarUrl,
  createPortalHelperRuntime,
  escapeHtml,
  isDiscordId,
  normalizeAmount,
  normalizeQuantity,
  normalizeText,
  parseCsvSet,
} = require('./portalHelperRuntime');
const {
  createPortalPageRoutes,
} = require('./portalPageRoutes');
const {
  createPortalRequestRuntime,
} = require('./portalRequestRuntime');
const {
  createPortalPageAssetRuntime,
} = require('./portalPageAssetRuntime');
const {
  createPortalResponseRuntime,
} = require('./portalResponseRuntime');
const {
  createPortalRewardRuntime,
} = require('./portalRewardRuntime');
const {
  createPortalSurfaceRuntime,
} = require('./portalSurfaceRuntime');

const FAVICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">',
  '<stop offset="0%" stop-color="#d3af6a"/><stop offset="100%" stop-color="#b6ce84"/>',
  '</linearGradient></defs>',
  '<rect width="64" height="64" rx="12" fill="#10180f"/>',
  '<path d="M10 14h44v6H10zm0 30h44v6H10z" fill="url(#g)" opacity=".85"/>',
  '<path d="M45 20H24c-2.4 0-4 1.4-4 3.5 0 2.4 1.9 3.4 4.5 4.1l8 2.2c1.4.4 2.1 1 2.1 1.9 0 1-1 1.8-2.4 1.8H18v8h15.2c6.4 0 10.8-3.6 10.8-9.2 0-4.4-2.5-7.2-7.7-8.7l-7.5-2.1c-1.2-.3-1.7-.8-1.7-1.4 0-.8.8-1.3 1.9-1.3H45z" fill="url(#g)"/>',
  '</svg>',
].join('');

function createPortalBootstrapRuntime({
  settings,
  logger = console,
} = {}) {
  const {
    nodeEnv,
    isProduction,
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
    discordApiBase,
    loginHtmlPath,
    playerHtmlPath,
    legacyPlayerHtmlPath,
    landingHtmlPath,
    trialHtmlPath,
    showcaseHtmlPath,
    docsDirPath,
    defaultMapPortalUrl,
    scumItemsDirPath,
    partyChatMinIntervalMs,
    partyChatMaxLength,
    allowedDiscordIdsRaw,
  } = settings || {};

  const sessions = new Map();
  const oauthStates = new Map();
  const partyChatLastSentAt = new Map();
  const allowedDiscordIds = parseCsvSet(allowedDiscordIdsRaw || '');

  const portalHelperRuntime = createPortalHelperRuntime({
    buildBundleSummary,
    buildPortalHealthPayload,
    buildPortalRuntimeSettings,
    config,
    defaultMapPortalUrl,
    getLinkByUserId,
    getRuntimeSettingsInput: () => ({
      nodeEnv,
      mode: portalMode,
      baseUrl,
      legacyAdminUrl,
      sessionCount: sessions.size,
      oauthStateCount: oauthStates.size,
      secureCookie,
      cookieName: sessionCookieName,
      cookiePath: sessionCookiePath,
      cookieSameSite: sessionCookieSameSite,
      cookieDomain: sessionCookieDomain,
      enforceOriginCheck,
      discordOAuthConfigured: Boolean(discordClientId && discordClientSecret),
      discordClientId,
      discordClientSecret,
      discordGuildId,
      playerOpenAccess,
      requireGuildMember,
      allowedDiscordIdsCount: allowedDiscordIds.size,
      sessionTtlMs,
      isProduction,
    }),
    isGameItemShopKind,
    listAllStats,
    listPlayerAccounts,
    logger,
    normalizePartyKey,
    normalizeShopKind,
    printPortalStartupHints,
    resolveItemIconUrl,
  });

  const {
    buildHealthPayload,
    buildPlayerNameLookup,
    filterShopItems,
    getEconomyConfig,
    getFrameSrcOrigins,
    getMapPortalConfig,
    normalizeHttpUrl,
    printStartupHints,
    readJsonBody,
    resolvePartyContext,
    serializeCartResolved,
    sortLeaderboardRows,
  } = portalHelperRuntime;

  const {
    buildWheelStatePayload,
    getDateKeyInTimezone,
    getLuckyWheelConfig,
    getNextMidnightIsoInTimezone,
    getRentTimezone,
    msToCountdownText,
    msToDaysHours,
    msToHoursMinutes,
    normalizePurchaseStatus,
    pickLuckyWheelReward,
  } = createPortalRewardRuntime({
    crypto,
    config,
    canSpinWheel,
    getUserWheelState,
    normalizeText,
    normalizeAmount,
    normalizeQuantity,
    normalizeHttpUrl,
    resolveItemIconUrl,
  });

  const {
    buildNotificationItems,
    buildSecurityHeaders,
    resolveSessionSteamLink,
    sendHtml,
    sendJson,
    walletReasonLabel,
  } = createPortalResponseRuntime({
    secureCookie,
    safeJsonStringify,
    getFrameSrcOrigins,
    getLinkByUserId,
    getPlayerAccount,
    normalizeText,
  });

  const portalAuthRuntime = createPortalAuthRuntime({
    sessions,
    oauthStates,
    baseUrl,
    enforceOriginCheck,
    playerOpenAccess,
    requireGuildMember,
    allowedDiscordIds,
    oauthStateTtlMs,
    sessionTtlMs,
    sessionCookieName,
    sessionCookiePath,
    sessionCookieSameSite,
    sessionCookieDomain,
    secureCookie,
    discordApiBase,
    discordClientId,
    discordClientSecret,
    discordGuildId,
    discordRedirectPath,
    sendJson,
    upsertPlayerAccount,
    buildDiscordAvatarUrl,
    normalizeText,
    isDiscordId,
    logger,
  });

  const {
    buildClearSessionCookie,
    buildSessionCookie,
    cleanupRuntimeState,
    createSession,
    getCanonicalRedirectUrl,
    getSession,
    handleDiscordCallback,
    handleDiscordStart,
    removeSession,
    verifyOrigin,
  } = portalAuthRuntime;

  const { requestHandler, startCleanupTimer } = createPortalSurfaceRuntime({
    createPlayerCommerceRoutes,
    createPlayerGeneralRoutes,
    createPortalPageAssetRuntime,
    createPortalPageRoutes,
    createPortalRequestRuntime,
    commerceRouteDeps: {
      sendJson,
      readJsonBody,
      normalizeText,
      normalizeAmount,
      normalizeQuantity,
      normalizePurchaseStatus,
      asInt,
      resolveItemIconUrl,
      buildBundleSummary,
      getDeliveryStatusText,
      serializeCartResolved,
      getResolvedCart,
      findShopItemByQuery,
      isGameItemShopKind,
      resolveSessionSteamLink,
      purchaseShopItemForUser,
      checkoutCart,
      listUserPurchases,
      listShopItems,
      listPurchaseStatusHistory,
      listCartItems,
      addCartItem,
      removeCartItem,
      clearCart,
      listActiveBountiesForUser,
      redeemCodeForUser,
      requestRentBikeForUser,
      createBountyForUser,
      normalizeShopKind,
      filterShopItems,
    },
    generalRouteDeps: {
      sendJson,
      readJsonBody,
      buildClearSessionCookie,
      normalizeText,
      normalizeAmount,
      normalizePurchaseStatus,
      asInt,
      config,
      getStatus,
      getEconomyConfig,
      getLuckyWheelConfig,
      getMapPortalConfig,
      getPlayerAccount,
      getPlayerDashboard,
      resolveSessionSteamLink,
      removeSession,
      listTopWallets,
      listAllStats,
      getStats,
      buildPlayerNameLookup,
      sortLeaderboardRows,
      resolvePartyContext,
      listPartyMessages,
      addPartyMessage,
      partyChatLastSentAt,
      partyChatMinIntervalMs,
      partyChatMaxLength,
      listWalletLedger,
      getWallet,
      walletReasonLabel,
      listCodes,
      ensureRentBikeTables,
      getDailyRent,
      listRentalVehicles,
      getRentTimezone,
      getDateKeyInTimezone,
      getNextMidnightIsoInTimezone,
      canClaimDaily,
      canClaimWeekly,
      buildWheelStatePayload,
      canSpinWheel,
      pickLuckyWheelReward,
      awardWheelRewardForUser,
      msToCountdownText,
      buildNotificationItems,
      getLinkBySteamId,
      setLink,
      claimRewardForUser,
      checkRewardClaimForUser,
      msToHoursMinutes,
      msToDaysHours,
      transferCoins,
      isDiscordId,
      listUserPurchases,
      claimDaily,
      claimWeekly,
    },
    pageAssetDeps: {
      isProduction,
      loginHtmlPath,
      playerHtmlPath,
      legacyPlayerHtmlPath,
      landingHtmlPath,
      trialHtmlPath,
      showcaseHtmlPath,
      publicAssetsDirPath,
      docsDirPath,
      scumItemsDirPath,
      faviconSvg: FAVICON_SVG,
      sendJson,
      sendHtml,
      buildSecurityHeaders,
      escapeHtml,
    },
    pageRouteDeps: {
      allowCaptureAuth: nodeEnv === 'capture',
      captureAuthToken: String(process.env.WEB_PORTAL_CAPTURE_TOKEN || '').trim(),
      createCaptureSession: () => createSession({
        user: 'Capture Player',
        role: 'player',
        discordId: 'capture_player',
        authMethod: 'capture',
        avatarUrl: null,
      }),
      buildSessionCookie,
      buildLegacyAdminUrl: (pathname, search) => buildLegacyAdminUrl(legacyAdminUrl, pathname, search),
      getCanonicalRedirectUrl,
      sendJson,
      sendHtml,
      buildHealthPayload,
      getPlatformPublicOverview,
      isDiscordStartPath,
      isDiscordCallbackPath: (pathname) => isDiscordCallbackPath(pathname, discordRedirectPath),
      handleDiscordStart,
      handleDiscordCallback,
      getSession,
    },
    requestRuntimeDeps: {
      sendJson,
      verifyOrigin,
      getSession,
      isDiscordId,
      cleanupRuntimeState,
      cleanupIntervalMs,
    },
  });

  return {
    startupReady: printStartupHints(),
    requestHandler,
    startCleanupTimer,
  };
}

module.exports = {
  createPortalBootstrapRuntime,
};
