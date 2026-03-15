const crypto = require('node:crypto');

const config = require('../config');
const { prisma } = require('../prisma');
const { publishAdminLiveUpdate } = require('./adminLiveBus');

const PLATFORM_SCOPE_GROUPS = Object.freeze([
  {
    key: 'tenant',
    title: 'Tenant Management',
    scopes: ['tenant:read', 'tenant:write'],
  },
  {
    key: 'subscription',
    title: 'Billing + Subscription',
    scopes: ['subscription:read', 'subscription:write'],
  },
  {
    key: 'license',
    title: 'License + Legal',
    scopes: ['license:read', 'license:write'],
  },
  {
    key: 'marketplace',
    title: 'Marketplace Economy',
    scopes: ['marketplace:read', 'marketplace:write'],
  },
  {
    key: 'webhook',
    title: 'Public API + Webhooks',
    scopes: ['webhook:read', 'webhook:write'],
  },
  {
    key: 'analytics',
    title: 'Analytics + Monitoring',
    scopes: ['analytics:read', 'delivery:reconcile', 'agent:write'],
  },
]);

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = 'platform') {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  return `${prefix}-${suffix}`;
}

function trimText(value, maxLen = 240) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function normalizeSlug(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || null;
}

function normalizeTenantType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['direct', 'trial', 'reseller', 'demo'].includes(text)) return text;
  return 'direct';
}

function normalizeStatus(value, allowed = ['active']) {
  const text = String(value || '').trim().toLowerCase();
  if (allowed.includes(text)) return text;
  return allowed[0] || 'active';
}

function normalizeLocale(value) {
  const supported = new Set(
    (config.platform?.localization?.supportedLocales || ['th', 'en'])
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const fallback = String(config.platform?.localization?.defaultLocale || 'th').trim().toLowerCase() || 'th';
  const text = String(value || '').trim().toLowerCase();
  if (text && supported.has(text)) return text;
  return fallback;
}

function normalizeBillingCycle(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['trial', 'monthly', 'quarterly', 'yearly', 'one-time'].includes(text)) return text;
  return 'monthly';
}

function normalizeCurrency(value) {
  return trimText(value || config.platform?.billing?.currency || 'THB', 12).toUpperCase() || 'THB';
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIso(value) {
  const date = parseDateOrNull(value);
  return date ? date.toISOString() : null;
}

function asInt(value, fallback = 0, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function parseJsonOrFallback(value, fallback = null) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function stringifyMeta(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function hmacSha256(secret, payload) {
  return crypto.createHmac('sha256', String(secret || '')).update(String(payload || ''), 'utf8').digest('hex');
}

function safeMeta(row) {
  return parseJsonOrFallback(row?.metadataJson || row?.metaJson, null);
}

function compareVersions(left, right) {
  const leftParts = String(left || '').trim().split('.').map((item) => Number(item || 0));
  const rightParts = String(right || '').trim().split('.').map((item) => Number(item || 0));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const l = Number.isFinite(leftParts[i]) ? leftParts[i] : 0;
    const r = Number.isFinite(rightParts[i]) ? rightParts[i] : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function getPlanCatalog() {
  return Array.isArray(config.platform?.billing?.plans)
    ? config.platform.billing.plans.map((plan) => ({
      id: trimText(plan.id, 80),
      name: trimText(plan.name, 160),
      type: trimText(plan.type, 40) || 'subscription',
      amountCents: asInt(plan.amountCents, 0, 0),
      billingCycle: normalizeBillingCycle(plan.billingCycle),
      intervalDays: asInt(plan.intervalDays, 30, 1),
      seats: asInt(plan.seats, 1, 1),
      features: Array.isArray(plan.features)
        ? plan.features.map((entry) => trimText(entry, 200)).filter(Boolean)
        : [],
    })).filter((plan) => plan.id && plan.name)
    : [];
}

function findPlanById(planId) {
  return getPlanCatalog().find((plan) => plan.id === String(planId || '').trim()) || null;
}

function maskSecret(value, visible = 6) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= visible) return text;
  return `${text.slice(0, visible)}***`;
}

function maskLicenseKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return text;
  return `${text.slice(0, 4)}-${text.slice(4, 8)}-****`;
}

function buildApiKeyScopes(scopes) {
  const allowed = new Set(PLATFORM_SCOPE_GROUPS.flatMap((group) => group.scopes));
  return Array.from(
    new Set((Array.isArray(scopes) ? scopes : [scopes])
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter((entry) => allowed.has(entry))),
  );
}

function sanitizeTenantRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: safeMeta(row),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function sanitizeSubscriptionRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: safeMeta(row),
    startedAt: toIso(row.startedAt),
    renewsAt: toIso(row.renewsAt),
    canceledAt: toIso(row.canceledAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function sanitizeLicenseRow(row, options = {}) {
  if (!row) return null;
  const exposeFullKey = options.exposeFullKey === true;
  return {
    ...row,
    licenseKey: exposeFullKey ? row.licenseKey : maskLicenseKey(row.licenseKey),
    metadata: safeMeta(row),
    issuedAt: toIso(row.issuedAt),
    expiresAt: toIso(row.expiresAt),
    legalAcceptedAt: toIso(row.legalAcceptedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function sanitizeApiKeyRow(row) {
  if (!row) return null;
  return {
    ...row,
    scopes: parseJsonOrFallback(row.scopesJson, []),
    keyHash: undefined,
    lastUsedAt: toIso(row.lastUsedAt),
    revokedAt: toIso(row.revokedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function sanitizeWebhookRow(row, options = {}) {
  if (!row) return null;
  const includeSecret = options.includeSecret === true;
  return {
    ...row,
    secretValue: includeSecret ? row.secretValue : maskSecret(row.secretValue),
    lastSuccessAt: toIso(row.lastSuccessAt),
    lastFailureAt: toIso(row.lastFailureAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function sanitizeAgentRow(row) {
  if (!row) return null;
  return {
    ...row,
    meta: safeMeta(row),
    lastSeenAt: toIso(row.lastSeenAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function sanitizeMarketplaceRow(row) {
  if (!row) return null;
  return {
    ...row,
    meta: safeMeta(row),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function dispatchPlatformWebhookEvent(eventType, payload = {}, options = {}) {
  const tenantId = trimText(options.tenantId, 120) || null;
  const endpoints = await prisma.platformWebhookEndpoint.findMany({
    where: {
      enabled: true,
      ...(tenantId ? { tenantId } : {}),
      OR: [
        { eventType: String(eventType || '').trim() || 'unknown' },
        { eventType: '*' },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  const body = JSON.stringify({
    eventType: String(eventType || 'platform.unknown'),
    deliveredAt: nowIso(),
    payload: payload && typeof payload === 'object' ? payload : {},
  });
  const results = [];
  for (const endpoint of endpoints) {
    const signature = hmacSha256(endpoint.secretValue, body);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(endpoint.targetUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-scum-platform-event': String(eventType || 'platform.unknown'),
          'x-scum-signature': `sha256=${signature}`,
        },
        body,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await prisma.platformWebhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          lastSuccessAt: new Date(),
          lastError: null,
        },
      });
      results.push({ id: endpoint.id, ok: true, status: res.status });
    } catch (error) {
      await prisma.platformWebhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          lastFailureAt: new Date(),
          lastError: trimText(error?.message || error, 400),
        },
      });
      publishAdminLiveUpdate('ops-alert', {
        source: 'platform-webhook',
        kind: 'platform-webhook-failed',
        tenantId: endpoint.tenantId,
        endpointId: endpoint.id,
        targetUrl: endpoint.targetUrl,
        eventType,
        error: trimText(error?.message || error, 240),
      });
      results.push({ id: endpoint.id, ok: false, error: trimText(error?.message || error, 400) });
    }
  }
  return results;
}

async function emitPlatformEvent(eventType, payload = {}, options = {}) {
  publishAdminLiveUpdate('platform-event', {
    eventType,
    source: 'platform-service',
    ...payload,
  });
  try {
    await dispatchPlatformWebhookEvent(eventType, payload, options);
  } catch (error) {
    console.error('[platform] webhook dispatch failed:', error.message);
  }
}

async function createTenant(input = {}, actor = 'system') {
  const id = trimText(input.id, 120) || createId('tenant');
  const slug = normalizeSlug(input.slug || input.name);
  const name = trimText(input.name, 180);
  if (!slug || !name) {
    return { ok: false, reason: 'invalid-tenant' };
  }
  const rowData = {
    slug,
    name,
    type: normalizeTenantType(input.type),
    status: normalizeStatus(input.status, ['active', 'trialing', 'paused', 'suspended', 'inactive']),
    locale: normalizeLocale(input.locale),
    ownerName: trimText(input.ownerName, 180) || null,
    ownerEmail: trimText(input.ownerEmail, 180) || null,
    parentTenantId: trimText(input.parentTenantId, 120) || null,
    metadataJson: stringifyMeta(input.metadata),
  };
  try {
    const row = await prisma.platformTenant.upsert({
      where: { id },
      update: rowData,
      create: {
        id,
        ...rowData,
      },
    });
    await emitPlatformEvent('platform.tenant.upserted', {
      tenantId: row.id,
      tenantSlug: row.slug,
      actor,
    }, { tenantId: row.id });
    return { ok: true, tenant: sanitizeTenantRow(row) };
  } catch (error) {
    if (error?.code === 'P2002') {
      return { ok: false, reason: 'tenant-slug-conflict' };
    }
    throw error;
  }
}

async function listPlatformTenants(options = {}) {
  const take = Math.max(1, Math.min(500, asInt(options.limit, 100, 1)));
  const where = {};
  if (options.status) where.status = normalizeStatus(options.status, ['active', 'trialing', 'paused', 'suspended', 'inactive']);
  if (options.type) where.type = normalizeTenantType(options.type);
  const rows = await prisma.platformTenant.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows.map(sanitizeTenantRow);
}

async function getPlatformTenantById(tenantId) {
  const id = trimText(tenantId, 120);
  if (!id) return null;
  const row = await prisma.platformTenant.findUnique({ where: { id } });
  return sanitizeTenantRow(row);
}

async function createSubscription(input = {}, actor = 'system') {
  const tenantId = trimText(input.tenantId, 120);
  if (!tenantId) return { ok: false, reason: 'tenant-required' };
  const tenant = await prisma.platformTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { ok: false, reason: 'tenant-not-found' };

  const plan = findPlanById(input.planId);
  const startedAt = parseDateOrNull(input.startedAt) || new Date();
  const cycle = normalizeBillingCycle(input.billingCycle || plan?.billingCycle);
  const intervalDays = asInt(
    input.intervalDays,
    plan?.intervalDays || (cycle === 'yearly' ? 365 : cycle === 'quarterly' ? 90 : cycle === 'trial' ? 14 : 30),
    1,
  );
  const renewsAt = parseDateOrNull(input.renewsAt) || new Date(startedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  const row = await prisma.platformSubscription.create({
    data: {
      id: trimText(input.id, 120) || createId('sub'),
      tenantId,
      planId: trimText(input.planId, 120) || plan?.id || 'custom',
      billingCycle: cycle,
      status: normalizeStatus(input.status, ['active', 'trialing', 'paused', 'past_due', 'canceled', 'expired']),
      currency: normalizeCurrency(input.currency || config.platform?.billing?.currency),
      amountCents: asInt(input.amountCents, plan?.amountCents || 0, 0),
      startedAt,
      renewsAt,
      canceledAt: parseDateOrNull(input.canceledAt),
      externalRef: trimText(input.externalRef, 180) || null,
      metadataJson: stringifyMeta(input.metadata),
    },
  });
  await emitPlatformEvent('platform.subscription.created', {
    tenantId,
    subscriptionId: row.id,
    planId: row.planId,
    actor,
  }, { tenantId });
  return { ok: true, subscription: sanitizeSubscriptionRow(row) };
}

async function listPlatformSubscriptions(options = {}) {
  const take = Math.max(1, Math.min(500, asInt(options.limit, 100, 1)));
  const where = {};
  if (options.tenantId) where.tenantId = trimText(options.tenantId, 120);
  if (options.status) where.status = normalizeStatus(options.status, ['active', 'trialing', 'paused', 'past_due', 'canceled', 'expired']);
  const rows = await prisma.platformSubscription.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows.map(sanitizeSubscriptionRow);
}

function generateLicenseKey() {
  const parts = [
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
  ];
  return parts.join('-').toUpperCase();
}

async function issuePlatformLicense(input = {}, actor = 'system') {
  const tenantId = trimText(input.tenantId, 120);
  if (!tenantId) return { ok: false, reason: 'tenant-required' };
  const tenant = await prisma.platformTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { ok: false, reason: 'tenant-not-found' };
  const legalVersion = trimText(
    input.legalDocVersion || config.platform?.legal?.currentVersion,
    80,
  ) || null;
  const row = await prisma.platformLicense.create({
    data: {
      id: trimText(input.id, 120) || createId('license'),
      tenantId,
      licenseKey: trimText(input.licenseKey, 80) || generateLicenseKey(),
      status: normalizeStatus(input.status, ['active', 'trialing', 'expired', 'revoked']),
      seats: asInt(input.seats, 1, 1),
      issuedAt: parseDateOrNull(input.issuedAt) || new Date(),
      expiresAt: parseDateOrNull(input.expiresAt),
      legalDocVersion: legalVersion,
      legalAcceptedAt: parseDateOrNull(input.legalAcceptedAt),
      metadataJson: stringifyMeta(input.metadata),
    },
  });
  await emitPlatformEvent('platform.license.issued', {
    tenantId,
    licenseId: row.id,
    actor,
  }, { tenantId });
  return { ok: true, license: sanitizeLicenseRow(row, { exposeFullKey: true }) };
}

async function acceptPlatformLicenseLegal(input = {}, actor = 'system') {
  const licenseId = trimText(input.licenseId, 120);
  if (!licenseId) return { ok: false, reason: 'license-required' };
  const row = await prisma.platformLicense.update({
    where: { id: licenseId },
    data: {
      legalDocVersion: trimText(input.legalDocVersion || config.platform?.legal?.currentVersion, 80) || null,
      legalAcceptedAt: new Date(),
      metadataJson: stringifyMeta({
        ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
        acceptedBy: actor,
      }),
    },
  }).catch((error) => (error?.code === 'P2025' ? null : Promise.reject(error)));
  if (!row) return { ok: false, reason: 'license-not-found' };
  await emitPlatformEvent('platform.license.legal.accepted', {
    tenantId: row.tenantId,
    licenseId: row.id,
    actor,
  }, { tenantId: row.tenantId });
  return { ok: true, license: sanitizeLicenseRow(row) };
}

async function listPlatformLicenses(options = {}) {
  const take = Math.max(1, Math.min(500, asInt(options.limit, 100, 1)));
  const where = {};
  if (options.tenantId) where.tenantId = trimText(options.tenantId, 120);
  if (options.status) where.status = normalizeStatus(options.status, ['active', 'trialing', 'expired', 'revoked']);
  const rows = await prisma.platformLicense.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows.map((row) => sanitizeLicenseRow(row));
}

function generateApiKey() {
  const prefix = `sk_${crypto.randomBytes(6).toString('hex')}`;
  const secret = crypto.randomBytes(24).toString('hex');
  return `${prefix}.${secret}`;
}

async function createPlatformApiKey(input = {}, actor = 'system') {
  const tenantId = trimText(input.tenantId, 120);
  const name = trimText(input.name, 160);
  if (!tenantId || !name) return { ok: false, reason: 'invalid-api-key' };
  const tenant = await prisma.platformTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { ok: false, reason: 'tenant-not-found' };
  const rawKey = generateApiKey();
  const scopes = buildApiKeyScopes(input.scopes);
  const row = await prisma.platformApiKey.create({
    data: {
      id: trimText(input.id, 120) || createId('apikey'),
      tenantId,
      name,
      keyPrefix: rawKey.slice(0, 16),
      keyHash: sha256(rawKey),
      scopesJson: JSON.stringify(scopes),
      status: normalizeStatus(input.status, ['active', 'revoked', 'disabled']),
    },
  });
  await emitPlatformEvent('platform.apikey.created', {
    tenantId,
    apiKeyId: row.id,
    actor,
  }, { tenantId });
  return {
    ok: true,
    apiKey: sanitizeApiKeyRow(row),
    rawKey,
  };
}

async function listPlatformApiKeys(options = {}) {
  const take = Math.max(1, Math.min(500, asInt(options.limit, 100, 1)));
  const where = {};
  if (options.tenantId) where.tenantId = trimText(options.tenantId, 120);
  if (options.status) where.status = normalizeStatus(options.status, ['active', 'revoked', 'disabled']);
  const rows = await prisma.platformApiKey.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows.map(sanitizeApiKeyRow);
}

async function verifyPlatformApiKey(rawKey, requiredScopes = []) {
  const key = trimText(rawKey, 500);
  if (!key) return { ok: false, reason: 'missing-api-key' };
  const keyPrefix = key.slice(0, 16);
  const rows = await prisma.platformApiKey.findMany({
    where: {
      keyPrefix,
      status: 'active',
      revokedAt: null,
    },
    take: 10,
  });
  const matched = rows.find((row) => sha256(key) === row.keyHash) || null;
  if (!matched) return { ok: false, reason: 'invalid-api-key' };
  const scopes = parseJsonOrFallback(matched.scopesJson, []);
  const missingScopes = buildApiKeyScopes(requiredScopes).filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    return { ok: false, reason: 'insufficient-scope', missingScopes };
  }
  await prisma.platformApiKey.update({
    where: { id: matched.id },
    data: {
      lastUsedAt: new Date(),
    },
  }).catch(() => null);
  const tenant = await prisma.platformTenant.findUnique({
    where: { id: matched.tenantId },
  });
  return {
    ok: true,
    apiKey: sanitizeApiKeyRow({
      ...matched,
      lastUsedAt: new Date(),
    }),
    tenant: sanitizeTenantRow(tenant),
    scopes,
  };
}

async function createPlatformWebhookEndpoint(input = {}, actor = 'system') {
  const tenantId = trimText(input.tenantId, 120);
  const name = trimText(input.name, 160);
  const targetUrl = trimText(input.targetUrl, 400);
  const eventType = trimText(input.eventType, 120) || '*';
  if (!tenantId || !name || !targetUrl) {
    return { ok: false, reason: 'invalid-webhook' };
  }
  try {
    new URL(targetUrl);
  } catch {
    return { ok: false, reason: 'invalid-webhook-url' };
  }
  const tenant = await prisma.platformTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { ok: false, reason: 'tenant-not-found' };
  const secretValue = trimText(input.secretValue, 200) || crypto.randomBytes(18).toString('hex');
  const row = await prisma.platformWebhookEndpoint.create({
    data: {
      id: trimText(input.id, 120) || createId('hook'),
      tenantId,
      name,
      eventType,
      targetUrl,
      secretValue,
      enabled: input.enabled !== false,
    },
  });
  await emitPlatformEvent('platform.webhook.created', {
    tenantId,
    webhookId: row.id,
    actor,
  }, { tenantId });
  return {
    ok: true,
    webhook: sanitizeWebhookRow(row, { includeSecret: true }),
  };
}

async function listPlatformWebhookEndpoints(options = {}) {
  const take = Math.max(1, Math.min(500, asInt(options.limit, 100, 1)));
  const where = {};
  if (options.tenantId) where.tenantId = trimText(options.tenantId, 120);
  if (options.eventType) where.eventType = trimText(options.eventType, 120);
  const rows = await prisma.platformWebhookEndpoint.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows.map((row) => sanitizeWebhookRow(row));
}

async function recordPlatformAgentHeartbeat(input = {}, actor = 'platform-api') {
  const tenantId = trimText(input.tenantId, 120);
  const runtimeKey = trimText(input.runtimeKey, 160);
  const version = trimText(input.version, 80);
  if (!tenantId || !runtimeKey || !version) {
    return { ok: false, reason: 'invalid-agent-heartbeat' };
  }
  const tenant = await prisma.platformTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { ok: false, reason: 'tenant-not-found' };
  const minimumVersion = trimText(
    input.minRequiredVersion || config.platform?.agent?.minimumVersion || '1.0.0',
    80,
  ) || '1.0.0';
  const status =
    compareVersions(version, minimumVersion) < 0
      ? 'outdated'
      : normalizeStatus(input.status, ['online', 'degraded', 'outdated', 'offline']);
  const row = await prisma.platformAgentRuntime.upsert({
    where: {
      tenantId_runtimeKey: {
        tenantId,
        runtimeKey,
      },
    },
    update: {
      channel: trimText(input.channel, 80) || null,
      version,
      minRequiredVersion: minimumVersion,
      status,
      lastSeenAt: new Date(),
      metaJson: stringifyMeta(input.meta),
    },
    create: {
      id: createId('agent'),
      tenantId,
      runtimeKey,
      channel: trimText(input.channel, 80) || null,
      version,
      minRequiredVersion: minimumVersion,
      status,
      lastSeenAt: new Date(),
      metaJson: stringifyMeta(input.meta),
    },
  });
  if (status === 'outdated') {
    publishAdminLiveUpdate('ops-alert', {
      source: 'platform-agent',
      kind: 'agent-version-outdated',
      tenantId,
      runtimeKey,
      version,
      minimumVersion,
    });
  }
  await emitPlatformEvent('platform.agent.heartbeat', {
    tenantId,
    runtimeKey,
    version,
    status,
    actor,
  }, { tenantId });
  return { ok: true, runtime: sanitizeAgentRow(row) };
}

async function listPlatformAgentRuntimes(options = {}) {
  const take = Math.max(1, Math.min(500, asInt(options.limit, 100, 1)));
  const where = {};
  if (options.tenantId) where.tenantId = trimText(options.tenantId, 120);
  if (options.status) where.status = normalizeStatus(options.status, ['online', 'degraded', 'outdated', 'offline']);
  const rows = await prisma.platformAgentRuntime.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows.map(sanitizeAgentRow);
}

async function createMarketplaceOffer(input = {}, actor = 'system') {
  const tenantId = trimText(input.tenantId, 120);
  const title = trimText(input.title, 180);
  if (!tenantId || !title) return { ok: false, reason: 'invalid-marketplace-offer' };
  const tenant = await prisma.platformTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { ok: false, reason: 'tenant-not-found' };
  const row = await prisma.platformMarketplaceOffer.create({
    data: {
      id: trimText(input.id, 120) || createId('offer'),
      tenantId,
      title,
      kind: trimText(input.kind, 80) || 'service',
      priceCents: asInt(input.priceCents, 0, 0),
      currency: normalizeCurrency(input.currency),
      status: normalizeStatus(input.status, ['active', 'draft', 'archived']),
      locale: normalizeLocale(input.locale),
      metaJson: stringifyMeta(input.meta),
    },
  });
  await emitPlatformEvent('platform.marketplace.offer.created', {
    tenantId,
    offerId: row.id,
    actor,
  }, { tenantId });
  return { ok: true, offer: sanitizeMarketplaceRow(row) };
}

async function listMarketplaceOffers(options = {}) {
  const take = Math.max(1, Math.min(500, asInt(options.limit, 100, 1)));
  const where = {};
  if (options.tenantId) where.tenantId = trimText(options.tenantId, 120);
  if (options.status) where.status = normalizeStatus(options.status, ['active', 'draft', 'archived']);
  if (options.locale) where.locale = normalizeLocale(options.locale);
  const rows = await prisma.platformMarketplaceOffer.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows.map(sanitizeMarketplaceRow);
}

async function getPlatformAnalyticsOverview() {
  const [
    tenantRows,
    subscriptionRows,
    licenseRows,
    apiKeyRows,
    webhookRows,
    agentRows,
    offerRows,
    purchaseRows,
  ] = await Promise.all([
    prisma.platformTenant.findMany(),
    prisma.platformSubscription.findMany(),
    prisma.platformLicense.findMany(),
    prisma.platformApiKey.findMany(),
    prisma.platformWebhookEndpoint.findMany(),
    prisma.platformAgentRuntime.findMany(),
    prisma.platformMarketplaceOffer.findMany(),
    prisma.purchase.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  const mrrCents = subscriptionRows
    .filter((row) => row.status === 'active' || row.status === 'trialing')
    .reduce((sum, row) => {
      if (row.billingCycle === 'yearly') return sum + Math.round(row.amountCents / 12);
      if (row.billingCycle === 'quarterly') return sum + Math.round(row.amountCents / 3);
      if (row.billingCycle === 'one-time' || row.billingCycle === 'trial') return sum;
      return sum + row.amountCents;
    }, 0);

  const deliveredCount = purchaseRows.filter((row) => row.status === 'delivered').length;
  const failedCount = purchaseRows.filter((row) => row.status === 'delivery_failed').length;
  const successRate = purchaseRows.length > 0
    ? Number((deliveredCount / purchaseRows.length).toFixed(4))
    : 0;

  return {
    generatedAt: nowIso(),
    tenants: {
      total: tenantRows.length,
      active: tenantRows.filter((row) => row.status === 'active').length,
      trialing: tenantRows.filter((row) => row.type === 'trial' || row.status === 'trialing').length,
      reseller: tenantRows.filter((row) => row.type === 'reseller').length,
    },
    subscriptions: {
      total: subscriptionRows.length,
      active: subscriptionRows.filter((row) => row.status === 'active').length,
      mrrCents,
    },
    licenses: {
      total: licenseRows.length,
      active: licenseRows.filter((row) => row.status === 'active').length,
      acceptedLegal: licenseRows.filter((row) => row.legalAcceptedAt).length,
    },
    api: {
      apiKeys: apiKeyRows.filter((row) => row.status === 'active').length,
      webhooks: webhookRows.filter((row) => row.enabled).length,
    },
    agent: {
      runtimes: agentRows.length,
      outdated: agentRows.filter((row) => row.status === 'outdated').length,
    },
    marketplace: {
      offers: offerRows.filter((row) => row.status === 'active').length,
      draftOffers: offerRows.filter((row) => row.status === 'draft').length,
    },
    delivery: {
      purchaseCount30d: purchaseRows.length,
      deliveredCount,
      failedCount,
      successRate,
    },
  };
}

async function reconcileDeliveryState(options = {}) {
  const antiAbuse = config.platform?.antiAbuse || {};
  const windowMs = asInt(options.windowMs, antiAbuse.windowMs || (60 * 60 * 1000), 60 * 1000);
  const pendingOverdueMs = asInt(options.pendingOverdueMs, antiAbuse.pendingOverdueMs || (20 * 60 * 1000), 60 * 1000);
  const since = new Date(Date.now() - windowMs);

  const [purchases, queueJobs, deadLetters, auditRows] = await Promise.all([
    prisma.purchase.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.deliveryQueueJob.findMany(),
    prisma.deliveryDeadLetter.findMany(),
    prisma.deliveryAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2000,
    }),
  ]);

  const queueByCode = new Map(queueJobs.map((row) => [String(row.purchaseCode), row]));
  const deadByCode = new Map(deadLetters.map((row) => [String(row.purchaseCode), row]));
  const auditByCode = new Map();
  for (const row of auditRows) {
    const code = trimText(row.purchaseCode, 120);
    if (!code) continue;
    const list = auditByCode.get(code) || [];
    list.push(row);
    auditByCode.set(code, list);
  }

  const anomalies = [];
  for (const purchase of purchases) {
    const code = String(purchase.code || '');
    const queue = queueByCode.get(code) || null;
    const dead = deadByCode.get(code) || null;
    const audit = auditByCode.get(code) || [];
    const ageMs = Date.now() - new Date(purchase.createdAt).getTime();

    if (purchase.status === 'delivered' && queue) {
      anomalies.push({ code, type: 'delivered-still-queued', severity: 'error', detail: 'Purchase is delivered but queue job still exists' });
    }
    if (purchase.status === 'delivery_failed' && !dead) {
      anomalies.push({ code, type: 'failed-without-dead-letter', severity: 'warn', detail: 'Purchase is marked failed but no dead-letter record exists' });
    }
    if ((purchase.status === 'pending' || purchase.status === 'delivering') && !queue && !dead && ageMs >= pendingOverdueMs) {
      anomalies.push({ code, type: 'stuck-without-runtime-state', severity: 'error', detail: 'Pending purchase has neither queue nor dead-letter state' });
    }
    if (purchase.status === 'delivered' && audit.length === 0) {
      anomalies.push({ code, type: 'delivered-without-audit', severity: 'warn', detail: 'Delivered purchase has no delivery audit evidence' });
    }
  }

  const recentPurchases = purchases.filter((row) => new Date(row.createdAt) >= since);
  const ordersByUser = new Map();
  const userItemCounts = new Map();
  const failedByUser = new Map();
  for (const row of recentPurchases) {
    const userId = trimText(row.userId, 80) || 'unknown';
    ordersByUser.set(userId, (ordersByUser.get(userId) || 0) + 1);
    const itemKey = `${userId}:${trimText(row.itemId, 120) || 'unknown'}`;
    userItemCounts.set(itemKey, (userItemCounts.get(itemKey) || 0) + 1);
    if (row.status === 'delivery_failed') {
      failedByUser.set(userId, (failedByUser.get(userId) || 0) + 1);
    }
  }

  const abuseFindings = [];
  const maxOrdersPerUser = asInt(antiAbuse.maxOrdersPerUser, 8, 1);
  const maxSameItemPerUser = asInt(antiAbuse.maxSameItemPerUser, 4, 1);
  const failedDeliveriesThreshold = asInt(antiAbuse.failedDeliveriesThreshold, 3, 1);

  for (const [userId, count] of ordersByUser.entries()) {
    if (count > maxOrdersPerUser) {
      abuseFindings.push({ type: 'order-burst', userId, count, threshold: maxOrdersPerUser });
    }
  }
  for (const [key, count] of userItemCounts.entries()) {
    if (count > maxSameItemPerUser) {
      const [userId, itemId] = key.split(':');
      abuseFindings.push({ type: 'same-item-burst', userId, itemId, count, threshold: maxSameItemPerUser });
    }
  }
  for (const [userId, count] of failedByUser.entries()) {
    if (count >= failedDeliveriesThreshold) {
      abuseFindings.push({ type: 'repeated-delivery-failures', userId, count, threshold: failedDeliveriesThreshold });
    }
  }

  return {
    generatedAt: nowIso(),
    summary: {
      purchases: purchases.length,
      queueJobs: queueJobs.length,
      deadLetters: deadLetters.length,
      anomalies: anomalies.length,
      abuseFindings: abuseFindings.length,
      windowMs,
    },
    anomalies,
    abuseFindings,
  };
}

async function getPlatformPublicOverview() {
  const analytics = await getPlatformAnalyticsOverview();
  const legalDocs = Array.isArray(config.platform?.legal?.docs)
    ? config.platform.legal.docs.map((doc) => {
      const pathValue = trimText(doc.path, 260) || null;
      const fileName = pathValue ? pathValue.split(/[\\/]/).pop() : null;
      return {
        id: trimText(doc.id, 80) || null,
        version: trimText(doc.version, 80) || null,
        title: trimText(doc.title, 180) || fileName || 'Document',
        path: pathValue,
        url: trimText(doc.url, 260) || (fileName ? `/docs/${fileName}` : null),
      };
    })
    : [];
  return {
    generatedAt: nowIso(),
    brand: {
      name: config.serverInfo?.name || 'SCUM Ops Platform',
      description:
        'SCUM platform with delivery runtime, admin control plane, player portal, monitoring, API/webhooks, and tenant-ready operations.',
    },
    localization: config.platform?.localization || {},
    billing: {
      currency: config.platform?.billing?.currency || 'THB',
      plans: getPlanCatalog(),
    },
    trial: config.platform?.demo?.trialEnabled === true ? { enabled: true, cta: '/trial' } : { enabled: false },
    marketplace: {
      enabled: config.platform?.marketplace?.enabled === true,
      offers: await listMarketplaceOffers({ status: 'active', limit: 20 }),
    },
    analytics,
    legal: {
      currentVersion: config.platform?.legal?.currentVersion || null,
      docs: legalDocs,
    },
  };
}

function getPlatformPermissionCatalog() {
  return PLATFORM_SCOPE_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    scopes: [...group.scopes],
  }));
}

module.exports = {
  acceptPlatformLicenseLegal,
  compareVersions,
  createMarketplaceOffer,
  createPlatformApiKey,
  createPlatformWebhookEndpoint,
  createSubscription,
  createTenant,
  dispatchPlatformWebhookEvent,
  getPlanCatalog,
  getPlatformAnalyticsOverview,
  getPlatformPermissionCatalog,
  getPlatformPublicOverview,
  getPlatformTenantById,
  issuePlatformLicense,
  listMarketplaceOffers,
  listPlatformAgentRuntimes,
  listPlatformApiKeys,
  listPlatformLicenses,
  listPlatformSubscriptions,
  listPlatformTenants,
  listPlatformWebhookEndpoints,
  recordPlatformAgentHeartbeat,
  reconcileDeliveryState,
  verifyPlatformApiKey,
};
