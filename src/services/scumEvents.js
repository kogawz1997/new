const { channels, killFeed: killFeedConfig = {} } = require('../config');
const { updateStatus } = require('../store/scumStore');
const { listBounties, claimBounty } = require('../store/bountyStore');
const { creditCoins } = require('./coinService');
const {
  getLinkBySteamId,
  updateInGameNameBySteamId,
} = require('../store/linkStore');
const { addKill, addDeath } = require('../store/statsStore');
const { recordWeaponKill } = require('../store/weaponStatsStore');
const { publishAdminLiveUpdate } = require('./adminLiveBus');
const { queueLeaderboardRefreshForGuild } = require('./leaderboardPanels');
const { looksLikeMojibake } = require('../utils/mojibake');
const {
  buildProgressBar,
  createDiscordCard,
  createMetricFields,
  createSection,
  formatCoins,
  formatDurationMinutes,
} = require('../utils/discordEmbedTheme');

const killStreak = new Map();

function normalizeScopeOptions(options = {}) {
  return {
    tenantId: String(options.tenantId || '').trim() || null,
    defaultTenantId: String(options.defaultTenantId || '').trim() || null,
    env: options.env,
  };
}

function sanitizeLabel(value, fallback) {
  const text = String(value || '').trim();
  if (!text || looksLikeMojibake(text)) return fallback;
  return text;
}

function normalizeHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) return null;
  return text;
}

const UNKNOWN_WEAPON_LABEL = sanitizeLabel(
  killFeedConfig.unknownWeaponLabel,
  'อาวุธไม่ทราบชนิด',
);
const DEFAULT_WEAPON_IMAGE = normalizeHttpUrl(killFeedConfig.defaultWeaponImage);
const MAP_IMAGE_TEMPLATE = String(killFeedConfig.mapImageTemplate || '').trim();
const DEFAULT_MAP_IMAGE = normalizeHttpUrl(killFeedConfig.defaultMapImage);

function normalizeWeaponKey(value) {
  return String(value || '')
    .replace(/^BP[_\s-]?WEAPON[_\s-]?/i, '')
    .replace(/_C$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(([^)]*)\)/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function cleanWeaponDisplay(value) {
  return String(value || '')
    .replace(/^BP[_\s-]?WEAPON[_\s-]?/i, '')
    .replace(/_C$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(([^)]*)\)/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSector(value) {
  const compact = String(value || '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
  if (!compact) return null;
  if (!/^[A-Z]{1,2}\d{1,2}$/.test(compact)) return null;
  return compact;
}

const weaponAliasLookup = new Map(
  Object.entries(killFeedConfig.weaponAliases || {}).map(([raw, canonical]) => [
    normalizeWeaponKey(raw),
    String(canonical || '').trim(),
  ]),
);

const weaponImageLookup = new Map(
  Object.entries(killFeedConfig.weaponImages || {}).map(([weaponName, url]) => [
    normalizeWeaponKey(weaponName),
    String(url || '').trim(),
  ]),
);

const weaponDisplayLookup = new Map(
  Object.keys(killFeedConfig.weaponImages || {}).map((weaponName) => [
    normalizeWeaponKey(weaponName),
    String(weaponName || '').trim(),
  ]),
);

const sectorMapLookup = new Map(
  Object.entries(killFeedConfig.sectorMapImages || {}).map(([sector, url]) => [
    normalizeSector(sector),
    normalizeHttpUrl(url),
  ]),
);

function normalizeWeaponName(rawWeapon) {
  const key = normalizeWeaponKey(rawWeapon);
  if (!key) return UNKNOWN_WEAPON_LABEL;

  const alias = weaponAliasLookup.get(key);
  if (alias) return alias;

  const configuredDisplay = weaponDisplayLookup.get(key);
  if (configuredDisplay) return configuredDisplay;

  const cleaned = cleanWeaponDisplay(rawWeapon);
  return cleaned || UNKNOWN_WEAPON_LABEL;
}

function getWeaponImageUrl(rawWeaponOrCanonical) {
  const key = normalizeWeaponKey(rawWeaponOrCanonical);
  if (!key) return DEFAULT_WEAPON_IMAGE;
  return weaponImageLookup.get(key) || DEFAULT_WEAPON_IMAGE;
}

function resolveMapImageUrl(sector, explicitUrl) {
  const direct = normalizeHttpUrl(explicitUrl);
  if (direct) return direct;

  const normalizedSector = normalizeSector(sector);
  if (normalizedSector) {
    const mapped = sectorMapLookup.get(normalizedSector);
    if (mapped) return mapped;
    if (MAP_IMAGE_TEMPLATE) {
      return MAP_IMAGE_TEMPLATE
        .replaceAll('{sector}', encodeURIComponent(normalizedSector))
        .replaceAll('{SECTOR}', encodeURIComponent(normalizedSector));
    }
  }
  return DEFAULT_MAP_IMAGE;
}

function normalizeHitZone(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'head' || text === 'headshot') return 'head';
  if (text === 'body' || text === 'torso') return 'body';
  return null;
}

function hitZoneLabel(value) {
  const normalized = normalizeHitZone(value);
  if (normalized === 'head') return 'หัว';
  if (normalized === 'body') return 'ลำตัว';
  return 'ไม่ทราบ';
}

function formatDistance(distance) {
  if (distance == null || distance === '') return '-';
  const n = Number(distance);
  if (!Number.isFinite(n)) return '-';
  return `${n}m`;
}

function findNamedChannel(guild, name) {
  if (!guild) return null;
  return guild.channels.cache.find(
    (channel) =>
      channel.name === name && channel.isTextBased && channel.isTextBased(),
  );
}

async function sendStatusOnline(guild, payload, options = {}) {
  const channel = findNamedChannel(guild, channels.statusOnline);
  const scopeOptions = normalizeScopeOptions(options);
  updateStatus(payload, scopeOptions);

  const { onlinePlayers, maxPlayers, pingMs, uptimeMinutes } = payload;
  if (channel) {
    await channel.send({
      embeds: [
        createDiscordCard({
          context: { guild },
          tone: Number(onlinePlayers || 0) > 0 ? 'success' : 'info',
          authorName: 'Live Server Status',
          title: 'สถานะเซิร์ฟเวอร์ล่าสุด',
          description: createSection('Online Capacity', [
            `${buildProgressBar(onlinePlayers, maxPlayers, 10)} **${onlinePlayers}/${maxPlayers}**`,
          ]),
          fields: createMetricFields([
            { name: 'Ping', value: pingMs != null ? `${pingMs} ms` : 'ไม่ทราบ' },
            {
              name: 'Uptime',
              value:
                uptimeMinutes != null
                  ? formatDurationMinutes(Math.floor(uptimeMinutes))
                  : 'ไม่ทราบ',
            },
          ]),
          footerText: 'อัปเดตจาก SCUM runtime',
        }),
      ],
    });
  }
  publishAdminLiveUpdate('scum-status', {
    guildId: guild.id,
    onlinePlayers: payload.onlinePlayers,
    maxPlayers: payload.maxPlayers,
    pingMs: payload.pingMs,
    uptimeMinutes: payload.uptimeMinutes,
  });
}

async function sendPlayerJoinLeave(guild, event, options = {}) {
  const channel = findNamedChannel(guild, channels.playerJoin);
  const { playerName, type, steamId } = event;
  const scopeOptions = normalizeScopeOptions(options);
  if (steamId && playerName) {
    updateInGameNameBySteamId(steamId, playerName, scopeOptions);
  }
  if (channel) {
    await channel.send({
      embeds: [
        createDiscordCard({
          context: { guild },
          tone: type === 'join' ? 'success' : 'neutral',
          authorName: 'Player Activity',
          title: type === 'join' ? 'ผู้เล่นเข้าเซิร์ฟเวอร์' : 'ผู้เล่นออกจากเซิร์ฟเวอร์',
          description: createSection('Player', [`**${playerName}**`]),
          footerText: type === 'join' ? 'Realtime join event' : 'Realtime leave event',
        }),
      ],
    });
  }
  publishAdminLiveUpdate('scum-player', {
    guildId: guild.id,
    type,
    playerName,
  });
}

async function sendKillFeed(guild, event, options = {}) {
  const channel = findNamedChannel(guild, channels.killFeed);
  const scopeOptions = normalizeScopeOptions(options);

  const killerName = String(event.killer || 'Unknown').trim() || 'Unknown';
  const victimName = String(event.victim || 'Unknown').trim() || 'Unknown';
  const killerSteamId = String(event.killerSteamId || '').trim();
  const victimSteamId = String(event.victimSteamId || '').trim();
  const normalizedWeapon = normalizeWeaponName(event.weapon);
  const weaponImageUrl = getWeaponImageUrl(normalizedWeapon);
  const resolvedHitZone = normalizeHitZone(event.hitZone);
  const resolvedSector = normalizeSector(event.sector);
  const mapImageUrl = resolveMapImageUrl(resolvedSector, event.mapImageUrl);

  if (killerSteamId && killerName) {
    updateInGameNameBySteamId(killerSteamId, killerName, scopeOptions);
  }
  if (victimSteamId && victimName) {
    updateInGameNameBySteamId(victimSteamId, victimName, scopeOptions);
  }

  const killerNowStreak = (killStreak.get(killerName) || 0) + 1;
  const victimBeforeStreak = killStreak.get(victimName) || 0;
  killStreak.set(killerName, killerNowStreak);
  killStreak.set(victimName, 0);

  if (event.weapon) {
    recordWeaponKill({
      weapon: normalizedWeapon,
      distance: event.distance,
      killer: killerName,
    }, scopeOptions);
  }

  const notes = [`☠️ **${victimName}**`];
  if (killerNowStreak >= 3) {
    notes.push(`🔥 สตรีคคิล: **${killerNowStreak}**`);
  }
  if (victimBeforeStreak >= 3) {
    notes.push(`🧊 หยุดสตรีคของ ${victimName} ที่ **${victimBeforeStreak}**`);
  }

  const embed = createDiscordCard({
    context: { guild },
    tone: 'combat',
    authorName: 'SCUM Kill Feed',
    title: `${killerName} eliminated ${victimName}`,
    description: createSection('Combat Snapshot', notes),
    fields: createMetricFields([
      { name: 'Weapon', value: normalizedWeapon },
      { name: 'Distance', value: formatDistance(event.distance) },
      { name: 'Sector', value: resolvedSector || '-' },
      { name: 'Hit Zone', value: hitZoneLabel(resolvedHitZone) },
      { name: 'Kill Streak', value: String(killerNowStreak) },
    ]),
    footerText: 'Realtime combat event',
  });

  if (weaponImageUrl) {
    embed.setThumbnail(weaponImageUrl);
  }
  if (mapImageUrl) {
    embed.setImage(mapImageUrl);
  }

  if (channel) {
    await channel.send({ embeds: [embed] });
  }

  const killerLink = killerSteamId ? getLinkBySteamId(killerSteamId, scopeOptions) : null;
  const victimLink = victimSteamId ? getLinkBySteamId(victimSteamId, scopeOptions) : null;
  if (killerLink?.userId) addKill(killerLink.userId, 1, scopeOptions);
  if (victimLink?.userId) addDeath(victimLink.userId, 1, scopeOptions);

  publishAdminLiveUpdate('scum-kill', {
    guildId: guild.id,
    killer: killerName,
    victim: victimName,
    weapon: normalizedWeapon,
    weaponImage: weaponImageUrl,
    distance: event.distance != null ? Number(event.distance) : null,
    hitZone: resolvedHitZone,
    sector: resolvedSector,
    mapImageUrl,
  });
  queueLeaderboardRefreshForGuild(guild.client, guild.id, 'scum-kill', scopeOptions);

  const activeBounties = listBounties(scopeOptions).filter((row) => row.status === 'active');
  const matchedBounty = activeBounties.find(
    (row) => row.targetName.toLowerCase() === victimName.toLowerCase(),
  );

  if (!matchedBounty) return;

  const claimed = claimBounty(matchedBounty.id, killerName, scopeOptions);
  if (!claimed.ok) return;

  const bountyChannel = findNamedChannel(
    guild,
    channels.bountyBoard || 'bounty-board',
  );
  const amount = matchedBounty.amount;
  const killerDiscordId = killerLink?.userId || null;

  if (killerDiscordId) {
    await creditCoins({
      userId: killerDiscordId,
      amount,
      reason: 'bounty_claim',
      actor: 'system:scum-events',
      ...scopeOptions,
      meta: {
        bountyId: matchedBounty.id,
        targetName: victimName,
        killerName,
      },
    });
  }

  if (!bountyChannel) return;

  if (killerDiscordId) {
    await bountyChannel.send({
      embeds: [
        createDiscordCard({
          context: { guild },
          tone: 'economy',
          authorName: 'Bounty Claimed',
          title: 'ภารกิจค่าหัวสำเร็จ',
          description: createSection('นักล่า', [`<@${killerDiscordId}> จัดการเป้าหมาย **${victimName}**`]),
          fields: createMetricFields([
            { name: 'Reward', value: formatCoins(amount) },
            { name: 'สถานะ', value: 'โอนเหรียญอัตโนมัติแล้ว ✅', inline: false },
          ]),
          footerText: `Bounty ID: ${matchedBounty.id}`,
        }),
      ],
    });
    return;
  }

  await bountyChannel.send({
    embeds: [
      createDiscordCard({
        context: { guild },
        tone: 'warn',
        authorName: 'Bounty Claimed',
        title: 'ภารกิจค่าหัวสำเร็จ',
        description: createSection('นักล่า', [`**${killerName}** จัดการเป้าหมาย **${victimName}**`]),
        fields: createMetricFields([
          { name: 'Reward', value: formatCoins(amount) },
          {
            name: 'สถานะการจ่าย',
            value: 'ยังโอนอัตโนมัติไม่ได้ ผู้สังหารต้องลิงก์ SteamID ก่อน',
            inline: false,
          },
        ]),
        footerText: `Bounty ID: ${matchedBounty.id}`,
      }),
    ],
  });
}

async function sendRestartAlert(guild, message, options = {}) {
  const scopeOptions = normalizeScopeOptions(options);
  const channel = findNamedChannel(guild, channels.restartAlerts);
  if (channel) {
    await channel.send({
      embeds: [
        createDiscordCard({
          context: { guild },
          tone: 'warn',
          authorName: 'Restart Alert',
          title: 'แจ้งเตือนการรีสตาร์ต',
          description: String(message || '-'),
          footerText: 'Runtime restart scheduler',
        }),
      ],
    });
  }
  publishAdminLiveUpdate('scum-restart', {
    guildId: guild.id,
    message,
    tenantId: scopeOptions.tenantId || null,
  });
}

module.exports = {
  sendStatusOnline,
  sendPlayerJoinLeave,
  sendKillFeed,
  sendRestartAlert,
};
