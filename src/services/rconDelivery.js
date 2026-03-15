const config = require('../config');
const { prisma } = require('../prisma');
const { getLinkByUserId } = require('../store/linkStore');
const { addDeliveryAudit, listDeliveryAudit } = require('../store/deliveryAuditStore');
const {
  appendDeliveryEvidenceEvent,
  getDeliveryEvidence,
} = require('../store/deliveryEvidenceStore');
const {
  findPurchaseByCode,
  setPurchaseStatusByCode,
  getShopItemById,
  getShopItemByName,
  listPurchaseStatusHistory,
} = require('../store/memoryStore');
const { publishAdminLiveUpdate } = require('./adminLiveBus');
const {
  resolveItemIconUrl,
  normalizeItemIconKey,
  resolveCanonicalItemId,
} = require('./itemIconService');
const { resolveWikiWeaponCommandTemplate } = require('./wikiWeaponCatalog');
const { resolveManifestItemCommandTemplate } = require('./wikiItemManifestCatalog');
const {
  getBuiltInScumAdminCommandCapability,
  listBuiltInScumAdminCommandCapabilities,
  normalizeCommandTemplates: normalizeCapabilityCommandTemplates,
} = require('./scumAdminCommandCatalog');
const {
  executeCommandTemplate,
  validateCommandTemplate,
} = require('../utils/commandTemplate');

// In-memory delivery state is shared across bot, worker, and admin code paths and
// mirrored to Prisma so split-runtime deployments behave the same as single-process mode.
const jobs = new Map(); // purchaseCode -> job
const deadLetters = new Map(); // purchaseCode -> failed final delivery context
const inFlightPurchaseCodes = new Set();
const recentlyDeliveredCodes = new Map(); // purchaseCode -> timestamp
let workerStarted = false;
let workerBusy = false;
let workerTimer = null;
let workerClient = null;
const deliveryOutcomes = []; // rolling attempt outcomes
let lastQueuePressureAlertAt = 0;
let lastFailRateAlertAt = 0;
let lastQueueStuckAlertAt = 0;
let lastDeadLetterAlertAt = 0;
let lastConsecutiveFailureAlertAt = 0;
let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;
let lastPersistenceSyncAt = 0;
let persistenceSyncPromise = null;
const agentRuntimeState = {
  consecutiveFailures: 0,
  lastFailureAt: null,
  lastFailureCode: null,
  lastFailureMessage: null,
  lastSuccessAt: null,
  circuitOpenedAt: null,
  circuitOpenUntil: null,
  lastFailoverAt: null,
  lastFailoverReason: null,
};

const METRICS_WINDOW_MS = Math.max(
  60 * 1000,
  asNumber(process.env.DELIVERY_METRICS_WINDOW_MS, 5 * 60 * 1000),
);
const FAIL_RATE_ALERT_THRESHOLD = Math.min(
  1,
  Math.max(0.05, asNumber(process.env.DELIVERY_FAIL_RATE_ALERT_THRESHOLD, 0.3)),
);
const FAIL_RATE_ALERT_MIN_SAMPLES = Math.max(
  3,
  Math.trunc(asNumber(process.env.DELIVERY_FAIL_RATE_ALERT_MIN_SAMPLES, 10)),
);
const QUEUE_ALERT_THRESHOLD = Math.max(
  1,
  Math.trunc(asNumber(process.env.DELIVERY_QUEUE_ALERT_THRESHOLD, 25)),
);
const ALERT_COOLDOWN_MS = Math.max(
  15 * 1000,
  asNumber(process.env.DELIVERY_ALERT_COOLDOWN_MS, 60 * 1000),
);
const QUEUE_STUCK_SLA_MS = Math.max(
  10 * 1000,
  asNumber(process.env.DELIVERY_QUEUE_STUCK_SLA_MS, 2 * 60 * 1000),
);
const DEAD_LETTER_ALERT_THRESHOLD = Math.max(
  1,
  Math.trunc(asNumber(process.env.DELIVERY_DEAD_LETTER_ALERT_THRESHOLD, 5)),
);
const CONSECUTIVE_FAILURE_ALERT_THRESHOLD = Math.max(
  2,
  Math.trunc(asNumber(process.env.DELIVERY_CONSECUTIVE_FAILURE_ALERT_THRESHOLD, 3)),
);
const IDEMPOTENCY_SUCCESS_WINDOW_MS = Math.max(
  30 * 1000,
  asNumber(process.env.DELIVERY_IDEMPOTENCY_SUCCESS_WINDOW_MS, 12 * 60 * 60 * 1000),
);
const PERSISTENCE_SYNC_INTERVAL_MS = Math.max(
  500,
  asNumber(process.env.DELIVERY_PERSISTENCE_SYNC_INTERVAL_MS, 2000),
);

function nowIso() {
  return new Date().toISOString();
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function envFlag(value, fallback = false) {
  if (value == null || String(value).trim() === '') return fallback;
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function trimText(value, maxLen = 500) {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function sleep(ms) {
  const delay = Math.max(0, Math.trunc(Number(ms) || 0));
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function createDeliveryError(code, message, options = {}) {
  const error = new Error(String(message || 'Delivery error'));
  error.deliveryCode = String(code || 'DELIVERY_ERROR');
  error.retryable = options.retryable !== false;
  error.step = options.step ? String(options.step) : null;
  error.command = options.command ? String(options.command) : null;
  error.recoveryHint = options.recoveryHint ? String(options.recoveryHint) : null;
  error.meta = options.meta && typeof options.meta === 'object' ? options.meta : null;
  return error;
}

function normalizeDeliveryError(error, fallbackCode = 'DELIVERY_ERROR') {
  if (error && typeof error === 'object') {
    return {
      code: String(error.deliveryCode || error.agentCode || error.code || fallbackCode),
      message: trimText(error.message || String(error), 500),
      retryable: error.retryable !== false,
      step: error.step ? String(error.step) : null,
      command: error.command ? String(error.command) : null,
      recoveryHint: error.recoveryHint ? String(error.recoveryHint) : null,
      meta: error.meta && typeof error.meta === 'object' ? error.meta : null,
    };
  }

  return {
    code: fallbackCode,
    message: trimText(String(error || 'Delivery error'), 500),
    retryable: true,
    step: null,
    command: null,
    recoveryHint: null,
    meta: null,
  };
}

function formatDeliveryErrorSummary(failure) {
  const normalized = normalizeDeliveryError(failure);
  return `[${normalized.code}] ${normalized.message}`;
}

function deriveErrorCodeFromText(value, fallback = null) {
  const text = String(value || '').trim();
  const match = text.match(/^\[([A-Z0-9_:-]+)\]/);
  return match ? match[1] : fallback;
}

function summarizeCommandOutputs(outputs, maxLen = 500) {
  const commands = (Array.isArray(outputs) ? outputs : [])
    .map((entry) => String(entry?.command || '').trim())
    .filter(Boolean);
  if (commands.length === 0) return '';
  return trimText(commands.join(' | '), maxLen);
}

function canonicalizeGameItemId(value, name = null) {
  const requested = String(value || '').trim();
  if (!requested) return '';
  if (typeof resolveCanonicalItemId !== 'function') return requested;
  return (
    resolveCanonicalItemId({
      gameItemId: requested,
      id: requested,
      name,
    }) || requested
  );
}

function parseCommandList(rawValue) {
  if (rawValue == null) return [];
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  const text = String(rawValue || '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed)
        ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }
  return text
    .split(/\r?\n/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function sanitizeCommandText(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoteCommandText(value) {
  const sanitized = sanitizeCommandText(value);
  if (!sanitized) return '';
  return `"${sanitized}"`;
}

function commandTemplatesNeedTeleportTarget(commandList) {
  return (Array.isArray(commandList) ? commandList : []).some((template) =>
    /\{(?:teleportTarget|teleportTargetRaw|teleportTargetQuoted|inGameName|playerName)\}/.test(
      String(template || ''),
    ),
  );
}

function normalizeDeliveryProfileName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'spawn_only') return 'spawn_only';
  if (raw === 'teleport_spawn') return 'teleport_spawn';
  if (raw === 'announce_teleport_spawn') return 'announce_teleport_spawn';
  return null;
}

function normalizeDeliveryTeleportMode(value, fallback = null) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'player') return 'player';
  if (raw === 'vehicle') return 'vehicle';
  return fallback;
}

function normalizeDeliveryVerificationMode(value, fallback = 'basic') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'none') return 'none';
  if (raw === 'basic') return 'basic';
  if (raw === 'output-match') return 'output-match';
  if (raw === 'observer') return 'observer';
  if (raw === 'strict') return 'strict';
  return fallback;
}

function pickCommandList(envKey, fallback) {
  if (Object.prototype.hasOwnProperty.call(process.env, envKey)) {
    return parseCommandList(process.env[envKey]);
  }
  return parseCommandList(fallback);
}

// Centralize delivery runtime settings so preview, worker, and admin APIs all resolve
// commands, health checks, and retry rules from the same source of truth.
function getSettings() {
  const auto = config.delivery?.auto || {};
  return {
    enabled: auto.enabled === true,
    executionMode:
      String(
        process.env.DELIVERY_EXECUTION_MODE || auto.executionMode || 'rcon',
      )
        .trim()
        .toLowerCase() || 'rcon',
    queueIntervalMs: Math.max(250, asNumber(auto.queueIntervalMs, 1200)),
    maxRetries: Math.max(0, asNumber(auto.maxRetries, 3)),
    retryDelayMs: Math.max(500, asNumber(auto.retryDelayMs, 6000)),
    retryBackoff: Math.max(1, asNumber(auto.retryBackoff, 1.8)),
    commandTimeoutMs: Math.max(1000, asNumber(auto.commandTimeoutMs, 10000)),
    failedStatus: String(auto.failedStatus || 'delivery_failed'),
    itemCommands: auto.itemCommands && typeof auto.itemCommands === 'object'
      ? auto.itemCommands
      : {},
    wikiWeaponCommandFallbackEnabled:
      auto.wikiWeaponCommandFallbackEnabled !== false,
    itemManifestCommandFallbackEnabled:
      auto.itemManifestCommandFallbackEnabled !== false,
    agentPreCommands: pickCommandList(
      'DELIVERY_AGENT_PRE_COMMANDS_JSON',
      auto.agentPreCommands,
    ),
    agentPostCommands: pickCommandList(
      'DELIVERY_AGENT_POST_COMMANDS_JSON',
      auto.agentPostCommands,
    ),
    agentCommandDelayMs: Math.max(
      0,
      asNumber(
        process.env.DELIVERY_AGENT_COMMAND_DELAY_MS,
        auto.agentCommandDelayMs || 0,
      ),
    ),
    agentPostTeleportDelayMs: Math.max(
      0,
      asNumber(
        process.env.DELIVERY_AGENT_POST_TELEPORT_DELAY_MS,
        auto.agentPostTeleportDelayMs || 0,
      ),
    ),
    agentTeleportMode: normalizeDeliveryTeleportMode(
      process.env.DELIVERY_AGENT_TELEPORT_MODE || auto.agentTeleportMode || '',
      'player',
    ),
    agentTeleportTarget: sanitizeCommandText(
      process.env.DELIVERY_AGENT_TELEPORT_TARGET || auto.agentTeleportTarget || '',
    ),
    agentReturnTarget: sanitizeCommandText(
      process.env.DELIVERY_AGENT_RETURN_TARGET || auto.agentReturnTarget || '',
    ),
    agentFailoverMode: String(
      process.env.DELIVERY_AGENT_FAILOVER_MODE || auto.agentFailoverMode || 'none',
    ).trim().toLowerCase() || 'none',
    agentCircuitBreakerThreshold: Math.max(
      1,
      Math.trunc(
        asNumber(
          process.env.DELIVERY_AGENT_CIRCUIT_BREAKER_THRESHOLD,
          auto.agentCircuitBreakerThreshold || 2,
        ),
      ),
    ),
    agentCircuitBreakerCooldownMs: Math.max(
      1000,
      Math.trunc(
        asNumber(
          process.env.DELIVERY_AGENT_CIRCUIT_BREAKER_COOLDOWN_MS,
          auto.agentCircuitBreakerCooldownMs || 30 * 1000,
        ),
      ),
    ),
    magazineStackCount: Math.max(
      1,
      Math.trunc(
        asNumber(
          process.env.DELIVERY_MAGAZINE_STACKCOUNT,
          auto.magazineStackCount || 100,
        ),
      ),
    ),
    verifyMode: normalizeDeliveryVerificationMode(
      process.env.DELIVERY_VERIFY_MODE || auto.verifyMode || '',
      'basic',
    ),
    verifySuccessPattern: String(
      process.env.DELIVERY_VERIFY_SUCCESS_REGEX || auto.verifySuccessPattern || '',
    ).trim(),
    verifyFailurePattern: String(
      process.env.DELIVERY_VERIFY_FAILURE_REGEX || auto.verifyFailurePattern || '',
    ).trim(),
    verifyObserverWindowMs: Math.max(
      5000,
      asNumber(
        process.env.DELIVERY_VERIFY_OBSERVER_WINDOW_MS,
        auto.verifyObserverWindowMs || 60 * 1000,
      ),
    ),
  };
}

function normalizeCommands(rawValue) {
  if (!rawValue) return [];
  if (typeof rawValue === 'string') {
    return rawValue.trim() ? [rawValue.trim()] : [];
  }
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((line) => String(line || '').trim())
      .filter((line) => line.length > 0);
  }
  if (rawValue && typeof rawValue === 'object') {
    if (typeof rawValue.command === 'string') {
      const single = rawValue.command.trim();
      return single ? [single] : [];
    }
    if (Array.isArray(rawValue.commands)) {
      return rawValue.commands
        .map((line) => String(line || '').trim())
        .filter((line) => line.length > 0);
    }
  }
  return [];
}

function extractCommandPlaceholders(command) {
  const placeholders = new Set();
  const text = String(command || '');
  for (const match of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    const key = String(match[1] || '').trim();
    if (key) placeholders.add(key);
  }
  return Array.from(placeholders);
}

function collectUnresolvedPlaceholders(commands = []) {
  const unresolved = new Set();
  for (const command of Array.isArray(commands) ? commands : []) {
    for (const key of extractCommandPlaceholders(command)) {
      unresolved.add(key);
    }
  }
  return Array.from(unresolved);
}

function isTeleportCommand(command) {
  const text = String(command || '').trim();
  return /^#TeleportTo(?:Vehicle)?\b/i.test(text);
}

function isSpawnItemCommand(command) {
  const text = String(command || '').trim();
  return /^#SpawnItem\b/i.test(text);
}

function isAnnounceCommand(command) {
  const text = String(command || '').trim();
  return /^#Announce\b/i.test(text);
}

function classifyCommandOperation(command, phase = 'item') {
  const text = String(command || '').trim();
  if (!text) {
    return {
      stage: 'command',
      step: `${phase}-command`,
      title: 'Command',
      kind: 'command',
    };
  }
  if (isAnnounceCommand(text)) {
    return {
      stage: 'command',
      step: 'announce-sent',
      title: 'Announce sent',
      kind: 'announce',
    };
  }
  if (isTeleportCommand(text)) {
    return {
      stage: 'command',
      step: 'teleport-sent',
      title: 'Teleport sent',
      kind: 'teleport',
    };
  }
  if (isSpawnItemCommand(text)) {
    return {
      stage: 'delivery',
      step: 'spawn-sent',
      title: 'Spawn sent',
      kind: 'spawn',
    };
  }
  return {
    stage: phase === 'pre' ? 'preflight' : phase === 'post' ? 'cleanup' : 'command',
    step: `${phase}-command`,
    title: `${phase} command sent`,
    kind: 'command',
  };
}

function inferAuditSource(action, meta = {}) {
  const explicit = String(meta.source || '').trim();
  if (explicit) return explicit;
  if (action === 'queued' || action === 'attempt' || action === 'worker-picked') {
    return 'worker';
  }
  if (String(action || '').startsWith('preflight')) return 'agent';
  if (action === 'command-dispatch' || action === 'command-ok') {
    return meta.phase === 'item' ? 'game-command' : 'agent-hook';
  }
  if (action === 'retry' || action === 'failed' || action === 'success') {
    return 'worker';
  }
  return 'delivery';
}

function inferAuditStage(action, meta = {}) {
  const explicit = String(meta.stage || '').trim();
  if (explicit) return explicit;
  const step = String(meta.step || '').trim();
  if (step === 'queued') return 'queue';
  if (step === 'worker-picked' || action === 'attempt') return 'worker';
  if (String(action || '').startsWith('preflight')) return 'preflight';
  if (action === 'command-dispatch' || action === 'command-ok') {
    return meta.phase === 'item' ? 'delivery' : 'command';
  }
  if (action === 'command-failed') {
    return String(meta.stage || (meta.phase === 'item' ? 'delivery' : 'command')).trim()
      || 'delivery';
  }
  if (action === 'verify-ok' || action === 'verify-failed') return 'verify';
  if (action === 'retry') return 'retry';
  if (action === 'manual-retry' || action === 'dead-letter-retry') return 'retry';
  if (action === 'failed') return 'failed';
  if (action === 'success') return 'completed';
  if (action === 'manual-cancel') return 'cancelled';
  return 'delivery';
}

function inferAuditStatus(action, level, meta = {}) {
  const explicit = String(meta.status || '').trim();
  if (explicit) return explicit;
  if (level === 'error') return 'failed';
  if (level === 'warn' && action === 'retry') return 'retrying';
  if (action === 'manual-retry' || action === 'dead-letter-retry') return 'retrying';
  if (action === 'verify-failed') return 'failed';
  if (action === 'verify-ok') return 'ok';
  if (action === 'command-dispatch' || action === 'preflight-start') return 'running';
  if (action === 'queued') return 'queued';
  if (action === 'success') return 'completed';
  if (action === 'manual-cancel') return 'cancelled';
  return 'ok';
}

function inferAuditTitle(action, meta = {}) {
  const explicit = String(meta.title || '').trim();
  if (explicit) return explicit;
  if (action === 'queued') return 'Queued';
  if (action === 'worker-picked' || action === 'attempt') return 'Worker picked job';
  if (action === 'preflight-start') return 'Preflight started';
  if (action === 'preflight-ok') return 'Preflight passed';
  if (action === 'command-dispatch') return String(meta.commandTitle || 'Command dispatched');
  if (action === 'command-ok') return String(meta.commandTitle || 'Command complete');
  if (action === 'command-failed') return String(meta.commandTitle || 'Command failed');
  if (action === 'verify-ok') return 'Verification passed';
  if (action === 'verify-failed') return 'Verification failed';
  if (action === 'retry') return 'Retry scheduled';
  if (action === 'manual-retry') return 'Manual retry requested';
  if (action === 'dead-letter-retry') return 'Dead-letter requeued';
  if (action === 'failed') return 'Delivery failed';
  if (action === 'success') return 'Delivery completed';
  if (action === 'manual-cancel') return 'Queue job cancelled';
  return String(action || 'event').replace(/-/g, ' ');
}

function normalizeTimelineEvent(event = {}) {
  if (!event || typeof event !== 'object') return null;
  const createdAt = event.at ? new Date(event.at) : new Date();
  const outputs = Array.isArray(event.outputs) ? event.outputs : [];
  return {
    id: String(event.id || createEventId('timeline')).trim() || createEventId('timeline'),
    at: Number.isNaN(createdAt.getTime()) ? nowIso() : createdAt.toISOString(),
    level: String(event.level || 'info').trim() || 'info',
    action: String(event.action || 'event').trim() || 'event',
    stage: String(event.stage || 'delivery').trim() || 'delivery',
    source: String(event.source || 'delivery').trim() || 'delivery',
    status: String(event.status || 'ok').trim() || 'ok',
    step: String(event.step || event.action || 'event').trim() || 'event',
    title: String(event.title || event.step || event.action || 'Event').trim() || 'Event',
    errorCode: String(event.errorCode || '').trim() || null,
    retryable: typeof event.retryable === 'boolean' ? event.retryable : null,
    recoveryHint: String(event.recoveryHint || '').trim() || null,
    message: String(event.message || '').trim() || '',
    command: String(event.command || '').trim() || null,
    commandSummary: String(event.commandSummary || '').trim() || null,
    outputs,
    meta: event.meta && typeof event.meta === 'object' ? event.meta : null,
  };
}

function createEventId(prefix = 'delivery') {
  const suffix = Math.random().toString(16).slice(2, 10);
  return `${prefix}-${Date.now()}-${suffix}`;
}

function buildTimelineEventFromAudit(row) {
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  const outputs = Array.isArray(meta.outputs) ? meta.outputs : [];
  return normalizeTimelineEvent({
    id: row?.id || createEventId('audit'),
    at: row?.createdAt,
    level: row?.level || 'info',
    action: row?.action || 'event',
    stage: inferAuditStage(row?.action, meta),
    source: inferAuditSource(row?.action, meta),
    status: inferAuditStatus(row?.action, row?.level, meta),
    step: String(meta.step || row?.action || '').trim() || null,
    title: inferAuditTitle(row?.action, meta),
    errorCode:
      String(meta.errorCode || deriveErrorCodeFromText(row?.message, '')).trim() || null,
    retryable: typeof meta.retryable === 'boolean' ? meta.retryable : null,
    recoveryHint: String(meta.recoveryHint || '').trim() || null,
    message: row?.message || '',
    command: String(meta.command || '').trim() || null,
    commandSummary: meta.commandSummary || null,
    outputs,
    meta,
  });
}

function buildTimelineEventsFromStatusHistory(statusHistory = []) {
  return (Array.isArray(statusHistory) ? statusHistory : [])
    .map((row) => normalizeTimelineEvent({
      id: `status-${row?.id || createEventId('status')}`,
      at: row?.createdAt,
      level: 'info',
      action: 'purchase-status',
      stage: 'purchase-status',
      source: 'purchase',
      status:
        String(row?.toStatus || '').trim().toLowerCase() === 'delivery_failed'
          ? 'failed'
          : String(row?.toStatus || '').trim().toLowerCase() === 'delivered'
            ? 'completed'
            : 'ok',
      step: String(row?.toStatus || 'pending').trim() || 'pending',
      title: `Purchase status: ${String(row?.toStatus || 'pending').trim() || 'pending'}`,
      message: String(row?.reason || '').trim() || 'Purchase status updated',
      meta: row?.metaJson ? { metaJson: row.metaJson } : null,
    }))
    .filter(Boolean);
}

function buildDeliveryTimeline(statusHistory = [], auditRows = []) {
  const timeline = [
    ...buildTimelineEventsFromStatusHistory(statusHistory),
    ...(Array.isArray(auditRows) ? auditRows.map((row) => buildTimelineEventFromAudit(row)) : []),
  ].filter(Boolean);
  timeline.sort((left, right) => new Date(left.at) - new Date(right.at));
  return timeline;
}

function isMagazineGameItemId(gameItemId) {
  const canonical = canonicalizeGameItemId(gameItemId);
  return /^magazine_/i.test(String(canonical || '').trim());
}

function applySpawnItemModifiers(command, vars, settings = getSettings()) {
  const text = String(command || '').trim();
  if (!text || !isSpawnItemCommand(text)) return text;
  if (!isMagazineGameItemId(vars?.gameItemId)) return text;
  if (/\bStackCount\b/i.test(text)) return text;

  const stackCount = Math.max(
    1,
    Math.trunc(Number(settings?.magazineStackCount || 100)),
  );
  return `${text} StackCount ${stackCount}`;
}

function renderItemCommand(template, vars, settings = getSettings(), options = {}) {
  const runtimeTemplate = options.singlePlayer
    ? adaptCommandTemplateForSinglePlayer(template)
    : template;
  const substituted = substituteTemplate(runtimeTemplate, vars);
  return applySpawnItemModifiers(substituted, vars, settings);
}

function buildDeliveryTemplateVars(context = {}, settings = getSettings()) {
  const inGameName = sanitizeCommandText(context.inGameName || context.playerName || '');
  const explicitTeleportTarget = sanitizeCommandText(context.teleportTarget || '');
  const teleportMode = normalizeDeliveryTeleportMode(
    context.teleportMode || settings.agentTeleportMode,
    'player',
  );
  const teleportTarget = sanitizeCommandText(
    explicitTeleportTarget || inGameName || '',
  );
  const returnTarget = sanitizeCommandText(
    context.returnTarget || settings.agentReturnTarget || '',
  );
  return {
    steamId: String(context.steamId || '').trim(),
    itemId: String(context.itemId || '').trim(),
    itemName: String(context.itemName || '').trim(),
    announceText: sanitizeCommandText(context.announceText || context.adminMessage || ''),
    gameItemId: String(context.gameItemId || '').trim(),
    quantity: Math.max(1, Math.trunc(Number(context.quantity || 1))),
    itemKind: String(context.itemKind || 'item').trim() || 'item',
    userId: String(context.userId || '').trim(),
    purchaseCode: String(context.purchaseCode || '').trim(),
    inGameName,
    playerName: inGameName,
    teleportMode,
    explicitTeleportTarget,
    teleportTarget,
    teleportTargetRaw: teleportTarget,
    teleportTargetQuoted: quoteCommandText(teleportTarget),
    returnTarget,
    returnTargetQuoted: quoteCommandText(returnTarget),
  };
}

function buildTeleportCommandTemplate(teleportMode) {
  return teleportMode === 'vehicle'
    ? '#TeleportToVehicle {teleportTargetRaw}'
    : '#TeleportTo {teleportTargetQuoted}';
}

function getDeliveryProfileCommandTemplates(
  profile,
  hasReturnTarget = false,
  teleportMode = 'player',
) {
  const normalized = normalizeDeliveryProfileName(profile);
  if (!normalized || normalized === 'spawn_only') {
    return { preCommands: [], postCommands: [] };
  }
  if (normalized === 'teleport_spawn') {
    return {
      preCommands: [buildTeleportCommandTemplate(teleportMode)],
      postCommands: hasReturnTarget ? ['#TeleportTo {returnTargetQuoted}'] : [],
    };
  }
  if (normalized === 'announce_teleport_spawn') {
    return {
      preCommands: [
        '#Announce Delivering {itemName} to {teleportTarget}',
        buildTeleportCommandTemplate(teleportMode),
      ],
      postCommands: hasReturnTarget ? ['#TeleportTo {returnTargetQuoted}'] : [],
    };
  }
  return { preCommands: [], postCommands: [] };
}

function resolveAgentHookPlan(shopItem, vars, settings = getSettings()) {
  const deliveryProfile = normalizeDeliveryProfileName(shopItem?.deliveryProfile);
  const deliveryTeleportMode = normalizeDeliveryTeleportMode(
    shopItem?.deliveryTeleportMode || vars.teleportMode || settings.agentTeleportMode,
    'player',
  );
  const deliveryTeleportTarget = sanitizeCommandText(
    shopItem?.deliveryTeleportTarget
      || vars.explicitTeleportTarget
      || (
        deliveryTeleportMode === 'vehicle'
          ? settings.agentTeleportTarget
          : vars.teleportTarget || settings.agentTeleportTarget || ''
      ),
  );
  const itemPreTemplates = normalizeCommands(
    shopItem?.deliveryPreCommands || shopItem?.deliveryPreCommandsJson,
  );
  const itemPostTemplates = normalizeCommands(
    shopItem?.deliveryPostCommands || shopItem?.deliveryPostCommandsJson,
  );
  const deliveryReturnTarget = sanitizeCommandText(
    shopItem?.deliveryReturnTarget || vars.returnTarget || settings.agentReturnTarget || '',
  );
  const scopedVars = {
    ...vars,
    teleportMode: deliveryTeleportMode,
    teleportTarget: deliveryTeleportTarget,
    teleportTargetRaw: deliveryTeleportTarget,
    teleportTargetQuoted: quoteCommandText(deliveryTeleportTarget),
    returnTarget: deliveryReturnTarget,
    returnTargetQuoted: quoteCommandText(deliveryReturnTarget),
  };

  let preTemplates = settings.agentPreCommands;
  let postTemplates = settings.agentPostCommands;

  if (deliveryProfile) {
    const profileTemplates = getDeliveryProfileCommandTemplates(
      deliveryProfile,
      Boolean(deliveryReturnTarget),
      deliveryTeleportMode,
    );
    preTemplates = profileTemplates.preCommands;
    postTemplates = profileTemplates.postCommands;
  }

  if (itemPreTemplates.length > 0) {
    preTemplates = itemPreTemplates;
  }
  if (itemPostTemplates.length > 0) {
    postTemplates = itemPostTemplates;
  }

  return {
    deliveryProfile,
    deliveryTeleportMode,
    deliveryTeleportTarget: deliveryTeleportTarget || null,
    deliveryReturnTarget: deliveryReturnTarget || null,
    requiresTeleportTarget: commandTemplatesNeedTeleportTarget([
      ...preTemplates,
      ...postTemplates,
    ]),
    preCommands:
      settings.executionMode === 'agent'
        ? preTemplates
            .map((template) => substituteTemplate(template, scopedVars))
            .filter(Boolean)
        : [],
    postCommands:
      settings.executionMode === 'agent'
        ? postTemplates
            .map((template) => substituteTemplate(template, scopedVars))
            .filter(Boolean)
        : [],
  };
}

function resolveExecutionPlan(preview, vars, settings = getSettings(), agentHooks = null) {
  const serverCommands = Array.isArray(preview?.serverCommands)
    ? preview.serverCommands.filter((entry) => String(entry || '').trim())
    : [];
  const singlePlayerCommands = Array.isArray(preview?.singlePlayerCommands)
    ? preview.singlePlayerCommands.filter((entry) => String(entry || '').trim())
    : [];
  const agentPreCommands =
    settings.executionMode === 'agent'
      ? (
          Array.isArray(agentHooks?.preCommands)
            ? agentHooks.preCommands
            : settings.agentPreCommands
                .map((template) => substituteTemplate(template, vars))
                .filter(Boolean)
        )
      : [];
  const agentPostCommands =
    settings.executionMode === 'agent'
      ? (
          Array.isArray(agentHooks?.postCommands)
            ? agentHooks.postCommands
            : settings.agentPostCommands
                .map((template) => substituteTemplate(template, vars))
                .filter(Boolean)
        )
      : [];
  const itemCommands =
    settings.executionMode === 'agent' ? singlePlayerCommands : serverCommands;
  return {
    agentPreCommands,
    itemCommands,
    agentPostCommands,
    allCommands: [...agentPreCommands, ...itemCommands, ...agentPostCommands],
  };
}

function findCommandOverride(commandMap, rawKey) {
  if (!commandMap || typeof commandMap !== 'object') return null;
  const target = String(rawKey || '').trim();
  if (!target) return null;

  if (Object.prototype.hasOwnProperty.call(commandMap, target)) {
    return commandMap[target];
  }

  const lowerTarget = target.toLowerCase();
  if (
    lowerTarget !== target
    && Object.prototype.hasOwnProperty.call(commandMap, lowerTarget)
  ) {
    return commandMap[lowerTarget];
  }

  const normalizedTarget = normalizeItemIconKey(target);
  if (!normalizedTarget) return null;
  const normalizedWithoutClassSuffix = normalizedTarget.replace(/_c\d*$/i, '');
  const normalizedWithoutBp = normalizedTarget.replace(/^bp_+/, '');
  const normalizedCandidates = new Set([
    normalizedTarget,
    normalizedWithoutClassSuffix,
    normalizedWithoutBp,
  ]);

  for (const [rawMapKey, value] of Object.entries(commandMap)) {
    const normalizedMapKey = normalizeItemIconKey(rawMapKey);
    if (!normalizedMapKey) continue;
    const normalizedMapKeyWithoutClassSuffix = normalizedMapKey.replace(
      /_c\d*$/i,
      '',
    );
    const normalizedMapKeyWithoutBp = normalizedMapKey.replace(/^bp_+/, '');
    if (
      normalizedCandidates.has(normalizedMapKey)
      || normalizedCandidates.has(normalizedMapKeyWithoutClassSuffix)
      || normalizedCandidates.has(normalizedMapKeyWithoutBp)
    ) {
      return value;
    }
  }

  return null;
}

function resolveItemCommandPlan(itemId, gameItemId = null) {
  const settings = getSettings();
  const byItemId = findCommandOverride(settings.itemCommands, itemId);
  const normalizedByItemId = normalizeCommands(byItemId);
  if (normalizedByItemId.length > 0) {
    return {
      source: 'itemCommands:itemId',
      lookupKey: String(itemId || '').trim() || null,
      commands: normalizedByItemId,
    };
  }

  const byGameItemId = findCommandOverride(settings.itemCommands, gameItemId);
  const normalizedByGameItemId = normalizeCommands(byGameItemId);
  if (normalizedByGameItemId.length > 0) {
    return {
      source: 'itemCommands:gameItemId',
      lookupKey: String(gameItemId || '').trim() || null,
      commands: normalizedByGameItemId,
    };
  }

  if (settings.wikiWeaponCommandFallbackEnabled) {
    const wikiTemplate = resolveWikiWeaponCommandTemplate(gameItemId);
    const normalizedWikiTemplate = normalizeCommands(wikiTemplate);
    if (normalizedWikiTemplate.length > 0) {
      return {
        source: 'wiki-weapon-fallback',
        lookupKey: String(gameItemId || '').trim() || null,
        commands: normalizedWikiTemplate,
      };
    }
  }

  if (settings.itemManifestCommandFallbackEnabled) {
    const manifestTemplate = resolveManifestItemCommandTemplate(gameItemId);
    const normalizedManifestTemplate = normalizeCommands(manifestTemplate);
    if (normalizedManifestTemplate.length > 0) {
      return {
        source: 'item-manifest-fallback',
        lookupKey: String(gameItemId || '').trim() || null,
        commands: normalizedManifestTemplate,
      };
    }
  }

  return {
    source: 'none',
    lookupKey: String(itemId || gameItemId || '').trim() || null,
    commands: [],
  };
}

function resolveItemCommands(itemId, gameItemId = null) {
  return resolveItemCommandPlan(itemId, gameItemId).commands;
}

function commandSupportsBundleItems(commands) {
  return commands.some(
    (template) =>
      String(template).includes('{gameItemId}')
      || String(template).includes('{quantity}'),
  );
}

function substituteTemplate(template, vars) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    if (!(key in vars)) return `{${key}}`;
    const value = vars[key];
    if (value == null) return '';
    return String(value);
  });
}

function adaptCommandTemplateForSinglePlayer(template) {
  const raw = String(template || '').trim();
  if (!raw) return raw;

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return raw;
  if (!/^#spawnitem$/i.test(tokens[0])) {
    return raw;
  }

  return tokens.filter((token) => token !== '{steamId}').join(' ').trim();
}

async function previewDeliveryCommands(options = {}) {
  const requestedItemId = String(options.itemId || '').trim();
  const requestedGameItemId = String(options.gameItemId || '').trim();
  const requestedItemName = String(options.itemName || '').trim();
  const requestedSteamId =
    String(options.steamId || '').trim() || '76561198000000000';
  const requestedUserId = String(options.userId || '').trim() || 'preview-user';
  const requestedPurchaseCode =
    String(options.purchaseCode || '').trim() || 'PREVIEW-CODE';

  let shopItem = null;
  if (requestedItemId) {
    shopItem = await getShopItemById(requestedItemId).catch(() => null);
    if (!shopItem) {
      shopItem = await getShopItemByName(requestedItemId).catch(() => null);
    }
  }

  const normalizedQuantity = Math.max(
    1,
    Math.trunc(Number(options.quantity || shopItem?.quantity || 1)),
  );
  const resolvedItemId =
    String(shopItem?.id || requestedItemId || requestedGameItemId).trim();
  const resolvedItemName =
    String(shopItem?.name || requestedItemName || resolvedItemId).trim();
  const deliveryItems = normalizeDeliveryItemsForJob(
    Array.isArray(options.deliveryItems) ? options.deliveryItems : shopItem?.deliveryItems,
    {
      gameItemId:
        requestedGameItemId || shopItem?.gameItemId || resolvedItemId || null,
      quantity: normalizedQuantity,
      iconUrl: String(options.iconUrl || shopItem?.iconUrl || '').trim() || null,
    },
  );
  const primary = deliveryItems[0] || null;
  const resolvedQuantity = Math.max(
    1,
    Math.trunc(Number(primary?.quantity || normalizedQuantity || 1)),
  );
  const resolvedGameItemId = String(
    primary?.gameItemId || requestedGameItemId || shopItem?.gameItemId || resolvedItemId,
  ).trim();

  if (!resolvedItemId && !resolvedGameItemId) {
    throw new Error('itemId or gameItemId is required');
  }

  const commandPlan = resolveItemCommandPlan(resolvedItemId, resolvedGameItemId);
  const commands = commandPlan.commands;
  const iconUrl =
    String(primary?.iconUrl || options.iconUrl || shopItem?.iconUrl || '').trim()
    || resolveItemIconUrl({
      id: resolvedItemId || resolvedGameItemId,
      gameItemId: resolvedGameItemId,
      name: resolvedItemName,
    })
    || null;
  const settings = getSettings();
    const vars = buildDeliveryTemplateVars(
      {
        steamId: requestedSteamId,
        itemId: resolvedItemId,
        itemName: resolvedItemName,
        gameItemId: resolvedGameItemId,
      quantity: resolvedQuantity,
      itemKind: String(options.itemKind || shopItem?.kind || 'item').trim() || 'item',
        userId: requestedUserId,
        purchaseCode: requestedPurchaseCode,
        inGameName: options.inGameName || options.playerName || '',
        teleportTarget:
          options.teleportTarget
          || shopItem?.deliveryTeleportTarget
          || '',
        teleportMode:
          options.teleportMode
          || shopItem?.deliveryTeleportMode
          || '',
        returnTarget: options.returnTarget || '',
      },
      settings,
    );
  const agentHooks = resolveAgentHookPlan(shopItem, vars, settings);
  const serverCommands = commands.map((template) =>
    renderItemCommand(template, vars, settings),
  );
  const singlePlayerCommands = commands.map((template) =>
    renderItemCommand(template, vars, settings, { singlePlayer: true }),
  );
  const executionPlan = resolveExecutionPlan(
    {
      serverCommands,
      singlePlayerCommands,
    },
    vars,
    settings,
    agentHooks,
  );
  const unresolvedPlaceholders = collectUnresolvedPlaceholders(executionPlan.allCommands);

  return {
    executionMode: settings.executionMode,
    itemId: resolvedItemId || null,
    itemName: resolvedItemName || null,
    gameItemId: resolvedGameItemId || null,
    quantity: resolvedQuantity,
    itemKind: String(options.itemKind || shopItem?.kind || 'item').trim() || 'item',
    iconUrl,
    shopItem: shopItem
      ? {
          id: shopItem.id,
          name: shopItem.name,
          kind: shopItem.kind,
          deliveryProfile: shopItem.deliveryProfile || null,
          deliveryTeleportMode: shopItem.deliveryTeleportMode || null,
          deliveryTeleportTarget: shopItem.deliveryTeleportTarget || null,
          deliveryReturnTarget: shopItem.deliveryReturnTarget || null,
        }
      : null,
    deliveryItems,
    deliveryProfile: shopItem?.deliveryProfile || null,
    deliveryTeleportMode:
      agentHooks.deliveryTeleportMode || shopItem?.deliveryTeleportMode || null,
    deliveryTeleportTarget:
      agentHooks.deliveryTeleportTarget || shopItem?.deliveryTeleportTarget || null,
    deliveryReturnTarget:
      agentHooks.deliveryReturnTarget || shopItem?.deliveryReturnTarget || null,
    commandSource: commandPlan.source,
    commandLookupKey: commandPlan.lookupKey,
    commandTemplates: commands,
    serverCommands,
    singlePlayerCommands,
    agentPreCommands: executionPlan.agentPreCommands,
    agentPostCommands: executionPlan.agentPostCommands,
    allCommands: executionPlan.allCommands,
    unresolvedPlaceholders,
    verificationPlan: buildVerificationPlan(settings),
  };
}

async function sendTestDeliveryCommand(options = {}) {
  const preview = await previewDeliveryCommands(options);
  const settings = getSettings();
  const commandTemplates = Array.isArray(preview.commandTemplates)
    ? preview.commandTemplates.filter((entry) => String(entry || '').trim())
    : [];
  if (commandTemplates.length === 0) {
    throw new Error('No delivery command template found for requested item');
  }
  if (Array.isArray(preview.unresolvedPlaceholders) && preview.unresolvedPlaceholders.length > 0) {
    throw new Error(`Unresolved placeholders: ${preview.unresolvedPlaceholders.join(', ')}`);
  }

  const steamId = String(options.steamId || '').trim() || '76561198000000000';
  const userId = String(options.userId || '').trim() || 'admin-test-send';
  const purchaseCode = String(options.purchaseCode || '').trim() || null;
  const outputs = [];

  await runDeliveryPreflight(
    {
      purchaseCode: purchaseCode || 'TEST-SEND',
      userId,
      itemId: preview.itemId || preview.gameItemId || null,
      itemName: preview.itemName || preview.itemId || preview.gameItemId || null,
    },
    settings,
    {
      purchaseCode: purchaseCode || 'TEST-SEND',
      itemId: preview.itemId || preview.gameItemId || null,
      steamId,
    },
  );

  for (const deliveryItem of preview.deliveryItems || []) {
    const vars = {
      steamId,
      itemId: preview.itemId || preview.gameItemId || null,
      itemName: preview.itemName || preview.itemId || preview.gameItemId || null,
      gameItemId: String(deliveryItem?.gameItemId || preview.gameItemId || '').trim(),
      quantity: Math.max(1, Math.trunc(Number(deliveryItem?.quantity || preview.quantity || 1))),
      itemKind: String(preview.itemKind || 'item').trim() || 'item',
      userId,
      purchaseCode: purchaseCode || 'TEST-SEND',
    };

    for (const template of commandTemplates) {
      const gameCommand = renderItemCommand(
        template,
        vars,
        settings,
        { singlePlayer: settings.executionMode === 'agent' },
      );
      const output = await runGameCommand(gameCommand, settings);
      outputs.push({
        mode: output.mode || settings.executionMode,
        backend: output.backend || null,
        gameItemId: vars.gameItemId,
        quantity: vars.quantity,
        command: output.command,
        stdout: output.stdout,
        stderr: output.stderr,
      });
    }
  }

  const verification = await verifyDeliveryExecution(outputs, settings, {
    purchaseCode: purchaseCode || 'TEST-SEND',
  });
  const commandSummary = summarizeCommandOutputs(outputs, 700);
  addDeliveryAudit({
    level: verification.ok ? 'info' : 'warn',
    action: 'manual-test-send',
    purchaseCode,
    itemId: preview.itemId || preview.gameItemId || null,
    userId,
    steamId,
    message: commandSummary
      ? `Manual test send complete | commands: ${commandSummary}`
      : 'Manual test send complete',
    meta: buildExecutionAuditMeta(
      {
        purchaseCode,
        userId,
        itemId: preview.itemId || preview.gameItemId || null,
        attempts: 0,
        executionMode: settings.executionMode,
        executionBackend: defaultExecutionBackendForMode(settings.executionMode),
        commandPath: buildCommandPath({
          executionMode: settings.executionMode,
          backend: defaultExecutionBackendForMode(settings.executionMode),
          stage: 'command',
          source: 'admin',
        }),
      },
      {
      source: 'admin-web',
      executionMode: settings.executionMode,
      deliveryItems: preview.deliveryItems || [],
      outputs,
      commandSummary: commandSummary || null,
      verification,
      },
      settings,
    ),
  });

  return {
    ...preview,
    purchaseCode,
    steamId,
    userId,
    outputs,
    commandSummary,
    verification,
  };
}

function getRconTemplate() {
  const envTemplate = String(process.env.RCON_EXEC_TEMPLATE || '').trim();
  if (envTemplate) return envTemplate;
  const configTemplate = String(config.delivery?.auto?.rconExecTemplate || '').trim();
  if (configTemplate) return configTemplate;
  return '';
}

function getAgentBaseUrl() {
  const explicit = String(process.env.SCUM_CONSOLE_AGENT_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = String(process.env.SCUM_CONSOLE_AGENT_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = Math.max(
    1,
    Math.trunc(asNumber(process.env.SCUM_CONSOLE_AGENT_PORT, 3213)),
  );
  return `http://${host}:${port}`;
}

function normalizeFailoverMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'rcon') return 'rcon';
  return 'none';
}

function clearExpiredAgentCircuit(now = Date.now()) {
  const openUntil = Number(agentRuntimeState.circuitOpenUntil || 0);
  if (openUntil > 0 && openUntil <= now) {
    agentRuntimeState.circuitOpenUntil = null;
    agentRuntimeState.circuitOpenedAt = null;
    agentRuntimeState.consecutiveFailures = 0;
    agentRuntimeState.lastFailureCode = null;
    agentRuntimeState.lastFailureMessage = null;
  }
}

function getAgentCircuitState(now = Date.now()) {
  clearExpiredAgentCircuit(now);
  const openUntil = Number(agentRuntimeState.circuitOpenUntil || 0);
  return {
    open: openUntil > now,
    consecutiveFailures: Math.max(0, Number(agentRuntimeState.consecutiveFailures || 0)),
    lastFailureAt: agentRuntimeState.lastFailureAt || null,
    lastFailureCode: agentRuntimeState.lastFailureCode || null,
    lastFailureMessage: agentRuntimeState.lastFailureMessage || null,
    lastSuccessAt: agentRuntimeState.lastSuccessAt || null,
    circuitOpenedAt: agentRuntimeState.circuitOpenedAt || null,
    circuitOpenUntil: openUntil > now ? new Date(openUntil).toISOString() : null,
    lastFailoverAt: agentRuntimeState.lastFailoverAt || null,
    lastFailoverReason: agentRuntimeState.lastFailoverReason || null,
  };
}

function recordAgentSuccess() {
  agentRuntimeState.consecutiveFailures = 0;
  agentRuntimeState.lastFailureCode = null;
  agentRuntimeState.lastFailureMessage = null;
  agentRuntimeState.lastFailureAt = null;
  agentRuntimeState.circuitOpenedAt = null;
  agentRuntimeState.circuitOpenUntil = null;
  agentRuntimeState.lastSuccessAt = nowIso();
}

function recordAgentFailure(error, settings) {
  const wasOpen = Number(agentRuntimeState.circuitOpenUntil || 0) > Date.now();
  agentRuntimeState.consecutiveFailures = Math.max(
    0,
    Number(agentRuntimeState.consecutiveFailures || 0),
  ) + 1;
  agentRuntimeState.lastFailureAt = nowIso();
  agentRuntimeState.lastFailureCode = String(
    error?.deliveryCode || error?.agentCode || error?.code || 'AGENT_EXEC_FAILED',
  );
  agentRuntimeState.lastFailureMessage = trimText(error?.message || 'Agent execution failed', 300);
  const threshold = Math.max(1, Number(settings?.agentCircuitBreakerThreshold || 2));
  if (agentRuntimeState.consecutiveFailures >= threshold) {
    agentRuntimeState.circuitOpenedAt = nowIso();
    agentRuntimeState.circuitOpenUntil =
      Date.now() + Math.max(1000, Number(settings?.agentCircuitBreakerCooldownMs || 30 * 1000));
    if (!wasOpen) {
      publishAdminLiveUpdate('ops-alert', {
        source: 'delivery',
        kind: 'agent-circuit-open',
        consecutiveFailures: agentRuntimeState.consecutiveFailures,
        threshold,
        lastFailureCode: agentRuntimeState.lastFailureCode,
        lastFailureMessage: agentRuntimeState.lastFailureMessage,
        circuitOpenedAt: agentRuntimeState.circuitOpenedAt,
        circuitOpenUntil: new Date(agentRuntimeState.circuitOpenUntil).toISOString(),
      });
    }
  }
}

function recordAgentFailover(reason) {
  agentRuntimeState.lastFailoverAt = nowIso();
  agentRuntimeState.lastFailoverReason = trimText(reason || 'agent-failover', 240);
}

function getRconExecutionReadiness() {
  const shellTemplate = getRconTemplate();
  if (!shellTemplate) {
    return { ok: false, code: 'RCON_TEMPLATE_MISSING', detail: 'RCON exec template is not configured' };
  }

  try {
    validateCommandTemplate(shellTemplate);
  } catch (error) {
    return {
      ok: false,
      code: 'RCON_TEMPLATE_INVALID',
      detail: trimText(error?.message || 'invalid RCON template', 300),
    };
  }

  const host = String(process.env.RCON_HOST || '').trim();
  const port = String(process.env.RCON_PORT || '').trim();
  const password = String(process.env.RCON_PASSWORD || '').trim();
  if (shellTemplate.includes('{host}') && !host) {
    return { ok: false, code: 'RCON_HOST_MISSING', detail: 'RCON_HOST is required by template' };
  }
  if (shellTemplate.includes('{port}') && !port) {
    return { ok: false, code: 'RCON_PORT_MISSING', detail: 'RCON_PORT is required by template' };
  }
  if (shellTemplate.includes('{password}') && !password) {
    return { ok: false, code: 'RCON_PASSWORD_MISSING', detail: 'RCON_PASSWORD is required by template' };
  }

  return {
    ok: true,
    code: 'READY',
    detail: 'RCON delivery fallback is ready',
    shellTemplate,
  };
}

function buildAgentFailoverState(settings, preview = null) {
  const mode = normalizeFailoverMode(settings?.agentFailoverMode || 'none');
  const rcon = mode === 'rcon' ? getRconExecutionReadiness() : null;
  const previewAvailable = preview && typeof preview === 'object';
  const hasAgentHooks =
    previewAvailable
      && (
        (Array.isArray(preview.agentPreCommands) && preview.agentPreCommands.length > 0)
        || (Array.isArray(preview.agentPostCommands) && preview.agentPostCommands.length > 0)
      );
  const compatible = !previewAvailable ? null : !hasAgentHooks;
  const circuit = getAgentCircuitState();

  return {
    configured: mode !== 'none',
    mode,
    ready: mode === 'rcon' && Boolean(rcon?.ok) && compatible !== false,
    compatible,
    previewRequired: compatible === null,
    reason:
      mode === 'none'
        ? 'failover-disabled'
        : compatible === false
          ? 'agent-hooks-present'
          : rcon?.code || 'READY',
    detail:
      mode === 'none'
        ? 'Agent failover is disabled'
        : compatible === false
          ? 'Agent-only teleport/cleanup hooks are configured; automatic failover would change delivery behavior'
          : rcon?.detail || 'RCON delivery fallback is ready',
    rcon,
    circuit,
  };
}

function normalizeExecutionModeValue(value, fallback = 'rcon') {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'agent') return 'agent';
  if (text === 'rcon') return 'rcon';
  return fallback;
}

function defaultExecutionBackendForMode(mode) {
  if (mode === 'agent') {
    return String(process.env.SCUM_CONSOLE_AGENT_BACKEND || 'exec').trim() || 'exec';
  }
  return 'rcon-template';
}

function buildCommandPath(options = {}) {
  const mode = normalizeExecutionModeValue(options.executionMode, 'rcon');
  const backend = String(options.backend || '').trim() || defaultExecutionBackendForMode(mode);
  const stage = String(options.stage || '').trim().toLowerCase();
  const failoverMode = String(
    options.failoverMode
      || options.failover?.mode
      || options.failover?.reason
      || '',
  ).trim().toLowerCase();

  let prefix = 'worker';
  if (stage === 'queue') prefix = 'queue';
  if (stage === 'preflight') prefix = 'worker->preflight';
  if (stage === 'verify') prefix = 'worker->verify';
  if (stage === 'retry') prefix = 'worker->retry';
  if (String(options.source || '').trim().toLowerCase() === 'admin') prefix = 'admin';

  if (mode === 'agent') {
    return `${prefix}->console-agent(${backend})`;
  }
  if (failoverMode === 'rcon') {
    return `${prefix}->console-agent->rcon`;
  }
  return `${prefix}->rcon`;
}

function buildExecutionAuditMeta(job, meta = null, settings = null) {
  const sourceMeta = meta && typeof meta === 'object' ? meta : {};
  const existingExecution = sourceMeta.execution && typeof sourceMeta.execution === 'object'
    ? sourceMeta.execution
    : {};
  const resolvedSettings = settings || getSettings();
  const executionMode = normalizeExecutionModeValue(
    sourceMeta.executionMode
      || sourceMeta.mode
      || existingExecution.executionMode
      || existingExecution.mode
      || job?.executionMode
      || resolvedSettings?.executionMode
      || 'rcon',
    'rcon',
  );
  const backend = String(
    sourceMeta.backend
      || existingExecution.backend
      || job?.executionBackend
      || defaultExecutionBackendForMode(executionMode),
  ).trim() || defaultExecutionBackendForMode(executionMode);
  const retryCount = Math.max(
    0,
    Math.trunc(
      Number(
        sourceMeta.retryCount
          ?? existingExecution.retryCount
          ?? job?.attempts
          ?? 0,
      ) || 0,
    ),
  );
  const commandPath = String(
    sourceMeta.commandPath
      || existingExecution.commandPath
      || job?.commandPath
      || buildCommandPath({
        executionMode,
        backend,
        stage: sourceMeta.stage,
        source: sourceMeta.source,
        failover: sourceMeta.failover,
        failoverMode: sourceMeta.failoverMode,
      }),
  ).trim();

  return {
    ...sourceMeta,
    executionMode,
    backend,
    commandPath,
    retryCount,
    execution: {
      ...existingExecution,
      executionMode,
      backend,
      commandPath,
      retryCount,
    },
  };
}

async function fetchAgentHealth(settings) {
  const baseUrl = getAgentBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(settings.commandTimeoutMs, 5000)),
  );
  try {
    const res = await fetch(`${baseUrl}/healthz`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      return {
        ok: false,
        reachable: false,
        baseUrl,
        error:
          trimText(payload?.error || payload?.message || `agent health failed (${res.status})`, 300),
      };
    }
    return {
      ok: true,
      reachable: true,
      baseUrl,
      ...payload,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      baseUrl,
      error: trimText(error?.message || 'agent health request failed', 300),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAgentPreflight(settings) {
  const baseUrl = getAgentBaseUrl();
  const token = String(process.env.SCUM_CONSOLE_AGENT_TOKEN || '').trim();
  if (!token) {
    return {
      ok: false,
      reachable: false,
      baseUrl,
      errorCode: 'AGENT_TOKEN_MISSING',
      error: 'SCUM_CONSOLE_AGENT_TOKEN is not set',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(settings.commandTimeoutMs, 5000)),
  );
  try {
    const res = await fetch(`${baseUrl}/preflight`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.ok !== true) {
      return {
        ok: false,
        reachable: res.ok || res.status < 500,
        baseUrl,
        errorCode: String(payload?.errorCode || 'AGENT_PREFLIGHT_FAILED'),
        error: trimText(payload?.error || payload?.message || `agent preflight failed (${res.status})`, 300),
        result: payload?.result || null,
      };
    }
    return {
      ok: true,
      reachable: true,
      baseUrl,
      ...payload,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      baseUrl,
      errorCode: 'AGENT_PREFLIGHT_UNREACHABLE',
      error: trimText(error?.message || 'agent preflight request failed', 300),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runDeliveryPreflight(job, settings, context = {}) {
  const report = await getDeliveryPreflightReport({
    ...context,
    settings,
  });

  if (!report.ready) {
    const failure = report.failures[0] || null;
    throw createDeliveryError(
      failure?.code || 'DELIVERY_PREFLIGHT_FAILED',
      failure?.detail || 'Delivery preflight failed',
      {
        step: 'preflight',
        recoveryHint:
          report.mode === 'agent'
            ? 'เช็ก worker, agent, SCUM client, focus ของหน้าต่างเกม และ Windows session ก่อน retry'
            : 'เช็ก worker, RCON template/credential และ item command template ก่อน retry',
        meta: report,
      },
    );
  }

  queueAudit('info', 'preflight-ok', job, 'Delivery preflight passed', {
    step: 'preflight-ok',
    stage: 'preflight',
    source: report.mode === 'agent' ? 'agent' : 'rcon',
    status: 'ok',
    title: 'Preflight passed',
    executionMode: report.effectiveMode || report.mode || settings.executionMode,
    backend:
      (report.effectiveMode || report.mode || settings.executionMode) === 'agent'
        ? String(process.env.SCUM_CONSOLE_AGENT_BACKEND || 'exec').trim() || 'exec'
        : 'rcon-template',
    commandPath: buildCommandPath({
      executionMode: report.effectiveMode || report.mode || settings.executionMode,
      backend:
        (report.effectiveMode || report.mode || settings.executionMode) === 'agent'
          ? String(process.env.SCUM_CONSOLE_AGENT_BACKEND || 'exec').trim() || 'exec'
          : 'rcon-template',
      stage: 'preflight',
      source: report.mode === 'agent' ? 'agent' : 'rcon',
      failover: report.failover,
    }),
    preflight: report.agent?.preflight?.result || report.agent?.preflight || null,
    health: report.agent?.health || report.workerHealth || null,
    checks: report.checks,
    context,
  });

  return {
    ok: true,
    mode: report.effectiveMode || report.mode,
    report,
    health: report.agent?.health || report.workerHealth || null,
    preflight: report.agent?.preflight || null,
    failover: report.failover || null,
    settings: {
      ...settings,
      executionMode: report.effectiveMode || report.mode || settings.executionMode,
    },
  };
}

function getWorkerHealthBaseUrl() {
  const host = String(process.env.WORKER_HEALTH_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = Math.max(
    0,
    Math.trunc(asNumber(process.env.WORKER_HEALTH_PORT, 0)),
  );
  if (port <= 0) return null;
  return `http://${host}:${port}`;
}

async function fetchWorkerHealth(settings) {
  const baseUrl = getWorkerHealthBaseUrl();
  if (!baseUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(settings.commandTimeoutMs, 4000)),
  );
  try {
    const res = await fetch(`${baseUrl}/healthz`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      return {
        ok: false,
        reachable: false,
        baseUrl,
        error: trimText(payload?.error || payload?.message || `worker health failed (${res.status})`, 300),
      };
    }
    return {
      ok: true,
      reachable: true,
      baseUrl,
      ...payload,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      baseUrl,
      error: trimText(error?.message || 'worker health request failed', 300),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getWatcherHealthBaseUrl() {
  const host = String(process.env.SCUM_WATCHER_HEALTH_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = Math.max(
    0,
    Math.trunc(asNumber(process.env.SCUM_WATCHER_HEALTH_PORT, 0)),
  );
  if (port <= 0) return null;
  return `http://${host}:${port}`;
}

async function fetchWatcherHealth(settings) {
  const baseUrl = getWatcherHealthBaseUrl();
  if (!baseUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(settings.commandTimeoutMs, 4000)),
  );
  try {
    const res = await fetch(`${baseUrl}/healthz`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      return {
        ok: false,
        reachable: false,
        baseUrl,
        error: trimText(payload?.error || payload?.message || `watcher health failed (${res.status})`, 300),
      };
    }
    return {
      ok: true,
      reachable: true,
      baseUrl,
      ...payload,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      baseUrl,
      error: trimText(error?.message || 'watcher health request failed', 300),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function compileSafeRegex(pattern, flags = 'i') {
  const text = String(pattern || '').trim();
  if (!text) return null;
  try {
    return new RegExp(text, flags);
  } catch {
    return null;
  }
}

function getLatestWatcherActivityIso(watch = {}) {
  const timestamps = [
    watch?.lastEventAt,
    watch?.lastFileReadAt,
    watch?.lastFileStatAt,
    watch?.lastRotationAt,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .map((date) => date.toISOString());
  return timestamps.sort().slice(-1)[0] || null;
}

function buildVerificationPlan(settings) {
  const mode = normalizeDeliveryVerificationMode(settings?.verifyMode, 'basic');
  return {
    mode,
    successPatternConfigured: Boolean(String(settings?.verifySuccessPattern || '').trim()),
    failurePatternConfigured: Boolean(String(settings?.verifyFailurePattern || '').trim()),
    observerWindowMs: Math.max(5000, Number(settings?.verifyObserverWindowMs || 60 * 1000)),
    observerRequired: mode === 'observer' || mode === 'strict',
  };
}

// Verification is intentionally layered: operators can start with command acknowledgements
// and tighten the policy later with output markers or watcher freshness requirements.
async function verifyDeliveryExecution(outputs = [], settings = getSettings(), options = {}) {
  const plan = buildVerificationPlan(settings);
  if (plan.mode === 'none') {
    return {
      ok: true,
      mode: plan.mode,
      reason: null,
      checks: [],
      failures: [],
      warnings: [],
      plan,
      watcher: null,
      combinedOutput: '',
    };
  }

  const combinedOutput = trimText(
    (Array.isArray(outputs) ? outputs : [])
      .map((entry) => {
        const chunks = [
          entry?.command,
          entry?.stdout,
          entry?.stderr,
        ].map((value) => String(value || '').trim()).filter(Boolean);
        return chunks.join('\n');
      })
      .filter(Boolean)
      .join('\n\n'),
    1600,
  );
  const successRegex = compileSafeRegex(settings?.verifySuccessPattern);
  const failureRegex = compileSafeRegex(settings?.verifyFailurePattern);
  const checks = [];

  checks.push(buildPreflightCheck({
    key: 'verify-command-ack',
    label: 'Command execution acknowledged',
    ok: Array.isArray(outputs) && outputs.length > 0,
    required: true,
    scope: 'verify',
    code: Array.isArray(outputs) && outputs.length > 0 ? 'READY' : 'VERIFY_OUTPUT_EMPTY',
    detail:
      Array.isArray(outputs) && outputs.length > 0
        ? `Captured ${outputs.length} command output record(s)`
        : 'No command outputs were captured for verification',
    meta: {
      outputCount: Array.isArray(outputs) ? outputs.length : 0,
      purchaseCode: String(options.purchaseCode || '').trim() || null,
    },
  }));

  if (failureRegex) {
    const hasFailureMarker = failureRegex.test(combinedOutput);
    checks.push(buildPreflightCheck({
      key: 'verify-failure-pattern',
      label: 'Failure marker',
      ok: !hasFailureMarker,
      required: true,
      scope: 'verify',
      code: hasFailureMarker ? 'VERIFY_FAILURE_PATTERN_MATCHED' : 'READY',
      detail: hasFailureMarker
        ? 'Failure pattern matched in command output'
        : 'No failure marker matched in command output',
      meta: {
        pattern: String(settings?.verifyFailurePattern || '').trim() || null,
      },
    }));
  }

  if (plan.mode === 'output-match' || plan.mode === 'strict' || successRegex) {
    const matched = successRegex ? successRegex.test(combinedOutput) : false;
    checks.push(buildPreflightCheck({
      key: 'verify-success-pattern',
      label: 'Success marker',
      ok: successRegex ? matched : false,
      required: plan.mode === 'output-match' || plan.mode === 'strict',
      scope: 'verify',
      severity: successRegex ? 'error' : 'warn',
      code:
        successRegex
          ? matched
            ? 'READY'
            : 'VERIFY_SUCCESS_PATTERN_MISSING'
          : 'VERIFY_SUCCESS_PATTERN_NOT_CONFIGURED',
      detail:
        successRegex
          ? matched
            ? 'Success pattern matched in command output'
            : 'Success pattern did not match command output'
          : 'Success pattern is not configured',
      meta: {
        pattern: String(settings?.verifySuccessPattern || '').trim() || null,
      },
    }));
  }

  let watcher = null;
  if (plan.observerRequired) {
    watcher = await fetchWatcherHealth(settings);
    const watch = watcher?.data?.watch || watcher?.watch || null;
    const latestActivityAt = getLatestWatcherActivityIso(watch || {});
    const freshnessAgeMs = latestActivityAt
      ? Math.max(0, Date.now() - new Date(latestActivityAt).getTime())
      : null;
    const observerReady = Boolean(
      watcher?.ok
      && watcher?.ready !== false
      && watch
      && watch.fileExists !== false
      && (freshnessAgeMs == null || freshnessAgeMs <= plan.observerWindowMs),
    );
    checks.push(buildPreflightCheck({
      key: 'verify-observer',
      label: 'Watcher observer',
      ok: observerReady,
      required: true,
      scope: 'verify',
      code:
        observerReady
          ? 'READY'
          : !watcher
            ? 'WATCHER_HEALTH_NOT_CONFIGURED'
            : watcher?.ok
              ? 'WATCHER_NOT_FRESH'
              : 'WATCHER_UNREACHABLE',
      detail:
        observerReady
          ? `Watcher is online and fresh${freshnessAgeMs == null ? '' : ` (${freshnessAgeMs}ms)`}`
          : watcher?.error
            ? watcher.error
            : latestActivityAt
              ? `Watcher is stale (${freshnessAgeMs}ms since last activity)`
              : 'Watcher observer is not ready',
      meta: {
        watcher,
        latestActivityAt,
        freshnessAgeMs,
      },
    }));
  }

  const summary = summarizePreflightChecks(checks);
  return {
    ok: summary.ready,
    mode: plan.mode,
    reason: summary.reason,
    checks,
    failures: summary.failures,
    warnings: summary.warnings,
    plan,
    watcher,
    combinedOutput,
  };
}

function buildPreflightCheck(entry = {}) {
  return {
    key: String(entry.key || 'check').trim() || 'check',
    label: String(entry.label || entry.key || 'Check').trim() || 'Check',
    ok: entry.ok === true,
    required: entry.required !== false,
    severity: String(entry.severity || (entry.required === false ? 'warn' : 'error')).trim() || 'error',
    scope: String(entry.scope || 'delivery').trim() || 'delivery',
    detail: trimText(entry.detail || '', 400),
    code: String(entry.code || '').trim() || null,
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : null,
  };
}

function summarizePreflightChecks(checks = []) {
  const rows = Array.isArray(checks) ? checks : [];
  const failures = rows.filter((row) => row.required !== false && row.ok !== true);
  const warnings = rows.filter((row) => row.required === false && row.ok !== true);
  return {
    ready: failures.length === 0,
    reason: failures[0]?.code || failures[0]?.key || 'ready',
    failures,
    warnings,
  };
}

function hasDeliveryPreviewContext(options = {}) {
  return Boolean(
    String(options.itemId || '').trim()
      || String(options.gameItemId || '').trim()
      || Array.isArray(options.deliveryItems),
  );
}

function getCommandTemplateLookupKey(options = {}) {
  const explicit = String(options.lookupKey || '').trim();
  if (explicit) return explicit;
  const itemId = String(options.itemId || '').trim();
  if (itemId) return itemId;
  const gameItemId = String(options.gameItemId || '').trim();
  if (gameItemId) return gameItemId;
  return '';
}

function normalizeCommandTemplateInput(options = {}) {
  const rawCommands = options.commands != null ? options.commands : options.command;
  if (Array.isArray(rawCommands)) {
    return rawCommands
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  return parseCommandList(rawCommands);
}

function getItemCommandsSnapshot() {
  const snapshot =
    typeof config.getConfigSnapshot === 'function'
      ? config.getConfigSnapshot()
      : { delivery: config.delivery };
  if (!snapshot.delivery || typeof snapshot.delivery !== 'object') {
    snapshot.delivery = {};
  }
  if (!snapshot.delivery.auto || typeof snapshot.delivery.auto !== 'object') {
    snapshot.delivery.auto = {};
  }
  if (
    !snapshot.delivery.auto.itemCommands
    || typeof snapshot.delivery.auto.itemCommands !== 'object'
    || Array.isArray(snapshot.delivery.auto.itemCommands)
  ) {
    snapshot.delivery.auto.itemCommands = {};
  }
  return snapshot;
}

function getDeliveryCommandOverride(options = {}) {
  const lookupKey = getCommandTemplateLookupKey(options);
  if (!lookupKey) {
    throw new Error('lookupKey, itemId or gameItemId is required');
  }
  const itemCommands = config.delivery?.auto?.itemCommands || {};
  const raw = Object.prototype.hasOwnProperty.call(itemCommands, lookupKey)
    ? itemCommands[lookupKey]
    : null;
  const commands = normalizeCommands(raw);
  return {
    lookupKey,
    exists: raw != null,
    commandTemplates: commands,
    source: raw != null ? 'config' : 'none',
  };
}

function setDeliveryCommandOverride(options = {}) {
  const lookupKey = getCommandTemplateLookupKey(options);
  if (!lookupKey) {
    throw new Error('lookupKey, itemId or gameItemId is required');
  }

  const clear = options.clear === true;
  const commands = normalizeCommandTemplateInput(options);
  if (!clear && commands.length === 0) {
    throw new Error('command or commands is required');
  }

  const snapshot = getItemCommandsSnapshot();
  const itemCommands = snapshot.delivery.auto.itemCommands;
  const action = clear || commands.length === 0 ? 'delete' : 'set';

  if (action === 'delete') {
    delete itemCommands[lookupKey];
  } else if (commands.length === 1) {
    itemCommands[lookupKey] = commands[0];
  } else {
    itemCommands[lookupKey] = commands;
  }

  if (typeof config.setFullConfig !== 'function') {
    throw new Error('config.setFullConfig is not available');
  }
  config.setFullConfig(snapshot);

  publishAdminLiveUpdate('command-template-update', {
    action,
    lookupKey,
    actor: String(options.actor || 'admin-web').trim() || 'admin-web',
    commands,
  });

  return getDeliveryCommandOverride({ lookupKey });
}

// Preflight answers "is this delivery safe to enqueue right now?" for both admin test-send
// and worker-driven deliveries, so every runtime checks readiness the same way.
async function getDeliveryPreflightReport(options = {}) {
  const settings = options.settings || getSettings();
  const checks = [];
  const report = {
    generatedAt: nowIso(),
    mode: settings.executionMode,
    effectiveMode: settings.executionMode,
    enabled: settings.enabled,
    checks,
    workerHealth: null,
    agent: null,
    rcon: null,
    failover: null,
    preview: null,
    verification: null,
  };

  checks.push(buildPreflightCheck({
    key: 'delivery-enabled',
    label: 'Delivery enabled',
    ok: settings.enabled,
    required: true,
    scope: 'delivery',
    code: settings.enabled ? 'READY' : 'DELIVERY_DISABLED',
    detail: settings.enabled ? 'Auto delivery is enabled' : 'Auto delivery is disabled',
  }));

  const remoteWorkerEnabled = envFlag(process.env.WORKER_ENABLE_DELIVERY, false);
  const localBotOwnsWorker = envFlag(process.env.BOT_ENABLE_DELIVERY_WORKER, false);
  if (workerStarted) {
    checks.push(buildPreflightCheck({
      key: 'worker-online',
      label: 'Delivery worker',
      ok: true,
      scope: 'worker',
      code: 'WORKER_LOCAL_READY',
      detail: workerBusy ? 'Local worker is busy' : 'Local worker process is running',
      meta: {
        busy: workerBusy,
        source: 'local-process',
      },
    }));
  } else if (remoteWorkerEnabled && !localBotOwnsWorker) {
    const workerHealth = await fetchWorkerHealth(settings);
    report.workerHealth = workerHealth;
    checks.push(buildPreflightCheck({
      key: 'worker-online',
      label: 'Delivery worker',
      ok: Boolean(workerHealth?.ok && workerHealth?.reachable),
      required: true,
      scope: 'worker',
      code:
        workerHealth?.ok && workerHealth?.reachable
          ? 'WORKER_REMOTE_READY'
          : 'WORKER_UNREACHABLE',
      detail:
        workerHealth?.ok && workerHealth?.reachable
          ? `Remote worker is reachable at ${workerHealth.baseUrl || 'worker health endpoint'}`
          : workerHealth?.error || 'Remote worker health endpoint is unreachable',
      meta: workerHealth,
    }));
  } else {
    checks.push(buildPreflightCheck({
      key: 'worker-online',
      label: 'Delivery worker',
      ok: true,
      required: false,
      severity: 'info',
      scope: 'worker',
      code: 'WORKER_INLINE_MODE',
      detail: 'No dedicated worker endpoint configured; current process handles delivery state',
      meta: {
        workerStarted,
        remoteWorkerEnabled,
        localBotOwnsWorker,
      },
    }));
  }

  if (settings.executionMode === 'agent') {
    const tokenConfigured = String(process.env.SCUM_CONSOLE_AGENT_TOKEN || '').trim().length > 0;
    const execTemplate = String(process.env.SCUM_CONSOLE_AGENT_EXEC_TEMPLATE || '').trim();
    let execTemplateValid = false;
    let execTemplateError = null;
    if (execTemplate) {
      try {
        validateCommandTemplate(execTemplate);
        execTemplateValid = true;
      } catch (error) {
        execTemplateError = trimText(error?.message || 'invalid exec template', 300);
      }
    }

    checks.push(buildPreflightCheck({
      key: 'agent-token',
      label: 'Console agent token',
      ok: tokenConfigured,
      required: true,
      scope: 'agent',
      code: tokenConfigured ? 'READY' : 'AGENT_TOKEN_MISSING',
      detail: tokenConfigured ? 'SCUM console agent token is configured' : 'SCUM console agent token is missing',
    }));
    checks.push(buildPreflightCheck({
      key: 'agent-exec-template',
      label: 'Console agent exec template',
      ok: !execTemplate || execTemplateValid,
      required: false,
      severity: 'info',
      scope: 'agent',
      code:
        !execTemplate
          ? 'AGENT_EXEC_TEMPLATE_REMOTE'
          : execTemplateValid
            ? 'READY'
            : 'AGENT_EXEC_TEMPLATE_INVALID',
      detail:
        !execTemplate
          ? 'Exec template is managed by the remote console agent'
          : execTemplateValid
          ? 'Console agent exec template is valid'
          : execTemplateError || 'Console agent exec template is invalid',
      meta: execTemplate ? { template: execTemplate } : null,
    }));

    const health = await fetchAgentHealth(settings);
    const preflight = health?.ok ? await fetchAgentPreflight(settings) : null;
    report.agent = {
      tokenConfigured,
      execTemplateConfigured: execTemplate.length > 0,
      execTemplateValid,
      backend: String(process.env.SCUM_CONSOLE_AGENT_BACKEND || 'exec').trim() || 'exec',
      health,
      preflight,
      circuit: getAgentCircuitState(),
      ready: Boolean(tokenConfigured && health?.ok && preflight?.ok),
    };

    checks.push(buildPreflightCheck({
      key: 'agent-online',
      label: 'Console agent online',
      ok: Boolean(health?.ok && health?.reachable),
      required: true,
      scope: 'agent',
      code:
        health?.ok && health?.reachable
          ? 'READY'
          : health?.errorCode || health?.statusCode || 'AGENT_UNREACHABLE',
      detail:
        health?.ok && health?.reachable
          ? `Console agent reachable (${health.backend || health.status || 'ready'})`
          : health?.error || 'Console agent is unreachable',
      meta: health,
    }));
    checks.push(buildPreflightCheck({
      key: 'agent-preflight',
      label: 'SCUM admin client preflight',
      ok: Boolean(preflight?.ok),
      required: true,
      scope: 'agent',
      code: preflight?.ok ? 'READY' : preflight?.errorCode || 'AGENT_PREFLIGHT_FAILED',
      detail:
        preflight?.ok
          ? 'SCUM admin client and Windows session passed preflight'
          : preflight?.error || 'SCUM admin client preflight failed',
      meta: preflight,
    }));
    checks.push(buildPreflightCheck({
      key: 'agent-circuit',
      label: 'Agent circuit breaker',
      ok: report.agent.circuit?.open !== true,
      required: true,
      scope: 'agent',
      code:
        report.agent.circuit?.open === true
          ? 'AGENT_CIRCUIT_OPEN'
          : 'READY',
      detail:
        report.agent.circuit?.open === true
          ? `Agent circuit is open until ${report.agent.circuit?.circuitOpenUntil || 'cooldown expires'}`
          : 'Agent circuit breaker is closed',
      meta: report.agent.circuit,
    }));
  } else {
    const shellTemplate = getRconTemplate();
    let templateValid = false;
    let templateError = null;
    if (shellTemplate) {
      try {
        validateCommandTemplate(shellTemplate);
        templateValid = true;
      } catch (error) {
        templateError = trimText(error?.message || 'invalid RCON template', 300);
      }
    }

    const requiresHost = shellTemplate.includes('{host}');
    const requiresPort = shellTemplate.includes('{port}');
    const requiresPassword = shellTemplate.includes('{password}');
    const host = String(process.env.RCON_HOST || '').trim();
    const port = String(process.env.RCON_PORT || '').trim();
    const password = String(process.env.RCON_PASSWORD || '').trim();

    report.rcon = {
      host: host || null,
      port: port || null,
      templateConfigured: shellTemplate.length > 0,
      templateValid,
      templateError,
      requiresHost,
      requiresPort,
      requiresPassword,
    };

    checks.push(buildPreflightCheck({
      key: 'rcon-template',
      label: 'RCON exec template',
      ok: Boolean(shellTemplate && templateValid),
      required: true,
      scope: 'rcon',
      code:
        shellTemplate && templateValid
          ? 'READY'
          : shellTemplate
            ? 'RCON_TEMPLATE_INVALID'
            : 'RCON_TEMPLATE_MISSING',
      detail:
        shellTemplate && templateValid
          ? 'RCON exec template is valid'
          : templateError || 'RCON exec template is missing or invalid',
      meta: shellTemplate ? { template: shellTemplate } : null,
    }));
    checks.push(buildPreflightCheck({
      key: 'rcon-host',
      label: 'RCON host',
      ok: !requiresHost || Boolean(host),
      required: requiresHost,
      scope: 'rcon',
      code: !requiresHost || host ? 'READY' : 'RCON_HOST_MISSING',
      detail: !requiresHost || host ? `RCON host ${host || 'not required by template'}` : 'RCON_HOST is required by template',
    }));
    checks.push(buildPreflightCheck({
      key: 'rcon-port',
      label: 'RCON port',
      ok: !requiresPort || Boolean(port),
      required: requiresPort,
      scope: 'rcon',
      code: !requiresPort || port ? 'READY' : 'RCON_PORT_MISSING',
      detail: !requiresPort || port ? `RCON port ${port || 'not required by template'}` : 'RCON_PORT is required by template',
    }));
    checks.push(buildPreflightCheck({
      key: 'rcon-password',
      label: 'RCON password',
      ok: !requiresPassword || Boolean(password),
      required: requiresPassword,
      scope: 'rcon',
      code: !requiresPassword || password ? 'READY' : 'RCON_PASSWORD_MISSING',
      detail:
        !requiresPassword || password
          ? 'RCON password configured'
          : 'RCON_PASSWORD is required by template',
    }));
  }

  if (options.skipCommandTemplateCheck !== true && hasDeliveryPreviewContext(options)) {
    try {
      const preview = await previewDeliveryCommands(options);
      report.preview = preview;
      checks.push(buildPreflightCheck({
        key: 'delivery-command-template',
        label: 'Delivery command resolved',
        ok: Array.isArray(preview.commandTemplates) && preview.commandTemplates.length > 0,
        required: true,
        scope: 'item',
        code:
          Array.isArray(preview.commandTemplates) && preview.commandTemplates.length > 0
            ? 'READY'
            : 'DELIVERY_ITEM_COMMAND_MISSING',
        detail:
          Array.isArray(preview.commandTemplates) && preview.commandTemplates.length > 0
            ? `Resolved ${preview.commandTemplates.length} command template(s) from ${preview.commandSource || 'unknown'}`
            : 'No delivery command template resolved for requested item',
        meta: {
          commandSource: preview.commandSource || null,
          commandLookupKey: preview.commandLookupKey || null,
        },
      }));
      checks.push(buildPreflightCheck({
        key: 'delivery-placeholders',
        label: 'Command placeholders resolved',
        ok: Array.isArray(preview.unresolvedPlaceholders) && preview.unresolvedPlaceholders.length === 0,
        required: true,
        scope: 'item',
        code:
          Array.isArray(preview.unresolvedPlaceholders) && preview.unresolvedPlaceholders.length === 0
            ? 'READY'
            : 'DELIVERY_TEMPLATE_PLACEHOLDER_MISSING',
        detail:
          Array.isArray(preview.unresolvedPlaceholders) && preview.unresolvedPlaceholders.length === 0
            ? 'All command placeholders resolved'
            : `Unresolved placeholders: ${(preview.unresolvedPlaceholders || []).join(', ')}`,
        meta: {
          unresolvedPlaceholders: Array.isArray(preview.unresolvedPlaceholders)
            ? preview.unresolvedPlaceholders
            : [],
        },
      }));
      const needsTeleportTarget =
        settings.executionMode === 'agent'
        && commandTemplatesNeedTeleportTarget([
          ...(preview.agentPreCommands || []),
          ...(preview.agentPostCommands || []),
        ]);
      if (settings.executionMode === 'agent') {
        checks.push(buildPreflightCheck({
          key: 'teleport-target',
          label: 'Teleport target',
          ok: !needsTeleportTarget || Boolean(preview.deliveryTeleportTarget),
          required: needsTeleportTarget,
          scope: 'item',
          code:
            !needsTeleportTarget || preview.deliveryTeleportTarget
              ? 'READY'
              : 'DELIVERY_TELEPORT_TARGET_MISSING',
          detail:
            !needsTeleportTarget
              ? 'Teleport target not required for this item'
              : preview.deliveryTeleportTarget
                ? `Teleport target ready (${preview.deliveryTeleportTarget})`
                : 'Teleport target is required by this delivery profile/template',
          meta: {
            deliveryTeleportMode: preview.deliveryTeleportMode || null,
            deliveryTeleportTarget: preview.deliveryTeleportTarget || null,
            deliveryProfile: preview.deliveryProfile || null,
          },
        }));
      }
    } catch (error) {
      checks.push(buildPreflightCheck({
        key: 'delivery-command-template',
        label: 'Delivery command resolved',
        ok: false,
        required: true,
        scope: 'item',
        code: 'DELIVERY_PREVIEW_FAILED',
        detail: trimText(error?.message || 'delivery preview failed', 300),
      }));
    }
  }

  if (settings.executionMode === 'agent') {
    report.failover = buildAgentFailoverState(settings, report.preview);
    checks.push(buildPreflightCheck({
      key: 'agent-failover',
      label: 'Agent failover strategy',
      ok: report.failover.ready,
      required: false,
      severity: 'warn',
      scope: 'agent',
      code:
        report.failover.mode === 'none'
          ? 'AGENT_FAILOVER_DISABLED'
          : report.failover.ready
            ? 'AGENT_FAILOVER_READY'
            : report.failover.reason || 'AGENT_FAILOVER_NOT_READY',
      detail: report.failover.detail,
      meta: report.failover,
    }));
  }

  const verificationPlan = buildVerificationPlan(settings);
  const watcherHealthBaseUrl = getWatcherHealthBaseUrl();
  report.verification = verificationPlan;
  checks.push(buildPreflightCheck({
    key: 'delivery-verification',
    label: 'Delivery verification policy',
    ok:
      verificationPlan.mode === 'none'
      || verificationPlan.mode === 'basic'
      || (verificationPlan.observerRequired
        ? Boolean(watcherHealthBaseUrl)
        : Boolean(settings.verifySuccessPattern)),
    required: verificationPlan.mode !== 'none',
    severity: verificationPlan.mode === 'none' ? 'info' : 'error',
    scope: 'verify',
    code:
      verificationPlan.mode === 'none'
        ? 'VERIFY_DISABLED'
        : verificationPlan.mode === 'basic'
          ? 'READY'
          : verificationPlan.mode === 'observer' || verificationPlan.mode === 'strict'
            ? watcherHealthBaseUrl
              ? 'READY'
              : 'WATCHER_HEALTH_NOT_CONFIGURED'
            : settings.verifySuccessPattern
              ? 'READY'
              : 'VERIFY_SUCCESS_PATTERN_NOT_CONFIGURED',
    detail:
      verificationPlan.mode === 'none'
        ? 'Post-spawn verification is disabled'
        : verificationPlan.mode === 'basic'
          ? 'Basic verification will use command acknowledgements'
          : verificationPlan.mode === 'observer' || verificationPlan.mode === 'strict'
            ? watcherHealthBaseUrl
              ? 'Verification will require watcher observer freshness'
              : 'Set SCUM_WATCHER_HEALTH_PORT/SCUM_WATCHER_HEALTH_HOST for observer verification'
            : settings.verifySuccessPattern
              ? 'Verification will require success pattern match'
              : 'Set DELIVERY_VERIFY_SUCCESS_REGEX for output-match verification',
    meta: verificationPlan,
  }));

  const summary = summarizePreflightChecks(checks);
  let failures = summary.failures;
  let warnings = summary.warnings;
  let ready = summary.ready;
  let reason = summary.reason;

  if (
    settings.executionMode === 'agent'
    && report.failover?.ready
    && failures.length > 0
    && failures.every((row) => row.scope === 'agent')
  ) {
    report.effectiveMode = 'rcon';
    ready = true;
    reason = null;
    warnings = [
      ...warnings,
      ...failures.map((row) => ({
        ...row,
        required: false,
        severity: 'warn',
        detail: `${row.detail} | RCON failover will be used for this delivery`,
      })),
    ];
    failures = [];
  }

  return {
    ...report,
    ready,
    ok: ready,
    reason: reason || 'ready',
    failures,
    warnings,
  };
}

function buildSimulationCommandSteps(preview = {}) {
  const steps = [];
  const pushStep = (phase, command, extra = {}) => {
    const operation = classifyCommandOperation(command, phase);
    steps.push({
      id: createEventId(`plan-${phase}`),
      phase,
      stage: operation.stage,
      step: operation.step,
      title: operation.title,
      kind: operation.kind,
      command: String(command || '').trim() || null,
      deliveryItem: extra.deliveryItem || null,
      source: phase === 'item' ? 'game-command' : 'agent-hook',
      status: 'planned',
      meta: extra.meta || null,
    });
  };

  for (const command of Array.isArray(preview.agentPreCommands) ? preview.agentPreCommands : []) {
    pushStep('pre', command);
  }

  for (const deliveryItem of Array.isArray(preview.deliveryItems) ? preview.deliveryItems : []) {
    const gameItemId = String(deliveryItem?.gameItemId || '').trim();
    const quantity = Math.max(1, Math.trunc(Number(deliveryItem?.quantity || 1)));
    const commands = Array.isArray(preview.commandTemplates)
      ? preview.commandTemplates.map((template) =>
        renderItemCommand(
          template,
          buildDeliveryTemplateVars(
            {
              steamId: '76561198000000000',
              itemId: preview.itemId || preview.gameItemId || gameItemId,
              itemName: preview.itemName || preview.itemId || preview.gameItemId || gameItemId,
              gameItemId,
              quantity,
              itemKind: preview.itemKind || 'item',
              userId: 'simulator-user',
              purchaseCode: 'SIM-DELIVERY-PLAN',
              inGameName: '',
              teleportTarget: preview.deliveryTeleportTarget || '',
              teleportMode: preview.deliveryTeleportMode || '',
              returnTarget: preview.deliveryReturnTarget || '',
            },
            getSettings(),
          ),
          getSettings(),
          { singlePlayer: preview.executionMode === 'agent' },
        ),
      )
      : [];
    for (const command of commands) {
      pushStep('item', command, {
        deliveryItem: {
          gameItemId,
          quantity,
          iconUrl: deliveryItem?.iconUrl || null,
        },
      });
    }
  }

  for (const command of Array.isArray(preview.agentPostCommands) ? preview.agentPostCommands : []) {
    pushStep('post', command);
  }

  return steps;
}

async function simulateDeliveryPlan(options = {}) {
  const preview = await previewDeliveryCommands(options);
  const preflight = await getDeliveryPreflightReport(options);
  const steps = buildSimulationCommandSteps(preview);
  const verificationPlan = buildVerificationPlan(options.settings || getSettings());
  const timeline = [
    normalizeTimelineEvent({
      id: createEventId('sim'),
      at: nowIso(),
      level: 'info',
      action: 'queued',
      stage: 'queue',
      source: 'simulator',
      status: 'planned',
      step: 'queued',
      title: 'Queued',
      message: 'Delivery would be queued for worker execution',
    }),
    normalizeTimelineEvent({
      id: createEventId('sim'),
      at: nowIso(),
      level: 'info',
      action: 'worker-picked',
      stage: 'worker',
      source: 'simulator',
      status: 'planned',
      step: 'worker-picked',
      title: 'Worker picked job',
      message: 'Worker would pick the delivery job',
    }),
    normalizeTimelineEvent({
      id: createEventId('sim'),
      at: nowIso(),
      level: 'info',
      action: 'preflight-start',
      stage: 'preflight',
      source: 'simulator',
      status: preflight.ready ? 'planned' : 'blocked',
      step: 'preflight-start',
      title: 'Preflight check',
      message: preflight.ready ? 'Preflight would pass' : `Preflight blocked: ${preflight.reason}`,
      errorCode: preflight.ready ? null : preflight.reason,
      meta: {
        failures: preflight.failures,
        warnings: preflight.warnings,
      },
    }),
    ...steps.map((step) =>
      normalizeTimelineEvent({
        id: step.id,
        at: nowIso(),
        level: 'info',
        action: 'simulate-step',
        stage: step.stage,
        source: step.source,
        status: step.status,
        step: step.step,
        title: step.title,
        message: step.command || step.title,
        command: step.command,
        meta: {
          phase: step.phase,
          kind: step.kind,
          deliveryItem: step.deliveryItem,
        },
      })),
    verificationPlan.mode !== 'none'
      ? normalizeTimelineEvent({
          id: createEventId('sim'),
          at: nowIso(),
          level: 'info',
          action: 'simulate-verify',
          stage: 'verify',
          source: 'simulator',
          status: 'planned',
          step: 'verify-success',
          title: 'Verification step',
          message:
            verificationPlan.mode === 'basic'
              ? 'Would verify command acknowledgements after spawn'
              : verificationPlan.mode === 'output-match'
                ? 'Would verify success pattern after spawn'
                : verificationPlan.mode === 'observer'
                  ? 'Would verify watcher observer freshness after spawn'
                  : 'Would verify output pattern and watcher observer after spawn',
          meta: verificationPlan,
        })
      : null,
    normalizeTimelineEvent({
      id: createEventId('sim'),
      at: nowIso(),
      level: preflight.ready ? 'info' : 'warn',
      action: 'simulate-finish',
      stage: preflight.ready ? 'completed' : 'blocked',
      source: 'simulator',
      status: preflight.ready ? 'planned' : 'blocked',
      step: preflight.ready ? 'completed' : 'blocked',
      title: preflight.ready ? 'Delivery plan ready' : 'Delivery plan blocked',
      message:
        preflight.ready
          ? 'All commands are ready for execution'
          : `Fix preflight failures before sending delivery (${preflight.reason})`,
      errorCode: preflight.ready ? null : preflight.reason,
    }),
  ].filter(Boolean);

  return {
    generatedAt: nowIso(),
    ready: preflight.ready,
    blockedReason: preflight.ready ? null : preflight.reason,
    preview,
    preflight,
    verificationPlan,
    steps,
    timeline,
    summary: {
      itemCount: Array.isArray(preview.deliveryItems) ? preview.deliveryItems.length : 0,
      commandCount: steps.length,
      commandSource: preview.commandSource || null,
      commandLookupKey: preview.commandLookupKey || null,
      deliveryProfile: preview.deliveryProfile || null,
      deliveryTeleportMode: preview.deliveryTeleportMode || null,
      executionMode: preview.executionMode || null,
      verificationMode: verificationPlan.mode,
    },
  };
}

function listScumAdminCommandCapabilities() {
  return listBuiltInScumAdminCommandCapabilities();
}

function resolveScumAdminCommandCapability(options = {}) {
  const customTemplates = normalizeCapabilityCommandTemplates(
    options.commandTemplates || options.commands || options.command,
  );
  if (customTemplates.length > 0) {
    return {
      id: String(options.capabilityId || options.id || 'custom-command-sequence').trim() || 'custom-command-sequence',
      name: String(options.name || options.capabilityName || 'Custom Command Sequence').trim() || 'Custom Command Sequence',
      description: String(options.description || '').trim() || null,
      commandTemplates: customTemplates,
      defaults: {},
      builtin: false,
      source: options.presetId ? 'preset' : 'custom',
    };
  }

  const capability = getBuiltInScumAdminCommandCapability(options.capabilityId || options.id);
  if (!capability) {
    throw new Error('capabilityId or commands is required');
  }
  return {
    ...capability,
    source: 'builtin',
  };
}

function buildCapabilityTemplateVars(definition = {}, options = {}, settings = getSettings()) {
  const defaults = definition.defaults && typeof definition.defaults === 'object'
    ? definition.defaults
    : {};
  return buildDeliveryTemplateVars({
    itemId: String(options.itemId || definition.id || '').trim() || undefined,
    itemName: String(options.itemName || definition.name || '').trim() || undefined,
    announceText: options.announceText || defaults.announceText || '',
    steamId: options.steamId || defaults.steamId || '',
    gameItemId: options.gameItemId || defaults.gameItemId || '',
    quantity: options.quantity || defaults.quantity || 1,
    userId: options.userId || '',
    purchaseCode: options.purchaseCode || '',
    inGameName: options.inGameName || defaults.inGameName || '',
    teleportMode: options.teleportMode || '',
    teleportTarget: options.teleportTarget || defaults.teleportTarget || '',
    returnTarget: options.returnTarget || defaults.returnTarget || '',
    itemKind: options.itemKind || 'item',
  }, settings);
}

function collectMissingCapabilityInputs(commandTemplates = [], vars = {}, settings = getSettings()) {
  const required = new Set();
  for (const template of Array.isArray(commandTemplates) ? commandTemplates : []) {
    const runtimeTemplate =
      settings.executionMode === 'agent'
        ? adaptCommandTemplateForSinglePlayer(template)
        : String(template || '');
    for (const key of extractCommandPlaceholders(runtimeTemplate)) {
      required.add(key);
    }
  }
  return Array.from(required).filter((key) => {
    const value = vars?.[key];
    if (key === 'quantity') {
      return !(Number(value) > 0);
    }
    return String(value || '').trim().length === 0;
  });
}

function buildCapabilityTimelineStep(command, index, count) {
  const operation = classifyCommandOperation(command, 'item');
  return normalizeTimelineEvent({
    id: createEventId('capability'),
    at: nowIso(),
    level: 'info',
    action: 'capability-command',
    stage: operation.stage,
    source: 'admin-capability-test',
    status: 'planned',
    step: operation.step,
    title: operation.title,
    message: command,
    command,
    meta: {
      index,
      count,
      kind: operation.kind,
    },
  });
}

// Capability tests bypass item-template lookup because presets and custom smoke tests may
// not correspond to a shop item at all.
async function testScumAdminCommandCapability(options = {}) {
  const settings = options.settings || getSettings();
  const capability = resolveScumAdminCommandCapability(options);
  const vars = buildCapabilityTemplateVars(capability, options, settings);
  const renderedCommands = capability.commandTemplates.map((template) =>
    renderItemCommand(
      template,
      vars,
      settings,
      { singlePlayer: settings.executionMode === 'agent' },
    ),
  );
  const unresolvedPlaceholders = collectUnresolvedPlaceholders(renderedCommands);
  const missingInputs = collectMissingCapabilityInputs(capability.commandTemplates, vars, settings);
  const preflight = await getDeliveryPreflightReport({
    settings,
    skipCommandTemplateCheck: true,
    itemId: vars.itemId || undefined,
    itemName: vars.itemName || undefined,
    gameItemId: vars.gameItemId || undefined,
    quantity: vars.quantity || undefined,
    steamId: vars.steamId || undefined,
    userId: vars.userId || undefined,
    purchaseCode: vars.purchaseCode || undefined,
    inGameName: vars.inGameName || undefined,
    teleportMode: vars.teleportMode || undefined,
    teleportTarget: vars.teleportTarget || undefined,
    returnTarget: vars.returnTarget || undefined,
  });

  const inputChecks = [
    buildPreflightCheck({
      key: 'capability-commands',
      label: 'Capability commands',
      ok: renderedCommands.length > 0,
      required: true,
      scope: 'capability',
      code: renderedCommands.length > 0 ? 'READY' : 'CAPABILITY_COMMANDS_EMPTY',
      detail:
        renderedCommands.length > 0
          ? `Resolved ${renderedCommands.length} command(s)`
          : 'No commands resolved for selected capability',
      meta: {
        capabilityId: capability.id,
      },
    }),
    buildPreflightCheck({
      key: 'capability-inputs',
      label: 'Capability inputs',
      ok: missingInputs.length === 0,
      required: true,
      scope: 'capability',
      code: missingInputs.length === 0 ? 'READY' : 'CAPABILITY_INPUT_MISSING',
      detail:
        missingInputs.length === 0
          ? 'All required capability inputs are present'
          : `Missing inputs: ${missingInputs.join(', ')}`,
      meta: {
        missingInputs,
      },
    }),
    buildPreflightCheck({
      key: 'capability-placeholders',
      label: 'Rendered placeholders',
      ok: unresolvedPlaceholders.length === 0,
      required: true,
      scope: 'capability',
      code:
        unresolvedPlaceholders.length === 0
          ? 'READY'
          : 'DELIVERY_TEMPLATE_PLACEHOLDER_MISSING',
      detail:
        unresolvedPlaceholders.length === 0
          ? 'All rendered commands are fully resolved'
          : `Unresolved placeholders: ${unresolvedPlaceholders.join(', ')}`,
      meta: {
        unresolvedPlaceholders,
      },
    }),
  ];
  const validationSummary = summarizePreflightChecks(inputChecks);
  const ready = Boolean(preflight.ready && validationSummary.ready);
  const timeline = [
    normalizeTimelineEvent({
      id: createEventId('capability'),
      at: nowIso(),
      level: 'info',
      action: 'capability-selected',
      stage: 'planning',
      source: 'admin-capability-test',
      status: ready ? 'planned' : 'blocked',
      step: 'capability-selected',
      title: capability.name,
      message: capability.description || 'Capability selected',
    }),
    ...renderedCommands.map((command, index) =>
      buildCapabilityTimelineStep(command, index + 1, renderedCommands.length)),
  ];
  const verificationPlan = buildVerificationPlan(settings);
  if (verificationPlan.mode !== 'none') {
    timeline.push(normalizeTimelineEvent({
      id: createEventId('capability'),
      at: nowIso(),
      level: 'info',
      action: 'capability-verify',
      stage: 'verify',
      source: 'admin-capability-test',
      status: ready ? 'planned' : 'blocked',
      step: 'verify-success',
      title: 'Verification step',
      message: `Verification mode: ${verificationPlan.mode}`,
      meta: verificationPlan,
    }));
  }

  const result = {
    generatedAt: nowIso(),
    capability,
    ready,
    dryRun: options.dryRun === true,
    blockedReason: ready ? null : preflight.reason || validationSummary.reason || 'capability-not-ready',
    preflight,
    inputChecks,
    validation: {
      ready: validationSummary.ready,
      reason: validationSummary.reason,
      failures: validationSummary.failures,
      warnings: validationSummary.warnings,
    },
    vars,
    renderedCommands,
    unresolvedPlaceholders,
    missingInputs,
    outputs: [],
    verification: null,
    timeline,
    summary: {
      commandCount: renderedCommands.length,
      executionMode: settings.executionMode,
      verificationMode: verificationPlan.mode,
      source: capability.source || 'builtin',
    },
  };

  if (result.dryRun || !ready) {
    return result;
  }

  let executionError = null;
  for (let index = 0; index < renderedCommands.length; index += 1) {
    const command = renderedCommands[index];
    try {
      const output = await runGameCommand(command, settings);
      result.outputs.push({
        phase: 'capability',
        mode: output.mode || settings.executionMode,
        backend: output.backend || null,
        command: output.command,
        stdout: output.stdout,
        stderr: output.stderr,
      });
      result.timeline.push(normalizeTimelineEvent({
        id: createEventId('capability'),
        at: nowIso(),
        level: 'info',
        action: 'capability-command-ok',
        stage: classifyCommandOperation(command, 'item').stage,
        source: 'admin-capability-test',
        status: 'ok',
        step: classifyCommandOperation(command, 'item').step,
        title: `${classifyCommandOperation(command, 'item').title} complete`,
        message: command,
        command,
      }));
      if (settings.executionMode === 'agent' && settings.agentCommandDelayMs > 0 && index < renderedCommands.length - 1) {
        await sleep(settings.agentCommandDelayMs);
      }
    } catch (error) {
      executionError = trimText(error?.message || 'command execution failed', 400);
      result.timeline.push(normalizeTimelineEvent({
        id: createEventId('capability'),
        at: nowIso(),
        level: 'error',
        action: 'capability-command-failed',
        stage: classifyCommandOperation(command, 'item').stage,
        source: 'admin-capability-test',
        status: 'failed',
        step: classifyCommandOperation(command, 'item').step,
        title: `${classifyCommandOperation(command, 'item').title} failed`,
        message: executionError,
        command,
        errorCode: 'CAPABILITY_EXEC_FAILED',
      }));
      break;
    }
  }

  if (!executionError) {
    result.verification = await verifyDeliveryExecution(result.outputs, settings, {
      purchaseCode: vars.purchaseCode || null,
    });
    result.timeline.push(normalizeTimelineEvent({
      id: createEventId('capability'),
      at: nowIso(),
      level: result.verification.ok ? 'info' : 'warn',
      action: result.verification.ok ? 'verify-ok' : 'verify-failed',
      stage: 'verify',
      source: 'admin-capability-test',
      status: result.verification.ok ? 'completed' : 'failed',
      step: result.verification.ok ? 'verify-success' : 'verify-failed',
      title: result.verification.ok ? 'Verification passed' : 'Verification failed',
      message:
        result.verification.ok
          ? `Verification mode ${result.verification.mode} passed`
          : result.verification.reason || 'Verification failed',
      errorCode: result.verification.ok ? null : result.verification.reason,
      meta: result.verification,
    }));
  } else {
    result.verification = {
      ok: false,
      mode: verificationPlan.mode,
      reason: 'CAPABILITY_EXEC_FAILED',
      checks: [],
      failures: [{
        key: 'capability-command-execution',
        code: 'CAPABILITY_EXEC_FAILED',
        detail: executionError,
      }],
      warnings: [],
      plan: verificationPlan,
    };
  }

  result.passed = !executionError && Boolean(result.verification?.ok);
  addDeliveryAudit({
    level: result.passed ? 'info' : 'warn',
    action: 'manual-capability-test',
    purchaseCode: vars.purchaseCode || null,
    itemId: vars.itemId || capability.id,
    itemName: capability.name,
    userId: vars.userId || null,
    steamId: vars.steamId || null,
    message: result.passed
      ? `Capability test passed: ${capability.name}`
      : `Capability test failed: ${capability.name}`,
    meta: buildExecutionAuditMeta(
      {
        purchaseCode: vars.purchaseCode || null,
        userId: vars.userId || null,
        itemId: vars.itemId || capability.id,
        attempts: 0,
        executionMode: settings.executionMode,
        executionBackend: defaultExecutionBackendForMode(settings.executionMode),
        commandPath: buildCommandPath({
          executionMode: settings.executionMode,
          backend: defaultExecutionBackendForMode(settings.executionMode),
          stage: 'command',
          source: 'admin',
        }),
      },
      {
      source: 'admin-web',
      capabilityId: capability.id,
      capabilityName: capability.name,
      dryRun: false,
      renderedCommands,
      outputs: result.outputs,
      verification: result.verification,
      blockedReason: result.blockedReason,
      },
      settings,
    ),
  });
  return result;
}

async function runRconCommand(gameCommand, settings) {
  const readiness = getRconExecutionReadiness();
  if (!readiness.ok) {
    throw createDeliveryError(readiness.code, readiness.detail, {
      retryable: readiness.code !== 'RCON_TEMPLATE_INVALID',
      step: 'rcon-command',
      command: gameCommand,
      recoveryHint: 'ตรวจ RCON template/host/port/password ก่อน retry',
    });
  }
  const shellTemplate = readiness.shellTemplate;

  const host = String(process.env.RCON_HOST || '').trim();
  const port = String(process.env.RCON_PORT || '').trim();
  const password = String(process.env.RCON_PASSWORD || '').trim();

  if (shellTemplate.includes('{host}') && !host) {
    throw new Error('RCON_HOST is required by template');
  }
  if (shellTemplate.includes('{port}') && !port) {
    throw new Error('RCON_PORT is required by template');
  }
  if (shellTemplate.includes('{password}') && !password) {
    throw new Error('RCON_PASSWORD is required by template');
  }

  const result = await executeCommandTemplate(
    shellTemplate,
    {
      host,
      port,
      password,
      command: gameCommand,
    },
    {
      timeoutMs: settings.commandTimeoutMs,
      windowsHide: true,
      cwd: process.cwd(),
    },
  );
  return {
    mode: 'rcon',
    backend: 'rcon-template',
    commandPath: buildCommandPath({
      executionMode: 'rcon',
      backend: 'rcon-template',
      stage: 'command',
      source: 'rcon',
    }),
    command: gameCommand,
    shellCommand: result.displayCommand,
    stdout: trimText(result.stdout, 1200),
    stderr: trimText(result.stderr, 1200),
  };
}

async function runAgentCommand(gameCommand, settings) {
  const baseUrl = getAgentBaseUrl();
  const token = String(process.env.SCUM_CONSOLE_AGENT_TOKEN || '').trim();
  if (!token) {
    throw createDeliveryError('AGENT_TOKEN_MISSING', 'SCUM_CONSOLE_AGENT_TOKEN is not set', {
      retryable: false,
      step: 'agent-command',
      command: gameCommand,
      recoveryHint: 'ตั้งค่า SCUM_CONSOLE_AGENT_TOKEN ให้ตรงกับ console agent ก่อน retry',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, settings.commandTimeoutMs + 1000),
  );

  let res;
  try {
    res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ command: gameCommand }),
      signal: controller.signal,
    });
  } catch (error) {
    throw createDeliveryError(
      error?.name === 'AbortError' ? 'AGENT_EXEC_TIMEOUT' : 'AGENT_EXEC_UNREACHABLE',
      trimText(error?.message || 'SCUM console agent request failed', 300),
      {
        retryable: true,
        step: 'agent-command',
        command: gameCommand,
        recoveryHint: 'ตรวจ console-agent, Windows session และ SCUM client ก่อน retry',
      },
    );
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok || !payload?.ok || !payload?.result) {
    throw createDeliveryError(
      String(payload?.errorCode || `AGENT_HTTP_${res.status}`),
      trimText(
        payload?.error
          || payload?.message
          || `SCUM console agent error ${res.status}`,
        500,
      ),
      {
        retryable: res.status >= 500 || res.status === 429,
        step: 'agent-command',
        command: gameCommand,
        recoveryHint: 'ตรวจ agent health, auth token และ SCUM client ก่อน retry',
      },
    );
  }

  return {
    mode: 'agent',
    backend: String(payload.result.backend || '').trim() || defaultExecutionBackendForMode('agent'),
    commandPath: buildCommandPath({
      executionMode: 'agent',
      backend: String(payload.result.backend || '').trim() || defaultExecutionBackendForMode('agent'),
      stage: 'command',
      source: 'agent',
    }),
    command: gameCommand,
    shellCommand: payload.result.shellCommand || null,
    stdout: trimText(payload.result.stdout, 1200),
    stderr: trimText(payload.result.stderr, 1200),
    pid: payload.result.pid || null,
  };
}

async function runGameCommand(gameCommand, settings) {
  if (settings.executionMode === 'agent') {
    try {
      const result = await runAgentCommand(gameCommand, settings);
      recordAgentSuccess();
      return result;
    } catch (error) {
      recordAgentFailure(error, settings);
      throw error;
    }
  }
  return runRconCommand(gameCommand, settings);
}

async function getDeliveryRuntimeStatus() {
  const settings = getSettings();
  const sortedJobs = [...jobs.values()].sort(
    (a, b) => Number(a?.nextAttemptAt || 0) - Number(b?.nextAttemptAt || 0),
  );
  const headJob = sortedJobs[0] || null;
  const latestAudit = listDeliveryAudit(10);
  const runtime = {
    enabled: settings.enabled,
    executionMode: settings.executionMode,
    workerStarted,
    workerBusy,
    queueLength: jobs.size,
    deadLetterCount: deadLetters.size,
    inFlightCount: inFlightPurchaseCodes.size,
    recentSuccessCount: recentlyDeliveredCodes.size,
    settings: {
      queueIntervalMs: settings.queueIntervalMs,
      maxRetries: settings.maxRetries,
      retryDelayMs: settings.retryDelayMs,
      retryBackoff: settings.retryBackoff,
      commandTimeoutMs: settings.commandTimeoutMs,
      failedStatus: settings.failedStatus,
      verifyMode: settings.verifyMode,
      verifySuccessPatternConfigured: Boolean(settings.verifySuccessPattern),
      verifyFailurePatternConfigured: Boolean(settings.verifyFailurePattern),
      wikiWeaponCommandFallbackEnabled:
        settings.wikiWeaponCommandFallbackEnabled === true,
      itemManifestCommandFallbackEnabled:
        settings.itemManifestCommandFallbackEnabled === true,
    },
    headJob: headJob
      ? {
          purchaseCode: headJob.purchaseCode,
          itemId: headJob.itemId,
          itemName: headJob.itemName || null,
          gameItemId: headJob.gameItemId || null,
          quantity: headJob.quantity || 1,
          attempts: headJob.attempts || 0,
          nextAttemptAt: headJob.nextAttemptAt || null,
          createdAt: headJob.createdAt || null,
          updatedAt: headJob.updatedAt || null,
          lastError: headJob.lastError || null,
        }
      : null,
    metrics: getDeliveryMetricsSnapshot(),
    latestAudit,
  };

  if (settings.executionMode === 'agent') {
    const health = await fetchAgentHealth(settings);
    const preflight = health.ok ? await fetchAgentPreflight(settings) : null;
    const ready = Boolean(health?.ok && preflight?.ok);
    runtime.agent = {
      tokenConfigured: String(process.env.SCUM_CONSOLE_AGENT_TOKEN || '').trim().length > 0,
      execTemplateConfigured:
        String(process.env.SCUM_CONSOLE_AGENT_EXEC_TEMPLATE || '').trim().length > 0,
      backend: String(process.env.SCUM_CONSOLE_AGENT_BACKEND || 'exec').trim() || 'exec',
      health,
      preflight,
      circuit: getAgentCircuitState(),
      ready,
    };
    runtime.failover = buildAgentFailoverState(settings, null);
  } else {
    const shellTemplate = getRconTemplate();
    runtime.rcon = {
      host: String(process.env.RCON_HOST || '').trim() || null,
      port: String(process.env.RCON_PORT || '').trim() || null,
      protocol: String(process.env.RCON_PROTOCOL || 'rcon').trim() || 'rcon',
      templateConfigured: shellTemplate.length > 0,
    };
  }

  const remoteWorkerEnabled = envFlag(process.env.WORKER_ENABLE_DELIVERY, false);
  const localBotOwnsWorker = envFlag(process.env.BOT_ENABLE_DELIVERY_WORKER, false);
  if (!workerStarted && remoteWorkerEnabled && !localBotOwnsWorker) {
    const workerHealth = await fetchWorkerHealth(settings);
    runtime.workerSource = 'remote-worker-health';
    runtime.workerHealth = workerHealth;
    if (workerHealth?.ok && workerHealth?.deliveryRuntime) {
      const remoteRuntime = workerHealth.deliveryRuntime;
      return {
        ...runtime,
        ...remoteRuntime,
        workerSource: 'remote-worker-health',
        workerHealth,
      };
    }
    return runtime;
  }

  runtime.workerSource = workerStarted ? 'local-process' : 'current-process';

  const preflightSummary = await getDeliveryPreflightReport({ settings });
  runtime.preflightSummary = {
    ready: preflightSummary.ready,
    reason: preflightSummary.reason,
    failures: preflightSummary.failures,
    warnings: preflightSummary.warnings,
    checks: preflightSummary.checks,
  };

  runtime.readiness = {
    ready: preflightSummary.ready,
    reason: preflightSummary.reason,
  };

  return runtime;
}

function getDeliveryRuntimeSnapshotSync() {
  const settings = getSettings();
  return {
    enabled: settings.enabled,
    executionMode: settings.executionMode,
    workerStarted,
    workerBusy,
    queueLength: jobs.size,
    deadLetterCount: deadLetters.size,
    inFlightCount: inFlightPurchaseCodes.size,
    recentSuccessCount: recentlyDeliveredCodes.size,
    agentCircuit: getAgentCircuitState(),
  };
}

async function getDeliveryDetailsByPurchaseCode(purchaseCode, limit = 50) {
  const code = String(purchaseCode || '').trim();
  if (!code) {
    throw new Error('purchaseCode is required');
  }

  const [purchase, statusHistory] = await Promise.all([
    findPurchaseByCode(code),
    listPurchaseStatusHistory(code, Math.max(1, Math.min(200, Number(limit || 50)))).catch(() => []),
  ]);
  const queueJob = jobs.has(code) ? { ...jobs.get(code) } : null;
  const deadLetter = deadLetters.has(code) ? { ...deadLetters.get(code) } : null;
  const link = purchase?.userId ? getLinkByUserId(purchase.userId) : null;
  const auditRows = listDeliveryAudit(1000)
    .filter((row) => String(row?.purchaseCode || '').trim() === code)
    .sort((left, right) => new Date(right?.createdAt || 0) - new Date(left?.createdAt || 0))
    .slice(0, Math.max(1, Math.min(200, Number(limit || 50))));

  let preview = null;
  if (purchase?.itemId) {
    const shopItem = await getShopItemById(purchase.itemId).catch(() => null);
    preview = await previewDeliveryCommands({
      itemId: purchase.itemId,
      gameItemId: shopItem?.gameItemId || purchase.itemId,
      itemName: shopItem?.name || purchase.itemId,
      quantity: shopItem?.quantity || 1,
      steamId: link?.steamId || undefined,
      userId: purchase.userId,
      purchaseCode: purchase.code,
      deliveryItems: shopItem?.deliveryItems || undefined,
      iconUrl: shopItem?.iconUrl || undefined,
      itemKind: shopItem?.kind || undefined,
    }).catch((error) => ({
      error: String(error?.message || error),
    }));
  }

  const latestCommandAudit = auditRows.find((row) => {
    const outputs = row?.meta?.outputs;
    return Array.isArray(outputs) && outputs.length > 0;
  }) || null;

  const stepLog = auditRows
    .slice()
    .reverse()
    .map((row) => {
      const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
      const outputs = Array.isArray(meta.outputs) ? meta.outputs : [];
      return {
        at: row.createdAt,
        level: row.level || 'info',
        action: row.action || 'event',
        step: String(meta.step || row.action || '').trim() || null,
        errorCode:
          String(meta.errorCode || deriveErrorCodeFromText(row.message, '')).trim() || null,
        retryable:
          typeof meta.retryable === 'boolean' ? meta.retryable : null,
        recoveryHint: String(meta.recoveryHint || '').trim() || null,
        message: row.message || '',
        outputs,
        commandSummary: meta.commandSummary || null,
      };
    });
  const timeline = buildDeliveryTimeline(statusHistory, auditRows);
  const evidence = getDeliveryEvidence(code);

  return {
    purchaseCode: code,
    purchase,
    queueJob,
    deadLetter,
    link,
    statusHistory,
    auditRows,
    timeline,
    stepLog,
    latestCommandSummary: latestCommandAudit?.meta?.commandSummary || null,
    latestOutputs: Array.isArray(latestCommandAudit?.meta?.outputs)
      ? latestCommandAudit.meta.outputs
      : [],
    evidence,
    preview,
  };
}

function normalizeDeliveryItemsForJob(items, fallback = {}) {
  const source = Array.isArray(items) ? items : [];
  const out = [];
  const byKey = new Map();

  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const gameItemId = canonicalizeGameItemId(raw.gameItemId || raw.id, raw.name);
    if (!gameItemId) continue;
    const quantity = Math.max(1, Math.trunc(Number(raw.quantity || 1)));
    const iconUrl =
      String(raw.iconUrl || '').trim()
      || resolveItemIconUrl({
        gameItemId,
        id: gameItemId,
        name: raw.name,
      })
      || null;
    const key = gameItemId.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      const entry = { gameItemId, quantity, iconUrl };
      byKey.set(key, entry);
      out.push(entry);
      continue;
    }
    existing.quantity += quantity;
    if (!existing.iconUrl && iconUrl) {
      existing.iconUrl = iconUrl;
    }
  }

  if (out.length > 0) return out;

  const fallbackGameItemId = canonicalizeGameItemId(fallback.gameItemId);
  if (!fallbackGameItemId) return [];
  return [
    {
      gameItemId: fallbackGameItemId,
      quantity: Math.max(1, Math.trunc(Number(fallback.quantity || 1))),
      iconUrl:
        String(fallback.iconUrl || '').trim()
        || resolveItemIconUrl({
          gameItemId: fallbackGameItemId,
          id: fallbackGameItemId,
        })
        || null,
    },
  ];
}

function normalizeJob(input) {
  if (!input || typeof input !== 'object') return null;
  const purchaseCode = String(input.purchaseCode || '').trim();
  if (!purchaseCode) return null;
  const deliveryItems = normalizeDeliveryItemsForJob(input.deliveryItems, {
    gameItemId: input.gameItemId,
    quantity: input.quantity,
    iconUrl: input.iconUrl,
  });
  const primary = deliveryItems[0] || null;
  const quantityNumber = Number(primary?.quantity || input.quantity);
  const quantity = Number.isFinite(quantityNumber)
    ? Math.max(1, Math.trunc(quantityNumber))
    : 1;

  return {
    purchaseCode,
    tenantId: String(input.tenantId || '').trim() || null,
    userId: String(input.userId || '').trim(),
    itemId: String(input.itemId || '').trim(),
    itemName: String(input.itemName || '').trim() || null,
    iconUrl: String(primary?.iconUrl || input.iconUrl || '').trim() || null,
    gameItemId: String(primary?.gameItemId || input.gameItemId || '').trim() || null,
    quantity,
    deliveryItems,
    itemKind: String(input.itemKind || '').trim() || null,
    guildId: input.guildId ? String(input.guildId) : null,
    executionMode: normalizeExecutionModeValue(input.executionMode, 'rcon'),
    executionBackend: String(input.executionBackend || '').trim() || null,
    commandPath: String(input.commandPath || '').trim() || null,
    attempts: Math.max(0, asNumber(input.attempts, 0)),
    nextAttemptAt: Math.max(Date.now(), asNumber(input.nextAttemptAt, Date.now())),
    lastError: input.lastError ? String(input.lastError) : null,
    lastErrorCode:
      String(input.lastErrorCode || deriveErrorCodeFromText(input.lastError || '', '')).trim() || null,
    lastStep: input.lastStep ? String(input.lastStep) : null,
    retryable:
      typeof input.retryable === 'boolean' ? input.retryable : null,
    recoveryHint: input.recoveryHint ? String(input.recoveryHint) : null,
    createdAt: input.createdAt ? new Date(input.createdAt).toISOString() : nowIso(),
    updatedAt: input.updatedAt ? new Date(input.updatedAt).toISOString() : nowIso(),
  };
}

function normalizeDeadLetter(input) {
  if (!input || typeof input !== 'object') return null;
  const purchaseCode = String(input.purchaseCode || '').trim();
  if (!purchaseCode) return null;
  const createdAt = input.createdAt
    ? new Date(input.createdAt).toISOString()
    : nowIso();
  return {
    purchaseCode,
    tenantId: String(input.tenantId || '').trim() || null,
    userId: String(input.userId || '').trim() || null,
    itemId: String(input.itemId || '').trim() || null,
    itemName: String(input.itemName || '').trim() || null,
    guildId: String(input.guildId || '').trim() || null,
    attempts: Math.max(0, asNumber(input.attempts, 0)),
    reason: trimText(input.reason || 'delivery failed', 500),
    createdAt,
    lastError: input.lastError ? trimText(input.lastError, 500) : null,
    lastErrorCode:
      String(
        input.lastErrorCode
        || input?.meta?.errorCode
        || deriveErrorCodeFromText(input.lastError || input.reason || '', ''),
      ).trim() || null,
    lastStep: input.lastStep ? String(input.lastStep) : null,
    retryable:
      typeof input.retryable === 'boolean'
        ? input.retryable
        : (typeof input?.meta?.retryable === 'boolean' ? input.meta.retryable : null),
    recoveryHint:
      String(input.recoveryHint || input?.meta?.recoveryHint || '').trim() || null,
    deliveryItems: normalizeDeliveryItemsForJob(input.deliveryItems, {
      gameItemId: input.gameItemId,
      quantity: input.quantity,
      iconUrl: input.iconUrl,
    }),
    meta: input.meta && typeof input.meta === 'object' ? input.meta : null,
  };
}

function compactRecentlyDelivered(now = Date.now()) {
  const cutoff = now - IDEMPOTENCY_SUCCESS_WINDOW_MS;
  for (const [code, ts] of recentlyDeliveredCodes.entries()) {
    if (ts < cutoff) {
      recentlyDeliveredCodes.delete(code);
    }
  }
}

function markRecentlyDelivered(purchaseCode, now = Date.now()) {
  const code = String(purchaseCode || '').trim();
  if (!code) return;
  recentlyDeliveredCodes.set(code, now);
  compactRecentlyDelivered(now);
}

function isRecentlyDelivered(purchaseCode, now = Date.now()) {
  compactRecentlyDelivered(now);
  const code = String(purchaseCode || '').trim();
  if (!code) return false;
  const ts = recentlyDeliveredCodes.get(code);
  if (ts == null) return false;
  return now - ts <= IDEMPOTENCY_SUCCESS_WINDOW_MS;
}

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[delivery] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

function flushDeliveryPersistenceWrites() {
  return dbWriteQueue;
}

function parseJsonObject(raw, fallback) {
  try {
    if (raw == null || raw === '') return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toPrismaQueueJobData(job) {
  const normalized = normalizeJob(job);
  if (!normalized) return null;
  return {
    purchaseCode: normalized.purchaseCode,
    tenantId: normalized.tenantId || null,
    userId: normalized.userId,
    itemId: normalized.itemId,
    itemName: normalized.itemName || null,
    iconUrl: normalized.iconUrl || null,
    gameItemId: normalized.gameItemId || null,
    quantity: normalized.quantity,
    deliveryItemsJson: JSON.stringify(normalized.deliveryItems || []),
    itemKind: normalized.itemKind || null,
    guildId: normalized.guildId || null,
    attempts: normalized.attempts,
    nextAttemptAt: new Date(normalized.nextAttemptAt),
    lastError: normalized.lastError || null,
    createdAt: normalized.createdAt ? new Date(normalized.createdAt) : new Date(),
  };
}

function fromPrismaQueueJobRow(row) {
  if (!row) return null;
  return normalizeJob({
    purchaseCode: row.purchaseCode,
    tenantId: row.tenantId,
    userId: row.userId,
    itemId: row.itemId,
    itemName: row.itemName,
    iconUrl: row.iconUrl,
    gameItemId: row.gameItemId,
    quantity: row.quantity,
    deliveryItems: parseJsonObject(row.deliveryItemsJson, []),
    itemKind: row.itemKind,
    guildId: row.guildId,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt ? new Date(row.nextAttemptAt).getTime() : Date.now(),
    lastError: row.lastError,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : nowIso(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : nowIso(),
  });
}

function toPrismaDeadLetterData(rowInput) {
  const row = normalizeDeadLetter(rowInput);
  if (!row) return null;
  return {
    purchaseCode: row.purchaseCode,
    tenantId: row.tenantId || null,
    userId: row.userId || null,
    itemId: row.itemId || null,
    itemName: row.itemName || null,
    guildId: row.guildId || null,
    attempts: row.attempts,
    reason: row.reason,
    lastError: row.lastError || null,
    deliveryItemsJson: JSON.stringify(row.deliveryItems || []),
    metaJson: row.meta ? JSON.stringify(row.meta) : null,
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
  };
}

function fromPrismaDeadLetterRow(row) {
  if (!row) return null;
  return normalizeDeadLetter({
    purchaseCode: row.purchaseCode,
    tenantId: row.tenantId,
    userId: row.userId,
    itemId: row.itemId,
    itemName: row.itemName,
    guildId: row.guildId,
    attempts: row.attempts,
    reason: row.reason,
    lastError: row.lastError,
    deliveryItems: parseJsonObject(row.deliveryItemsJson, []),
    meta: parseJsonObject(row.metaJson, null),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : nowIso(),
  });
}

async function hydrateDeliveryPersistenceFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const [queueRows, deadLetterRows] = await Promise.all([
      prisma.deliveryQueueJob.findMany({
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.deliveryDeadLetter.findMany({
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    if (queueRows.length === 0) {
      if (jobs.size > 0) {
        queueDbWrite(
          async () => {
            for (const job of jobs.values()) {
              const data = toPrismaQueueJobData(job);
              if (!data) continue;
              await prisma.deliveryQueueJob.upsert({
                where: { purchaseCode: data.purchaseCode },
                update: data,
                create: data,
              });
            }
          },
          'backfill-queue',
        );
      }
    } else {
      const hydratedQueue = new Map();
      for (const row of queueRows) {
        const normalized = fromPrismaQueueJobRow(row);
        if (!normalized) continue;
        hydratedQueue.set(normalized.purchaseCode, normalized);
      }
      if (startVersion === mutationVersion) {
        jobs.clear();
        for (const [purchaseCode, job] of hydratedQueue.entries()) {
          jobs.set(purchaseCode, job);
        }
      } else {
        for (const [purchaseCode, job] of hydratedQueue.entries()) {
          if (jobs.has(purchaseCode)) continue;
          jobs.set(purchaseCode, job);
        }
      }
    }

    if (deadLetterRows.length === 0) {
      if (deadLetters.size > 0) {
        queueDbWrite(
          async () => {
            for (const row of deadLetters.values()) {
              const data = toPrismaDeadLetterData(row);
              if (!data) continue;
              await prisma.deliveryDeadLetter.upsert({
                where: { purchaseCode: data.purchaseCode },
                update: data,
                create: data,
              });
            }
          },
          'backfill-dead-letter',
        );
      }
    } else {
      const hydratedDeadLetters = new Map();
      for (const row of deadLetterRows) {
        const normalized = fromPrismaDeadLetterRow(row);
        if (!normalized) continue;
        hydratedDeadLetters.set(normalized.purchaseCode, normalized);
      }
      if (startVersion === mutationVersion) {
        deadLetters.clear();
        for (const [purchaseCode, row] of hydratedDeadLetters.entries()) {
          deadLetters.set(purchaseCode, row);
        }
      } else {
        for (const [purchaseCode, row] of hydratedDeadLetters.entries()) {
          if (deadLetters.has(purchaseCode)) continue;
          deadLetters.set(purchaseCode, row);
        }
      }
    }
    maybeAlertQueuePressure();
    maybeAlertQueueStuck();
    kickWorker(20);
  } catch (error) {
    console.error('[delivery] failed to hydrate queue/dead-letter from prisma:', error.message);
  }
}

async function syncDeliveryPersistenceStore(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && now - lastPersistenceSyncAt < PERSISTENCE_SYNC_INTERVAL_MS) {
    return false;
  }

  if (persistenceSyncPromise) {
    await persistenceSyncPromise;
    return true;
  }

  persistenceSyncPromise = (async () => {
    await hydrateDeliveryPersistenceFromPrisma();
    lastPersistenceSyncAt = Date.now();
  })();

  try {
    await persistenceSyncPromise;
    return true;
  } finally {
    persistenceSyncPromise = null;
  }
}

function initDeliveryPersistenceStore() {
  if (!initPromise) {
    initPromise = syncDeliveryPersistenceStore({ force: true });
  }
  return initPromise;
}

initDeliveryPersistenceStore();

function listDeliveryQueue(limit = 500) {
  const max = Math.max(1, Number(limit || 500));
  const latestByCode = new Map();
  for (const row of listDeliveryAudit(2000)) {
    const code = String(row?.purchaseCode || '').trim();
    if (!code || latestByCode.has(code)) continue;
    latestByCode.set(code, row);
  }
  return Array.from(jobs.values())
    .slice()
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
    .slice(0, max)
    .map((job) => {
      const latestAudit = latestByCode.get(job.purchaseCode) || null;
      const meta = latestAudit?.meta && typeof latestAudit.meta === 'object' ? latestAudit.meta : {};
      return {
        ...job,
        lastErrorCode:
          job.lastErrorCode
          || String(meta.errorCode || deriveErrorCodeFromText(job.lastError || '', '')).trim()
          || null,
        lastStep: job.lastStep || String(meta.step || '').trim() || null,
        retryable:
          typeof job.retryable === 'boolean'
            ? job.retryable
            : (typeof meta.retryable === 'boolean' ? meta.retryable : null),
        recoveryHint:
          job.recoveryHint || String(meta.recoveryHint || '').trim() || null,
      };
    });
}

function replaceDeliveryQueue(nextJobs = []) {
  mutationVersion += 1;
  jobs.clear();
  for (const row of Array.isArray(nextJobs) ? nextJobs : []) {
    const normalized = normalizeJob(row);
    if (!normalized) continue;
    jobs.set(normalized.purchaseCode, normalized);
  }
  queueDbWrite(
    async () => {
      await prisma.deliveryQueueJob.deleteMany();
      for (const job of jobs.values()) {
        const data = toPrismaQueueJobData(job);
        if (!data) continue;
        await prisma.deliveryQueueJob.create({ data });
      }
    },
    'replace-queue',
  );
  maybeAlertQueuePressure();
  maybeAlertQueueStuck();
  publishQueueLiveUpdate('restore', null);
  kickWorker(20);
  return jobs.size;
}

function listDeliveryDeadLetters(limit = 500) {
  const max = Math.max(1, Number(limit || 500));
  return Array.from(deadLetters.values())
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, max)
    .map((row) => ({
      ...row,
      lastErrorCode:
        row.lastErrorCode
        || String(row?.meta?.errorCode || deriveErrorCodeFromText(row.lastError || row.reason || '', '')).trim()
        || null,
      lastStep: row.lastStep || String(row?.meta?.step || '').trim() || null,
      retryable:
        typeof row.retryable === 'boolean'
          ? row.retryable
          : (typeof row?.meta?.retryable === 'boolean' ? row.meta.retryable : null),
      recoveryHint:
        row.recoveryHint || String(row?.meta?.recoveryHint || '').trim() || null,
    }));
}

function filterDeliveryRows(rows, filters = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const errorCode = String(filters.errorCode || '').trim().toUpperCase();
  const q = String(filters.q || '').trim().toLowerCase();
  return list.filter((row) => {
    if (errorCode) {
      const rowCode = String(row?.lastErrorCode || '').trim().toUpperCase();
      if (rowCode !== errorCode) return false;
    }
    if (q) {
      const haystack = [
        row?.purchaseCode,
        row?.itemId,
        row?.itemName,
        row?.gameItemId,
        row?.userId,
        row?.lastError,
        row?.reason,
      ]
        .map((entry) => String(entry || '').toLowerCase())
        .join(' ');
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function listFilteredDeliveryQueue(filters = {}) {
  const limit = Math.max(1, Number(filters.limit || 500));
  return filterDeliveryRows(listDeliveryQueue(Math.max(limit, 2000)), filters).slice(0, limit);
}

function listFilteredDeliveryDeadLetters(filters = {}) {
  const limit = Math.max(1, Number(filters.limit || 500));
  return filterDeliveryRows(listDeliveryDeadLetters(Math.max(limit, 2000)), filters).slice(0, limit);
}

function replaceDeliveryDeadLetters(nextRows = []) {
  mutationVersion += 1;
  deadLetters.clear();
  for (const row of Array.isArray(nextRows) ? nextRows : []) {
    const normalized = normalizeDeadLetter(row);
    if (!normalized) continue;
    deadLetters.set(normalized.purchaseCode, normalized);
  }
  queueDbWrite(
    async () => {
      await prisma.deliveryDeadLetter.deleteMany();
      for (const row of deadLetters.values()) {
        const data = toPrismaDeadLetterData(row);
        if (!data) continue;
        await prisma.deliveryDeadLetter.create({ data });
      }
    },
    'replace-dead-letter',
  );
  return deadLetters.size;
}

function removeDeliveryDeadLetter(purchaseCode) {
  const code = String(purchaseCode || '').trim();
  if (!code) return null;
  const existing = deadLetters.get(code);
  if (!existing) return null;
  mutationVersion += 1;
  deadLetters.delete(code);
  queueDbWrite(
    async () => {
      await prisma.deliveryDeadLetter.deleteMany({ where: { purchaseCode: code } });
    },
    'delete-dead-letter',
  );
  return { ...existing };
}

function addDeliveryDeadLetter(job, reason, meta = null) {
  const row = normalizeDeadLetter({
    purchaseCode: job?.purchaseCode,
    tenantId: job?.tenantId,
    userId: job?.userId,
    itemId: job?.itemId,
    itemName: job?.itemName,
    guildId: job?.guildId,
    attempts: job?.attempts,
    reason,
    lastError: job?.lastError || reason,
    deliveryItems: job?.deliveryItems,
    gameItemId: job?.gameItemId,
    quantity: job?.quantity,
    iconUrl: job?.iconUrl,
    createdAt: nowIso(),
    meta,
  });
  if (!row) return null;
  mutationVersion += 1;
  deadLetters.set(row.purchaseCode, row);
  queueDbWrite(
    async () => {
      const data = toPrismaDeadLetterData(row);
      if (!data) return;
      await prisma.deliveryDeadLetter.upsert({
        where: { purchaseCode: data.purchaseCode },
        update: data,
        create: data,
      });
    },
    'upsert-dead-letter',
  );
  publishAdminLiveUpdate('delivery-dead-letter', {
    action: 'add',
    purchaseCode: row.purchaseCode,
    tenantId: row.tenantId || null,
    reason: row.reason,
    count: deadLetters.size,
  });
  maybeAlertDeadLetterThreshold();
  return { ...row };
}

function compactOutcomes(now = Date.now()) {
  const cutoff = now - METRICS_WINDOW_MS;
  while (deliveryOutcomes.length > 0 && deliveryOutcomes[0].at < cutoff) {
    deliveryOutcomes.shift();
  }
}

function getDeliveryMetricsSnapshot(now = Date.now()) {
  compactOutcomes(now);
  const attempts = deliveryOutcomes.length;
  const failures = deliveryOutcomes.reduce(
    (sum, entry) => sum + (entry.ok ? 0 : 1),
    0,
  );
  const successes = attempts - failures;
  const failRate = attempts > 0 ? failures / attempts : 0;
  let oldestDueMs = 0;
  for (const job of jobs.values()) {
    const overdueMs = now - Number(job.nextAttemptAt || now);
    if (overdueMs > oldestDueMs) {
      oldestDueMs = overdueMs;
    }
  }
  return {
    windowMs: METRICS_WINDOW_MS,
    attempts,
    successes,
    failures,
    failRate,
    queueLength: jobs.size,
    deadLetterCount: deadLetters.size,
    oldestDueMs,
    thresholds: {
      failRate: FAIL_RATE_ALERT_THRESHOLD,
      minSamples: FAIL_RATE_ALERT_MIN_SAMPLES,
      queueLength: QUEUE_ALERT_THRESHOLD,
      queueStuckSlaMs: QUEUE_STUCK_SLA_MS,
    },
  };
}

function maybeAlertQueuePressure() {
  const queueLength = jobs.size;
  if (queueLength < QUEUE_ALERT_THRESHOLD) return;
  const now = Date.now();
  if (now - lastQueuePressureAlertAt < ALERT_COOLDOWN_MS) return;
  lastQueuePressureAlertAt = now;

  const payload = {
    source: 'delivery',
    kind: 'queue-pressure',
    queueLength,
    threshold: QUEUE_ALERT_THRESHOLD,
  };
  console.warn(
    `[delivery][alert] queue pressure: length=${queueLength} threshold=${QUEUE_ALERT_THRESHOLD}`,
  );
  publishAdminLiveUpdate('ops-alert', payload);
}

function maybeAlertQueueStuck(now = Date.now()) {
  if (jobs.size === 0) return;

  let oldestDueMs = 0;
  let oldestJob = null;
  for (const job of jobs.values()) {
    const overdueMs = now - Number(job.nextAttemptAt || now);
    if (overdueMs > oldestDueMs) {
      oldestDueMs = overdueMs;
      oldestJob = job;
    }
  }
  if (oldestDueMs < QUEUE_STUCK_SLA_MS) return;
  if (now - lastQueueStuckAlertAt < ALERT_COOLDOWN_MS) return;
  lastQueueStuckAlertAt = now;

  const payload = {
    source: 'delivery',
    kind: 'queue-stuck',
    queueLength: jobs.size,
    oldestDueMs,
    thresholdMs: QUEUE_STUCK_SLA_MS,
    purchaseCode: oldestJob?.purchaseCode || null,
  };
  console.warn(
    `[delivery][alert] queue stuck: oldestDueMs=${oldestDueMs} thresholdMs=${QUEUE_STUCK_SLA_MS} queueLength=${jobs.size}`,
  );
  publishAdminLiveUpdate('ops-alert', payload);
}

function maybeAlertFailRate(snapshot) {
  if (!snapshot) return;
  if (snapshot.attempts < FAIL_RATE_ALERT_MIN_SAMPLES) return;
  if (snapshot.failRate < FAIL_RATE_ALERT_THRESHOLD) return;

  const now = Date.now();
  if (now - lastFailRateAlertAt < ALERT_COOLDOWN_MS) return;
  lastFailRateAlertAt = now;

  const payload = {
    source: 'delivery',
    kind: 'fail-rate',
    attempts: snapshot.attempts,
    failures: snapshot.failures,
    failRate: snapshot.failRate,
    threshold: FAIL_RATE_ALERT_THRESHOLD,
    windowMs: METRICS_WINDOW_MS,
  };
  console.warn(
    `[delivery][alert] fail rate spike: failRate=${snapshot.failRate.toFixed(3)} attempts=${snapshot.attempts} failures=${snapshot.failures}`,
  );
  publishAdminLiveUpdate('ops-alert', payload);
}

function getConsecutiveFailureCount() {
  let count = 0;
  for (let index = deliveryOutcomes.length - 1; index >= 0; index -= 1) {
    if (deliveryOutcomes[index]?.ok) break;
    count += 1;
  }
  return count;
}

function maybeAlertDeadLetterThreshold() {
  if (deadLetters.size < DEAD_LETTER_ALERT_THRESHOLD) return;
  const now = Date.now();
  if (now - lastDeadLetterAlertAt < ALERT_COOLDOWN_MS) return;
  lastDeadLetterAlertAt = now;

  const payload = {
    source: 'delivery',
    kind: 'dead-letter-threshold',
    deadLetterCount: deadLetters.size,
    threshold: DEAD_LETTER_ALERT_THRESHOLD,
  };
  console.warn(
    `[delivery][alert] dead-letter threshold: count=${deadLetters.size} threshold=${DEAD_LETTER_ALERT_THRESHOLD}`,
  );
  publishAdminLiveUpdate('ops-alert', payload);
}

function maybeAlertConsecutiveFailures() {
  const consecutiveFailures = getConsecutiveFailureCount();
  if (consecutiveFailures < CONSECUTIVE_FAILURE_ALERT_THRESHOLD) return;
  const now = Date.now();
  if (now - lastConsecutiveFailureAlertAt < ALERT_COOLDOWN_MS) return;
  lastConsecutiveFailureAlertAt = now;

  const payload = {
    source: 'delivery',
    kind: 'consecutive-failures',
    consecutiveFailures,
    threshold: CONSECUTIVE_FAILURE_ALERT_THRESHOLD,
    lastPurchaseCode:
      deliveryOutcomes.length > 0
        ? deliveryOutcomes[deliveryOutcomes.length - 1]?.purchaseCode || null
        : null,
  };
  console.warn(
    `[delivery][alert] consecutive failures: count=${consecutiveFailures} threshold=${CONSECUTIVE_FAILURE_ALERT_THRESHOLD}`,
  );
  publishAdminLiveUpdate('ops-alert', payload);
}

function recordDeliveryOutcome(ok, context = {}) {
  deliveryOutcomes.push({
    at: Date.now(),
    ok: ok === true,
    purchaseCode: context.purchaseCode || null,
  });
  const snapshot = getDeliveryMetricsSnapshot();
  maybeAlertFailRate(snapshot);
  if (ok === true) {
    lastConsecutiveFailureAlertAt = 0;
  } else {
    maybeAlertConsecutiveFailures();
  }
  return snapshot;
}

function publishQueueLiveUpdate(action, job) {
  const deliveryItems = normalizeDeliveryItemsForJob(job?.deliveryItems, {
    gameItemId: job?.gameItemId,
    quantity: job?.quantity,
    iconUrl: job?.iconUrl,
  });
  publishAdminLiveUpdate('delivery-queue', {
    action: String(action || 'update'),
    purchaseCode: job?.purchaseCode || null,
    tenantId: job?.tenantId || null,
    itemId: job?.itemId || null,
    itemName: job?.itemName || null,
    iconUrl: deliveryItems[0]?.iconUrl || job?.iconUrl || null,
    gameItemId: deliveryItems[0]?.gameItemId || job?.gameItemId || null,
    quantity: deliveryItems[0]?.quantity || job?.quantity || 1,
    deliveryItems,
    userId: job?.userId || null,
    queueLength: jobs.size,
  });
}

function queueAudit(level, action, job, message, meta = null) {
  const executionMeta = buildExecutionAuditMeta(job, meta);
  addDeliveryAudit({
    level,
    action,
    tenantId: job?.tenantId || null,
    purchaseCode: job?.purchaseCode || null,
    itemId: job?.itemId || null,
    userId: job?.userId || null,
    attempt: job?.attempts == null ? null : job.attempts,
    message,
    meta: executionMeta,
  });
  appendDeliveryEvidenceEvent(job?.purchaseCode, {
    at: new Date().toISOString(),
    level,
    action,
    tenantId: job?.tenantId || null,
    message,
    status:
      String(executionMeta?.status || job?.status || '').trim()
      || String(job?.lastStatus || '').trim()
      || null,
    execution: {
      executionMode: executionMeta?.executionMode || job?.executionMode || null,
      backend:
        executionMeta?.backend
        || job?.executionBackend
        || job?.backend
        || null,
      commandPath: executionMeta?.commandPath || job?.commandPath || null,
      retryCount:
        executionMeta?.retryCount != null
          ? executionMeta.retryCount
          : job?.attempts != null
            ? job.attempts
            : null,
    },
    latestOutputs: Array.isArray(executionMeta?.outputs) ? executionMeta.outputs : [],
    latestCommandSummary: executionMeta?.commandSummary || null,
    meta: executionMeta,
  });
  publishQueueLiveUpdate(action, job);
}

function setJob(job) {
  const normalized = normalizeJob(job);
  if (!normalized) return;
  mutationVersion += 1;
  jobs.set(normalized.purchaseCode, normalized);
  queueDbWrite(
    async () => {
      const data = toPrismaQueueJobData(normalized);
      if (!data) return;
      await prisma.deliveryQueueJob.upsert({
        where: { purchaseCode: data.purchaseCode },
        update: data,
        create: data,
      });
    },
    'upsert-queue-job',
  );
  maybeAlertQueuePressure();
  maybeAlertQueueStuck();
}

function removeJob(purchaseCode) {
  const code = String(purchaseCode || '').trim();
  if (!code) return;
  mutationVersion += 1;
  jobs.delete(code);
  queueDbWrite(
    async () => {
      await prisma.deliveryQueueJob.deleteMany({ where: { purchaseCode: code } });
    },
    'delete-queue-job',
  );
}

function calcDelayMs(attempts) {
  const settings = getSettings();
  const base = settings.retryDelayMs;
  const factor = settings.retryBackoff;
  const delay = Math.round(base * Math.pow(factor, Math.max(0, attempts - 1)));
  return Math.min(delay, 60 * 60 * 1000);
}

function nextDueJob() {
  const now = Date.now();
  let selected = null;
  for (const job of jobs.values()) {
    if (job.nextAttemptAt > now) continue;
    if (!selected || job.nextAttemptAt < selected.nextAttemptAt) {
      selected = job;
    }
  }
  return selected;
}

async function trySendDiscordAudit(job, message) {
  if (!workerClient || !job?.guildId || !message) return;
  try {
    const guild = workerClient.guilds.cache.get(job.guildId)
      || (await workerClient.guilds.fetch(job.guildId).catch(() => null));
    if (!guild) return;

    const channel = guild.channels.cache.find(
      (c) => c.name === config.channels?.shopLog && c.isTextBased && c.isTextBased(),
    ) || guild.channels.cache.find(
      (c) => c.name === config.channels?.adminLog && c.isTextBased && c.isTextBased(),
    );
    if (!channel) return;
    await channel.send(message).catch(() => null);
  } catch {
    // best effort
  }
}

async function handleRetry(job, reasonInput) {
  const settings = getSettings();
  const failure = normalizeDeliveryError(reasonInput, 'DELIVERY_RETRY');
  const reason = formatDeliveryErrorSummary(failure);
  recordDeliveryOutcome(false, { purchaseCode: job?.purchaseCode });
  const nextAttempt = Number(job.attempts || 0) + 1;
  if (failure.retryable === false || nextAttempt > settings.maxRetries) {
    const summary = trimText(
      normalizeDeliveryItemsForJob(job?.deliveryItems, {
        gameItemId: job?.gameItemId,
        quantity: job?.quantity,
      })
        .map((entry) => `${entry.gameItemId} x${entry.quantity}`)
        .join(', '),
      220,
    );
    queueAudit('error', 'failed', job, reason, {
      errorCode: failure.code,
      retryable: failure.retryable,
      step: failure.step,
      stage: 'failed',
      source: 'worker',
      status: 'failed',
      title: 'Delivery failed',
      recoveryHint: failure.recoveryHint,
      command: failure.command,
      failureMeta: failure.meta,
      maxRetries: settings.maxRetries,
      failedStatus: settings.failedStatus,
    });
    addDeliveryDeadLetter(job, reason, {
      errorCode: failure.code,
      retryable: failure.retryable,
      step: failure.step,
      recoveryHint: failure.recoveryHint,
      command: failure.command,
      failureMeta: failure.meta,
      failedStatus: settings.failedStatus,
      maxRetries: settings.maxRetries,
    });
    await setPurchaseStatusByCode(job.purchaseCode, settings.failedStatus, {
      actor: 'delivery-worker',
      reason: 'delivery-max-retries',
      meta: {
        maxRetries: settings.maxRetries,
        attempts: nextAttempt,
      },
    }).catch(() => null);
    removeJob(job.purchaseCode);
    await trySendDiscordAudit(
      job,
      `[FAIL] **Auto delivery failed** | code: \`${job.purchaseCode}\` | item: \`${job.itemName || job.itemId}\` | delivery: \`${summary || `${job.gameItemId || job.itemId} x${job.quantity || 1}`}\` | reason: ${trimText(reason, 300)}`,
    );
    return;
  }

  const delayMs = calcDelayMs(nextAttempt);
    setJob({
      ...job,
      attempts: nextAttempt,
      nextAttemptAt: Date.now() + delayMs,
      lastError: reason,
      lastErrorCode: failure.code,
      lastStep: failure.step,
      retryable: failure.retryable,
      recoveryHint: failure.recoveryHint,
      updatedAt: nowIso(),
    });
    queueAudit('warn', 'retry', job, `${reason} (retry in ${delayMs}ms)`, {
      errorCode: failure.code,
      retryable: failure.retryable,
      step: failure.step,
      stage: 'retry',
      source: 'worker',
      status: 'retrying',
      title: 'Retry scheduled',
      recoveryHint: failure.recoveryHint,
      command: failure.command,
      failureMeta: failure.meta,
      delayMs,
      maxRetries: settings.maxRetries,
    });
}

// A single job execution reuses the same preview, preflight, command execution, and
// verification pipeline exposed to admin tooling to keep behavior consistent.
async function processJob(job) {
  const purchaseCode = String(job?.purchaseCode || '').trim();
  if (!purchaseCode) {
    throw createDeliveryError('DELIVERY_JOB_INVALID', 'Missing purchaseCode in delivery job', {
      retryable: false,
      step: 'validate-job',
    });
  }
  if (inFlightPurchaseCodes.has(purchaseCode)) {
    throw createDeliveryError(
      'DELIVERY_IN_FLIGHT_DUPLICATE',
      `Idempotency guard blocked duplicate in-flight delivery for ${purchaseCode}`,
      {
        retryable: true,
        step: 'validate-job',
      },
    );
  }

  inFlightPurchaseCodes.add(purchaseCode);
  try {
    const purchase = await findPurchaseByCode(purchaseCode);
    if (!purchase) {
      queueAudit('error', 'missing-purchase', job, 'Purchase not found', {
        errorCode: 'DELIVERY_PURCHASE_NOT_FOUND',
        retryable: false,
        step: 'load-purchase',
      });
      removeJob(purchaseCode);
      return;
    }

    if (purchase.status === 'delivered' || purchase.status === 'refunded') {
      markRecentlyDelivered(purchaseCode);
      queueAudit(
        'info',
        'skip-terminal-status',
        job,
        `Skip because purchase status is ${purchase.status}`,
      );
      removeJob(purchaseCode);
      return;
    }

    queueAudit('info', 'worker-picked', job, 'Worker picked delivery job', {
      step: 'worker-picked',
      stage: 'worker',
      source: 'worker',
      status: 'running',
      title: 'Worker picked job',
      purchaseStatus: purchase.status || null,
    });

    const shopItem = await getShopItemById(purchase.itemId).catch(() => null);
    const resolvedDeliveryItems = normalizeDeliveryItemsForJob(
      shopItem?.deliveryItems || job?.deliveryItems,
      {
        gameItemId: shopItem?.gameItemId || job?.gameItemId || purchase.itemId,
        quantity: shopItem?.quantity || job?.quantity || 1,
        iconUrl: shopItem?.iconUrl || job?.iconUrl || null,
      },
    );
    const firstDeliveryItem = resolvedDeliveryItems[0] || {
      gameItemId: String(purchase.itemId || '').trim(),
      quantity: 1,
      iconUrl: null,
    };
    const commands = resolveItemCommands(
      purchase.itemId,
      firstDeliveryItem.gameItemId,
    );
    if (commands.length === 0) {
      queueAudit(
        'warn',
        'missing-item-commands',
        job,
        `No auto-delivery command for itemId=${purchase.itemId}`,
        {
          errorCode: 'DELIVERY_ITEM_COMMAND_MISSING',
          retryable: false,
          step: 'resolve-command',
        },
      );
      await setPurchaseStatusByCode(purchaseCode, 'pending', {
        actor: 'delivery-worker',
        reason: 'missing-item-commands',
      }).catch(() => null);
      removeJob(purchaseCode);
      return;
    }

    const link = getLinkByUserId(purchase.userId);
    if (!link?.steamId) {
      await handleRetry(
        job,
        createDeliveryError(
          'DELIVERY_STEAM_LINK_MISSING',
          `Missing steam link for userId=${purchase.userId}`,
          {
            retryable: true,
            step: 'resolve-player',
            recoveryHint: 'ผูก SteamID/ลิงก์ผู้เล่นให้ครบก่อน retry',
          },
        ),
      );
      return;
    }

    const settings = getSettings();
    const context = {
      purchaseCode: purchase.code,
      itemId: purchase.itemId,
      itemName: shopItem?.name || job?.itemName || purchase.itemId,
      gameItemId: firstDeliveryItem.gameItemId,
      quantity: firstDeliveryItem.quantity,
      itemKind: String(shopItem?.kind || job?.itemKind || 'item'),
      userId: purchase.userId,
      steamId: link.steamId,
      inGameName: link.inGameName || null,
      teleportMode: shopItem?.deliveryTeleportMode || '',
      teleportTarget: shopItem?.deliveryTeleportTarget || '',
    };

    const outputs = [];
    const needsItemPlaceholder = commandSupportsBundleItems(commands);

    if (resolvedDeliveryItems.length > 1 && !needsItemPlaceholder) {
      throw createDeliveryError(
        'DELIVERY_BUNDLE_TEMPLATE_INVALID',
        'itemCommands ต้องมี {gameItemId} หรือ {quantity} เมื่อสินค้าเป็นหลายไอเทม',
        {
          retryable: false,
          step: 'resolve-command',
          recoveryHint: 'แก้ template ของสินค้า bundle ให้รองรับ {gameItemId} หรือ {quantity}',
        },
      );
    }

    const commonVars = buildDeliveryTemplateVars(context, settings);
    const agentHooks = resolveAgentHookPlan(shopItem, commonVars, settings);

    if (
      settings.executionMode === 'agent'
      && agentHooks.requiresTeleportTarget
      && !agentHooks.deliveryTeleportTarget
    ) {
      await handleRetry(
        job,
        createDeliveryError(
          'DELIVERY_TELEPORT_TARGET_MISSING',
          `Missing teleport target for purchaseCode=${purchase.code}`,
          {
            retryable: true,
            step: 'resolve-teleport',
            recoveryHint: 'ตั้ง delivery teleport target รายสินค้า หรือค่า DELIVERY_AGENT_TELEPORT_TARGET',
          },
        ),
      );
      return;
    }

    queueAudit('info', 'preflight-start', job, 'Delivery preflight started', {
      step: 'preflight-start',
      stage: 'preflight',
      source: settings.executionMode === 'agent' ? 'agent' : 'rcon',
      status: 'running',
      title: 'Preflight started',
      executionMode: settings.executionMode,
      backend: defaultExecutionBackendForMode(settings.executionMode),
      commandPath: buildCommandPath({
        executionMode: settings.executionMode,
        backend: defaultExecutionBackendForMode(settings.executionMode),
        stage: 'preflight',
        source: settings.executionMode === 'agent' ? 'agent' : 'rcon',
      }),
      context,
    });

    const preflightState = await runDeliveryPreflight(job, settings, {
      purchaseCode: purchase.code,
      itemId: purchase.itemId,
      steamId: link.steamId,
      itemName: context.itemName,
      gameItemId: context.gameItemId,
      quantity: context.quantity,
      itemKind: context.itemKind,
      userId: context.userId,
      inGameName: context.inGameName,
      teleportMode: context.teleportMode,
      teleportTarget: context.teleportTarget,
      deliveryItems: resolvedDeliveryItems,
    });

    const executionSettings = preflightState?.settings || settings;
    if (
      executionSettings.executionMode !== settings.executionMode
      && preflightState?.failover?.ready
    ) {
      recordAgentFailover(preflightState.failover.reason || 'agent-failover');
      queueAudit('warn', 'failover-engaged', job, 'Agent delivery failover engaged; using RCON for this attempt', {
        step: 'failover',
        stage: 'preflight',
        source: 'worker',
        status: 'retrying',
        title: 'Failover engaged',
        executionMode: executionSettings.executionMode,
        backend: defaultExecutionBackendForMode(executionSettings.executionMode),
        commandPath: buildCommandPath({
          executionMode: executionSettings.executionMode,
          backend: defaultExecutionBackendForMode(executionSettings.executionMode),
          stage: 'preflight',
          failover: preflightState.failover,
        }),
        preflightState,
        failover: preflightState.failover,
      });
    }

    const effectiveCommonVars = buildDeliveryTemplateVars(context, executionSettings);
    const effectiveAgentHooks = resolveAgentHookPlan(shopItem, effectiveCommonVars, executionSettings);
    const preCommands = effectiveAgentHooks.preCommands;
    const postCommands = effectiveAgentHooks.postCommands;
    job.executionMode = executionSettings.executionMode;
    job.executionBackend = defaultExecutionBackendForMode(executionSettings.executionMode);
    job.commandPath = buildCommandPath({
      executionMode: executionSettings.executionMode,
      backend: job.executionBackend,
      stage: 'worker',
      failover: preflightState?.failover,
    });

    const executePhaseCommands = async (
      phase,
      commandList,
      deliveryItem = null,
    ) => {
      const normalizedCommands = (Array.isArray(commandList) ? commandList : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
      const unresolved = collectUnresolvedPlaceholders(normalizedCommands);
      if (unresolved.length > 0) {
        throw createDeliveryError(
          'DELIVERY_TEMPLATE_PLACEHOLDER_MISSING',
          `Unresolved placeholders: ${unresolved.join(', ')}`,
          {
            retryable: false,
            step: `${phase}-command`,
            recoveryHint: 'เติมค่าที่จำเป็นให้ command template เช่น teleportTarget, returnTarget หรือ announceText',
            meta: {
              phase,
              unresolvedPlaceholders: unresolved,
              deliveryItem,
            },
          },
        );
      }
      for (let i = 0; i < normalizedCommands.length; i += 1) {
        const gameCommand = normalizedCommands[i];
        const operation = classifyCommandOperation(gameCommand, phase);
        queueAudit('info', 'command-dispatch', job, operation.title, {
          phase,
          step: operation.step,
          stage: operation.stage,
          source: phase === 'item' ? 'game-command' : 'agent-hook',
          status: 'running',
          title: operation.title,
          commandTitle: operation.title,
          command: gameCommand,
          commandIndex: i + 1,
          commandCount: normalizedCommands.length,
          deliveryItem,
          executionMode: executionSettings.executionMode,
          backend: defaultExecutionBackendForMode(executionSettings.executionMode),
          commandPath: buildCommandPath({
            executionMode: executionSettings.executionMode,
            backend: defaultExecutionBackendForMode(executionSettings.executionMode),
            stage: operation.stage,
            source: phase === 'item' ? 'game-command' : 'agent-hook',
            failover: preflightState?.failover,
          }),
        });
        let output;
        try {
          output = await runGameCommand(gameCommand, executionSettings);
        } catch (error) {
          queueAudit(
            'error',
            'command-failed',
            job,
            `${operation.title} failed: ${trimText(error?.message || 'Game command execution failed', 300)}`,
            {
              phase,
              step: operation.step,
              stage: operation.stage,
              source: phase === 'item' ? 'game-command' : 'agent-hook',
              status: 'failed',
              title: `${operation.title} failed`,
              commandTitle: operation.title,
              command: gameCommand,
              commandIndex: i + 1,
              commandCount: normalizedCommands.length,
              deliveryItem,
              errorCode:
                String(error?.deliveryCode || error?.agentCode || error?.code || 'DELIVERY_COMMAND_EXEC_FAILED'),
              retryable: error?.retryable !== false,
              executionMode: executionSettings.executionMode,
              backend: defaultExecutionBackendForMode(executionSettings.executionMode),
              commandPath: buildCommandPath({
                executionMode: executionSettings.executionMode,
                backend: defaultExecutionBackendForMode(executionSettings.executionMode),
                stage: operation.stage,
                source: phase === 'item' ? 'game-command' : 'agent-hook',
                failover: preflightState?.failover,
              }),
            },
          );
          throw createDeliveryError(
            error?.deliveryCode || error?.agentCode || 'DELIVERY_COMMAND_EXEC_FAILED',
            error?.message || 'Game command execution failed',
            {
              retryable: error?.retryable !== false,
              step: `${phase}-command`,
              command: gameCommand,
              recoveryHint:
                phase === 'pre'
                  ? 'ตรวจ pre-command, agent focus และ target ก่อน retry'
                  : 'ตรวจ command log, agent focus, และสถานะ SCUM client ก่อน retry',
              meta: {
                phase,
                deliveryItem,
                preflightState,
              },
            },
          );
        }
        outputs.push({
          phase,
          mode: output.mode || executionSettings.executionMode,
          backend: output.backend || null,
          commandPath: output.commandPath || null,
          gameItemId: deliveryItem?.gameItemId || null,
          quantity: deliveryItem?.quantity || null,
          command: output.command,
          stdout: output.stdout,
          stderr: output.stderr,
        });
        job.executionMode = output.mode || executionSettings.executionMode;
        job.executionBackend =
          output.backend || defaultExecutionBackendForMode(output.mode || executionSettings.executionMode);
        job.commandPath = output.commandPath || buildCommandPath({
          executionMode: job.executionMode,
          backend: job.executionBackend,
          stage: operation.stage,
          failover: preflightState?.failover,
        });
        queueAudit('info', 'command-ok', job, operation.title, {
          phase,
          step: operation.step,
          stage: operation.stage,
          source:
            output.mode === 'agent'
              ? phase === 'item'
                ? 'game-command'
                : 'agent-hook'
              : 'rcon',
          status: 'ok',
          title: `${operation.title} complete`,
          commandTitle: operation.title,
          command: output.command,
          commandIndex: i + 1,
          commandCount: normalizedCommands.length,
          deliveryItem,
          outputs: [
            {
              phase,
              mode: output.mode || executionSettings.executionMode,
              backend: output.backend || null,
              commandPath: output.commandPath || null,
              gameItemId: deliveryItem?.gameItemId || null,
              quantity: deliveryItem?.quantity || null,
              command: output.command,
              stdout: output.stdout,
              stderr: output.stderr,
            },
          ],
          commandSummary: output.command,
          executionMode: output.mode || executionSettings.executionMode,
          backend: output.backend || defaultExecutionBackendForMode(output.mode || executionSettings.executionMode),
          commandPath: output.commandPath || buildCommandPath({
            executionMode: output.mode || executionSettings.executionMode,
            backend: output.backend || defaultExecutionBackendForMode(output.mode || executionSettings.executionMode),
            stage: operation.stage,
            source:
              output.mode === 'agent'
                ? phase === 'item'
                  ? 'game-command'
                  : 'agent-hook'
                : 'rcon',
            failover: preflightState?.failover,
          }),
        });
        if (
          executionSettings.executionMode === 'agent'
          && executionSettings.agentCommandDelayMs > 0
          && i < normalizedCommands.length - 1
        ) {
          await sleep(executionSettings.agentCommandDelayMs);
        }
      }
    };

    await executePhaseCommands('pre', preCommands);
    if (preCommands.length > 0 && executionSettings.executionMode === 'agent') {
      const prePhaseDelayMs = preCommands.some(isTeleportCommand)
        ? executionSettings.agentPostTeleportDelayMs
        : executionSettings.agentCommandDelayMs;
      if (prePhaseDelayMs > 0) {
        await sleep(prePhaseDelayMs);
      }
    }

    for (const deliveryItem of resolvedDeliveryItems) {
      const itemVars = buildDeliveryTemplateVars(
        {
          ...context,
          gameItemId: deliveryItem.gameItemId,
          quantity: deliveryItem.quantity,
        },
        executionSettings,
      );
      const itemCommands = commands.map((template) => {
        return renderItemCommand(
          template,
          itemVars,
          executionSettings,
          { singlePlayer: executionSettings.executionMode === 'agent' },
        );
      });
      await executePhaseCommands('item', itemCommands, deliveryItem);
      if (
        executionSettings.executionMode === 'agent'
        && executionSettings.agentCommandDelayMs > 0
        && deliveryItem !== resolvedDeliveryItems[resolvedDeliveryItems.length - 1]
      ) {
        await sleep(executionSettings.agentCommandDelayMs);
      }
    }

    if (postCommands.length > 0 && executionSettings.executionMode === 'agent') {
      await sleep(executionSettings.agentCommandDelayMs);
    }
    await executePhaseCommands('post', postCommands);

    const verification = await verifyDeliveryExecution(outputs, executionSettings, {
      purchaseCode,
    });
    if (!verification.ok) {
    queueAudit('warn', 'verify-failed', job, `Delivery verification failed: ${verification.reason || 'verify failed'}`, {
      step: 'verify-failed',
      stage: 'verify',
        source: 'worker',
        status: 'failed',
        title: 'Verification failed',
        preflightState,
        steamId: link.steamId,
        deliveryItems: resolvedDeliveryItems,
        outputs,
      verification,
      errorCode: verification.reason || 'DELIVERY_VERIFY_FAILED',
      retryable: true,
      recoveryHint: 'ตรวจ output ของ command, watcher health และ verify policy ก่อน retry',
      executionMode: executionSettings.executionMode,
      backend: outputs[outputs.length - 1]?.backend || defaultExecutionBackendForMode(executionSettings.executionMode),
      commandPath: outputs[outputs.length - 1]?.commandPath || buildCommandPath({
        executionMode: executionSettings.executionMode,
        backend: outputs[outputs.length - 1]?.backend || defaultExecutionBackendForMode(executionSettings.executionMode),
        stage: 'verify',
        failover: preflightState?.failover,
      }),
    });
      throw createDeliveryError(
        verification.reason || 'DELIVERY_VERIFY_FAILED',
        verification.failures?.[0]?.detail || 'Delivery verification failed',
        {
          retryable: true,
          step: 'verify',
          recoveryHint: 'ตรวจ output ของ command, watcher health และ verify policy ก่อน retry',
          meta: {
            verification,
            preflightState,
          },
        },
      );
    }
    queueAudit('info', 'verify-ok', job, 'Delivery verification passed', {
      step: 'verify-success',
      stage: 'verify',
      source: 'worker',
      status: 'ok',
      title: 'Verification passed',
      preflightState,
      steamId: link.steamId,
      deliveryItems: resolvedDeliveryItems,
      outputs,
      verification,
      executionMode: executionSettings.executionMode,
      backend: outputs[outputs.length - 1]?.backend || defaultExecutionBackendForMode(executionSettings.executionMode),
      commandPath: outputs[outputs.length - 1]?.commandPath || buildCommandPath({
        executionMode: executionSettings.executionMode,
        backend: outputs[outputs.length - 1]?.backend || defaultExecutionBackendForMode(executionSettings.executionMode),
        stage: 'verify',
        failover: preflightState?.failover,
      }),
    });

    await setPurchaseStatusByCode(purchaseCode, 'delivered', {
      actor: 'delivery-worker',
      reason: 'delivery-success',
      meta: {
        deliveryItems: resolvedDeliveryItems,
      },
    }).catch(() => null);
    removeJob(purchaseCode);
    markRecentlyDelivered(purchaseCode);
    removeDeliveryDeadLetter(purchaseCode);
    recordDeliveryOutcome(true, { purchaseCode: purchaseCode });
    const commandSummary = summarizeCommandOutputs(outputs, 700);
    queueAudit(
      'info',
      'success',
      job,
      commandSummary
        ? `Auto delivery complete | commands: ${commandSummary}`
        : 'Auto delivery complete',
      {
        step: 'completed',
        stage: 'completed',
        source: 'worker',
        status: 'completed',
        title: 'Delivery completed',
        preflightState,
        verification,
        steamId: link.steamId,
        deliveryItems: resolvedDeliveryItems,
        outputs,
        commandSummary: commandSummary || null,
        executionMode: executionSettings.executionMode,
        backend: outputs[outputs.length - 1]?.backend || defaultExecutionBackendForMode(executionSettings.executionMode),
        commandPath: outputs[outputs.length - 1]?.commandPath || buildCommandPath({
          executionMode: executionSettings.executionMode,
          backend: outputs[outputs.length - 1]?.backend || defaultExecutionBackendForMode(executionSettings.executionMode),
          stage: 'completed',
          failover: preflightState?.failover,
        }),
      },
    );
    const deliveredItemsText = trimText(
      resolvedDeliveryItems
        .map((entry) => `${entry.gameItemId} x${entry.quantity}`)
        .join(', '),
      240,
    );
    await trySendDiscordAudit(
      job,
      `[OK] **Auto delivered** | code: \`${purchaseCode}\` | item: \`${job.itemName || job.itemId}\` | delivery: \`${deliveredItemsText || `${firstDeliveryItem.gameItemId} x${firstDeliveryItem.quantity}`}\` | steam: \`${link.steamId}\``,
    );
  } finally {
    inFlightPurchaseCodes.delete(purchaseCode);
  }
}

async function processDueJobOnce() {
  const settings = getSettings();
  if (!settings.enabled) {
    return { processed: false, reason: 'delivery-disabled' };
  }
  if (workerBusy) {
    return { processed: false, reason: 'worker-busy' };
  }

  const job = nextDueJob();
  if (!job) {
    return { processed: false, reason: 'empty-queue' };
  }

  workerBusy = true;
  queueAudit('info', 'attempt', job, 'Processing auto-delivery job', {
    step: 'worker-picked',
    stage: 'worker',
    source: 'worker',
    status: 'running',
    title: 'Worker processing job',
    executionMode: job?.executionMode || settings.executionMode,
    backend: job?.executionBackend || defaultExecutionBackendForMode(job?.executionMode || settings.executionMode),
    commandPath: job?.commandPath || buildCommandPath({
      executionMode: job?.executionMode || settings.executionMode,
      backend: job?.executionBackend || defaultExecutionBackendForMode(job?.executionMode || settings.executionMode),
      stage: 'worker',
    }),
  });
  try {
    await processJob(job);
    return { processed: true, purchaseCode: job.purchaseCode, ok: true };
  } catch (error) {
    await handleRetry(job, error);
    return {
      processed: true,
      purchaseCode: job.purchaseCode,
      ok: false,
      error: formatDeliveryErrorSummary(error),
    };
  } finally {
    workerBusy = false;
  }
}

// Admin-triggered retries and the background worker both flow through this pump so queue
// semantics stay identical no matter which runtime is currently driving delivery.
async function processDeliveryQueueNow(limit = 1) {
  await syncDeliveryPersistenceStore({ force: true });
  const max = Math.max(1, Math.trunc(Number(limit || 1)));
  let processed = 0;
  let lastResult = { processed: false, reason: 'empty-queue' };

  while (processed < max) {
    lastResult = await processDueJobOnce();
    if (!lastResult.processed) break;
    processed += 1;
  }

  return {
    processed,
    queueLength: jobs.size,
    metrics: getDeliveryMetricsSnapshot(),
    lastResult,
  };
}

function kickWorker(delayMs = 10) {
  if (!workerStarted) return;
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = setTimeout(() => {
    void workerTick();
  }, Math.max(10, delayMs));
}

async function workerTick() {
  const settings = getSettings();
  if (!workerStarted) return;
  await syncDeliveryPersistenceStore();
  if (!settings.enabled) {
    kickWorker(settings.queueIntervalMs);
    return;
  }
  if (workerBusy) {
    kickWorker(settings.queueIntervalMs);
    return;
  }
  await processDueJobOnce();
  maybeAlertQueueStuck();
  kickWorker(settings.queueIntervalMs);
}

async function enqueuePurchaseDelivery(purchase, context = {}) {
  const settings = getSettings();
  if (!purchase?.code || !purchase?.itemId || !purchase?.userId) {
    return { queued: false, reason: 'invalid-purchase' };
  }
  const purchaseCode = String(purchase.code);
  if (purchase.status === 'delivered' || purchase.status === 'refunded') {
    markRecentlyDelivered(purchaseCode);
    addDeliveryAudit({
      level: 'info',
      action: 'skip-terminal-status',
      purchaseCode,
      itemId: String(purchase.itemId),
      userId: String(purchase.userId),
      meta: buildExecutionAuditMeta(
        {
          purchaseCode,
          userId: String(purchase.userId),
          itemId: String(purchase.itemId),
          attempts: 0,
        },
        {
          status: purchase.status,
          stage: 'queue',
          source: 'queue',
        },
        settings,
      ),
      message: `Skip enqueue because purchase status is ${purchase.status}`,
    });
    return { queued: false, reason: 'terminal-status' };
  }
  const shopItem = await getShopItemById(purchase.itemId).catch(() => null);
  const itemName = String(context.itemName || shopItem?.name || purchase.itemId);
  const fallbackDeliveryItems = normalizeDeliveryItemsForJob(shopItem?.deliveryItems, {
    gameItemId: shopItem?.gameItemId || purchase.itemId,
    quantity: shopItem?.quantity || 1,
    iconUrl: shopItem?.iconUrl || null,
  });
  const hasCustomDeliveryContext =
    Array.isArray(context.deliveryItems)
    || context.gameItemId != null
    || context.quantity != null
    || context.iconUrl != null;
  const contextDeliveryItems = hasCustomDeliveryContext
    ? normalizeDeliveryItemsForJob(context.deliveryItems, {
      gameItemId: context.gameItemId || shopItem?.gameItemId || purchase.itemId,
      quantity: context.quantity || shopItem?.quantity || 1,
      iconUrl: context.iconUrl || shopItem?.iconUrl || null,
    })
    : [];
  const resolvedDeliveryItems =
    contextDeliveryItems.length > 0 ? contextDeliveryItems : fallbackDeliveryItems;
  const primary = resolvedDeliveryItems[0] || {
    gameItemId: String(context.gameItemId || shopItem?.gameItemId || purchase.itemId),
    quantity: Math.max(1, Math.trunc(Number(context.quantity || shopItem?.quantity || 1))),
    iconUrl: String(context.iconUrl || shopItem?.iconUrl || '').trim() || null,
  };
  const gameItemId = String(primary.gameItemId || purchase.itemId);
  const quantity = Math.max(1, Math.trunc(Number(primary.quantity || 1)));
  const iconUrl =
    primary.iconUrl || resolveItemIconUrl(context.itemId || shopItem || purchase.itemId);
  const itemKind = String(context.itemKind || shopItem?.kind || 'item');

  if (!settings.enabled) {
    addDeliveryAudit({
      level: 'info',
      action: 'skip-disabled',
      purchaseCode: String(purchase.code),
      itemId: String(purchase.itemId),
      userId: String(purchase.userId),
      meta: buildExecutionAuditMeta(
        {
          purchaseCode: String(purchase.code),
          userId: String(purchase.userId),
          itemId: String(purchase.itemId),
          attempts: 0,
        },
        {
          itemName,
          iconUrl,
          gameItemId,
          quantity,
          itemKind,
          deliveryItems: resolvedDeliveryItems,
          stage: 'queue',
          source: 'queue',
        },
        settings,
      ),
      message: 'Auto delivery is disabled',
    });
    return { queued: false, reason: 'delivery-disabled' };
  }

  const commands = resolveItemCommands(purchase.itemId, gameItemId);
  if (commands.length === 0) {
    addDeliveryAudit({
      level: 'info',
      action: 'skip-missing-command',
      purchaseCode: String(purchase.code),
      itemId: String(purchase.itemId),
      userId: String(purchase.userId),
      meta: buildExecutionAuditMeta(
        {
          purchaseCode: String(purchase.code),
          userId: String(purchase.userId),
          itemId: String(purchase.itemId),
          attempts: 0,
        },
        {
          itemName,
          iconUrl,
          gameItemId,
          quantity,
          itemKind,
          deliveryItems: resolvedDeliveryItems,
          stage: 'queue',
          source: 'queue',
        },
        settings,
      ),
      message: 'Item has no configured auto-delivery command',
    });
    return { queued: false, reason: 'item-not-configured' };
  }

  if (resolvedDeliveryItems.length > 1 && !commandSupportsBundleItems(commands)) {
    addDeliveryAudit({
      level: 'warn',
      action: 'skip-invalid-template',
      purchaseCode: String(purchase.code),
      itemId: String(purchase.itemId),
      userId: String(purchase.userId),
      meta: buildExecutionAuditMeta(
        {
          purchaseCode: String(purchase.code),
          userId: String(purchase.userId),
          itemId: String(purchase.itemId),
          attempts: 0,
        },
        {
          deliveryItems: resolvedDeliveryItems,
          itemName,
          templateRule: '{gameItemId} or {quantity}',
          stage: 'queue',
          source: 'queue',
        },
        settings,
      ),
      message:
        'Bundle delivery requires {gameItemId} or {quantity} in itemCommands template',
    });
    return { queued: false, reason: 'bundle-template-missing-placeholder' };
  }

  if (jobs.has(purchaseCode)) {
    return { queued: true, reason: 'already-queued' };
  }
  if (inFlightPurchaseCodes.has(purchaseCode)) {
    return { queued: false, reason: 'already-processing' };
  }
  if (isRecentlyDelivered(purchaseCode)) {
    return { queued: false, reason: 'idempotent-recent-success' };
  }

  let plannedExecutionMode = settings.executionMode;
  let plannedExecutionBackend = defaultExecutionBackendForMode(plannedExecutionMode);
  let plannedCommandPath = buildCommandPath({
    executionMode: plannedExecutionMode,
    backend: plannedExecutionBackend,
    stage: 'queue',
  });
  let preflightSnapshot = null;

  if (settings.executionMode === 'agent') {
    const link = getLinkByUserId(purchase.userId);
    if (!link?.steamId) {
      addDeliveryAudit({
        level: 'warn',
        action: 'enqueue-blocked',
        purchaseCode,
        itemId: String(purchase.itemId),
        userId: String(purchase.userId),
        message: 'Agent delivery requires a linked Steam profile before enqueue',
        meta: buildExecutionAuditMeta(
          {
            purchaseCode,
            userId: String(purchase.userId),
            itemId: String(purchase.itemId),
            attempts: 0,
            executionMode: 'agent',
            executionBackend: plannedExecutionBackend,
            commandPath: plannedCommandPath,
          },
          {
            step: 'enqueue-preflight',
            stage: 'preflight',
            source: 'queue',
            status: 'blocked',
            title: 'Enqueue blocked by agent preflight',
            errorCode: 'DELIVERY_STEAM_LINK_MISSING',
            retryable: false,
            recoveryHint: 'ผูก Steam/SCUM identity ให้เรียบร้อยก่อน enqueue order จริง',
          },
          settings,
        ),
      });
      return { queued: false, reason: 'steam-link-missing' };
    }

    const preflightReport = await getDeliveryPreflightReport({
      settings,
      purchaseCode,
      itemId: String(purchase.itemId),
      itemName,
      steamId: link.steamId,
      userId: String(purchase.userId),
      inGameName: link.inGameName || null,
      gameItemId,
      quantity,
      itemKind,
      deliveryItems: resolvedDeliveryItems,
      teleportMode: shopItem?.deliveryTeleportMode || '',
      teleportTarget: shopItem?.deliveryTeleportTarget || '',
    });
    preflightSnapshot = preflightReport;
    plannedExecutionMode = preflightReport.effectiveMode || plannedExecutionMode;
    plannedExecutionBackend = defaultExecutionBackendForMode(plannedExecutionMode);
    plannedCommandPath = buildCommandPath({
      executionMode: plannedExecutionMode,
      backend: plannedExecutionBackend,
      stage: 'queue',
      failover: preflightReport.failover,
      source: 'queue',
    });

    if (!preflightReport.ready) {
      addDeliveryAudit({
        level: 'warn',
        action: 'enqueue-blocked',
        purchaseCode,
        itemId: String(purchase.itemId),
        userId: String(purchase.userId),
        steamId: link.steamId,
        message: `Delivery preflight blocked enqueue: ${preflightReport.reason || 'preflight-failed'}`,
        meta: buildExecutionAuditMeta(
          {
            purchaseCode,
            userId: String(purchase.userId),
            itemId: String(purchase.itemId),
            attempts: 0,
            executionMode: plannedExecutionMode,
            executionBackend: plannedExecutionBackend,
            commandPath: plannedCommandPath,
          },
          {
            step: 'enqueue-preflight',
            stage: 'preflight',
            source: 'queue',
            status: 'blocked',
            title: 'Enqueue blocked by agent preflight',
            errorCode: preflightReport.reason || 'DELIVERY_PREFLIGHT_FAILED',
            retryable: false,
            preflight: preflightReport,
          },
          settings,
        ),
      });
      return {
        queued: false,
        reason: 'agent-preflight-failed',
        preflight: preflightReport,
      };
    }
  }

  const job = normalizeJob({
    purchaseCode,
    tenantId: String(context.tenantId || purchase.tenantId || '').trim() || null,
    userId: String(purchase.userId),
    itemId: String(purchase.itemId),
    itemName,
    iconUrl,
    gameItemId,
    quantity,
    deliveryItems: resolvedDeliveryItems,
    itemKind,
    guildId: context.guildId ? String(context.guildId) : null,
    executionMode: plannedExecutionMode,
    executionBackend: plannedExecutionBackend,
    commandPath: plannedCommandPath,
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (!job) return { queued: false, reason: 'invalid-job' };

  setJob(job);
  if (deadLetters.has(purchaseCode)) {
    removeDeliveryDeadLetter(purchaseCode);
  }
  await setPurchaseStatusByCode(purchaseCode, 'delivering', {
    actor: 'delivery-worker',
    reason: 'delivery-enqueued',
  }).catch(() => null);
  queueAudit('info', 'queued', job, 'Queued purchase for auto-delivery', {
    step: 'queued',
    stage: 'queue',
    source: 'worker',
    status: 'queued',
    title: 'Queued',
    deliveryItems: resolvedDeliveryItems,
    preflight: preflightSnapshot,
    executionMode: plannedExecutionMode,
    backend: plannedExecutionBackend,
    commandPath: plannedCommandPath,
  });
  kickWorker(20);
  return { queued: true, reason: 'queued' };
}

async function enqueuePurchaseDeliveryByCode(purchaseCode, context = {}) {
  const purchase = await findPurchaseByCode(String(purchaseCode || ''));
  if (!purchase) {
    return { ok: false, reason: 'purchase-not-found' };
  }
  const result = await enqueuePurchaseDelivery(purchase, context);
  return { ok: result.queued, ...result };
}

function retryDeliveryNow(purchaseCode) {
  const code = String(purchaseCode || '').trim();
  const job = jobs.get(code);
  if (!job) return null;
  setJob({
    ...job,
    nextAttemptAt: Date.now(),
    updatedAt: nowIso(),
    lastError: null,
  });
  queueAudit('info', 'manual-retry', job, 'Manual retry requested', {
    step: 'manual-retry',
    stage: 'retry',
    source: 'admin',
    status: 'retrying',
    title: 'Manual retry requested',
  });
  kickWorker(20);
  return { ...jobs.get(code) };
}

async function retryDeliveryDeadLetter(purchaseCode, context = {}) {
  const code = String(purchaseCode || '').trim();
  const deadLetter = deadLetters.get(code);
  if (!deadLetter) {
    return { ok: false, reason: 'dead-letter-not-found' };
  }

  const result = await enqueuePurchaseDeliveryByCode(code, context);
  if (!result.ok) {
    return result;
  }

  removeDeliveryDeadLetter(code);
  queueAudit('info', 'dead-letter-retry', deadLetter, 'Retry dead-letter queued', {
    step: 'dead-letter-retry',
    stage: 'retry',
    source: 'admin',
    status: 'retrying',
    title: 'Dead-letter requeued',
  });
  publishAdminLiveUpdate('delivery-dead-letter', {
    action: 'retry',
    purchaseCode: code,
    count: deadLetters.size,
  });
  return { ok: true, reason: 'queued', queueLength: jobs.size };
}

function retryDeliveryNowMany(purchaseCodes = []) {
  const codes = Array.isArray(purchaseCodes)
    ? purchaseCodes.map((code) => String(code || '').trim()).filter(Boolean)
    : [];
  const results = [];
  for (const code of codes) {
    const result = retryDeliveryNow(code);
    results.push({
      code,
      ok: Boolean(result),
      data: result || null,
    });
  }
  return {
    total: codes.length,
    queued: results.filter((row) => row.ok).length,
    results,
  };
}

async function retryDeliveryDeadLetterMany(purchaseCodes = [], context = {}) {
  const codes = Array.isArray(purchaseCodes)
    ? purchaseCodes.map((code) => String(code || '').trim()).filter(Boolean)
    : [];
  const results = [];
  for (const code of codes) {
    const result = await retryDeliveryDeadLetter(code, context);
    results.push({
      code,
      ok: Boolean(result?.ok),
      data: result || null,
      reason: result?.reason || null,
    });
  }
  return {
    total: codes.length,
    queued: results.filter((row) => row.ok).length,
    results,
  };
}

function cancelDeliveryJob(purchaseCode, reason = 'manual-cancel') {
  const code = String(purchaseCode || '').trim();
  const job = jobs.get(code);
  if (!job) return null;
  removeJob(code);
  queueAudit('warn', 'manual-cancel', job, `Queue job cancelled: ${reason}`, {
    step: 'manual-cancel',
    stage: 'cancelled',
    source: 'admin',
    status: 'cancelled',
    title: 'Queue job cancelled',
  });
  return { ...job };
}

function startRconDeliveryWorker(client) {
  if (client) workerClient = client;
  if (workerStarted) return;
  workerStarted = true;
  console.log('[delivery] auto delivery worker started');
  kickWorker(100);
}

module.exports = {
  startRconDeliveryWorker,
  initDeliveryPersistenceStore,
  flushDeliveryPersistenceWrites,
  enqueuePurchaseDelivery,
  enqueuePurchaseDeliveryByCode,
  listDeliveryQueue,
  listFilteredDeliveryQueue,
  replaceDeliveryQueue,
  listDeliveryDeadLetters,
  listFilteredDeliveryDeadLetters,
  replaceDeliveryDeadLetters,
  removeDeliveryDeadLetter,
  retryDeliveryNow,
  retryDeliveryNowMany,
  retryDeliveryDeadLetter,
  retryDeliveryDeadLetterMany,
  cancelDeliveryJob,
  listDeliveryAudit,
  getDeliveryMetricsSnapshot,
  getDeliveryRuntimeSnapshotSync,
  getDeliveryRuntimeStatus,
  getDeliveryPreflightReport,
  processDeliveryQueueNow,
  previewDeliveryCommands,
  simulateDeliveryPlan,
  sendTestDeliveryCommand,
  listScumAdminCommandCapabilities,
  testScumAdminCommandCapability,
  getDeliveryCommandOverride,
  setDeliveryCommandOverride,
  getDeliveryDetailsByPurchaseCode,
};



