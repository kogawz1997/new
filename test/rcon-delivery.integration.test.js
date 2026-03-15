const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const rconDeliveryPath = path.join(rootDir, 'src', 'services', 'rconDelivery.js');
const depPaths = {
  config: path.join(rootDir, 'src', 'config.js'),
  persist: path.join(rootDir, 'src', 'store', '_persist.js'),
  prisma: path.join(rootDir, 'src', 'prisma.js'),
  linkStore: path.join(rootDir, 'src', 'store', 'linkStore.js'),
  deliveryAuditStore: path.join(rootDir, 'src', 'store', 'deliveryAuditStore.js'),
  deliveryEvidenceStore: path.join(rootDir, 'src', 'store', 'deliveryEvidenceStore.js'),
  memoryStore: path.join(rootDir, 'src', 'store', 'memoryStore.js'),
  adminLiveBus: path.join(rootDir, 'src', 'services', 'adminLiveBus.js'),
  itemIconService: path.join(rootDir, 'src', 'services', 'itemIconService.js'),
  wikiWeaponCatalog: path.join(
    rootDir,
    'src',
    'services',
    'wikiWeaponCatalog.js',
  ),
  wikiItemManifestCatalog: path.join(
    rootDir,
    'src',
    'services',
    'wikiItemManifestCatalog.js',
  ),
};

const DELIVERY_ENV_KEYS = [
  'RCON_EXEC_TEMPLATE',
  'RCON_HOST',
  'RCON_PORT',
  'RCON_PASSWORD',
  'RCON_PROTOCOL',
  'DELIVERY_EXECUTION_MODE',
  'DELIVERY_QUEUE_INTERVAL_MS',
  'DELIVERY_MAX_RETRIES',
  'DELIVERY_RETRY_DELAY_MS',
  'DELIVERY_RETRY_BACKOFF',
  'DELIVERY_COMMAND_TIMEOUT_MS',
  'DELIVERY_FAILED_STATUS',
  'DELIVERY_WIKI_WEAPON_COMMAND_FALLBACK_ENABLED',
  'DELIVERY_ITEM_MANIFEST_COMMAND_FALLBACK_ENABLED',
  'SCUM_CONSOLE_AGENT_BASE_URL',
  'SCUM_CONSOLE_AGENT_TOKEN',
  'SCUM_CONSOLE_AGENT_BACKEND',
  'SCUM_CONSOLE_AGENT_EXEC_TEMPLATE',
  'DELIVERY_AGENT_PRE_COMMANDS_JSON',
  'DELIVERY_AGENT_POST_COMMANDS_JSON',
  'DELIVERY_AGENT_COMMAND_DELAY_MS',
  'DELIVERY_AGENT_POST_TELEPORT_DELAY_MS',
  'DELIVERY_AGENT_FAILOVER_MODE',
  'DELIVERY_AGENT_CIRCUIT_BREAKER_THRESHOLD',
  'DELIVERY_AGENT_CIRCUIT_BREAKER_COOLDOWN_MS',
  'DELIVERY_MAGAZINE_STACKCOUNT',
  'DELIVERY_AGENT_TELEPORT_MODE',
  'DELIVERY_AGENT_TELEPORT_TARGET',
  'DELIVERY_AGENT_RETURN_TARGET',
  'DELIVERY_VERIFY_MODE',
  'DELIVERY_VERIFY_SUCCESS_REGEX',
  'DELIVERY_VERIFY_FAILURE_REGEX',
  'DELIVERY_VERIFY_OBSERVER_WINDOW_MS',
  'SCUM_WATCHER_HEALTH_HOST',
  'SCUM_WATCHER_HEALTH_PORT',
  'WORKER_ENABLE_DELIVERY',
  'BOT_ENABLE_DELIVERY_WORKER',
  'WORKER_HEALTH_HOST',
  'WORKER_HEALTH_PORT',
];

function restoreDeliveryEnvBaseline() {
  for (const key of DELIVERY_ENV_KEYS) {
    delete process.env[key];
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

function loadRconDeliveryWithMocks(mocks) {
  delete require.cache[rconDeliveryPath];
  installMock(depPaths.config, mocks.config);
  installMock(depPaths.persist, mocks.persist);
  installMock(depPaths.prisma, mocks.prisma);
  installMock(depPaths.linkStore, mocks.linkStore);
  installMock(depPaths.deliveryAuditStore, mocks.deliveryAuditStore);
  installMock(depPaths.deliveryEvidenceStore, mocks.deliveryEvidenceStore);
  installMock(depPaths.memoryStore, mocks.memoryStore);
  installMock(depPaths.adminLiveBus, mocks.adminLiveBus);
  installMock(depPaths.itemIconService, mocks.itemIconService);
  installMock(depPaths.wikiWeaponCatalog, mocks.wikiWeaponCatalog);
  installMock(depPaths.wikiItemManifestCatalog, mocks.wikiItemManifestCatalog);
  return require(rconDeliveryPath);
}

function makeTestContext(overrides = {}) {
  const purchases = new Map();
  const shopItems = new Map();
  const links = new Map([
    ['u-1', { steamId: '76561198000000001' }],
  ]);
  const audits = [];
  const evidenceByCode = new Map();
  const liveEvents = [];
  const statuses = [];

  const config = {
    channels: {
      shopLog: 'shop-log',
      adminLog: 'admin-log',
    },
    delivery: {
      auto: {
        enabled: true,
        queueIntervalMs: 100,
        maxRetries: 1,
        retryDelayMs: 10,
        retryBackoff: 1,
        commandTimeoutMs: 2000,
        failedStatus: 'delivery_failed',
        itemCommands: {},
      },
    },
    ...overrides.config,
  };

  const mocks = {
    config,
    persist: {
      loadJson: () => null,
      saveJsonDebounced: () => () => {},
    },
    prisma: {
      prisma: {
        deliveryQueueJob: {
          findMany: async () => [],
          upsert: async () => null,
          create: async () => null,
          deleteMany: async () => ({ count: 0 }),
        },
        deliveryDeadLetter: {
          findMany: async () => [],
          upsert: async () => null,
          create: async () => null,
          deleteMany: async () => ({ count: 0 }),
        },
      },
    },
    linkStore: {
      getLinkByUserId: (userId) => links.get(String(userId)) || null,
    },
    deliveryAuditStore: {
      addDeliveryAudit: (entry) => {
        audits.push(entry);
      },
      listDeliveryAudit: () => audits.slice(),
    },
    deliveryEvidenceStore: {
      appendDeliveryEvidenceEvent: (purchaseCode, payload = {}) => {
        const code = String(purchaseCode || '').trim();
        if (!code) return null;
        const current = evidenceByCode.get(code) || {
          purchaseCode: code,
          tenantId: String(payload.tenantId || '').trim() || null,
          events: [],
        };
        current.updatedAt = payload.at || new Date().toISOString();
        current.status = payload.status || current.status || null;
        current.tenantId = String(payload.tenantId || current.tenantId || '').trim() || null;
        current.execution = payload.execution || current.execution || null;
        current.latestOutputs = Array.isArray(payload.latestOutputs) ? payload.latestOutputs : [];
        current.latestCommandSummary = payload.latestCommandSummary || null;
        current.events.push({
          at: payload.at || current.updatedAt,
          level: payload.level || 'info',
          action: payload.action || 'event',
          message: payload.message || null,
          meta: payload.meta || null,
        });
        evidenceByCode.set(code, current);
        return { ...current, filePath: `mock://delivery-evidence/${code}.json` };
      },
      getDeliveryEvidence: (purchaseCode) => {
        const code = String(purchaseCode || '').trim();
        if (!code || !evidenceByCode.has(code)) return null;
        return {
          ...evidenceByCode.get(code),
          filePath: `mock://delivery-evidence/${code}.json`,
        };
      },
    },
    memoryStore: {
      findPurchaseByCode: async (code) => purchases.get(String(code)) || null,
      setPurchaseStatusByCode: async (code, status) => {
        const item = purchases.get(String(code));
        if (!item) return null;
        item.status = status;
        statuses.push({ code: String(code), status });
        return { ...item };
      },
      getShopItemById: async (id) => shopItems.get(String(id)) || null,
      listPurchaseStatusHistory: async (code) =>
        statuses
          .filter((entry) => entry.code === String(code))
          .map((entry) => ({
            purchaseCode: entry.code,
            toStatus: entry.status,
            createdAt: new Date().toISOString(),
          })),
    },
    adminLiveBus: {
      publishAdminLiveUpdate: (type, payload) => {
        liveEvents.push({ type, payload });
      },
    },
    itemIconService: {
      resolveItemIconUrl: () => null,
      normalizeItemIconKey: (value) =>
        String(value || '')
          .replace(/\\/g, '/')
          .replace(/^.*\//, '')
          .replace(/\.(webp|png|jpg|jpeg)$/i, '')
          .replace(/[-\s]+/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '')
          .toLowerCase(),
    },
    wikiWeaponCatalog: {
      resolveWikiWeaponCommandTemplate: () => null,
    },
    wikiItemManifestCatalog: {
      resolveManifestItemCommandTemplate: () => null,
    },
  };

  return {
    mocks,
    purchases,
    shopItems,
    links,
    audits,
    evidenceByCode,
    liveEvents,
    statuses,
  };
}

test.beforeEach(() => {
  restoreDeliveryEnvBaseline();
});

test.afterEach(() => {
  restoreDeliveryEnvBaseline();
  delete require.cache[rconDeliveryPath];
  for (const dep of Object.values(depPaths)) {
    delete require.cache[dep];
  }
});

function startFakeAgentServer(options = {}) {
  const received = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/execute') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(raw || '{}');
        received.push(payload.command);
        if (typeof options.onExecute === 'function') {
          const custom = options.onExecute(payload.command, payload);
          if (custom && typeof custom === 'object') {
            const statusCode = Number(custom.statusCode || 200);
            res.writeHead(statusCode, {
              'Content-Type': 'application/json; charset=utf-8',
            });
            res.end(JSON.stringify(custom.body || {}));
            return;
          }
        }
        const body = JSON.stringify({
          ok: true,
          result: {
            backend: 'fake-agent',
            stdout: `EXECUTED:${payload.command}`,
            stderr: '',
          },
        });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(body);
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/healthz') {
      if (typeof options.onHealth === 'function') {
        const custom = options.onHealth();
        if (custom && typeof custom === 'object') {
          res.writeHead(Number(custom.statusCode || 200), {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(JSON.stringify(custom.body || {}));
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ready: true, status: 'ready' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/preflight') {
      if (typeof options.onPreflight === 'function') {
        const custom = options.onPreflight();
        if (custom && typeof custom === 'object') {
          res.writeHead(Number(custom.statusCode || 200), {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(JSON.stringify(custom.body || {}));
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          ready: true,
          status: 'ready',
          statusCode: 'READY',
          result: {
            ok: true,
            backend: 'fake-agent',
            mode: 'preflight',
          },
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        received,
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('purchase -> queue -> auto-delivery success for bundle item', async () => {
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';
  const ctx = makeTestContext();

  ctx.mocks.config.delivery.auto.itemCommands = {
    'bundle-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.purchases.set('P-100', {
    code: 'P-100',
    tenantId: 'tenant-bundle',
    userId: 'u-1',
    itemId: 'bundle-ak',
    status: 'pending',
  });
  ctx.shopItems.set('bundle-ak', {
    id: 'bundle-ak',
    name: 'AK Bundle',
    kind: 'item',
    deliveryItems: [
      { gameItemId: 'Weapon_AK47', quantity: 2, iconUrl: null },
      { gameItemId: 'Ammo_762', quantity: 150, iconUrl: null },
    ],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const queued = await api.enqueuePurchaseDeliveryByCode('P-100', {
    guildId: 'g-1',
  });
  assert.equal(queued.ok, true);
  assert.equal(api.listDeliveryQueue().length, 1);
  assert.equal(String(api.listDeliveryQueue()[0]?.tenantId || ''), 'tenant-bundle');

  const processed = await api.processDeliveryQueueNow(5);
  assert.equal(processed.processed, 1);
  assert.equal(api.listDeliveryQueue().length, 0);
  assert.equal(ctx.purchases.get('P-100').status, 'delivered');

  const successAudit = ctx.audits.find((entry) => entry.action === 'success');
  assert.ok(successAudit, 'expected success audit entry');
  const commands = successAudit.meta.outputs.map((entry) => entry.command);
  assert.deepEqual(commands, [
    '#SpawnItem 76561198000000001 Weapon_AK47 2',
    '#SpawnItem 76561198000000001 Ammo_762 150',
  ]);
  assert.equal(String(successAudit.tenantId || ''), 'tenant-bundle');
  assert.equal(successAudit.meta.executionMode, 'rcon');
  assert.equal(successAudit.meta.backend, 'rcon-template');
  assert.match(String(successAudit.meta.commandPath || ''), /rcon/i);
  assert.equal(successAudit.meta.retryCount, 0);
  const purchaseAudits = ctx.audits.filter((entry) => entry.purchaseCode === 'P-100');
  assert.equal(
    purchaseAudits.every((entry) => {
      return Boolean(
        entry.meta
          && typeof entry.meta.executionMode === 'string'
          && typeof entry.meta.commandPath === 'string'
          && Number.isInteger(Number(entry.meta.retryCount))
          && typeof entry.meta.backend === 'string',
      );
    }),
    true,
  );

  const detail = await api.getDeliveryDetailsByPurchaseCode('P-100');
  assert.equal(detail.evidence?.purchaseCode, 'P-100');
  assert.equal(String(detail.evidence?.tenantId || ''), 'tenant-bundle');
  assert.match(String(detail.evidence?.filePath || ''), /delivery-evidence/i);
  assert.equal(String(detail.evidence?.execution?.executionMode || ''), 'rcon');
  assert.ok(Array.isArray(detail.evidence?.events));
  assert.ok(
    detail.evidence.events.some((entry) => String(entry?.action || '') === 'success'),
  );
});

test('purchase -> queue -> auto-delivery success via console agent mode', async () => {
  const agent = await startFakeAgentServer();
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-1234567890';

  const ctx = makeTestContext();
  ctx.mocks.config.delivery.auto.itemCommands = {
    'agent-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.purchases.set('P-125', {
    code: 'P-125',
    userId: 'u-1',
    itemId: 'agent-ak',
    status: 'pending',
  });
  ctx.shopItems.set('agent-ak', {
    id: 'agent-ak',
    name: 'Agent AK',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queued = await api.enqueuePurchaseDeliveryByCode('P-125', {
      guildId: 'g-1',
    });
    assert.equal(queued.ok, true);

    const processed = await api.processDeliveryQueueNow(5);
    assert.equal(processed.processed, 1);
    assert.equal(ctx.purchases.get('P-125').status, 'delivered');
    assert.deepEqual(agent.received, [
      '#SpawnItem Weapon_AK47 1',
    ]);

    const successAudit = ctx.audits.find(
      (entry) => entry.action === 'success' && entry.purchaseCode === 'P-125',
    );
    assert.ok(successAudit, 'expected success audit entry');
    assert.equal(successAudit.meta.outputs[0].mode, 'agent');
    assert.equal(successAudit.meta.commandSummary, '#SpawnItem Weapon_AK47 1');
    assert.match(String(successAudit.message || ''), /#SpawnItem Weapon_AK47 1/);
  } finally {
    await agent.close();
  }
});

test('agent enqueue is blocked when preflight fails before the job reaches the queue', async () => {
  const agent = await startFakeAgentServer({
    onPreflight: () => ({
      statusCode: 500,
      body: {
        ok: false,
        errorCode: 'AGENT_PREFLIGHT_FAILED',
        error: 'SCUM admin client is not ready',
        result: {
          ok: false,
          backend: 'fake-agent',
        },
      },
    }),
  });
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-preflight-block';
  process.env.DELIVERY_AGENT_FAILOVER_MODE = 'none';

  const ctx = makeTestContext();
  ctx.mocks.config.delivery.auto.itemCommands = {
    'agent-blocked-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };
  ctx.purchases.set('P-125B', {
    code: 'P-125B',
    userId: 'u-1',
    itemId: 'agent-blocked-ak',
    status: 'pending',
  });
  ctx.shopItems.set('agent-blocked-ak', {
    id: 'agent-blocked-ak',
    name: 'Blocked Agent Item',
    kind: 'item',
    gameItemId: 'Weapon_AK47',
    quantity: 1,
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queued = await api.enqueuePurchaseDeliveryByCode('P-125B', {
      guildId: 'g-1',
    });
    assert.equal(queued.ok, false);
    assert.equal(queued.reason, 'agent-preflight-failed');
    assert.equal(api.listDeliveryQueue().length, 0);
    assert.equal(ctx.purchases.get('P-125B').status, 'pending');
    assert.equal(ctx.statuses.length, 0);

    const blockedAudit = ctx.audits.find(
      (entry) => entry.action === 'enqueue-blocked' && entry.purchaseCode === 'P-125B',
    );
    assert.ok(blockedAudit, 'expected enqueue-blocked audit entry');
    assert.equal(blockedAudit.meta.executionMode, 'agent');
    assert.equal(blockedAudit.meta.backend, 'exec');
    assert.match(String(blockedAudit.meta.commandPath || ''), /queue->console-agent/i);
    assert.equal(blockedAudit.meta.retryCount, 0);
  } finally {
    await agent.close();
  }
});

test('agent mode verification succeeds when output-match regex matches command output', async () => {
  const agent = await startFakeAgentServer();
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-verify-success';
  process.env.DELIVERY_VERIFY_MODE = 'output-match';
  process.env.DELIVERY_VERIFY_SUCCESS_REGEX = 'EXECUTED:#SpawnItem Weapon_AK47 1';

  const ctx = makeTestContext();
  ctx.mocks.config.delivery.auto.itemCommands = {
    'agent-verify-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.purchases.set('P-125V', {
    code: 'P-125V',
    userId: 'u-1',
    itemId: 'agent-verify-ak',
    status: 'pending',
  });
  ctx.shopItems.set('agent-verify-ak', {
    id: 'agent-verify-ak',
    name: 'Agent Verify AK',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queued = await api.enqueuePurchaseDeliveryByCode('P-125V', {
      guildId: 'g-1',
    });
    assert.equal(queued.ok, true);

    const processed = await api.processDeliveryQueueNow(5);
    assert.equal(processed.processed, 1);
    assert.equal(ctx.purchases.get('P-125V').status, 'delivered');

    const verifyAudit = ctx.audits.find(
      (entry) => entry.action === 'verify-ok' && entry.purchaseCode === 'P-125V',
    );
    assert.ok(verifyAudit, 'expected verify-ok audit entry');

    const successAudit = ctx.audits.find(
      (entry) => entry.action === 'success' && entry.purchaseCode === 'P-125V',
    );
    assert.ok(successAudit, 'expected success audit entry');
    assert.equal(Boolean(successAudit.meta?.verification?.ok), true);
    assert.equal(String(successAudit.meta?.verification?.mode || ''), 'output-match');
  } finally {
    await agent.close();
  }
});

test('agent mode verification failure moves job to dead-letter after command execution', async () => {
  const agent = await startFakeAgentServer();
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-verify-fail';
  process.env.DELIVERY_VERIFY_MODE = 'output-match';
  process.env.DELIVERY_VERIFY_SUCCESS_REGEX = 'THIS_WILL_NOT_MATCH';

  const ctx = makeTestContext({
    config: {
      delivery: {
        auto: {
          enabled: true,
          queueIntervalMs: 100,
          maxRetries: 0,
          retryDelayMs: 10,
          retryBackoff: 1,
          commandTimeoutMs: 2000,
          failedStatus: 'delivery_failed',
          itemCommands: {
            'agent-verify-fail-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
          },
        },
      },
    },
  });

  ctx.purchases.set('P-125F', {
    code: 'P-125F',
    userId: 'u-1',
    itemId: 'agent-verify-fail-ak',
    status: 'pending',
  });
  ctx.shopItems.set('agent-verify-fail-ak', {
    id: 'agent-verify-fail-ak',
    name: 'Agent Verify Fail AK',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queued = await api.enqueuePurchaseDeliveryByCode('P-125F', {
      guildId: 'g-1',
    });
    assert.equal(queued.ok, true);

    const processed = await api.processDeliveryQueueNow(5);
    assert.equal(processed.processed, 1);
    assert.equal(ctx.purchases.get('P-125F').status, 'delivery_failed');
    assert.equal(api.listDeliveryQueue().length, 0);
    assert.equal(api.listDeliveryDeadLetters().length, 1);

    const verifyAudit = ctx.audits.find(
      (entry) => entry.action === 'verify-failed' && entry.purchaseCode === 'P-125F',
    );
    assert.ok(verifyAudit, 'expected verify-failed audit entry');
    assert.match(String(verifyAudit.message || ''), /verification failed/i);
  } finally {
    await agent.close();
  }
});

test('agent mode falls back to RCON when agent preflight is unreachable and failover is enabled', async () => {
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.DELIVERY_AGENT_FAILOVER_MODE = 'rcon';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = 'http://127.0.0.1:39999';
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-failover-preflight';
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';

  const ctx = makeTestContext();
  ctx.mocks.config.delivery.auto.itemCommands = {
    'agent-failover-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.purchases.set('P-125R', {
    code: 'P-125R',
    userId: 'u-1',
    itemId: 'agent-failover-ak',
    status: 'pending',
  });
  ctx.shopItems.set('agent-failover-ak', {
    id: 'agent-failover-ak',
    name: 'Agent Failover AK',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const queued = await api.enqueuePurchaseDeliveryByCode('P-125R', {
    guildId: 'g-1',
  });
  assert.equal(queued.ok, true);

  const processed = await api.processDeliveryQueueNow(5);
  assert.equal(processed.processed, 1);
  assert.equal(ctx.purchases.get('P-125R').status, 'delivered');

  const successAudit = ctx.audits.find(
    (entry) => entry.action === 'success' && entry.purchaseCode === 'P-125R',
  );
  assert.ok(successAudit, 'expected success audit entry');
  assert.equal(String(successAudit.meta?.outputs?.[0]?.mode || ''), 'rcon');

  const failoverAudit = ctx.audits.find(
    (entry) => entry.action === 'failover-engaged' && entry.purchaseCode === 'P-125R',
  );
  assert.ok(failoverAudit, 'expected failover audit entry');
});

test('agent circuit breaker opens after command failure and next delivery uses RCON failover', async () => {
  const agent = await startFakeAgentServer({
    onExecute() {
      return {
        statusCode: 500,
        body: {
          ok: false,
          errorCode: 'AGENT_EXEC_BROKEN',
          error: 'simulated execute failure',
        },
      };
    },
  });
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.DELIVERY_AGENT_FAILOVER_MODE = 'rcon';
  process.env.DELIVERY_AGENT_CIRCUIT_BREAKER_THRESHOLD = '1';
  process.env.DELIVERY_AGENT_CIRCUIT_BREAKER_COOLDOWN_MS = '60000';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-circuit-open';
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';

  const ctx = makeTestContext({
    config: {
      delivery: {
        auto: {
          enabled: true,
          queueIntervalMs: 100,
          maxRetries: 0,
          retryDelayMs: 10,
          retryBackoff: 1,
          commandTimeoutMs: 2000,
          failedStatus: 'delivery_failed',
          itemCommands: {
            'agent-circuit-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
          },
        },
      },
    },
  });

  ctx.purchases.set('P-125C1', {
    code: 'P-125C1',
    userId: 'u-1',
    itemId: 'agent-circuit-ak',
    status: 'pending',
  });
  ctx.purchases.set('P-125C2', {
    code: 'P-125C2',
    userId: 'u-1',
    itemId: 'agent-circuit-ak',
    status: 'pending',
  });
  ctx.shopItems.set('agent-circuit-ak', {
    id: 'agent-circuit-ak',
    name: 'Agent Circuit AK',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queuedFirst = await api.enqueuePurchaseDeliveryByCode('P-125C1', {
      guildId: 'g-1',
    });
    assert.equal(queuedFirst.ok, true);

    const firstProcessed = await api.processDeliveryQueueNow(5);
    assert.equal(firstProcessed.processed, 1);
    assert.equal(ctx.purchases.get('P-125C1').status, 'delivery_failed');

    const queuedSecond = await api.enqueuePurchaseDeliveryByCode('P-125C2', {
      guildId: 'g-1',
    });
    assert.equal(queuedSecond.ok, true);

    const secondProcessed = await api.processDeliveryQueueNow(5);
    assert.equal(secondProcessed.processed, 1);
    assert.equal(ctx.purchases.get('P-125C2').status, 'delivered');

    const failoverAudit = ctx.audits.find(
      (entry) => entry.action === 'failover-engaged' && entry.purchaseCode === 'P-125C2',
    );
    assert.ok(failoverAudit, 'expected failover audit entry on second job');

    const successAudit = ctx.audits.find(
      (entry) => entry.action === 'success' && entry.purchaseCode === 'P-125C2',
    );
    assert.ok(successAudit, 'expected success audit for second job');
    assert.equal(String(successAudit.meta?.outputs?.[0]?.mode || ''), 'rcon');
  } finally {
    await agent.close();
  }
});

test('agent mode runs teleport hook before spawn and return hook after spawn', async () => {
  const agent = await startFakeAgentServer();
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-1234567890';
  process.env.DELIVERY_AGENT_PRE_COMMANDS_JSON =
    '["#TeleportTo {teleportTargetQuoted}"]';
  process.env.DELIVERY_AGENT_POST_COMMANDS_JSON =
    '["#TeleportTo {returnTargetQuoted}"]';
  process.env.DELIVERY_AGENT_RETURN_TARGET = 'Admin Anchor';
  process.env.DELIVERY_AGENT_COMMAND_DELAY_MS = '0';

  const ctx = makeTestContext();
  ctx.links.set('u-1', {
    steamId: '76561198000000001',
    inGameName: 'Coke TAMTHAI',
  });
  ctx.mocks.config.delivery.auto.itemCommands = {
    'agent-ak-teleport': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.purchases.set('P-126', {
    code: 'P-126',
    userId: 'u-1',
    itemId: 'agent-ak-teleport',
    status: 'pending',
  });
  ctx.shopItems.set('agent-ak-teleport', {
    id: 'agent-ak-teleport',
    name: 'Agent AK Teleport',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queued = await api.enqueuePurchaseDeliveryByCode('P-126', {
      guildId: 'g-1',
    });
    assert.equal(queued.ok, true);

    const processed = await api.processDeliveryQueueNow(5);
    assert.equal(processed.processed, 1);
    assert.equal(ctx.purchases.get('P-126').status, 'delivered');
    assert.deepEqual(agent.received, [
      '#TeleportTo "Coke TAMTHAI"',
      '#SpawnItem Weapon_AK47 1',
      '#TeleportTo "Admin Anchor"',
    ]);

    const successAudit = ctx.audits.find(
      (entry) => entry.action === 'success' && entry.purchaseCode === 'P-126',
    );
    assert.ok(successAudit, 'expected success audit entry');
    assert.deepEqual(
      successAudit.meta.outputs.map((entry) => entry.phase),
      ['pre', 'item', 'post'],
    );
  } finally {
    await agent.close();
  }
});

test('agent mode adds StackCount for magazine items', async () => {
  const agent = await startFakeAgentServer();
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-1234567890';
  process.env.DELIVERY_AGENT_COMMAND_DELAY_MS = '0';

  const ctx = makeTestContext();
  ctx.links.set('u-1', {
    steamId: '76561198000000001',
    inGameName: 'Coke TAMTHAI',
  });
  ctx.mocks.config.delivery.auto.itemCommands = {
    'agent-mag': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.purchases.set('P-126M', {
    code: 'P-126M',
    userId: 'u-1',
    itemId: 'agent-mag',
    status: 'pending',
  });
  ctx.shopItems.set('agent-mag', {
    id: 'agent-mag',
    name: 'Agent Magazine',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Magazine_M1911', quantity: 1, iconUrl: null }],
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queued = await api.enqueuePurchaseDeliveryByCode('P-126M', {
      guildId: 'g-1',
    });
    assert.equal(queued.ok, true);

    const processed = await api.processDeliveryQueueNow(5);
    assert.equal(processed.processed, 1);
    assert.equal(ctx.purchases.get('P-126M').status, 'delivered');
    assert.deepEqual(agent.received, [
      '#SpawnItem Magazine_M1911 1 StackCount 100',
    ]);
  } finally {
    await agent.close();
  }
});

test('item-level delivery profile overrides global agent hooks', async () => {
  const agent = await startFakeAgentServer();
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-1234567890';
  process.env.DELIVERY_AGENT_PRE_COMMANDS_JSON =
    '["#Announce GLOBAL-FALLBACK"]';
  process.env.DELIVERY_AGENT_COMMAND_DELAY_MS = '0';

  const ctx = makeTestContext();
  ctx.links.set('u-1', {
    steamId: '76561198000000001',
    inGameName: 'Coke TAMTHAI',
  });
  ctx.mocks.config.delivery.auto.itemCommands = {
    'agent-profile-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.purchases.set('P-127', {
    code: 'P-127',
    userId: 'u-1',
    itemId: 'agent-profile-ak',
    status: 'pending',
  });
  ctx.shopItems.set('agent-profile-ak', {
    id: 'agent-profile-ak',
    name: 'Agent Profile AK',
    kind: 'item',
    deliveryProfile: 'teleport_spawn',
    deliveryReturnTarget: 'Admin Anchor',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queued = await api.enqueuePurchaseDeliveryByCode('P-127', {
      guildId: 'g-1',
    });
    assert.equal(queued.ok, true);

    const processed = await api.processDeliveryQueueNow(5);
    assert.equal(processed.processed, 1);
    assert.equal(ctx.purchases.get('P-127').status, 'delivered');
    assert.deepEqual(agent.received, [
      '#TeleportTo "Coke TAMTHAI"',
      '#SpawnItem Weapon_AK47 1',
      '#TeleportTo "Admin Anchor"',
    ]);
  } finally {
    await agent.close();
  }
});

test('item-level vehicle teleport target allows delivery without player online', async () => {
  const agent = await startFakeAgentServer();
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-1234567890';
  process.env.DELIVERY_AGENT_COMMAND_DELAY_MS = '0';

  const ctx = makeTestContext();
  ctx.links.set('u-1', {
    steamId: '76561198000000001',
    inGameName: '',
  });
  ctx.mocks.config.delivery.auto.itemCommands = {
    'agent-vehicle-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.purchases.set('P-127B', {
    code: 'P-127B',
    userId: 'u-1',
    itemId: 'agent-vehicle-ak',
    status: 'pending',
  });
  ctx.shopItems.set('agent-vehicle-ak', {
    id: 'agent-vehicle-ak',
    name: 'Agent Vehicle AK',
    kind: 'item',
    deliveryProfile: 'teleport_spawn',
    deliveryTeleportMode: 'vehicle',
    deliveryTeleportTarget: 'AdminBike',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const queued = await api.enqueuePurchaseDeliveryByCode('P-127B', {
      guildId: 'g-1',
    });
    assert.equal(queued.ok, true);

    const processed = await api.processDeliveryQueueNow(5);
    assert.equal(processed.processed, 1);
    assert.equal(ctx.purchases.get('P-127B').status, 'delivered');
    assert.deepEqual(agent.received, [
      '#TeleportToVehicle AdminBike',
      '#SpawnItem Weapon_AK47 1',
    ]);
  } finally {
    await agent.close();
  }
});

test('fallback to wiki weapon command template when itemCommands is empty', async () => {
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';
  const ctx = makeTestContext();

  ctx.mocks.wikiWeaponCatalog.resolveWikiWeaponCommandTemplate = (gameItemId) =>
    String(gameItemId || '').toLowerCase() === 'bp_weapon_ak47'
      ? '#SpawnItem {steamId} {gameItemId} {quantity}'
      : null;

  ctx.purchases.set('P-150', {
    code: 'P-150',
    userId: 'u-1',
    itemId: 'ak47-shop-item',
    status: 'pending',
  });
  ctx.shopItems.set('ak47-shop-item', {
    id: 'ak47-shop-item',
    name: 'AK-47',
    kind: 'item',
    deliveryItems: [
      { gameItemId: 'BP_Weapon_AK47', quantity: 1, iconUrl: null },
    ],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const queued = await api.enqueuePurchaseDeliveryByCode('P-150', {
    guildId: 'g-1',
  });
  assert.equal(queued.ok, true);
  assert.equal(api.listDeliveryQueue().length, 1);

  const processed = await api.processDeliveryQueueNow(5);
  assert.equal(processed.processed, 1);
  assert.equal(api.listDeliveryQueue().length, 0);
  assert.equal(ctx.purchases.get('P-150').status, 'delivered');

  const successAudit = ctx.audits.find((entry) => entry.action === 'success');
  assert.ok(successAudit, 'expected success audit entry');
  const commands = successAudit.meta.outputs.map((entry) => entry.command);
  assert.deepEqual(commands, ['#SpawnItem 76561198000000001 BP_Weapon_AK47 1']);
});

test('fallback to manifest command template when itemCommands/wiki fallback are empty', async () => {
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';
  const ctx = makeTestContext();

  ctx.purchases.set('P-175', {
    code: 'P-175',
    userId: 'u-1',
    itemId: 'food-water',
    status: 'pending',
  });
  ctx.shopItems.set('food-water', {
    id: 'food-water',
    name: 'Water',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Water_05l', quantity: 2, iconUrl: null }],
  });
  ctx.mocks.wikiItemManifestCatalog.resolveManifestItemCommandTemplate = (
    gameItemId,
  ) =>
    String(gameItemId || '').toLowerCase() === 'water_05l'
      ? '#SpawnItem {steamId} {gameItemId} {quantity}'
      : null;

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const queued = await api.enqueuePurchaseDeliveryByCode('P-175', {
    guildId: 'g-1',
  });
  assert.equal(queued.ok, true);

  const processed = await api.processDeliveryQueueNow(5);
  assert.equal(processed.processed, 1);
  assert.equal(ctx.purchases.get('P-175').status, 'delivered');

  const successAudit = ctx.audits.find(
    (entry) => entry.action === 'success' && entry.purchaseCode === 'P-175',
  );
  assert.ok(successAudit, 'expected success audit entry');
  const commands = successAudit.meta.outputs.map((entry) => entry.command);
  assert.deepEqual(commands, ['#SpawnItem 76561198000000001 Water_05l 2']);
});

test('previewDeliveryCommands generates dedicated-server and single-player commands', async () => {
  const ctx = makeTestContext();

  ctx.mocks.config.delivery.auto.itemCommands = {
    'preview-ak': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.shopItems.set('preview-ak', {
    id: 'preview-ak',
    name: 'Preview AK',
    kind: 'item',
    deliveryItems: [
      { gameItemId: 'Weapon_AK47', quantity: 3, iconUrl: 'https://icons.local/ak.webp' },
    ],
    iconUrl: 'https://icons.local/ak.webp',
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const preview = await api.previewDeliveryCommands({
    itemId: 'preview-ak',
    steamId: '76561198012345678',
  });

  assert.equal(preview.itemId, 'preview-ak');
  assert.equal(preview.itemName, 'Preview AK');
  assert.equal(preview.gameItemId, 'Weapon_AK47');
  assert.equal(preview.quantity, 3);
  assert.equal(preview.iconUrl, 'https://icons.local/ak.webp');
  assert.deepEqual(preview.serverCommands, [
    '#SpawnItem 76561198012345678 Weapon_AK47 3',
  ]);
  assert.deepEqual(preview.singlePlayerCommands, [
    '#SpawnItem Weapon_AK47 3',
  ]);
});

test('previewDeliveryCommands adds StackCount for magazine spawn commands', async () => {
  const ctx = makeTestContext();

  ctx.mocks.config.delivery.auto.itemCommands = {
    'preview-mag': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.shopItems.set('preview-mag', {
    id: 'preview-mag',
    name: 'Preview Magazine',
    kind: 'item',
    deliveryItems: [
      { gameItemId: 'Magazine_M1911', quantity: 2, iconUrl: null },
    ],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const preview = await api.previewDeliveryCommands({
    itemId: 'preview-mag',
    steamId: '76561198012345678',
  });

  assert.deepEqual(preview.serverCommands, [
    '#SpawnItem 76561198012345678 Magazine_M1911 2 StackCount 100',
  ]);
  assert.deepEqual(preview.singlePlayerCommands, [
    '#SpawnItem Magazine_M1911 2 StackCount 100',
  ]);
});

test('previewDeliveryCommands preserves explicit StackCount in template', async () => {
  const ctx = makeTestContext();

  ctx.mocks.config.delivery.auto.itemCommands = {
    'preview-mag-explicit': ['#SpawnItem {steamId} {gameItemId} {quantity} StackCount 50'],
  };

  ctx.shopItems.set('preview-mag-explicit', {
    id: 'preview-mag-explicit',
    name: 'Preview Magazine Explicit',
    kind: 'item',
    deliveryItems: [
      { gameItemId: 'Magazine_M1911', quantity: 1, iconUrl: null },
    ],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const preview = await api.previewDeliveryCommands({
    itemId: 'preview-mag-explicit',
    steamId: '76561198012345678',
  });

  assert.deepEqual(preview.serverCommands, [
    '#SpawnItem 76561198012345678 Magazine_M1911 1 StackCount 50',
  ]);
});

test('testScumAdminCommandCapability returns ready dry-run plan for builtin delivery sequence', async () => {
  const agent = await startFakeAgentServer();
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.SCUM_CONSOLE_AGENT_BASE_URL = agent.baseUrl;
  process.env.SCUM_CONSOLE_AGENT_TOKEN = 'agent-token-capability';
  process.env.DELIVERY_VERIFY_MODE = 'output-match';
  process.env.DELIVERY_VERIFY_SUCCESS_REGEX = 'EXECUTED:#SpawnItem Weapon_M1911 1';

  const ctx = makeTestContext();

  try {
    const api = loadRconDeliveryWithMocks(ctx.mocks);
    const result = await api.testScumAdminCommandCapability({
      capabilityId: 'announce-teleport-spawn',
      dryRun: true,
    });

    assert.equal(result.ready, true);
    assert.equal(result.dryRun, true);
    assert.equal(String(result.capability?.id || ''), 'announce-teleport-spawn');
    assert.deepEqual(result.renderedCommands, [
      '#Announce DELIVERY TEST',
      '#TeleportTo "Coke TAMTHAI"',
      '#SpawnItem Weapon_M1911 1',
      '#TeleportTo "Admin Anchor"',
    ]);
    assert.equal(String(result.summary?.verificationMode || ''), 'output-match');
    assert.ok(Array.isArray(result.timeline));
    assert.ok(result.timeline.length >= 5);
  } finally {
    await agent.close();
  }
});

test('previewDeliveryCommands includes agent execution plan', async () => {
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.DELIVERY_AGENT_PRE_COMMANDS_JSON =
    '["#TeleportTo {teleportTargetQuoted}"]';
  process.env.DELIVERY_AGENT_POST_COMMANDS_JSON =
    '["#TeleportTo {returnTargetQuoted}"]';
  process.env.DELIVERY_AGENT_RETURN_TARGET = 'Admin Anchor';
  const ctx = makeTestContext();

  ctx.mocks.config.delivery.auto.itemCommands = {
    'preview-teleport': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.shopItems.set('preview-teleport', {
    id: 'preview-teleport',
    name: 'Preview Teleport',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_M1911', quantity: 1, iconUrl: null }],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const preview = await api.previewDeliveryCommands({
    itemId: 'preview-teleport',
    steamId: '76561198012345678',
    inGameName: 'Coke TAMTHAI',
  });

  assert.equal(preview.executionMode, 'agent');
  assert.deepEqual(preview.agentPreCommands, ['#TeleportTo "Coke TAMTHAI"']);
  assert.deepEqual(preview.agentPostCommands, ['#TeleportTo "Admin Anchor"']);
  assert.deepEqual(preview.allCommands, [
    '#TeleportTo "Coke TAMTHAI"',
    '#SpawnItem Weapon_M1911 1',
    '#TeleportTo "Admin Anchor"',
  ]);
});

test('previewDeliveryCommands uses item-level delivery profile and return target', async () => {
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  process.env.DELIVERY_AGENT_PRE_COMMANDS_JSON =
    '["#Announce GLOBAL-FALLBACK"]';
  const ctx = makeTestContext();

  ctx.mocks.config.delivery.auto.itemCommands = {
    'preview-profile': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.shopItems.set('preview-profile', {
    id: 'preview-profile',
    name: 'Preview Profile',
    kind: 'item',
    deliveryProfile: 'teleport_spawn',
    deliveryReturnTarget: 'Admin Anchor',
    deliveryItems: [{ gameItemId: 'Weapon_M1911', quantity: 1, iconUrl: null }],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const preview = await api.previewDeliveryCommands({
    itemId: 'preview-profile',
    steamId: '76561198012345678',
    inGameName: 'Coke TAMTHAI',
  });

  assert.equal(preview.deliveryProfile, 'teleport_spawn');
  assert.equal(preview.deliveryReturnTarget, 'Admin Anchor');
  assert.deepEqual(preview.agentPreCommands, ['#TeleportTo "Coke TAMTHAI"']);
  assert.deepEqual(preview.agentPostCommands, ['#TeleportTo "Admin Anchor"']);
});

test('previewDeliveryCommands uses vehicle teleport target when configured on item', async () => {
  process.env.DELIVERY_EXECUTION_MODE = 'agent';
  const ctx = makeTestContext();

  ctx.mocks.config.delivery.auto.itemCommands = {
    'preview-vehicle-profile': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };

  ctx.shopItems.set('preview-vehicle-profile', {
    id: 'preview-vehicle-profile',
    name: 'Preview Vehicle Profile',
    kind: 'item',
    deliveryProfile: 'teleport_spawn',
    deliveryTeleportMode: 'vehicle',
    deliveryTeleportTarget: 'AdminBike',
    deliveryReturnTarget: 'Admin Anchor',
    deliveryItems: [{ gameItemId: 'Weapon_M1911', quantity: 1, iconUrl: null }],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const preview = await api.previewDeliveryCommands({
    itemId: 'preview-vehicle-profile',
    steamId: '76561198012345678',
  });

  assert.equal(preview.deliveryProfile, 'teleport_spawn');
  assert.equal(preview.deliveryTeleportMode, 'vehicle');
  assert.equal(preview.deliveryTeleportTarget, 'AdminBike');
  assert.deepEqual(preview.agentPreCommands, ['#TeleportToVehicle AdminBike']);
  assert.deepEqual(preview.agentPostCommands, ['#TeleportTo "Admin Anchor"']);
});

test('bundle without {gameItemId}/{quantity} placeholder fails fast', async () => {
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';
  const ctx = makeTestContext({
    config: {
      delivery: {
        auto: {
          enabled: true,
          queueIntervalMs: 100,
          maxRetries: 0,
          retryDelayMs: 10,
          retryBackoff: 1,
          commandTimeoutMs: 2000,
          failedStatus: 'delivery_failed',
          itemCommands: {
            'bundle-no-placeholder': ['#SpawnItem {steamId}'],
          },
        },
      },
    },
  });

  ctx.purchases.set('P-200', {
    code: 'P-200',
    userId: 'u-1',
    itemId: 'bundle-no-placeholder',
    status: 'pending',
  });
  ctx.shopItems.set('bundle-no-placeholder', {
    id: 'bundle-no-placeholder',
    name: 'Broken Bundle',
    kind: 'item',
    deliveryItems: [
      { gameItemId: 'Item_A', quantity: 1, iconUrl: null },
      { gameItemId: 'Item_B', quantity: 2, iconUrl: null },
    ],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const queued = await api.enqueuePurchaseDeliveryByCode('P-200');
  assert.equal(queued.ok, false);
  assert.equal(queued.reason, 'bundle-template-missing-placeholder');
  assert.equal(api.listDeliveryQueue().length, 0);
  assert.equal(ctx.purchases.get('P-200').status, 'pending');

  const failedAudit = ctx.audits.find(
    (entry) => entry.action === 'skip-invalid-template',
  );
  assert.ok(failedAudit, 'expected template validation audit entry');
  assert.match(
    String(failedAudit.message || ''),
    /\{gameItemId\}|\{quantity\}/,
  );
});

test('dead-letter retry moves failed job back to queue and succeeds', async () => {
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';
  const ctx = makeTestContext({
    config: {
      delivery: {
        auto: {
          enabled: true,
          queueIntervalMs: 100,
          maxRetries: 0,
          retryDelayMs: 10,
          retryBackoff: 1,
          commandTimeoutMs: 2000,
          failedStatus: 'delivery_failed',
          itemCommands: {
            'single-wood': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
          },
        },
      },
    },
  });

  ctx.purchases.set('P-300', {
    code: 'P-300',
    userId: 'u-2',
    itemId: 'single-wood',
    status: 'pending',
  });
  ctx.shopItems.set('single-wood', {
    id: 'single-wood',
    name: 'Wood',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Resource_Wood', quantity: 10, iconUrl: null }],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const queued = await api.enqueuePurchaseDeliveryByCode('P-300', { guildId: 'g-1' });
  assert.equal(queued.ok, true);

  await api.processDeliveryQueueNow(5);
  assert.equal(ctx.purchases.get('P-300').status, 'delivery_failed');
  assert.equal(api.listDeliveryQueue().length, 0);
  assert.equal(api.listDeliveryDeadLetters().length, 1);

  ctx.links.set('u-2', { steamId: '76561198000009999' });
  const retry = await api.retryDeliveryDeadLetter('P-300', { guildId: 'g-1' });
  assert.equal(retry.ok, true);
  assert.equal(api.listDeliveryQueue().length, 1);

  await api.processDeliveryQueueNow(5);
  assert.equal(ctx.purchases.get('P-300').status, 'delivered');
  assert.equal(api.listDeliveryDeadLetters().length, 0);
});

test('enqueue skips terminal status purchase (idempotency guard)', async () => {
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';
  const ctx = makeTestContext();

  ctx.purchases.set('P-400', {
    code: 'P-400',
    userId: 'u-1',
    itemId: 'bundle-ak',
    status: 'delivered',
  });
  ctx.shopItems.set('bundle-ak', {
    id: 'bundle-ak',
    name: 'AK Bundle',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_AK47', quantity: 1, iconUrl: null }],
  });

  const api = loadRconDeliveryWithMocks(ctx.mocks);
  const queued = await api.enqueuePurchaseDeliveryByCode('P-400');
  assert.equal(queued.ok, false);
  assert.equal(queued.reason, 'terminal-status');
  assert.equal(api.listDeliveryQueue().length, 0);
});

test('split runtime worker hydrates queue jobs from prisma and delivers them', async () => {
  process.env.RCON_EXEC_TEMPLATE = 'echo {command}';
  const ctx = makeTestContext();
  const queueRows = new Map();
  const deadLetterRows = new Map();

  ctx.mocks.config.delivery.auto.itemCommands = {
    'split-runtime-test': ['#SpawnItem {steamId} {gameItemId} {quantity}'],
  };
  ctx.mocks.prisma.prisma.deliveryQueueJob = {
    findMany: async () =>
      Array.from(queueRows.values()).sort((a, b) => {
        const nextA = Number(a.nextAttemptAt || 0);
        const nextB = Number(b.nextAttemptAt || 0);
        if (nextA !== nextB) return nextA - nextB;
        return String(a.purchaseCode).localeCompare(String(b.purchaseCode));
      }),
    upsert: async ({ where, update, create }) => {
      const code = String(where.purchaseCode || '');
      queueRows.set(code, { ...(queueRows.get(code) || {}), ...(update || create) });
      return queueRows.get(code);
    },
    create: async ({ data }) => {
      queueRows.set(String(data.purchaseCode), { ...data });
      return data;
    },
    deleteMany: async ({ where } = {}) => {
      if (where?.purchaseCode) {
        queueRows.delete(String(where.purchaseCode));
      } else {
        queueRows.clear();
      }
      return { count: 0 };
    },
  };
  ctx.mocks.prisma.prisma.deliveryDeadLetter = {
    findMany: async () => Array.from(deadLetterRows.values()),
    upsert: async ({ where, update, create }) => {
      const code = String(where.purchaseCode || '');
      deadLetterRows.set(code, {
        ...(deadLetterRows.get(code) || {}),
        ...(update || create),
      });
      return deadLetterRows.get(code);
    },
    create: async ({ data }) => {
      deadLetterRows.set(String(data.purchaseCode), { ...data });
      return data;
    },
    deleteMany: async ({ where } = {}) => {
      if (where?.purchaseCode) {
        deadLetterRows.delete(String(where.purchaseCode));
      } else {
        deadLetterRows.clear();
      }
      return { count: 0 };
    },
  };

  ctx.purchases.set('P-500', {
    code: 'P-500',
    userId: 'u-1',
    itemId: 'split-runtime-test',
    status: 'pending',
  });
  ctx.shopItems.set('split-runtime-test', {
    id: 'split-runtime-test',
    name: 'Split Runtime Test',
    kind: 'item',
    deliveryItems: [{ gameItemId: 'Weapon_M1911', quantity: 1, iconUrl: null }],
  });

  const producer = loadRconDeliveryWithMocks(ctx.mocks);
  const queued = await producer.enqueuePurchaseDeliveryByCode('P-500', {
    guildId: 'g-1',
  });
  assert.equal(queued.ok, true);
  await producer.flushDeliveryPersistenceWrites();
  assert.equal(queueRows.has('P-500'), true);

  const consumer = loadRconDeliveryWithMocks(ctx.mocks);
  const processed = await consumer.processDeliveryQueueNow(5);
  await consumer.flushDeliveryPersistenceWrites();

  assert.equal(processed.processed, 1);
  assert.equal(ctx.purchases.get('P-500').status, 'delivered');
  assert.equal(queueRows.has('P-500'), false);

  const successAudit = ctx.audits.find(
    (entry) => entry.action === 'success' && entry.purchaseCode === 'P-500',
  );
  assert.ok(successAudit, 'expected success audit entry');
  assert.equal(successAudit.meta.outputs[0].command, '#SpawnItem 76561198000000001 Weapon_M1911 1');
  assert.equal(
    successAudit.meta.commandSummary,
    '#SpawnItem 76561198000000001 Weapon_M1911 1',
  );
  assert.match(
    String(successAudit.message || ''),
    /#SpawnItem 76561198000000001 Weapon_M1911 1/,
  );
});
