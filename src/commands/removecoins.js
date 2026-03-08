const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { economy } = require('../config');
const { debitCoins } = require('../services/coinService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removecoins')
    .setDescription('หักเหรียญผู้ใช้ (แอดมิน)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('ผู้ใช้ที่ต้องการหักเหรียญ')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('จำนวนเหรียญที่จะหัก')
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    const result = await debitCoins({
      userId: target.id,
      amount,
      reason: 'admin_removecoins_command',
      actor: `discord:${interaction.user.id}`,
      meta: {
        source: '/removecoins',
      },
    });
    if (!result.ok) {
      if (result.reason === 'insufficient-balance') {
        return interaction.reply(
          `หักไม่สำเร็จ: เหรียญไม่พอ (ยอดปัจจุบัน ${economy.currencySymbol} **${Number(result.balance || 0).toLocaleString()}**)`,
        );
      }
      return interaction.reply('หักเหรียญไม่สำเร็จ');
    }

    await interaction.reply(
      `หัก ${economy.currencySymbol} **${amount.toLocaleString()}** จาก ${target} แล้ว\nยอดใหม่: ${economy.currencySymbol} **${Number(result.balance || 0).toLocaleString()}**`,
    );
  },
};
