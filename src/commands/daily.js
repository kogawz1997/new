const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { economy } = require('../config');
const { getWalletSnapshot } = require('../services/playerQueryService');
const { checkRewardClaimForUser, claimRewardForUser } = require('../services/rewardService');
const {
  createDiscordCard,
  createMetricFields,
  formatCoins,
} = require('../utils/discordEmbedTheme');

function msToHoursMinutes(ms) {
  const totalMinutes = Math.ceil(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} นาที`;
  return `${hours} ชม. ${minutes} นาที`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('รับเหรียญรายวัน'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const check = await checkRewardClaimForUser({ userId, type: 'daily' });

    if (!check.ok) {
      const wallet = await getWalletSnapshot(userId);
      const embed = createDiscordCard({
        context: interaction,
        tone: 'warn',
        authorName: 'Daily Reward',
        title: 'รับรายวันไปแล้ว',
        fields: createMetricFields([
          { name: 'Balance', value: formatCoins(wallet.balance || 0, economy.currencySymbol) },
          { name: 'พร้อมรับอีกครั้งใน', value: msToHoursMinutes(check.remainingMs), inline: false },
        ]),
        footerText: 'ลองใหม่เมื่อครบเวลาคูลดาวน์',
      });
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = await claimRewardForUser({ userId, type: 'daily' });
    if (!result.ok) {
      return interaction.reply({
        content: 'ไม่สามารถรับรายวันได้ กรุณาลองใหม่อีกครั้ง',
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = createDiscordCard({
      context: interaction,
      tone: 'success',
      authorName: 'Daily Reward',
      title: 'รับรางวัลรายวันสำเร็จ',
      fields: createMetricFields([
        { name: 'Reward', value: formatCoins(result.reward || 0, economy.currencySymbol) },
        { name: 'New Balance', value: formatCoins(result.balance || 0, economy.currencySymbol) },
      ]),
      footerText: 'กลับมารับได้อีกครั้งในวันถัดไป',
    });

    return interaction.reply({ embeds: [embed] });
  },
};
