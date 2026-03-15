// scum-log-watcher.js
// Tail SCUM.log and forward parsed events to the bot webhook.
//
// Required env:
// - SCUM_LOG_PATH
// - DISCORD_GUILD_ID
//
// Optional env:
// - SCUM_WEBHOOK_URL=http://127.0.0.1:3100/scum-event
// - SCUM_WEBHOOK_SECRET=
// - SCUM_WATCH_INTERVAL_MS=800
// - SCUM_WEBHOOK_TIMEOUT_MS=7000
// - SCUM_WEBHOOK_MAX_RETRIES=2
// - SCUM_WEBHOOK_RETRY_DELAY_MS=900
// - SCUM_EVENT_DEDUP_WINDOW_MS=2000
// - SCUM_EVENT_QUEUE_MAX=2000
// - SCUM_DEAD_LETTER_LOG_PATH=logs/scum-watcher-dead-letter.log
// - SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS=300000
// - SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS=10
// - SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD=0.3
// - SCUM_QUEUE_ALERT_THRESHOLD=1500
// - SCUM_ALERT_COOLDOWN_MS=60000

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { assertWatcherEnv } = require('../utils/env');
const { startRuntimeHealthServer } = require('./runtimeHealthServer');

function envFlag(value, fallback = false) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveLogPath(env = process.env) {
  return String(env.SCUM_LOG_PATH || '').trim();
}

function resolveWatcherEnabled(env = process.env) {
  const explicit = String(env.SCUM_WATCHER_ENABLED || '').trim();
  if (explicit) return envFlag(explicit, false);
  return resolveLogPath(env).length > 0;
}

const LOG_PATH = resolveLogPath();
const WATCHER_ENABLED = resolveWatcherEnabled();
const WEBHOOK_URL =
  process.env.SCUM_WEBHOOK_URL || 'http://127.0.0.1:3100/scum-event';
const SECRET = process.env.SCUM_WEBHOOK_SECRET || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

function parseNumberEnv(name, fallback, minValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[watcher] invalid ${name}="${raw}", fallback=${fallback}`);
    return fallback;
  }

  if (parsed < minValue) return minValue;
  return parsed;
}

function parseIntegerEnv(name, fallback, minValue) {
  return Math.trunc(parseNumberEnv(name, fallback, minValue));
}

const WATCH_INTERVAL_MS = parseIntegerEnv('SCUM_WATCH_INTERVAL_MS', 800, 250);
const WEBHOOK_TIMEOUT_MS = parseIntegerEnv(
  'SCUM_WEBHOOK_TIMEOUT_MS',
  7000,
  1000,
);
const WEBHOOK_MAX_RETRIES = parseIntegerEnv('SCUM_WEBHOOK_MAX_RETRIES', 2, 0);
const WEBHOOK_RETRY_DELAY_MS = parseIntegerEnv(
  'SCUM_WEBHOOK_RETRY_DELAY_MS',
  900,
  150,
);
const EVENT_DEDUP_WINDOW_MS = parseIntegerEnv(
  'SCUM_EVENT_DEDUP_WINDOW_MS',
  2000,
  500,
);
const EVENT_QUEUE_MAX = parseIntegerEnv('SCUM_EVENT_QUEUE_MAX', 2000, 100);
const DEAD_LETTER_LOG_PATH =
  process.env.SCUM_DEAD_LETTER_LOG_PATH ||
  path.join('logs', 'scum-watcher-dead-letter.log');
const WEBHOOK_ERROR_ALERT_WINDOW_MS = parseIntegerEnv(
  'SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS',
  5 * 60 * 1000,
  60 * 1000,
);
const WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS = parseIntegerEnv(
  'SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS',
  10,
  3,
);
const WEBHOOK_ERROR_ALERT_THRESHOLD = Math.max(
  0.05,
  Math.min(
    1,
    parseNumberEnv('SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD', 0.3, 0.05),
  ),
);
const WATCHER_ALERT_COOLDOWN_MS = parseIntegerEnv(
  'SCUM_ALERT_COOLDOWN_MS',
  60 * 1000,
  15 * 1000,
);
const WATCHER_QUEUE_ALERT_THRESHOLD = parseIntegerEnv(
  'SCUM_QUEUE_ALERT_THRESHOLD',
  Math.max(20, Math.floor(EVENT_QUEUE_MAX * 0.75)),
  10,
);
const WATCHER_FILE_STAT_INTERVAL_MS = parseIntegerEnv(
  'SCUM_WATCHER_FILE_STAT_INTERVAL_MS',
  Math.max(1000, WATCH_INTERVAL_MS * 2),
  1000,
);
const WATCHER_BACKLOG_STALE_MS = parseIntegerEnv(
  'SCUM_WATCHER_BACKLOG_STALE_MS',
  60 * 1000,
  5000,
);
const WATCHER_HEALTH_HOST = String(
  process.env.SCUM_WATCHER_HEALTH_HOST || '127.0.0.1',
).trim() || '127.0.0.1';
const WATCHER_HEALTH_PORT = parseIntegerEnv('SCUM_WATCHER_HEALTH_PORT', 0, 0);

const RESTART_PATTERNS = [
  /Log file closed/i,
  /LogSCUM:\s+Warning:\s+Server restart/i,
  /LogSCUM:\s+Warning:\s+Server shutting down/i,
];

const MAX_DEDUPE_TRACK_SIZE = Math.max(
  5000,
  parseIntegerEnv('SCUM_EVENT_DEDUPE_TRACK_SIZE', 5000, 500),
);

const eventQueue = [];
const eventDedupe = new Map();
const webhookAttemptWindow = [];
let queueRunning = false;
let webhookSuccessCount = 0;
let webhookFailCount = 0;
let lastWebhookErrorAlertAt = 0;
let lastQueuePressureAlertAt = 0;
let lastFileStatAt = 0;
let lastFileReadAt = 0;
let lastEventAt = 0;
let lastRotationAt = 0;
let lastKnownFileSize = 0;
let lastKnownFileMtimeMs = 0;
let lastReadOffset = 0;
let lastBacklogAt = 0;
let lastFileError = null;
let lastFileExists = false;
let watcherFileStatTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactWebhookAttempts(now = Date.now()) {
  const cutoff = now - WEBHOOK_ERROR_ALERT_WINDOW_MS;
  while (
    webhookAttemptWindow.length > 0
    && webhookAttemptWindow[0].at < cutoff
  ) {
    webhookAttemptWindow.shift();
  }
}

function asIso(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function updateFileStateFromStat(stat) {
  const now = Date.now();
  lastFileStatAt = now;
  lastFileError = null;
  lastFileExists = true;
  lastKnownFileSize = Number(stat?.size || 0);
  lastKnownFileMtimeMs = Number(stat?.mtimeMs || 0);
  if (lastKnownFileSize < lastReadOffset) {
    lastReadOffset = lastKnownFileSize;
  }
  if (lastKnownFileSize > lastReadOffset) {
    if (!lastBacklogAt) lastBacklogAt = now;
  } else {
    lastBacklogAt = 0;
  }
}

function markFileError(error) {
  lastFileStatAt = Date.now();
  lastFileError = String(error?.message || error || 'file-stat-failed');
  lastFileExists = false;
  lastKnownFileSize = 0;
  lastKnownFileMtimeMs = 0;
  lastBacklogAt = 0;
}

function getWatcherHealthPayload(now = Date.now()) {
  const snapshot = getWatcherMetricsSnapshot(now);
  const backlogBytes = Math.max(0, lastKnownFileSize - lastReadOffset);
  const backlogAgeMs = lastBacklogAt ? now - lastBacklogAt : 0;
  if (!WATCHER_ENABLED) {
    return {
      ...snapshot,
      ready: null,
      status: 'disabled',
      reason: 'watcher-disabled',
      watch: {
        logPath: LOG_PATH || null,
        fileExists: false,
        lastFileError: null,
        lastStatAt: null,
        lastReadAt: null,
        lastEventAt: null,
        lastRotationAt: null,
        lastKnownFileSize: 0,
        lastKnownFileMtime: null,
        lastReadOffset: 0,
        backlogBytes: 0,
        backlogSinceAt: null,
        backlogAgeMs: 0,
        backlogStaleAfterMs: WATCHER_BACKLOG_STALE_MS,
      },
    };
  }
  if (!LOG_PATH) {
    return {
      ...snapshot,
      ready: false,
      status: 'not-configured',
      reason: 'log-path-missing',
      watch: {
        logPath: null,
        fileExists: false,
        lastFileError: 'SCUM_LOG_PATH is required when watcher is enabled',
        lastStatAt: null,
        lastReadAt: null,
        lastEventAt: null,
        lastRotationAt: null,
        lastKnownFileSize: 0,
        lastKnownFileMtime: null,
        lastReadOffset: 0,
        backlogBytes: 0,
        backlogSinceAt: null,
        backlogAgeMs: 0,
        backlogStaleAfterMs: WATCHER_BACKLOG_STALE_MS,
      },
    };
  }
  const ready =
    lastFileExists
    && !lastFileError
    && !(backlogBytes > 0 && backlogAgeMs >= WATCHER_BACKLOG_STALE_MS);
  return {
    ...snapshot,
    ready,
    status: ready ? 'ready' : 'degraded',
    watch: {
      logPath: LOG_PATH || null,
      fileExists: lastFileExists,
      lastFileError,
      lastStatAt: asIso(lastFileStatAt),
      lastReadAt: asIso(lastFileReadAt),
      lastEventAt: asIso(lastEventAt),
      lastRotationAt: asIso(lastRotationAt),
      lastKnownFileSize,
      lastKnownFileMtime: asIso(lastKnownFileMtimeMs),
      lastReadOffset,
      backlogBytes,
      backlogSinceAt: asIso(lastBacklogAt),
      backlogAgeMs,
      backlogStaleAfterMs: WATCHER_BACKLOG_STALE_MS,
    },
  };
}

function createHealthServer() {
  return startRuntimeHealthServer({
    name: 'watcher',
    host: WATCHER_HEALTH_HOST,
    port: WATCHER_HEALTH_PORT,
    getPayload: () => getWatcherHealthPayload(),
  });
}

function registerShutdown(healthServer, stopWatcher = null) {
  const shutdown = () => {
    console.log('stopping SCUM log watcher...');
    if (typeof stopWatcher === 'function') {
      stopWatcher();
    }
    if (watcherFileStatTimer) {
      clearInterval(watcherFileStatTimer);
      watcherFileStatTimer = null;
    }
    if (healthServer) {
      healthServer.close();
    }
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return shutdown;
}

function getWatcherMetricsSnapshot(now = Date.now()) {
  compactWebhookAttempts(now);
  const attempts = webhookAttemptWindow.length;
  const failures = webhookAttemptWindow.reduce(
    (sum, entry) => sum + (entry.ok ? 0 : 1),
    0,
  );
  const successes = attempts - failures;
  const webhookErrorRate = attempts > 0 ? failures / attempts : 0;
  return {
    generatedAt: new Date(now).toISOString(),
    queueLength: eventQueue.length,
    queueMax: EVENT_QUEUE_MAX,
    queueAlertThreshold: WATCHER_QUEUE_ALERT_THRESHOLD,
    webhook: {
      windowMs: WEBHOOK_ERROR_ALERT_WINDOW_MS,
      attempts,
      successes,
      failures,
      errorRate: webhookErrorRate,
      threshold: WEBHOOK_ERROR_ALERT_THRESHOLD,
      minAttempts: WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS,
      totalSuccesses: webhookSuccessCount,
      totalFailures: webhookFailCount,
    },
  };
}

function maybeAlertWebhookErrorRate(snapshot) {
  if (!snapshot?.webhook) return;
  const { webhook } = snapshot;
  if (webhook.attempts < WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS) return;
  if (webhook.errorRate < WEBHOOK_ERROR_ALERT_THRESHOLD) return;

  const now = Date.now();
  if (now - lastWebhookErrorAlertAt < WATCHER_ALERT_COOLDOWN_MS) return;
  lastWebhookErrorAlertAt = now;
  console.warn(
    `[watcher][alert] webhook error rate spike: rate=${webhook.errorRate.toFixed(3)} failures=${webhook.failures}/${webhook.attempts}`,
  );
}

function maybeAlertQueuePressure() {
  if (eventQueue.length < WATCHER_QUEUE_ALERT_THRESHOLD) return;
  const now = Date.now();
  if (now - lastQueuePressureAlertAt < WATCHER_ALERT_COOLDOWN_MS) return;
  lastQueuePressureAlertAt = now;
  console.warn(
    `[watcher][alert] queue pressure: length=${eventQueue.length} threshold=${WATCHER_QUEUE_ALERT_THRESHOLD} max=${EVENT_QUEUE_MAX}`,
  );
}

function recordWebhookAttempt(ok) {
  const now = Date.now();
  webhookAttemptWindow.push({ at: now, ok: ok === true });
  compactWebhookAttempts(now);
  if (ok) {
    webhookSuccessCount += 1;
  } else {
    webhookFailCount += 1;
  }
  const snapshot = getWatcherMetricsSnapshot(now);
  maybeAlertWebhookErrorRate(snapshot);
}

function hashText(value) {
  const input = String(value || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function appendDeadLetter(reason, event, error) {
  if (!DEAD_LETTER_LOG_PATH) return;

  const entry = {
    timestamp: new Date().toISOString(),
    reason,
    event,
    error: error ? String(error.message || error) : null,
  };

  try {
    fs.mkdirSync(path.dirname(DEAD_LETTER_LOG_PATH), { recursive: true });
    fs.appendFileSync(DEAD_LETTER_LOG_PATH, `${JSON.stringify(entry)}\n`, {
      encoding: 'utf8',
    });
  } catch (writeError) {
    console.error('[watcher] failed to write dead-letter:', writeError.message);
  }
}

function cleanName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDistance(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function parseHitZone(sourceText) {
  const text = String(sourceText || '').toLowerCase();
  if (!text) return null;
  if (
    /headshot/.test(text)
    || /\bhead shot\b/.test(text)
    || /\bin the head\b/.test(text)
    || /\bto the head\b/.test(text)
    || /\bhit\b[^.]*\bhead\b/.test(text)
  ) {
    return 'head';
  }
  if (
    /\bbody shot\b/.test(text)
    || /\bin the body\b/.test(text)
    || /\bto the torso\b/.test(text)
    || /\btorso\b/.test(text)
    || /\bchest\b/.test(text)
    || /\bstomach\b/.test(text)
    || /\babdomen\b/.test(text)
    || /\barm\b/.test(text)
    || /\bleg\b/.test(text)
  ) {
    return 'body';
  }
  return null;
}

function parseSector(sourceText) {
  const text = String(sourceText || '');
  if (!text) return null;

  const patterns = [
    /\bsector\s*[:=]?\s*(?<sector>[A-Z]{1,2}\d{1,2})\b/i,
    /\bgrid\s*[:=]?\s*(?<sector>[A-Z]{1,2}\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    const value = String(matched?.groups?.sector || '')
      .replace(/\s+/g, '')
      .trim()
      .toUpperCase();
    if (/^[A-Z]{1,2}\d{1,2}$/.test(value)) {
      return value;
    }
  }
  return null;
}

function parseMapImageUrl(sourceText) {
  const text = String(sourceText || '');
  if (!text) return null;
  const matched = text.match(
    /(https?:\/\/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>]*)?)/i,
  );
  return matched ? String(matched[1]) : null;
}

function toKillEvent(groups, weapon, distance, sourceText) {
  return {
    type: 'kill',
    killer: cleanName(groups.killerName),
    killerSteamId: String(groups.killerSteamId || ''),
    victim: cleanName(groups.victimName),
    victimSteamId: String(groups.victimSteamId || ''),
    weapon: weapon ? cleanName(weapon) : null,
    distance: parseDistance(distance),
    hitZone: parseHitZone(sourceText),
    sector: parseSector(sourceText),
    mapImageUrl: parseMapImageUrl(sourceText),
  };
}

function parseLine(line) {
  const text = String(line || '').replace(/\u0000/g, '').trim();
  if (!text) return null;

  let match = text.match(/LogSCUM:\s+User\s+'(?<playerName>.+?)'\s+logged in/i);
  if (match?.groups?.playerName) {
    return {
      type: 'join',
      playerName: cleanName(match.groups.playerName),
    };
  }

  match = text.match(
    /LogSCUM:\s+Warning:\s+Prisoner logging out:\s+(?<playerName>.+?)(?:\s+\((?<steamId>\d{15,25})\))?$/i,
  );
  if (match?.groups?.playerName) {
    return {
      type: 'leave',
      playerName: cleanName(match.groups.playerName),
      steamId: match.groups.steamId || null,
    };
  }

  const killWithWeapon = text.match(
    /LogSCUM:\s+'(?<victimSteamId>\d+):(?<victimName>.+?)\(\d+\)'\s+was killed by\s+'(?<killerSteamId>\d+):(?<killerName>.+?)\(\d+\)'\s+with\s+'(?<weapon>[^']+)'(?:\s+from\s+(?<distance>\d+(?:\.\d+)?)\s*m?)?/i,
  );
  if (killWithWeapon?.groups) {
    return toKillEvent(
      killWithWeapon.groups,
      killWithWeapon.groups.weapon,
      killWithWeapon.groups.distance,
      text,
    );
  }

  const killWithUsing = text.match(
    /LogSCUM:\s+'(?<victimSteamId>\d+):(?<victimName>.+?)\(\d+\)'\s+was killed by\s+'(?<killerSteamId>\d+):(?<killerName>.+?)\(\d+\)'\s+using\s+'(?<weapon>[^']+)'(?:\s+from\s+(?<distance>\d+(?:\.\d+)?)\s*m?)?/i,
  );
  if (killWithUsing?.groups) {
    return toKillEvent(
      killWithUsing.groups,
      killWithUsing.groups.weapon,
      killWithUsing.groups.distance,
      text,
    );
  }

  const killNoWeapon = text.match(
    /LogSCUM:\s+'(?<victimSteamId>\d+):(?<victimName>.+?)\(\d+\)'\s+was killed by\s+'(?<killerSteamId>\d+):(?<killerName>.+?)\(\d+\)'/i,
  );
  if (killNoWeapon?.groups) {
    return toKillEvent(killNoWeapon.groups, null, null, text);
  }

  if (RESTART_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      type: 'restart',
      message: 'Server is shutting down (or restarting)',
    };
  }

  return null;
}

function eventKey(event, sourceLine) {
  if (!event || !event.type) return null;
  const rawText = cleanName(sourceLine || '');
  if (rawText) return `raw:${event.type}:${hashText(rawText)}`;

  if (event.type === 'join') return `join:${event.playerName}`;
  if (event.type === 'leave')
    return `leave:${event.steamId || event.playerName}`;
  if (event.type === 'restart') return `restart:${event.message || ''}`;
  if (event.type === 'kill') {
    return `kill:${event.killerSteamId}:${event.victimSteamId}:${event.weapon || ''}:${event.distance ?? ''}:${event.hitZone || ''}:${event.sector || ''}`;
  }
  return null;
}

function isDuplicateEvent(event, sourceLine) {
  const key = eventKey(event, sourceLine);
  if (!key) return false;

  const now = Date.now();
  const previous = eventDedupe.get(key);
  eventDedupe.set(key, now);

  if (eventDedupe.size > MAX_DEDUPE_TRACK_SIZE) {
    for (const [k, ts] of eventDedupe.entries()) {
      if (now - ts > EVENT_DEDUP_WINDOW_MS * 8) {
        eventDedupe.delete(k);
      }
    }
  }

  return previous != null && now - previous <= EVENT_DEDUP_WINDOW_MS;
}

async function postWebhook(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Webhook error ${res.status}: ${text}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function sendEvent(payload) {
  const body = { secret: SECRET, guildId: GUILD_ID, ...payload };
  let attempt = 0;

  while (attempt <= WEBHOOK_MAX_RETRIES) {
    try {
      await postWebhook(body);
      recordWebhookAttempt(true);
      return true;
    } catch (error) {
      recordWebhookAttempt(false);
      const isLast = attempt >= WEBHOOK_MAX_RETRIES;
      if (isLast) {
        console.error(
          `ส่ง event ไม่สำเร็จ (attempt=${attempt + 1}):`,
          error.message,
        );
        return false;
      }
      const waitMs = WEBHOOK_RETRY_DELAY_MS * (attempt + 1);
      console.warn(
        `ส่ง event พลาด (attempt=${attempt + 1}) รอ ${waitMs}ms แล้วลองใหม่:`,
        error.message,
      );
      await sleep(waitMs);
    }
    attempt += 1;
  }

  return false;
}

function enqueueEvent(event) {
  if (isDuplicateEvent(event)) return false;

  if (eventQueue.length >= EVENT_QUEUE_MAX) {
    console.error(
      `[watcher] queue full (${EVENT_QUEUE_MAX}), dropping incoming event`,
    );
    appendDeadLetter('queue_overflow', event);
    return false;
  }

  eventQueue.push(event);
  maybeAlertQueuePressure();
  if (!queueRunning) {
    void drainQueue();
  }
  return true;
}

async function drainQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (eventQueue.length > 0) {
      const event = eventQueue.shift();
      if (!event) continue;

      const ok = await sendEvent(event);
      if (!ok) {
        appendDeadLetter('webhook_delivery_failed', event);
      }
    }
  } finally {
    queueRunning = false;
    if (eventQueue.length > 0) {
      void drainQueue();
    }
  }
}

function flushPartialLine(bufferState, onLine) {
  const pending = String(bufferState.partial || '')
    .replace(/\u0000/g, '')
    .trim();
  bufferState.partial = '';
  if (pending) onLine(pending);
}

function consumeTextChunk(chunk, bufferState, onLine) {
  bufferState.partial += chunk;
  const lines = bufferState.partial.split(/\r?\n/);
  bufferState.partial = lines.pop() || '';
  for (const line of lines) {
    onLine(line);
  }
}

async function readRange(filePath, start, end, onLine, bufferState) {
  if (end <= start) return;
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      start,
      end: end - 1,
      encoding: 'utf8',
    });
    stream.on('error', reject);
    stream.on('data', (chunk) => consumeTextChunk(chunk, bufferState, onLine));
    stream.on('end', resolve);
  });
}

function tailFile(filePath, onLine) {
  const bufferState = { partial: '' };
  let offset = 0;
  try {
    const stat = fs.statSync(filePath);
    offset = stat.size;
    lastReadOffset = offset;
    lastFileReadAt = Date.now();
    updateFileStateFromStat(stat);
  } catch (error) {
    markFileError(error);
    console.error('log file not found at path:', filePath);
  }

  console.log('watching log file:', filePath);
  console.log('start tailing from file end (old lines are skipped)');
  console.log(`watch interval: ${WATCH_INTERVAL_MS}ms`);

  let reading = false;
  let pending = false;

  const readNewBytes = async () => {
    if (reading) {
      pending = true;
      return;
    }
    reading = true;
    try {
      do {
        pending = false;
        let stat;
        try {
          const filePreviouslyAvailable = lastFileExists;
          stat = fs.statSync(filePath);
          updateFileStateFromStat(stat);
          if (!filePreviouslyAvailable) {
            offset = stat.size;
            lastReadOffset = offset;
            lastFileReadAt = Date.now();
            console.log('log file became available, start tailing from file end:', filePath);
            return;
          }
        } catch (error) {
          markFileError(error);
          console.warn('failed to stat log file, waiting for next round:', error.message);
          return;
        }

        if (stat.size < offset) {
          flushPartialLine(bufferState, onLine);
          console.log('log rotated/reset, restart from beginning');
          offset = 0;
          lastReadOffset = 0;
          lastRotationAt = Date.now();
        }

        if (stat.size > offset) {
          const start = offset;
          const end = stat.size;
          await readRange(filePath, start, end, onLine, bufferState);
          offset = end;
          lastReadOffset = end;
          lastFileReadAt = Date.now();
          if (lastKnownFileSize <= end) {
            lastBacklogAt = 0;
          }
        }
      } while (pending);
    } finally {
      reading = false;
    }
  };

  const watcherCallback = (curr, prev) => {
    if (Number(curr.nlink || 0) === 0) return;
    if (curr.size === prev.size && curr.mtimeMs === prev.mtimeMs) return;

    if (curr.ino && prev.ino && curr.ino !== prev.ino) {
      flushPartialLine(bufferState, onLine);
      console.log('detected log inode change: reset offset -> 0');
      offset = 0;
    }

    void readNewBytes();
  };

  fs.watchFile(filePath, { interval: WATCH_INTERVAL_MS }, watcherCallback);

  const stop = () => {
    fs.unwatchFile(filePath, watcherCallback);
    flushPartialLine(bufferState, onLine);
  };
  stop.sync = readNewBytes;
  return stop;
}

function startWatcher() {
  const healthServer = createHealthServer();
  if (!WATCHER_ENABLED) {
    console.log('SCUM log watcher is disabled');
    registerShutdown(healthServer);
    return { healthServer, mode: 'disabled' };
  }
  if (!LOG_PATH) {
    console.warn('SCUM log watcher is enabled but SCUM_LOG_PATH is missing');
    registerShutdown(healthServer);
    return { healthServer, mode: 'not-configured' };
  }
  assertWatcherEnv();

  const pollLogFileState = () => {
    try {
      const filePreviouslyAvailable = lastFileExists;
      const stat = fs.statSync(LOG_PATH);
      updateFileStateFromStat(stat);
      if (!filePreviouslyAvailable && typeof stop.sync === 'function') {
        void stop.sync();
      }
    } catch (error) {
      markFileError(error);
    }
  };
  const stop = tailFile(LOG_PATH, (line) => {
    const event = parseLine(line);
    if (!event) return;
    lastEventAt = Date.now();
    console.log('event:', event);
    enqueueEvent(event);
  });
  pollLogFileState();
  watcherFileStatTimer = setInterval(pollLogFileState, WATCHER_FILE_STAT_INTERVAL_MS);
  if (typeof watcherFileStatTimer.unref === 'function') {
    watcherFileStatTimer.unref();
  }

  registerShutdown(healthServer, stop);
  return { healthServer, mode: 'watching', stop };
}

if (require.main === module) {
  startWatcher();
}

module.exports = {
  parseLine,
  tailFile,
  sendEvent,
  enqueueEvent,
  getWatcherMetricsSnapshot,
  getWatcherHealthPayload,
  resolveLogPath,
  resolveWatcherEnabled,
  startWatcher,
};
