const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isBlockedFilename,
  scanFileContents,
} = require('../scripts/secret-scan.js');

test('secret scan blocks sensitive filenames but allows checked-in examples', () => {
  assert.equal(isBlockedFilename('.env'), true);
  assert.equal(isBlockedFilename('nested/server.pem'), true);
  assert.equal(isBlockedFilename('keys/admin.key'), true);
  assert.equal(isBlockedFilename('.env.example'), false);
  assert.equal(isBlockedFilename('.env.test.example'), false);
  assert.equal(isBlockedFilename('apps/web-portal-standalone/.env.production.example'), false);
  assert.equal(isBlockedFilename('apps/web-portal-standalone/.env.test.example'), false);
});

test('secret scan finds risky content patterns in non-example files', () => {
  const findings = scanFileContents(
    '.env.local',
    [
      'DISCORD_TOKEN=super-secret-token-value',
      'ADMIN_WEB_PASSWORD=super-secret-password',
      '-----BEGIN PRIVATE KEY-----',
    ].join('\n'),
  );

  const reasons = findings.map((entry) => entry.reason).sort();
  assert.deepEqual(reasons, [
    'high-risk secret env assignment',
    'private key material',
  ]);
});

test('secret scan skips content findings for approved example env files', () => {
  const findings = scanFileContents(
    '.env.example',
    'DISCORD_TOKEN=ROTATE_IN_DISCORD_DEVELOPER_PORTAL',
  );
  assert.deepEqual(findings, []);
});

test('secret scan skips content findings for tracked test example env files', () => {
  const findings = scanFileContents(
    '.env.test.example',
    'DISCORD_TOKEN=ci_ci_ci_ci_ci_ci_ci_ci.ABCDEF.ci_ci_ci_ci_ci_ci_ci_ci_ci',
  );
  assert.deepEqual(findings, []);
});
