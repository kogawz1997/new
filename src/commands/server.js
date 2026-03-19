const { SlashCommandBuilder } = require('discord.js');
const { serverInfo } = require('../config');
const {
  createDiscordCard,
  createMetricFields,
  createSection,
} = require('../utils/discordEmbedTheme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('ดูข้อมูลเซิร์ฟเวอร์แบบสรุป'),

  async execute(interaction) {
    const connectAddress = `\`${serverInfo.ip}:${serverInfo.port}\``;
    const embed = createDiscordCard({
      context: interaction,
      tone: 'brand',
      authorName: 'Server Overview',
      title: serverInfo.name,
      description: [
        createSection('รายละเอียด', [serverInfo.description]),
        createSection('กติกาย่อ', serverInfo.rulesShort || [], { bullets: true }),
      ].filter(Boolean).join('\n\n'),
      fields: createMetricFields([
        { name: 'IP / Port', value: connectAddress, inline: false },
        {
          name: 'Capacity',
          value: `${Number(serverInfo.maxPlayers || 0).toLocaleString()} slots`,
        },
        {
          name: 'Website',
          value: serverInfo.website ? serverInfo.website : 'ยังไม่ได้ตั้งค่า',
          inline: false,
        },
      ]),
      footerText: 'ใช้ /online เพื่อตรวจสถานะสดของเซิร์ฟเวอร์',
    });

    await interaction.reply({ embeds: [embed] });
  },
};
