'use strict';

/**
 * Discord ops-alert bridge used by the bot runtime.
 * Keep alert formatting and Discord fan-out outside bot.js so bootstrap stays small.
 */

const { EmbedBuilder } = require('discord.js');

const ALERT_FIELD_LABELS = Object.freeze({
  queue: 'Queue',
  threshold: 'Threshold',
  overdueMs: 'Overdue (ms)',
  thresholdMs: 'Threshold (ms)',
  code: 'Purchase Code',
  failRate: 'Fail Rate',
  attempts: 'Attempts',
  failures: 'Failures',
  windowMs: 'Window (ms)',
  topIps: 'Top IPs',
  count: 'Count',
  types: 'Types',
  codes: 'Sample Codes',
  tenant: 'Tenant',
  quota: 'Quota',
  used: 'Used',
  limit: 'Limit',
  remaining: 'Remaining',
  runtime: 'Runtime',
  reason: 'Reason',
  url: 'URL',
  backup: 'Backup',
  note: 'Note',
  error: 'Error',
  event: 'Event',
  target: 'Target',
  version: 'Version',
  min: 'Min Version',
  lastSeenAt: 'Last Seen',
});

const MULTILINE_ALERT_FIELDS = new Set([
  'topIps',
  'types',
  'codes',
  'reason',
  'url',
  'note',
  'error',
  'target',
  'lastSeenAt',
]);

function trimText(value, maxLen = 160) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function formatCount(value) {
  const count = Number(value || 0);
  if (!Number.isFinite(count)) return '0';
  return Math.trunc(count).toLocaleString('en-US');
}

function getOpsAlertSeverity(kind) {
  if (
    kind === 'fail-rate'
    || kind === 'queue-stuck'
    || kind === 'backup-failed'
    || kind === 'dead-letter-threshold'
    || kind === 'consecutive-failures'
    || kind === 'runtime-offline'
    || kind === 'runtime-degraded'
    || kind === 'platform-webhook-failed'
    || kind === 'platform-auto-backup-failed'
  ) {
    return 'ERROR';
  }
  if (kind === 'platform-auto-backup-created') {
    return 'INFO';
  }
  return 'WARN';
}

function getOpsAlertColor(severity) {
  if (severity === 'ERROR') return 0xed4245;
  if (severity === 'INFO') return 0x57f287;
  return 0xfee75c;
}

function buildOpsAlertHeader(kind, label) {
  return `[OPS][${getOpsAlertSeverity(kind)}] ${label}`;
}

function buildLine(key, value) {
  const text = trimText(value, 220);
  if (!text) return null;
  return `${key}=${text}`;
}

function prettifyOpsAlertField(key) {
  const clean = String(key || '').trim();
  if (!clean) return 'Details';
  return ALERT_FIELD_LABELS[clean] || clean;
}

function summarizeSampleByType(sample) {
  const counts = new Map();
  for (const row of Array.isArray(sample) ? sample : []) {
    const type = String(row?.type || 'unknown').trim() || 'unknown';
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([type, count]) => `${type} x${count}`);
}

function summarizeSampleCodes(sample) {
  return (Array.isArray(sample) ? sample : [])
    .map((row) => trimText(row?.code, 18))
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

function humanizeKind(kind) {
  return String(kind || 'ops-alert')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Operational Alert';
}

function formatOpsAlertMessage(payload = {}) {
  const kind = String(payload.kind || 'alert');
  if (kind === 'queue-pressure') {
    return [
      buildOpsAlertHeader(kind, 'Delivery Queue Pressure'),
      buildLine('queue', formatCount(payload.queueLength || 0)),
      buildLine('threshold', payload.threshold || '-'),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'queue-stuck') {
    return [
      buildOpsAlertHeader(kind, 'Delivery Queue Stuck'),
      buildLine('overdueMs', formatCount(payload.oldestDueMs || 0)),
      buildLine('thresholdMs', payload.thresholdMs || '-'),
      buildLine('queue', formatCount(payload.queueLength || 0)),
      buildLine('code', payload.purchaseCode || '-'),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'fail-rate') {
    const failRate = Number(payload.failRate || 0);
    return [
      buildOpsAlertHeader(kind, 'Delivery Fail Rate Spike'),
      buildLine('failRate', failRate.toFixed(3)),
      buildLine('attempts', formatCount(payload.attempts || 0)),
      buildLine('failures', formatCount(payload.failures || 0)),
      buildLine('threshold', payload.threshold || '-'),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'login-failure-spike') {
    const topIps = Array.isArray(payload.topIps) ? payload.topIps.join(',') : '-';
    return [
      buildOpsAlertHeader(kind, 'Admin Login Failure Spike'),
      buildLine('failures', formatCount(payload.failures || 0)),
      buildLine('windowMs', payload.windowMs || '-'),
      buildLine('threshold', payload.threshold || '-'),
      buildLine('topIps', topIps),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'delivery-reconcile-anomaly' || kind === 'delivery-abuse-suspected') {
    const sampleTypes = summarizeSampleByType(payload.sample);
    const sampleCodes = summarizeSampleCodes(payload.sample);
    return [
      buildOpsAlertHeader(
        kind,
        kind === 'delivery-reconcile-anomaly'
          ? 'Delivery Reconcile Anomaly'
          : 'Delivery Abuse Suspected',
      ),
      buildLine('count', formatCount(payload.count || 0)),
      buildLine('types', sampleTypes.join(', ')),
      buildLine('codes', sampleCodes),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'tenant-quota-exceeded' || kind === 'tenant-quota-near-limit') {
    return [
      buildOpsAlertHeader(
        kind,
        kind === 'tenant-quota-exceeded'
          ? 'Tenant Quota Exceeded'
          : 'Tenant Quota Near Limit',
      ),
      buildLine('tenant', payload.tenantSlug || payload.tenantId || '-'),
      buildLine('quota', payload.quotaKey || '-'),
      buildLine('used', formatCount(payload.used || 0)),
      buildLine('limit', formatCount(payload.limit || 0)),
      buildLine('remaining', formatCount(payload.remaining || 0)),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'runtime-offline' || kind === 'runtime-degraded') {
    return [
      buildOpsAlertHeader(
        kind,
        kind === 'runtime-offline' ? 'Runtime Offline' : 'Runtime Degraded',
      ),
      buildLine('runtime', payload.runtimeLabel || payload.runtimeKey || 'runtime'),
      buildLine('reason', payload.reason || '-'),
      buildLine('url', payload.url || '-'),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'platform-auto-backup-created' || kind === 'platform-auto-backup-failed') {
    return [
      buildOpsAlertHeader(
        kind,
        kind === 'platform-auto-backup-created'
          ? 'Platform Auto Backup Created'
          : 'Platform Auto Backup Failed',
      ),
      buildLine('backup', payload.backup || '-'),
      buildLine('note', payload.note || '-'),
      buildLine('error', payload.error || '-'),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'agent-version-outdated' || kind === 'agent-runtime-stale') {
    return [
      buildOpsAlertHeader(
        kind,
        kind === 'agent-version-outdated'
          ? 'Agent Version Outdated'
          : 'Agent Runtime Stale',
      ),
      buildLine('tenant', payload.tenantId || '-'),
      buildLine('runtime', payload.runtimeKey || '-'),
      buildLine('version', payload.version || '-'),
      buildLine('min', payload.minimumVersion || '-'),
      buildLine('lastSeenAt', payload.lastSeenAt || '-'),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'platform-webhook-failed') {
    return [
      buildOpsAlertHeader(kind, 'Platform Webhook Failed'),
      buildLine('event', payload.eventType || '-'),
      buildLine('target', payload.targetUrl || '-'),
      buildLine('error', payload.error || '-'),
    ].filter(Boolean).join('\n');
  }
  return `[OPS] ${JSON.stringify(payload)}`;
}

function parseOpsAlertSummary(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const header = lines.shift();
  const match = /^\[OPS\]\[(?<severity>[A-Z]+)\]\s+(?<title>.+)$/.exec(header);
  if (!match?.groups) return null;
  const fields = lines
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator <= 0) {
        return {
          name: 'Details',
          value: trimText(line, 1024),
          inline: false,
        };
      }
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim() || '-';
      return {
        name: prettifyOpsAlertField(key),
        value: trimText(value, 1024),
        inline: !MULTILINE_ALERT_FIELDS.has(key),
      };
    })
    .filter((field) => field.value);
  return {
    severity: match.groups.severity,
    title: match.groups.title,
    fields,
  };
}

function formatOpsAlertDiscordPayload(payload = {}, options = {}) {
  const text = formatOpsAlertMessage(payload);
  const parsed = parseOpsAlertSummary(text);
  const timestamp = options.at || payload.generatedAt || payload.createdAt || null;

  if (!parsed) {
    const embed = new EmbedBuilder()
      .setColor(getOpsAlertColor(getOpsAlertSeverity(String(payload.kind || 'alert'))))
      .setTitle(humanizeKind(payload.kind))
      .setDescription(`\`\`\`json\n${trimText(JSON.stringify(payload, null, 2), 3900)}\n\`\`\``)
      .setFooter({
        text: `OPS • ${getOpsAlertSeverity(String(payload.kind || 'alert'))}${payload.source ? ` • ${trimText(payload.source, 60)}` : ''}`,
      });
    if (timestamp) {
      const date = new Date(timestamp);
      if (!Number.isNaN(date.getTime())) {
        embed.setTimestamp(date);
      }
    }
    return { embeds: [embed] };
  }

  const embed = new EmbedBuilder()
    .setColor(getOpsAlertColor(parsed.severity))
    .setTitle(parsed.title)
    .setFooter({
      text: `OPS • ${parsed.severity}${payload.source ? ` • ${trimText(payload.source, 60)}` : ''}`,
    });

  if (timestamp) {
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) {
      embed.setTimestamp(date);
    }
  }

  if (parsed.fields.length > 0) {
    embed.addFields(parsed.fields.slice(0, 25));
  } else {
    embed.setDescription(text);
  }

  return { embeds: [embed] };
}

function createBindOpsAlertRoute({
  adminLiveBus,
  channels,
  logger = console,
}) {
  let bound = false;

  return function bindOpsAlertRoute(clientInstance) {
    if (bound) return;
    bound = true;

    adminLiveBus.on('update', async (evt) => {
      try {
        if (evt?.type !== 'ops-alert') return;
        const message = formatOpsAlertDiscordPayload(evt?.payload || {}, {
          at: evt?.at || null,
        });

        for (const guild of clientInstance.guilds.cache.values()) {
          const channel =
            guild.channels.cache.find(
              (candidate) =>
                candidate.name === channels.adminLog
                && candidate.isTextBased
                && candidate.isTextBased(),
            )
            || guild.channels.cache.find(
              (candidate) =>
                candidate.name === channels.shopLog
                && candidate.isTextBased
                && candidate.isTextBased(),
            );
          if (!channel) continue;
          await channel.send(message).catch(() => null);
        }
      } catch (error) {
        logger.error('[ops-alert-route] failed to send alert to Discord', error);
      }
    });
  };
}

module.exports = {
  createBindOpsAlertRoute,
  formatOpsAlertDiscordPayload,
  formatOpsAlertMessage,
};
