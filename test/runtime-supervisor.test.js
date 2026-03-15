const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const runtimeSupervisorPath = path.join(
  rootDir,
  'src',
  'services',
  'runtimeSupervisorService.js',
);
const adminLiveBusPath = path.join(
  rootDir,
  'src',
  'services',
  'adminLiveBus.js',
);

const ENV_KEYS = [
  'RUNTIME_SUPERVISOR_TIMEOUT_MS',
  'RUNTIME_SUPERVISOR_CACHE_TTL_MS',
  'RUNTIME_SUPERVISOR_INTERVAL_MS',
  'RUNTIME_SUPERVISOR_ALERT_COOLDOWN_MS',
  'SCUM_WATCHER_BACKLOG_STALE_MS',
  'BOT_ENABLE_ADMIN_WEB',
  'BOT_ENABLE_SCUM_WEBHOOK',
  'BOT_ENABLE_RESTART_SCHEDULER',
  'BOT_ENABLE_RENTBIKE_SERVICE',
  'BOT_ENABLE_DELIVERY_WORKER',
  'BOT_HEALTH_HOST',
  'BOT_HEALTH_PORT',
  'WORKER_ENABLE_RENTBIKE',
  'WORKER_ENABLE_DELIVERY',
  'WORKER_HEALTH_HOST',
  'WORKER_HEALTH_PORT',
  'SCUM_LOG_PATH',
  'SCUM_WATCHER_ENABLED',
  'SCUM_WATCHER_REQUIRED',
  'SCUM_WATCHER_HEALTH_HOST',
  'SCUM_WATCHER_HEALTH_PORT',
  'ADMIN_WEB_HOST',
  'ADMIN_WEB_PORT',
  'WEB_PORTAL_HOST',
  'WEB_PORTAL_PORT',
  'WEB_PORTAL_BASE_URL',
  'DELIVERY_EXECUTION_MODE',
  'SCUM_CONSOLE_AGENT_ENABLED',
  'SCUM_CONSOLE_AGENT_REQUIRED',
  'SCUM_CONSOLE_AGENT_HOST',
  'SCUM_CONSOLE_AGENT_PORT',
  'SCUM_CONSOLE_AGENT_BASE_URL',
];

const originalEnv = new Map(
  ENV_KEYS.map((key) => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]),
);

function restoreEnv() {
  for (const [key, value] of originalEnv.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function installMock(modulePath, exportsValue) {
  delete require.cache[modulePath];
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  };
}

function loadRuntimeSupervisorWithMock(mockedAdminLiveBus) {
  delete require.cache[runtimeSupervisorPath];
  installMock(adminLiveBusPath, mockedAdminLiveBus);
  return require(runtimeSupervisorPath);
}

async function startJsonHealthServer(payloadFactory) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/healthz') {
      res.writeHead(404);
      res.end('not-found');
      return;
    }
    const payload =
      typeof payloadFactory === 'function' ? payloadFactory(req) : payloadFactory;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    host: '127.0.0.1',
    port: Number(address?.port || 0),
  };
}

test.afterEach(() => {
  restoreEnv();
  delete require.cache[runtimeSupervisorPath];
  delete require.cache[adminLiveBusPath];
});

test('runtime supervisor reports ready when all required runtimes are healthy', async (t) => {
  const alerts = [];
  const mockedAdminLiveBus = {
    publishAdminLiveUpdate: (type, payload) => {
      alerts.push({ type, payload });
    },
  };
  process.env.RUNTIME_SUPERVISOR_TIMEOUT_MS = '1000';
  process.env.SCUM_WATCHER_BACKLOG_STALE_MS = '1000';

  const bot = await startJsonHealthServer({
    ok: true,
    service: 'bot',
    discordReady: true,
    now: new Date().toISOString(),
  });
  const worker = await startJsonHealthServer({
    ok: true,
    service: 'worker',
    status: 'ready',
    ready: true,
    now: new Date().toISOString(),
  });
  const watcher = await startJsonHealthServer({
    ok: true,
    service: 'watcher',
    status: 'ready',
    ready: true,
    watch: {
      fileExists: true,
      backlogBytes: 0,
      backlogAgeMs: 0,
    },
  });
  const admin = await startJsonHealthServer({
    ok: true,
    data: {
      service: 'admin-web',
      now: new Date().toISOString(),
    },
  });
  const player = await startJsonHealthServer({
    ok: true,
    data: {
      mode: 'player',
      now: new Date().toISOString(),
    },
  });
  const agent = await startJsonHealthServer({
    ok: true,
    service: 'console-agent',
    ready: true,
    status: 'ready',
    statusCode: 'READY',
    now: new Date().toISOString(),
  });

  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => bot.server.close(resolve)),
      new Promise((resolve) => worker.server.close(resolve)),
      new Promise((resolve) => watcher.server.close(resolve)),
      new Promise((resolve) => admin.server.close(resolve)),
      new Promise((resolve) => player.server.close(resolve)),
      new Promise((resolve) => agent.server.close(resolve)),
    ]);
  });

  process.env.BOT_ENABLE_ADMIN_WEB = 'true';
  process.env.BOT_ENABLE_SCUM_WEBHOOK = 'false';
  process.env.BOT_ENABLE_RESTART_SCHEDULER = 'false';
  process.env.BOT_ENABLE_RENTBIKE_SERVICE = 'false';
  process.env.BOT_ENABLE_DELIVERY_WORKER = 'false';
  process.env.BOT_HEALTH_HOST = bot.host;
  process.env.BOT_HEALTH_PORT = String(bot.port);

  process.env.WORKER_ENABLE_RENTBIKE = 'false';
  process.env.WORKER_ENABLE_DELIVERY = 'true';
  process.env.WORKER_HEALTH_HOST = worker.host;
  process.env.WORKER_HEALTH_PORT = String(worker.port);

  process.env.SCUM_LOG_PATH = 'C:\\fake\\SCUM.log';
  process.env.SCUM_WATCHER_ENABLED = 'true';
  process.env.SCUM_WATCHER_REQUIRED = 'true';
  process.env.SCUM_WATCHER_HEALTH_HOST = watcher.host;
  process.env.SCUM_WATCHER_HEALTH_PORT = String(watcher.port);

  process.env.ADMIN_WEB_HOST = admin.host;
  process.env.ADMIN_WEB_PORT = String(admin.port);

  process.env.WEB_PORTAL_HOST = player.host;
  process.env.WEB_PORTAL_PORT = String(player.port);
  delete process.env.WEB_PORTAL_BASE_URL;

  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_HOST = agent.host;
  process.env.SCUM_CONSOLE_AGENT_PORT = String(agent.port);
  process.env.SCUM_CONSOLE_AGENT_REQUIRED = 'true';
  delete process.env.SCUM_CONSOLE_AGENT_BASE_URL;

  const {
    collectRuntimeSupervisorSnapshot,
  } = loadRuntimeSupervisorWithMock(mockedAdminLiveBus);

  const snapshot = await collectRuntimeSupervisorSnapshot();

  assert.equal(snapshot.overall, 'ready');
  assert.equal(snapshot.counts.required, 6);
  assert.equal(snapshot.counts.ready, 6);
  assert.equal(snapshot.counts.degraded, 0);
  assert.equal(snapshot.counts.offline, 0);
  assert.equal(alerts.length, 0);
});

test('runtime supervisor marks degraded watcher and emits an alert', async (t) => {
  const alerts = [];
  const mockedAdminLiveBus = {
    publishAdminLiveUpdate: (type, payload) => {
      alerts.push({ type, payload });
    },
  };
  process.env.RUNTIME_SUPERVISOR_TIMEOUT_MS = '1000';
  process.env.SCUM_WATCHER_BACKLOG_STALE_MS = '1000';

  const watcher = await startJsonHealthServer({
    ok: true,
    service: 'watcher',
    status: 'degraded',
    ready: false,
    watch: {
      fileExists: true,
      backlogBytes: 128,
      backlogAgeMs: 5000,
    },
  });

  t.after(async () => {
    await new Promise((resolve) => watcher.server.close(resolve));
  });

  process.env.BOT_ENABLE_ADMIN_WEB = 'false';
  process.env.BOT_ENABLE_SCUM_WEBHOOK = 'false';
  process.env.BOT_ENABLE_RESTART_SCHEDULER = 'false';
  process.env.BOT_ENABLE_RENTBIKE_SERVICE = 'false';
  process.env.BOT_ENABLE_DELIVERY_WORKER = 'false';
  delete process.env.BOT_HEALTH_HOST;
  delete process.env.BOT_HEALTH_PORT;

  process.env.WORKER_ENABLE_RENTBIKE = 'false';
  process.env.WORKER_ENABLE_DELIVERY = 'false';
  delete process.env.WORKER_HEALTH_HOST;
  delete process.env.WORKER_HEALTH_PORT;

  process.env.SCUM_LOG_PATH = 'C:\\fake\\SCUM.log';
  process.env.SCUM_WATCHER_ENABLED = 'true';
  process.env.SCUM_WATCHER_REQUIRED = 'true';
  process.env.SCUM_WATCHER_HEALTH_HOST = watcher.host;
  process.env.SCUM_WATCHER_HEALTH_PORT = String(watcher.port);

  delete process.env.ADMIN_WEB_HOST;
  delete process.env.ADMIN_WEB_PORT;
  delete process.env.WEB_PORTAL_HOST;
  delete process.env.WEB_PORTAL_PORT;
  delete process.env.WEB_PORTAL_BASE_URL;
  delete process.env.DELIVERY_EXECUTION_MODE;
  delete process.env.SCUM_CONSOLE_AGENT_HOST;
  delete process.env.SCUM_CONSOLE_AGENT_PORT;
  delete process.env.SCUM_CONSOLE_AGENT_BASE_URL;

  const {
    collectRuntimeSupervisorSnapshot,
  } = loadRuntimeSupervisorWithMock(mockedAdminLiveBus);

  const snapshot = await collectRuntimeSupervisorSnapshot();
  const watcherEntry = snapshot.items.find((item) => item.key === 'watcher');

  assert.equal(snapshot.overall, 'degraded');
  assert.equal(watcherEntry?.status, 'degraded');
  assert.equal(watcherEntry?.reason, 'log-backlog');
  assert.ok(
    alerts.some(
      (entry) =>
        entry.type === 'ops-alert'
        && entry.payload?.kind === 'runtime-degraded'
        && entry.payload?.runtimeKey === 'watcher',
    ),
  );
});

test('runtime supervisor does not alert optional watcher or console-agent when delivery mode does not require them', async (t) => {
  const alerts = [];
  const mockedAdminLiveBus = {
    publishAdminLiveUpdate: (type, payload) => {
      alerts.push({ type, payload });
    },
  };
  const {
    collectRuntimeSupervisorSnapshot,
  } = loadRuntimeSupervisorWithMock(mockedAdminLiveBus);

  const watcher = await startJsonHealthServer({
    ok: true,
    service: 'watcher',
    status: 'degraded',
    ready: false,
    watch: {
      fileExists: false,
      backlogBytes: 0,
      backlogAgeMs: 0,
    },
  });
  const agent = await startJsonHealthServer({
    ok: true,
    service: 'console-agent',
    status: 'degraded',
    ready: false,
    reason: 'AGENT_EXEC_TEMPLATE_MISSING',
  });

  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => watcher.server.close(resolve)),
      new Promise((resolve) => agent.server.close(resolve)),
    ]);
  });

  process.env.BOT_ENABLE_ADMIN_WEB = 'false';
  process.env.BOT_ENABLE_SCUM_WEBHOOK = 'false';
  process.env.BOT_ENABLE_RESTART_SCHEDULER = 'false';
  process.env.BOT_ENABLE_RENTBIKE_SERVICE = 'false';
  process.env.BOT_ENABLE_DELIVERY_WORKER = 'false';
  process.env.WORKER_ENABLE_RENTBIKE = 'false';
  process.env.WORKER_ENABLE_DELIVERY = 'false';
  delete process.env.SCUM_LOG_PATH;
  process.env.SCUM_WATCHER_HEALTH_HOST = watcher.host;
  process.env.SCUM_WATCHER_HEALTH_PORT = String(watcher.port);
  delete process.env.SCUM_WATCHER_REQUIRED;
  process.env.DELIVERY_EXECUTION_MODE = 'rcon';
  process.env.SCUM_CONSOLE_AGENT_HOST = agent.host;
  process.env.SCUM_CONSOLE_AGENT_PORT = String(agent.port);
  delete process.env.SCUM_CONSOLE_AGENT_REQUIRED;
  delete process.env.ADMIN_WEB_HOST;
  delete process.env.ADMIN_WEB_PORT;
  delete process.env.WEB_PORTAL_HOST;
  delete process.env.WEB_PORTAL_PORT;
  delete process.env.WEB_PORTAL_BASE_URL;

  const snapshot = await collectRuntimeSupervisorSnapshot();
  const watcherEntry = snapshot.items.find((item) => item.key === 'watcher');
  const agentEntry = snapshot.items.find((item) => item.key === 'console-agent');

  assert.equal(snapshot.overall, 'ready');
  assert.equal(Boolean(watcherEntry?.required), false);
  assert.equal(Boolean(agentEntry?.required), false);
  assert.equal(snapshot.counts.required, 0);
  assert.equal(alerts.length, 0);
});
