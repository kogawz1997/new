const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { serverInfo } = require('../config');
const { resolveItemIconUrl } = require('../services/itemIconService');
const {
  getShopItemViewById,
  listShopItemViews,
} = require('../services/playerQueryService');
const {
  buildBundleSummary,
  normalizeShopKind,
  isVipShopKind,
  isGameItemShopKind,
} = require('../services/shopService');
const {
  buildTopKillerEmbed,
  buildTopGunKillEmbed,
  buildTopKdEmbed,
  buildTopPlaytimeEmbed,
  buildTopEconomyEmbed,
  registerLeaderboardPanelMessage,
} = require('../services/leaderboardPanels');
const {
  createDiscordCard,
  createMetricFields,
  createSection,
  formatCoins,
} = require('../utils/discordEmbedTheme');

function buildDeliverySummaryLines(item, maxRows = 4) {
  const summary = buildBundleSummary(item, maxRows);
  return summary.lines;
}

function buildShopEmbed(item, imageUrl) {
  const resolvedImageUrl = imageUrl || resolveItemIconUrl(item);
  const kind = normalizeShopKind(item.kind);
  const isVip = isVipShopKind(kind);
  const isGameItem = isGameItemShopKind(kind);
  const metaLines = isGameItem
    ? [
        `**ประเภท:** ITEM`,
        ...buildDeliverySummaryLines(item),
      ]
    : isVip
      ? [
        '**ประเภท:** VIP',
      ]
      : [
        `**ประเภท:** ${kind.toUpperCase()}`,
        '**การส่งมอบ:** ทีมงานจัดการในเกม',
      ];
  const embed = createDiscordCard({
    tone: 'economy',
    authorName: 'Featured Item',
    title: item.name,
    description: [
      createSection('ประเภทและการส่งมอบ', metaLines),
      createSection('รายละเอียด', [item.description || '-']),
    ].join('\n\n'),
    fields: createMetricFields([
      { name: 'ราคา', value: formatCoins(item.price || 0), inline: false },
      { name: 'รหัสสินค้า', value: `\`${item.id}\``, inline: false },
    ]),
    footerText: 'กดปุ่มด้านล่างเพื่อซื้อหรือเพิ่มลงตะกร้า',
  });

  if (resolvedImageUrl) {
    embed.setImage(resolvedImageUrl);
  }

  return embed;
}

function buildShopButtons(itemId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`panel-shop-buy:${itemId}`)
      .setLabel('ซื้อเลย')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`panel-shop-cart:${itemId}`)
      .setLabel('เพิ่มลงตะกร้า')
      .setStyle(ButtonStyle.Primary),
  );
}

async function replyOrEdit(interaction, payload) {
  if (interaction.deferred) {
    return interaction.editReply(payload);
  }
  if (interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('โพสต์แพเนลผู้เล่น/แอดมิน')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('welcome-pack').setDescription('โพสต์แพเนลต้อนรับ'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('verify')
        .setDescription('โพสต์แพเนลยืนยัน SteamID')
        .addStringOption((option) =>
          option
            .setName('image_url')
            .setDescription('ลิงก์รูปภาพ (ไม่บังคับ)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('ticket-admin').setDescription('โพสต์แพเนลทิคเก็ตแอดมิน'),
    )
    .addSubcommand((sub) =>
      sub.setName('top-killer').setDescription('โพสต์อันดับนักฆ่าสูงสุด'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('top-gun-kill')
        .setDescription('โพสต์อันดับฆ่าด้วยอาวุธ'),
    )
    .addSubcommand((sub) =>
      sub.setName('top-kd').setDescription('โพสต์อันดับอัตราคิลต่อเดธ'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('top-playtime')
        .setDescription('โพสต์อันดับเวลาเล่น'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('top-economy')
        .setDescription('โพสต์อันดับเศรษฐกิจ'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('shop-card')
        .setDescription('โพสต์การ์ดสินค้าเดี่ยว')
        .addStringOption((option) =>
          option
            .setName('item_id')
            .setDescription('รหัสสินค้าในร้าน เช่น vip-7d')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('image_url')
            .setDescription('ลิงก์รูปภาพ (ไม่บังคับ)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('shop-feed')
        .setDescription('โพสต์สินค้าหลายรายการด้วยคีย์เวิร์ด')
        .addStringOption((option) =>
          option
            .setName('keyword')
            .setDescription('คีย์เวิร์ดค้นหา เช่น ปืน, รถ')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('limit')
            .setDescription('จำนวนสูงสุดต่อโพสต์ (1-20)')
            .setMinValue(1)
            .setMaxValue(20)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('image_url')
            .setDescription('ลิงก์รูปภาพ (ไม่บังคับ)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('shop-refresh-buttons')
        .setDescription('ลบปุ่มชำระเงินเก่าจากโพสต์ร้านค้าในช่องนี้')
        .addIntegerOption((option) =>
          option
            .setName('limit')
            .setDescription('จำนวนข้อความย้อนหลังที่ต้องการสแกน (1-100)')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: 'คำสั่งนี้สำหรับแอดมินเท่านั้น',
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'welcome-pack') return postWelcomePack(interaction);
    if (sub === 'verify') return postVerify(interaction);
    if (sub === 'ticket-admin') return postTicketAdmin(interaction);
    if (sub === 'top-killer') return postTopKiller(interaction);
    if (sub === 'top-gun-kill') return postTopGunKill(interaction);
    if (sub === 'top-kd') return postTopKd(interaction);
    if (sub === 'top-playtime') return postTopPlaytime(interaction);
    if (sub === 'top-economy') return postTopEconomy(interaction);
    if (sub === 'shop-card') return postShopCard(interaction);
    if (sub === 'shop-feed') return postShopFeed(interaction);
    if (sub === 'shop-refresh-buttons') return refreshShopButtons(interaction);

    return interaction.reply({
      content: 'ไม่พบคำสั่งย่อย',
      flags: MessageFlags.Ephemeral,
    });
  },
};

async function postWelcomePack(interaction) {
  const embed = createDiscordCard({
    context: interaction,
    tone: 'brand',
    authorName: 'Welcome Center',
    title: 'แพ็กต้อนรับและลงทะเบียน',
    description: createSection('เริ่มต้นใช้งาน', [
      'กดปุ่มด้านล่างเพื่อรับแพ็กต้อนรับและใช้งานเมนูหลัก',
      `เริ่มต้นกับ **${serverInfo.name}** ได้ทันที`,
    ]),
    footerText: '1 บัญชี / รับได้ 1 ครั้ง',
  });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel-welcome-claim')
      .setLabel('รับแพ็กต้อนรับ')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('panel-welcome-refer')
      .setLabel('แนะนำเพื่อน')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel-quick-daily')
      .setLabel('ของรายวัน')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('panel-quick-server')
      .setLabel('เซิร์ฟเวอร์')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel-quick-stats')
      .setLabel('สถิติ')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2] });
}

async function postVerify(interaction) {
  const imageUrl = interaction.options.getString('image_url');

  const embed = createDiscordCard({
    context: interaction,
    tone: 'success',
    authorName: 'Verification Panel',
    title: 'ยืนยันตัวตน',
    description: createSection('ขั้นตอนสำคัญ', [
      'กรุณายืนยัน SteamID ก่อนเข้าใช้งานเซิร์ฟเวอร์',
      'ระบบจะลิงก์บัญชี Discord ของคุณกับ SteamID64 อัตโนมัติ',
    ]),
    footerText: serverInfo.name,
  });

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel-verify-open')
      .setLabel('ยืนยัน (กดเพื่อยืนยัน)')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function postTicketAdmin(interaction) {
  const embed = createDiscordCard({
    context: interaction,
    tone: 'support',
    authorName: 'Support Desk',
    title: 'แพเนลช่วยเหลือทิคเก็ต',
    description: createSection('ต้องการความช่วยเหลือ', [
      'หากคุณมีคำถามหรือปัญหาเกี่ยวกับเซิร์ฟเวอร์',
      'กรุณากดปุ่ม **เปิดทิคเก็ต** ด้านล่างเพื่อติดต่อทีมงาน',
    ]),
    footerText: `${serverInfo.name} ฝ่ายซัพพอร์ต`,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel-ticket-open')
      .setLabel('เปิดทิคเก็ต')
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function postTopKiller(interaction) {
  const embeds = buildTopKillerEmbed(interaction.client, interaction.guildId);
  await interaction.reply({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
  const message = await interaction.fetchReply().catch(() => null);
  if (message) {
    registerLeaderboardPanelMessage('topKiller', message);
  }
}

async function postTopGunKill(interaction) {
  const embeds = buildTopGunKillEmbed();
  await interaction.reply({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
  const message = await interaction.fetchReply().catch(() => null);
  if (message) {
    registerLeaderboardPanelMessage('topGunKill', message);
  }
}

async function postTopKd(interaction) {
  const embeds = buildTopKdEmbed(interaction.client, interaction.guildId);
  await interaction.reply({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
  const message = await interaction.fetchReply().catch(() => null);
  if (message) {
    registerLeaderboardPanelMessage('topKd', message);
  }
}

async function postTopPlaytime(interaction) {
  const embeds = buildTopPlaytimeEmbed(interaction.client, interaction.guildId);
  await interaction.reply({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
  const message = await interaction.fetchReply().catch(() => null);
  if (message) {
    registerLeaderboardPanelMessage('topPlaytime', message);
  }
}

async function postTopEconomy(interaction) {
  const embeds = await buildTopEconomyEmbed(interaction.client, interaction.guildId);
  await interaction.reply({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
  const message = await interaction.fetchReply().catch(() => null);
  if (message) {
    registerLeaderboardPanelMessage('topEconomy', message);
  }
}

async function postShopCard(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  const itemId = interaction.options.getString('item_id', true);
  const imageUrl = interaction.options.getString('image_url');

  const item = await getShopItemViewById(itemId);
  if (!item) {
    return replyOrEdit(interaction, {
      content: `ไม่พบรหัสสินค้า: ${itemId}`,
    });
  }

  const embed = buildShopEmbed(item, imageUrl);
  const row = buildShopButtons(item.id);
  await replyOrEdit(interaction, { embeds: [embed], components: [row] });
}

async function postShopFeed(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const keyword = interaction.options.getString('keyword', true).toLowerCase();
  const limit = interaction.options.getInteger('limit') || 10;
  const imageUrl = interaction.options.getString('image_url');

  const allItems = await listShopItemViews();
  const matched = allItems
    .filter((item) =>
      [item.id, item.name, item.description || '']
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
    .slice(0, limit);

  if (matched.length === 0) {
    return replyOrEdit(interaction, {
      content: `ไม่พบสินค้าที่ตรงกับคำค้น: ${keyword}`,
    });
  }

  await replyOrEdit(interaction, {
    content: `กำลังโพสต์ฟีดร้านค้า หมวด **${keyword}** จำนวน ${matched.length} รายการ...`,
  });

  for (const item of matched) {
    const embed = buildShopEmbed(item, imageUrl);
    const row = buildShopButtons(item.id);
    await interaction.channel.send({ embeds: [embed], components: [row] });
  }
}

function isLegacyCheckoutRow(row) {
  if (!row?.components?.length) return false;
  return row.components.some((component) => component.customId === 'panel-shop-checkout');
}

function isShopPanelMessage(message) {
  if (!message?.components?.length) return false;
  return message.components.some((row) =>
    row.components.some(
      (component) =>
        component.customId?.startsWith('panel-shop-buy:') ||
        component.customId?.startsWith('panel-shop-cart:'),
    ),
  );
}

async function refreshShopButtons(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const limit = interaction.options.getInteger('limit') || 50;
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased?.()) {
    return replyOrEdit(interaction, {
      content: 'คำสั่งนี้ต้องใช้ในช่องข้อความเท่านั้น',
    });
  }

  let messages;
  try {
    messages = await channel.messages.fetch({ limit });
  } catch (error) {
    return replyOrEdit(interaction, {
      content: `อ่านข้อความย้อนหลังไม่สำเร็จ: ${error.message}`,
    });
  }

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const message of messages.values()) {
    scanned += 1;
    if (message.author?.id !== interaction.client.user.id) {
      skipped += 1;
      continue;
    }
    if (!isShopPanelMessage(message)) {
      skipped += 1;
      continue;
    }
    if (!message.components.some((row) => isLegacyCheckoutRow(row))) {
      skipped += 1;
      continue;
    }

    const nextRows = message.components
      .map((row) => {
        const keep = row.components.filter(
          (component) => component.customId !== 'panel-shop-checkout',
        );
        if (keep.length === 0) return null;
        return {
          type: 1,
          components: keep.map((component) => component.toJSON()),
        };
      })
      .filter(Boolean);

    try {
      await message.edit({ components: nextRows });
      updated += 1;
    } catch (error) {
      failed += 1;
      console.error('[panel] failed to refresh shop buttons:', error.message);
    }
  }

  return replyOrEdit(interaction, {
    content:
      `รีเฟรชปุ่มร้านค้าเรียบร้อย\n` +
      `- สแกน: ${scanned} ข้อความ\n` +
      `- แก้ไขสำเร็จ: ${updated} ข้อความ\n` +
      `- ข้าม: ${skipped} ข้อความ\n` +
      `- ล้มเหลว: ${failed} ข้อความ`,
  });
}
