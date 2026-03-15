// ค่าคอนฟิกพื้นฐานของบอทเซิร์ฟ SCUM

const { prisma } = require('./prisma');
const { looksLikeMojibake } = require('./utils/mojibake');

const CONFIG_ROW_ID = 1;

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = deepClone(nested);
    }
    return out;
  }
  return value;
}

function replaceValueInPlace(currentValue, nextValue) {
  if (Array.isArray(currentValue) && Array.isArray(nextValue)) {
    currentValue.length = 0;
    for (const item of nextValue) {
      currentValue.push(deepClone(item));
    }
    return currentValue;
  }

  if (isPlainObject(currentValue) && isPlainObject(nextValue)) {
    const nextKeys = new Set(Object.keys(nextValue));
    for (const key of Object.keys(currentValue)) {
      if (!nextKeys.has(key)) {
        delete currentValue[key];
      }
    }

    for (const [key, value] of Object.entries(nextValue)) {
      if (!(key in currentValue)) {
        currentValue[key] = deepClone(value);
        continue;
      }

      const existing = currentValue[key];
      if (
        (Array.isArray(existing) && Array.isArray(value)) ||
        (isPlainObject(existing) && isPlainObject(value))
      ) {
        currentValue[key] = replaceValueInPlace(existing, value);
      } else {
        currentValue[key] = deepClone(value);
      }
    }

    return currentValue;
  }

  return deepClone(nextValue);
}

function mergePatchInPlace(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) return target;

  for (const [key, value] of Object.entries(patch)) {
    if (!(key in target)) {
      target[key] = deepClone(value);
      continue;
    }

    const existing = target[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      existing.length = 0;
      for (const item of value) {
        existing.push(deepClone(item));
      }
      continue;
    }

    if (isPlainObject(existing) && isPlainObject(value)) {
      mergePatchInPlace(existing, value);
      continue;
    }

    target[key] = deepClone(value);
  }

  return target;
}

function sanitizeMojibakeInPlace(current, defaults) {
  if (typeof current === 'string' && typeof defaults === 'string') {
    return looksLikeMojibake(current) ? defaults : current;
  }

  if (Array.isArray(current) && Array.isArray(defaults)) {
    for (let i = 0; i < current.length; i += 1) {
      if (i >= defaults.length) continue;
      current[i] = sanitizeMojibakeInPlace(current[i], defaults[i]);
    }
    return current;
  }

  if (isPlainObject(current) && isPlainObject(defaults)) {
    for (const [key, value] of Object.entries(current)) {
      if (!(key in defaults)) continue;
      current[key] = sanitizeMojibakeInPlace(value, defaults[key]);
    }
    return current;
  }

  return current;
}

const defaultConfig = {
  economy: {
    currencySymbol: '💰',
    dailyReward: 250,
    weeklyReward: 1500,
    dailyCooldownMs: 24 * 60 * 60 * 1000,
    weeklyCooldownMs: 7 * 24 * 60 * 60 * 1000,
  },
  luckyWheel: {
    enabled: true,
    cooldownMs: 6 * 60 * 60 * 1000,
    rewards: [
      { id: 'coin-100', label: '100 Coins', type: 'coins', amount: 100, weight: 30 },
      { id: 'coin-250', label: '250 Coins', type: 'coins', amount: 250, weight: 24 },
      { id: 'coin-500', label: '500 Coins', type: 'coins', amount: 500, weight: 16 },
      { id: 'coin-1000', label: '1,000 Coins', type: 'coins', amount: 1000, weight: 9 },
      { id: 'coin-2000', label: '2,000 Coins', type: 'coins', amount: 2000, weight: 4 },
      { id: 'miss', label: 'No Reward', type: 'none', amount: 0, weight: 17 },
    ],
    tips: [
      'Link SteamID before buying in-game items.',
      'Read server rules before you play.',
      'Do not share Discord or Steam account credentials.',
      'If delivery fails, report your order code to admin.',
    ],
  },
  shop: {
    // รายการเริ่มต้น (สามารถแก้ได้เอง)
    initialItems: [
      {
        id: 'vip-7d',
        name: 'VIP 7 วัน',
        price: 5000,
        description: 'VIP 7 วัน + เข้าห้อง VIP + สีชื่อพิเศษ',
      },
      {
        id: 'vip-30d',
        name: 'VIP 30 วัน',
        price: 15000,
        description: 'VIP 30 วัน + เข้าห้อง VIP + สีชื่อพิเศษ',
      },
      {
        id: 'loot-box',
        name: 'Loot Box (ในเกม)',
        price: 2000,
        description: 'กล่องสุ่มของในเกม (สตาฟเป็นคนแจกในเกมตาม code)',
        kind: 'loot-box',
      },
      {
        id: 'm1911-test',
        name: 'M1911 Pistol (Test)',
        price: 123,
        description: 'A test item for delivery.',
        kind: 'item',
        gameItemId: 'Weapon_M1911',
      },
    ],
  },
  commands: {
    disabled: [],
  },
  serverInfo: {
    name: 'SCUM TH เซิร์ฟเวอร์',
    ip: '127.0.0.1',
    port: '12345',
    maxPlayers: 90,
    description:
      'เซิร์ฟ SCUM PVP/PVE เน้น community ไทย ไม่ pay2win\nอ่านกติกาใน #server-info ก่อนเข้าเล่น',
    rulesShort: [
      'ห้ามใช้โปรแกรมช่วยเล่น / cheat / macro ผิดกติกา',
      'ห้าม toxic หนัก, เหยียดชาติ/ศาสนา/เพศ',
      'ห้ามทำลายของใน safe zone',
    ],
    website: null,
  },
  restartSchedule: [
    'ทุกวัน 06:00',
    'ทุกวัน 12:00',
    'ทุกวัน 18:00',
    'ทุกวัน 00:00',
  ],
  raidTimes: [
    'จันทร์ - ศุกร์: 18:00 - 23:00',
    'เสาร์ - อาทิตย์: 14:00 - 23:00',
  ],
  channels: {
    shopLog: 'shop-log',
    statusOnline: 'status-online',
    playerJoin: 'player-join',
    killFeed: 'kill-feed',
    restartAlerts: 'restart-alerts',
    bountyBoard: 'bounty-board',
    evidence: 'evidence',
    adminLog: 'admin-log',
    ticketsHub: 'tickets',
    commandsChannel: 'commands-channel',
    inServer: 'in-server',
  },
  killFeed: {
    // Used when no specific weapon image is matched.
    defaultWeaponImage:
      'https://img.icons8.com/color/96/rifle.png',
    unknownWeaponLabel: 'อาวุธไม่ทราบชนิด',

    // Optional map snapshot image in kill feed.
    // mapImageTemplate supports {sector} placeholder.
    mapImageTemplate: '',
    defaultMapImage: '',
    sectorMapImages: {},

    // Normalize raw SCUM weapon names to canonical display names.
    weaponAliases: {
      AK47: 'AK-47',
      'AK 47': 'AK-47',
      BP_WEAPON_AK47: 'AK-47',
      BP_WEAPON_AK47_C: 'AK-47',

      M16A4: 'M16A4',
      'M16 A4': 'M16A4',
      BP_WEAPON_M16A4: 'M16A4',
      BP_WEAPON_M16A4_C: 'M16A4',

      M82A1: 'M82A1',
      'M82 A1': 'M82A1',
      BP_WEAPON_M82A1: 'M82A1',
      BP_WEAPON_M82A1_C: 'M82A1',

      MP5: 'MP5',
      MP5K: 'MP5K',
      'MP5 K': 'MP5K',
      BP_WEAPON_MP5: 'MP5',
      BP_WEAPON_MP5_C: 'MP5',
      BP_WEAPON_MP5K: 'MP5K',
      BP_WEAPON_MP5K_C: 'MP5K',

      SVD: 'SVD',
      BP_WEAPON_SVD: 'SVD',
      BP_WEAPON_SVD_C: 'SVD',

      M9: 'M9',
      'TEC01 M9': 'M9',
      BP_WEAPON_M9: 'M9',
      BP_WEAPON_M9_C: 'M9',

      BOW: 'Bow',
      COMPOUND_BOW: 'Compound Bow',
      CROSSBOW: 'Crossbow',
    },

    // Canonical weapon name -> image URL
    weaponImages: {
      'AK-47': 'https://img.icons8.com/color/96/rifle.png',
      M16A4: 'https://img.icons8.com/color/96/rifle.png',
      M82A1: 'https://img.icons8.com/color/96/sniper-rifle.png',
      MP5: 'https://img.icons8.com/color/96/submachine-gun.png',
      MP5K: 'https://img.icons8.com/color/96/submachine-gun.png',
      SVD: 'https://img.icons8.com/color/96/sniper-rifle.png',
      M9: 'https://img.icons8.com/color/96/pistol-gun.png',
      Bow: 'https://img.icons8.com/color/96/bow-and-arrow.png',
      Crossbow: 'https://img.icons8.com/color/96/bow-and-arrow.png',
      'Compound Bow': 'https://img.icons8.com/color/96/bow-and-arrow.png',
    },
  },
  roles: {
    owner: 'Owner',
    admin: 'Admin',
    moderator: 'Moderator',
    helper: 'Helper',
    vip: 'VIP',
    verified: 'Verified',
    muted: 'Muted',
  },
  moderation: {
    spam: {
      messages: 5,
      intervalMs: 7000,
      muteMinutes: 10,
    },
    badWordsSoft: ['เหี้ย', 'สัส', 'ควาย'],
    badWordsHard: ['nigger', 'ควยแม่', 'ไปตาย'],
    hardTimeoutMinutes: 30,
  },
  vip: {
    plans: [
      {
        id: 'vip-7d',
        name: 'VIP 7 วัน',
        description: 'VIP 7 วัน, ห้อง VIP, สีชื่อพิเศษ, โบนัส daily เล็กน้อย',
        priceCoins: 5000,
        durationDays: 7,
      },
      {
        id: 'vip-30d',
        name: 'VIP 30 วัน',
        description:
          'VIP 30 วัน, ห้อง VIP, สีชื่อพิเศษ, โบนัส daily เล็กน้อย',
        priceCoins: 15000,
        durationDays: 30,
      },
    ],
  },
  rentBike: {
    timezone: 'Asia/Phnom_Penh',
    resetCheckIntervalMs: 15000,
    cooldownMinutes: 5,
    spawnSettleMs: 2500,
    resetDestroyDelayMs: 300,
    vehicle: {
      // Vehicle ID used by #SpawnVehicle <ID>
      spawnId: '',
      listCommand: '#ListSpawnedVehicles',
      spawnCommand: '#SpawnVehicle {spawnId}',
      destroyCommand: '#DestroyVehicle {vehicleInstanceId}',
      motorbikeKeywords: ['motorbike', 'motorcycle', 'bike', 'dirtbike'],
    },
    rcon: {
      commandTimeoutMs: 10000,
      commandRetries: 2,
      retryDelayMs: 1000,
      // Optional fallback if env RCON_EXEC_TEMPLATE is not set
      execTemplate: '',
    },
  },
  platform: {
    billing: {
      currency: 'THB',
      plans: [
        {
          id: 'trial-14d',
          name: 'Trial 14 วัน',
          type: 'trial',
          amountCents: 0,
          billingCycle: 'trial',
          intervalDays: 14,
          seats: 1,
          features: [
            '1 tenant',
            'ทดลอง delivery + admin web + player portal',
            'เหมาะสำหรับ proof-of-concept และ demo server',
          ],
        },
        {
          id: 'platform-starter',
          name: 'Starter',
          type: 'subscription',
          amountCents: 490000,
          billingCycle: 'monthly',
          intervalDays: 30,
          seats: 3,
          features: [
            '1 production tenant',
            'delivery runtime + monitoring',
            'backup/restore + player portal',
          ],
        },
        {
          id: 'platform-growth',
          name: 'Growth',
          type: 'subscription',
          amountCents: 1290000,
          billingCycle: 'monthly',
          intervalDays: 30,
          seats: 10,
          features: [
            'multi-tenant management',
            'API keys + outbound webhooks',
            'analytics + reseller-ready setup',
          ],
        },
      ],
    },
    legal: {
      currentVersion: '2026-03',
      docs: [
        { id: 'terms', version: '2026-03', title: 'Terms of Service', path: 'docs/LEGAL_TERMS_TH.md' },
        { id: 'privacy', version: '2026-03', title: 'Privacy Policy', path: 'docs/PRIVACY_POLICY_TH.md' },
        { id: 'subscription', version: '2026-03', title: 'Subscription Policy', path: 'docs/SUBSCRIPTION_POLICY_TH.md' },
      ],
    },
    localization: {
      defaultLocale: 'th',
      supportedLocales: ['th', 'en'],
      fallbackLocale: 'th',
    },
    permissions: {
      apiScopes: [
        'tenant:read',
        'tenant:write',
        'subscription:read',
        'subscription:write',
        'license:read',
        'license:write',
        'marketplace:read',
        'marketplace:write',
        'webhook:read',
        'webhook:write',
        'analytics:read',
        'delivery:reconcile',
        'agent:write',
      ],
    },
    antiAbuse: {
      windowMs: 60 * 60 * 1000,
      maxOrdersPerUser: 8,
      maxSameItemPerUser: 4,
      failedDeliveriesThreshold: 3,
      pendingOverdueMs: 20 * 60 * 1000,
    },
    monitoring: {
      enabled: true,
      intervalMs: 60 * 1000,
      reconcileEveryMs: 10 * 60 * 1000,
      staleAgentMs: 15 * 60 * 1000,
      alertCooldownMs: 10 * 60 * 1000,
    },
    backups: {
      enabled: true,
      intervalMs: 12 * 60 * 60 * 1000,
      includeSnapshot: true,
      note: 'auto-platform-backup',
    },
    agent: {
      minimumVersion: '1.0.0',
      releaseChannel: 'stable',
    },
    marketplace: {
      enabled: true,
      commissionPercent: 12,
      defaultCurrency: 'THB',
    },
    demo: {
      landingEnabled: true,
      showcaseEnabled: true,
      trialEnabled: true,
      publicApiEnabled: true,
    },
  },
  delivery: {
    auto: {
      enabled: true,
      executionMode: 'rcon',
      queueIntervalMs: 1200,
      maxRetries: 3,
      retryDelayMs: 6000,
      retryBackoff: 1.8,
      commandTimeoutMs: 10000,
      failedStatus: 'delivery_failed',
      // itemId OR gameItemId/spawn_id -> command string | command array
      // placeholders: {steamId} {itemId} {itemName} {gameItemId} {quantity} {itemKind} {userId} {purchaseCode}
      itemCommands: {},
      // If true: auto-use command template from scum_weapons_from_wiki.json
      // when no explicit itemCommands entry is found.
      wikiWeaponCommandFallbackEnabled: true,
      // If true: auto-use generic command template from scum_item_category_manifest.json
      // for all known item IDs in icon catalog when no explicit itemCommands is found.
      itemManifestCommandFallbackEnabled: true,
      // Agent mode hooks. Useful for workflows like:
      // - #TeleportTo "{teleportTarget}"
      // - #SpawnItem Weapon_M1911 1
      // - #TeleportTo "{returnTarget}"
      // placeholders:
      // {steamId} {itemId} {itemName} {gameItemId} {quantity} {itemKind}
      // {userId} {purchaseCode} {inGameName} {playerName}
      // {teleportTarget} {teleportTargetQuoted} {returnTarget} {returnTargetQuoted}
      agentPreCommands: [],
      agentPostCommands: [],
      agentCommandDelayMs: 600,
      agentPostTeleportDelayMs: 2000,
      magazineStackCount: 100,
      agentTeleportMode: 'player',
      agentTeleportTarget: '',
      agentReturnTarget: '',
      verifyMode: 'basic',
      verifySuccessPattern: '',
      verifyFailurePattern: '',
      verifyObserverWindowMs: 60000,
      // Optional fallback if env RCON_EXEC_TEMPLATE is not set.
      // Example:
      // rconExecTemplate: 'mcrcon -H {host} -P {port} -p "{password}" "{command}"',
      rconExecTemplate: '',
    },
  },
};

const runtimeConfig = deepClone(defaultConfig);
sanitizeMojibakeInPlace(runtimeConfig, defaultConfig);

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[config] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

function persistConfigToPrisma(snapshot) {
  if (!isPlainObject(snapshot)) return;
  const configJson = JSON.stringify(snapshot);
  queueDbWrite(
    async () => {
      await prisma.botConfig.upsert({
        where: { id: CONFIG_ROW_ID },
        update: {
          configJson,
        },
        create: {
          id: CONFIG_ROW_ID,
          configJson,
        },
      });
    },
    'upsert-config',
  );
}

async function hydrateConfigFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const row = await prisma.botConfig.findUnique({
      where: { id: CONFIG_ROW_ID },
    });
    if (!row) {
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(row.configJson);
    } catch (error) {
      console.error('[config] invalid configJson in prisma:', error.message);
      return;
    }
    if (!isPlainObject(parsed)) return;

    if (startVersion !== mutationVersion) {
      // Local runtime was updated before hydration completed; keep local state.
      persistConfigToPrisma(getConfigSnapshot());
      return;
    }

    const merged = deepClone(defaultConfig);
    mergePatchInPlace(merged, parsed);
    sanitizeMojibakeInPlace(merged, defaultConfig);
    replaceValueInPlace(runtimeConfig, merged);
    persistConfigToPrisma(getConfigSnapshot());
  } catch (error) {
    console.error('[config] failed to hydrate from prisma:', error.message);
  }
}

function initConfigStore() {
  if (!initPromise) {
    initPromise = hydrateConfigFromPrisma();
  }
  return initPromise;
}

function flushConfigWrites() {
  return dbWriteQueue;
}

function getConfigSnapshot() {
  return deepClone(runtimeConfig);
}

function updateConfigPatch(patch) {
  if (!isPlainObject(patch)) {
    throw new Error('patch must be an object');
  }
  mutationVersion += 1;
  mergePatchInPlace(runtimeConfig, patch);
  sanitizeMojibakeInPlace(runtimeConfig, defaultConfig);
  const snapshot = getConfigSnapshot();
  persistConfigToPrisma(snapshot);
  return snapshot;
}

function setFullConfig(nextConfig) {
  if (!isPlainObject(nextConfig)) {
    throw new Error('config must be an object');
  }
  mutationVersion += 1;
  const merged = deepClone(defaultConfig);
  mergePatchInPlace(merged, nextConfig);
  sanitizeMojibakeInPlace(merged, defaultConfig);
  replaceValueInPlace(runtimeConfig, merged);
  const snapshot = getConfigSnapshot();
  persistConfigToPrisma(snapshot);
  return snapshot;
}

function resetConfigToDefault() {
  mutationVersion += 1;
  replaceValueInPlace(runtimeConfig, defaultConfig);
  const snapshot = getConfigSnapshot();
  persistConfigToPrisma(snapshot);
  return snapshot;
}

initConfigStore();

module.exports = runtimeConfig;
Object.defineProperty(module.exports, 'getConfigSnapshot', {
  value: getConfigSnapshot,
  enumerable: false,
});
Object.defineProperty(module.exports, 'updateConfigPatch', {
  value: updateConfigPatch,
  enumerable: false,
});
Object.defineProperty(module.exports, 'setFullConfig', {
  value: setFullConfig,
  enumerable: false,
});
Object.defineProperty(module.exports, 'resetConfigToDefault', {
  value: resetConfigToDefault,
  enumerable: false,
});
Object.defineProperty(module.exports, 'initConfigStore', {
  value: initConfigStore,
  enumerable: false,
});
Object.defineProperty(module.exports, 'flushConfigWrites', {
  value: flushConfigWrites,
  enumerable: false,
});

