const { SlashCommandBuilder } = require('discord.js');
const { economy } = require('../config');
const {
  listTopWalletSnapshots,
  listStatsSnapshots,
} = require('../services/playerQueryService');
const {
  createDiscordCard,
  createSection,
  formatCoins,
} = require('../utils/discordEmbedTheme');

function rankLabel(index) {
  return ['🥇', '🥈', '🥉'][index] || `#${index + 1}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('ดูบอร์ดจัดอันดับผู้เล่น')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('ประเภทบอร์ด')
        .setRequired(true)
        .addChoices(
          { name: 'economy (เหรียญ)', value: 'economy' },
          { name: 'kills', value: 'kills' },
          { name: 'kd', value: 'kd' },
          { name: 'playtime', value: 'playtime' },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('จำนวนอันดับที่ต้องการดู (3-15)')
        .setMinValue(3)
        .setMaxValue(15)
        .setRequired(false),
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type', true);
    const limit = interaction.options.getInteger('limit') || 10;

    let rows = [];
    let title = 'Leaderboard';
    let tone = 'brand';

    if (type === 'economy') {
      const wallets = await listTopWalletSnapshots(limit);
      if (wallets.length === 0) {
        return interaction.reply('ยังไม่มีข้อมูลเศรษฐกิจในระบบ');
      }

      rows = await Promise.all(
        wallets.map(async (wallet, index) => {
          const user = await interaction.client.users.fetch(wallet.userId).catch(() => null);
          const name = user ? user.tag : `<@${wallet.userId}>`;
          return `${rankLabel(index)} **${name}** • ${formatCoins(wallet.balance || 0, economy.currencySymbol)}`;
        }),
      );
      title = 'Economy Board';
      tone = 'economy';
    } else {
      const stats = listStatsSnapshots();
      if (stats.length === 0) {
        return interaction.reply('ยังไม่มีข้อมูลสถิติในระบบ');
      }

      if (type === 'kills') {
        stats.sort((a, b) => Number(b.kills || 0) - Number(a.kills || 0));
        title = 'Kill Board';
        tone = 'combat';
        rows = await Promise.all(
          stats.slice(0, limit).map(async (entry, index) => {
            const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
            const name = user ? user.tag : `<@${entry.userId}>`;
            return `${rankLabel(index)} **${name}** • ${Number(entry.kills || 0)} kills`;
          }),
        );
      } else if (type === 'playtime') {
        stats.sort(
          (a, b) => Number(b.playtimeMinutes || 0) - Number(a.playtimeMinutes || 0),
        );
        title = 'Playtime Board';
        tone = 'info';
        rows = await Promise.all(
          stats.slice(0, limit).map(async (entry, index) => {
            const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
            const name = user ? user.tag : `<@${entry.userId}>`;
            return `${rankLabel(index)} **${name}** • ${Math.floor(Number(entry.playtimeMinutes || 0) / 60)} ชม.`;
          }),
        );
      } else {
        stats.sort((a, b) => {
          const kdA = Number(a.deaths || 0) === 0
            ? Number(a.kills || 0)
            : Number(a.kills || 0) / Number(a.deaths || 1);
          const kdB = Number(b.deaths || 0) === 0
            ? Number(b.kills || 0)
            : Number(b.kills || 0) / Number(b.deaths || 1);
          return kdB - kdA;
        });
        title = 'K/D Board';
        tone = 'brand';
        rows = await Promise.all(
          stats.slice(0, limit).map(async (entry, index) => {
            const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
            const name = user ? user.tag : `<@${entry.userId}>`;
            const kd = Number(entry.deaths || 0) === 0
              ? Number(entry.kills || 0)
              : Number(entry.kills || 0) / Number(entry.deaths || 1);
            return `${rankLabel(index)} **${name}** • K/D ${kd.toFixed(2)} (${Number(entry.kills || 0)}/${Number(entry.deaths || 0)})`;
          }),
        );
      }
    }

    const embed = createDiscordCard({
      context: interaction,
      tone,
      authorName: 'Leaderboard Board',
      title,
      description: createSection('อันดับล่าสุด', rows),
      footerText: `ขอโดย ${interaction.user.tag}`,
    });

    return interaction.reply({ embeds: [embed] });
  },
};
