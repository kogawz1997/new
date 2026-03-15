'use strict';

const ROLE_ORDER = Object.freeze({
  mod: 1,
  admin: 2,
  owner: 3,
});

const POST_PERMISSION_MATRIX = Object.freeze([
  {
    path: '/admin/api/auth/session/revoke',
    permission: 'auth:session-revoke',
    category: 'auth',
    minRole: 'owner',
    stepUp: true,
    description: 'Revoke admin sessions',
  },
  {
    path: '/admin/api/config/patch',
    permission: 'config:patch',
    category: 'config',
    minRole: 'admin',
    stepUp: true,
    description: 'Patch runtime config',
  },
  {
    path: '/admin/api/config/set',
    permission: 'config:set',
    category: 'config',
    minRole: 'owner',
    stepUp: true,
    description: 'Replace full runtime config',
  },
  {
    path: '/admin/api/config/reset',
    permission: 'config:reset',
    category: 'config',
    minRole: 'owner',
    stepUp: true,
    description: 'Reset runtime config to defaults',
  },
  {
    path: '/admin/api/control-panel/env',
    permission: 'env:write',
    category: 'config',
    minRole: 'owner',
    stepUp: true,
    description: 'Update environment-backed control panel settings',
  },
  {
    path: '/admin/api/auth/user',
    permission: 'auth:user-write',
    category: 'auth',
    minRole: 'owner',
    stepUp: true,
    description: 'Create or update admin users',
  },
  {
    path: '/admin/api/welcome/clear',
    permission: 'welcome:clear',
    category: 'player-ops',
    minRole: 'owner',
    stepUp: true,
    description: 'Clear welcome pack claim history',
  },
  {
    path: '/admin/api/rentbike/reset-now',
    permission: 'rentbike:reset',
    category: 'runtime',
    minRole: 'owner',
    stepUp: true,
    description: 'Force rent bike midnight reset',
  },
  {
    path: '/admin/api/backup/create',
    permission: 'backup:create',
    category: 'backup',
    minRole: 'owner',
    stepUp: true,
    description: 'Create full admin backup',
  },
  {
    path: '/admin/api/backup/restore',
    permission: 'backup:restore',
    category: 'backup',
    minRole: 'owner',
    stepUp: true,
    description: 'Restore full admin backup',
  },
  {
    path: '/admin/api/delivery/retry-many',
    permission: 'delivery:retry-bulk',
    category: 'delivery',
    minRole: 'admin',
    stepUp: true,
    description: 'Retry multiple delivery queue jobs',
  },
  {
    path: '/admin/api/delivery/dead-letter/retry-many',
    permission: 'delivery:dead-letter-retry-bulk',
    category: 'delivery',
    minRole: 'admin',
    stepUp: true,
    description: 'Requeue multiple dead letters',
  },
  {
    path: '/admin/api/platform/tenant',
    permission: 'platform:tenant-write',
    category: 'platform',
    minRole: 'owner',
    stepUp: true,
    description: 'Create or update tenant metadata',
  },
  {
    path: '/admin/api/platform/subscription',
    permission: 'platform:subscription-write',
    category: 'platform',
    minRole: 'owner',
    stepUp: true,
    description: 'Create or update subscriptions',
  },
  {
    path: '/admin/api/platform/license',
    permission: 'platform:license-write',
    category: 'platform',
    minRole: 'owner',
    stepUp: true,
    description: 'Issue or revoke tenant licenses',
  },
  {
    path: '/admin/api/platform/license/accept-legal',
    permission: 'platform:legal-accept',
    category: 'platform',
    minRole: 'owner',
    stepUp: true,
    description: 'Accept platform legal documents',
  },
  {
    path: '/admin/api/platform/apikey',
    permission: 'platform:apikey-write',
    category: 'platform',
    minRole: 'owner',
    stepUp: true,
    description: 'Create platform API keys',
  },
  {
    path: '/admin/api/platform/webhook',
    permission: 'platform:webhook-write',
    category: 'platform',
    minRole: 'owner',
    stepUp: true,
    description: 'Create platform webhooks',
  },
  {
    path: '/admin/api/platform/marketplace',
    permission: 'platform:marketplace-write',
    category: 'platform',
    minRole: 'owner',
    stepUp: true,
    description: 'Create marketplace offers',
  },
  {
    path: '/admin/api/ticket/claim',
    permission: 'ticket:claim',
    category: 'support',
    minRole: 'mod',
    stepUp: false,
    description: 'Claim support tickets',
  },
  {
    path: '/admin/api/ticket/close',
    permission: 'ticket:close',
    category: 'support',
    minRole: 'mod',
    stepUp: false,
    description: 'Close support tickets',
  },
  {
    path: '/admin/api/moderation/add',
    permission: 'moderation:write',
    category: 'moderation',
    minRole: 'mod',
    stepUp: false,
    description: 'Create punishment entries',
  },
  {
    path: '/admin/api/stats/add-kill',
    permission: 'stats:write-kill',
    category: 'stats',
    minRole: 'mod',
    stepUp: false,
    description: 'Add kill stats manually',
  },
  {
    path: '/admin/api/stats/add-death',
    permission: 'stats:write-death',
    category: 'stats',
    minRole: 'mod',
    stepUp: false,
    description: 'Add death stats manually',
  },
  {
    path: '/admin/api/stats/add-playtime',
    permission: 'stats:write-playtime',
    category: 'stats',
    minRole: 'mod',
    stepUp: false,
    description: 'Add playtime manually',
  },
  {
    path: '/admin/api/scum/status',
    permission: 'scum-status:write',
    category: 'runtime',
    minRole: 'mod',
    stepUp: false,
    description: 'Update SCUM runtime status',
  },
  {
    path: '/admin/api/platform/reconcile',
    permission: 'platform:reconcile',
    category: 'platform',
    minRole: 'mod',
    stepUp: false,
    description: 'Run delivery reconcile',
  },
  {
    path: '/admin/api/platform/monitoring/run',
    permission: 'platform:monitoring-run',
    category: 'platform',
    minRole: 'mod',
    stepUp: false,
    description: 'Run monitoring cycle manually',
  },
]);

const POST_PERMISSION_INDEX = new Map(
  POST_PERMISSION_MATRIX.map((entry) => [entry.path, Object.freeze({ ...entry })]),
);

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'owner' || value === 'admin' || value === 'mod') return value;
  return 'mod';
}

function hasRoleAtLeast(role, minRole) {
  return (ROLE_ORDER[normalizeRole(role)] || 0) >= (ROLE_ORDER[normalizeRole(minRole)] || 0);
}

function getAdminPermissionForPath(pathname, method = 'POST') {
  const normalizedMethod = String(method || 'POST').trim().toUpperCase();
  const normalizedPath = String(pathname || '').trim();
  if (normalizedMethod !== 'POST') return null;
  if (POST_PERMISSION_INDEX.has(normalizedPath)) {
    return POST_PERMISSION_INDEX.get(normalizedPath);
  }
  if (!normalizedPath.startsWith('/admin/api/')) return null;
  return {
    path: normalizedPath,
    permission: 'admin:write-generic',
    category: 'general',
    minRole: 'admin',
    stepUp: false,
    description: 'Generic admin mutation',
  };
}

function listAdminPermissionMatrix() {
  return POST_PERMISSION_MATRIX.map((entry) => ({ ...entry }));
}

function buildRoleMatrix() {
  const roles = ['mod', 'admin', 'owner'];
  return roles.map((role) => ({
    role,
    permissions: POST_PERMISSION_MATRIX
      .filter((entry) => hasRoleAtLeast(role, entry.minRole))
      .map((entry) => ({
        permission: entry.permission,
        path: entry.path,
        category: entry.category,
        stepUp: entry.stepUp === true,
      })),
  }));
}

function getAdminPermissionMatrixSummary() {
  const entries = POST_PERMISSION_MATRIX;
  return {
    totalPermissions: entries.length,
    stepUpPermissions: entries.filter((entry) => entry.stepUp === true).length,
    categories: Array.from(new Set(entries.map((entry) => entry.category))).sort(),
    roles: buildRoleMatrix().map((entry) => ({
      role: entry.role,
      permissionCount: entry.permissions.length,
      stepUpPermissionCount: entry.permissions.filter((permission) => permission.stepUp).length,
    })),
  };
}

module.exports = {
  buildRoleMatrix,
  getAdminPermissionForPath,
  getAdminPermissionMatrixSummary,
  hasRoleAtLeast,
  listAdminPermissionMatrix,
  normalizeRole,
  ROLE_ORDER,
};
