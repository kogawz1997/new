const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
  findPurchaseByCode,
  setPurchaseStatusByCode,
} = require('../store/memoryStore');
const { economy } = require('../config');
const { creditCoins } = require('../services/coinService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refund')
    .setDescription('คืนเงิน/ยกเลิกรายการซื้อ (แอดมิน)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('โค้ดอ้างอิงการซื้อ')
        .setRequired(true),
    ),
  async execute(interaction) {
    const code = interaction.options.getString('code', true);
    const purchase = await findPurchaseByCode(code);

    if (!purchase) {
      return interaction.reply({
        content: 'ไม่พบรายการซื้อที่มีโค้ดนี้',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (purchase.status === 'refunded') {
      return interaction.reply({
        content: 'รายการนี้ถูกคืนเงินไปแล้วก่อนหน้านี้',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (purchase.status === 'delivered') {
      return interaction.reply({
        content: 'รายการนี้ถูกระบุว่าแจกของแล้ว หากจะคืนเงิน กรุณาจัดการด้วยวิธีแอดมิน',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await setPurchaseStatusByCode(code, 'refunded', {
        actor: `discord:${interaction.user.id}`,
        reason: 'refund-command',
        meta: {
          purchaseCode: purchase.code,
        },
      });
    } catch (error) {
      return interaction.reply({
        content: `ไม่สามารถเปลี่ยนสถานะได้: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const refundResult = await creditCoins({
      userId: purchase.userId,
      amount: purchase.price,
      reason: 'refund_credit',
      reference: purchase.code,
      actor: `discord:${interaction.user.id}`,
      meta: {
        source: 'refund-command',
      },
    });
    if (!refundResult.ok) {
      return interaction.reply({
        content: 'คืนเหรียญไม่สำเร็จ แม้เปลี่ยนสถานะรายการเป็น refunded แล้ว กรุณาตรวจสอบ ledger และเติมเหรียญด้วยมือ',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply(
      `คืนเงินรายการ \`${purchase.code}\` เรียบร้อยแล้ว เป็นจำนวน ${economy.currencySymbol} **${purchase.price.toLocaleString()}**`,
    );
  },
};
