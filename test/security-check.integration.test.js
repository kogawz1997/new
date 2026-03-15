const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(projectRoot, 'scripts', 'security-check.js');

function runSecurityCheck(env) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

test('security-check accepts blank portal secret when root admin SSO secret is provided', () => {
  const result = runSecurityCheck({
    NODE_ENV: 'production',
    DISCORD_TOKEN: 'MTQ3ODY1MTQyNzA4ODc2MDg0Mg.ABCDEF.qwertyuiopasdfghjklzxcvbnm12',
    SCUM_WEBHOOK_SECRET: 'webhook-secret-12345678901234567890',
    ADMIN_WEB_PASSWORD: 'admin-password-123456',
    ADMIN_WEB_TOKEN: 'admin-token-12345678901234567890',
    ADMIN_WEB_ALLOW_TOKEN_QUERY: 'false',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'true',
    ADMIN_WEB_ALLOWED_ORIGINS: 'https://admin.example.com',
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    DATABASE_URL: 'file:./prisma/dev.db',
    PERSIST_REQUIRE_DB: 'true',
    PERSIST_LEGACY_SNAPSHOTS: 'false',
    WEB_PORTAL_MODE: 'player',
    WEB_PORTAL_DISCORD_CLIENT_ID: '1478651427088760842',
    WEB_PORTAL_DISCORD_CLIENT_SECRET: '',
    ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET: 'shared-discord-secret-1234567890',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout + result.stderr, /SECURITY_CHECK: PASSED/i);
});

test('security-check warns for shared admin-player origin, long sessions, and missing admin 2FA hardening', () => {
  const result = runSecurityCheck({
    NODE_ENV: 'production',
    DISCORD_TOKEN: 'MTQ3ODY1MTQyNzA4ODc2MDg0Mg.ABCDEF.qwertyuiopasdfghjklzxcvbnm12',
    SCUM_WEBHOOK_SECRET: 'webhook-secret-12345678901234567890',
    ADMIN_WEB_PASSWORD: 'admin-password-123456',
    ADMIN_WEB_TOKEN: 'admin-token-12345678901234567890',
    ADMIN_WEB_ALLOW_TOKEN_QUERY: 'false',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'true',
    ADMIN_WEB_ALLOWED_ORIGINS: 'https://admin.example.com',
    ADMIN_WEB_2FA_ENABLED: '',
    ADMIN_WEB_2FA_SECRET: '',
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    ADMIN_WEB_SESSION_TTL_HOURS: '48',
    DATABASE_URL: 'file:./prisma/dev.db',
    PERSIST_REQUIRE_DB: 'true',
    PERSIST_LEGACY_SNAPSHOTS: 'false',
    WEB_PORTAL_MODE: 'player',
    WEB_PORTAL_BASE_URL: 'https://admin.example.com',
    WEB_PORTAL_LEGACY_ADMIN_URL: 'https://admin.example.com/admin',
    WEB_PORTAL_DISCORD_CLIENT_ID: '1478651427088760842',
    WEB_PORTAL_DISCORD_CLIENT_SECRET: 'portal-secret-1234567890',
    WEB_PORTAL_SESSION_TTL_HOURS: '36',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /PASSED with warnings/i);
  assert.match(output, /ADMIN_WEB_2FA_ENABLED=true with ADMIN_WEB_2FA_SECRET set is strongly recommended/i);
  assert.match(output, /ADMIN_WEB_SESSION_TTL_HOURS=48/i);
  assert.match(output, /WEB_PORTAL_SESSION_TTL_HOURS=36/i);
  assert.match(output, /share the same origin/i);
});
