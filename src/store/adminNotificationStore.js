const crypto = require('node:crypto');
const fs = require('node:fs');

const { getFilePath } = require('./_persist');

const MAX_NOTIFICATIONS = 500;
const FILE_PATH = getFilePath('admin-notifications.json');

const notifications = [];
let initPromise = null;
let writeQueue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function trimText(value, maxLen = 500) {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function createId(prefix = 'admin-note') {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  return `${prefix}-${suffix}`;
}

function normalizeNotification(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : new Date();
  const acknowledgedAt = entry.acknowledgedAt ? new Date(entry.acknowledgedAt) : null;
  return {
    id: String(entry.id || createId()),
    type: String(entry.type || 'notice').trim() || 'notice',
    source: String(entry.source || 'system').trim() || 'system',
    kind: String(entry.kind || 'notice').trim() || 'notice',
    severity: String(entry.severity || 'info').trim() || 'info',
    title: trimText(entry.title || entry.kind || 'Notification', 180),
    message: trimText(entry.message || '', 600),
    entityKey: String(entry.entityKey || '').trim() || null,
    data: entry.data && typeof entry.data === 'object' ? entry.data : null,
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    acknowledgedAt:
      acknowledgedAt && !Number.isNaN(acknowledgedAt.getTime())
        ? acknowledgedAt
        : null,
    acknowledgedBy: String(entry.acknowledgedBy || '').trim() || null,
  };
}

function queueWrite(work, label) {
  writeQueue = writeQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[adminNotificationStore] ${label} failed:`, error.message);
    });
  return writeQueue;
}

function writeSnapshotToDisk() {
  const tmpPath = `${FILE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(notifications, null, 2), 'utf8');
  fs.renameSync(tmpPath, FILE_PATH);
}

async function hydrateFromDisk() {
  try {
    if (!fs.existsSync(FILE_PATH)) return;
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    notifications.length = 0;
    for (const row of Array.isArray(parsed) ? parsed : []) {
      const normalized = normalizeNotification(row);
      if (!normalized) continue;
      notifications.push(normalized);
    }
    notifications.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (notifications.length > MAX_NOTIFICATIONS) {
      notifications.splice(0, notifications.length - MAX_NOTIFICATIONS);
    }
  } catch (error) {
    console.error('[adminNotificationStore] failed to hydrate:', error.message);
  }
}

function initAdminNotificationStore() {
  if (!initPromise) {
    initPromise = hydrateFromDisk();
  }
  return initPromise;
}

function addAdminNotification(entry = {}) {
  const normalized = normalizeNotification(entry);
  if (!normalized) return null;
  notifications.push(normalized);
  notifications.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.splice(0, notifications.length - MAX_NOTIFICATIONS);
  }
  queueWrite(writeSnapshotToDisk, 'add');
  return { ...normalized };
}

function listAdminNotifications(options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
  const typeFilter = String(options.type || '').trim().toLowerCase();
  const kindFilter = String(options.kind || '').trim().toLowerCase();
  const severityFilter = String(options.severity || '').trim().toLowerCase();
  const entityKeyFilter = String(options.entityKey || '').trim().toLowerCase();
  const acknowledgedFilter =
    typeof options.acknowledged === 'boolean' ? options.acknowledged : null;

  return notifications
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((row) => {
      if (typeFilter && String(row.type || '').toLowerCase() !== typeFilter) return false;
      if (kindFilter && String(row.kind || '').toLowerCase() !== kindFilter) return false;
      if (severityFilter && String(row.severity || '').toLowerCase() !== severityFilter) return false;
      if (
        entityKeyFilter
        && String(row.entityKey || '').toLowerCase() !== entityKeyFilter
      ) {
        return false;
      }
      if (acknowledgedFilter === true && !row.acknowledgedAt) return false;
      if (acknowledgedFilter === false && row.acknowledgedAt) return false;
      return true;
    })
    .slice(0, limit)
    .map((row) => ({
      ...row,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      acknowledgedAt:
        row.acknowledgedAt instanceof Date
          ? row.acknowledgedAt.toISOString()
          : row.acknowledgedAt,
    }));
}

function acknowledgeAdminNotifications(ids = [], actor = 'admin-web') {
  const wanted = new Set(
    (Array.isArray(ids) ? ids : [ids])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  if (wanted.size === 0) {
    return { total: 0, updated: 0, items: [] };
  }

  const at = nowIso();
  const updated = [];
  for (const row of notifications) {
    if (!wanted.has(String(row.id || ''))) continue;
    row.acknowledgedAt = new Date(at);
    row.acknowledgedBy = String(actor || 'admin-web').trim() || 'admin-web';
    updated.push({
      ...row,
      createdAt: row.createdAt.toISOString(),
      acknowledgedAt: at,
    });
  }
  if (updated.length > 0) {
    queueWrite(writeSnapshotToDisk, 'acknowledge');
  }
  return {
    total: wanted.size,
    updated: updated.length,
    items: updated,
  };
}

function clearAdminNotifications(options = {}) {
  const acknowledgedOnly = options.acknowledgedOnly === true;
  const before = notifications.length;
  if (acknowledgedOnly) {
    const remaining = notifications.filter((row) => !row.acknowledgedAt);
    notifications.length = 0;
    notifications.push(...remaining);
  } else {
    notifications.length = 0;
  }
  const removed = Math.max(0, before - notifications.length);
  queueWrite(writeSnapshotToDisk, 'clear');
  return { removed, remaining: notifications.length };
}

function replaceAdminNotifications(nextRows = []) {
  notifications.length = 0;
  for (const row of Array.isArray(nextRows) ? nextRows : []) {
    const normalized = normalizeNotification(row);
    if (!normalized) continue;
    notifications.push(normalized);
  }
  notifications.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.splice(0, notifications.length - MAX_NOTIFICATIONS);
  }
  queueWrite(writeSnapshotToDisk, 'replace');
  return notifications.length;
}

function buildNotificationFromLiveEvent(type, payload = {}) {
  const eventType = String(type || '').trim();
  const data = payload && typeof payload === 'object' ? payload : {};

  if (eventType === 'ops-alert') {
    const kind = String(data.kind || 'ops-alert').trim() || 'ops-alert';
    const severity =
      kind === 'fail-rate'
        || kind === 'queue-stuck'
        || kind === 'backup-failed'
        || kind === 'dead-letter-threshold'
        || kind === 'consecutive-failures'
        || kind === 'runtime-offline'
        || kind === 'runtime-degraded'
        || kind === 'platform-webhook-failed'
        || kind === 'platform-auto-backup-failed'
        ? 'error'
        : 'warn';
    let title = 'Operational Alert';
    let message = trimText(JSON.stringify(data), 500);
    if (kind === 'queue-pressure') {
      title = 'Delivery Queue Pressure';
      message = `queue=${Number(data.queueLength || 0)} threshold=${Number(data.threshold || 0)}`;
    } else if (kind === 'queue-stuck') {
      title = 'Delivery Queue Stuck';
      message =
        `overdue=${Number(data.oldestDueMs || 0)}ms queue=${Number(data.queueLength || 0)}`
        + `${data.purchaseCode ? ` code=${data.purchaseCode}` : ''}`;
    } else if (kind === 'fail-rate') {
      title = 'Delivery Fail Rate Spike';
      message =
        `failRate=${Number(data.failRate || 0).toFixed(3)} failures=${Number(data.failures || 0)} `
        + `attempts=${Number(data.attempts || 0)}`;
    } else if (kind === 'dead-letter-threshold') {
      title = 'Dead-Letter Threshold Reached';
      message =
        `deadLetters=${Number(data.deadLetterCount || 0)} threshold=${Number(data.threshold || 0)}`;
    } else if (kind === 'consecutive-failures') {
      title = 'Consecutive Delivery Failures';
      message =
        `consecutive=${Number(data.consecutiveFailures || 0)} threshold=${Number(data.threshold || 0)}`
        + `${data.lastPurchaseCode ? ` code=${data.lastPurchaseCode}` : ''}`;
    } else if (kind === 'login-failure-spike') {
      title = 'Admin Login Failure Spike';
      message =
        `failures=${Number(data.failures || 0)} windowMs=${Number(data.windowMs || 0)}`
        + `${Array.isArray(data.hotIps) && data.hotIps.length > 0 ? ` hotIps=${data.hotIps.map((row) => row.ip).join(',')}` : ''}`;
    } else if (kind === 'runtime-offline') {
      title = 'Runtime Offline';
      message =
        `${String(data.runtimeLabel || data.runtimeKey || 'runtime')} offline`
        + `${data.reason ? ` (${String(data.reason)})` : ''}`
        + `${data.url ? ` @ ${String(data.url)}` : ''}`;
    } else if (kind === 'runtime-degraded') {
      title = 'Runtime Degraded';
      message =
        `${String(data.runtimeLabel || data.runtimeKey || 'runtime')} degraded`
        + `${data.reason ? ` (${String(data.reason)})` : ''}`
        + `${data.url ? ` @ ${String(data.url)}` : ''}`;
    } else if (kind === 'platform-webhook-failed') {
      title = 'Platform Webhook Failed';
      message =
        `${String(data.eventType || 'platform.unknown')} -> ${String(data.targetUrl || '-')}`
        + `${data.error ? ` error=${trimText(data.error, 200)}` : ''}`;
    } else if (kind === 'agent-version-outdated') {
      title = 'Agent Version Outdated';
      message =
        `${String(data.tenantId || 'tenant')} / ${String(data.runtimeKey || 'runtime')}`
        + ` version=${String(data.version || '-')}`
        + ` min=${String(data.minimumVersion || '-')}`;
    } else if (kind === 'agent-runtime-stale') {
      title = 'Agent Runtime Stale';
      message =
        `${String(data.tenantId || 'tenant')} / ${String(data.runtimeKey || 'runtime')}`
        + ` lastSeenAt=${String(data.lastSeenAt || '-')}`;
    } else if (kind === 'delivery-reconcile-anomaly') {
      title = 'Delivery Reconcile Anomaly';
      message =
        `count=${Number(data.count || 0)}`
        + `${Array.isArray(data.sample) && data.sample.length > 0 ? ` sample=${String(data.sample[0]?.type || '-')}` : ''}`;
    } else if (kind === 'delivery-abuse-suspected') {
      title = 'Delivery Abuse Suspected';
      message =
        `count=${Number(data.count || 0)}`
        + `${Array.isArray(data.sample) && data.sample.length > 0 ? ` sample=${String(data.sample[0]?.type || '-')}` : ''}`;
    } else if (kind === 'platform-auto-backup-created') {
      title = 'Platform Auto Backup Created';
      message =
        `backup=${String(data.backup || '-')}`
        + `${data.note ? ` note=${trimText(data.note, 120)}` : ''}`;
    } else if (kind === 'platform-auto-backup-failed') {
      title = 'Platform Auto Backup Failed';
      message = `${data.error ? trimText(data.error, 240) : 'unknown error'}`;
    }
    return {
      type: 'ops-alert',
      source: String(data.source || 'ops').trim() || 'ops',
      kind,
      severity,
      title,
      message,
      entityKey: String(data.purchaseCode || kind).trim() || kind,
      data,
    };
  }

  if (eventType === 'backup-restore') {
    return {
      type: 'backup',
      source: 'admin-web',
      kind: 'restore',
      severity: 'info',
      title: 'Backup Restore Complete',
      message:
        `backup=${String(data.backup || '-')} actor=${String(data.actor || 'unknown')}`,
      entityKey: String(data.backup || '').trim() || null,
      data,
    };
  }

  if (eventType === 'backup-restore-started') {
    return {
      type: 'backup',
      source: 'admin-web',
      kind: 'restore-started',
      severity: 'warn',
      title: 'Backup Restore Started',
      message:
        `backup=${String(data.backup || '-')} rollback=${String(data.rollbackBackup || '-')}`,
      entityKey: String(data.backup || '').trim() || null,
      data,
    };
  }

  if (eventType === 'backup-restore-failed') {
    return {
      type: 'backup',
      source: 'admin-web',
      kind: 'restore-failed',
      severity: 'error',
      title: 'Backup Restore Failed',
      message:
        `backup=${String(data.backup || '-')} rollback=${String(data.rollbackStatus || 'unknown')}`
        + `${data.error ? ` error=${trimText(data.error, 200)}` : ''}`,
      entityKey: String(data.backup || '').trim() || null,
      data,
    };
  }

  if (eventType === 'backup-restore-rollback') {
    return {
      type: 'backup',
      source: 'admin-web',
      kind: 'rollback',
      severity: 'warn',
      title: 'Backup Restore Rolled Back',
      message:
        `backup=${String(data.backup || '-')} rollback=${String(data.rollbackBackup || '-')}`,
      entityKey: String(data.backup || '').trim() || null,
      data,
    };
  }

  if (eventType === 'backup-restore-rollback-failed') {
    return {
      type: 'backup',
      source: 'admin-web',
      kind: 'rollback-failed',
      severity: 'error',
      title: 'Backup Restore Rollback Failed',
      message:
        `backup=${String(data.backup || '-')} rollback=${String(data.rollbackBackup || '-')}`
        + `${data.error ? ` error=${trimText(data.error, 200)}` : ''}`,
      entityKey: String(data.backup || '').trim() || null,
      data,
    };
  }

  if (eventType === 'backup-create') {
    return {
      type: 'backup',
      source: 'admin-web',
      kind: 'create',
      severity: 'info',
      title: 'Backup Created',
      message:
        `backup=${String(data.backup || '-')} actor=${String(data.actor || 'unknown')}`,
      entityKey: String(data.backup || '').trim() || null,
      data,
    };
  }

  if (eventType === 'command-template-update') {
    return {
      type: 'command-template',
      source: 'admin-web',
      kind: String(data.action || 'update').trim() || 'update',
      severity: 'info',
      title: 'Delivery Command Template Updated',
      message:
        `${String(data.lookupKey || '-')} by ${String(data.actor || 'unknown')}`,
      entityKey: String(data.lookupKey || '').trim() || null,
      data,
    };
  }

  if (eventType === 'platform-event') {
    const eventName = String(data.eventType || 'platform.unknown').trim() || 'platform.unknown';
    const label = eventName.replace(/^platform\./, '').replace(/[._-]+/g, ' ').trim();
    return {
      type: 'platform',
      source: String(data.source || 'platform').trim() || 'platform',
      kind: eventName,
      severity: 'info',
      title: `Platform Event: ${label || eventName}`,
      message:
        `${data.tenantId ? `tenant=${String(data.tenantId)} ` : ''}`
        + `${data.actor ? `actor=${String(data.actor)} ` : ''}`
        + `${data.subscriptionId ? `subscription=${String(data.subscriptionId)} ` : ''}`
        + `${data.licenseId ? `license=${String(data.licenseId)} ` : ''}`
        + `${data.apiKeyId ? `apiKey=${String(data.apiKeyId)} ` : ''}`
        + `${data.webhookId ? `webhook=${String(data.webhookId)} ` : ''}`
        + `${data.offerId ? `offer=${String(data.offerId)} ` : ''}`
        + `${data.runtimeKey ? `runtime=${String(data.runtimeKey)} ` : ''}`.trim(),
      entityKey:
        String(
          data.tenantId
          || data.subscriptionId
          || data.licenseId
          || data.apiKeyId
          || data.webhookId
          || data.offerId
          || eventName,
        ).trim() || eventName,
      data,
    };
  }

  return null;
}

function persistAdminLiveEvent(type, payload = {}) {
  const entry = buildNotificationFromLiveEvent(type, payload);
  if (!entry) return null;
  return addAdminNotification(entry);
}

initAdminNotificationStore();

module.exports = {
  addAdminNotification,
  acknowledgeAdminNotifications,
  clearAdminNotifications,
  initAdminNotificationStore,
  listAdminNotifications,
  persistAdminLiveEvent,
  replaceAdminNotifications,
};
