const { SlashCommandBuilder } = require('discord.js');
const { economy } = require('../config');
const { resolveItemIconUrl } = require('../services/itemIconService');
const { listShopItemViews } = require('../services/playerQueryService');
const {
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

const ITEMS_PER_EMBED = 6;

function chunk(items, size) {
  const pages = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

function buildItemField(item) {
  const kind = normalizeShopKind(item.kind);
  const isVip = isVipShopKind(kind);
  const isGameItem = isGameItemShopKind(kind);
  const bundle = buildBundleSummary(item, 2);
  return {
    name: `${item.name} • ${formatCoins(item.price || 0, economy.currencySymbol)}`,
    value: [
      `ID: \`${item.id}\``,
      `ประเภท: **${kind.toUpperCase()}**`,
      isGameItem ? bundle.long : isVip ? 'แพ็กเกจ: **VIP**' : 'การส่งมอบ: **ทีมงานจัดการในเกม**',
      item.description || '-',
    ].join('\n'),
    inline: false,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('ดูสินค้าทั้งหมดในร้าน'),

  async execute(interaction) {
    const items = await listShopItemViews();
    if (items.length === 0) {
      return interaction.reply('ยังไม่มีสินค้าในร้านตอนนี้');
    }

    const pages = chunk(items, ITEMS_PER_EMBED);
    const embeds = pages.slice(0, 10).map((page, index) => {
      const heroIcon = page.map((item) => resolveItemIconUrl(item)).find(Boolean) || null;
      return createDiscordCard({
        context: interaction,
        tone: 'economy',
        authorName: 'Marketplace',
        title: `ร้านค้าของเซิร์ฟเวอร์`,
        description: createSection('ภาพรวม', [
          `มีสินค้า ${items.length.toLocaleString()} รายการ`,
          'ใช้ `/buy item:<ชื่อหรือรหัสสินค้า>` เพื่อสั่งซื้อทันที',
        ]),
        fields: createMetricFields(page.map((item) => buildItemField(item))),
        thumbnail: heroIcon,
        footerText: `หน้า ${index + 1}/${pages.length}`,
      });
    });

    return interaction.reply({ embeds });
  },
};
