const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { economy } = require('../config');
const { getWalletSnapshot } = require('../services/playerQueryService');
const {
  createDiscordCard,
  createMetricFields,
  formatCoins,
} = require('../utils/discordEmbedTheme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('ดูยอดเหรียญของคุณ')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('ดูยอดของผู้เล่นคนอื่น')
        .setRequired(false),
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;

    if (
      targetUser.id !== interaction.user.id
      && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.reply({
        content: 'คุณไม่มีสิทธิ์ดูยอดของผู้เล่นคนอื่น',
        flags: MessageFlags.Ephemeral,
      });
    }

    const wallet = await getWalletSnapshot(targetUser.id);
    const embed = createDiscordCard({
      context: interaction,
      tone: 'economy',
      authorName: 'Wallet Overview',
      title: targetUser.tag,
      fields: createMetricFields([
        { name: 'Balance', value: formatCoins(wallet.balance || 0, economy.currencySymbol), inline: false },
      ]),
      thumbnail:
        targetUser.displayAvatarURL?.({ extension: 'png', size: 256 })
        || targetUser.avatarURL?.({ extension: 'png', size: 256 })
        || null,
      footerText: 'ยอดคงเหลือปัจจุบันของบัญชีที่เลือก',
    });

    return interaction.reply({ embeds: [embed] });
  },
};
