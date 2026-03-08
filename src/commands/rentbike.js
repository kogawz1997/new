const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { requestRentBikeForUser } = require('../services/playerOpsService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rentbike')
    .setDescription('เช่ามอไซรายวัน (จำกัด 1 ครั้งต่อวัน)'),
  async execute(interaction) {
    const result = await requestRentBikeForUser({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId || null,
    });

    if (!result.ok) {
      return interaction.reply({
        content: result.message || 'ไม่สามารถเช่ามอไซได้ในขณะนี้',
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      content:
        `${result.message}\n` +
        'ถ้ารถยังไม่ขึ้นทันที ให้รอคิวระบบประมวลผลประมาณ 5-15 วินาที',
      flags: MessageFlags.Ephemeral,
    });
  },
};
