const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { economy } = require('../config');
const { getWalletSnapshot } = require('../services/playerQueryService');
const { checkRewardClaimForUser, claimRewardForUser } = require('../services/rewardService');
const {
  createDiscordCard,
  createMetricFields,
  formatCoins,
} = require('../utils/discordEmbedTheme');

function msToDaysHours(ms) {
  const totalHours = Math.ceil(ms / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days <= 0) return `${hours} ชม.`;
  return `${days} วัน ${hours} ชม.`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weekly')
    .setDescription('รับเหรียญรายสัปดาห์'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const check = await checkRewardClaimForUser({ userId, type: 'weekly' });

    if (!check.ok) {
      const wallet = await getWalletSnapshot(userId);
      const embed = createDiscordCard({
        context: interaction,
        tone: 'warn',
        authorName: 'Weekly Reward',
        title: 'รับรายสัปดาห์ไปแล้ว',
        fields: createMetricFields([
          { name: 'Balance', value: formatCoins(wallet.balance || 0, economy.currencySymbol) },
          { name: 'พร้อมรับอีกครั้งใน', value: msToDaysHours(check.remainingMs), inline: false },
        ]),
        footerText: 'ระบบจะปลดล็อกให้อัตโนมัติเมื่อครบเวลา',
      });
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = await claimRewardForUser({ userId, type: 'weekly' });
    if (!result.ok) {
      return interaction.reply({
        content: 'ไม่สามารถรับรายสัปดาห์ได้ กรุณาลองใหม่อีกครั้ง',
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = createDiscordCard({
      context: interaction,
      tone: 'success',
      authorName: 'Weekly Reward',
      title: 'รับรางวัลรายสัปดาห์สำเร็จ',
      fields: createMetricFields([
        { name: 'Reward', value: formatCoins(result.reward || 0, economy.currencySymbol) },
        { name: 'New Balance', value: formatCoins(result.balance || 0, economy.currencySymbol) },
      ]),
      footerText: 'กลับมารับได้อีกครั้งในสัปดาห์ถัดไป',
    });

    return interaction.reply({ embeds: [embed] });
  },
};
