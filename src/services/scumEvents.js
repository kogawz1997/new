const { EmbedBuilder } = require('discord.js');
const { channels, killFeed: killFeedConfig = {} } = require('../config');
const { updateStatus } = require('../store/scumStore');
const { listBounties, claimBounty } = require('../store/bountyStore');
const { creditCoins } = require('./coinService');
const { getLinkBySteamId, updateInGameNameBySteamId } = require('../store/linkStore');
const { addKill, addDeath } = require('../store/statsStore');
const { recordWeaponKill } = require('../store/weaponStatsStore');
const { publishAdminLiveUpdate } = require('./adminLiveBus');
const { queueLeaderboardRefreshForGuild } = require('./leaderboardPanels');

const killStreak = new Map();
const UNKNOWN_WEAPON_LABEL =
  String(killFeedConfig.unknownWeaponLabel || '').trim() || 'อาวุธไม่ทราบชนิด';
const DEFAULT_WEAPON_IMAGE =
  String(killFeedConfig.defaultWeaponImage || '').trim() || null;

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

function normalizeHitZone(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'head' || text === 'headshot') return 'head';
  if (text === 'body' || text === 'torso') return 'body';
  return null;
}

function hitZoneLabel(value) {
  const z = normalizeHitZone(value);
  if (z === 'head') return 'หัว';
  if (z === 'body') return 'ลำตัว';
  return 'ไม่ทราบ';
}

function findNamedChannel(guild, name) {
  if (!guild) return null;
  return guild.channels.cache.find(
    (c) => c.name === name && c.isTextBased && c.isTextBased(),
  );
}

async function sendStatusOnline(guild, payload) {
  const channel = findNamedChannel(guild, channels.statusOnline);
  updateStatus(payload);
  const { onlinePlayers, maxPlayers, pingMs, uptimeMinutes } = payload;
  const lines = [];
  lines.push(`ผู้เล่นออนไลน์: **${onlinePlayers}/${maxPlayers}**`);
  if (pingMs != null) lines.push(`ping: **${pingMs} ms**`);
  if (uptimeMinutes != null) lines.push(`uptime: **${Math.floor(uptimeMinutes)} นาที**`);
  if (channel) {
    await channel.send(lines.join('\n'));
  }
  publishAdminLiveUpdate('scum-status', {
    guildId: guild.id,
    onlinePlayers: payload.onlinePlayers,
    maxPlayers: payload.maxPlayers,
    pingMs: payload.pingMs,
    uptimeMinutes: payload.uptimeMinutes,
  });
}

async function sendPlayerJoinLeave(guild, event) {
  const channel = findNamedChannel(guild, channels.playerJoin);
  const { playerName, type, steamId } = event;
  if (steamId && playerName) {
    updateInGameNameBySteamId(steamId, playerName);
  }
  const text =
    type === 'join'
      ? `✅ **${playerName}** เข้าสู่เซิร์ฟเวอร์`
      : `🚪 **${playerName}** ออกจากเซิร์ฟเวอร์`;
  if (channel) {
    await channel.send(text);
  }
  publishAdminLiveUpdate('scum-player', {
    guildId: guild.id,
    type,
    playerName,
  });
}

async function sendKillFeed(guild, event) {
  const channel = findNamedChannel(guild, channels.killFeed);

  const {
    killer,
    killerSteamId,
    victim,
    victimSteamId,
    weapon,
    distance,
    hitZone,
  } = event;
  const normalizedWeapon = normalizeWeaponName(weapon);
  const weaponImageUrl = getWeaponImageUrl(normalizedWeapon);
  const resolvedHitZone = normalizeHitZone(hitZone);

  if (killerSteamId && killer) {
    updateInGameNameBySteamId(killerSteamId, killer);
  }
  if (victimSteamId && victim) {
    updateInGameNameBySteamId(victimSteamId, victim);
  }

  const killerNowStreak = (killStreak.get(killer) || 0) + 1;
  const victimBeforeStreak = killStreak.get(victim) || 0;
  killStreak.set(killer, killerNowStreak);
  killStreak.set(victim, 0);

  if (weapon) {
    recordWeaponKill({ weapon: normalizedWeapon, distance, killer });
  }

  const lines = [];
  if (killerNowStreak >= 3) {
    lines.push(`🔥 สตรีคคิล: **${killerNowStreak}** (กำลังเดือด!)`);
  }
  if (victimBeforeStreak >= 3) {
    lines.push(`🧊 ${killer} หยุดสตรีคของ ${victim} ที่ **${victimBeforeStreak}** ได้สำเร็จ`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x60a5fa)
    .setTitle(`☠️ ${killer}  ➜  ${victim}`)
    .addFields(
      { name: 'อาวุธ', value: normalizedWeapon, inline: true },
      {
        name: 'ระยะ',
        value: distance != null ? `${distance} m` : '-',
        inline: true,
      },
      {
        name: 'จุดโดนยิง',
        value: hitZoneLabel(resolvedHitZone),
        inline: true,
      },
      {
        name: 'สตรีคคิล',
        value: `${killerNowStreak}`,
        inline: true,
      },
    )
    .setFooter({ text: 'ฟีดคิล SCUM (เรียลไทม์)' })
    .setTimestamp();

  if (lines.length > 0) {
    embed.setDescription(lines.join('\n'));
  }
  if (weaponImageUrl) {
    embed.setThumbnail(weaponImageUrl);
  }

  if (channel) {
    await channel.send({ embeds: [embed] });
  }

  const killerLink = killerSteamId ? getLinkBySteamId(killerSteamId) : null;
  const victimLink = victimSteamId ? getLinkBySteamId(victimSteamId) : null;
  if (killerLink?.userId) addKill(killerLink.userId, 1);
  if (victimLink?.userId) addDeath(victimLink.userId, 1);
  publishAdminLiveUpdate('scum-kill', {
    guildId: guild.id,
    killer,
    victim,
    weapon: normalizedWeapon,
    weaponImage: weaponImageUrl,
    distance: distance != null ? Number(distance) : null,
    hitZone: resolvedHitZone,
  });
  queueLeaderboardRefreshForGuild(guild.client, guild.id, 'scum-kill');

  const activeBounties = listBounties().filter((b) => b.status === 'active');
  const match = activeBounties.find(
    (b) => b.targetName.toLowerCase() === String(victim).toLowerCase(),
  );

  if (match) {
    const res = claimBounty(match.id, killer);
    if (res.ok) {
      const bountyChannel = findNamedChannel(
        guild,
        channels.bountyBoard || 'bounty-board',
      );
      const amount = match.amount;
      const killerDiscordId = killerLink?.userId || null;

      if (killerDiscordId) {
        await creditCoins({
          userId: killerDiscordId,
          amount,
          reason: 'bounty_claim',
          actor: 'system:scum-events',
          meta: {
            bountyId: match.id,
            targetName: victim,
            killerName: killer,
          },
        });
      }

      if (bountyChannel) {
        await bountyChannel.send(
          killerDiscordId
            ? `🎯 ค่าหัวสำเร็จ! <@${killerDiscordId}> ฆ่าเป้าหมาย **${victim}**\nค่าหัว: **${amount.toLocaleString()} เหรียญ** (โอนเหรียญให้อัตโนมัติแล้ว ✅)`
            : `🎯 ค่าหัวสำเร็จ! **${killer}** ฆ่าเป้าหมาย **${victim}**\nค่าหัว: **${amount.toLocaleString()} เหรียญ**\nยังไม่สามารถโอนอัตโนมัติได้ (ยังไม่ลิงก์ SteamID) ให้ผู้สังหารใช้ \`/linksteam set\` แล้วทีมงานค่อยโอนเหรียญ`,
        );
      }
    }
  }
}

async function sendRestartAlert(guild, message) {
  const channel = findNamedChannel(guild, channels.restartAlerts);
  if (channel) {
    await channel.send(message);
  }
  publishAdminLiveUpdate('scum-restart', {
    guildId: guild.id,
    message,
  });
}

module.exports = {
  sendStatusOnline,
  sendPlayerJoinLeave,
  sendKillFeed,
  sendRestartAlert,
};
