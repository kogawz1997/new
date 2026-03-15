'use strict';

const { spawn } = require('node:child_process');

const MANAGED_RUNTIME_SERVICES = Object.freeze([
  {
    key: 'bot',
    label: 'Discord Bot + Admin Web',
    pm2Name: 'scum-bot',
    description: 'bot.js และ admin web ที่รันใน process เดียวกัน',
  },
  {
    key: 'worker',
    label: 'Worker',
    pm2Name: 'scum-worker',
    description: 'delivery worker และ rent-bike worker',
  },
  {
    key: 'watcher',
    label: 'SCUM Watcher',
    pm2Name: 'scum-watcher',
    description: 'log watcher และ webhook ingest',
  },
  {
    key: 'console-agent',
    label: 'Console Agent',
    pm2Name: 'scum-console-agent',
    description: 'agent mode backend สำหรับส่งคำสั่ง SCUM',
  },
  {
    key: 'player-portal',
    label: 'Player Portal',
    pm2Name: 'scum-web-portal',
    description: 'standalone player portal',
  },
]);

const SERVICE_INDEX = new Map(
  MANAGED_RUNTIME_SERVICES.map((entry) => [entry.key, Object.freeze({ ...entry })]),
);

function listManagedRuntimeServices() {
  return MANAGED_RUNTIME_SERVICES.map((entry) => ({ ...entry }));
}

function normalizeRequestedServices(input) {
  const rawList = Array.isArray(input)
    ? input
    : input == null
      ? []
      : [input];
  const requested = rawList
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  if (requested.includes('all')) {
    return MANAGED_RUNTIME_SERVICES.map((entry) => entry.key);
  }
  return Array.from(new Set(requested.filter((entry) => SERVICE_INDEX.has(entry))));
}

function buildRestartCommand(pm2Names = []) {
  const overrideScript = String(process.env.ADMIN_WEB_SERVICE_RESTART_SCRIPT || '').trim();
  if (overrideScript) {
    return {
      command: process.execPath,
      args: [overrideScript, ...pm2Names],
    };
  }

  if (process.platform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', 'pm2', 'restart', ...pm2Names, '--update-env'],
    };
  }

  return {
    command: 'pm2',
    args: ['restart', ...pm2Names, '--update-env'],
  };
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}Timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

async function restartManagedRuntimeServices(input) {
  const serviceKeys = normalizeRequestedServices(input);
  if (serviceKeys.length === 0) {
    throw new Error('No managed services selected');
  }
  const serviceEntries = serviceKeys
    .map((key) => SERVICE_INDEX.get(key))
    .filter(Boolean);
  const pm2Names = serviceEntries.map((entry) => entry.pm2Name);
  const timeoutMs = Math.max(
    5_000,
    Number(process.env.ADMIN_WEB_SERVICE_RESTART_TIMEOUT_MS || 45_000),
  );
  const commandSpec = buildRestartCommand(pm2Names);
  const result = await runCommand(commandSpec.command, commandSpec.args, timeoutMs);
  return {
    ...result,
    services: serviceEntries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      pm2Name: entry.pm2Name,
    })),
    command: commandSpec.command,
    args: commandSpec.args,
  };
}

module.exports = {
  listManagedRuntimeServices,
  restartManagedRuntimeServices,
};
