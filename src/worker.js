require('dotenv').config();

const {
  startRconDeliveryWorker,
  getDeliveryMetricsSnapshot,
} = require('./services/rconDelivery');
const {
  startRentBikeService,
  getRentBikeRuntime,
} = require('./services/rentBikeService');
const { assertWorkerEnv } = require('./utils/env');

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

async function startWorker() {
  assertWorkerEnv();

  if (!START_RENT_BIKE && !START_DELIVERY) {
    throw new Error(
      'Worker disabled: both WORKER_ENABLE_RENTBIKE=false and WORKER_ENABLE_DELIVERY=false',
    );
  }

  if (START_RENT_BIKE) {
    await startRentBikeService(null);
  } else {
    console.log('[worker] skip rent bike service');
  }

  if (START_DELIVERY) {
    startRconDeliveryWorker(null);
  } else {
    console.log('[worker] skip delivery worker');
  }

  console.log('[worker] started');
  console.log(
    `[worker] rentBike=${START_RENT_BIKE ? 'on' : 'off'} delivery=${START_DELIVERY ? 'on' : 'off'}`,
  );

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
}

startWorker().catch((error) => {
  console.error('[worker] failed to start:', error.message);
  process.exit(1);
});
