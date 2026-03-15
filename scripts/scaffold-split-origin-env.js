const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_DIR = process.cwd();
const ROOT_TEMPLATE_PATH = path.join(ROOT_DIR, '.env.production.example');
const PORTAL_TEMPLATE_PATH = path.join(
  ROOT_DIR,
  'apps',
  'web-portal-standalone',
  '.env.production.example',
);

function getArgValue(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  return String(process.argv[index + 1] || '').trim() || fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function makeSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function makeBase32Secret(bytes = 20) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const raw = crypto.randomBytes(bytes);
  let bits = '';
  for (const byte of raw) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += alphabet[Number.parseInt(chunk, 2)];
  }
  return out;
}

function assertHttpsOrigin(value, label) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(`${label} is required`);
  }
  const parsed = new URL(text);
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https`);
  }
  return parsed;
}

function replaceEnvValue(text, key, nextValue) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedKey}=.*$`, 'm');
  const safeValue = String(nextValue);
  if (pattern.test(text)) {
    return text.replace(pattern, `${key}=${safeValue}`);
  }
  return `${text.trimEnd()}\n${key}=${safeValue}\n`;
}

function buildAdminPath(adminOrigin) {
  const basePath = adminOrigin.pathname.replace(/\/+$/, '') || '';
  const adminPath = `${basePath}/admin`.replace(/\/+/g, '/');
  return adminPath === '/admin' ? adminPath : adminPath.replace(/\/$/, '');
}

function renderRootEnv(templateText, options) {
  let next = String(templateText || '');
  const adminHost = options.adminOrigin.hostname;
  const adminPath = buildAdminPath(options.adminOrigin);

  const replacements = {
    ADMIN_WEB_ALLOWED_ORIGINS: options.adminOrigin.origin,
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    ADMIN_WEB_TRUST_PROXY: 'true',
    ADMIN_WEB_SESSION_COOKIE_NAME: 'scum_admin_session',
    ADMIN_WEB_SESSION_COOKIE_PATH: adminPath,
    ADMIN_WEB_SESSION_COOKIE_SAMESITE: 'Strict',
    ADMIN_WEB_SESSION_COOKIE_DOMAIN: adminHost,
    ADMIN_WEB_2FA_ENABLED: 'true',
    ADMIN_WEB_2FA_SECRET: options.admin2faSecret,
    ADMIN_WEB_TOKEN: options.adminToken,
    ADMIN_WEB_PASSWORD: options.adminPassword,
    SCUM_WEBHOOK_SECRET: options.webhookSecret,
    SCUM_CONSOLE_AGENT_TOKEN: options.agentToken,
    RCON_PASSWORD: options.rconPassword,
    ADMIN_WEB_SSO_DISCORD_REDIRECT_URI: new URL(`${adminPath}/auth/discord/callback`, options.adminOrigin.origin).toString(),
  };

  for (const [key, value] of Object.entries(replacements)) {
    next = replaceEnvValue(next, key, value);
  }
  return next;
}

function renderPortalEnv(templateText, options) {
  let next = String(templateText || '');
  const adminPath = buildAdminPath(options.adminOrigin);
  const replacements = {
    WEB_PORTAL_BASE_URL: options.playerOrigin.origin,
    WEB_PORTAL_LEGACY_ADMIN_URL: new URL(adminPath, options.adminOrigin.origin).toString(),
    WEB_PORTAL_SECURE_COOKIE: 'true',
    WEB_PORTAL_SESSION_COOKIE_NAME: 'scum_portal_session',
    WEB_PORTAL_SESSION_COOKIE_PATH: '/',
    WEB_PORTAL_COOKIE_DOMAIN: options.playerOrigin.hostname,
    WEB_PORTAL_COOKIE_SAMESITE: 'Lax',
  };
  for (const [key, value] of Object.entries(replacements)) {
    next = replaceEnvValue(next, key, value);
  }
  return next;
}

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

function main() {
  const adminOrigin = assertHttpsOrigin(
    getArgValue('--admin-origin', 'https://admin.example.com'),
    '--admin-origin',
  );
  const playerOrigin = assertHttpsOrigin(
    getArgValue('--player-origin', 'https://player.example.com'),
    '--player-origin',
  );
  const rootOutPath = path.resolve(
    getArgValue('--root-out', path.join(ROOT_DIR, '.env.production.split')),
  );
  const portalOutPath = path.resolve(
    getArgValue(
      '--portal-out',
      path.join(ROOT_DIR, 'apps', 'web-portal-standalone', '.env.production.split'),
    ),
  );

  const secrets = {
    adminPassword: makeSecret(24),
    adminToken: makeSecret(32),
    admin2faSecret: makeBase32Secret(20),
    webhookSecret: makeSecret(32),
    agentToken: makeSecret(24),
    rconPassword: makeSecret(24),
  };

  const rootTemplate = fs.readFileSync(ROOT_TEMPLATE_PATH, 'utf8');
  const portalTemplate = fs.readFileSync(PORTAL_TEMPLATE_PATH, 'utf8');
  const rootEnv = renderRootEnv(rootTemplate, {
    ...secrets,
    adminOrigin,
    playerOrigin,
  });
  const portalEnv = renderPortalEnv(portalTemplate, {
    ...secrets,
    adminOrigin,
    playerOrigin,
  });

  if (!hasFlag('--print-only')) {
    writeFile(rootOutPath, rootEnv);
    writeFile(portalOutPath, portalEnv);
  }

  const adminPath = buildAdminPath(adminOrigin);
  const otpauthUri = `otpauth://totp/${encodeURIComponent('SCUM Admin Web')}:${encodeURIComponent(`owner@${adminOrigin.hostname}`)}?secret=${encodeURIComponent(secrets.admin2faSecret)}&issuer=${encodeURIComponent('SCUM Admin Web')}&digits=6&period=30&algorithm=SHA1`;

  console.log('# Split-origin env scaffold');
  console.log(`adminOrigin=${adminOrigin.origin}${adminPath}`);
  console.log(`playerOrigin=${playerOrigin.origin}`);
  console.log(`rootEnvOut=${rootOutPath}`);
  console.log(`portalEnvOut=${portalOutPath}`);
  console.log('');
  console.log('# Secrets generated');
  console.log(`ADMIN_WEB_PASSWORD=${secrets.adminPassword}`);
  console.log(`ADMIN_WEB_TOKEN=${secrets.adminToken}`);
  console.log(`ADMIN_WEB_2FA_SECRET=${secrets.admin2faSecret}`);
  console.log(`SCUM_WEBHOOK_SECRET=${secrets.webhookSecret}`);
  console.log(`SCUM_CONSOLE_AGENT_TOKEN=${secrets.agentToken}`);
  console.log(`RCON_PASSWORD=${secrets.rconPassword}`);
  console.log('');
  console.log('# TOTP URI');
  console.log(otpauthUri);
  if (hasFlag('--print-only')) {
    console.log('');
    console.log('# Root env preview');
    console.log(rootEnv);
    console.log('');
    console.log('# Portal env preview');
    console.log(portalEnv);
  } else {
    console.log('');
    console.log('# Next steps');
    console.log(`1. Review ${rootOutPath}`);
    console.log(`2. Review ${portalOutPath}`);
    console.log('3. Import ADMIN_WEB_2FA_SECRET into your authenticator app using the TOTP URI above');
    console.log('4. Run npm run doctor && npm run security:check && npm run readiness:prod');
  }
}

main();
