const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { economy } = require('../config');
const { creditCoins } = require('../services/coinService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addcoins')
    .setDescription('เติมเหรียญให้ผู้ใช้ (แอดมิน)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('ผู้ใช้ที่ต้องการเติมเหรียญให้')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('จำนวนเหรียญ')
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    const result = await creditCoins({
      userId: target.id,
      amount,
      reason: 'admin_addcoins_command',
      actor: `discord:${interaction.user.id}`,
      meta: {
        source: '/addcoins',
      },
    });
    if (!result.ok) {
      return interaction.reply('เติมเหรียญไม่สำเร็จ');
    }

    await interaction.reply(
      `เพิ่ม ${economy.currencySymbol} **${amount.toLocaleString()}** ให้กับ ${target} แล้ว\nยอดใหม่: ${economy.currencySymbol} **${Number(result.balance || 0).toLocaleString()}**`,
    );
  },
};
