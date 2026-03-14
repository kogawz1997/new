const { exec } = require('node:child_process');

const config = require('../config');
const { prisma } = require('../prisma');
const { getLinkByUserId } = require('../store/linkStore');
const { addDeliveryAudit, listDeliveryAudit } = require('../store/deliveryAuditStore');
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
let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;
let lastPersistenceSyncAt = 0;
let persistenceSyncPromise = null;

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

function pickCommandList(envKey, fallback) {
  if (Object.prototype.hasOwnProperty.call(process.env, envKey)) {
    return parseCommandList(process.env[envKey]);
  }
  return parseCommandList(fallback);
}

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
    magazineStackCount: Math.max(
      1,
      Math.trunc(
        asNumber(
          process.env.DELIVERY_MAGAZINE_STACKCOUNT,
          auto.magazineStackCount || 100,
        ),
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

function isTeleportCommand(command) {
  const text = String(command || '').trim();
  return /^#TeleportTo(?:Vehicle)?\b/i.test(text);
}

function isSpawnItemCommand(command) {
  const text = String(command || '').trim();
  return /^#SpawnItem\b/i.test(text);
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

function resolveItemCommands(itemId, gameItemId = null) {
  const settings = getSettings();
  const byItemId = findCommandOverride(settings.itemCommands, itemId);
  const normalizedByItemId = normalizeCommands(byItemId);
  if (normalizedByItemId.length > 0) {
    return normalizedByItemId;
  }

  const byGameItemId = findCommandOverride(settings.itemCommands, gameItemId);
  const normalizedByGameItemId = normalizeCommands(byGameItemId);
  if (normalizedByGameItemId.length > 0) {
    return normalizedByGameItemId;
  }

  if (settings.wikiWeaponCommandFallbackEnabled) {
    const wikiTemplate = resolveWikiWeaponCommandTemplate(gameItemId);
    const normalizedWikiTemplate = normalizeCommands(wikiTemplate);
    if (normalizedWikiTemplate.length > 0) {
      return normalizedWikiTemplate;
    }
  }

  if (settings.itemManifestCommandFallbackEnabled) {
    const manifestTemplate = resolveManifestItemCommandTemplate(gameItemId);
    const normalizedManifestTemplate = normalizeCommands(manifestTemplate);
    if (normalizedManifestTemplate.length > 0) {
      return normalizedManifestTemplate;
    }
  }

  return [];
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

  const commands = resolveItemCommands(resolvedItemId, resolvedGameItemId);
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
    commandTemplates: commands,
    serverCommands,
    singlePlayerCommands,
    agentPreCommands: executionPlan.agentPreCommands,
    agentPostCommands: executionPlan.agentPostCommands,
    allCommands: executionPlan.allCommands,
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

  const commandSummary = summarizeCommandOutputs(outputs, 700);
  addDeliveryAudit({
    level: 'info',
    action: 'manual-test-send',
    purchaseCode,
    itemId: preview.itemId || preview.gameItemId || null,
    userId,
    steamId,
    message: commandSummary
      ? `Manual test send complete | commands: ${commandSummary}`
      : 'Manual test send complete',
    meta: {
      source: 'admin-web',
      executionMode: settings.executionMode,
      deliveryItems: preview.deliveryItems || [],
      outputs,
      commandSummary: commandSummary || null,
    },
  });

  return {
    ...preview,
    purchaseCode,
    steamId,
    userId,
    outputs,
    commandSummary,
  };
}

function runShell(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    exec(
      command,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
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
  if (settings.executionMode !== 'agent') {
    return {
      ok: true,
      mode: settings.executionMode,
      checks: ['delivery-worker'],
    };
  }

  const health = await fetchAgentHealth(settings);
  if (!health.ok || !health.reachable) {
    throw createDeliveryError(
      health.errorCode || 'AGENT_UNREACHABLE',
      health.error || 'SCUM console agent is unreachable',
      {
        step: 'preflight',
        recoveryHint: 'ตรวจ agent process, token และ health endpoint ก่อน retry',
        meta: { health },
      },
    );
  }

  const preflight = await fetchAgentPreflight(settings);
  if (!preflight.ok) {
    throw createDeliveryError(
      preflight.errorCode || 'AGENT_PREFLIGHT_FAILED',
      preflight.error || 'SCUM console agent preflight failed',
      {
        step: 'preflight',
        recoveryHint: 'เช็ก SCUM client, focus ของหน้าต่างเกม, และ Windows session ว่ายัง active',
        meta: { preflight, health },
      },
    );
  }

  queueAudit('info', 'preflight-ok', job, 'Agent preflight passed', {
    preflight: preflight.result || null,
    health: {
      status: health.status || null,
      ready: health.ready === true,
      backend: health.backend || null,
      activeExecutionCount: health.activeExecutionCount || 0,
    },
    context,
  });

  return {
    ok: true,
    health,
    preflight,
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

async function runRconCommand(gameCommand, settings) {
  const shellTemplate = getRconTemplate();
  if (!shellTemplate) {
    throw new Error('RCON_EXEC_TEMPLATE is not set');
  }

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

  const shellCommand = substituteTemplate(shellTemplate, {
    host,
    port,
    password,
    command: gameCommand,
  });

  const { stdout, stderr } = await runShell(shellCommand, settings.commandTimeoutMs);
  return {
    mode: 'rcon',
    command: gameCommand,
    shellCommand,
    stdout: trimText(stdout, 1200),
    stderr: trimText(stderr, 1200),
  };
}

async function runAgentCommand(gameCommand, settings) {
  const baseUrl = getAgentBaseUrl();
  const token = String(process.env.SCUM_CONSOLE_AGENT_TOKEN || '').trim();
  if (!token) {
    throw new Error('SCUM_CONSOLE_AGENT_TOKEN is not set');
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
    throw new Error(
      trimText(
        payload?.error
          || payload?.message
          || `SCUM console agent error ${res.status}`,
        500,
      ),
    );
  }

  return {
    mode: 'agent',
    command: gameCommand,
    backend: payload.result.backend || null,
    shellCommand: payload.result.shellCommand || null,
    stdout: trimText(payload.result.stdout, 1200),
    stderr: trimText(payload.result.stderr, 1200),
    pid: payload.result.pid || null,
  };
}

async function runGameCommand(gameCommand, settings) {
  if (settings.executionMode === 'agent') {
    return runAgentCommand(gameCommand, settings);
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
      ready,
    };
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

  runtime.readiness = {
    ready:
      settings.enabled
      && (
        settings.executionMode !== 'agent'
        || Boolean(runtime.agent?.ready)
      ),
    reason:
      !settings.enabled
        ? 'delivery-disabled'
        : settings.executionMode === 'agent' && !runtime.agent?.ready
          ? String(runtime.agent?.preflight?.errorCode || runtime.agent?.health?.statusCode || 'agent-not-ready')
          : 'ready',
  };

  return runtime;
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

  return {
    purchaseCode: code,
    purchase,
    queueJob,
    deadLetter,
    link,
    statusHistory,
    auditRows,
    stepLog,
    latestCommandSummary: latestCommandAudit?.meta?.commandSummary || null,
    latestOutputs: Array.isArray(latestCommandAudit?.meta?.outputs)
      ? latestCommandAudit.meta.outputs
      : [],
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
    userId: String(input.userId || '').trim(),
    itemId: String(input.itemId || '').trim(),
    itemName: String(input.itemName || '').trim() || null,
    iconUrl: String(primary?.iconUrl || input.iconUrl || '').trim() || null,
    gameItemId: String(primary?.gameItemId || input.gameItemId || '').trim() || null,
    quantity,
    deliveryItems,
    itemKind: String(input.itemKind || '').trim() || null,
    guildId: input.guildId ? String(input.guildId) : null,
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
    reason: row.reason,
    count: deadLetters.size,
  });
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

function recordDeliveryOutcome(ok, context = {}) {
  deliveryOutcomes.push({
    at: Date.now(),
    ok: ok === true,
    purchaseCode: context.purchaseCode || null,
  });
  const snapshot = getDeliveryMetricsSnapshot();
  maybeAlertFailRate(snapshot);
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
  addDeliveryAudit({
    level,
    action,
    purchaseCode: job?.purchaseCode || null,
    itemId: job?.itemId || null,
    userId: job?.userId || null,
    attempt: job?.attempts == null ? null : job.attempts,
    message,
    meta,
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
      recoveryHint: failure.recoveryHint,
      command: failure.command,
      failureMeta: failure.meta,
      delayMs,
      maxRetries: settings.maxRetries,
    });
}

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

    const preflightState = await runDeliveryPreflight(job, settings, {
      purchaseCode: purchase.code,
      itemId: purchase.itemId,
      steamId: link.steamId,
    });

    const preCommands = agentHooks.preCommands;
    const postCommands = agentHooks.postCommands;

    const executePhaseCommands = async (
      phase,
      commandList,
      deliveryItem = null,
    ) => {
        const normalizedCommands = (Array.isArray(commandList) ? commandList : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
      for (let i = 0; i < normalizedCommands.length; i += 1) {
        const gameCommand = normalizedCommands[i];
        let output;
        try {
          output = await runGameCommand(gameCommand, settings);
        } catch (error) {
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
          mode: output.mode || settings.executionMode,
          backend: output.backend || null,
          gameItemId: deliveryItem?.gameItemId || null,
          quantity: deliveryItem?.quantity || null,
          command: output.command,
          stdout: output.stdout,
          stderr: output.stderr,
        });
        if (
          settings.executionMode === 'agent'
          && settings.agentCommandDelayMs > 0
          && i < normalizedCommands.length - 1
        ) {
          await sleep(settings.agentCommandDelayMs);
        }
      }
    };

    await executePhaseCommands('pre', preCommands);
    if (preCommands.length > 0 && settings.executionMode === 'agent') {
      const prePhaseDelayMs = preCommands.some(isTeleportCommand)
        ? settings.agentPostTeleportDelayMs
        : settings.agentCommandDelayMs;
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
        settings,
      );
      const itemCommands = commands.map((template) => {
        return renderItemCommand(
          template,
          itemVars,
          settings,
          { singlePlayer: settings.executionMode === 'agent' },
        );
      });
      await executePhaseCommands('item', itemCommands, deliveryItem);
      if (
        settings.executionMode === 'agent'
        && settings.agentCommandDelayMs > 0
        && deliveryItem !== resolvedDeliveryItems[resolvedDeliveryItems.length - 1]
      ) {
        await sleep(settings.agentCommandDelayMs);
      }
    }

    if (postCommands.length > 0 && settings.executionMode === 'agent') {
      await sleep(settings.agentCommandDelayMs);
    }
    await executePhaseCommands('post', postCommands);

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
      preflightState,
      steamId: link.steamId,
      deliveryItems: resolvedDeliveryItems,
      outputs,
      commandSummary: commandSummary || null,
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
  queueAudit('info', 'attempt', job, 'Processing auto-delivery job');
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
      meta: {
        status: purchase.status,
      },
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
      meta: {
        itemName,
        iconUrl,
        gameItemId,
        quantity,
        itemKind,
        deliveryItems: resolvedDeliveryItems,
      },
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
      meta: {
        itemName,
        iconUrl,
        gameItemId,
        quantity,
        itemKind,
        deliveryItems: resolvedDeliveryItems,
      },
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
      meta: {
        deliveryItems: resolvedDeliveryItems,
        itemName,
        templateRule: '{gameItemId} or {quantity}',
      },
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

  const job = normalizeJob({
    purchaseCode,
    userId: String(purchase.userId),
    itemId: String(purchase.itemId),
    itemName,
    iconUrl,
    gameItemId,
    quantity,
    deliveryItems: resolvedDeliveryItems,
    itemKind,
    guildId: context.guildId ? String(context.guildId) : null,
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
  queueAudit('info', 'queued', job, 'Queued purchase for auto-delivery');
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
  queueAudit('info', 'manual-retry', job, 'Manual retry requested');
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
  queueAudit('info', 'dead-letter-retry', deadLetter, 'Retry dead-letter queued');
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
  queueAudit('warn', 'manual-cancel', job, `Queue job cancelled: ${reason}`);
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
  getDeliveryRuntimeStatus,
  processDeliveryQueueNow,
  previewDeliveryCommands,
  sendTestDeliveryCommand,
  getDeliveryDetailsByPurchaseCode,
};



