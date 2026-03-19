const { SlashCommandBuilder } = require('discord.js');
const { listStatsSnapshots } = require('../services/playerQueryService');
const {
  createDiscordCard,
  createSection,
} = require('../utils/discordEmbedTheme');

function medalForRank(index) {
  return ['🥇', '🥈', '🥉'][index] || `#${index + 1}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('ดูอันดับสถิติผู้เล่น')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('ประเภทอันดับ')
        .setRequired(true)
        .addChoices(
          { name: 'kills', value: 'kills' },
          { name: 'kd', value: 'kd' },
          { name: 'playtime', value: 'playtime' },
        ),
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type', true);
    const all = listStatsSnapshots();

    if (all.length === 0) {
      return interaction.reply('ยังไม่มีข้อมูลสถิติในระบบ');
    }

    if (type === 'kills') {
      all.sort((a, b) => Number(b.kills || 0) - Number(a.kills || 0));
    } else if (type === 'playtime') {
      all.sort((a, b) => Number(b.playtimeMinutes || 0) - Number(a.playtimeMinutes || 0));
    } else {
      all.sort((a, b) => {
        const kdA = Number(a.deaths || 0) === 0
          ? Number(a.kills || 0)
          : Number(a.kills || 0) / Number(a.deaths || 1);
        const kdB = Number(b.deaths || 0) === 0
          ? Number(b.kills || 0)
          : Number(b.kills || 0) / Number(b.deaths || 1);
        return kdB - kdA;
      });
    }

    const rows = await Promise.all(
      all.slice(0, 10).map(async (entry, index) => {
        const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
        const name = user ? user.username : entry.userId;
        const kd = Number(entry.deaths || 0) === 0
          ? Number(entry.kills || 0)
          : Number(entry.kills || 0) / Number(entry.deaths || 1);
        if (type === 'playtime') {
          return `${medalForRank(index)} **${name}** • ${Math.floor(Number(entry.playtimeMinutes || 0) / 60)} ชม.`;
        }
        if (type === 'kd') {
          return `${medalForRank(index)} **${name}** • K/D ${kd.toFixed(2)} (${Number(entry.kills || 0)}/${Number(entry.deaths || 0)})`;
        }
        return `${medalForRank(index)} **${name}** • ${Number(entry.kills || 0)} kills`;
      }),
    );

    const embed = createDiscordCard({
      context: interaction,
      tone: type === 'kills' ? 'combat' : type === 'playtime' ? 'info' : 'brand',
      authorName: 'Leaderboard Snapshot',
      title:
        type === 'kills'
          ? 'Top Kills'
          : type === 'kd'
            ? 'Top K/D'
            : 'Top Playtime',
      description: createSection('อันดับล่าสุด', rows),
      footerText: 'ดูแบบ panel ถาวรได้ผ่าน /panel',
    });

    return interaction.reply({ embeds: [embed] });
  },
};
