const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(projectRoot, 'scripts', 'activate-split-origin-env.js');

function makeTempFile(dirPath, name, content) {
  const filePath = path.join(dirPath, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('activate split-origin env scaffolds, applies, and backs up target env files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-activate-env-'));
  const rootTarget = makeTempFile(tempDir, '.env', 'ROOT=old\n');
  const portalTarget = makeTempFile(tempDir, 'portal.env', 'PORTAL=old\n');
  const rootSource = path.join(tempDir, '.env.production.split');
  const portalSource = path.join(tempDir, 'portal.production.split');
  const backupDir = path.join(tempDir, 'backups');

  try {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--admin-origin',
        'https://admin.example.com',
        '--player-origin',
        'https://player.example.com',
        '--root-source',
        rootSource,
        '--portal-source',
        portalSource,
        '--root-target',
        rootTarget,
        '--portal-target',
        portalTarget,
        '--backup-dir',
        backupDir,
        '--skip-validate',
        '--write',
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(rootSource), 'expected generated root source');
    assert.ok(fs.existsSync(portalSource), 'expected generated portal source');

    const rootEnv = fs.readFileSync(rootTarget, 'utf8');
    const portalEnv = fs.readFileSync(portalTarget, 'utf8');

    assert.match(rootEnv, /^ADMIN_WEB_ALLOWED_ORIGINS=https:\/\/admin\.example\.com$/m);
    assert.match(portalEnv, /^WEB_PORTAL_BASE_URL=https:\/\/player\.example\.com$/m);

    const backupFolders = fs.readdirSync(backupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    assert.equal(backupFolders.length, 1);
    const backupPath = path.join(backupDir, backupFolders[0].name);
    assert.equal(fs.readFileSync(path.join(backupPath, 'root.env.bak'), 'utf8'), 'ROOT=old\n');
    assert.equal(fs.readFileSync(path.join(backupPath, 'portal.env.bak'), 'utf8'), 'PORTAL=old\n');
    assert.match(String(result.stdout || ''), /Activation complete/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('activate split-origin env dry-run does not scaffold or modify targets', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-activate-env-dry-'));
  const rootTarget = makeTempFile(tempDir, '.env', 'ROOT=old\n');
  const portalTarget = makeTempFile(tempDir, 'portal.env', 'PORTAL=old\n');
  const rootSource = path.join(tempDir, '.env.production.split');
  const portalSource = path.join(tempDir, 'portal.production.split');

  try {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--admin-origin',
        'https://admin.example.com',
        '--player-origin',
        'https://player.example.com',
        '--root-source',
        rootSource,
        '--portal-source',
        portalSource,
        '--root-target',
        rootTarget,
        '--portal-target',
        portalTarget,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(rootTarget, 'utf8'), 'ROOT=old\n');
    assert.equal(fs.readFileSync(portalTarget, 'utf8'), 'PORTAL=old\n');
    assert.equal(fs.existsSync(rootSource), false);
    assert.equal(fs.existsSync(portalSource), false);
    assert.match(String(result.stdout || ''), /Dry run only/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
