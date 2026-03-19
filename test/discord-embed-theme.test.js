const test = require('node:test');
const assert = require('node:assert/strict');

const {
  THEME_COLORS,
  buildProgressBar,
  createDiscordCard,
  createMetricFields,
  createSection,
  formatCoins,
  formatDurationMinutes,
} = require('../src/utils/discordEmbedTheme');

test('discord theme helper builds branded embeds with fields and footer', () => {
  const embed = createDiscordCard({
    tone: 'success',
    title: 'Delivery Complete',
    description: createSection('Summary', ['Order #P-001', 'AK-47 x1']),
    fields: createMetricFields([
      { name: 'Status', value: 'Queued' },
      { name: 'Balance', value: formatCoins(2500) },
    ]),
    context: {
      guildName: 'SCUM TH',
      guildIconUrl: 'https://cdn.example.com/guild.png',
      botAvatarUrl: 'https://cdn.example.com/bot.png',
    },
    footerText: 'Marketplace',
  }).toJSON();

  assert.equal(embed.color, THEME_COLORS.success);
  assert.equal(embed.author?.name, 'SCUM TH');
  assert.equal(embed.footer?.text, 'Marketplace');
  assert.equal(Array.isArray(embed.fields), true);
  assert.ok(embed.fields.some((field) => field.name === 'Status' && field.value === 'Queued'));
});

test('discord theme helper formats progress bars and durations', () => {
  assert.equal(buildProgressBar(7, 10, 10), '███████░░░');
  assert.equal(formatDurationMinutes(25), '25 นาที');
  assert.equal(formatDurationMinutes(150), '2 ชม. 30 นาที');
});
