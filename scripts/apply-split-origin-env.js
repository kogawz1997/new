const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function getArgValue(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  return String(process.argv[index + 1] || '').trim() || fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function timestampTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function copyFile(fromPath, toPath) {
  ensureDir(path.dirname(toPath));
  fs.copyFileSync(fromPath, toPath);
}

function runCommand(label, command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status || 1}`);
  }
}

function runNpmScript(scriptName) {
  if (process.platform === 'win32') {
    runCommand(`npm run ${scriptName}`, 'cmd', ['/c', 'npm', 'run', scriptName]);
    return;
  }
  runCommand(`npm run ${scriptName}`, 'npm', ['run', scriptName]);
}

function buildBackupManifest(options) {
  const tag = timestampTag();
  const backupDir = path.resolve(options.backupDir, tag);
  const items = [
    {
      key: 'root',
      source: options.rootTarget,
      backup: path.join(backupDir, 'root.env.bak'),
      incoming: options.rootSource,
    },
    {
      key: 'portal',
      source: options.portalTarget,
      backup: path.join(backupDir, 'portal.env.bak'),
      incoming: options.portalSource,
    },
  ];
  return { tag, backupDir, items };
}

function writeManifestFile(backupDir, payload) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2), 'utf8');
}

function backupTargets(manifest) {
  ensureDir(manifest.backupDir);
  for (const item of manifest.items) {
    ensureFileExists(item.source, `${item.key} target`);
    copyFile(item.source, item.backup);
  }
  writeManifestFile(manifest.backupDir, {
    createdAt: new Date().toISOString(),
    backupDir: manifest.backupDir,
    items: manifest.items,
  });
}

function applySources(manifest) {
  for (const item of manifest.items) {
    ensureFileExists(item.incoming, `${item.key} source`);
    copyFile(item.incoming, item.source);
  }
}

function rollbackFromBackups(manifest) {
  for (const item of manifest.items) {
    ensureFileExists(item.backup, `${item.key} backup`);
    copyFile(item.backup, item.source);
  }
}

function printPlan(manifest, options) {
  console.log('# Apply split-origin env');
  console.log(`root source   : ${options.rootSource}`);
  console.log(`portal source : ${options.portalSource}`);
  console.log(`root target   : ${options.rootTarget}`);
  console.log(`portal target : ${options.portalTarget}`);
  console.log(`backup dir    : ${manifest.backupDir}`);
  console.log(`validate      : ${options.validate ? 'yes' : 'no'}`);
  console.log(`readiness     : ${options.withReadiness ? 'yes' : 'no'}`);
  console.log(`rollback fail : ${options.rollbackOnFail ? 'yes' : 'no'}`);
}

function buildOptions() {
  const cwd = process.cwd();
  const rootTarget = path.resolve(getArgValue('--root-target', path.join(cwd, '.env')));
  const portalTarget = path.resolve(
    getArgValue('--portal-target', path.join(cwd, 'apps', 'web-portal-standalone', '.env')),
  );
  const rootSource = path.resolve(
    getArgValue('--root-source', path.join(cwd, '.env.production.split')),
  );
  const portalSource = path.resolve(
    getArgValue(
      '--portal-source',
      path.join(cwd, 'apps', 'web-portal-standalone', '.env.production.split'),
    ),
  );
  return {
    rootTarget,
    portalTarget,
    rootSource,
    portalSource,
    backupDir: path.resolve(
      getArgValue('--backup-dir', path.join(cwd, 'data', 'env-backups')),
    ),
    validate: !hasFlag('--skip-validate'),
    withReadiness: hasFlag('--with-readiness'),
    rollbackOnFail: !hasFlag('--no-rollback'),
    write: hasFlag('--write'),
  };
}

function runValidation(options) {
  if (!options.validate) return;
  runNpmScript('doctor');
  runNpmScript('security:check');
  if (options.withReadiness) {
    runNpmScript('readiness:prod');
  }
}

function main() {
  const options = buildOptions();
  const manifest = buildBackupManifest(options);
  printPlan(manifest, options);

  if (!options.write) {
    console.log('');
    console.log('# Dry run only');
    console.log('Use --write to backup current env files, apply the split-origin env, and validate.');
    return;
  }

  backupTargets(manifest);
  try {
    applySources(manifest);
    runValidation(options);
  } catch (error) {
    if (options.rollbackOnFail) {
      try {
        rollbackFromBackups(manifest);
        console.error('[apply-split-origin-env] validation failed, rollback completed');
      } catch (rollbackError) {
        console.error('[apply-split-origin-env] rollback failed:', rollbackError.message);
      }
    }
    throw error;
  }

  console.log('');
  console.log('# Apply complete');
  console.log(`Backup saved at ${manifest.backupDir}`);
}

main();
