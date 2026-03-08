const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { economy } = require('../config');
const { redeemCodeForUser } = require('../services/playerOpsService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('ยืนยันรับโค้ดโปรโมชั่น/โค้ดของรางวัล')
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('โค้ดที่ได้รับมา')
        .setRequired(true),
    ),
  async execute(interaction) {
    const code = interaction.options.getString('code', true).trim();

    const result = await redeemCodeForUser({
      userId: interaction.user.id,
      code,
      actor: `discord:${interaction.user.id}`,
      source: '/redeem',
    });

    if (!result.ok) {
      if (result.reason === 'code-not-found') {
        return interaction.reply({
          content: 'ไม่พบโค้ดนี้ หรือโค้ดไม่ถูกต้อง',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (result.reason === 'code-already-used') {
        return interaction.reply({
          content: 'โค้ดนี้ถูกใช้งานไปแล้ว',
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({
        content: 'ไม่สามารถใช้โค้ดได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (result.type === 'coins') {
      return interaction.reply(
        `ใช้โค้ดสำเร็จ ได้รับ ${economy.currencySymbol} **${Number(result.amount || 0).toLocaleString()}**`,
      );
    }

    return interaction.reply(
      `ใช้โค้ดสำเร็จแล้ว (ประเภท: ${result.type}) กรุณารอทีมงานตรวจสอบ/แจกของในเกม`,
    );
  },
};
