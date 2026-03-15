const DEFAULT_OBSERVABILITY_SERIES_KEYS = Object.freeze([
  'deliveryQueueLength',
  'deliveryFailRate',
  'deliveryDeadLetters',
  'agentCircuitOpen',
  'loginFailures',
  'webhookErrorRate',
  'adminRequestErrors',
  'adminRequest5xx',
  'runtimeDegraded',
]);

function asInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function parseCsvSet(value) {
  const out = new Set();
  for (const item of String(value || '').split(',')) {
    const raw = item.trim();
    if (raw) out.add(raw);
  }
  return out;
}

function stringifyValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyValue(entry)).join(', ');
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function toCsvValue(value) {
  return `"${stringifyValue(value).replace(/"/g, '""')}"`;
}

function createObservabilitySeriesState(keys = DEFAULT_OBSERVABILITY_SERIES_KEYS) {
  return Object.fromEntries(
    (Array.isArray(keys) ? keys : DEFAULT_OBSERVABILITY_SERIES_KEYS).map((key) => [key, []]),
  );
}

function clampObservabilityWindowMs(value, retentionMs) {
  const parsed = asInt(value, null);
  if (parsed == null) return null;
  return Math.max(60 * 1000, Math.min(parsed, retentionMs));
}

function parseObservabilitySeriesKeys(value, allowedKeys = DEFAULT_OBSERVABILITY_SERIES_KEYS) {
  const requested = parseCsvSet(value);
  if (requested.size === 0) return [];
  return allowedKeys.filter((key) => requested.has(key));
}

function compactSeries(series, retentionMs, now = Date.now()) {
  const cutoff = now - retentionMs;
  while (series.length > 0 && series[0].at < cutoff) {
    series.shift();
  }
}

function recordObservabilityPoint(seriesState, key, value, retentionMs, now = Date.now()) {
  const series = seriesState[key];
  if (!Array.isArray(series)) return;
  series.push({
    at: now,
    value: Number.isFinite(Number(value)) ? Number(value) : 0,
  });
  compactSeries(series, retentionMs, now);
}

function captureObservabilitySeries(options = {}) {
  const {
    seriesState,
    retentionMs,
    now = Date.now(),
    getDeliveryMetricsSnapshot,
    getLoginFailureMetrics,
    getWebhookMetricsSnapshot,
    getAdminRequestLogMetrics,
    getDeliveryRuntimeStatus,
    getRuntimeSupervisorSnapshot,
  } = options;
  if (!seriesState || typeof seriesState !== 'object') return;

  const delivery = typeof getDeliveryMetricsSnapshot === 'function'
    ? getDeliveryMetricsSnapshot(now)
    : { queueLength: 0, failRate: 0 };
  const login = typeof getLoginFailureMetrics === 'function'
    ? getLoginFailureMetrics(now)
    : { failures: 0 };
  const webhook = typeof getWebhookMetricsSnapshot === 'function'
    ? getWebhookMetricsSnapshot(now)
    : { errorRate: 0 };
  const requestLog = typeof getAdminRequestLogMetrics === 'function'
    ? getAdminRequestLogMetrics({ now })
    : { errors: 0, serverErrors: 0 };
  const deliveryRuntime = typeof getDeliveryRuntimeStatus === 'function'
    ? getDeliveryRuntimeStatus()
    : { deadLetterCount: 0, agentCircuit: { open: false } };
  const runtimeSupervisor = typeof getRuntimeSupervisorSnapshot === 'function'
    ? getRuntimeSupervisorSnapshot()
    : { counts: { degraded: 0, offline: 0 } };

  recordObservabilityPoint(seriesState, 'deliveryQueueLength', Number(delivery.queueLength || 0), retentionMs, now);
  recordObservabilityPoint(seriesState, 'deliveryFailRate', Number(delivery.failRate || 0), retentionMs, now);
  if (Object.prototype.hasOwnProperty.call(seriesState, 'deliveryDeadLetters')) {
    recordObservabilityPoint(seriesState, 'deliveryDeadLetters', Number(deliveryRuntime.deadLetterCount || 0), retentionMs, now);
  }
  if (Object.prototype.hasOwnProperty.call(seriesState, 'agentCircuitOpen')) {
    recordObservabilityPoint(seriesState, 'agentCircuitOpen', deliveryRuntime?.agentCircuit?.open ? 1 : 0, retentionMs, now);
  }
  recordObservabilityPoint(seriesState, 'loginFailures', Number(login.failures || 0), retentionMs, now);
  recordObservabilityPoint(seriesState, 'webhookErrorRate', Number(webhook.errorRate || 0), retentionMs, now);
  if (Object.prototype.hasOwnProperty.call(seriesState, 'adminRequestErrors')) {
    recordObservabilityPoint(seriesState, 'adminRequestErrors', Number(requestLog.errors || 0), retentionMs, now);
  }
  if (Object.prototype.hasOwnProperty.call(seriesState, 'adminRequest5xx')) {
    recordObservabilityPoint(seriesState, 'adminRequest5xx', Number(requestLog.serverErrors || 0), retentionMs, now);
  }
  if (Object.prototype.hasOwnProperty.call(seriesState, 'runtimeDegraded')) {
    const degradedCount = Number(runtimeSupervisor?.counts?.degraded || 0) + Number(runtimeSupervisor?.counts?.offline || 0);
    recordObservabilityPoint(seriesState, 'runtimeDegraded', degradedCount, retentionMs, now);
  }
}

function listObservabilitySeries(options = {}) {
  const {
    seriesState,
    retentionMs,
    keys,
    windowMs,
    now = Date.now(),
  } = options;
  const allowedKeys = Object.keys(seriesState || {});
  const seriesKeys = Array.isArray(keys) && keys.length > 0
    ? keys
    : allowedKeys;
  const effectiveWindowMs = clampObservabilityWindowMs(windowMs, retentionMs);
  const cutoff = effectiveWindowMs == null ? null : now - effectiveWindowMs;
  const out = {};
  for (const key of seriesKeys) {
    if (!allowedKeys.includes(key)) continue;
    const series = Array.isArray(seriesState[key]) ? seriesState[key] : [];
    const filtered = cutoff == null
      ? series
      : series.filter((point) => Number(point?.at || 0) >= cutoff);
    out[key] = filtered.map((point) => ({
      at: new Date(point.at).toISOString(),
      value: Number(point.value || 0),
    }));
  }
  return out;
}

function buildAdminObservabilitySnapshot(options = {}) {
  const {
    windowMs,
    seriesKeys,
    retentionMs,
    captureSeries,
    getDeliveryMetricsSnapshot,
    getLoginFailureMetrics,
    getWebhookMetricsSnapshot,
    getAdminRequestLogMetrics,
    listAdminRequestLogs,
    listDeliveryQueue,
    listSeries,
  } = options;

  if (typeof captureSeries === 'function') {
    captureSeries();
  }

  const effectiveWindowMs = clampObservabilityWindowMs(windowMs, retentionMs);
  const requestedKeys = Array.isArray(seriesKeys) ? seriesKeys : [];
  const deliveryMetrics = typeof getDeliveryMetricsSnapshot === 'function'
    ? getDeliveryMetricsSnapshot()
    : { queueLength: typeof listDeliveryQueue === 'function' ? listDeliveryQueue(1000).length : 0 };
  const loginMetrics = typeof getLoginFailureMetrics === 'function'
    ? getLoginFailureMetrics()
    : { failures: 0, hotIps: [] };
  const webhookMetrics = typeof getWebhookMetricsSnapshot === 'function'
    ? getWebhookMetricsSnapshot()
    : { attempts: 0, errors: 0, errorRate: 0 };
  const requestLogMetrics = typeof getAdminRequestLogMetrics === 'function'
    ? getAdminRequestLogMetrics()
    : { total: 0, errors: 0, serverErrors: 0, unauthorized: 0 };
  const recentRequests = typeof listAdminRequestLogs === 'function'
    ? listAdminRequestLogs({ limit: 100 })
    : [];

  return {
    generatedAt: new Date().toISOString(),
    delivery: deliveryMetrics,
    adminLogin: loginMetrics,
    webhook: webhookMetrics,
    requestLog: requestLogMetrics,
    recentRequests,
    timeSeriesWindowMs: effectiveWindowMs || retentionMs,
    timeSeries: typeof listSeries === 'function'
      ? listSeries({ windowMs: effectiveWindowMs, keys: requestedKeys })
      : {},
  };
}

function buildObservabilityExportPayload(data = {}) {
  return {
    generatedAt: new Date().toISOString(),
    windowMs: Number(data.timeSeriesWindowMs || 0),
    delivery: data.delivery || {},
    deliveryRuntime: data.deliveryRuntime || {},
    adminLogin: data.adminLogin || {},
    webhook: data.webhook || {},
    requestLog: data.requestLog || {},
    runtimeSupervisor: data.runtimeSupervisor || null,
    platformOps: data.platformOps || null,
    recentRequests: data.recentRequests || [],
    timeSeries: data.timeSeries || {},
  };
}

function buildObservabilityCsv(data = {}) {
  const summaryRows = [
    { metric: 'delivery.queueLength', value: Number(data?.delivery?.queueLength || 0) },
    { metric: 'delivery.failRate', value: Number(data?.delivery?.failRate || 0) },
    { metric: 'delivery.runtime.queueDepth', value: Number(data?.deliveryRuntime?.queueDepth || 0) },
    { metric: 'delivery.runtime.deadLetterCount', value: Number(data?.deliveryRuntime?.deadLetterCount || 0) },
    { metric: 'adminLogin.failures', value: Number(data?.adminLogin?.failures || 0) },
    { metric: 'webhook.errorRate', value: Number(data?.webhook?.errorRate || 0) },
    { metric: 'requestLog.errors', value: Number(data?.requestLog?.errors || 0) },
    { metric: 'requestLog.serverErrors', value: Number(data?.requestLog?.serverErrors || 0) },
    { metric: 'runtimeSupervisor.degraded', value: Number(data?.runtimeSupervisor?.counts?.degraded || 0) },
    { metric: 'runtimeSupervisor.offline', value: Number(data?.runtimeSupervisor?.counts?.offline || 0) },
  ];
  const lines = [
    [toCsvValue('metric'), toCsvValue('value')].join(','),
    ...summaryRows.map((row) => [toCsvValue(row.metric), toCsvValue(row.value)].join(',')),
    '',
    [toCsvValue('series'), toCsvValue('at'), toCsvValue('value')].join(','),
  ];

  const timeSeries = data?.timeSeries || {};
  for (const [seriesName, points] of Object.entries(timeSeries)) {
    for (const point of Array.isArray(points) ? points : []) {
      lines.push([
        toCsvValue(seriesName),
        toCsvValue(point?.at || ''),
        toCsvValue(Number(point?.value || 0)),
      ].join(','));
    }
  }

  lines.push('');
  lines.push([
    toCsvValue('requestId'),
    toCsvValue('at'),
    toCsvValue('method'),
    toCsvValue('path'),
    toCsvValue('statusCode'),
    toCsvValue('latencyMs'),
    toCsvValue('authMode'),
    toCsvValue('user'),
    toCsvValue('role'),
    toCsvValue('tenantId'),
    toCsvValue('error'),
  ].join(','));
  for (const row of Array.isArray(data?.recentRequests) ? data.recentRequests : []) {
    lines.push([
      toCsvValue(row?.id || ''),
      toCsvValue(row?.at || ''),
      toCsvValue(row?.method || ''),
      toCsvValue(row?.path || ''),
      toCsvValue(row?.statusCode || ''),
      toCsvValue(row?.latencyMs || ''),
      toCsvValue(row?.authMode || ''),
      toCsvValue(row?.user || ''),
      toCsvValue(row?.role || ''),
      toCsvValue(row?.tenantId || ''),
      toCsvValue(row?.error || ''),
    ].join(','));
  }

  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  DEFAULT_OBSERVABILITY_SERIES_KEYS,
  createObservabilitySeriesState,
  clampObservabilityWindowMs,
  parseObservabilitySeriesKeys,
  captureObservabilitySeries,
  listObservabilitySeries,
  buildAdminObservabilitySnapshot,
  buildObservabilityExportPayload,
  buildObservabilityCsv,
};
