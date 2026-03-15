'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseEnvFile, mergeEnvMaps } = require('../src/utils/loadEnvFiles');

const ARTIFACT_DIR = path.resolve(process.cwd(), 'artifacts', 'ci');
const IS_WINDOWS = process.platform === 'win32';

const DEFAULT_STEPS = [
  { id: 'lint', label: 'Lint', command: ['run', 'lint'] },
  { id: 'test', label: 'Test', command: ['test'] },
  { id: 'doctor', label: 'Doctor', command: ['run', 'doctor'] },
  { id: 'security-check', label: 'Security Check', command: ['run', 'security:check'] },
  { id: 'readiness', label: 'Readiness', command: ['run', 'readiness:full'] },
  { id: 'smoke', label: 'Local Smoke', command: ['run', 'smoke:local-ci'] },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildVerificationEnv() {
  const rootBase = parseEnvFile(path.resolve(process.cwd(), '.env.example'));
  const rootOverlay = parseEnvFile(path.resolve(process.cwd(), '.env.test.example'));
  const portalBase = parseEnvFile(
    path.resolve(process.cwd(), 'apps', 'web-portal-standalone', '.env.example'),
  );
  const portalOverlay = parseEnvFile(
    path.resolve(process.cwd(), 'apps', 'web-portal-standalone', '.env.test.example'),
  );
  return {
    ...process.env,
    ...mergeEnvMaps(rootBase, rootOverlay),
    ...mergeEnvMaps(portalBase, portalOverlay),
    CI: 'true',
    NODE_ENV: 'test',
    BOT_ENABLE_RENTBIKE_SERVICE: 'false',
    BOT_ENABLE_DELIVERY_WORKER: 'false',
    WORKER_ENABLE_RENTBIKE: 'true',
    WORKER_ENABLE_DELIVERY: 'true',
  };
}

function runNpmStep(step) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const command = IS_WINDOWS ? 'cmd' : 'npm';
  const commandArgs = IS_WINDOWS ? ['/c', 'npm', ...step.command] : step.command;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    env: buildVerificationEnv(),
  });
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - started;
  const logFile = path.join(ARTIFACT_DIR, `${step.id}.log`);
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const displayCommand = `${IS_WINDOWS ? 'cmd /c npm' : 'npm'} ${step.command.join(' ')}`;
  fs.writeFileSync(
    logFile,
    [
      `$ ${displayCommand}`,
      '',
      stdout.trimEnd(),
      stderr ? `\n${stderr.trimEnd()}` : '',
      '',
    ].join('\n'),
    'utf8',
  );
  return {
    id: step.id,
    label: step.label,
    command: displayCommand,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    status: result.status === 0 ? 'passed' : 'failed',
    logFile: path.relative(process.cwd(), logFile).replace(/\\/g, '/'),
  };
}

function writeSummary(results) {
  const summary = {
    generatedAt: new Date().toISOString(),
    envProfile: 'test-ci',
    packageName: (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
        return pkg.name || null;
      } catch {
        return null;
      }
    })(),
    nodeVersion: process.version,
    status: results.every((entry) => entry.status === 'passed') ? 'passed' : 'failed',
    steps: results,
  };
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'verification-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  const lines = [
    '# Verification Summary',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Env Profile: ${summary.envProfile}`,
    `- Package: ${summary.packageName || '-'}`,
    `- Node: ${summary.nodeVersion}`,
    `- Overall: ${summary.status.toUpperCase()}`,
    '',
    '| Step | Status | Duration (ms) | Log |',
    '| --- | --- | ---: | --- |',
    ...results.map((entry) =>
      `| ${entry.label} | ${entry.status} | ${entry.durationMs} | ${entry.logFile} |`),
    '',
  ];
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'verification-summary.md'),
    `${lines.join('\n')}\n`,
    'utf8',
  );
  return summary;
}

function main() {
  ensureDir(ARTIFACT_DIR);
  const results = [];
  for (const step of DEFAULT_STEPS) {
    console.log(`[ci-verify] ${step.label}`);
    const result = runNpmStep(step);
    results.push(result);
    if (result.status !== 'passed') {
      break;
    }
  }
  const summary = writeSummary(results);
  if (summary.status !== 'passed') {
    process.exit(1);
  }
}

main();
