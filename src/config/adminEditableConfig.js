'use strict';

/** Admin control-panel registry for env keys that can be edited from the web UI. */

const path = require('node:path');

const { parseEnvFile } = require('../utils/loadEnvFiles');

function getRootEnvFilePath() {
  return path.resolve(
    String(process.env.ADMIN_WEB_ENV_FILE_PATH || path.join(process.cwd(), '.env')).trim()
      || path.join(process.cwd(), '.env'),
  );
}

function getPortalEnvFilePath() {
  return path.resolve(
    String(
      process.env.ADMIN_WEB_PORTAL_ENV_FILE_PATH
        || path.join(process.cwd(), 'apps', 'web-portal-standalone', '.env'),
    ).trim() || path.join(process.cwd(), 'apps', 'web-portal-standalone', '.env'),
  );
}

const RUNTIME_ONLY_ENV_KEYS = new Set([
  'DATABASE_URL',
  'PRISMA_SCHEMA_PROVIDER',
  'PLATFORM_DEFAULT_TENANT_ID',
  'TENANT_DB_ISOLATION_MODE',
  'TENANT_DB_TOPOLOGY_MODE',
  'TENANT_DB_SCHEMA_PREFIX',
  'TENANT_DB_DATABASE_PREFIX',
  'TENANT_DB_ADMIN_DATABASE',
]);

function defineEnvField(field) {
  const secret = field.secret === true || field.type === 'secret';
  const policy = field.policy
    || (secret
      ? 'secret-only'
      : (RUNTIME_ONLY_ENV_KEYS.has(field.key) ? 'runtime-only' : 'admin-editable'));
  const applyMode = field.applyMode || 'restart-required';
  return Object.freeze({
    ...field,
    secret,
    policy,
    applyMode,
    editable: policy === 'admin-editable' || policy === 'secret-only',
  });
}

const CONTROL_PANEL_ENV_FIELDS = Object.freeze([
  defineEnvField({
    file: 'root',
    key: 'DATABASE_URL',
    type: 'secret',
    policy: 'runtime-only',
    description: 'Primary Prisma datasource URL',
  }),
  defineEnvField({
    file: 'root',
    key: 'TENANT_DB_ISOLATION_MODE',
    type: 'text',
    policy: 'runtime-only',
    description: 'Tenant DB isolation mode for PostgreSQL runtime',
  }),
  defineEnvField({
    file: 'root',
    key: 'TENANT_DB_TOPOLOGY_MODE',
    type: 'text',
    policy: 'runtime-only',
    description: 'Tenant DB topology mode: shared, schema-per-tenant, or database-per-tenant',
  }),
  defineEnvField({
    file: 'root',
    key: 'TENANT_DB_SCHEMA_PREFIX',
    type: 'text',
    policy: 'runtime-only',
    description: 'Schema prefix used for schema-per-tenant topology',
  }),
  defineEnvField({
    file: 'root',
    key: 'TENANT_DB_DATABASE_PREFIX',
    type: 'text',
    policy: 'runtime-only',
    description: 'Database prefix used for database-per-tenant topology',
  }),
  defineEnvField({
    file: 'root',
    key: 'TENANT_DB_ADMIN_DATABASE',
    type: 'text',
    policy: 'runtime-only',
    description: 'Administrative PostgreSQL database used for tenant DB provisioning',
  }),
  defineEnvField({ file: 'root', key: 'DISCORD_TOKEN', type: 'secret', policy: 'runtime-only', description: 'Discord bot token' }),
  defineEnvField({ file: 'root', key: 'DISCORD_CLIENT_ID', type: 'text', policy: 'runtime-only', description: 'Discord application client id' }),
  defineEnvField({ file: 'root', key: 'PRISMA_SCHEMA_PROVIDER', type: 'text', description: 'Prisma provider for runtime boot' }),
  defineEnvField({ file: 'root', key: 'PERSIST_REQUIRE_DB', type: 'boolean', description: 'Require database persistence at runtime' }),
  defineEnvField({ file: 'root', key: 'PERSIST_LEGACY_SNAPSHOTS', type: 'boolean', description: 'Allow legacy file snapshots' }),
  defineEnvField({ file: 'root', key: 'DISCORD_GUILD_ID', type: 'text', description: 'Primary Discord guild binding' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_HOST', type: 'text', policy: 'runtime-only', description: 'Admin web bind host' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_PORT', type: 'number', policy: 'runtime-only', description: 'Admin web bind port' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_USER', type: 'text', policy: 'runtime-only', description: 'Bootstrap admin username' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_PASSWORD', type: 'secret', policy: 'runtime-only', description: 'Bootstrap admin password' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_TOKEN', type: 'secret', policy: 'runtime-only', description: 'Admin token auth secret' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_ENABLED', type: 'boolean', description: 'Enable Discord SSO for admin web' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_CLIENT_ID', type: 'text', description: 'Discord SSO client id for admin web' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET', type: 'secret', description: 'Discord SSO client secret for admin web' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_GUILD_ID', type: 'text', description: 'Discord guild id used by admin SSO' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DEFAULT_ROLE', type: 'text', description: 'Default admin role when SSO mapping does not match' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_OWNER_ROLE_IDS', type: 'text', description: 'Discord role ids mapped to owner' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_OWNER_ROLE_NAMES', type: 'text', description: 'Discord role names mapped to owner' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_ADMIN_ROLE_IDS', type: 'text', description: 'Discord role ids mapped to admin' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_ADMIN_ROLE_NAMES', type: 'text', description: 'Discord role names mapped to admin' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_MOD_ROLE_IDS', type: 'text', description: 'Discord role ids mapped to mod' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_MOD_ROLE_NAMES', type: 'text', description: 'Discord role names mapped to mod' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_DISCORD_REDIRECT_URI', type: 'text', policy: 'runtime-only', description: 'Explicit Discord SSO redirect URI' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SSO_STATE_TTL_MS', type: 'number', description: 'Discord SSO state TTL in milliseconds' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_2FA_ENABLED', type: 'boolean', description: 'Require TOTP for admin login' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_2FA_SECRET', type: 'secret', description: 'TOTP secret for admin login' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_2FA_WINDOW_STEPS', type: 'number', description: 'Allowed TOTP drift window for admin login' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_STEP_UP_ENABLED', type: 'boolean', description: 'Require step-up auth for sensitive admin actions' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_STEP_UP_TTL_MINUTES', type: 'number', description: 'Step-up session TTL in minutes' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SESSION_TTL_HOURS', type: 'number', description: 'Admin session TTL in hours' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SESSION_IDLE_MINUTES', type: 'number', description: 'Admin idle timeout in minutes' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SESSION_MAX_PER_USER', type: 'number', description: 'Max concurrent admin sessions per user' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SESSION_COOKIE_NAME', type: 'text', policy: 'runtime-only', description: 'Admin session cookie name' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SESSION_COOKIE_PATH', type: 'text', policy: 'runtime-only', description: 'Admin session cookie path' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SESSION_COOKIE_DOMAIN', type: 'text', policy: 'runtime-only', description: 'Admin session cookie domain' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SESSION_COOKIE_SAMESITE', type: 'text', policy: 'runtime-only', description: 'Admin session cookie SameSite policy' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_SECURE_COOKIE', type: 'boolean', description: 'Use secure cookies for admin web' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_HSTS_ENABLED', type: 'boolean', description: 'Enable HSTS headers on admin web' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_HSTS_MAX_AGE_SEC', type: 'number', description: 'HSTS max-age in seconds for admin web' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_TRUST_PROXY', type: 'boolean', policy: 'runtime-only', description: 'Trust proxy headers for admin web' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_ALLOW_TOKEN_QUERY', type: 'boolean', description: 'Allow token auth through query parameter' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_MAX_BODY_BYTES', type: 'number', policy: 'runtime-only', description: 'Max admin request body size in bytes' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_ENFORCE_ORIGIN_CHECK', type: 'boolean', description: 'Reject cross-site admin writes' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_ALLOWED_ORIGINS', type: 'text', description: 'Comma-separated trusted admin origins' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_LOGIN_WINDOW_MS', type: 'number', description: 'Admin login rate-limit window in milliseconds' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_LOGIN_MAX_ATTEMPTS', type: 'number', description: 'Admin login rate-limit attempts per window' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS', type: 'number', description: 'Admin login spike detection window in milliseconds' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_LOGIN_SPIKE_THRESHOLD', type: 'number', description: 'Admin login spike threshold across all sources' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD', type: 'number', description: 'Admin login spike threshold per IP' }),
  defineEnvField({ file: 'root', key: 'ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS', type: 'number', description: 'Cooldown for login spike alerts' }),
  defineEnvField({ file: 'root', key: 'BOT_ENABLE_ADMIN_WEB', type: 'boolean', description: 'Expose embedded admin web runtime' }),
  defineEnvField({ file: 'root', key: 'BOT_ENABLE_SCUM_WEBHOOK', type: 'boolean', description: 'Mount SCUM webhook runtime in bot process' }),
  defineEnvField({ file: 'root', key: 'BOT_ENABLE_RENTBIKE_SERVICE', type: 'boolean', description: 'Run rent-bike service in bot process' }),
  defineEnvField({ file: 'root', key: 'BOT_ENABLE_DELIVERY_WORKER', type: 'boolean', description: 'Run delivery worker in bot process' }),
  defineEnvField({ file: 'root', key: 'BOT_ENABLE_OPS_ALERT_ROUTE', type: 'boolean', description: 'Expose ops alert route in bot process' }),
  defineEnvField({ file: 'root', key: 'BOT_ENABLE_RESTART_SCHEDULER', type: 'boolean', description: 'Enable restart scheduler in bot process' }),
  defineEnvField({ file: 'root', key: 'WORKER_ENABLE_DELIVERY', type: 'boolean', description: 'Run delivery queue in worker process' }),
  defineEnvField({ file: 'root', key: 'WORKER_ENABLE_RENTBIKE', type: 'boolean', description: 'Run rent-bike queue in worker process' }),
  defineEnvField({ file: 'root', key: 'WORKER_HEALTH_HOST', type: 'text', policy: 'runtime-only', description: 'Worker health bind host' }),
  defineEnvField({ file: 'root', key: 'WORKER_HEALTH_PORT', type: 'number', policy: 'runtime-only', description: 'Worker health bind port' }),
  defineEnvField({ file: 'root', key: 'WORKER_HEARTBEAT_MS', type: 'number', description: 'Worker heartbeat interval in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_WATCHER_ENABLED', type: 'boolean', description: 'Enable SCUM log watcher runtime' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_EXECUTION_MODE', type: 'text', description: 'Delivery backend selection: rcon or agent' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_QUEUE_ALERT_THRESHOLD', type: 'number', description: 'Alert threshold for queued delivery jobs' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_QUEUE_STUCK_SLA_MS', type: 'number', description: 'Overdue threshold for stuck delivery jobs' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_METRICS_WINDOW_MS', type: 'number', description: 'Delivery metrics aggregation window in milliseconds' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_ALERT_COOLDOWN_MS', type: 'number', description: 'Cooldown between delivery alert notifications' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_FAIL_RATE_ALERT_THRESHOLD', type: 'number', description: 'Delivery failure-rate alert threshold' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_FAIL_RATE_ALERT_MIN_SAMPLES', type: 'number', description: 'Minimum samples before failure-rate alerting' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_IDEMPOTENCY_SUCCESS_WINDOW_MS', type: 'number', description: 'Success-window for delivery idempotency checks' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_MAGAZINE_STACKCOUNT', type: 'number', description: 'Default stack count for magazine delivery flow' }),
  defineEnvField({ file: 'root', key: 'RCON_HOST', type: 'text', description: 'RCON target host' }),
  defineEnvField({ file: 'root', key: 'RCON_PORT', type: 'number', description: 'RCON target port' }),
  defineEnvField({ file: 'root', key: 'RCON_PROTOCOL', type: 'text', description: 'RCON transport protocol' }),
  defineEnvField({ file: 'root', key: 'RCON_EXEC_TEMPLATE', type: 'text', description: 'Safe RCON execution template' }),
  defineEnvField({ file: 'root', key: 'RCON_PASSWORD', type: 'secret', description: 'RCON password' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_BASE_URL', type: 'text', description: 'Console-agent base URL' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_HOST', type: 'text', description: 'Console-agent bind host' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_PORT', type: 'number', description: 'Console-agent bind port' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_BACKEND', type: 'text', description: 'Console-agent backend type' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_EXEC_TEMPLATE', type: 'text', description: 'Console-agent execution template' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_TOKEN', type: 'secret', description: 'Console-agent auth token' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_REQUIRED', type: 'boolean', description: 'Treat console-agent readiness as required' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_ALLOW_NON_HASH', type: 'boolean', description: 'Allow console-agent commands without # prefix' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_AUTOSTART', type: 'boolean', description: 'Auto-start console-agent backend process' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_COMMAND_TIMEOUT_MS', type: 'number', description: 'Console-agent command timeout in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_PROCESS_RESPONSE_WAIT_MS', type: 'number', description: 'Wait time for console-agent process response' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_SERVER_EXE', type: 'text', policy: 'runtime-only', description: 'SCUM dedicated server executable path' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_SERVER_WORKDIR', type: 'text', policy: 'runtime-only', description: 'SCUM dedicated server working directory' }),
  defineEnvField({ file: 'root', key: 'SCUM_CONSOLE_AGENT_SERVER_ARGS_JSON', type: 'text', description: 'SCUM dedicated server startup args as JSON' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_FAILOVER_MODE', type: 'text', description: 'Agent failure fallback policy' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_CIRCUIT_BREAKER_THRESHOLD', type: 'number', description: 'Agent circuit-breaker failure threshold' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_CIRCUIT_BREAKER_COOLDOWN_MS', type: 'number', description: 'Agent circuit-breaker cooldown window' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_COMMAND_DELAY_MS', type: 'number', description: 'Delay between agent-mode commands' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_POST_TELEPORT_DELAY_MS', type: 'number', description: 'Delay after teleport before agent follow-up commands' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_PRE_COMMANDS_JSON', type: 'text', description: 'JSON-encoded pre-commands for agent delivery' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_POST_COMMANDS_JSON', type: 'text', description: 'JSON-encoded post-commands for agent delivery' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_TELEPORT_MODE', type: 'text', description: 'Agent teleport mode selection' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_TELEPORT_TARGET', type: 'text', description: 'Agent teleport target override' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_AGENT_RETURN_TARGET', type: 'text', description: 'Agent return target after delivery' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_VERIFY_MODE', type: 'text', description: 'Post-command verification mode' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_VERIFY_SUCCESS_REGEX', type: 'text', description: 'Success regex for delivery verify mode' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_VERIFY_FAILURE_REGEX', type: 'text', description: 'Failure regex for delivery verify mode' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_NATIVE_PROOF_MODE', type: 'text', description: 'Native delivery proof mode: disabled, optional, or required' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_NATIVE_PROOF_SCRIPT', type: 'text', description: 'External script used to produce inventory/state proof for delivery verification' }),
  defineEnvField({ file: 'root', key: 'DELIVERY_NATIVE_PROOF_TIMEOUT_MS', type: 'number', description: 'Timeout for native delivery proof script in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_URL', type: 'text', description: 'Webhook target URL' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_PORT', type: 'number', description: 'Webhook listener port' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_SECRET', type: 'secret', description: 'Webhook shared secret' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_MAX_BODY_BYTES', type: 'number', description: 'Max webhook request size in bytes' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_TIMEOUT_MS', type: 'number', description: 'Webhook end-to-end timeout in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_REQUEST_TIMEOUT_MS', type: 'number', description: 'Webhook request timeout in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_MAX_RETRIES', type: 'number', description: 'Max webhook retry attempts' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_RETRY_DELAY_MS', type: 'number', description: 'Webhook retry delay in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD', type: 'number', description: 'Webhook error-rate alert threshold' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS', type: 'number', description: 'Minimum webhook failures before alerting' }),
  defineEnvField({ file: 'root', key: 'SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS', type: 'number', description: 'Webhook alert evaluation window in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_LOG_PATH', type: 'text', description: 'SCUM.log path for watcher mode' }),
  defineEnvField({ file: 'root', key: 'SCUM_WATCHER_REQUIRED', type: 'boolean', description: 'Treat watcher readiness as required' }),
  defineEnvField({ file: 'root', key: 'SCUM_WATCHER_HEALTH_HOST', type: 'text', policy: 'runtime-only', description: 'Watcher health bind host' }),
  defineEnvField({ file: 'root', key: 'SCUM_WATCHER_HEALTH_PORT', type: 'number', policy: 'runtime-only', description: 'Watcher health bind port' }),
  defineEnvField({ file: 'root', key: 'SCUM_WATCH_INTERVAL_MS', type: 'number', description: 'Watcher poll interval in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_ALERT_COOLDOWN_MS', type: 'number', description: 'Cooldown between SCUM operational alerts' }),
  defineEnvField({ file: 'root', key: 'SCUM_QUEUE_ALERT_THRESHOLD', type: 'number', description: 'Alert threshold for SCUM event queue backlog' }),
  defineEnvField({ file: 'root', key: 'SCUM_EVENT_QUEUE_MAX', type: 'number', description: 'Max retained SCUM events in memory' }),
  defineEnvField({ file: 'root', key: 'SCUM_EVENT_DEDUP_WINDOW_MS', type: 'number', description: 'SCUM event dedupe window in milliseconds' }),
  defineEnvField({ file: 'root', key: 'SCUM_EVENT_DEDUPE_TRACK_SIZE', type: 'number', description: 'Tracked SCUM event dedupe keys' }),
  defineEnvField({ file: 'root', key: 'SCUM_DEAD_LETTER_LOG_PATH', type: 'text', description: 'Dead-letter log path for SCUM events' }),
  defineEnvField({ file: 'root', key: 'SCUM_ITEMS_BASE_URL', type: 'text', policy: 'runtime-only', description: 'Base URL for SCUM item assets' }),
  defineEnvField({ file: 'root', key: 'SCUM_ITEMS_DIR_PATH', type: 'text', policy: 'runtime-only', description: 'Local SCUM item asset directory' }),
  defineEnvField({ file: 'root', key: 'SCUM_ITEMS_IGNORE_INDEX_URL', type: 'boolean', description: 'Ignore remote SCUM item index URL' }),
  defineEnvField({ file: 'root', key: 'SCUM_ITEMS_INDEX_PATH', type: 'text', policy: 'runtime-only', description: 'Local SCUM item index path' }),
  defineEnvField({ file: 'root', key: 'SCUM_ITEM_MANIFEST_PATH', type: 'text', policy: 'runtime-only', description: 'SCUM item manifest path' }),
  defineEnvField({ file: 'root', key: 'PLATFORM_DEFAULT_TENANT_ID', type: 'text', description: 'Default tenant binding for runtime boot' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_HOST', type: 'text', policy: 'runtime-only', description: 'Player portal bind host' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_PORT', type: 'number', policy: 'runtime-only', description: 'Player portal bind port' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_BASE_URL', type: 'text', description: 'Canonical player portal URL' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_MODE', type: 'text', policy: 'runtime-only', description: 'Player portal runtime mode' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_LEGACY_ADMIN_URL', type: 'text', policy: 'runtime-only', description: 'Legacy admin URL exposed in player portal' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_DISCORD_CLIENT_ID', type: 'text', description: 'Discord OAuth client id for player portal' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_DISCORD_CLIENT_SECRET', type: 'secret', description: 'Discord OAuth client secret for player portal' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_DISCORD_GUILD_ID', type: 'text', description: 'Discord guild id required by player portal' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_DISCORD_REDIRECT_PATH', type: 'text', policy: 'runtime-only', description: 'Discord OAuth callback path for player portal' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_ALLOWED_DISCORD_IDS', type: 'text', description: 'Allowlist of Discord ids for portal access' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_PLAYER_OPEN_ACCESS', type: 'boolean', description: 'Allow player portal without guild membership' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_REQUIRE_GUILD_MEMBER', type: 'boolean', description: 'Require guild membership for portal access' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_SECURE_COOKIE', type: 'boolean', description: 'Use secure cookies in player portal' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_ENFORCE_ORIGIN_CHECK', type: 'boolean', description: 'Reject cross-site player portal writes' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_SESSION_TTL_HOURS', type: 'number', description: 'Player session TTL in hours' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_SESSION_COOKIE_NAME', type: 'text', policy: 'runtime-only', description: 'Player session cookie name' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_SESSION_COOKIE_PATH', type: 'text', policy: 'runtime-only', description: 'Player session cookie path' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_COOKIE_DOMAIN', type: 'text', policy: 'runtime-only', description: 'Player portal cookie domain' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_COOKIE_SAMESITE', type: 'text', description: 'SameSite policy for player portal cookies' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_OAUTH_STATE_TTL_MS', type: 'number', description: 'Player portal OAuth state TTL in milliseconds' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_CLEANUP_INTERVAL_MS', type: 'number', description: 'Player portal cleanup interval in milliseconds' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_MAP_EXTERNAL_URL', type: 'text', description: 'External map URL in player portal' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_MAP_EMBED_ENABLED', type: 'boolean', description: 'Enable embedded map in player portal' }),
  defineEnvField({ file: 'portal', key: 'WEB_PORTAL_MAP_EMBED_URL', type: 'text', description: 'Embedded map URL for player portal' }),
]);

const CONTROL_PANEL_ENV_INDEX = new Map(
  CONTROL_PANEL_ENV_FIELDS.map((field) => [field.key, Object.freeze({ ...field })]),
);

function normalizeBooleanEnvValue(value, fallback = false) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getControlPanelEnvFileValues() {
  return {
    root: parseEnvFile(getRootEnvFilePath()),
    portal: parseEnvFile(getPortalEnvFilePath()),
  };
}

function buildControlPanelEnvSection(fileKey, values = {}) {
  const section = {};
  for (const field of CONTROL_PANEL_ENV_FIELDS) {
    if (field.file !== fileKey) continue;
    const fileValue = Object.prototype.hasOwnProperty.call(values, field.key)
      ? values[field.key]
      : process.env[field.key];
    const configured = String(fileValue || '').trim().length > 0;
    if (field.secret) {
      section[field.key] = {
        type: field.type,
        secret: field.secret,
        policy: field.policy,
        applyMode: field.applyMode,
        editable: field.editable,
        description: field.description || '',
        configured,
        value: '',
      };
      continue;
    }
    if (field.type === 'boolean') {
      section[field.key] = {
        type: field.type,
        secret: field.secret,
        policy: field.policy,
        applyMode: field.applyMode,
        editable: field.editable,
        description: field.description || '',
        configured,
        value: normalizeBooleanEnvValue(fileValue, false),
      };
      continue;
    }
    if (field.type === 'number') {
      const text = String(fileValue || '').trim();
      const parsed = text ? Number(text) : null;
      section[field.key] = {
        type: field.type,
        secret: field.secret,
        policy: field.policy,
        applyMode: field.applyMode,
        editable: field.editable,
        description: field.description || '',
        configured,
        value: Number.isFinite(parsed) ? parsed : text,
      };
      continue;
    }
    section[field.key] = {
      type: field.type,
      secret: field.secret,
      policy: field.policy,
      applyMode: field.applyMode,
      editable: field.editable,
      description: field.description || '',
      configured,
      value: String(fileValue || ''),
    };
  }
  return section;
}

function buildControlPanelEnvCatalog(fileKey = null) {
  return CONTROL_PANEL_ENV_FIELDS
    .filter((field) => !fileKey || field.file === fileKey)
    .map((field) => ({
      file: field.file,
      key: field.key,
      type: field.type,
      secret: field.secret,
      policy: field.policy,
      applyMode: field.applyMode,
      editable: field.editable,
      description: field.description || '',
    }));
}

function buildControlPanelEnvPolicySummary(fileKey = null) {
  const summary = {
    total: 0,
    adminEditable: 0,
    runtimeOnly: 0,
    secretOnly: 0,
    reloadSafe: 0,
    restartRequired: 0,
  };

  for (const field of CONTROL_PANEL_ENV_FIELDS) {
    if (fileKey && field.file !== fileKey) continue;
    summary.total += 1;
    if (field.policy === 'admin-editable') summary.adminEditable += 1;
    if (field.policy === 'runtime-only') summary.runtimeOnly += 1;
    if (field.policy === 'secret-only') summary.secretOnly += 1;
    if (field.applyMode === 'reload-safe') summary.reloadSafe += 1;
    if (field.applyMode === 'restart-required') summary.restartRequired += 1;
  }

  return summary;
}

function getControlPanelEnvField(fileKey, key) {
  const field = CONTROL_PANEL_ENV_INDEX.get(String(key || '').trim());
  if (!field) return null;
  if (fileKey && field.file !== fileKey) return null;
  return field;
}

function normalizeControlPanelEnvChangeKeys(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return [];
}

function buildControlPanelEnvApplySummary(changeSet = {}) {
  const changed = [];
  for (const fileKey of ['root', 'portal']) {
    for (const key of normalizeControlPanelEnvChangeKeys(changeSet?.[fileKey])) {
      const field = getControlPanelEnvField(fileKey, key);
      if (!field) continue;
      changed.push({
        file: field.file,
        key: field.key,
        policy: field.policy,
        applyMode: field.applyMode,
        description: field.description || '',
      });
    }
  }

  changed.sort((left, right) =>
    `${left.file}:${left.key}`.localeCompare(`${right.file}:${right.key}`));

  const restartRequiredEntries = changed.filter((entry) => entry.applyMode === 'restart-required');
  const reloadSafeEntries = changed.filter((entry) => entry.applyMode === 'reload-safe');
  const changedFiles = Array.from(new Set(changed.map((entry) => entry.file)));
  const suggestedRestartTargets = [];
  if (restartRequiredEntries.length > 0) {
    if (changedFiles.includes('root')) {
      suggestedRestartTargets.push('all');
    } else if (changedFiles.includes('portal')) {
      suggestedRestartTargets.push('player-portal');
    }
  }

  return {
    totalChanged: changed.length,
    changedFiles,
    changed,
    restartRequired: restartRequiredEntries.length > 0,
    restartRequiredCount: restartRequiredEntries.length,
    reloadSafeCount: reloadSafeEntries.length,
    restartRequiredKeys: restartRequiredEntries.map((entry) => entry.key),
    reloadSafeKeys: reloadSafeEntries.map((entry) => entry.key),
    hotReloadOnly: changed.length > 0 && restartRequiredEntries.length === 0,
    suggestedRestartTargets,
  };
}

function normalizeEnvPatchValue(field, value) {
  if (!field) return null;
  if (field.type === 'boolean') {
    return normalizeBooleanEnvValue(value, false) ? 'true' : 'false';
  }
  if (field.type === 'number') {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid number for ${field.key}`);
    }
    return String(Math.trunc(parsed));
  }
  return String(value ?? '').trim();
}

function buildControlPanelEnvPatch(body = {}) {
  const patch = {
    root: {},
    portal: {},
  };

  for (const fileKey of ['root', 'portal']) {
    const input = body?.[fileKey];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      continue;
    }
    for (const [key, rawValue] of Object.entries(input)) {
      const field = CONTROL_PANEL_ENV_INDEX.get(String(key || '').trim());
      if (!field || field.file !== fileKey) continue;
      if (!field.editable) continue;
      if (field.secret && String(rawValue || '').trim() === '') {
        continue;
      }
      patch[fileKey][field.key] = normalizeEnvPatchValue(field, rawValue);
    }
  }

  return patch;
}

module.exports = {
  buildControlPanelEnvCatalog,
  buildControlPanelEnvApplySummary,
  buildControlPanelEnvPatch,
  buildControlPanelEnvPolicySummary,
  buildControlPanelEnvSection,
  CONTROL_PANEL_ENV_FIELDS,
  CONTROL_PANEL_ENV_INDEX,
  getControlPanelEnvField,
  getControlPanelEnvFileValues,
  getPortalEnvFilePath,
  getRootEnvFilePath,
  normalizeBooleanEnvValue,
  normalizeEnvPatchValue,
};
