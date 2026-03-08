const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSnowflake,
  getMissingEnv,
  getProductionSecurityErrors,
  getWorkerRuntimeErrors,
} = require('../src/utils/env');

test('isSnowflake validates numeric Discord IDs', () => {
  assert.equal(isSnowflake('12345678901234567'), true);
  assert.equal(isSnowflake('abc'), false);
  assert.equal(isSnowflake('1234'), false);
});

test('getMissingEnv reports empty and missing keys', () => {
  const env = { A: 'ok', B: '', C: '  ' };
  assert.deepEqual(getMissingEnv(['A', 'B', 'C', 'D'], env), ['B', 'C', 'D']);
});

test('getProductionSecurityErrors blocks weak production config', () => {
  const errors = getProductionSecurityErrors({
    NODE_ENV: 'production',
    DISCORD_TOKEN: 'your_bot_token_here',
    SCUM_WEBHOOK_SECRET: 'short',
    ADMIN_WEB_PASSWORD: '1234',
    ADMIN_WEB_TOKEN: '',
    ADMIN_WEB_SECURE_COOKIE: 'false',
    ADMIN_WEB_HSTS_ENABLED: 'false',
    ADMIN_WEB_ALLOW_TOKEN_QUERY: 'true',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'false',
    ADMIN_WEB_ALLOWED_ORIGINS: 'http://127.0.0.1:3200',
  });
  assert.ok(errors.length >= 5);
});

test('getProductionSecurityErrors passes strong production config', () => {
  const errors = getProductionSecurityErrors({
    NODE_ENV: 'production',
    DISCORD_TOKEN:
      'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0.NTQzMjE2.abcdefghijklmnopqrstuvwx',
    SCUM_WEBHOOK_SECRET: 'w'.repeat(32),
    ADMIN_WEB_PASSWORD: 'StrongPassword_12345',
    ADMIN_WEB_TOKEN: 't'.repeat(40),
    ADMIN_WEB_SECURE_COOKIE: 'true',
    ADMIN_WEB_HSTS_ENABLED: 'true',
    ADMIN_WEB_ALLOW_TOKEN_QUERY: 'false',
    ADMIN_WEB_ENFORCE_ORIGIN_CHECK: 'true',
    ADMIN_WEB_ALLOWED_ORIGINS: 'https://admin.example.com',
  });
  assert.deepEqual(errors, []);
});

test('getWorkerRuntimeErrors validates worker toggles', () => {
  const invalid = getWorkerRuntimeErrors({
    WORKER_ENABLE_RENTBIKE: 'false',
    WORKER_ENABLE_DELIVERY: 'false',
  });
  assert.equal(invalid.length > 0, true);

  const valid = getWorkerRuntimeErrors({
    WORKER_ENABLE_RENTBIKE: 'true',
    WORKER_ENABLE_DELIVERY: 'false',
  });
  assert.deepEqual(valid, []);
});
