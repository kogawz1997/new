const { listAllStats } = require('../store/statsStore');
const { listWeaponStats } = require('../store/weaponStatsStore');
const { listTopWallets } = require('../store/memoryStore');
const { getLinkByUserId } = require('../store/linkStore');
const { economy } = require('../config');
const {
  setTopPanelMessage,
  getTopPanelsForGuild,
  removeTopPanelMessage,
  normalizePanelType,
} = require('../store/topPanelStore');
const { publishAdminLiveUpdate } = require('./adminLiveBus');
const {
  createDiscordCard,
  createMetricFields,
  createSection,
  formatCoins,
  formatDurationMinutes,
} = require('../utils/discordEmbedTheme');

const REFRESH_DEBOUNCE_MS = Math.max(
  300,
  Number(process.env.LEADERBOARD_PANEL_REFRESH_MS || 1200),
);
const RANK_CARD_COUNT = Math.max(
  1,
  Math.min(3, Number(process.env.LEADERBOARD_PANEL_CARD_COUNT || 3) || 3),
);
const SUMMARY_ROW_LIMIT = Math.max(
  RANK_CARD_COUNT,
  Number(process.env.LEADERBOARD_PANEL_SUMMARY_ROWS || 10),
);

const refreshTimers = new Map();
const runningGuilds = new Set();

function normalizeScopeOptions(options = {}) {
  return {
    tenantId: String(options.tenantId || '').trim() || null,
    defaultTenantId: String(options.defaultTenantId || '').trim() || null,
    env: options.env,
  };
}

function pad(value, width) {
  const text = String(value);
  if (text.length >= width) return text.slice(0, width);
  return text + ' '.repeat(width - text.length);
}

function table(headers, rows) {
  const head = headers.map((entry) => pad(entry.label, entry.width)).join(' ');
  const sep = headers.map((entry) => '-'.repeat(entry.width)).join(' ');
  const body = rows
    .map((row) => headers.map((entry) => pad(row[entry.key] ?? '', entry.width)).join(' '))
    .join('\n');
  return ['```', head, sep, body || '(ไม่มีข้อมูล)', '```'].join('\n');
}

function normalizeEmbeds(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function resolveLeaderboardProfile(client, guild, userId, options = {}) {
  const uid = String(userId || '').trim();
  if (!uid) {
    return {
      userId: null,
      displayName: '-',
      discordName: null,
      mention: null,
      avatarUrl: null,
      inGameName: null,
      linked: false,
    };
  }

  const scopeOptions = normalizeScopeOptions(options);
  const member = guild?.members?.cache?.get(uid) || null;
  const user = member?.user || client?.users?.cache?.get(uid) || null;
  const link = getLinkByUserId(uid, scopeOptions);
  const inGameName = String(link?.inGameName || '').trim() || null;
  const discordName = String(member?.displayName || user?.tag || user?.username || uid).trim();
  const displayName = inGameName || discordName || uid;
  const avatarUrl =
    member?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || user?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || null;

  return {
    userId: uid,
    displayName,
    discordName,
    mention: `<@${uid}>`,
    avatarUrl,
    inGameName,
    linked: Boolean(link?.steamId),
  };
}

function buildLeaderboardContext(guild) {
  return {
    guildName: guild?.name || 'Ranking System',
    guildIconUrl: guild?.iconURL?.({ extension: 'png', size: 256 }) || null,
  };
}

function buildLeaderboardCardDescription(profile) {
  return [
    createSection('Name', [profile.displayName || '-']),
    profile.mention
      ? createSection(
          'Discord',
          profile.discordName && profile.discordName !== profile.displayName
            ? [`${profile.mention} (${profile.discordName})`]
            : [profile.mention],
        )
      : profile.discordName && profile.discordName !== profile.displayName
        ? createSection('Discord', [profile.discordName])
        : '',
  ].filter(Boolean).join('\n\n');
}

function buildLeaderboardRankCard(title, color, rankIndex, profile, fields, footerNote = null, context = {}) {
  const accentColors = [0xfbbf24, 0xcbd5e1, 0xf97316];
  const medals = ['🥇', '🥈', '🥉'];
  return createDiscordCard({
    context,
    tone: null,
    authorName: `${medals[rankIndex] || '🏅'} Rank ${rankIndex + 1}`,
    title,
    description: buildLeaderboardCardDescription(profile),
    fields,
    thumbnail: profile.avatarUrl,
    footerText: footerNote || (profile.linked ? 'Linked Steam profile' : 'Discord profile'),
    timestamp: true,
  }).setColor(accentColors[rankIndex] || color);
}

function buildLeaderboardSummaryEmbed(title, color, headers, rows, note = null, context = {}) {
  return createDiscordCard({
    context,
    tone: null,
    authorName: 'Ranking System',
    title: `${title} • More`,
    description: table(headers, rows),
    footerText: note || 'Summary view',
    timestamp: true,
  }).setColor(color);
}

function buildEmptyLeaderboardEmbed(title, color, context = {}) {
  return createDiscordCard({
    context,
    tone: null,
    authorName: 'Ranking System',
    title,
    description: 'ยังไม่มีข้อมูล',
    footerText: 'รอข้อมูลรอบถัดไป',
    timestamp: true,
  }).setColor(color);
}

function buildUserLeaderboardEmbeds({
  client,
  guildId,
  title,
  color,
  entries,
  summaryHeaders,
  buildSummaryRow,
  buildCardFields,
  summaryNote = null,
  cardFooterNote = null,
  options = {},
}) {
  const guild = guildId ? client.guilds.cache.get(guildId) : null;
  const context = buildLeaderboardContext(guild);
  const ranked = entries
    .slice(0, SUMMARY_ROW_LIMIT)
    .map((entry, rankIndex) => ({
      rankIndex,
      entry,
      profile: resolveLeaderboardProfile(client, guild, entry.userId, options),
    }));

  if (ranked.length === 0) {
    return [buildEmptyLeaderboardEmbed(title, color, context)];
  }

  const embeds = ranked
    .slice(0, RANK_CARD_COUNT)
    .map(({ rankIndex, entry, profile }) =>
      buildLeaderboardRankCard(
        title,
        color,
        rankIndex,
        profile,
        buildCardFields(entry, profile),
        cardFooterNote,
        context,
      ));

  const summaryRows = ranked
    .slice(RANK_CARD_COUNT)
    .map(({ rankIndex, entry, profile }) => buildSummaryRow(entry, rankIndex, profile));
  if (summaryRows.length > 0) {
    embeds.push(
      buildLeaderboardSummaryEmbed(title, color, summaryHeaders, summaryRows, summaryNote, context),
    );
  }

  return embeds;
}

function buildTopKillerEmbed(client, guildId, options = {}) {
  const scopeOptions = normalizeScopeOptions(options);
  const all = listAllStats(scopeOptions).slice();
  all.sort((left, right) => Number(right.kills || 0) - Number(left.kills || 0));

  return buildUserLeaderboardEmbeds({
    client,
    guildId,
    title: 'อันดับการสังหาร',
    color: 0xff8c00,
    entries: all,
    options: scopeOptions,
    summaryHeaders: [
      { key: 'rank', label: 'อันดับ', width: 6 },
      { key: 'kills', label: 'คิล', width: 7 },
      { key: 'deaths', label: 'ตาย', width: 7 },
      { key: 'kd', label: 'K/D', width: 6 },
      { key: 'name', label: 'ชื่อ', width: 20 },
    ],
    buildSummaryRow: (entry, rankIndex, profile) => {
      const kd = Number(entry.deaths || 0) === 0
        ? Number(entry.kills || 0)
        : Number(entry.kills || 0) / Number(entry.deaths || 1);
      return {
        rank: `[${rankIndex + 1}]`,
        kills: String(entry.kills),
        deaths: String(entry.deaths),
        kd: kd.toFixed(2),
        name: profile.displayName,
      };
    },
    buildCardFields: (entry) => {
      const kd = Number(entry.deaths || 0) === 0
        ? Number(entry.kills || 0)
        : Number(entry.kills || 0) / Number(entry.deaths || 1);
      return createMetricFields([
        { name: 'Kills', value: String(entry.kills) },
        { name: 'Deaths', value: String(entry.deaths) },
        { name: 'K/D', value: kd.toFixed(2) },
      ]);
    },
  });
}

function buildTopGunKillEmbed(options = {}) {
  const all = listWeaponStats(normalizeScopeOptions(options)).slice();
  all.sort((left, right) => Number(right.kills || 0) - Number(left.kills || 0));

  const rows = all.slice(0, 20).map((entry, index) => ({
    rank: `[${index + 1}]`,
    kills: String(entry.kills),
    dist: `${Math.floor(entry.longestDistance || 0)}m`,
    weapon: entry.weapon,
    holder: entry.recordHolder || '-',
  }));

  return createDiscordCard({
    context: { guildName: 'Ranking System' },
    tone: null,
    authorName: 'Weapon Leaderboard',
    title: 'อันดับสังหารด้วยอาวุธ',
    description: table(
      [
        { key: 'rank', label: 'อันดับ', width: 6 },
        { key: 'kills', label: 'คิล', width: 7 },
        { key: 'dist', label: 'ระยะ', width: 7 },
        { key: 'weapon', label: 'อาวุธ', width: 16 },
        { key: 'holder', label: 'ผู้ถือสถิติ', width: 20 },
      ],
      rows,
    ),
    footerText: 'อัปเดตจากสถิติอาวุธล่าสุด',
    timestamp: true,
  }).setColor(0x4aa3ff);
}

function buildTopKdEmbed(client, guildId, options = {}) {
  const scopeOptions = normalizeScopeOptions(options);
  const all = listAllStats(scopeOptions).slice();
  all.sort((left, right) => {
    const kdLeft = Number(left.deaths || 0) === 0
      ? Number(left.kills || 0)
      : Number(left.kills || 0) / Number(left.deaths || 1);
    const kdRight = Number(right.deaths || 0) === 0
      ? Number(right.kills || 0)
      : Number(right.kills || 0) / Number(right.deaths || 1);
    return kdRight - kdLeft;
  });

  return buildUserLeaderboardEmbeds({
    client,
    guildId,
    title: 'อันดับ K/D',
    color: 0xf0abfc,
    entries: all,
    options: scopeOptions,
    summaryHeaders: [
      { key: 'rank', label: 'อันดับ', width: 6 },
      { key: 'kd', label: 'K/D', width: 6 },
      { key: 'kills', label: 'คิล', width: 7 },
      { key: 'deaths', label: 'ตาย', width: 7 },
      { key: 'name', label: 'ชื่อ', width: 20 },
    ],
    buildSummaryRow: (entry, rankIndex, profile) => {
      const kd = Number(entry.deaths || 0) === 0
        ? Number(entry.kills || 0)
        : Number(entry.kills || 0) / Number(entry.deaths || 1);
      return {
        rank: `[${rankIndex + 1}]`,
        kd: kd.toFixed(2),
        kills: String(entry.kills),
        deaths: String(entry.deaths),
        name: profile.displayName,
      };
    },
    buildCardFields: (entry) => {
      const kd = Number(entry.deaths || 0) === 0
        ? Number(entry.kills || 0)
        : Number(entry.kills || 0) / Number(entry.deaths || 1);
      return createMetricFields([
        { name: 'K/D', value: kd.toFixed(2) },
        { name: 'Kills', value: String(entry.kills) },
        { name: 'Deaths', value: String(entry.deaths) },
      ]);
    },
  });
}

function buildTopPlaytimeEmbed(client, guildId, options = {}) {
  const scopeOptions = normalizeScopeOptions(options);
  const all = listAllStats(scopeOptions).slice();
  all.sort((left, right) =>
    Number(right.playtimeMinutes || 0) - Number(left.playtimeMinutes || 0));

  return buildUserLeaderboardEmbeds({
    client,
    guildId,
    title: 'อันดับเวลาเล่น',
    color: 0x38bdf8,
    entries: all,
    options: scopeOptions,
    summaryHeaders: [
      { key: 'rank', label: 'อันดับ', width: 6 },
      { key: 'playtime', label: 'เวลาเล่น', width: 9 },
      { key: 'kills', label: 'คิล', width: 7 },
      { key: 'deaths', label: 'ตาย', width: 7 },
      { key: 'name', label: 'ชื่อ', width: 20 },
    ],
    buildSummaryRow: (entry, rankIndex, profile) => ({
      rank: `[${rankIndex + 1}]`,
      playtime: formatDurationMinutes(Number(entry.playtimeMinutes || 0)),
      kills: String(entry.kills),
      deaths: String(entry.deaths),
      name: profile.displayName,
    }),
    buildCardFields: (entry) => createMetricFields([
      {
        name: 'Playtime',
        value: formatDurationMinutes(Number(entry.playtimeMinutes || 0)),
      },
      { name: 'Kills', value: String(entry.kills) },
      { name: 'Deaths', value: String(entry.deaths) },
    ]),
  });
}

async function buildTopEconomyEmbed(client, guildId, options = {}) {
  const scopeOptions = normalizeScopeOptions(options);
  const wallets = await listTopWallets(SUMMARY_ROW_LIMIT, scopeOptions);
  const embeds = buildUserLeaderboardEmbeds({
    client,
    guildId,
    title: 'อันดับเศรษฐกิจ',
    color: 0x22c55e,
    entries: wallets.map((wallet) => ({
      userId: wallet.userId,
      balance: Number(wallet.balance || 0),
    })),
    options: scopeOptions,
    summaryHeaders: [
      { key: 'rank', label: 'อันดับ', width: 6 },
      { key: 'coins', label: 'เหรียญ', width: 12 },
      { key: 'user', label: 'ผู้ใช้', width: 22 },
    ],
    buildSummaryRow: (entry, rankIndex, profile) => ({
      rank: `[${rankIndex + 1}]`,
      coins: Number(entry.balance || 0).toLocaleString(),
      user: profile.displayName,
    }),
    buildCardFields: (entry) => createMetricFields([
      {
        name: 'Balance',
        value: formatCoins(entry.balance || 0, economy.currencySymbol || 'เหรียญ'),
        inline: false,
      },
    ]),
    summaryNote: `สกุลเงิน: ${economy.currencySymbol || 'เหรียญ'}`,
    cardFooterNote: `สกุลเงิน: ${economy.currencySymbol || 'เหรียญ'}`,
  });

  return embeds.length > 0
    ? embeds
    : [buildEmptyLeaderboardEmbed('อันดับเศรษฐกิจ', 0x22c55e)];
}

function registerLeaderboardPanelMessage(panelType, message, options = {}) {
  const key = normalizePanelType(panelType);
  if (!key) return null;
  if (!message?.guildId || !message?.channelId || !message?.id) return null;
  const saved = setTopPanelMessage(
    message.guildId,
    key,
    message.channelId,
    message.id,
    normalizeScopeOptions(options),
  );
  publishAdminLiveUpdate('leaderboard-register', {
    guildId: message.guildId,
    panelType: key,
    channelId: message.channelId,
    messageId: message.id,
  });
  return saved;
}

async function loadMessageByRef(client, ref) {
  if (!ref?.channelId || !ref?.messageId) return null;
  const channel =
    client.channels.cache.get(ref.channelId)
    || (await client.channels.fetch(ref.channelId).catch(() => null));
  if (!channel || !channel.isTextBased || !channel.isTextBased()) return null;
  if (!channel.messages?.fetch) return null;
  const message = await channel.messages.fetch(ref.messageId).catch(() => null);
  return message || null;
}

async function refreshLeaderboardPanelsNow(client, guildId, reason = 'update', options = {}) {
  const gid = String(guildId || '').trim();
  if (!gid) return { ok: false, reason: 'invalid-guild-id', updated: 0 };
  if (runningGuilds.has(gid)) {
    return { ok: false, reason: 'already-running', updated: 0 };
  }
  const scopeOptions = normalizeScopeOptions(options);

  runningGuilds.add(gid);
  let updated = 0;
  try {
    const refs = getTopPanelsForGuild(gid, scopeOptions);
    const tasks = [
      { type: 'topKiller', ref: refs.topKiller },
      { type: 'topGunKill', ref: refs.topGunKill },
      { type: 'topKd', ref: refs.topKd },
      { type: 'topPlaytime', ref: refs.topPlaytime },
      { type: 'topEconomy', ref: refs.topEconomy },
    ];

    for (const task of tasks) {
      if (!task.ref) continue;
      const message = await loadMessageByRef(client, task.ref);
      if (!message) {
        removeTopPanelMessage(gid, task.type, scopeOptions);
        continue;
      }

      let embeds = [];
      if (task.type === 'topKiller') {
        embeds = normalizeEmbeds(buildTopKillerEmbed(client, gid, scopeOptions));
      } else if (task.type === 'topGunKill') {
        embeds = normalizeEmbeds(buildTopGunKillEmbed(scopeOptions));
      } else if (task.type === 'topKd') {
        embeds = normalizeEmbeds(buildTopKdEmbed(client, gid, scopeOptions));
      } else if (task.type === 'topPlaytime') {
        embeds = normalizeEmbeds(buildTopPlaytimeEmbed(client, gid, scopeOptions));
      } else if (task.type === 'topEconomy') {
        embeds = normalizeEmbeds(await buildTopEconomyEmbed(client, gid, scopeOptions));
      } else {
        continue;
      }

      try {
        await message.edit({ embeds });
        updated += 1;
      } catch (error) {
        const code = Number(error?.code || 0);
        if (code === 10008 || code === 50001 || code === 50013) {
          removeTopPanelMessage(gid, task.type, scopeOptions);
          continue;
        }
        console.error(
          `[leaderboard] แก้ไข ${task.type} ของกิลด์ ${gid} ไม่สำเร็จ:`,
          error.message || error,
        );
      }
    }

    if (updated > 0) {
      publishAdminLiveUpdate('leaderboard-refresh', {
        guildId: gid,
        reason,
        updated,
      });
    }

    return { ok: true, updated };
  } finally {
    runningGuilds.delete(gid);
  }
}

function queueLeaderboardRefreshForGuild(client, guildId, reason = 'update', options = {}) {
  const gid = String(guildId || '').trim();
  if (!gid || !client) return;
  const scopeOptions = normalizeScopeOptions(options);
  const prev = refreshTimers.get(gid);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    refreshTimers.delete(gid);
    void refreshLeaderboardPanelsNow(client, gid, reason, scopeOptions);
  }, REFRESH_DEBOUNCE_MS);
  refreshTimers.set(gid, timer);
}

function queueLeaderboardRefreshForAllGuilds(client, reason = 'update', options = {}) {
  if (!client?.guilds?.cache) return;
  for (const guildId of client.guilds.cache.keys()) {
    queueLeaderboardRefreshForGuild(client, guildId, reason, options);
  }
}

module.exports = {
  buildTopKillerEmbed,
  buildTopGunKillEmbed,
  buildTopKdEmbed,
  buildTopPlaytimeEmbed,
  buildTopEconomyEmbed,
  registerLeaderboardPanelMessage,
  refreshLeaderboardPanelsNow,
  queueLeaderboardRefreshForGuild,
  queueLeaderboardRefreshForAllGuilds,
};
