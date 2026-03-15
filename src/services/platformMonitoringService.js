const config = require('../config');
const { createAdminBackup } = require('./adminSnapshotService');
const { publishAdminLiveUpdate } = require('./adminLiveBus');
const { getRuntimeSupervisorSnapshot } = require('./runtimeSupervisorService');
const {
  listPlatformAgentRuntimes,
  getPlatformAnalyticsOverview,
  getTenantQuotaSnapshot,
  listPlatformTenants,
  reconcileDeliveryState,
} = require('./platformService');
const {
  getPlatformOpsState,
  updatePlatformOpsState,
} = require('../store/platformOpsStateStore');

let monitorTimer = null;
let cyclePromise = null;

function nowIso() {
  return new Date().toISOString();
}

function asInt(value, fallback, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function elapsedMsSince(value) {
  const date = toDate(value);
  if (!date) return Number.POSITIVE_INFINITY;
  return Date.now() - date.getTime();
}

function shouldRunInterval(lastAt, everyMs) {
  if (!everyMs || everyMs <= 0) return false;
  return elapsedMsSince(lastAt) >= everyMs;
}

function trimText(value, maxLen = 300) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function getMonitoringConfig() {
  return {
    enabled: config.platform?.monitoring?.enabled === true,
    intervalMs: asInt(config.platform?.monitoring?.intervalMs, 5 * 60 * 1000, 30 * 1000),
    alertCooldownMs: asInt(config.platform?.monitoring?.alertCooldownMs, 30 * 60 * 1000, 60 * 1000),
    reconcileEveryMs: asInt(config.platform?.monitoring?.reconcileEveryMs, 10 * 60 * 1000, 60 * 1000),
    agentStaleMs: asInt(
      config.platform?.monitoring?.staleAgentMs || config.platform?.monitoring?.agentStaleMs,
      10 * 60 * 1000,
      60 * 1000,
    ),
    backups: {
      enabled: config.platform?.backups?.enabled === true,
      intervalMs: asInt(config.platform?.backups?.intervalMs, 6 * 60 * 60 * 1000, 5 * 60 * 1000),
      note: trimText(config.platform?.backups?.note || 'platform-auto-backup', 160) || 'platform-auto-backup',
      includeSnapshot: config.platform?.backups?.includeSnapshot !== false,
    },
  };
}

function cooldownAllowsAlert(state, key, cooldownMs) {
  const last = state?.lastAlertAtByKey?.[key];
  if (!last) return true;
  return elapsedMsSince(last) >= cooldownMs;
}

function markAlert(state, key) {
  return {
    ...(state?.lastAlertAtByKey || {}),
    [key]: nowIso(),
  };
}

// Monitoring emits actionable alerts on a cadence so operators do not have to keep
// a dashboard tab open just to notice drift, stale runtimes, or failed backups.
async function runPlatformMonitoringCycle({ client = null, force = false } = {}) {
  const monitoring = getMonitoringConfig();
  if (!monitoring.enabled && !force) {
    return {
      ok: true,
      skipped: true,
      reason: 'platform-monitoring-disabled',
    };
  }
  if (cyclePromise && !force) {
    return cyclePromise;
  }

  cyclePromise = (async () => {
    const state = getPlatformOpsState();
    const updatedAlertMap = { ...(state.lastAlertAtByKey || {}) };
    const generatedAt = nowIso();
    const report = {
      ok: true,
      generatedAt,
      autoBackup: null,
      analytics: null,
      reconcile: null,
      runtimeSupervisor: null,
      agents: null,
      alerts: [],
      stateBefore: state,
    };

    try {
      if (
        monitoring.backups.enabled
        && (force || shouldRunInterval(state.lastAutoBackupAt, monitoring.backups.intervalMs))
      ) {
        try {
          const saved = await createAdminBackup({
            client,
            actor: 'platform-monitor',
            role: 'system',
            note: monitoring.backups.note,
            includeSnapshot: monitoring.backups.includeSnapshot,
          });
          report.autoBackup = {
            ok: true,
            backupId: saved?.id || saved?.file || null,
            createdAt: saved?.createdAt || generatedAt,
          };
          publishAdminLiveUpdate('ops-alert', {
            source: 'platform-monitor',
            kind: 'platform-auto-backup-created',
            backup: saved?.id || saved?.file || null,
            note: monitoring.backups.note,
          });
          updatedAlertMap['platform-auto-backup-created'] = generatedAt;
          updatePlatformOpsState({
            lastAutoBackupAt: generatedAt,
            lastAlertAtByKey: updatedAlertMap,
          });
        } catch (error) {
          report.autoBackup = {
            ok: false,
            error: trimText(error?.message || error, 240),
          };
          publishAdminLiveUpdate('ops-alert', {
            source: 'platform-monitor',
            kind: 'platform-auto-backup-failed',
            error: trimText(error?.message || error, 240),
          });
          updatedAlertMap['platform-auto-backup-failed'] = generatedAt;
        }
      }

      const shouldReconcile =
        force || shouldRunInterval(state.lastReconcileAt, monitoring.reconcileEveryMs);
      const [analytics, reconcile, runtimeSupervisor, agentRuntimes, tenants] = await Promise.all([
        getPlatformAnalyticsOverview(),
        shouldReconcile ? reconcileDeliveryState() : Promise.resolve(null),
        getRuntimeSupervisorSnapshot({ forceRefresh: true }).catch(() => null),
        listPlatformAgentRuntimes({ limit: 500 }),
        listPlatformTenants({ limit: 500 }),
      ]);

      report.analytics = analytics;
      report.reconcile = reconcile;
      report.runtimeSupervisor = runtimeSupervisor;
      report.agents = {
        total: agentRuntimes.length,
        items: agentRuntimes,
      };
      report.quota = {
        tenants: 0,
        exceeded: [],
        nearLimit: [],
      };

      if (reconcile?.summary?.anomalies > 0) {
        const alertKey = 'delivery-reconcile-anomaly';
        if (force || cooldownAllowsAlert(state, alertKey, monitoring.alertCooldownMs)) {
          publishAdminLiveUpdate('ops-alert', {
            source: 'platform-monitor',
            kind: alertKey,
            count: reconcile.summary.anomalies,
            sample: reconcile.anomalies.slice(0, 10),
          });
          updatedAlertMap[alertKey] = generatedAt;
          report.alerts.push(alertKey);
        }
      }

      if (reconcile?.summary?.abuseFindings > 0) {
        const alertKey = 'delivery-abuse-suspected';
        if (force || cooldownAllowsAlert(state, alertKey, monitoring.alertCooldownMs)) {
          publishAdminLiveUpdate('ops-alert', {
            source: 'platform-monitor',
            kind: alertKey,
            count: reconcile.summary.abuseFindings,
            sample: reconcile.abuseFindings.slice(0, 10),
          });
          updatedAlertMap[alertKey] = generatedAt;
          report.alerts.push(alertKey);
        }
      }

      for (const runtime of agentRuntimes) {
        const runtimeLabel = `${runtime.tenantId}:${runtime.runtimeKey}`;
        if (runtime.status === 'outdated') {
          const alertKey = `agent-version-outdated:${runtimeLabel}`;
          if (force || cooldownAllowsAlert(state, alertKey, monitoring.alertCooldownMs)) {
            publishAdminLiveUpdate('ops-alert', {
              source: 'platform-monitor',
              kind: 'agent-version-outdated',
              tenantId: runtime.tenantId,
              runtimeKey: runtime.runtimeKey,
              version: runtime.version,
              minimumVersion: runtime.minRequiredVersion,
            });
            updatedAlertMap[alertKey] = generatedAt;
            report.alerts.push(alertKey);
          }
        }
        if (elapsedMsSince(runtime.lastSeenAt) >= monitoring.agentStaleMs) {
          const alertKey = `agent-runtime-stale:${runtimeLabel}`;
          if (force || cooldownAllowsAlert(state, alertKey, monitoring.alertCooldownMs)) {
            publishAdminLiveUpdate('ops-alert', {
              source: 'platform-monitor',
              kind: 'agent-runtime-stale',
              tenantId: runtime.tenantId,
              runtimeKey: runtime.runtimeKey,
              lastSeenAt: runtime.lastSeenAt,
              staleMs: elapsedMsSince(runtime.lastSeenAt),
            });
            updatedAlertMap[alertKey] = generatedAt;
            report.alerts.push(alertKey);
          }
        }
      }

      for (const tenant of tenants) {
        const quotaSnapshot = await getTenantQuotaSnapshot(tenant.id).catch(() => null);
        if (!quotaSnapshot?.quotas) continue;
        report.quota.tenants += 1;
        for (const [quotaKey, quota] of Object.entries(quotaSnapshot.quotas)) {
          if (!quota || quota.unlimited) continue;
          const entry = {
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            quotaKey,
            used: quota.used,
            limit: quota.limit,
            remaining: quota.remaining,
          };
          if (quota.exceeded) {
            report.quota.exceeded.push(entry);
            const alertKey = `tenant-quota-exceeded:${tenant.id}:${quotaKey}`;
            if (force || cooldownAllowsAlert(state, alertKey, monitoring.alertCooldownMs)) {
              publishAdminLiveUpdate('ops-alert', {
                source: 'platform-monitor',
                kind: 'tenant-quota-exceeded',
                ...entry,
              });
              updatedAlertMap[alertKey] = generatedAt;
              report.alerts.push(alertKey);
            }
            continue;
          }
          if (Number(quota.remaining) <= 1) {
            report.quota.nearLimit.push(entry);
            const alertKey = `tenant-quota-near-limit:${tenant.id}:${quotaKey}`;
            if (force || cooldownAllowsAlert(state, alertKey, monitoring.alertCooldownMs)) {
              publishAdminLiveUpdate('ops-alert', {
                source: 'platform-monitor',
                kind: 'tenant-quota-near-limit',
                ...entry,
              });
              updatedAlertMap[alertKey] = generatedAt;
              report.alerts.push(alertKey);
            }
          }
        }
      }

      updatePlatformOpsState({
        lastMonitoringAt: generatedAt,
        lastReconcileAt: shouldReconcile ? generatedAt : state.lastReconcileAt,
        lastAlertAtByKey: updatedAlertMap,
      });
      report.stateAfter = getPlatformOpsState();
      return report;
    } finally {
      cyclePromise = null;
    }
  })();

  return cyclePromise;
}

function startPlatformMonitoring({ client = null } = {}) {
  const monitoring = getMonitoringConfig();
  if (!monitoring.enabled) return false;
  if (monitorTimer) return true;
  void runPlatformMonitoringCycle({ client }).catch(() => null);
  monitorTimer = setInterval(() => {
    void runPlatformMonitoringCycle({ client }).catch((error) => {
      console.error('[platform-monitor] cycle failed:', error.message);
    });
  }, monitoring.intervalMs);
  if (typeof monitorTimer.unref === 'function') {
    monitorTimer.unref();
  }
  return true;
}

function stopPlatformMonitoring() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

module.exports = {
  getMonitoringConfig,
  runPlatformMonitoringCycle,
  startPlatformMonitoring,
  stopPlatformMonitoring,
};
