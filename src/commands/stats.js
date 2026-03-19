const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getStatsSnapshot } = require('../services/playerQueryService');
const {
  createDiscordCard,
  createMetricFields,
  createSection,
  formatDurationMinutes,
} = require('../utils/discordEmbedTheme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('ดูสถิติของคุณแบบสรุปมืออาชีพ')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('ดูสถิติของผู้เล่นคนอื่น')
        .setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    if (
      target.id !== interaction.user.id
      && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.reply({
        content: 'คุณไม่มีสิทธิ์ดูสถิติของผู้เล่นคนอื่น',
        flags: MessageFlags.Ephemeral,
      });
    }

    const stats = getStatsSnapshot(target.id);
    const kills = Number(stats.kills || 0);
    const deaths = Number(stats.deaths || 0);
    const playtimeMinutes = Number(stats.playtimeMinutes || 0);
    const kd = deaths === 0 ? kills : kills / deaths;
    const avatarUrl =
      target.displayAvatarURL?.({ extension: 'png', size: 256 })
      || target.avatarURL?.({ extension: 'png', size: 256 })
      || null;

    const embed = createDiscordCard({
      context: interaction,
      tone: 'combat',
      authorName: 'Player Stats',
      title: target.tag,
      description: createSection('ภาพรวม', [
        `ผู้เล่น: ${target}`,
        target.id !== interaction.user.id ? `ดูโดย: ${interaction.user}` : null,
      ]),
      fields: createMetricFields([
        { name: 'Kills', value: String(kills) },
        { name: 'Deaths', value: String(deaths) },
        { name: 'K/D', value: kd.toFixed(2) },
        { name: 'Playtime', value: formatDurationMinutes(playtimeMinutes), inline: false },
      ]),
      thumbnail: avatarUrl,
      footerText: 'อ้างอิงจากสถิติที่ระบบบันทึกล่าสุด',
    });

    return interaction.reply({ embeds: [embed] });
  },
};
