'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_ENV_PATH = path.resolve(process.cwd(), '.env');
const PORTAL_ENV_PATH = path.resolve(
  process.cwd(),
  'apps',
  'web-portal-standalone',
  '.env',
);

function parseArgs(argv) {
  const out = {
    write: false,
    forceDiscordPlaceholder: false,
    discordToken: '',
    portalDiscordClientSecret: '',
    adminSsoDiscordClientSecret: '',
    adminOrigin: '',
    playerOrigin: '',
    adminPath: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--write') {
      out.write = true;
      continue;
    }
    if (token === '--force-discord-placeholder') {
      out.forceDiscordPlaceholder = true;
      continue;
    }
    if (token.startsWith('--discord-token=')) {
      out.discordToken = token.slice('--discord-token='.length);
      continue;
    }
    if (token.startsWith('--portal-discord-secret=')) {
      out.portalDiscordClientSecret = token.slice(
        '--portal-discord-secret='.length,
      );
      continue;
    }
    if (token.startsWith('--admin-sso-discord-secret=')) {
      out.adminSsoDiscordClientSecret = token.slice(
        '--admin-sso-discord-secret='.length,
      );
      continue;
    }
    if (token.startsWith('--admin-origin=')) {
      out.adminOrigin = token.slice('--admin-origin='.length);
      continue;
    }
    if (token.startsWith('--player-origin=')) {
      out.playerOrigin = token.slice('--player-origin='.length);
      continue;
    }
    if (token.startsWith('--admin-path=')) {
      out.adminPath = token.slice('--admin-path='.length);
      continue;
    }
    if (token === '--discord-token' && argv[i + 1]) {
      out.discordToken = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--portal-discord-secret' && argv[i + 1]) {
      out.portalDiscordClientSecret = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--admin-sso-discord-secret' && argv[i + 1]) {
      out.adminSsoDiscordClientSecret = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--admin-origin' && argv[i + 1]) {
      out.adminOrigin = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--player-origin' && argv[i + 1]) {
      out.playerOrigin = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--admin-path' && argv[i + 1]) {
      out.adminPath = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`env file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split(/\r?\n/);
}

function isEnvPair(line) {
  return /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line);
}

function setEnvValue(lines, key, value) {
  const prefix = `${key}=`;
  const index = lines.findIndex((line) => {
    if (!isEnvPair(line)) return false;
    const left = line.split('=')[0].trim();
    return left === key;
  });
  if (index >= 0) {
    lines[index] = `${prefix}${value}`;
  } else {
    lines.push(`${prefix}${value}`);
  }
}

function getEnvValue(lines, key) {
  const row = lines.find((line) => {
    if (!isEnvPair(line)) return false;
    return line.split('=')[0].trim() === key;
  });
  if (!row) return '';
  const index = row.indexOf('=');
  if (index < 0) return '';
  return row.slice(index + 1).trim();
}

function isLikelyPlaceholder(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  const patterns = [
    'your_',
    'example',
    'changeme',
    'replace',
    'rotate_in_',
    'rotate_me',
    'token_here',
    'password_here',
    'put_a_',
    'placeholder',
    'xxx',
  ];
  return patterns.some((pattern) => text.includes(pattern));
}

function tryParseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed;
    }
  } catch {}
  return null;
}

function parseFirstOriginListItem(value) {
  for (const token of String(value || '').split(',')) {
    const parsed = tryParseUrl(token);
    if (parsed) return parsed;
  }
  return null;
}

function normalizePathSegment(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  let normalized = text.startsWith('/') ? text : `/${text}`;
  normalized = normalized.replace(/\/+/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized || fallback;
}

function isIpLikeHost(hostname) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
}

function deriveCookieDomain(origin) {
  if (!origin || !origin.hostname) return '';
  const hostname = origin.hostname.trim().toLowerCase();
  if (!hostname || hostname === 'localhost' || isIpLikeHost(hostname)) {
    return '';
  }
  return hostname.includes('.') ? hostname : '';
}

function resolveAdminOrigin(rootLines, args) {
  return (
    tryParseUrl(args.adminOrigin)
    || parseFirstOriginListItem(getEnvValue(rootLines, 'ADMIN_WEB_ALLOWED_ORIGINS'))
    || tryParseUrl(getEnvValue(rootLines, 'ADMIN_WEB_SSO_DISCORD_REDIRECT_URI'))
    || new URL('https://admin.example.com')
  );
}

function resolvePlayerOrigin(portalLines, args) {
  return (
    tryParseUrl(args.playerOrigin)
    || tryParseUrl(getEnvValue(portalLines, 'WEB_PORTAL_BASE_URL'))
    || new URL('https://player.example.com')
  );
}

function resolveAdminPath(rootLines, args) {
  return normalizePathSegment(
    args.adminPath || getEnvValue(rootLines, 'ADMIN_WEB_SESSION_COOKIE_PATH'),
    '/admin',
  );
}

function buildAdminUrl(adminOrigin, adminPath) {
  const base = adminOrigin.origin.endsWith('/')
    ? adminOrigin.origin.slice(0, -1)
    : adminOrigin.origin;
  return `${base}${adminPath}`;
}

function buildAdminDiscordRedirect(adminOrigin, adminPath) {
  return `${buildAdminUrl(adminOrigin, adminPath)}/auth/discord/callback`;
}

function applyRootProduction(lines, options) {
  setEnvValue(lines, 'NODE_ENV', 'production');
  setEnvValue(lines, 'PERSIST_REQUIRE_DB', 'true');
  setEnvValue(lines, 'PERSIST_LEGACY_SNAPSHOTS', 'false');

  setEnvValue(lines, 'SCUM_WEBHOOK_SECRET', randomSecret(32));
  setEnvValue(lines, 'ADMIN_WEB_PASSWORD', randomSecret(24));
  setEnvValue(lines, 'ADMIN_WEB_TOKEN', randomSecret(32));
  setEnvValue(lines, 'RCON_PASSWORD', randomSecret(24));

  setEnvValue(lines, 'ADMIN_WEB_SECURE_COOKIE', 'true');
  setEnvValue(lines, 'ADMIN_WEB_HSTS_ENABLED', 'true');
  setEnvValue(lines, 'ADMIN_WEB_ALLOW_TOKEN_QUERY', 'false');
  setEnvValue(lines, 'ADMIN_WEB_ENFORCE_ORIGIN_CHECK', 'true');
  setEnvValue(lines, 'ADMIN_WEB_TRUST_PROXY', 'true');
  setEnvValue(lines, 'ADMIN_WEB_ALLOWED_ORIGINS', options.adminOrigin.origin);
  setEnvValue(lines, 'ADMIN_WEB_SESSION_COOKIE_NAME', 'scum_admin_session');
  setEnvValue(lines, 'ADMIN_WEB_SESSION_COOKIE_PATH', options.adminPath);
  setEnvValue(lines, 'ADMIN_WEB_SESSION_COOKIE_SAMESITE', 'Strict');
  setEnvValue(lines, 'ADMIN_WEB_SESSION_COOKIE_DOMAIN', options.adminCookieDomain);
  setEnvValue(
    lines,
    'ADMIN_WEB_SSO_DISCORD_REDIRECT_URI',
    buildAdminDiscordRedirect(options.adminOrigin, options.adminPath),
  );

  // Keep runtime roles explicit so production split topology does not drift silently.
  setEnvValue(lines, 'BOT_ENABLE_ADMIN_WEB', 'true');
  setEnvValue(lines, 'BOT_ENABLE_RENTBIKE_SERVICE', 'false');
  setEnvValue(lines, 'BOT_ENABLE_DELIVERY_WORKER', 'false');
  setEnvValue(lines, 'BOT_HEALTH_HOST', '127.0.0.1');
  setEnvValue(lines, 'BOT_HEALTH_PORT', '3210');

  setEnvValue(lines, 'WORKER_ENABLE_RENTBIKE', 'true');
  setEnvValue(lines, 'WORKER_ENABLE_DELIVERY', 'true');
  setEnvValue(lines, 'WORKER_HEALTH_HOST', '127.0.0.1');
  setEnvValue(lines, 'WORKER_HEALTH_PORT', '3211');

  setEnvValue(lines, 'SCUM_WATCHER_HEALTH_HOST', '127.0.0.1');
  setEnvValue(lines, 'SCUM_WATCHER_HEALTH_PORT', '3212');

  if (options.forceDiscordPlaceholder) {
    setEnvValue(lines, 'DISCORD_TOKEN', 'ROTATE_IN_DISCORD_DEVELOPER_PORTAL');
    setEnvValue(
      lines,
      'ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET',
      'ROTATE_IN_DISCORD_DEVELOPER_PORTAL',
    );
    return;
  }

  if (options.discordToken) {
    setEnvValue(lines, 'DISCORD_TOKEN', options.discordToken);
  }
  if (options.adminSsoDiscordClientSecret) {
    setEnvValue(
      lines,
      'ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET',
      options.adminSsoDiscordClientSecret,
    );
  }
}

function applyPortalProduction(lines, options) {
  setEnvValue(lines, 'NODE_ENV', 'production');
  setEnvValue(lines, 'WEB_PORTAL_MODE', 'player');
  setEnvValue(lines, 'WEB_PORTAL_HOST', '0.0.0.0');
  setEnvValue(lines, 'WEB_PORTAL_PORT', '3300');
  setEnvValue(lines, 'WEB_PORTAL_BASE_URL', options.playerOrigin.origin);
  setEnvValue(lines, 'WEB_PORTAL_LEGACY_ADMIN_URL', buildAdminUrl(options.adminOrigin, options.adminPath));
  setEnvValue(lines, 'WEB_PORTAL_DISCORD_REDIRECT_PATH', '/auth/discord/callback');
  setEnvValue(lines, 'WEB_PORTAL_SECURE_COOKIE', 'true');
  setEnvValue(lines, 'WEB_PORTAL_ENFORCE_ORIGIN_CHECK', 'true');
  setEnvValue(lines, 'WEB_PORTAL_COOKIE_SAMESITE', 'Lax');
  setEnvValue(lines, 'WEB_PORTAL_SESSION_COOKIE_NAME', 'scum_portal_session');
  setEnvValue(lines, 'WEB_PORTAL_SESSION_COOKIE_PATH', '/');
  setEnvValue(lines, 'WEB_PORTAL_COOKIE_DOMAIN', options.playerCookieDomain);

  if (options.forceDiscordPlaceholder) {
    setEnvValue(
      lines,
      'WEB_PORTAL_DISCORD_CLIENT_SECRET',
      'ROTATE_IN_DISCORD_DEVELOPER_PORTAL',
    );
    return;
  }

  if (options.portalDiscordClientSecret) {
    setEnvValue(
      lines,
      'WEB_PORTAL_DISCORD_CLIENT_SECRET',
      options.portalDiscordClientSecret,
    );
  }
}

function writeLines(filePath, lines) {
  const body = `${lines.join('\n').replace(/\n+$/g, '')}\n`;
  fs.writeFileSync(filePath, body, 'utf8');
}

function printSummary(options) {
  console.log(`[rotate-production-secrets] admin origin: ${buildAdminUrl(options.adminOrigin, options.adminPath)}`);
  console.log(`[rotate-production-secrets] player origin: ${options.playerOrigin.origin}`);
  console.log(`[rotate-production-secrets] admin cookie domain: ${options.adminCookieDomain || '(host-only)'}`);
  console.log(`[rotate-production-secrets] portal cookie domain: ${options.playerCookieDomain || '(host-only)'}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootLines = readLines(ROOT_ENV_PATH);
  const portalLines = readLines(PORTAL_ENV_PATH);

  const adminOrigin = resolveAdminOrigin(rootLines, args);
  const playerOrigin = resolvePlayerOrigin(portalLines, args);
  const adminPath = resolveAdminPath(rootLines, args);

  const options = {
    ...args,
    adminOrigin,
    playerOrigin,
    adminPath,
    adminCookieDomain: deriveCookieDomain(adminOrigin),
    playerCookieDomain: deriveCookieDomain(playerOrigin),
  };

  applyRootProduction(rootLines, options);
  applyPortalProduction(portalLines, options);

  if (!args.write) {
    console.log('[rotate-production-secrets] dry-run complete');
    printSummary(options);
    console.log('[rotate-production-secrets] use --write to apply changes');
    console.log(
      '[rotate-production-secrets] optional args: --discord-token --portal-discord-secret --admin-sso-discord-secret --admin-origin --player-origin --admin-path',
    );
    process.exit(0);
  }

  writeLines(ROOT_ENV_PATH, rootLines);
  writeLines(PORTAL_ENV_PATH, portalLines);

  console.log('[rotate-production-secrets] applied:');
  console.log(`- ${ROOT_ENV_PATH}`);
  console.log(`- ${PORTAL_ENV_PATH}`);
  printSummary(options);

  const rootDiscordToken = getEnvValue(rootLines, 'DISCORD_TOKEN');
  const portalDiscordSecret = getEnvValue(
    portalLines,
    'WEB_PORTAL_DISCORD_CLIENT_SECRET',
  );
  const adminSsoDiscordSecret = getEnvValue(
    rootLines,
    'ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET',
  );

  if (
    args.forceDiscordPlaceholder
    || isLikelyPlaceholder(rootDiscordToken)
    || isLikelyPlaceholder(portalDiscordSecret)
  ) {
    console.log(
      '[rotate-production-secrets] ACTION REQUIRED: set real Discord Bot Token and OAuth Client Secret from Discord Developer Portal.',
    );
  }
  if (adminSsoDiscordSecret && isLikelyPlaceholder(adminSsoDiscordSecret)) {
    console.log(
      '[rotate-production-secrets] ACTION REQUIRED: set ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET or disable ADMIN_WEB_SSO_DISCORD_ENABLED.',
    );
  }
}

main();
