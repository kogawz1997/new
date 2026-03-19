const { EmbedBuilder } = require('discord.js');

const THEME_COLORS = Object.freeze({
  brand: 0x5865f2,
  info: 0x38bdf8,
  success: 0x22c55e,
  warn: 0xf59e0b,
  danger: 0xef4444,
  combat: 0xf97316,
  economy: 0xeab308,
  vip: 0xa855f7,
  support: 0x06b6d4,
  admin: 0x6366f1,
  neutral: 0x94a3b8,
});

function resolveThemeColor(tone, fallback = THEME_COLORS.brand) {
  return THEME_COLORS[tone] || fallback;
}

function truncateText(value, max = 1024) {
  const text = String(value ?? '').trim();
  if (!text) return '-';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function iconUrlFrom(entity) {
  if (!entity) return null;
  if (typeof entity.iconURL === 'function') {
    return entity.iconURL({ extension: 'png', size: 256 });
  }
  if (typeof entity.displayAvatarURL === 'function') {
    return entity.displayAvatarURL({ extension: 'png', size: 256 });
  }
  if (typeof entity.avatarURL === 'function') {
    return entity.avatarURL({ extension: 'png', size: 256 });
  }
  return null;
}

function resolveContextMeta(context = {}) {
  const guild = context.guild || null;
  const clientUser = context.client?.user || context.clientUser || null;
  return {
    guildName: String(context.guildName || guild?.name || '').trim() || null,
    guildIconUrl: context.guildIconUrl || iconUrlFrom(guild) || null,
    botAvatarUrl: context.botAvatarUrl || iconUrlFrom(clientUser) || null,
  };
}

function cleanLines(lines = []) {
  return []
    .concat(lines || [])
    .flat()
    .map((line) => String(line ?? '').trim())
    .filter(Boolean);
}

function createSection(title, lines, options = {}) {
  const cleaned = cleanLines(lines);
  if (!cleaned.length) return '';
  const body = options.bullets
    ? cleaned.map((line) => `• ${line}`).join('\n')
    : cleaned.join('\n');
  return `**${title}**\n${body}`;
}

function buildProgressBar(current, max, width = 10) {
  const safeMax = Math.max(0, Number(max || 0));
  const safeCurrent = Math.max(0, Number(current || 0));
  if (safeMax <= 0) {
    return '░'.repeat(Math.max(3, width));
  }
  const ratio = Math.min(1, safeCurrent / safeMax);
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString();
}

function formatCoins(value, symbol = '💰') {
  return `${symbol} ${formatNumber(value)}`;
}

function formatDurationMinutes(value) {
  const totalMinutes = Math.max(0, Number(value || 0));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} นาที`;
  if (minutes === 0) return `${hours} ชม.`;
  return `${hours} ชม. ${minutes} นาที`;
}

function createMetricFields(entries = []) {
  return entries
    .filter(Boolean)
    .map((entry) => ({
      name: truncateText(entry.name, 256),
      value: truncateText(entry.value, 1024),
      inline: entry.inline !== false,
    }));
}

function createDiscordCard(options = {}) {
  const meta = resolveContextMeta(options.context || {});
  const embed = new EmbedBuilder().setColor(resolveThemeColor(options.tone));

  if (options.title) embed.setTitle(truncateText(options.title, 256));
  if (options.url) embed.setURL(String(options.url));
  if (options.description) embed.setDescription(truncateText(options.description, 4096));

  const authorName = String(
    options.authorName || options.eyebrow || meta.guildName || 'SCUM TH',
  ).trim();
  const authorIconUrl = options.authorIconUrl || meta.guildIconUrl || meta.botAvatarUrl || null;
  if (authorName) {
    embed.setAuthor(
      authorIconUrl
        ? { name: truncateText(authorName, 256), iconURL: authorIconUrl }
        : { name: truncateText(authorName, 256) },
    );
  }

  const fields = createMetricFields(options.fields || []);
  if (fields.length > 0) {
    embed.addFields(fields.slice(0, 25));
  }

  if (options.thumbnail) embed.setThumbnail(String(options.thumbnail));
  if (options.image) embed.setImage(String(options.image));

  const footerText = String(options.footerText || meta.guildName || 'SCUM TH').trim();
  const footerIconUrl = options.footerIconUrl || meta.botAvatarUrl || null;
  if (footerText) {
    embed.setFooter(
      footerIconUrl
        ? { text: truncateText(footerText, 2048), iconURL: footerIconUrl }
        : { text: truncateText(footerText, 2048) },
    );
  }

  if (options.timestamp !== false) {
    embed.setTimestamp(
      options.timestamp === true || options.timestamp == null
        ? new Date()
        : options.timestamp,
    );
  }

  return embed;
}

module.exports = {
  THEME_COLORS,
  resolveThemeColor,
  truncateText,
  createSection,
  buildProgressBar,
  formatNumber,
  formatCoins,
  formatDurationMinutes,
  createMetricFields,
  createDiscordCard,
};
