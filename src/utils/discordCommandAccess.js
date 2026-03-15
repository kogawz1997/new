'use strict';

const { PermissionFlagsBits } = require('discord.js');

const ROLE_LEVEL = Object.freeze({
  public: 0,
  mod: 1,
  admin: 2,
  owner: 3,
});

function normalizeCommandAccessRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'owner' || value === 'admin' || value === 'mod') {
    return value;
  }
  return 'public';
}

function hasCommandAccessAtLeast(actualRole, requiredRole) {
  return (ROLE_LEVEL[normalizeCommandAccessRole(actualRole)] || 0)
    >= (ROLE_LEVEL[normalizeCommandAccessRole(requiredRole)] || 0);
}

function getConfiguredRoleTargets(configRoles = {}, key) {
  const rawValue = configRoles && typeof configRoles === 'object'
    ? configRoles[key]
    : '';
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  const text = String(rawValue || '').trim();
  return text ? [text] : [];
}

function listMemberRoles(member) {
  const cache = member?.roles?.cache;
  if (!cache || typeof cache.values !== 'function') {
    return [];
  }
  return Array.from(cache.values());
}

function memberHasConfiguredRole(member, targets = []) {
  if (!targets.length) return false;
  const normalizedTargets = new Set(
    targets
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (!normalizedTargets.size) return false;
  return listMemberRoles(member).some((role) => {
    const roleId = String(role?.id || '').trim().toLowerCase();
    const roleName = String(role?.name || '').trim().toLowerCase();
    return normalizedTargets.has(roleId) || normalizedTargets.has(roleName);
  });
}

function getMemberCommandAccessRole(interactionLike, configRoles = {}) {
  const member = interactionLike?.member || null;
  if (memberHasConfiguredRole(member, getConfiguredRoleTargets(configRoles, 'owner'))) {
    return 'owner';
  }
  if (memberHasConfiguredRole(member, getConfiguredRoleTargets(configRoles, 'admin'))) {
    return 'admin';
  }
  if (memberHasConfiguredRole(member, getConfiguredRoleTargets(configRoles, 'moderator'))) {
    return 'mod';
  }

  const memberPermissions = interactionLike?.memberPermissions;
  if (memberPermissions?.has?.(PermissionFlagsBits.Administrator)) {
    return 'admin';
  }
  if (memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
    return 'admin';
  }
  if (memberPermissions?.has?.(PermissionFlagsBits.ModerateMembers)) {
    return 'mod';
  }
  return 'public';
}

function getRequiredCommandAccessRole(commandName, commandConfig = {}) {
  const normalizedName = String(commandName || '').trim();
  const permissions =
    commandConfig && typeof commandConfig === 'object' && commandConfig.permissions
      ? commandConfig.permissions
      : {};
  return normalizeCommandAccessRole(permissions?.[normalizedName] || 'public');
}

module.exports = {
  normalizeCommandAccessRole,
  hasCommandAccessAtLeast,
  getMemberCommandAccessRole,
  getRequiredCommandAccessRole,
};
