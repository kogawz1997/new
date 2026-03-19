const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createBindOpsAlertRoute,
  formatOpsAlertDiscordPayload,
  formatOpsAlertMessage,
} = require('../src/bootstrap/botOpsAlertRuntime');

test('delivery reconcile anomaly alerts render compact summaries instead of raw JSON', () => {
  const message = formatOpsAlertMessage({
    source: 'platform-monitor',
    kind: 'delivery-reconcile-anomaly',
    count: 4,
    sample: [
      {
        code: 'Pd7fbabc0-148b-4c27-a9c1-0214261ece23',
        type: 'delivered-without-audit',
        severity: 'warn',
        detail: 'Delivered purchase has no delivery audit evidence',
      },
      {
        code: 'P39ad3145-33e4-4476-87ce-48d4f6257f3d',
        type: 'stuck-without-runtime-state',
        severity: 'error',
        detail: 'Pending purchase has neither queue nor dead-letter state',
      },
      {
        code: 'P3a5b0743-f34d-4056-8a51-f6cad3e5dbc2',
        type: 'delivered-without-audit',
        severity: 'warn',
        detail: 'Delivered purchase has no delivery audit evidence',
      },
    ],
  });

  assert.match(message, /^\[OPS\]\[WARN\] Delivery Reconcile Anomaly/m);
  assert.match(message, /count=4/);
  assert.match(message, /types=delivered-without-audit x2, stuck-without-runtime-state x1/);
  assert.match(message, /codes=Pd7fbabc0-148b-\.\.\., P39ad3145-33e4-\.\.\., P3a5b0743-f34d-\.\.\./);
  assert.doesNotMatch(message, /"detail":/);
  assert.doesNotMatch(message, /\{"source":"platform-monitor"/);
});

test('tenant quota alerts render readable tenant summaries', () => {
  const message = formatOpsAlertMessage({
    source: 'platform-monitor',
    kind: 'tenant-quota-near-limit',
    tenantId: 'tenant-platform-1773726572958',
    tenantSlug: 'scum-th-starter',
    quotaKey: 'webhooks',
    used: 1,
    limit: 2,
    remaining: 1,
  });

  assert.match(message, /^\[OPS\]\[WARN\] Tenant Quota Near Limit/m);
  assert.match(message, /tenant=scum-th-starter/);
  assert.match(message, /quota=webhooks/);
  assert.match(message, /used=1/);
  assert.match(message, /limit=2/);
  assert.match(message, /remaining=1/);
});

test('ops alert embed payload renders severity card with structured fields', () => {
  const message = formatOpsAlertDiscordPayload({
    source: 'platform-monitor',
    kind: 'delivery-reconcile-anomaly',
    count: 4,
    sample: [
      {
        code: 'Pd7fbabc0-148b-4c27-a9c1-0214261ece23',
        type: 'delivered-without-audit',
      },
      {
        code: 'P39ad3145-33e4-4476-87ce-48d4f6257f3d',
        type: 'stuck-without-runtime-state',
      },
    ],
  }, {
    at: '2026-03-18T09:41:44.528Z',
  });

  assert.equal(Array.isArray(message.embeds), true);
  assert.equal(message.embeds.length, 1);

  const embed = message.embeds[0].toJSON();
  assert.equal(embed.title, 'Delivery Reconcile Anomaly');
  assert.equal(embed.footer?.text, 'OPS • WARN • platform-monitor');
  assert.equal(typeof embed.color, 'number');
  assert.equal(Array.isArray(embed.fields), true);
  assert.ok(embed.fields.some((field) => field.name === 'Count' && field.value === '4'));
  assert.ok(embed.fields.some((field) => field.name === 'Types' && /delivered-without-audit/.test(field.value)));
  assert.ok(embed.fields.some((field) => field.name === 'Sample Codes' && /Pd7fbabc0-148b/.test(field.value)));
});

test('ops alert route sends embeds to the admin-log channel', async () => {
  const adminLiveBus = new EventEmitter();
  const sent = [];
  const adminLogChannel = {
    name: 'admin-log',
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      return payload;
    },
  };
  const guild = {
    channels: {
      cache: {
        find: (predicate) => {
          if (predicate(adminLogChannel)) return adminLogChannel;
          return null;
        },
      },
    },
  };
  const client = {
    guilds: {
      cache: new Map([['guild-1', guild]]),
    },
  };

  const bindOpsAlertRoute = createBindOpsAlertRoute({
    adminLiveBus,
    channels: {
      adminLog: 'admin-log',
      shopLog: 'shop-log',
    },
  });
  bindOpsAlertRoute(client);

  adminLiveBus.emit('update', {
    type: 'ops-alert',
    at: '2026-03-18T09:41:44.528Z',
    payload: {
      source: 'platform-monitor',
      kind: 'runtime-offline',
      runtimeLabel: 'Admin Web',
      reason: 'fetch failed',
      url: 'http://127.0.0.1:3200',
    },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
  assert.equal(Array.isArray(sent[0].embeds), true);
  const embed = sent[0].embeds[0].toJSON();
  assert.equal(embed.title, 'Runtime Offline');
  assert.ok(embed.fields.some((field) => field.name === 'Runtime' && field.value === 'Admin Web'));
});
