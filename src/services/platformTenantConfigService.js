'use strict';

const { prisma } = require('../prisma');
const { resolveDatabaseRuntime } = require('../utils/dbEngine');

let ensurePromise = null;

function getDatabaseEngine() {
  const runtime = resolveDatabaseRuntime();
  return runtime.engine === 'unsupported' ? 'sqlite' : runtime.engine;
}

function parseJsonObject(value) {
  if (value == null || String(value).trim() === '') return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    tenantId: String(row.tenantId || '').trim(),
    configPatch: parseJsonObject(row.configPatchJson),
    portalEnvPatch: parseJsonObject(row.portalEnvPatchJson),
    featureFlags: parseJsonObject(row.featureFlagsJson),
    updatedBy: String(row.updatedBy || '').trim() || null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

async function ensurePlatformTenantConfigTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const engine = getDatabaseEngine();
    if (engine === 'postgresql') {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS platform_tenant_configs (
          tenant_id TEXT PRIMARY KEY,
          config_patch_json TEXT,
          portal_env_patch_json TEXT,
          feature_flags_json TEXT,
          updated_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS platform_tenant_configs (
          tenant_id TEXT PRIMARY KEY,
          config_patch_json TEXT,
          portal_env_patch_json TEXT,
          feature_flags_json TEXT,
          updated_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

async function getPlatformTenantConfig(tenantId) {
  const id = String(tenantId || '').trim();
  if (!id) return null;
  await ensurePlatformTenantConfigTable();
  const rows = await prisma.$queryRaw`
    SELECT
      tenant_id AS "tenantId",
      config_patch_json AS "configPatchJson",
      portal_env_patch_json AS "portalEnvPatchJson",
      feature_flags_json AS "featureFlagsJson",
      updated_by AS "updatedBy",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM platform_tenant_configs
    WHERE tenant_id = ${id}
    LIMIT 1
  `;
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return normalizeRow(row);
}

async function listPlatformTenantConfigs(options = {}) {
  await ensurePlatformTenantConfigTable();
  const tenantId = String(options.tenantId || '').trim();
  const limit = Math.max(1, Math.min(500, Number(options.limit || 200) || 200));
  let rows = await prisma.$queryRaw`
    SELECT
      tenant_id AS "tenantId",
      config_patch_json AS "configPatchJson",
      portal_env_patch_json AS "portalEnvPatchJson",
      feature_flags_json AS "featureFlagsJson",
      updated_by AS "updatedBy",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM platform_tenant_configs
    ORDER BY tenant_id ASC
    LIMIT ${limit}
  `;
  if (!Array.isArray(rows)) rows = [];
  const normalized = rows.map(normalizeRow).filter(Boolean);
  if (!tenantId) return normalized;
  return normalized.filter((row) => row.tenantId === tenantId);
}

async function upsertPlatformTenantConfig(input = {}) {
  const tenantId = String(input.tenantId || '').trim();
  if (!tenantId) return { ok: false, reason: 'tenant-required' };
  await ensurePlatformTenantConfigTable();
  const configPatch = input.configPatch && typeof input.configPatch === 'object' && !Array.isArray(input.configPatch)
    ? input.configPatch
    : {};
  const portalEnvPatch = input.portalEnvPatch && typeof input.portalEnvPatch === 'object' && !Array.isArray(input.portalEnvPatch)
    ? input.portalEnvPatch
    : {};
  const featureFlags = input.featureFlags && typeof input.featureFlags === 'object' && !Array.isArray(input.featureFlags)
    ? input.featureFlags
    : {};
  const updatedBy = String(input.updatedBy || '').trim() || null;
  await prisma.$executeRaw`
    INSERT INTO platform_tenant_configs (
      tenant_id,
      config_patch_json,
      portal_env_patch_json,
      feature_flags_json,
      updated_by,
      created_at,
      updated_at
    )
    VALUES (
      ${tenantId},
      ${JSON.stringify(configPatch)},
      ${JSON.stringify(portalEnvPatch)},
      ${JSON.stringify(featureFlags)},
      ${updatedBy},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (tenant_id)
    DO UPDATE SET
      config_patch_json = EXCLUDED.config_patch_json,
      portal_env_patch_json = EXCLUDED.portal_env_patch_json,
      feature_flags_json = EXCLUDED.feature_flags_json,
      updated_by = EXCLUDED.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `;
  return {
    ok: true,
    data: await getPlatformTenantConfig(tenantId),
  };
}

module.exports = {
  ensurePlatformTenantConfigTable,
  getPlatformTenantConfig,
  listPlatformTenantConfigs,
  upsertPlatformTenantConfig,
};
