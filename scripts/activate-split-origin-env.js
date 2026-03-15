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

function requireValue(label, value) {
  if (!String(value || '').trim()) {
    throw new Error(`${label} is required`);
  }
}

function runNodeScript(label, scriptArgs, options = {}) {
  const result = spawnSync(process.execPath, scriptArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const output = options.capture
      ? `${result.stdout || ''}\n${result.stderr || ''}`.trim()
      : '';
    throw new Error(`${label} failed with exit code ${result.status || 1}${output ? `\n${output}` : ''}`);
  }
  return result;
}

function runNpmScript(scriptName) {
  const args = process.platform === 'win32'
    ? ['cmd', ['/c', 'npm', 'run', scriptName]]
    : ['npm', ['run', scriptName]];
  const result = spawnSync(args[0], args[1], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`npm run ${scriptName} failed with exit code ${result.status || 1}`);
  }
}

function buildOptions() {
  const cwd = process.cwd();
  return {
    adminOrigin: getArgValue('--admin-origin', ''),
    playerOrigin: getArgValue('--player-origin', ''),
    rootSource: path.resolve(
      getArgValue('--root-source', path.join(cwd, '.env.production.split')),
    ),
    portalSource: path.resolve(
      getArgValue(
        '--portal-source',
        path.join(cwd, 'apps', 'web-portal-standalone', '.env.production.split'),
      ),
    ),
    rootTarget: path.resolve(getArgValue('--root-target', path.join(cwd, '.env'))),
    portalTarget: path.resolve(
      getArgValue('--portal-target', path.join(cwd, 'apps', 'web-portal-standalone', '.env')),
    ),
    backupDir: path.resolve(
      getArgValue('--backup-dir', path.join(cwd, 'data', 'env-backups')),
    ),
    write: hasFlag('--write'),
    useExistingScaffold: hasFlag('--use-existing-scaffold'),
    validate: !hasFlag('--skip-validate'),
    withReadiness: hasFlag('--with-readiness'),
    withSmoke: hasFlag('--with-smoke'),
  };
}

function buildScaffoldArgs(options) {
  return [
    'scripts/scaffold-split-origin-env.js',
    '--admin-origin',
    options.adminOrigin,
    '--player-origin',
    options.playerOrigin,
    '--root-out',
    options.rootSource,
    '--portal-out',
    options.portalSource,
  ];
}

function buildApplyArgs(options) {
  const args = [
    'scripts/apply-split-origin-env.js',
    '--root-source',
    options.rootSource,
    '--portal-source',
    options.portalSource,
    '--root-target',
    options.rootTarget,
    '--portal-target',
    options.portalTarget,
    '--backup-dir',
    options.backupDir,
  ];
  if (!options.validate) {
    args.push('--skip-validate');
  }
  if (options.withReadiness) {
    args.push('--with-readiness');
  }
  args.push('--write');
  return args;
}

function printPlan(options) {
  console.log('# Activate split-origin env');
  console.log(`admin origin  : ${options.adminOrigin || '(required when generating new scaffold)'}`);
  console.log(`player origin : ${options.playerOrigin || '(required when generating new scaffold)'}`);
  console.log(`root source   : ${options.rootSource}`);
  console.log(`portal source : ${options.portalSource}`);
  console.log(`root target   : ${options.rootTarget}`);
  console.log(`portal target : ${options.portalTarget}`);
  console.log(`backup dir    : ${options.backupDir}`);
  console.log(`reuse scaffold: ${options.useExistingScaffold ? 'yes' : 'no'}`);
  console.log(`validate      : ${options.validate ? 'yes' : 'no'}`);
  console.log(`readiness     : ${options.withReadiness ? 'yes' : 'no'}`);
  console.log(`smoke test    : ${options.withSmoke ? 'yes' : 'no'}`);
}

function main() {
  const options = buildOptions();
  printPlan(options);

  if (!options.write) {
    console.log('');
    console.log('# Dry run only');
    console.log('Use --write to generate split-origin env files, apply them with backup, and validate.');
    console.log('Add --use-existing-scaffold if you want to apply already-generated source files.');
    return;
  }

  if (options.useExistingScaffold) {
    ensureFileExists(options.rootSource, 'root source');
    ensureFileExists(options.portalSource, 'portal source');
  } else {
    requireValue('--admin-origin', options.adminOrigin);
    requireValue('--player-origin', options.playerOrigin);
    // Capture scaffold output so generated secrets do not spill into CI or shell history logs.
    runNodeScript('security:scaffold-split-env', buildScaffoldArgs(options), { capture: true });
    console.log('[activate-split-origin-env] scaffold files generated');
  }

  runNodeScript('security:apply-split-env', buildApplyArgs(options));

  if (options.withSmoke) {
    runNpmScript('smoke:postdeploy');
  }

  console.log('');
  console.log('# Activation complete');
  console.log(`Root env    : ${options.rootTarget}`);
  console.log(`Portal env  : ${options.portalTarget}`);
  console.log(`Backups dir : ${options.backupDir}`);
  console.log('Tip: import ADMIN_WEB_2FA_SECRET from the applied root env into your authenticator app.');
}

main();
