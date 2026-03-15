const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(projectRoot, 'scripts', 'rotate-production-secrets.js');

function makeEnvFile(baseDir, relativePath, content) {
  const filePath = path.join(baseDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('rotate-production-secrets applies explicit split origins without hardcoded deployment host', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-rotate-prod-'));

  try {
    makeEnvFile(
      tempDir,
      '.env',
      [
        'ADMIN_WEB_ALLOWED_ORIGINS=https://shared.example.com',
        'ADMIN_WEB_SSO_DISCORD_REDIRECT_URI=https://shared.example.com/admin/auth/discord/callback',
        'DISCORD_TOKEN=old-token',
      ].join('\n'),
    );
    makeEnvFile(
      tempDir,
      path.join('apps', 'web-portal-standalone', '.env'),
      [
        'WEB_PORTAL_BASE_URL=https://shared.example.com',
        'WEB_PORTAL_LEGACY_ADMIN_URL=https://shared.example.com/admin',
        'WEB_PORTAL_DISCORD_CLIENT_SECRET=portal-secret',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--admin-origin',
        'https://admin.example.com',
        '--player-origin',
        'https://player.example.com',
        '--write',
      ],
      {
        cwd: tempDir,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const rootEnv = fs.readFileSync(path.join(tempDir, '.env'), 'utf8');
    const portalEnv = fs.readFileSync(
      path.join(tempDir, 'apps', 'web-portal-standalone', '.env'),
      'utf8',
    );

    assert.match(rootEnv, /^ADMIN_WEB_ALLOWED_ORIGINS=https:\/\/admin\.example\.com$/m);
    assert.match(rootEnv, /^ADMIN_WEB_SESSION_COOKIE_PATH=\/admin$/m);
    assert.match(rootEnv, /^ADMIN_WEB_SESSION_COOKIE_DOMAIN=admin\.example\.com$/m);
    assert.match(
      rootEnv,
      /^ADMIN_WEB_SSO_DISCORD_REDIRECT_URI=https:\/\/admin\.example\.com\/admin\/auth\/discord\/callback$/m,
    );

    assert.match(portalEnv, /^WEB_PORTAL_BASE_URL=https:\/\/player\.example\.com$/m);
    assert.match(
      portalEnv,
      /^WEB_PORTAL_LEGACY_ADMIN_URL=https:\/\/admin\.example\.com\/admin$/m,
    );
    assert.match(portalEnv, /^WEB_PORTAL_COOKIE_DOMAIN=player\.example\.com$/m);
    assert.doesNotMatch(rootEnv, /genz\.noah-dns\.online/i);
    assert.doesNotMatch(portalEnv, /genz\.noah-dns\.online/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rotate-production-secrets preserves existing origin topology when no explicit origins are provided', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-rotate-preserve-'));

  try {
    makeEnvFile(
      tempDir,
      '.env',
      [
        'ADMIN_WEB_ALLOWED_ORIGINS=https://ops.example.net',
        'ADMIN_WEB_SESSION_COOKIE_PATH=/admin',
        'ADMIN_WEB_SSO_DISCORD_REDIRECT_URI=https://ops.example.net/admin/auth/discord/callback',
      ].join('\n'),
    );
    makeEnvFile(
      tempDir,
      path.join('apps', 'web-portal-standalone', '.env'),
      [
        'WEB_PORTAL_BASE_URL=https://play.example.net',
        'WEB_PORTAL_LEGACY_ADMIN_URL=https://ops.example.net/admin',
        'WEB_PORTAL_DISCORD_CLIENT_SECRET=portal-secret',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--write'],
      {
        cwd: tempDir,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const rootEnv = fs.readFileSync(path.join(tempDir, '.env'), 'utf8');
    const portalEnv = fs.readFileSync(
      path.join(tempDir, 'apps', 'web-portal-standalone', '.env'),
      'utf8',
    );

    assert.match(rootEnv, /^ADMIN_WEB_ALLOWED_ORIGINS=https:\/\/ops\.example\.net$/m);
    assert.match(rootEnv, /^ADMIN_WEB_SESSION_COOKIE_DOMAIN=ops\.example\.net$/m);
    assert.match(portalEnv, /^WEB_PORTAL_BASE_URL=https:\/\/play\.example\.net$/m);
    assert.match(
      portalEnv,
      /^WEB_PORTAL_LEGACY_ADMIN_URL=https:\/\/ops\.example\.net\/admin$/m,
    );
    assert.match(portalEnv, /^WEB_PORTAL_COOKIE_DOMAIN=play\.example\.net$/m);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
