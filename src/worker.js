require('dotenv').config();

const {
  startRconDeliveryWorker,
  getDeliveryMetricsSnapshot,
  getDeliveryRuntimeStatus,
} = require('./services/rconDelivery');
const {
  startRentBikeService,
  getRentBikeRuntime,
} = require('./services/rentBikeService');
const { assertWorkerEnv } = require('./utils/env');
const { startRuntimeHealthServer } = require('./services/runtimeHealthServer');
const { acquireRuntimeLock, releaseAllRuntimeLocks } = require('./services/runtimeLock');

function envFlag(name, fallback) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

const START_RENT_BIKE = envFlag('WORKER_ENABLE_RENTBIKE', true);
const START_DELIVERY = envFlag('WORKER_ENABLE_DELIVERY', true);
const HEARTBEAT_MS = Math.max(
  10_000,
  Number(process.env.WORKER_HEARTBEAT_MS || 60_000),
);
const WORKER_HEALTH_HOST = String(
  process.env.WORKER_HEALTH_HOST || '127.0.0.1',
).trim() || '127.0.0.1';
const WORKER_HEALTH_PORT = Math.max(
  0,
  Math.trunc(Number(process.env.WORKER_HEALTH_PORT || 0)),
);

function acquireExclusiveServiceLockOrThrow(serviceName) {
  const result = acquireRuntimeLock(serviceName, 'worker');
  if (result.ok) return result.data;

  const holder = result.data
    ? `pid=${result.data.pid || '-'} owner=${result.data.owner || '-'} host=${result.data.hostname || '-'}`
    : result.reason || 'unknown';
  throw new Error(`runtime lock conflict for ${serviceName}: ${holder}`);
}

async function startWorker() {
  assertWorkerEnv();

  if (!START_RENT_BIKE && !START_DELIVERY) {
    throw new Error(
      'Worker disabled: both WORKER_ENABLE_RENTBIKE=false and WORKER_ENABLE_DELIVERY=false',
    );
  }

  if (START_RENT_BIKE) {
    acquireExclusiveServiceLockOrThrow('rent-bike-service');
    await startRentBikeService(null);
  } else {
    console.log('[worker] skip rent bike service');
  }

  if (START_DELIVERY) {
    acquireExclusiveServiceLockOrThrow('delivery-worker');
    startRconDeliveryWorker(null);
  } else {
    console.log('[worker] skip delivery worker');
  }

  console.log('[worker] started');
  console.log(
    `[worker] rentBike=${START_RENT_BIKE ? 'on' : 'off'} delivery=${START_DELIVERY ? 'on' : 'off'}`,
  );

  const healthServer = startRuntimeHealthServer({
    name: 'worker',
    host: WORKER_HEALTH_HOST,
    port: WORKER_HEALTH_PORT,
    getPayload: async () => {
      const rent = getRentBikeRuntime();
      const delivery = getDeliveryMetricsSnapshot();
      const deliveryRuntime = await getDeliveryRuntimeStatus();
      const deliveryReady = deliveryRuntime?.readiness?.ready === true;
      const status =
        START_DELIVERY && !deliveryReady
          ? 'degraded'
          : 'ready';
      return {
        now: new Date().toISOString(),
        status,
        ready: status === 'ready',
        uptimeSec: Math.round(process.uptime()),
        rentBikeEnabled: START_RENT_BIKE,
        deliveryEnabled: START_DELIVERY,
        rentQueueLength: rent.queueLength,
        maintenance: rent.maintenance,
        queueLength: delivery.queueLength,
        failRate: delivery.failRate,
        attempts: delivery.attempts,
        deliveryRuntime,
      };
    },
  });

  const timer = setInterval(() => {
    const rent = getRentBikeRuntime();
    const delivery = getDeliveryMetricsSnapshot();
    console.log(
      `[worker] heartbeat | queue=${delivery.queueLength} failRate=${delivery.failRate.toFixed(3)} attempts=${delivery.attempts} rentQueue=${rent.queueLength} maintenance=${rent.maintenance ? 'yes' : 'no'}`,
    );
  }, HEARTBEAT_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  process.once('SIGINT', () => {
    releaseAllRuntimeLocks();
    if (healthServer) healthServer.close();
  });
  process.once('SIGTERM', () => {
    releaseAllRuntimeLocks();
    if (healthServer) healthServer.close();
  });
}

startWorker().catch((error) => {
  console.error('[worker] failed to start:', error.message);
  releaseAllRuntimeLocks();
  process.exit(1);
});

process.once('exit', () => {
  releaseAllRuntimeLocks();
});
