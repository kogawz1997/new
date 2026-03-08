const { exec } = require('node:child_process');

const config = require('../config');
const { loadJson, saveJsonDebounced } = require('../store/_persist');
const { prisma } = require('../prisma');
const { getLinkByUserId } = require('../store/linkStore');
const { addDeliveryAudit, listDeliveryAudit } = require('../store/deliveryAuditStore');
const {
  findPurchaseByCode,
  setPurchaseStatusByCode,
  getShopItemById,
} = require('../store/memoryStore');
const { publishAdminLiveUpdate } = require('./adminLiveBus');
const { resolveItemIconUrl } = require('./itemIconService');

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

function nowIso() {
  return new Date().toISOString();
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimText(value, maxLen = 500) {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function getSettings() {
  const auto = config.delivery?.auto || {};
  return {
    enabled: auto.enabled === true,
    queueIntervalMs: Math.max(250, asNumber(auto.queueIntervalMs, 1200)),
    maxRetries: Math.max(0, asNumber(auto.maxRetries, 3)),
    retryDelayMs: Math.max(500, asNumber(auto.retryDelayMs, 6000)),
    retryBackoff: Math.max(1, asNumber(auto.retryBackoff, 1.8)),
    commandTimeoutMs: Math.max(1000, asNumber(auto.commandTimeoutMs, 10000)),
    failedStatus: String(auto.failedStatus || 'delivery_failed'),
    itemCommands: auto.itemCommands && typeof auto.itemCommands === 'object'
      ? auto.itemCommands
      : {},
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

function resolveItemCommands(itemId) {
  const settings = getSettings();
  const raw = settings.itemCommands[String(itemId)] || settings.itemCommands[String(itemId).toLowerCase()];
  return normalizeCommands(raw);
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
    command: gameCommand,
    shellCommand,
    stdout: trimText(stdout, 1200),
    stderr: trimText(stderr, 1200),
  };
}

function normalizeDeliveryItemsForJob(items, fallback = {}) {
  const source = Array.isArray(items) ? items : [];
  const out = [];
  const byKey = new Map();

  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const gameItemId = String(raw.gameItemId || raw.id || '').trim();
    if (!gameItemId) continue;
    const quantity = Math.max(1, Math.trunc(Number(raw.quantity || 1)));
    const iconUrl = String(raw.iconUrl || '').trim() || null;
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

  const fallbackGameItemId = String(fallback.gameItemId || '').trim();
  if (!fallbackGameItemId) return [];
  return [
    {
      gameItemId: fallbackGameItemId,
      quantity: Math.max(1, Math.trunc(Number(fallback.quantity || 1))),
      iconUrl: String(fallback.iconUrl || '').trim() || null,
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

const persisted = loadJson('delivery-queue.json', null);
if (persisted?.jobs && Array.isArray(persisted.jobs)) {
  for (const rawJob of persisted.jobs) {
    const job = normalizeJob(rawJob);
    if (!job) continue;
    jobs.set(job.purchaseCode, job);
  }
}

const persistedDeadLetters = loadJson('delivery-dead-letter.json', null);
if (persistedDeadLetters?.deadLetters && Array.isArray(persistedDeadLetters.deadLetters)) {
  for (const row of persistedDeadLetters.deadLetters) {
    const normalized = normalizeDeadLetter(row);
    if (!normalized) continue;
    deadLetters.set(normalized.purchaseCode, normalized);
  }
}

const scheduleQueueSave = saveJsonDebounced('delivery-queue.json', () => ({
  jobs: Array.from(jobs.values()).map((job) => ({ ...job })),
}));

const scheduleDeadLetterSave = saveJsonDebounced('delivery-dead-letter.json', () => ({
  deadLetters: Array.from(deadLetters.values()).map((row) => ({ ...row })),
}));

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
        scheduleQueueSave();
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
        scheduleDeadLetterSave();
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

function initDeliveryPersistenceStore() {
  if (!initPromise) {
    initPromise = hydrateDeliveryPersistenceFromPrisma();
  }
  return initPromise;
}

initDeliveryPersistenceStore();

function listDeliveryQueue(limit = 500) {
  const max = Math.max(1, Number(limit || 500));
  return Array.from(jobs.values())
    .slice()
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
    .slice(0, max)
    .map((job) => ({ ...job }));
}

function replaceDeliveryQueue(nextJobs = []) {
  mutationVersion += 1;
  jobs.clear();
  for (const row of Array.isArray(nextJobs) ? nextJobs : []) {
    const normalized = normalizeJob(row);
    if (!normalized) continue;
    jobs.set(normalized.purchaseCode, normalized);
  }
  scheduleQueueSave();
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
    .map((row) => ({ ...row }));
}

function replaceDeliveryDeadLetters(nextRows = []) {
  mutationVersion += 1;
  deadLetters.clear();
  for (const row of Array.isArray(nextRows) ? nextRows : []) {
    const normalized = normalizeDeadLetter(row);
    if (!normalized) continue;
    deadLetters.set(normalized.purchaseCode, normalized);
  }
  scheduleDeadLetterSave();
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
  scheduleDeadLetterSave();
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
  scheduleDeadLetterSave();
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
  scheduleQueueSave();
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
  scheduleQueueSave();
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

async function handleRetry(job, reason) {
  const settings = getSettings();
  recordDeliveryOutcome(false, { purchaseCode: job?.purchaseCode });
  const nextAttempt = Number(job.attempts || 0) + 1;
  if (nextAttempt > settings.maxRetries) {
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
      maxRetries: settings.maxRetries,
      failedStatus: settings.failedStatus,
    });
    addDeliveryDeadLetter(job, reason, {
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
    updatedAt: nowIso(),
  });
  queueAudit('warn', 'retry', job, `${reason} (retry in ${delayMs}ms)`, {
    delayMs,
    maxRetries: settings.maxRetries,
  });
}

async function processJob(job) {
  const purchaseCode = String(job?.purchaseCode || '').trim();
  if (!purchaseCode) {
    throw new Error('Missing purchaseCode in delivery job');
  }
  if (inFlightPurchaseCodes.has(purchaseCode)) {
    throw new Error(
      `Idempotency guard blocked duplicate in-flight delivery for ${purchaseCode}`,
    );
  }

  inFlightPurchaseCodes.add(purchaseCode);
  try {
    const purchase = await findPurchaseByCode(purchaseCode);
    if (!purchase) {
      queueAudit('error', 'missing-purchase', job, 'Purchase not found');
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
    const commands = resolveItemCommands(purchase.itemId);
    if (commands.length === 0) {
      queueAudit(
        'warn',
        'missing-item-commands',
        job,
        `No auto-delivery command for itemId=${purchase.itemId}`,
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
      await handleRetry(job, `Missing steam link for userId=${purchase.userId}`);
      return;
    }

    const context = {
      purchaseCode: purchase.code,
      itemId: purchase.itemId,
      itemName: shopItem?.name || job?.itemName || purchase.itemId,
      gameItemId: firstDeliveryItem.gameItemId,
      quantity: firstDeliveryItem.quantity,
      itemKind: String(shopItem?.kind || job?.itemKind || 'item'),
      userId: purchase.userId,
      steamId: link.steamId,
    };

    const settings = getSettings();
    const outputs = [];
    const needsItemPlaceholder = commandSupportsBundleItems(commands);

    if (resolvedDeliveryItems.length > 1 && !needsItemPlaceholder) {
      throw new Error(
        'itemCommands ต้องมี {gameItemId} หรือ {quantity} เมื่อสินค้าเป็นหลายไอเทม',
      );
    }

    for (const deliveryItem of resolvedDeliveryItems) {
      const itemContext = {
        ...context,
        gameItemId: deliveryItem.gameItemId,
        quantity: deliveryItem.quantity,
      };
      for (const template of commands) {
        const gameCommand = substituteTemplate(template, itemContext);
        const output = await runRconCommand(gameCommand, settings);
        outputs.push({
          gameItemId: deliveryItem.gameItemId,
          quantity: deliveryItem.quantity,
          command: output.command,
          stdout: output.stdout,
          stderr: output.stderr,
        });
      }
    }

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
    queueAudit('info', 'success', job, 'Auto delivery complete', {
      steamId: link.steamId,
      deliveryItems: resolvedDeliveryItems,
      outputs,
    });
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
    await handleRetry(job, error?.message || 'Unknown delivery error');
    return {
      processed: true,
      purchaseCode: job.purchaseCode,
      ok: false,
      error: String(error?.message || error),
    };
  } finally {
    workerBusy = false;
  }
}

async function processDeliveryQueueNow(limit = 1) {
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

  const commands = resolveItemCommands(purchase.itemId);
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
  replaceDeliveryQueue,
  listDeliveryDeadLetters,
  replaceDeliveryDeadLetters,
  removeDeliveryDeadLetter,
  retryDeliveryNow,
  retryDeliveryDeadLetter,
  cancelDeliveryJob,
  listDeliveryAudit,
  getDeliveryMetricsSnapshot,
  processDeliveryQueueNow,
};



