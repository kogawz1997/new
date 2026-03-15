'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForHttp(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: {
          'user-agent': 'scum-local-smoke-stack/1.0',
        },
      });
      if (res.status > 0) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const [adminPort, playerPort, agentPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ]);

  process.env.NODE_ENV = 'test';
  process.env.ADMIN_WEB_HOST = '127.0.0.1';
  process.env.ADMIN_WEB_PORT = String(adminPort);
  process.env.ADMIN_WEB_USER = process.env.ADMIN_WEB_USER || 'ci_admin';
  process.env.ADMIN_WEB_PASSWORD = process.env.ADMIN_WEB_PASSWORD || 'ci_admin_password';
  process.env.ADMIN_WEB_TOKEN = process.env.ADMIN_WEB_TOKEN || 'ci_admin_token';
  process.env.ADMIN_WEB_SSO_DISCORD_ENABLED = 'false';
  process.env.ADMIN_WEB_2FA_ENABLED = 'false';
  process.env.ADMIN_WEB_SECURE_COOKIE = 'false';
  process.env.ADMIN_WEB_HSTS_ENABLED = 'false';
  process.env.ADMIN_WEB_ALLOWED_ORIGINS = '';
  process.env.WEB_PORTAL_HOST = '127.0.0.1';
  process.env.WEB_PORTAL_PORT = String(playerPort);
  process.env.WEB_PORTAL_BASE_URL = `http://127.0.0.1:${playerPort}`;
  process.env.WEB_PORTAL_LEGACY_ADMIN_URL = `http://127.0.0.1:${adminPort}/admin`;
  process.env.WEB_PORTAL_PLAYER_OPEN_ACCESS = 'true';
  process.env.WEB_PORTAL_SECURE_COOKIE = 'false';
  process.env.WEB_PORTAL_DISCORD_CLIENT_ID =
    process.env.WEB_PORTAL_DISCORD_CLIENT_ID || 'local_smoke_portal_client_id';
  process.env.WEB_PORTAL_DISCORD_CLIENT_SECRET =
    process.env.WEB_PORTAL_DISCORD_CLIENT_SECRET || 'local_smoke_portal_client_secret';
  process.env.SCUM_CONSOLE_AGENT_HOST = '127.0.0.1';
  process.env.SCUM_CONSOLE_AGENT_PORT = String(agentPort);
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = `http://127.0.0.1:${agentPort}`;
  process.env.SCUM_CONSOLE_AGENT_TOKEN =
    process.env.SCUM_CONSOLE_AGENT_TOKEN || 'ci_agent_token_123456';
  process.env.SCUM_CONSOLE_AGENT_BACKEND = 'exec';
  process.env.SCUM_CONSOLE_AGENT_EXEC_TEMPLATE = process.env.SCUM_CONSOLE_AGENT_EXEC_TEMPLATE || '';

  const fakeClient = {
    guilds: { cache: new Map() },
    channels: { fetch: async () => null },
  };

  const { startAdminWebServer } = require(path.resolve(process.cwd(), 'src', 'adminWebServer.js'));
  const { startScumConsoleAgent } = require(path.resolve(process.cwd(), 'src', 'services', 'scumConsoleAgent.js'));
  const adminServer = startAdminWebServer(fakeClient);
  const agentRuntime = startScumConsoleAgent();

  if (!adminServer.listening) {
    await once(adminServer, 'listening');
  }
  await agentRuntime.ready;

  const playerChild = spawn(
    process.execPath,
    [path.resolve(process.cwd(), 'apps', 'web-portal-standalone', 'server.js')],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let portalStdout = '';
  let portalStderr = '';
  playerChild.stdout.on('data', (chunk) => {
    portalStdout += String(chunk);
  });
  playerChild.stderr.on('data', (chunk) => {
    portalStderr += String(chunk);
  });

  try {
    await waitForHttp(`http://127.0.0.1:${playerPort}/healthz`);
    const smokeScript = path.resolve(process.cwd(), 'scripts', 'post-deploy-smoke.js');
    await new Promise((resolve, reject) => {
      const smoke = spawn(
        process.execPath,
        [
          smokeScript,
          '--admin-base',
          `http://127.0.0.1:${adminPort}/admin`,
          '--player-base',
          `http://127.0.0.1:${playerPort}`,
          '--agent-health-url',
          `http://127.0.0.1:${agentPort}`,
          '--timeout-ms',
          '10000',
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: 'inherit',
        },
      );
      smoke.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Smoke exited with code ${code}`));
        }
      });
      smoke.on('error', reject);
    });
  } finally {
    if (!playerChild.killed) {
      playerChild.kill('SIGTERM');
    }
    await new Promise((resolve) => {
      playerChild.once('exit', () => resolve());
      setTimeout(resolve, 3000).unref?.();
    });
    await agentRuntime.close().catch(() => null);
    await new Promise((resolve) => adminServer.close(resolve));
  }

  if (playerChild.exitCode && playerChild.exitCode !== 0) {
    throw new Error(`Player portal exited unexpectedly.\nSTDOUT:\n${portalStdout}\nSTDERR:\n${portalStderr}`);
  }
}

main().catch((error) => {
  console.error('[local-smoke-stack] failed:', error.message);
  process.exit(1);
});
