const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { economy } = require('../config');
const { transferCoins } = require('../services/coinService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('โอนเหรียญให้ผู้ใช้อื่น')
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('คนที่ต้องการโอนให้')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('จำนวนเหรียญที่ต้องการโอน')
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction) {
    const senderId = interaction.user.id;
    const target = interaction.options.getUser('target', true);
    const amount = interaction.options.getInteger('amount', true);

    if (target.bot) {
      return interaction.reply({
        content: 'คุณไม่สามารถโอนเหรียญให้บอทได้',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (target.id === senderId) {
      return interaction.reply({
        content: 'คุณไม่สามารถโอนเหรียญให้ตัวเองได้',
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = await transferCoins({
      fromUserId: senderId,
      toUserId: target.id,
      amount,
      actor: `discord:${interaction.user.id}`,
      source: '/gift',
      outReason: 'gift_transfer_out',
      inReason: 'gift_transfer_in',
      meta: {
        guildId: interaction.guildId || null,
      },
    });
    if (!result.ok) {
      if (result.reason === 'insufficient-balance') {
        return interaction.reply({
          content: `ยอดเหรียญของคุณไม่พอ (คงเหลือ ${economy.currencySymbol} **${Number(result.balance || 0).toLocaleString()}**)`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({
        content: 'โอนเหรียญไม่สำเร็จ กรุณาลองใหม่',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply(
      `${interaction.user} โอน ${economy.currencySymbol} **${amount.toLocaleString()}** ให้กับ ${target} แล้ว\nยอดคุณคงเหลือ: ${economy.currencySymbol} **${Number(result.fromBalance || 0).toLocaleString()}**`,
    );
  },
};
