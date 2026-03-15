const { publishAdminLiveUpdate } = require('./adminLiveBus');

const SUPERVISOR_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.RUNTIME_SUPERVISOR_TIMEOUT_MS || 4000),
);
const SUPERVISOR_CACHE_TTL_MS = Math.max(
  1000,
  Number(process.env.RUNTIME_SUPERVISOR_CACHE_TTL_MS || 5000),
);
const SUPERVISOR_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.RUNTIME_SUPERVISOR_INTERVAL_MS || 30000),
);
const SUPERVISOR_ALERT_COOLDOWN_MS = Math.max(
  10000,
  Number(process.env.RUNTIME_SUPERVISOR_ALERT_COOLDOWN_MS || 120000),
);
const WATCHER_BACKLOG_STALE_MS = Math.max(
  5000,
  Number(process.env.SCUM_WATCHER_BACKLOG_STALE_MS || 60000),
);

let cachedSnapshot = null;
let cachedSnapshotAt = 0;
let refreshPromise = null;
let monitorTimer = null;
const lastAlertAtByKey = new Map();
const lastStatusByRuntime = new Map();

function envFlag(value, fallback = false) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeLoopbackHost(host) {
  const value = String(host || '').trim() || '127.0.0.1';
  if (value === '0.0.0.0' || value === '::') return '127.0.0.1';
  return value;
}

function asPort(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const port = Math.trunc(parsed);
  if (port <= 0 || port > 65535) return 0;
  return port;
}

function buildHttpBaseUrl(host, port) {
  const normalizedPort = asPort(port);
  if (normalizedPort <= 0) return null;
  return `http://${normalizeLoopbackHost(host)}:${normalizedPort}`;
}

function buildUrlFromFullBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function unwrapHealthPayload(payload) {
  if (
    payload
    && typeof payload === 'object'
    && payload.data
    && typeof payload.data === 'object'
    && !Array.isArray(payload.data)
  ) {
    return payload.data;
  }
  return payload && typeof payload === 'object' ? payload : {};
}

// Runtime targets are derived from env rather than hard-coded roles so the same code
// can supervise local, split-runtime, and production topologies.
function buildRuntimeTargets() {
  const targets = [];
  const deliveryExecutionMode = String(process.env.DELIVERY_EXECUTION_MODE || '')
    .trim()
    .toLowerCase();
  const botEnabled =
    envFlag(process.env.BOT_ENABLE_ADMIN_WEB, true)
    || envFlag(process.env.BOT_ENABLE_SCUM_WEBHOOK, true)
    || envFlag(process.env.BOT_ENABLE_RESTART_SCHEDULER, true)
    || envFlag(process.env.BOT_ENABLE_RENTBIKE_SERVICE, false)
    || envFlag(process.env.BOT_ENABLE_DELIVERY_WORKER, false);
  const workerEnabled =
    envFlag(process.env.WORKER_ENABLE_RENTBIKE, false)
    || envFlag(process.env.WORKER_ENABLE_DELIVERY, false);
  const watcherConfigured =
    String(process.env.SCUM_LOG_PATH || '').trim().length > 0;
  const watcherEnabledRaw = String(process.env.SCUM_WATCHER_ENABLED || '').trim();
  const watcherEnabled =
    watcherEnabledRaw
      ? envFlag(watcherEnabledRaw, false)
      : watcherConfigured;
  const watcherRequired = envFlag(
    process.env.SCUM_WATCHER_REQUIRED,
    watcherConfigured,
  );
  const adminEnabled =
    envFlag(process.env.BOT_ENABLE_ADMIN_WEB, true)
    || asPort(process.env.ADMIN_WEB_PORT) > 0;
  const playerEnabled =
    asPort(process.env.WEB_PORTAL_PORT) > 0
    || String(process.env.WEB_PORTAL_BASE_URL || '').trim().length > 0;
  const agentModeRequired = deliveryExecutionMode === 'agent';
  const agentEnabled =
    agentModeRequired
    || asPort(process.env.SCUM_CONSOLE_AGENT_PORT) > 0
    || String(process.env.SCUM_CONSOLE_AGENT_BASE_URL || '').trim().length > 0
    || envFlag(process.env.SCUM_CONSOLE_AGENT_ENABLED, false);
  const agentRequired = envFlag(
    process.env.SCUM_CONSOLE_AGENT_REQUIRED,
    agentModeRequired,
  );

  targets.push({
    key: 'bot',
    label: 'Discord Bot',
    enabled: botEnabled,
    required: botEnabled,
    url: buildHttpBaseUrl(process.env.BOT_HEALTH_HOST, process.env.BOT_HEALTH_PORT),
  });
  targets.push({
    key: 'worker',
    label: 'Worker',
    enabled: workerEnabled,
    required: workerEnabled,
    url: buildHttpBaseUrl(process.env.WORKER_HEALTH_HOST, process.env.WORKER_HEALTH_PORT),
  });
  targets.push({
    key: 'watcher',
    label: 'SCUM Watcher',
    enabled: watcherEnabled,
    required: watcherEnabled && watcherRequired,
    url: buildHttpBaseUrl(
      process.env.SCUM_WATCHER_HEALTH_HOST,
      process.env.SCUM_WATCHER_HEALTH_PORT,
    ),
  });
  targets.push({
    key: 'admin-web',
    label: 'Admin Web',
    enabled: adminEnabled,
    required: adminEnabled,
    url: buildHttpBaseUrl(process.env.ADMIN_WEB_HOST, process.env.ADMIN_WEB_PORT),
  });
  targets.push({
    key: 'player-portal',
    label: 'Player Portal',
    enabled: playerEnabled,
    required: playerEnabled,
    url:
      buildHttpBaseUrl(process.env.WEB_PORTAL_HOST, process.env.WEB_PORTAL_PORT)
      || buildUrlFromFullBaseUrl(process.env.WEB_PORTAL_BASE_URL),
  });
  targets.push({
    key: 'console-agent',
    label: 'Console Agent',
    enabled: agentEnabled,
    required: agentEnabled && agentRequired,
    url:
      buildUrlFromFullBaseUrl(process.env.SCUM_CONSOLE_AGENT_BASE_URL)
      || buildHttpBaseUrl(
        process.env.SCUM_CONSOLE_AGENT_HOST,
        process.env.SCUM_CONSOLE_AGENT_PORT,
      ),
  });

  return targets;
}

async function fetchJsonWithTimeout(url, timeoutMs = SUPERVISOR_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
    });
    const json = await res.json().catch(() => null);
    return { ok: res.status === 200, status: res.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeReason(data = {}) {
  if (typeof data.reason === 'string' && data.reason.trim()) return data.reason.trim();
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  if (typeof data.statusCode === 'string' && data.statusCode.trim()) return data.statusCode.trim();
  if (typeof data.status === 'string' && data.status.trim()) return data.status.trim();
  return null;
}

function normalizeWatcherState(data = {}) {
  const watch = data.watch && typeof data.watch === 'object' ? data.watch : {};
  const backlogBytes = Math.max(0, Number(watch.backlogBytes || 0));
  const backlogAgeMs = Math.max(0, Number(watch.backlogAgeMs || 0));
  const fileExists = watch.fileExists !== false;
  const lastFileError = String(watch.lastFileError || '').trim() || null;
  let ready = data.ready !== false;
  let reason = null;

  if (!fileExists) {
    ready = false;
    reason = 'log-file-missing';
  } else if (lastFileError) {
    ready = false;
    reason = 'log-file-error';
  } else if (backlogBytes > 0 && backlogAgeMs >= WATCHER_BACKLOG_STALE_MS) {
    ready = false;
    reason = 'log-backlog';
  }

  if (!reason && !ready) {
    reason = summarizeReason(data);
  }

  return { ready, reason };
}

// Normalize heterogeneous /health responses into one operator-facing status model.
function classifyRuntimeHealth(target, healthPayload, latencyMs) {
  const data = unwrapHealthPayload(healthPayload);
  let reachable = true;
  let ready = true;
  let reason = summarizeReason(data);

  if (target.key === 'bot') {
    ready = data.discordReady !== false;
    if (!ready) {
      reason = reason || 'discord-not-ready';
    }
  } else if (target.key === 'watcher') {
    const watcher = normalizeWatcherState(data);
    ready = watcher.ready;
    reason = watcher.reason;
  } else if (typeof data.ready === 'boolean') {
    ready = data.ready;
  } else if (String(data.status || '').trim().toLowerCase() === 'degraded') {
    ready = false;
  }

  const status = ready ? 'ready' : 'degraded';
  return {
    key: target.key,
    label: target.label,
    enabled: target.enabled,
    required: target.required,
    url: target.url,
    reachable,
    ready,
    status,
    httpStatus: 200,
    latencyMs,
    reason,
    data,
  };
}

async function probeRuntimeTarget(target) {
  if (!target.enabled) {
    return {
      key: target.key,
      label: target.label,
      enabled: false,
      required: false,
      url: target.url,
      reachable: false,
      ready: null,
      status: 'disabled',
      httpStatus: null,
      latencyMs: null,
      reason: 'disabled',
      data: null,
    };
  }

  if (!target.url) {
    return {
      key: target.key,
      label: target.label,
      enabled: true,
      required: target.required,
      url: null,
      reachable: false,
      ready: false,
      status: 'not-configured',
      httpStatus: null,
      latencyMs: null,
      reason: 'health-url-missing',
      data: null,
    };
  }

  const startedAt = Date.now();
  try {
    const result = await fetchJsonWithTimeout(`${trimTrailingSlash(target.url)}/healthz`);
    const latencyMs = Date.now() - startedAt;
    if (!result.ok || !result.json) {
      return {
        key: target.key,
        label: target.label,
        enabled: true,
        required: target.required,
        url: target.url,
        reachable: false,
        ready: false,
        status: 'offline',
        httpStatus: Number(result.status || 0) || null,
        latencyMs,
        reason: result.json?.error || `http-${result.status || 0}`,
        data: result.json || null,
      };
    }
    return classifyRuntimeHealth(target, result.json, latencyMs);
  } catch (error) {
    return {
      key: target.key,
      label: target.label,
      enabled: true,
      required: target.required,
      url: target.url,
      reachable: false,
      ready: false,
      status: 'offline',
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      reason: String(error?.name === 'AbortError' ? 'timeout' : error?.message || error),
      data: null,
    };
  }
}

function buildOverallStatus(items = []) {
  const enabled = items.filter((item) => item.enabled);
  const required = enabled.filter((item) => item.required);
  const offline = required.filter(
    (item) => item.status === 'offline' || item.status === 'not-configured',
  );
  const degraded = required.filter((item) => item.status === 'degraded');
  const ready = required.filter((item) => item.status === 'ready');
  const disabled = items.filter((item) => item.status === 'disabled');

  let overall = 'ready';
  if (offline.length > 0) {
    overall = 'offline';
  } else if (degraded.length > 0) {
    overall = 'degraded';
  }

  return {
    overall,
    counts: {
      total: items.length,
      enabled: enabled.length,
      required: required.length,
      ready: ready.length,
      degraded: degraded.length,
      offline: offline.length,
      disabled: disabled.length,
    },
  };
}

function canEmitAlert(alertKey, now = Date.now()) {
  const previous = lastAlertAtByKey.get(alertKey) || 0;
  if (now - previous < SUPERVISOR_ALERT_COOLDOWN_MS) return false;
  lastAlertAtByKey.set(alertKey, now);
  return true;
}

function maybePublishSupervisorAlerts(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.items)) return;
  const now = Date.now();

  for (const item of snapshot.items) {
    if (!item.required || !item.enabled) continue;
    const current = `${item.status}:${item.reason || ''}`;
    const previous = lastStatusByRuntime.get(item.key) || null;
    lastStatusByRuntime.set(item.key, current);

    if (item.status === 'ready') continue;
    if (previous === current) continue;

    const kind =
      item.status === 'offline' || item.status === 'not-configured'
        ? 'runtime-offline'
        : 'runtime-degraded';
    const alertKey = `${kind}:${item.key}:${item.reason || ''}`;
    if (!canEmitAlert(alertKey, now)) continue;

    publishAdminLiveUpdate('ops-alert', {
      source: 'runtime-supervisor',
      kind,
      runtimeKey: item.key,
      runtimeLabel: item.label,
      runtimeStatus: item.status,
      reason: item.reason || null,
      latencyMs: item.latencyMs,
      url: item.url || null,
    });
  }
}

async function collectRuntimeSupervisorSnapshot() {
  const targets = buildRuntimeTargets();
  const items = await Promise.all(targets.map((target) => probeRuntimeTarget(target)));
  const summary = buildOverallStatus(items);
  const snapshot = {
    generatedAt: new Date().toISOString(),
    overall: summary.overall,
    counts: summary.counts,
    items,
  };
  maybePublishSupervisorAlerts(snapshot);
  return snapshot;
}

async function getRuntimeSupervisorSnapshot(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();
  if (
    !forceRefresh
    && cachedSnapshot
    && now - cachedSnapshotAt <= SUPERVISOR_CACHE_TTL_MS
  ) {
    return cachedSnapshot;
  }
  if (!forceRefresh && refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = collectRuntimeSupervisorSnapshot()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      cachedSnapshotAt = Date.now();
      return snapshot;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

function getCachedRuntimeSupervisorSnapshot() {
  return cachedSnapshot;
}

// Monitoring stays passive on purpose: it emits health snapshots/alerts without trying
// to restart processes itself, leaving orchestration to PM2 or the deploy platform.
function startRuntimeSupervisorMonitor() {
  if (monitorTimer) return monitorTimer;
  void getRuntimeSupervisorSnapshot({ forceRefresh: true }).catch(() => null);
  monitorTimer = setInterval(() => {
    void getRuntimeSupervisorSnapshot({ forceRefresh: true }).catch(() => null);
  }, SUPERVISOR_INTERVAL_MS);
  if (typeof monitorTimer.unref === 'function') {
    monitorTimer.unref();
  }
  return monitorTimer;
}

function stopRuntimeSupervisorMonitor() {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
}

module.exports = {
  buildRuntimeTargets,
  collectRuntimeSupervisorSnapshot,
  getCachedRuntimeSupervisorSnapshot,
  getRuntimeSupervisorSnapshot,
  startRuntimeSupervisorMonitor,
  stopRuntimeSupervisorMonitor,
};
