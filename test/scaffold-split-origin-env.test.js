const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('split-origin env scaffold script writes admin/player production env files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-split-env-'));
  const rootOut = path.join(tempDir, 'root.env');
  const portalOut = path.join(tempDir, 'portal.env');

  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/scaffold-split-origin-env.js',
        '--admin-origin',
        'https://admin.example.com',
        '--player-origin',
        'https://player.example.com',
        '--root-out',
        rootOut,
        '--portal-out',
        portalOut,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(rootOut), 'expected root env output');
    assert.ok(fs.existsSync(portalOut), 'expected portal env output');

    const rootEnv = fs.readFileSync(rootOut, 'utf8');
    const portalEnv = fs.readFileSync(portalOut, 'utf8');

    assert.match(rootEnv, /^ADMIN_WEB_ALLOWED_ORIGINS=https:\/\/admin\.example\.com$/m);
    assert.match(rootEnv, /^ADMIN_WEB_SESSION_COOKIE_PATH=\/admin$/m);
    assert.match(rootEnv, /^ADMIN_WEB_SESSION_COOKIE_DOMAIN=admin\.example\.com$/m);
    assert.match(rootEnv, /^ADMIN_WEB_2FA_ENABLED=true$/m);
    assert.match(rootEnv, /^ADMIN_WEB_2FA_SECRET=[A-Z2-7]{32}$/m);
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
    assert.match(portalEnv, /^WEB_PORTAL_SESSION_COOKIE_PATH=\/$/m);

    assert.match(String(result.stdout || ''), /otpauth:\/\/totp\//i);
    assert.match(String(result.stdout || ''), /Next steps/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
