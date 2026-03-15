const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function makeTempFile(dirPath, name, content) {
  const filePath = path.join(dirPath, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('apply split-origin env script applies sources and creates backups', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-apply-env-'));
  const backupDir = path.join(tempDir, 'backups');

  try {
    const rootTarget = makeTempFile(tempDir, '.env', 'ROOT=old\n');
    const portalTarget = makeTempFile(tempDir, 'portal.env', 'PORTAL=old\n');
    const rootSource = makeTempFile(tempDir, '.env.production.split', 'ROOT=new\n');
    const portalSource = makeTempFile(tempDir, 'portal.production.split', 'PORTAL=new\n');

    const result = spawnSync(
      process.execPath,
      [
        'scripts/apply-split-origin-env.js',
        '--root-target',
        rootTarget,
        '--portal-target',
        portalTarget,
        '--root-source',
        rootSource,
        '--portal-source',
        portalSource,
        '--backup-dir',
        backupDir,
        '--skip-validate',
        '--write',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(rootTarget, 'utf8'), 'ROOT=new\n');
    assert.equal(fs.readFileSync(portalTarget, 'utf8'), 'PORTAL=new\n');

    const backupFolders = fs.readdirSync(backupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    assert.equal(backupFolders.length, 1);
    const backupPath = path.join(backupDir, backupFolders[0].name);
    assert.equal(fs.readFileSync(path.join(backupPath, 'root.env.bak'), 'utf8'), 'ROOT=old\n');
    assert.equal(fs.readFileSync(path.join(backupPath, 'portal.env.bak'), 'utf8'), 'PORTAL=old\n');
    assert.ok(fs.existsSync(path.join(backupPath, 'manifest.json')));
    assert.match(String(result.stdout || ''), /Apply complete/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('apply split-origin env script dry-run does not modify target files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-apply-env-dry-'));

  try {
    const rootTarget = makeTempFile(tempDir, '.env', 'ROOT=old\n');
    const portalTarget = makeTempFile(tempDir, 'portal.env', 'PORTAL=old\n');
    const rootSource = makeTempFile(tempDir, '.env.production.split', 'ROOT=new\n');
    const portalSource = makeTempFile(tempDir, 'portal.production.split', 'PORTAL=new\n');

    const result = spawnSync(
      process.execPath,
      [
        'scripts/apply-split-origin-env.js',
        '--root-target',
        rootTarget,
        '--portal-target',
        portalTarget,
        '--root-source',
        rootSource,
        '--portal-source',
        portalSource,
        '--skip-validate',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(rootTarget, 'utf8'), 'ROOT=old\n');
    assert.equal(fs.readFileSync(portalTarget, 'utf8'), 'PORTAL=old\n');
    assert.match(String(result.stdout || ''), /Dry run only/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
