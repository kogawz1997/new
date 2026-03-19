const { SlashCommandBuilder } = require('discord.js');
const { serverInfo } = require('../config');
const { getScumStatusSnapshot } = require('../services/playerQueryService');
const {
  buildProgressBar,
  createDiscordCard,
  createMetricFields,
  createSection,
  formatDurationMinutes,
} = require('../utils/discordEmbedTheme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('online')
    .setDescription('ดูสถานะเซิร์ฟเวอร์ SCUM แบบสด'),

  async execute(interaction) {
    const status = getScumStatusSnapshot();
    const onlinePlayers = Number(status.onlinePlayers || 0);
    const maxPlayers = Number(status.maxPlayers || serverInfo.maxPlayers || 0);
    const occupancy = `${buildProgressBar(onlinePlayers, maxPlayers, 10)} **${onlinePlayers}/${maxPlayers}**`;

    const embed = createDiscordCard({
      context: interaction,
      tone: onlinePlayers > 0 ? 'success' : 'info',
      authorName: 'Live Server Status',
      title: serverInfo.name,
      description: createSection('ความหนาแน่นผู้เล่น', [
        occupancy,
        status.lastUpdated
          ? `อัปเดตล่าสุด <t:${Math.floor(new Date(status.lastUpdated).getTime() / 1000)}:R>`
          : 'ยังไม่มีข้อมูลสดจาก runtime',
      ]),
      fields: createMetricFields([
        { name: 'Ping', value: status.pingMs != null ? `${Number(status.pingMs)} ms` : 'ไม่ทราบ' },
        {
          name: 'Uptime',
          value:
            status.uptimeMinutes != null
              ? formatDurationMinutes(Number(status.uptimeMinutes || 0))
              : 'ไม่ทราบ',
        },
        { name: 'Target Capacity', value: `${maxPlayers.toLocaleString()} players` },
      ]),
      footerText: 'Live snapshot จาก runtime monitor',
    });

    return interaction.reply({ embeds: [embed] });
  },
};
