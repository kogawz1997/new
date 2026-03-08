const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { economy } = require('../config');
const { setCoinsExact } = require('../services/coinService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setcoins')
    .setDescription('ตั้งยอดเหรียญของผู้ใช้ (แอดมิน)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('ผู้ใช้ที่ต้องการตั้งยอดให้')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('จำนวนเหรียญใหม่')
        .setRequired(true)
        .setMinValue(0),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    const result = await setCoinsExact({
      userId: target.id,
      amount,
      reason: 'admin_setcoins_command',
      actor: `discord:${interaction.user.id}`,
      meta: {
        source: '/setcoins',
      },
    });
    if (!result.ok) {
      return interaction.reply('ตั้งยอดเหรียญไม่สำเร็จ');
    }

    await interaction.reply(
      `ตั้งยอดเหรียญของ ${target} เป็น ${economy.currencySymbol} **${Number(result.balance || 0).toLocaleString()}** แล้ว`,
    );
  },
};
