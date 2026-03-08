const crypto = require('node:crypto');
const { exec } = require('node:child_process');

const config = require('../config');
const { getLinkByUserId } = require('../store/linkStore');
const {
  ensureRentBikeTables,
  getDailyRent,
  markDailyRentUsed,
  createRentalOrder,
  getRentalOrder,
  setRentalOrderStatus,
  listRentalVehiclesByStatuses,
  getLatestRentalByUser,
} = require('../store/rentBikeStore');

const queue = [];
const inQueue = new Set();
let isProcessing = false;
let isMaintenance = false;
let started = false;
let resetTimer = null;
let lastDateKey = null;
let discordClient = null;

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSettings() {
  const root = config.rentBike || {};
  const vehicle = root.vehicle || {};
  const rcon = root.rcon || {};
  return {
    timezone: String(root.timezone || 'Asia/Phnom_Penh'),
    resetCheckIntervalMs: Math.max(1000, asNumber(root.resetCheckIntervalMs, 15000)),
    cooldownMinutes: Math.max(0, asNumber(root.cooldownMinutes, 5)),
    spawnSettleMs: Math.max(500, asNumber(root.spawnSettleMs, 2500)),
    resetDestroyDelayMs: Math.max(50, asNumber(root.resetDestroyDelayMs, 300)),
    listCommand: String(vehicle.listCommand || '#ListSpawnedVehicles'),
    spawnCommand: String(vehicle.spawnCommand || '#SpawnVehicle {spawnId}'),
    destroyCommand: String(vehicle.destroyCommand || '#DestroyVehicle {vehicleInstanceId}'),
    spawnId: String(vehicle.spawnId || '').trim(),
    motorbikeKeywords: Array.isArray(vehicle.motorbikeKeywords)
      ? vehicle.motorbikeKeywords.map((v) => String(v || '').toLowerCase()).filter(Boolean)
      : ['motorbike', 'motorcycle', 'bike', 'dirtbike'],
    commandTimeoutMs: Math.max(1000, asNumber(rcon.commandTimeoutMs, 10000)),
    commandRetries: Math.max(0, asNumber(rcon.commandRetries, 2)),
    retryDelayMs: Math.max(100, asNumber(rcon.retryDelayMs, 1000)),
    rconExecTemplate: String(rcon.execTemplate || '').trim(),
  };
}

function getDateParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const out = {};
  for (const part of parts) {
    out[part.type] = part.value;
  }
  return out;
}

function getDateKey(timezone, date = new Date()) {
  const parts = getDateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getNextResetText() {
  return '00:00 Asia/Phnom_Penh';
}

function getRconTemplate(settings) {
  const fromEnv = String(process.env.RCON_EXEC_TEMPLATE || '').trim();
  if (fromEnv) return fromEnv;
  if (settings.rconExecTemplate) return settings.rconExecTemplate;
  const fromDeliveryConfig = String(config.delivery?.auto?.rconExecTemplate || '').trim();
  if (fromDeliveryConfig) return fromDeliveryConfig;
  return '';
}

function renderTemplate(template, vars) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    if (!(key in vars)) return `{${key}}`;
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

function trimOutput(value, maxLen = 900) {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function runShellCommand(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
        });
      },
    );
  });
}

async function runRconCommand(gameCommand, settings) {
  const template = getRconTemplate(settings);
  if (!template) {
    throw new Error('RCON_EXEC_TEMPLATE is not set');
  }

  const host = String(process.env.RCON_HOST || '').trim();
  const port = String(process.env.RCON_PORT || '').trim();
  const password = String(process.env.RCON_PASSWORD || '').trim();

  if (template.includes('{host}') && !host) {
    throw new Error('RCON_HOST is required');
  }
  if (template.includes('{port}') && !port) {
    throw new Error('RCON_PORT is required');
  }
  if (template.includes('{password}') && !password) {
    throw new Error('RCON_PASSWORD is required');
  }

  const shell = renderTemplate(template, {
    host,
    port,
    password,
    command: gameCommand,
  });

  const result = await runShellCommand(shell, settings.commandTimeoutMs);
  return {
    shell,
    command: gameCommand,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function runRconWithRetry(gameCommand, settings) {
  let attempt = 0;
  while (attempt <= settings.commandRetries) {
    try {
      const output = await runRconCommand(gameCommand, settings);
      return { output, attempt: attempt + 1 };
    } catch (error) {
      if (attempt >= settings.commandRetries) {
        throw error;
      }
      await sleep(settings.retryDelayMs * (attempt + 1));
      attempt += 1;
    }
  }
  throw new Error('RCON retry loop terminated unexpectedly');
}

function parseSpawnedVehicles(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows = [];
  for (const line of lines) {
    const match =
      line.match(/\b(?:vehicleid|instanceid|id)\s*[:=#]\s*(\d+)\b/i)
      || line.match(/\b(\d{1,12})\b/);
    if (!match) continue;
    const id = String(match[1]);
    rows.push({
      id,
      raw: line,
      lower: line.toLowerCase(),
    });
  }
  const dedupe = new Map();
  for (const row of rows) {
    dedupe.set(row.id, row);
  }
  return Array.from(dedupe.values());
}

function pickNewVehicleInstance(beforeRows, afterRows, settings) {
  const before = new Set(beforeRows.map((r) => r.id));
  const newRows = afterRows.filter((r) => !before.has(r.id));
  if (newRows.length === 0) return null;
  if (newRows.length === 1) return newRows[0];

  const filtered = newRows.filter((row) =>
    settings.motorbikeKeywords.some((keyword) => row.lower.includes(keyword)),
  );
  const pool = filtered.length > 0 ? filtered : newRows;
  pool.sort((a, b) => Number(b.id) - Number(a.id));
  return pool[0];
}

async function sendRentLog(guildId, text) {
  if (!discordClient || !guildId || !text) return;
  try {
    const guild = discordClient.guilds.cache.get(guildId)
      || (await discordClient.guilds.fetch(guildId).catch(() => null));
    if (!guild) return;
    const channel = guild.channels.cache.find(
      (c) =>
        (c.name === config.channels?.shopLog || c.name === config.channels?.adminLog)
        && c.isTextBased
        && c.isTextBased(),
    );
    if (!channel) return;
    await channel.send(text).catch(() => null);
  } catch {
    // best effort log
  }
}

function generateOrderId() {
  if (typeof crypto.randomUUID === 'function') {
    return `RB-${crypto.randomUUID()}`;
  }
  return `RB-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function enqueueOrder(orderId) {
  const key = String(orderId || '').trim();
  if (!key) return;
  if (inQueue.has(key)) return;
  inQueue.add(key);
  queue.push(key);
  void processQueue();
}

async function processQueue() {
  if (isProcessing || isMaintenance) return;
  isProcessing = true;
  try {
    while (queue.length > 0 && !isMaintenance) {
      const orderId = queue.shift();
      inQueue.delete(orderId);
      await processSingleOrder(orderId);
    }
  } finally {
    isProcessing = false;
  }
}

async function processSingleOrder(orderId) {
  const settings = getSettings();
  const order = await getRentalOrder(orderId);
  if (!order) return;
  if (order.status === 'destroyed' || order.status === 'missing' || order.status === 'delivered') {
    return;
  }

  const attemptCount = Number(order.attemptCount || 0) + 1;
  await setRentalOrderStatus(orderId, 'delivering', {
    attemptCount,
    lastError: null,
  });

  try {
    if (!settings.spawnId) {
      throw new Error('rentBike.vehicle.spawnId is empty');
    }

    const beforeCmd = renderTemplate(settings.listCommand, {});
    const beforeResult = await runRconWithRetry(beforeCmd, settings);
    const beforeRows = parseSpawnedVehicles(beforeResult.output.stdout || beforeResult.output.stderr);

    const spawnCmd = renderTemplate(settings.spawnCommand, {
      spawnId: settings.spawnId,
    });
    await runRconWithRetry(spawnCmd, settings);
    await sleep(settings.spawnSettleMs);

    const afterCmd = renderTemplate(settings.listCommand, {});
    const afterResult = await runRconWithRetry(afterCmd, settings);
    const afterRows = parseSpawnedVehicles(afterResult.output.stdout || afterResult.output.stderr);

    const selected = pickNewVehicleInstance(beforeRows, afterRows, settings);
    if (!selected?.id) {
      throw new Error('Cannot detect new vehicle instance id from #ListSpawnedVehicles');
    }

    const today = getDateKey(settings.timezone);
    await markDailyRentUsed(order.userKey, today);

    await setRentalOrderStatus(orderId, 'delivered', {
      vehicleInstanceId: selected.id,
      attemptCount,
      lastError: null,
    });

    await sendRentLog(
      order.guildId || null,
      `[RENTBIKE] Delivered | order: \`${orderId}\` | userKey: \`${order.userKey}\` | vehicle: \`${selected.id}\``,
    );
  } catch (error) {
    const message = String(error?.message || 'Unknown rentbike error');
    await setRentalOrderStatus(orderId, 'failed', {
      attemptCount,
      lastError: message,
    });
    await sendRentLog(
      order.guildId || null,
      `[RENTBIKE] Failed | order: \`${orderId}\` | userKey: \`${order.userKey}\` | reason: ${message}`,
    );
  }
}

async function requestRentBike(discordUserId, guildId = null) {
  await ensureRentBikeTables();
  const settings = getSettings();
  if (!settings.spawnId) {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'rentBike.vehicle.spawnId is not configured.',
    };
  }
  if (!getRconTemplate(settings)) {
    return {
      ok: false,
      reason: 'rcon-template-missing',
      message: 'RCON_EXEC_TEMPLATE is not configured.',
    };
  }

  if (isMaintenance) {
    return {
      ok: false,
      reason: 'maintenance',
      message: 'Rent bike service is in maintenance mode. Please try again shortly.',
    };
  }

  const link = getLinkByUserId(discordUserId);
  if (!link?.steamId) {
    return {
      ok: false,
      reason: 'link-required',
      message: 'SteamID link is required first (`/linksteam set ...`).',
    };
  }

  const userKey = String(link.steamId);
  const today = getDateKey(settings.timezone);
  const daily = await getDailyRent(userKey, today);
  if (daily?.used) {
    return {
      ok: false,
      reason: 'daily-limit',
      message: `You already used today's rent quota (reset ${getNextResetText()}).`,
    };
  }

  if (settings.cooldownMinutes > 0) {
    const latest = await getLatestRentalByUser(userKey);
    if (latest?.createdAt) {
      const diffMs = Date.now() - new Date(latest.createdAt).getTime();
      const cooldownMs = settings.cooldownMinutes * 60 * 1000;
      if (diffMs < cooldownMs) {
        const remainMin = Math.max(1, Math.ceil((cooldownMs - diffMs) / 60000));
        return {
          ok: false,
          reason: 'cooldown',
          message: `Please wait ${remainMin} more minute(s) before renting again.`,
        };
      }
    }
  }

  let orderId = generateOrderId();
  try {
    await createRentalOrder({
      orderId,
      userKey,
      guildId: guildId ? String(guildId) : null,
    });
  } catch {
    orderId = `${orderId}-${crypto.randomBytes(2).toString('hex')}`;
    try {
      await createRentalOrder({
        orderId,
        userKey,
        guildId: guildId ? String(guildId) : null,
      });
    } catch (error) {
      return {
        ok: false,
        reason: 'db-error',
        message: `Failed to create rent bike order: ${String(error?.message || 'unknown error')}`,
      };
    }
  }

  enqueueOrder(orderId);

  return {
    ok: true,
    orderId,
    userKey,
    message: `Rent bike request accepted (order: \`${orderId}\`), delivery is in queue.`,
  };
}

async function destroySingleRental(order, settings) {
  const orderId = order.orderId;
  const vehicleId = order.vehicleInstanceId;

  if (!vehicleId) {
    await setRentalOrderStatus(orderId, 'missing', {
      destroyedAt: new Date(),
      lastError: 'No vehicle_instance_id recorded',
    });
    return { ok: false, status: 'missing' };
  }

  const destroyCmd = renderTemplate(settings.destroyCommand, {
    vehicleInstanceId: vehicleId,
  });
  try {
    await runRconWithRetry(destroyCmd, settings);
    await setRentalOrderStatus(orderId, 'destroyed', {
      destroyedAt: new Date(),
      lastError: null,
    });
    return { ok: true, status: 'destroyed' };
  } catch (error) {
    await setRentalOrderStatus(orderId, 'missing', {
      destroyedAt: new Date(),
      lastError: String(error?.message || 'Destroy failed'),
    });
    return { ok: false, status: 'missing' };
  }
}

async function runMidnightReset(reason = 'schedule') {
  if (isMaintenance) return;
  const settings = getSettings();
  isMaintenance = true;
  try {
    const targets = await listRentalVehiclesByStatuses(
      ['delivered', 'pending', 'delivering'],
      5000,
    );
    for (const order of targets) {
      await destroySingleRental(order, settings);
      await sleep(settings.resetDestroyDelayMs);
    }
    console.log(
      `[rent-bike] midnight reset finished (${reason}) destroyed/closed ${targets.length} records`,
    );
  } catch (error) {
    console.error('[rent-bike] midnight reset failed:', error.message);
  } finally {
    isMaintenance = false;
    void processQueue();
  }
}

function startDateWatcher() {
  const settings = getSettings();
  lastDateKey = getDateKey(settings.timezone);
  if (resetTimer) clearInterval(resetTimer);
  resetTimer = setInterval(() => {
    const current = getDateKey(settings.timezone);
    if (current === lastDateKey) return;
    lastDateKey = current;
    void runMidnightReset('date-rollover');
  }, settings.resetCheckIntervalMs);
}

async function warmQueueFromDatabase() {
  const rows = await listRentalVehiclesByStatuses(['pending', 'delivering'], 3000);
  for (const row of rows) {
    enqueueOrder(row.orderId);
  }
}

async function startRentBikeService(client) {
  if (client) discordClient = client;
  if (started) return;
  started = true;

  await ensureRentBikeTables();
  await warmQueueFromDatabase();
  startDateWatcher();
  void processQueue();
  console.log('[rent-bike] service started');
}

function getRentBikeRuntime() {
  const settings = getSettings();
  return {
    queueLength: queue.length,
    processing: isProcessing,
    maintenance: isMaintenance,
    timezone: settings.timezone,
    dateKey: getDateKey(settings.timezone),
  };
}

module.exports = {
  startRentBikeService,
  requestRentBike,
  runRentBikeMidnightReset: runMidnightReset,
  getRentBikeRuntime,
};
