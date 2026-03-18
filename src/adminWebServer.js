const crypto = require('node:crypto');
const path = require('node:path');

const config = require('./config');
const { prisma } = require('./prisma');
const {
  getAdminSsoRoleMappingSummary,
  resolveMappedMemberRole,
} = require('./utils/adminSsoRoleMapping');
const {
  buildDiscordAuthorizeUrl,
  exchangeDiscordOauthCode,
  fetchDiscordGuildMember,
  fetchDiscordProfile,
  listDiscordGuildRolesFromClient,
} = require('./admin/auth/adminDiscordOauthClient');
const {
  getRequiredCommandAccessRole,
} = require('./utils/discordCommandAccess');
const {
  buildRoleMatrix,
  getAdminPermissionForPath,
  getAdminPermissionMatrixSummary,
  hasRoleAtLeast,
  listAdminPermissionMatrix,
  normalizeRole,
} = require('./utils/adminPermissionMatrix');
const {
  listShopItems,
  listUserPurchases,
  listKnownPurchaseStatuses,
} = require('./store/memoryStore');
const {
  normalizePurchaseStatus,
  listAllowedPurchaseTransitions,
} = require('./services/purchaseStateMachine');
const { listEvents, getParticipants } = require('./store/eventStore');
const {
  createServerEvent,
  joinServerEvent,
  startServerEvent,
  finishServerEvent,
} = require('./services/eventService');
const { getStatus } = require('./store/scumStore');
const {
  upsertPlayerAccount,
  bindPlayerSteamId,
  unbindPlayerSteamId,
  getPlayerDashboard,
  listPlayerAccounts,
} = require('./store/playerAccountStore');
const {
  getRentBikeRuntime,
  runRentBikeMidnightReset,
} = require('./services/rentBikeService');
const {
  listManagedRuntimeServices,
  restartManagedRuntimeServices,
} = require('./services/adminServiceControl');
const {
  enqueuePurchaseDeliveryByCode,
  listDeliveryQueue,
  listFilteredDeliveryQueue,
  listFilteredDeliveryDeadLetters,
  retryDeliveryNow,
  retryDeliveryNowMany,
  retryDeliveryDeadLetter,
  retryDeliveryDeadLetterMany,
  removeDeliveryDeadLetter,
  cancelDeliveryJob,
  getDeliveryMetricsSnapshot,
  getDeliveryRuntimeSnapshotSync,
  getDeliveryRuntimeStatus,
  getDeliveryPreflightReport,
  previewDeliveryCommands,
  simulateDeliveryPlan,
  sendTestDeliveryCommand,
  listScumAdminCommandCapabilities,
  testScumAdminCommandCapability,
  getDeliveryCommandOverride,
  setDeliveryCommandOverride,
  getDeliveryDetailsByPurchaseCode,
} = require('./services/rconDelivery');
const {
  queueLeaderboardRefreshForAllGuilds,
} = require('./services/leaderboardPanels');
const {
  adminLiveBus,
  publishAdminLiveUpdate,
} = require('./services/adminLiveBus');
const {
  listAdminNotifications,
  acknowledgeAdminNotifications,
  clearAdminNotifications,
  addAdminNotification,
} = require('./store/adminNotificationStore');
const {
  listAdminSecurityEvents,
  recordAdminSecurityEvent,
} = require('./store/adminSecurityEventStore');
const {
  getAdminRequestLogMetrics,
  listAdminRequestLogs,
  recordAdminRequestLog,
} = require('./store/adminRequestLogStore');
const {
  listAdminCommandCapabilityPresets,
  getAdminCommandCapabilityPresetById,
  saveAdminCommandCapabilityPreset,
  deleteAdminCommandCapabilityPreset,
} = require('./store/adminCommandCapabilityPresetStore');
const {
  listItemIconCatalog,
  resolveItemIconUrl,
} = require('./services/itemIconService');
const {
  listWikiWeaponCatalog,
  getWikiWeaponCatalogMeta,
} = require('./services/wikiWeaponCatalog');
const {
  listManifestItemCatalog,
  getManifestItemCatalogMeta,
} = require('./services/wikiItemManifestCatalog');
const {
  redeemCodeForUser,
  requestRentBikeForUser,
  createBountyForUser,
  listActiveBountiesForUser,
  cancelBountyForUser,
  createRedeemCodeForAdmin,
  deleteRedeemCodeForAdmin,
  resetRedeemCodeUsageForAdmin,
} = require('./services/playerOpsService');
const {
  updatePurchaseStatusForActor,
} = require('./services/purchaseService');
const {
  addShopItemForAdmin,
  setShopItemPriceForAdmin,
  deleteShopItemForAdmin,
} = require('./services/shopService');
const {
  creditCoins,
  debitCoins,
  setCoinsExact,
} = require('./services/coinService');
const {
  grantVipForUser,
  revokeVipForUser,
} = require('./services/vipService');
const {
  buildAdminSnapshot,
  createAdminBackup,
  listAdminBackupFiles,
  previewAdminBackupRestore,
  restoreAdminBackup,
  getAdminRestoreState,
} = require('./services/adminSnapshotService');
const {
  buildAuditDataset: buildAuditDatasetService,
  buildAuditExportPayload: buildAuditExportPayloadService,
  buildAuditCsv: buildAuditCsvService,
  listAuditPresets: listAuditPresetsService,
  saveAuditPreset: saveAuditPresetService,
  deleteAuditPreset: deleteAuditPresetService,
} = require('./services/adminAuditService');
const {
  createObservabilitySeriesState,
  clampObservabilityWindowMs,
  parseObservabilitySeriesKeys,
  captureObservabilitySeries,
  listObservabilitySeries,
  buildAdminObservabilitySnapshot,
  buildObservabilityExportPayload,
  buildObservabilityCsv,
} = require('./services/adminObservabilityService');
const {
  buildAdminDashboardCards,
} = require('./services/adminDashboardService');
const {
  getCachedRuntimeSupervisorSnapshot,
  getRuntimeSupervisorSnapshot,
  startRuntimeSupervisorMonitor,
  stopRuntimeSupervisorMonitor,
} = require('./services/runtimeSupervisorService');
const {
  acceptPlatformLicenseLegal,
  createMarketplaceOffer,
  createPlatformApiKey,
  createPlatformWebhookEndpoint,
  createSubscription,
  createTenant,
  dispatchPlatformWebhookEvent,
  getPlanCatalog,
  getPlatformAnalyticsOverview,
  getPlatformPermissionCatalog,
  getPlatformPublicOverview,
  getPlatformTenantById,
  getTenantQuotaSnapshot,
  issuePlatformLicense,
  listMarketplaceOffers,
  listPlatformAgentRuntimes,
  listPlatformApiKeys,
  listPlatformLicenses,
  listPlatformSubscriptions,
  listPlatformTenants,
  listPlatformWebhookEndpoints,
  recordPlatformAgentHeartbeat,
  reconcileDeliveryState,
  verifyPlatformApiKey,
} = require('./services/platformService');
const {
  runPlatformMonitoringCycle,
  startPlatformMonitoring,
  stopPlatformMonitoring,
} = require('./services/platformMonitoringService');
const { getPlatformOpsState } = require('./store/platformOpsStateStore');
const {
  revokeWelcomePackClaimForAdmin,
  clearWelcomePackClaimsForAdmin,
} = require('./services/welcomePackService');
const {
  claimSupportTicket,
  closeSupportTicket,
} = require('./services/ticketService');
const {
  bindSteamLinkForUser,
  removeSteamLink,
} = require('./services/linkService');
const { createPunishmentEntry } = require('./services/moderationService');
const {
  addKillsForUser,
  addDeathsForUser,
  addPlaytimeForUser,
} = require('./services/statsService');
const { updateScumStatusForAdmin } = require('./services/scumStatusService');
const { getPersistenceStatus } = require('./store/_persist');
const {
  isAdminRestoreMaintenanceActive,
} = require('./store/adminRestoreStateStore');
const { getWebhookMetricsSnapshot } = require('./scumWebhookServer');
const { updateEnvFile } = require('./utils/envFileEditor');
const { resolveDatabaseRuntime } = require('./utils/dbEngine');
const {
  buildControlPanelEnvCatalog: buildAdminEditableEnvCatalog,
  buildControlPanelEnvApplySummary: buildAdminEditableEnvApplySummary,
  buildControlPanelEnvPatch: buildAdminEditableEnvPatch,
  buildControlPanelEnvPolicySummary: buildAdminEditableEnvPolicySummary,
  buildControlPanelEnvSection: buildAdminEditableEnvSection,
  getControlPanelEnvFileValues: getAdminEditableEnvFileValues,
  getPortalEnvFilePath: resolveAdminEditablePortalEnvFilePath,
  getRootEnvFilePath: resolveAdminEditableRootEnvFilePath,
} = require('./config/adminEditableConfig');
const {
  getPlatformTenantConfig,
  listPlatformTenantConfigs,
  upsertPlatformTenantConfig,
} = require('./services/platformTenantConfigService');
const { createAdminAuthRuntime } = require('./admin/auth/adminAuthRuntime');
const {
  createAdminUserStoreRuntime,
} = require('./admin/auth/adminUserStoreRuntime');
const {
  createAdminConfigPostRoutes,
} = require('./admin/api/adminConfigPostRoutes');
const {
  createAdminPublicRoutes,
} = require('./admin/api/adminPublicRoutes');
const {
  createAdminGetRoutes,
} = require('./admin/api/adminGetRoutes');
const {
  createAdminAuthPostRoutes,
} = require('./admin/api/adminAuthPostRoutes');
const {
  createAdminEntityPostRoutes,
} = require('./admin/api/adminEntityPostRoutes');
const {
  createAdminCommerceDeliveryPostRoutes,
} = require('./admin/api/adminCommerceDeliveryPostRoutes');
const {
  createAdminPortalPostRoutes,
} = require('./admin/api/adminPortalPostRoutes');
const {
  createAdminPlatformPostRoutes,
} = require('./admin/api/adminPlatformPostRoutes');
const {
  createAdminAuditRoutes,
} = require('./admin/audit/adminAuditRoutes');
const {
  filterRowsByTenantScope,
  getAuthTenantId,
  resolveTenantScope,
} = require('./admin/adminTenantScope');
const {
  createAdminPageRuntime,
} = require('./admin/runtime/adminPageRuntime');
const {
  createAdminLiveRuntime,
} = require('./admin/runtime/adminLiveRuntime');
const {
  createAdminEnvRuntime,
} = require('./admin/runtime/adminEnvRuntime');
const {
  createAdminHttpRuntime,
  envBool,
  normalizeCookieDomain,
  normalizeCookiePath,
  normalizeSameSite,
} = require('./admin/runtime/adminHttpRuntime');
const {
  createAdminRequestRuntime,
} = require('./admin/runtime/adminRequestRuntime');
const {
  createAdminAccessRuntime,
} = require('./admin/runtime/adminAccessRuntime');
const {
  createAdminControlPanelRuntime,
} = require('./admin/runtime/adminControlPanelRuntime');
const {
  createAdminSecurityRuntime,
} = require('./admin/runtime/adminSecurityRuntime');
const {
  createAdminSecurityExportRuntime,
} = require('./admin/runtime/adminSecurityExportRuntime');
const {
  createAdminObservabilityRuntime,
} = require('./admin/runtime/adminObservabilityRuntime');
const {
  createAdminTicketRuntime,
} = require('./admin/runtime/adminTicketRuntime');
const {
  createAdminRouteRuntime,
} = require('./admin/runtime/adminRouteRuntime');
const {
  createAdminRequestHandler,
} = require('./admin/runtime/adminServerRuntime');
const {
  createSecureEqual,
} = require('./admin/runtime/adminCryptoRuntime');
const {
  createAdminServerLifecycle,
} = require('./admin/runtime/adminServerLifecycleRuntime');

const {
  dashboardHtmlPath,
  loginHtmlPath,
  adminAssetsDirPath,
  scumItemsDirPath,
  sessionCookieName: SESSION_COOKIE_NAME,
  sessionTtlMs: SESSION_TTL_MS,
  sessionIdleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
  sessionMaxPerUser: SESSION_MAX_PER_USER,
  sessionBindUserAgent: SESSION_BIND_USER_AGENT,
  sessionCookiePath: SESSION_COOKIE_PATH,
  sessionCookieSameSite: SESSION_COOKIE_SAMESITE,
  sessionCookieDomain: SESSION_COOKIE_DOMAIN,
  adminWebMaxBodyBytes: ADMIN_WEB_MAX_BODY_BYTES,
  liveHeartbeatMs: LIVE_HEARTBEAT_MS,
  sessionSecureCookie: SESSION_SECURE_COOKIE,
  adminWebHstsEnabled: ADMIN_WEB_HSTS_ENABLED,
  adminWebHstsMaxAgeSec: ADMIN_WEB_HSTS_MAX_AGE_SEC,
  adminWebTrustProxy: ADMIN_WEB_TRUST_PROXY,
  adminWebAllowTokenQuery: ADMIN_WEB_ALLOW_TOKEN_QUERY,
  adminWebEnforceOriginCheck: ADMIN_WEB_ENFORCE_ORIGIN_CHECK,
  adminWebAllowedOrigins: ADMIN_WEB_ALLOWED_ORIGINS,
  adminWebCsp: ADMIN_WEB_CSP,
  adminWebUser: ADMIN_WEB_USER,
  loginRateLimitWindowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  loginRateLimitMaxAttempts: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  loginSpikeWindowMs: LOGIN_SPIKE_WINDOW_MS,
  loginSpikeThreshold: LOGIN_SPIKE_THRESHOLD,
  loginSpikeIpThreshold: LOGIN_SPIKE_IP_THRESHOLD,
  loginSpikeAlertCooldownMs: LOGIN_SPIKE_ALERT_COOLDOWN_MS,
  adminWebUserRole: ADMIN_WEB_USER_ROLE,
  adminWebTokenRole: ADMIN_WEB_TOKEN_ROLE,
  adminWebUsersJson: ADMIN_WEB_USERS_JSON,
  adminWeb2faEnabled: ADMIN_WEB_2FA_ENABLED,
  adminWeb2faSecret: ADMIN_WEB_2FA_SECRET,
  adminWeb2faActive: ADMIN_WEB_2FA_ACTIVE,
  adminWeb2faWindowSteps: ADMIN_WEB_2FA_WINDOW_STEPS,
  adminWebStepUpEnabled: ADMIN_WEB_STEP_UP_ENABLED,
  adminWebStepUpTtlMs: ADMIN_WEB_STEP_UP_TTL_MS,
  adminWebAllowTokenSensitiveMutations: ADMIN_WEB_ALLOW_TOKEN_SENSITIVE_MUTATIONS,
  ssoDiscordEnabled: SSO_DISCORD_ENABLED,
  ssoDiscordClientId: SSO_DISCORD_CLIENT_ID,
  ssoDiscordClientSecret: SSO_DISCORD_CLIENT_SECRET,
  ssoDiscordActive: SSO_DISCORD_ACTIVE,
  ssoDiscordRedirectUri: SSO_DISCORD_REDIRECT_URI,
  ssoDiscordGuildId: SSO_DISCORD_GUILD_ID,
  ssoDiscordDefaultRole: SSO_DISCORD_DEFAULT_ROLE,
  ssoStateTtlMs: SSO_STATE_TTL_MS,
  metricsSeriesIntervalMs: METRICS_SERIES_INTERVAL_MS,
  metricsSeriesRetentionMs: METRICS_SERIES_RETENTION_MS,
  discordApiBase: DISCORD_API_BASE,
} = createAdminEnvRuntime({
  path,
  processEnv: process.env,
  envBool,
  normalizeCookieDomain,
  normalizeCookiePath,
  normalizeRole,
  normalizeSameSite,
});
const sessions = new Map();
const discordOauthStates = new Map();
const secureEqual = createSecureEqual(crypto);
const {
  buildSecurityHeaders,
  jsonReplacer,
  sendDownload,
  sendHtml,
  sendJson,
  sendText,
  verifyTotpCode,
} = createAdminHttpRuntime({
  adminWebHstsEnabled: ADMIN_WEB_HSTS_ENABLED,
  adminWebHstsMaxAgeSec: ADMIN_WEB_HSTS_MAX_AGE_SEC,
  adminWebCsp: ADMIN_WEB_CSP,
  secureEqual,
});
const {
  buildAllowedOrigins,
  getClientIp,
  getRequestOrigin,
  isSafeHttpMethod,
  readJsonBody,
  sendRestoreMaintenanceUnavailable,
  setRequestMeta,
  shouldBypassRestoreMaintenance,
  violatesBrowserOriginPolicy,
} = createAdminRequestRuntime({
  adminWebMaxBodyBytes: ADMIN_WEB_MAX_BODY_BYTES,
  adminWebTrustProxy: ADMIN_WEB_TRUST_PROXY,
  adminWebEnforceOriginCheck: ADMIN_WEB_ENFORCE_ORIGIN_CHECK,
  adminWebAllowedOrigins: ADMIN_WEB_ALLOWED_ORIGINS,
  getAdminRestoreState,
  sendJson,
});
const {
  ensureAdminUsersReady,
  getAdminToken,
  getUserByCredentials,
  listAdminUsersFromDb,
  upsertAdminUserInDb,
} = createAdminUserStoreRuntime({
  prisma,
  crypto,
  secureEqual,
  normalizeRole,
  resolveDatabaseRuntime,
  adminWebUser: ADMIN_WEB_USER,
  adminWebUserRole: ADMIN_WEB_USER_ROLE,
  adminWebUsersJson: ADMIN_WEB_USERS_JSON,
});

const {
  buildCommandRegistry,
  buildControlPanelSettings,
  getDiscordRedirectUri,
} = createAdminControlPanelRuntime({
  config,
  getRequiredCommandAccessRole,
  getAdminEditableEnvFileValues,
  buildAdminEditableEnvSection,
  buildAdminEditableEnvCatalog,
  buildAdminEditableEnvPolicySummary,
  getRootEnvFilePath: resolveAdminEditableRootEnvFilePath,
  getPortalEnvFilePath: resolveAdminEditablePortalEnvFilePath,
  listManagedRuntimeServices,
  listAdminUsersFromDb,
  getPlatformTenantConfig,
  hasRoleAtLeast,
  ssoDiscordRedirectUri: SSO_DISCORD_REDIRECT_URI,
});

const {
  cleanupDiscordOauthStates,
  getLoginFailureMetrics,
  getLoginRateLimitState,
  recordAdminSecuritySignal,
  recordLoginAttempt,
} = createAdminSecurityRuntime({
  loginRateLimitWindowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  loginRateLimitMaxAttempts: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  loginSpikeWindowMs: LOGIN_SPIKE_WINDOW_MS,
  loginSpikeThreshold: LOGIN_SPIKE_THRESHOLD,
  loginSpikeIpThreshold: LOGIN_SPIKE_IP_THRESHOLD,
  loginSpikeAlertCooldownMs: LOGIN_SPIKE_ALERT_COOLDOWN_MS,
  discordOauthStates,
  ssoStateTtlMs: SSO_STATE_TTL_MS,
  getClientIp,
  publishAdminLiveUpdate,
  addAdminNotification,
  recordAdminSecurityEvent,
  logger: console,
});

const {
  asInt,
  ensurePlatformApiKey,
  ensurePortalTokenAuth,
  ensureRole,
  filterShopItems,
  parseDeliveryItemsBody,
  parseStringArray,
  requiredRoleForPostPath,
  requiredString,
  resolveScopedTenantId,
} = createAdminAccessRuntime({
  sendJson,
  getAuthContext: (...args) => getAuthContext(...args),
  hasRoleAtLeast,
  resolveTenantScope,
  verifyPlatformApiKey,
  setRequestMeta: (...args) => setRequestMeta(...args),
  getAdminPermissionForPath,
  resolveItemIconUrl,
});

const adminAuthRuntime = createAdminAuthRuntime({
  sessions,
  defaultUser: ADMIN_WEB_USER,
  sessionCookieName: SESSION_COOKIE_NAME,
  sessionTtlMs: SESSION_TTL_MS,
  sessionIdleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
  sessionMaxPerUser: SESSION_MAX_PER_USER,
  sessionBindUserAgent: SESSION_BIND_USER_AGENT,
  sessionCookiePath: SESSION_COOKIE_PATH,
  sessionCookieSameSite: SESSION_COOKIE_SAMESITE,
  sessionCookieDomain: SESSION_COOKIE_DOMAIN,
  sessionSecureCookie: SESSION_SECURE_COOKIE,
  adminWebAllowTokenQuery: ADMIN_WEB_ALLOW_TOKEN_QUERY,
  adminWebTokenRole: ADMIN_WEB_TOKEN_ROLE,
  adminWebStepUpEnabled: ADMIN_WEB_STEP_UP_ENABLED,
  adminWeb2faActive: ADMIN_WEB_2FA_ACTIVE,
  adminWeb2faSecret: ADMIN_WEB_2FA_SECRET,
  adminWeb2faWindowSteps: ADMIN_WEB_2FA_WINDOW_STEPS,
  adminWebStepUpTtlMs: ADMIN_WEB_STEP_UP_TTL_MS,
  adminWebAllowTokenSensitiveMutations: ADMIN_WEB_ALLOW_TOKEN_SENSITIVE_MUTATIONS,
  secureEqual,
  normalizeRole,
  getClientIp,
  getAdminToken,
  sendJson,
  requiredString,
  verifyTotpCode,
  recordAdminSecuritySignal,
  setRequestMeta,
});

const {
  buildClearSessionCookie,
  buildSessionCookie,
  createSession,
  ensureStepUpAuth,
  getAuthContext,
  getSessionId,
  hasFreshStepUp,
  hasValidSession,
  invalidateSession,
  isAuthorized,
  listAdminSessions,
  revokeSessionsForUser,
} = adminAuthRuntime;

const {
  tryServeAdminStaticAsset,
  tryServeStaticScumIcon,
  getDashboardHtml,
  getLoginHtml,
} = createAdminPageRuntime({
  dashboardHtmlPath,
  loginHtmlPath,
  assetsDirPath: adminAssetsDirPath,
  scumItemsDirPath,
  buildSecurityHeaders,
  sendText,
});
const {
  broadcastLiveUpdate,
  captureMetricsSeries,
  clampMetricsWindowMs,
  closeAllLiveStreams,
  ensureMetricsSeriesTimer,
  listMetricsSeries,
  openLiveStream,
  parseMetricsSeriesKeys,
  stopMetricsSeriesTimer,
} = createAdminLiveRuntime({
  liveHeartbeatMs: LIVE_HEARTBEAT_MS,
  metricsSeriesIntervalMs: METRICS_SERIES_INTERVAL_MS,
  metricsSeriesRetentionMs: METRICS_SERIES_RETENTION_MS,
  createObservabilitySeriesState,
  clampObservabilityWindowMs,
  parseObservabilitySeriesKeys,
  captureObservabilitySeries,
  listObservabilitySeries,
  buildSecurityHeaders,
  jsonReplacer,
  getDeliveryMetricsSnapshot,
  getDeliveryRuntimeSnapshotSync,
  getLoginFailureMetrics,
  getWebhookMetricsSnapshot,
  getAdminRequestLogMetrics,
  getRuntimeSupervisorSnapshot: getCachedRuntimeSupervisorSnapshot,
});

const {
  buildAdminSecurityEventCsv,
  buildAdminSecurityEventExportRows,
} = createAdminSecurityExportRuntime({
  asInt,
  listAdminSecurityEvents,
  requiredString,
});

const {
  getCurrentObservabilitySnapshot,
} = createAdminObservabilityRuntime({
  buildAdminObservabilitySnapshot,
  captureMetricsSeries,
  getAdminRequestLogMetrics,
  getCachedRuntimeSupervisorSnapshot,
  getDeliveryMetricsSnapshot,
  getDeliveryRuntimeStatus,
  getLoginFailureMetrics,
  getPlatformOpsState,
  getWebhookMetricsSnapshot,
  listAdminRequestLogs,
  listDeliveryQueue,
  listMetricsSeries,
  metricsSeriesRetentionMs: METRICS_SERIES_RETENTION_MS,
});

const {
  tryNotifyTicket,
} = createAdminTicketRuntime();

const handleAdminEntityPostRoute = createAdminEntityPostRoutes({
  sendJson,
  requiredString,
  asInt,
  claimSupportTicket,
  closeSupportTicket,
  tryNotifyTicket,
  createBountyForUser,
  cancelBountyForUser,
  createServerEvent,
  startServerEvent,
  finishServerEvent,
  joinServerEvent,
  bindSteamLinkForUser,
  removeSteamLink,
  upsertPlayerAccount,
  bindPlayerSteamId,
  unbindPlayerSteamId,
  grantVipForUser,
  revokeVipForUser,
  createRedeemCodeForAdmin,
  deleteRedeemCodeForAdmin,
  resetRedeemCodeUsageForAdmin,
  createPunishmentEntry,
  revokeWelcomePackClaimForAdmin,
  clearWelcomePackClaimsForAdmin,
  addKillsForUser,
  addDeathsForUser,
  addPlaytimeForUser,
  queueLeaderboardRefreshForAllGuilds,
});

const handleAdminConfigPostRoute = createAdminConfigPostRoutes({
  sendJson,
  requiredString,
  parseStringArray,
  getAuthTenantId,
  buildControlPanelEnvPatch: buildAdminEditableEnvPatch,
  buildControlPanelEnvApplySummary: buildAdminEditableEnvApplySummary,
  updateEnvFile,
  getRootEnvFilePath: resolveAdminEditableRootEnvFilePath,
  getPortalEnvFilePath: resolveAdminEditablePortalEnvFilePath,
  recordAdminSecuritySignal,
  getClientIp,
  upsertAdminUserInDb,
  restartManagedRuntimeServices,
  config,
  resolveScopedTenantId,
  getPlatformTenantById,
  upsertPlatformTenantConfig,
});

const handleAdminPublicRoute = createAdminPublicRoutes({
  tryServeAdminStaticAsset,
  tryServeStaticScumIcon,
  sendJson,
  sendText,
  sendHtml,
  isAuthorized,
  getLoginHtml,
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
  ssoDiscordActive: SSO_DISCORD_ACTIVE,
  cleanupDiscordOauthStates,
  buildDiscordAuthorizeUrl: ({ host, port, state }) => buildDiscordAuthorizeUrl({
    apiBase: DISCORD_API_BASE,
    clientId: SSO_DISCORD_CLIENT_ID,
    guildId: SSO_DISCORD_GUILD_ID,
    redirectUri: getDiscordRedirectUri(host, port),
    state,
  }),
  getDiscordRedirectUri,
  exchangeDiscordOauthCode: (code, redirectUri) => exchangeDiscordOauthCode({
    apiBase: DISCORD_API_BASE,
    clientId: SSO_DISCORD_CLIENT_ID,
    clientSecret: SSO_DISCORD_CLIENT_SECRET,
    code,
    redirectUri,
  }),
  fetchDiscordProfile: (accessToken) => fetchDiscordProfile(DISCORD_API_BASE, accessToken),
  fetchDiscordGuildMember: (accessToken, guildId) => fetchDiscordGuildMember(
    DISCORD_API_BASE,
    accessToken,
    guildId,
  ),
  listDiscordGuildRolesFromClient,
  resolveMappedMemberRole,
  getAdminSsoRoleMappingSummary,
  ssoDiscordGuildId: SSO_DISCORD_GUILD_ID,
  ssoDiscordDefaultRole: SSO_DISCORD_DEFAULT_ROLE,
  setDiscordOauthState: (state, payload) => discordOauthStates.set(state, payload),
  hasDiscordOauthState: (state) => discordOauthStates.has(state),
  deleteDiscordOauthState: (state) => discordOauthStates.delete(state),
  getClientIp,
  recordAdminSecuritySignal,
  createSession,
  buildSessionCookie,
});

const handleAdminGetRoute = createAdminGetRoutes({
  prisma,
  sendJson,
  sendDownload,
  ensureRole,
  ensurePortalTokenAuth,
  getAuthContext,
  getAuthTenantId,
  getSessionId,
  hasFreshStepUp,
  hasValidSession,
  resolveScopedTenantId,
  filterRowsByTenantScope,
  requiredString,
  asInt,
  jsonReplacer,
  getAdminSsoRoleMappingSummary,
  getAdminPermissionMatrixSummary,
  buildRoleMatrix,
  listAdminPermissionMatrix,
  listAdminSecurityEvents,
  buildAdminSecurityEventExportRows,
  buildAdminSecurityEventCsv,
  listAdminSessions,
  listAdminUsersFromDb,
  buildControlPanelSettings,
  buildCommandRegistry,
  getRuntimeSupervisorSnapshot,
  getAdminRestoreState,
  getPlatformAnalyticsOverview,
  getPlatformPublicOverview,
  getPlatformPermissionCatalog,
  getPlanCatalog,
  getPlatformOpsState,
  getPlatformTenantConfig,
  getTenantQuotaSnapshot,
  listPlatformTenants,
  listPlatformTenantConfigs,
  listPlatformSubscriptions,
  listPlatformLicenses,
  listPlatformApiKeys,
  listPlatformWebhookEndpoints,
  listPlatformAgentRuntimes,
  listMarketplaceOffers,
  reconcileDeliveryState,
  clampMetricsWindowMs,
  parseMetricsSeriesKeys,
  getCurrentObservabilitySnapshot,
  getAdminRequestLogMetrics,
  listAdminRequestLogs,
  buildObservabilityCsv,
  buildObservabilityExportPayload,
  openLiveStream,
  listItemIconCatalog,
  listWikiWeaponCatalog,
  getWikiWeaponCatalogMeta,
  listManifestItemCatalog,
  getManifestItemCatalogMeta,
  listShopItems,
  filterShopItems,
  listUserPurchases,
  normalizePurchaseStatus,
  getPlayerDashboard,
  listActiveBountiesForUser,
  listFilteredDeliveryQueue,
  listFilteredDeliveryDeadLetters,
  getDeliveryRuntimeStatus,
  listScumAdminCommandCapabilities,
  listAdminCommandCapabilityPresets,
  getDeliveryCommandOverride,
  getDeliveryDetailsByPurchaseCode,
  listAdminNotifications,
  listKnownPurchaseStatuses,
  listAllowedPurchaseTransitions,
  buildAdminDashboardCards,
  listPlayerAccounts,
  buildAdminSnapshot,
  listAdminBackupFiles,
  SSO_DISCORD_ACTIVE,
  ADMIN_WEB_2FA_ACTIVE,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  SESSION_COOKIE_SAMESITE,
  SESSION_SECURE_COOKIE,
  SESSION_COOKIE_DOMAIN,
  SESSION_TTL_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_MAX_PER_USER,
  SESSION_BIND_USER_AGENT,
  ADMIN_WEB_STEP_UP_ENABLED,
  ADMIN_WEB_STEP_UP_TTL_MS,
  ADMIN_WEB_ALLOW_TOKEN_SENSITIVE_MUTATIONS,
});

const handleAdminAuthPostRoute = createAdminAuthPostRoutes({
  sendJson,
  requiredString,
  getLoginRateLimitState,
  recordAdminSecuritySignal,
  recordLoginAttempt,
  getUserByCredentials,
  adminWeb2faActive: ADMIN_WEB_2FA_ACTIVE,
  adminWeb2faSecret: ADMIN_WEB_2FA_SECRET,
  adminWeb2faWindowSteps: ADMIN_WEB_2FA_WINDOW_STEPS,
  verifyTotpCode,
  createSession,
  sessionTtlMs: SESSION_TTL_MS,
  buildSessionCookie,
  getSessionId,
  invalidateSession,
  revokeSessionsForUser,
  buildClearSessionCookie,
});

const handleAdminCommerceDeliveryPostRoute = createAdminCommerceDeliveryPostRoutes({
  sendJson,
  requiredString,
  asInt,
  parseStringArray,
  getAuthTenantId,
  resolveScopedTenantId,
  listKnownPurchaseStatuses,
  setCoinsExact,
  creditCoins,
  debitCoins,
  addShopItemForAdmin,
  setShopItemPriceForAdmin,
  deleteShopItemForAdmin,
  updatePurchaseStatusForActor,
  queueLeaderboardRefreshForAllGuilds,
  parseDeliveryItemsBody,
  enqueuePurchaseDeliveryByCode,
  retryDeliveryNow,
  retryDeliveryNowMany,
  retryDeliveryDeadLetter,
  retryDeliveryDeadLetterMany,
  removeDeliveryDeadLetter,
  cancelDeliveryJob,
  previewDeliveryCommands,
  getDeliveryPreflightReport,
  simulateDeliveryPlan,
  setDeliveryCommandOverride,
  sendTestDeliveryCommand,
  saveAdminCommandCapabilityPreset,
  getAdminCommandCapabilityPresetById,
  deleteAdminCommandCapabilityPreset,
  testScumAdminCommandCapability,
  runRentBikeMidnightReset,
  getRentBikeRuntime,
  updateScumStatusForAdmin,
  getStatus,
});

const handleAdminPortalPostRoute = createAdminPortalPostRoutes({
  sendJson,
  ensurePortalTokenAuth,
  readJsonBody,
  requiredString,
  redeemCodeForUser,
  requestRentBikeForUser,
  createBountyForUser,
});

const handleAdminPlatformPostRoute = createAdminPlatformPostRoutes({
  sendJson,
  requiredString,
  parseStringArray,
  getAuthTenantId,
  resolveScopedTenantId,
  createAdminBackup,
  previewAdminBackupRestore,
  restoreAdminBackup,
  getCurrentObservabilitySnapshot,
  publishAdminLiveUpdate,
  createTenant,
  createSubscription,
  issuePlatformLicense,
  listPlatformLicenses,
  acceptPlatformLicenseLegal,
  createPlatformApiKey,
  createPlatformWebhookEndpoint,
  dispatchPlatformWebhookEvent,
  createMarketplaceOffer,
  reconcileDeliveryState,
  runPlatformMonitoringCycle,
  acknowledgeAdminNotifications,
  clearAdminNotifications,
});

const handleAdminAuditRoute = createAdminAuditRoutes({
  ensureRole,
  sendJson,
  sendDownload,
  requiredString,
  resolveScopedTenantId,
  readJsonBody,
  buildAuditDatasetService,
  buildAuditExportPayloadService,
  buildAuditCsvService,
  listAuditPresetsService,
  saveAuditPresetService,
  deleteAuditPresetService,
  prisma,
  listEvents,
  getParticipants,
  jsonReplacer,
});

const {
  deriveRouteGroup,
  handlePostAction,
} = createAdminRouteRuntime({
  sendJson,
  handleAdminAuthPostRoute,
  handleAdminEntityPostRoute,
  handleAdminConfigPostRoute,
  handleAdminCommerceDeliveryPostRoute,
  handleAdminPortalPostRoute,
  handleAdminPlatformPostRoute,
});

const {
  startAdminWebServer,
} = createAdminServerLifecycle({
  processEnv: process.env,
  asInt,
  getAdminToken,
  buildAllowedOrigins,
  ensureMetricsSeriesTimer,
  startPlatformMonitoring,
  stopPlatformMonitoring,
  adminLiveBus,
  broadcastLiveUpdate,
  createAdminRequestHandler,
  setRequestMeta,
  deriveRouteGroup,
  getClientIp,
  getRequestOrigin,
  recordAdminRequestLog,
  handleAdminPublicRoute,
  hasValidSession,
  isSafeHttpMethod,
  violatesBrowserOriginPolicy,
  sendJson,
  getAuthContext,
  readJsonBody,
  handleAdminAuthPostRoute,
  shouldBypassRestoreMaintenance,
  isAdminRestoreMaintenanceActive,
  sendRestoreMaintenanceUnavailable,
  handleAdminAuditRoute,
  handleAdminGetRoute,
  getAdminPermissionForPath,
  requiredRoleForPostPath,
  ensureRole,
  ensureStepUpAuth,
  handlePostAction,
  publishAdminLiveUpdate,
  sendText,
  closeAllLiveStreams,
  stopMetricsSeriesTimer,
  startRuntimeSupervisorMonitor,
  stopRuntimeSupervisorMonitor,
  ensureAdminUsersReady,
  listAdminUsersFromDb,
  sessionSecureCookie: SESSION_SECURE_COOKIE,
  sessionCookieName: SESSION_COOKIE_NAME,
  sessionCookiePath: SESSION_COOKIE_PATH,
  sessionCookieSameSite: SESSION_COOKIE_SAMESITE,
  sessionCookieDomain: SESSION_COOKIE_DOMAIN,
  adminWeb2faActive: ADMIN_WEB_2FA_ACTIVE,
  adminWeb2faEnabled: ADMIN_WEB_2FA_ENABLED,
  ssoDiscordActive: SSO_DISCORD_ACTIVE,
  ssoDiscordEnabled: SSO_DISCORD_ENABLED,
});

module.exports = {
  startAdminWebServer,
};
