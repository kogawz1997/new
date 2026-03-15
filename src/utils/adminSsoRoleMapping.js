'use strict';

function envBool(value, fallback = false) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeAdminRole(value, fallback = 'mod') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'owner' || raw === 'admin' || raw === 'mod') return raw;
  return fallback;
}

function parseCsvRoleIds(value) {
  const seen = new Set();
  const out = [];
  for (const part of String(value || '').split(',')) {
    const normalized = String(part || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function getAdminSsoRoleMappingSummary(env = process.env) {
  const ownerRoleIds = parseCsvRoleIds(env.ADMIN_WEB_SSO_DISCORD_OWNER_ROLE_IDS);
  const adminRoleIds = parseCsvRoleIds(env.ADMIN_WEB_SSO_DISCORD_ADMIN_ROLE_IDS);
  const modRoleIds = parseCsvRoleIds(env.ADMIN_WEB_SSO_DISCORD_MOD_ROLE_IDS);
  const totalMappedRoleIds = ownerRoleIds.length + adminRoleIds.length + modRoleIds.length;

  return {
    enabled: envBool(env.ADMIN_WEB_SSO_DISCORD_ENABLED, false),
    defaultRole: normalizeAdminRole(env.ADMIN_WEB_SSO_DEFAULT_ROLE || 'mod'),
    ownerRoleIds,
    adminRoleIds,
    modRoleIds,
    totalMappedRoleIds,
    hasExplicitMappings: totalMappedRoleIds > 0,
    hasElevatedMappings: ownerRoleIds.length > 0 || adminRoleIds.length > 0,
  };
}

function normalizeRoleName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseRoleNameRequests(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function selectDiscordRoleIdsByName(roles = [], requestedNames = []) {
  const names = parseRoleNameRequests(requestedNames);
  if (names.length === 0) return [];

  return names.map((name) => {
    const normalized = normalizeRoleName(name);
    const exactMatches = roles.filter(
      (role) => normalizeRoleName(role?.name) === normalized,
    );
    if (exactMatches.length === 1) {
      return String(exactMatches[0].id || '').trim();
    }
    if (exactMatches.length > 1) {
      throw new Error(`Ambiguous Discord role name: ${name}`);
    }

    const containsMatches = roles.filter(
      (role) => normalizeRoleName(role?.name).includes(normalized),
    );
    if (containsMatches.length === 1) {
      return String(containsMatches[0].id || '').trim();
    }
    if (containsMatches.length > 1) {
      throw new Error(`Discord role lookup matched multiple roles: ${name}`);
    }
    throw new Error(`Discord role not found: ${name}`);
  });
}

function buildAdminSsoRoleMappingEnvLines(roles = [], mappingRequests = {}) {
  const ownerRoleIds = selectDiscordRoleIdsByName(roles, mappingRequests.owner);
  const adminRoleIds = selectDiscordRoleIdsByName(roles, mappingRequests.admin);
  const modRoleIds = selectDiscordRoleIdsByName(roles, mappingRequests.mod);

  return {
    ownerRoleIds,
    adminRoleIds,
    modRoleIds,
    envLines: [
      `ADMIN_WEB_SSO_DISCORD_OWNER_ROLE_IDS=${ownerRoleIds.join(',')}`,
      `ADMIN_WEB_SSO_DISCORD_ADMIN_ROLE_IDS=${adminRoleIds.join(',')}`,
      `ADMIN_WEB_SSO_DISCORD_MOD_ROLE_IDS=${modRoleIds.join(',')}`,
    ],
  };
}

module.exports = {
  buildAdminSsoRoleMappingEnvLines,
  getAdminSsoRoleMappingSummary,
  normalizeAdminRole,
  parseCsvRoleIds,
  parseRoleNameRequests,
  selectDiscordRoleIdsByName,
};
