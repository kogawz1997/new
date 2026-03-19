const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { economy, channels } = require('../config');
const { resolveItemIconUrl } = require('../services/itemIconService');
const { findShopItemView } = require('../services/playerQueryService');
const {
  purchaseShopItemForUser,
  normalizeShopKind,
  isVipShopKind,
  isGameItemShopKind,
  buildBundleSummary,
} = require('../services/shopService');
const {
  createDiscordCard,
  createMetricFields,
  createSection,
  formatCoins,
} = require('../utils/discordEmbedTheme');

function getDeliveryStatus(result) {
  if (result?.queued) {
    return 'เข้าคิวส่งอัตโนมัติแล้ว';
  }
  if (result?.reason === 'item-not-configured') {
    return 'ยังไม่ได้ตั้งค่าคำสั่งส่งอัตโนมัติ';
  }
  if (result?.reason === 'delivery-disabled') {
    return 'ระบบส่งอัตโนมัติถูกปิดอยู่';
  }
  return 'รอทีมงานจัดการ';
}

function buildPurchaseEmbed(interaction, options = {}) {
  return createDiscordCard({
    context: interaction,
    tone: options.tone || 'success',
    authorName: options.authorName || 'Purchase Receipt',
    title: options.title,
    description: options.description,
    fields: options.fields,
    thumbnail: options.thumbnail,
    footerText: options.footerText || 'ระบบบันทึกคำสั่งซื้อเรียบร้อยแล้ว',
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('ซื้อสินค้าจากร้านบอท')
    .addStringOption((option) =>
      option
        .setName('item')
        .setDescription('ชื่อสินค้า หรือรหัสสินค้า')
        .setRequired(true),
    ),

  async execute(interaction) {
    const query = interaction.options.getString('item', true);
    const item = await findShopItemView(query);

    if (!item) {
      return interaction.reply({
        content: 'ไม่พบสินค้าที่ต้องการ กรุณาตรวจสอบชื่อหรือรหัสอีกครั้ง แล้วดูรายการด้วย `/shop`',
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = await purchaseShopItemForUser({
      userId: interaction.user.id,
      item,
      guildId: interaction.guildId || null,
      actor: `discord:${interaction.user.id}`,
      source: 'slash-buy',
    });

    if (!result.ok) {
      if (result.reason === 'steam-link-required') {
        return interaction.reply({
          content: 'ต้องผูก SteamID ก่อนซื้อไอเทมในเกม ใช้ `/linksteam set` แล้วลองใหม่',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (result.reason === 'insufficient-balance') {
        const embed = buildPurchaseEmbed(interaction, {
          tone: 'warn',
          title: 'เหรียญไม่พอ',
          fields: createMetricFields([
            { name: 'สินค้า', value: item.name, inline: false },
            { name: 'ต้องใช้', value: formatCoins(item.price || 0, economy.currencySymbol) },
            { name: 'ยอดปัจจุบัน', value: formatCoins(result.balance || 0, economy.currencySymbol) },
          ]),
          footerText: 'เติมเหรียญแล้วลองใหม่อีกครั้ง',
        });
        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({
        content: 'ไม่สามารถสร้างคำสั่งซื้อได้ในตอนนี้ ระบบยกเลิกและคืนเหรียญให้อัตโนมัติแล้ว กรุณาลองใหม่อีกครั้ง',
        flags: MessageFlags.Ephemeral,
      });
    }

    const { purchase, delivery } = result;
    const deliveryStatus = getDeliveryStatus(delivery);
    const kind = normalizeShopKind(item.kind);
    const isVip = isVipShopKind(kind);
    const isGameItem = isGameItemShopKind(kind);
    const bundle = buildBundleSummary(item, 5);
    const iconUrl = resolveItemIconUrl(item);

    const embed = buildPurchaseEmbed(interaction, {
      title: 'สั่งซื้อสำเร็จ',
      description: [
        createSection('สินค้า', [
          `**${item.name}**`,
          `รหัส: \`${item.id}\``,
          `ประเภท: **${kind.toUpperCase()}**`,
        ]),
        createSection('การส่งมอบ', [
          isGameItem ? bundle.long : isVip ? 'แพ็กเกจ VIP จะเปิดใช้งานทันที' : 'ทีมงานจัดการในเกม',
          `สถานะ: **${deliveryStatus}**`,
        ]),
      ].join('\n\n'),
      fields: createMetricFields([
        { name: 'ราคา', value: formatCoins(item.price || 0, economy.currencySymbol) },
        { name: 'Order Code', value: `\`${purchase.code}\`` },
      ]),
      thumbnail: iconUrl,
      footerText: 'เก็บรหัสอ้างอิงนี้ไว้หากต้องติดต่อทีมงาน',
    });

    await interaction.reply({ embeds: [embed] });

    try {
      const guild = interaction.guild;
      if (guild) {
        const logChannel = guild.channels.cache.find(
          (channel) => channel.name === channels.shopLog,
        );
        if (logChannel && logChannel.isTextBased()) {
          const logEmbed = buildPurchaseEmbed(interaction, {
            tone: 'admin',
            authorName: 'Shop Activity',
            title: 'New Purchase',
            description: createSection('ผู้ซื้อ', [`${interaction.user}`]),
            fields: createMetricFields([
              { name: 'สินค้า', value: `${item.name} (\`${item.id}\`)`, inline: false },
              { name: 'ประเภท', value: kind.toUpperCase() },
              { name: 'ราคา', value: formatCoins(item.price || 0, economy.currencySymbol) },
              { name: 'รายการส่งมอบ', value: isGameItem ? bundle.short : isVip ? 'VIP' : 'MANUAL', inline: false },
              { name: 'Order Code', value: `\`${purchase.code}\`` },
              { name: 'Delivery', value: deliveryStatus, inline: false },
            ]),
            thumbnail: iconUrl,
            footerText: 'shop-log',
          });
          await logChannel.send({ embeds: [logEmbed] });
        }
      }
    } catch (error) {
      console.error('ส่ง log ไปช่อง shop-log ไม่สำเร็จ:', error.message);
    }
  },
};
