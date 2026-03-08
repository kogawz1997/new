const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  getWallet,
  getShopItemByName,
  createPurchase,
  removeCoins,
} = require('../store/memoryStore');
const { economy, channels } = require('../config');
const { enqueuePurchaseDelivery } = require('../services/rconDelivery');
const { resolveItemIconUrl } = require('../services/itemIconService');

function getDeliveryText(result) {
  if (result?.queued) {
    return '\nสถานะการส่งของ: ระบบอัตโนมัติกำลังดำเนินการ (คิว RCON)';
  }
  if (result?.reason === 'item-not-configured') {
    return '\nสถานะการส่งของ: สินค้านี้ยังไม่ตั้งคำสั่ง RCON (ทำด้วยแอดมิน)';
  }
  if (result?.reason === 'delivery-disabled') {
    return '\nสถานะการส่งของ: ปิดระบบส่งของอัตโนมัติอยู่ (ทำด้วยแอดมิน)';
  }
  return '\nสถานะการส่งของ: รอทีมงานจัดการ (ทำด้วยแอดมิน)';
}

function normalizeKind(value) {
  return String(value || 'item').trim().toLowerCase() === 'vip' ? 'vip' : 'item';
}

function normalizeQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.trunc(n));
}

function normalizeDeliveryItems(item) {
  const direct = Array.isArray(item?.deliveryItems) ? item.deliveryItems : [];
  const normalized = direct
    .map((entry) => {
      const gameItemId = String(entry?.gameItemId || '').trim();
      if (!gameItemId) return null;
      return {
        gameItemId,
        quantity: normalizeQty(entry?.quantity),
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) return normalized;

  const fallbackId = String(item?.gameItemId || '').trim();
  if (!fallbackId) return [];
  return [{ gameItemId: fallbackId, quantity: normalizeQty(item?.quantity) }];
}

function formatDeliveryLines(item, maxRows = 5) {
  const entries = normalizeDeliveryItems(item);
  if (entries.length === 0) {
    return {
      summary: 'ไอเทมในเกม: `-`',
      short: '-',
    };
  }

  const totalQty = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const lines = [`ไอเทมในชุด: **${entries.length}** รายการ (รวม **${totalQty}** ชิ้น)`];
  for (const entry of entries.slice(0, maxRows)) {
    lines.push(`- \`${entry.gameItemId}\` x**${entry.quantity}**`);
  }
  if (entries.length > maxRows) {
    lines.push(`- และอีก **${entries.length - maxRows}** รายการ`);
  }

  const short = entries
    .slice(0, 2)
    .map((entry) => `${entry.gameItemId} x${entry.quantity}`)
    .join(', ');
  const suffix = entries.length > 2 ? ` (+${entries.length - 2})` : '';

  return {
    summary: lines.join('\n'),
    short: `${short}${suffix}`,
  };
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
    const item = await getShopItemByName(query);

    if (!item) {
      return interaction.reply({
        content:
          'ไม่พบสินค้าที่ต้องการ กรุณาตรวจสอบชื่อ/รหัสอีกครั้ง (`/shop` เพื่อดูรายการทั้งหมด)',
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.user.id;
    const wallet = await getWallet(userId);

    if (wallet.balance < item.price) {
      return interaction.reply({
        content: `ยอดเหรียญของคุณไม่พอ ต้องการ ${economy.currencySymbol} **${item.price.toLocaleString()}** แต่คุณมีเพียง ${economy.currencySymbol} **${wallet.balance.toLocaleString()}**`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await removeCoins(userId, item.price, {
      reason: 'purchase_debit',
      actor: `discord:${interaction.user.id}`,
      meta: {
        source: 'slash-buy',
        itemId: item.id,
        itemName: item.name,
      },
    });
    const purchase = await createPurchase(userId, item);
    const delivery = await enqueuePurchaseDelivery(purchase, {
      guildId: interaction.guildId || null,
    });
    const deliveryText = getDeliveryText(delivery);
    const kind = normalizeKind(item.kind);
    const bundle = formatDeliveryLines(item);

    const iconUrl = resolveItemIconUrl(item);
    const replyPayload = {
      content:
        `ซื้อ **${item.name}** สำเร็จ!\n` +
        `ประเภท: **${kind.toUpperCase()}**\n` +
        `ราคา: ${economy.currencySymbol} **${item.price.toLocaleString()}**\n` +
        `${kind === 'item' ? `${bundle.summary}\n` : ''}` +
        `โค้ดอ้างอิง: \`${purchase.code}\`${deliveryText}`,
    };

    if (iconUrl) {
      replyPayload.embeds = [
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle(`สินค้า: ${item.name}`)
          .setDescription(
            [
              `รหัส: \`${item.id}\``,
              `ประเภท: **${kind.toUpperCase()}**`,
              ...(kind === 'item' ? [bundle.summary] : []),
            ].join('\n'),
          )
          .setThumbnail(iconUrl),
      ];
    }

    await interaction.reply(replyPayload);

    try {
      const guild = interaction.guild;
      if (guild) {
        const logChannel = guild.channels.cache.find(
          (c) => c.name === channels.shopLog,
        );
        if (logChannel && logChannel.isTextBased()) {
          await logChannel.send(
            `🛒 **การซื้อ** | ผู้ใช้: ${interaction.user} | สินค้า: **${item.name}** (รหัส: \`${item.id}\`) | ประเภท: ${kind.toUpperCase()} | รายการ: ${kind === 'item' ? bundle.short : 'VIP'} | ราคา: ${economy.currencySymbol} **${item.price.toLocaleString()}** | โค้ด: \`${purchase.code}\` | สถานะส่งอัตโนมัติ: ${
              delivery.queued ? 'เข้าคิวแล้ว' : delivery.reason || 'ทำด้วยแอดมิน'
            }`,
          );
        }
      }
    } catch (err) {
      console.error('ไม่สามารถส่ง log ไปยัง shop-log ได้', err);
    }
  },
};
