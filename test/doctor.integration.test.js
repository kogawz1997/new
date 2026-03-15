const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(projectRoot, 'scripts', 'doctor.js');

function runDoctor(env) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

test('doctor passes valid reverse proxy/origin/port production setup', () => {
  const result = runDoctor({
    NODE_ENV: 'production',
    DATABASE_URL: 'file:./prisma/dev.db',
    ADMIN_WEB_HOST: '127.0.0.1',
    ADMIN_WEB_PORT: '3200',
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    ADMIN_WEB_TRUST_PROXY: 'true',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'true',
    ADMIN_WEB_ALLOWED_ORIGINS: 'https://admin.example.com',
    ADMIN_WEB_SSO_DISCORD_ENABLED: '',
    ADMIN_WEB_SSO_DISCORD_CLIENT_ID: '',
    ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET: '',
    ADMIN_WEB_SSO_DISCORD_REDIRECT_URI: '',
    WEB_PORTAL_BASE_URL: 'https://player.example.com',
    WEB_PORTAL_LEGACY_ADMIN_URL: 'https://admin.example.com/admin',
    WEB_PORTAL_DISCORD_CLIENT_ID: '1478651427088760842',
    WEB_PORTAL_DISCORD_CLIENT_SECRET: 'portal-secret-1234567890',
    WEB_PORTAL_DISCORD_REDIRECT_PATH: '/admin/auth/discord/callback',
    WEB_PORTAL_SECURE_COOKIE: 'true',
    WEB_PORTAL_ENFORCE_ORIGIN_CHECK: 'true',
    WEB_PORTAL_PORT: '3300',
    SCUM_WEBHOOK_PORT: '3100',
    BOT_HEALTH_PORT: '3210',
    WORKER_HEALTH_PORT: '3211',
    SCUM_WATCHER_HEALTH_PORT: '3212',
    BOT_ENABLE_RENTBIKE_SERVICE: 'false',
    BOT_ENABLE_DELIVERY_WORKER: 'false',
    WORKER_ENABLE_RENTBIKE: 'true',
    WORKER_ENABLE_DELIVERY: 'true',
    DELIVERY_EXECUTION_MODE: 'rcon',
    RCON_HOST: '127.0.0.1',
    RCON_PORT: '27015',
    RCON_PASSWORD: 'rcon-secret-1234567890',
    RCON_EXEC_TEMPLATE:
      'node scripts/rcon-send.js --host {host} --port {port} --password \"{password}\" --command \"{command}\"',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK: admin reverse proxy \/ origins config/);
  assert.match(result.stdout, /OK: player portal reverse proxy \/ origins config/);
  assert.match(result.stdout, /OK: Discord OAuth redirect consistency/);
  assert.match(result.stdout, /OK: RCON runtime consistency/);
  assert.match(result.stdout, /OK: port matrix has no conflicts/);
});

test('doctor fails when player legacy admin origin is not allowed by admin origin list', () => {
  const result = runDoctor({
    NODE_ENV: 'production',
    DATABASE_URL: 'file:./prisma/dev.db',
    ADMIN_WEB_HOST: '127.0.0.1',
    ADMIN_WEB_PORT: '3200',
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    ADMIN_WEB_TRUST_PROXY: 'true',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'true',
    ADMIN_WEB_ALLOWED_ORIGINS: 'https://admin.example.com',
    WEB_PORTAL_BASE_URL: 'https://player.example.com',
    WEB_PORTAL_LEGACY_ADMIN_URL: 'https://panel.example.com/admin',
    WEB_PORTAL_DISCORD_CLIENT_ID: '1478651427088760842',
    WEB_PORTAL_DISCORD_CLIENT_SECRET: 'portal-secret-1234567890',
    WEB_PORTAL_SECURE_COOKIE: 'true',
    WEB_PORTAL_ENFORCE_ORIGIN_CHECK: 'true',
    WEB_PORTAL_PORT: '3300',
    SCUM_WEBHOOK_PORT: '3100',
    BOT_HEALTH_PORT: '3210',
    WORKER_HEALTH_PORT: '3211',
    SCUM_WATCHER_HEALTH_PORT: '3212',
  });

  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /WEB_PORTAL_LEGACY_ADMIN_URL origin/i);
});

test('doctor fails when RCON template is missing {command}', () => {
  const result = runDoctor({
    NODE_ENV: 'production',
    DATABASE_URL: 'file:./prisma/dev.db',
    ADMIN_WEB_HOST: '127.0.0.1',
    ADMIN_WEB_PORT: '3200',
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    ADMIN_WEB_TRUST_PROXY: 'true',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'true',
    ADMIN_WEB_ALLOWED_ORIGINS: 'https://admin.example.com',
    WEB_PORTAL_BASE_URL: 'https://player.example.com',
    WEB_PORTAL_LEGACY_ADMIN_URL: 'https://admin.example.com/admin',
    WEB_PORTAL_DISCORD_CLIENT_ID: '1478651427088760842',
    WEB_PORTAL_DISCORD_CLIENT_SECRET: 'portal-secret-1234567890',
    WEB_PORTAL_SECURE_COOKIE: 'true',
    WEB_PORTAL_ENFORCE_ORIGIN_CHECK: 'true',
    BOT_ENABLE_RENTBIKE_SERVICE: 'false',
    BOT_ENABLE_DELIVERY_WORKER: 'false',
    WORKER_ENABLE_RENTBIKE: 'true',
    WORKER_ENABLE_DELIVERY: 'true',
    DELIVERY_EXECUTION_MODE: 'rcon',
    RCON_HOST: '127.0.0.1',
    RCON_PORT: '27015',
    RCON_PASSWORD: 'rcon-secret-1234567890',
    RCON_EXEC_TEMPLATE: 'node scripts/rcon-send.js --host {host} --port {port}',
  });

  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /RCON_EXEC_TEMPLATE must include \{command\}/i);
});

test('doctor fails when admin Discord redirect origin is not allowed', () => {
  const result = runDoctor({
    NODE_ENV: 'production',
    DATABASE_URL: 'file:./prisma/dev.db',
    ADMIN_WEB_HOST: '127.0.0.1',
    ADMIN_WEB_PORT: '3200',
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    ADMIN_WEB_TRUST_PROXY: 'true',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'true',
    ADMIN_WEB_ALLOWED_ORIGINS: 'https://admin.example.com',
    ADMIN_WEB_SSO_DISCORD_ENABLED: 'true',
    ADMIN_WEB_SSO_DISCORD_CLIENT_ID: '1478651427088760842',
    ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET: 'admin-sso-secret-1234567890',
    ADMIN_WEB_SSO_DISCORD_REDIRECT_URI:
      'https://panel.example.com/admin/auth/discord/callback',
    WEB_PORTAL_BASE_URL: 'https://player.example.com',
    WEB_PORTAL_LEGACY_ADMIN_URL: 'https://admin.example.com/admin',
    WEB_PORTAL_DISCORD_CLIENT_ID: '1478651427088760842',
    WEB_PORTAL_DISCORD_CLIENT_SECRET: 'portal-secret-1234567890',
    WEB_PORTAL_SECURE_COOKIE: 'true',
    WEB_PORTAL_ENFORCE_ORIGIN_CHECK: 'true',
    BOT_ENABLE_RENTBIKE_SERVICE: 'false',
    BOT_ENABLE_DELIVERY_WORKER: 'false',
    WORKER_ENABLE_RENTBIKE: 'false',
    WORKER_ENABLE_DELIVERY: 'false',
  });

  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /ADMIN_WEB_SSO_DISCORD_REDIRECT_URI origin/i);
});

test('doctor warns when external admin lacks 2FA and session ttl is too long', () => {
  const result = runDoctor({
    NODE_ENV: 'production',
    DATABASE_URL: 'file:./prisma/dev.db',
    ADMIN_WEB_HOST: '127.0.0.1',
    ADMIN_WEB_PORT: '3200',
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    ADMIN_WEB_TRUST_PROXY: 'true',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'true',
    ADMIN_WEB_ALLOWED_ORIGINS: 'https://admin.example.com',
    ADMIN_WEB_2FA_ENABLED: '',
    ADMIN_WEB_2FA_SECRET: '',
    ADMIN_WEB_SSO_DISCORD_ENABLED: '',
    ADMIN_WEB_SSO_DISCORD_CLIENT_ID: '',
    ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET: '',
    ADMIN_WEB_SSO_DISCORD_REDIRECT_URI: '',
    ADMIN_WEB_SESSION_TTL_HOURS: '48',
    WEB_PORTAL_BASE_URL: 'https://player.example.com',
    WEB_PORTAL_LEGACY_ADMIN_URL: 'https://admin.example.com/admin',
    WEB_PORTAL_DISCORD_CLIENT_ID: '1478651427088760842',
    WEB_PORTAL_DISCORD_CLIENT_SECRET: 'portal-secret-1234567890',
    WEB_PORTAL_SECURE_COOKIE: 'true',
    WEB_PORTAL_ENFORCE_ORIGIN_CHECK: 'true',
    WEB_PORTAL_SESSION_TTL_HOURS: '72',
    SCUM_WEBHOOK_PORT: '3100',
    BOT_HEALTH_PORT: '3210',
    WORKER_HEALTH_PORT: '3211',
    SCUM_WATCHER_HEALTH_PORT: '3212',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /OK: auth\/session hardening posture/i);
  assert.match(output, /without active 2FA/i);
  assert.match(output, /ADMIN_WEB_SESSION_TTL_HOURS=48/i);
  assert.match(output, /WEB_PORTAL_SESSION_TTL_HOURS=72/i);
});
