require('dotenv').config();

const crypto = require('node:crypto');
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { moderation, roles, channels, economy } = require('./config');
const {
  pushMessage,
  getRecentMessages,
  addPunishment,
} = require('./store/moderationStore');
const { listMemberships, removeMembership } = require('./store/vipStore');
const { startScumServer } = require('./scumWebhookServer');
const { startRestartScheduler } = require('./services/restartScheduler');
const { startRentBikeService } = require('./services/rentBikeService');
const {
  startRconDeliveryWorker,
  enqueuePurchaseDelivery,
} = require('./services/rconDelivery');
const { startAdminWebServer } = require('./adminWebServer');
const { queueLeaderboardRefreshForGuild } = require('./services/leaderboardPanels');
const { adminLiveBus } = require('./services/adminLiveBus');
const { assertBotEnv } = require('./utils/env');
const { claim: claimWelcomePack, hasClaimed: hasClaimedWelcomePack } = require('./store/welcomePackStore');
const {
  addCoins,
  getWallet,
  getShopItemById,
  createPurchase,
  removeCoins,
} = require('./store/memoryStore');
const {
  addCartItem,
} = require('./store/cartStore');
const {
  getResolvedCart,
  checkoutCart,
} = require('./services/cartService');
const {
  normalizeSteamId,
  setLink,
  getLinkByUserId,
  getLinkBySteamId,
  initLinkStore,
} = require('./store/linkStore');
const { upsertPlayerAccount } = require('./store/playerAccountStore');
const { initBountyStore } = require('./store/bountyStore');
const { initStatsStore } = require('./store/statsStore');
const { createTicket, tickets } = require('./store/ticketStore');

assertBotEnv();
const token = process.env.DISCORD_TOKEN;
let opsAlertRouteBound = false;

function envFlag(name, fallback = true) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

const START_SCUM_WEBHOOK = envFlag('BOT_ENABLE_SCUM_WEBHOOK', true);
const START_RESTART_SCHEDULER = envFlag('BOT_ENABLE_RESTART_SCHEDULER', true);
const START_ADMIN_WEB = envFlag('BOT_ENABLE_ADMIN_WEB', true);
const START_RENT_BIKE_SERVICE = envFlag('BOT_ENABLE_RENTBIKE_SERVICE', true);
const START_DELIVERY_WORKER = envFlag('BOT_ENABLE_DELIVERY_WORKER', true);
const START_OPS_ALERT_ROUTE = envFlag('BOT_ENABLE_OPS_ALERT_ROUTE', true);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`คำสั่งที่ไฟล์ ${filePath} ไม่มี "data" หรือ "execute"`);
    }
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`บอทล็อกอินสำเร็จเป็น ${c.user.tag}`);

  const warmups = await Promise.allSettled([
    initLinkStore(),
    initBountyStore(),
    initStatsStore(),
  ]);
  for (const warmup of warmups) {
    if (warmup.status !== 'rejected') continue;
    console.error('[boot] store warmup failed:', warmup.reason?.message || warmup.reason);
  }

  if (START_SCUM_WEBHOOK) {
    startScumServer(client);
  } else {
    console.log('[boot] skip SCUM webhook (BOT_ENABLE_SCUM_WEBHOOK=false)');
  }

  if (START_RESTART_SCHEDULER) {
    startRestartScheduler(client);
  } else {
    console.log('[boot] skip restart scheduler (BOT_ENABLE_RESTART_SCHEDULER=false)');
  }

  if (START_ADMIN_WEB) {
    startAdminWebServer(client);
  } else {
    console.log('[boot] skip admin web (BOT_ENABLE_ADMIN_WEB=false)');
  }

  if (START_RENT_BIKE_SERVICE) {
    startRentBikeService(client).catch((error) => {
      console.error('[rent-bike] failed to start service:', error.message);
    });
  } else {
    console.log('[boot] skip rent bike service (BOT_ENABLE_RENTBIKE_SERVICE=false)');
  }

  if (START_DELIVERY_WORKER) {
    startRconDeliveryWorker(client);
  } else {
    console.log('[boot] skip delivery worker (BOT_ENABLE_DELIVERY_WORKER=false)');
  }

  if (START_OPS_ALERT_ROUTE) {
    bindOpsAlertRoute(client);
  } else {
    console.log('[boot] skip ops alert route (BOT_ENABLE_OPS_ALERT_ROUTE=false)');
  }

  // งานย่อยสำหรับถอดยศ VIP ที่หมดอายุ
  setInterval(async () => {
    for (const m of listMemberships()) {
      if (m.expiresAt && m.expiresAt <= new Date()) {
        const guilds = client.guilds.cache;
        for (const guild of guilds.values()) {
          const member = await guild.members.fetch(m.userId).catch(() => null);
          if (!member) continue;
          const vipRole = guild.roles.cache.find((r) => r.name === roles.vip);
          if (vipRole && member.roles.cache.has(vipRole.id)) {
            await member.roles.remove(vipRole, 'VIP หมดอายุ').catch(() => null);
          }
        }
        removeMembership(m.userId);
      }
    }
  }, 60 * 1000);
});

function formatOpsAlertMessage(payload = {}) {
  const kind = String(payload.kind || 'alert');
  if (kind === 'queue-pressure') {
    return (
      `[OPS] queue-pressure | length=${payload.queueLength || 0} ` +
      `threshold=${payload.threshold || '-'}`
    );
  }
  if (kind === 'queue-stuck') {
    return (
      `[OPS] queue-stuck | oldestDueMs=${payload.oldestDueMs || 0} ` +
      `thresholdMs=${payload.thresholdMs || '-'} ` +
      `queueLength=${payload.queueLength || 0} ` +
      `code=${payload.purchaseCode || '-'}`
    );
  }
  if (kind === 'fail-rate') {
    const failRate = Number(payload.failRate || 0);
    return (
      `[OPS] fail-rate | failRate=${failRate.toFixed(3)} ` +
      `attempts=${payload.attempts || 0} failures=${payload.failures || 0} ` +
      `threshold=${payload.threshold || '-'}`
    );
  }
  if (kind === 'login-failure-spike') {
    return (
      `[OPS] login-failure-spike | failures=${payload.failures || 0} ` +
      `windowMs=${payload.windowMs || '-'} threshold=${payload.threshold || '-'} ` +
      `topIps=${Array.isArray(payload.topIps) ? payload.topIps.join(',') : '-'}`
    );
  }
  return `[OPS] ${JSON.stringify(payload)}`;
}

function bindOpsAlertRoute(clientInstance) {
  if (opsAlertRouteBound) return;
  opsAlertRouteBound = true;

  adminLiveBus.on('update', async (evt) => {
    try {
      if (evt?.type !== 'ops-alert') return;
      const content = formatOpsAlertMessage(evt?.payload || {});

      for (const guild of clientInstance.guilds.cache.values()) {
        const channel =
          guild.channels.cache.find(
            (c) =>
              c.name === channels.adminLog &&
              c.isTextBased &&
              c.isTextBased(),
          ) ||
          guild.channels.cache.find(
            (c) =>
              c.name === channels.shopLog &&
              c.isTextBased &&
              c.isTextBased(),
          );
        if (!channel) continue;
        await channel.send(content).catch(() => null);
      }
    } catch (error) {
      console.error('[ops-alert-route] failed to send alert to Discord', error);
    }
  });
}

function hasTicketCreatePermissions(guild, parent) {
  const me = guild.members.me;
  if (!me) return false;
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ];
  const perms = parent ? parent.permissionsFor(me) : me.permissions;
  return perms?.has(required);
}


async function openTicketFromPanel(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({
      content: 'คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์เท่านั้น',
      flags: MessageFlags.Ephemeral,
    });
  }

  const existing = Array.from(tickets.values()).find(
    (t) =>
      t.guildId === guild.id &&
      t.userId === interaction.user.id &&
      t.status !== 'closed',
  );

  if (existing) {
    return interaction.reply({
      content: `คุณมีทิคเก็ตที่ยังเปิดอยู่แล้ว: <#${existing.channelId}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const ticketsHubChannel = guild.channels.cache.find(
    (c) => c.name === channels.ticketsHub,
  );
  const parent =
    ticketsHubChannel && ticketsHubChannel.parent
      ? ticketsHubChannel.parent
      : null;

  if (!hasTicketCreatePermissions(guild, parent)) {
    return interaction.reply({
      content:
        'บอทไม่มีสิทธิ์พอสำหรับสร้างทิคเก็ต (ต้องมีสิทธิ์ ดูช่อง, ส่งข้อความ, จัดการช่อง, จัดการยศ)',
      flags: MessageFlags.Ephemeral,
    });
  }

  const channelName = `ticket-${interaction.user.username.toLowerCase()}-${
    crypto.randomInt(1, 10000)
  }`;

  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  const staffRoleNames = Object.values(roles).filter((r) =>
    ['Owner', 'Admin', 'Moderator', 'Helper'].includes(r),
  );
  for (const roleName of staffRoleNames) {
    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (role) {
      overwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      });
    }
  }

  let newChannel;
  try {
    newChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parent ?? undefined,
      permissionOverwrites: overwrites,
      topic: `ทิคเก็ตของ ${interaction.user.tag} | หมวด: ช่วยเหลือ`,
    });
  } catch (error) {
    if (error && error.code === 50013) {
      return interaction.reply({
        content:
          'สร้างทิคเก็ตไม่สำเร็จ เพราะบอทยังไม่มีสิทธิ์ในเซิร์ฟเวอร์/หมวดนี้ กรุณาให้สิทธิ์จัดการช่องและจัดการยศ แล้วลองใหม่',
        flags: MessageFlags.Ephemeral,
      });
    }
    throw error;
  }

  createTicket({
    guildId: guild.id,
    userId: interaction.user.id,
    channelId: newChannel.id,
    category: 'ช่วยเหลือ',
    reason: 'เปิดจากแพเนลทิคเก็ต',
  });

  await newChannel.send(
    `สวัสดี ${interaction.user}
ทีมงานจะเข้ามาดูแลโดยเร็วที่สุด กรุณาอธิบายปัญหา/คำถามของคุณ`,
  );

  return interaction.reply({
    content: `เปิดทิคเก็ตสำเร็จ: ${newChannel}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleInteractionCreate(interaction) {
  try {
  if (interaction?.user?.id) {
    const avatarUrl =
      typeof interaction.user.displayAvatarURL === 'function'
        ? interaction.user.displayAvatarURL({
            extension: 'png',
            size: 128,
          })
        : null;
    void upsertPlayerAccount({
      discordId: interaction.user.id,
      username: interaction.user.username,
      displayName:
        interaction.user.globalName
        || interaction.member?.displayName
        || interaction.user.username,
      avatarUrl,
      isActive: true,
    }).catch(() => null);
  }

  if (interaction.isModalSubmit?.() && interaction.customId === 'panel-verify-modal') {
    const steamIdRaw = interaction.fields.getTextInputValue('steamid');
    const steamId = normalizeSteamId(steamIdRaw);

    if (!steamId) {
      return interaction.reply({
        content: 'SteamID ไม่ถูกต้อง (ต้องเป็นตัวเลข SteamID64)',
        flags: MessageFlags.Ephemeral,
      });
    }

    const existing = getLinkBySteamId(steamId);
    if (existing && existing.userId !== interaction.user.id) {
      return interaction.reply({
        content: 'SteamID นี้ถูกลิงก์กับบัญชีอื่นแล้ว กรุณาติดต่อแอดมิน',
        flags: MessageFlags.Ephemeral,
      });
    }
    const currentUserLink = getLinkByUserId(interaction.user.id);
    if (
      currentUserLink?.steamId
      && currentUserLink.steamId !== steamId
    ) {
      return interaction.reply({
        content:
          'บัญชีนี้ผูก SteamID ไปแล้ว หากต้องการเปลี่ยนกรุณาติดต่อแอดมิน',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (currentUserLink?.steamId && currentUserLink.steamId === steamId) {
      return interaction.reply({
        content: `คุณผูก SteamID นี้ไว้แล้ว: \`${steamId}\``,
        flags: MessageFlags.Ephemeral,
      });
    }

    const res = setLink({
      steamId,
      userId: interaction.user.id,
      inGameName: null,
    });

    if (!res.ok) {
      return interaction.reply({
        content: 'ไม่สามารถยืนยัน SteamID ได้ในตอนนี้ กรุณาลองใหม่',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.guild && interaction.member) {
      const verifiedRole = interaction.guild.roles.cache.find(
        (r) => r.name === roles.verified,
      );
      if (verifiedRole && !interaction.member.roles.cache.has(verifiedRole.id)) {
        await interaction.member.roles
          .add(verifiedRole, 'ยืนยัน Steam ID แล้ว')
          .catch(() => null);
      }
    }

    return interaction.reply({
      content: `ยืนยันสำเร็จ! SteamID: \`${steamId}\``,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Panel buttons
  if (interaction.isButton?.()) {
    if (interaction.customId === 'giveaway-join') {
      const { addEntrant, getGiveaway } = require('./store/giveawayStore');
      const messageId = interaction.message.id;
      const g = getGiveaway(messageId);
      if (!g) {
        return interaction.reply({
          content: 'กิจกรรมแจกของนี้หมดอายุหรือไม่พบในระบบ',
          flags: MessageFlags.Ephemeral,
        });
      }
      addEntrant(messageId, interaction.user.id);
      return interaction.reply({
        content: 'เข้าร่วมกิจกรรมแจกของสำเร็จ!',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'panel-ticket-open') {
      return openTicketFromPanel(interaction);
    }

    if (interaction.customId === 'panel-verify-open') {
      const modal = new ModalBuilder()
        .setCustomId('panel-verify-modal')
        .setTitle('ยืนยัน Steam ID');

      const steamInput = new TextInputBuilder()
        .setCustomId('steamid')
        .setLabel('SteamID64')
        .setPlaceholder('เช่น 7656119xxxxxxxxxx')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(15)
        .setMaxLength(25);

      const row = new ActionRowBuilder().addComponents(steamInput);
      modal.addComponents(row);
      return interaction.showModal(modal);
    }

    if (interaction.customId === 'panel-welcome-claim') {
      if (hasClaimedWelcomePack(interaction.user.id)) {
        return interaction.reply({
          content: 'คุณรับแพ็กต้อนรับไปแล้ว (รับได้ 1 ครั้งต่อบัญชี)',
          flags: MessageFlags.Ephemeral,
        });
      }
      claimWelcomePack(interaction.user.id);
      await addCoins(interaction.user.id, 1500, {
        reason: 'welcome_pack_claim',
        actor: `discord:${interaction.user.id}`,
        meta: {
          source: 'panel-welcome-claim',
        },
      });
      queueLeaderboardRefreshForGuild(
        interaction.client,
        interaction.guildId,
        'welcome-claim',
      );
      return interaction.reply({
        content: 'รับแพ็กต้อนรับสำเร็จ! ได้รับ 1,500 เหรียญ',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'panel-welcome-refer') {
      return interaction.reply({
        content: 'ชวนเพื่อนเข้าดิสคอร์ด ให้เพื่อนกดรับแพ็กต้อนรับ แล้วแจ้งแอดมินเพื่อรับโบนัสแนะนำเพื่อน',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'panel-quick-daily') {
      return interaction.reply({
        content: 'ใช้ `/daily` เพื่อรับของรายวันได้เลย',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'panel-quick-server') {
      return interaction.reply({
        content: 'ใช้ `/server` เพื่อดูข้อมูลเซิร์ฟเวอร์ทั้งหมด',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'panel-quick-stats') {
      return interaction.reply({
        content: 'ใช้ `/stats` หรือ `/top type:kills` เพื่อดูอันดับผู้เล่น',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId.startsWith('panel-shop-buy:')) {
      const itemId = interaction.customId.split(':')[1];
      const item = await getShopItemById(itemId);
      if (!item) {
        return interaction.reply({
          content: `ไม่พบสินค้า: ${itemId}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const wallet = await getWallet(interaction.user.id);
      if (wallet.balance < item.price) {
        return interaction.reply({
          content: `ยอดเหรียญของคุณไม่พอ ต้องการ ${economy.currencySymbol} **${item.price.toLocaleString()}** แต่คุณมีเพียง ${economy.currencySymbol} **${wallet.balance.toLocaleString()}**`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await removeCoins(interaction.user.id, item.price, {
        reason: 'purchase_debit',
        actor: `discord:${interaction.user.id}`,
        meta: {
          source: 'panel-shop-buy',
          itemId: item.id,
          itemName: item.name,
        },
      });
      queueLeaderboardRefreshForGuild(
        interaction.client,
        interaction.guildId,
        'panel-shop-buy',
      );
      const purchase = await createPurchase(interaction.user.id, item);
      const delivery = await enqueuePurchaseDelivery(purchase, {
        guildId: interaction.guildId || null,
      });
      const kind = String(item.kind || 'item').trim().toLowerCase() === 'vip'
        ? 'vip'
        : 'item';
      const bundleEntries = kind === 'item'
        ? (Array.isArray(item.deliveryItems) && item.deliveryItems.length > 0
            ? item.deliveryItems
            : [{
                gameItemId: item.gameItemId,
                quantity: Math.max(1, Math.trunc(Number(item.quantity || 1))),
              }])
            .map((entry) => ({
              gameItemId: String(entry?.gameItemId || '').trim(),
              quantity: Math.max(1, Math.trunc(Number(entry?.quantity || 1))),
            }))
            .filter((entry) => entry.gameItemId)
        : [];
      const bundleTotalQty = bundleEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0,
      );
      const bundleShort = bundleEntries
        .slice(0, 2)
        .map((entry) => `${entry.gameItemId} x${entry.quantity}`)
        .join(', ');
      const bundleShortText = bundleEntries.length > 2
        ? `${bundleShort} (+${bundleEntries.length - 2})`
        : bundleShort || '-';
      const bundleLongText = bundleEntries.length > 0
        ? [
            `ไอเทมในชุด: **${bundleEntries.length}** รายการ (รวม **${bundleTotalQty}** ชิ้น)`,
            ...bundleEntries
              .slice(0, 4)
              .map((entry) => `- \`${entry.gameItemId}\` x**${entry.quantity}**`),
            ...(bundleEntries.length > 4
              ? [`- และอีก **${bundleEntries.length - 4}** รายการ`]
              : []),
          ].join('\n')
        : 'ไอเทมในเกม: `-`';

      let deliveryText = '\nสถานะการส่งของ: รอทีมงานจัดการ (ทำด้วยแอดมิน)';
      if (delivery.queued) {
        deliveryText = '\nสถานะการส่งของ: ระบบอัตโนมัติกำลังดำเนินการ (คิว RCON)';
      } else if (delivery.reason === 'item-not-configured') {
        deliveryText = '\nสถานะการส่งของ: สินค้านี้ยังไม่ตั้งคำสั่ง RCON (ทำด้วยแอดมิน)';
      } else if (delivery.reason === 'delivery-disabled') {
        deliveryText = '\nสถานะการส่งของ: ปิดระบบส่งของอัตโนมัติอยู่ (ทำด้วยแอดมิน)';
      }

      try {
        const guild = interaction.guild;
        if (guild) {
          const logChannel = guild.channels.cache.find(
            (c) => c.name === channels.shopLog,
          );
          if (logChannel && logChannel.isTextBased()) {
            await logChannel.send(
              `🛒 **การซื้อ** | ผู้ใช้: ${interaction.user} | สินค้า: **${item.name}** (รหัส: \`${item.id}\`) | ราคา: ${economy.currencySymbol} **${item.price.toLocaleString()}** | โค้ด: \`${purchase.code}\` | สถานะส่งอัตโนมัติ: ${
                delivery.queued ? 'เข้าคิวแล้ว' : delivery.reason || 'ทำด้วยแอดมิน'
              } | ประเภท: ${kind.toUpperCase()} | รายการ: ${kind === 'item' ? bundleShortText : 'VIP'}`,
            );
          }
        }
      } catch (err) {
        console.error('ไม่สามารถส่งบันทึกไปยังช่อง shop-log ได้', err);
      }

      return interaction.reply({
        content: `คุณซื้อ **${item.name}** สำเร็จ!\nประเภท: **${kind.toUpperCase()}**\n${kind === 'item' ? `${bundleLongText}\n` : ''}ราคาที่จ่าย: ${economy.currencySymbol} **${item.price.toLocaleString()}**\nโค้ดอ้างอิง: \`${purchase.code}\`${deliveryText}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId.startsWith('panel-shop-cart:')) {
      const itemId = interaction.customId.split(':')[1];
      const item = await getShopItemById(itemId);
      if (!item) {
        return interaction.reply({
          content: `ไม่พบสินค้า: ${itemId}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      addCartItem(interaction.user.id, item.id, 1);
      const cart = await getResolvedCart(interaction.user.id);
      const preview = cart.rows
        .slice(0, 4)
        .map(
          (row) =>
            `- ${row.item.name} x${row.quantity} (${economy.currencySymbol}${row.lineTotal.toLocaleString()})`,
        )
        .join('\n');
      const moreText = cart.rows.length > 4
        ? `\n- และอีก ${cart.rows.length - 4} รายการ`
        : '';

      return interaction.reply({
        content:
          `เพิ่ม **${item.name}** ลงตะกร้าแล้ว\n\n` +
          `ตะกร้าปัจจุบัน (${cart.rows.length} รายการ / ${cart.totalUnits} ชิ้น)\n` +
          `${preview || '-'}${moreText}\n` +
          `ยอดรวม: ${economy.currencySymbol} **${cart.totalPrice.toLocaleString()}**\n\n` +
          `ใช้ \`/cart view\` เพื่อดูทั้งหมด หรือ \`/cart checkout\` เพื่อชำระ`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.customId === 'panel-shop-checkout') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await checkoutCart(interaction.user.id, {
        guildId: interaction.guildId || null,
      });

      if (!result.ok && result.reason === 'empty') {
        return interaction.editReply({
          content: 'ตะกร้าของคุณว่างอยู่',
        });
      }

      if (!result.ok && result.reason === 'insufficient') {
        return interaction.editReply({
          content:
            `ยอดเหรียญไม่พอสำหรับชำระตะกร้า\n` +
            `ต้องใช้: ${economy.currencySymbol} **${result.totalPrice.toLocaleString()}**\n` +
            `ยอดคงเหลือ: ${economy.currencySymbol} **${Number(result.walletBalance || 0).toLocaleString()}**`,
        });
      }

      queueLeaderboardRefreshForGuild(
        interaction.client,
        interaction.guildId,
        'panel-shop-checkout',
      );

      try {
        const guild = interaction.guild;
        if (guild) {
          const logChannel = guild.channels.cache.find(
            (c) => c.name === channels.shopLog,
          );
          if (logChannel && logChannel.isTextBased()) {
            await logChannel.send(
              `🛒 **ชำระตะกร้า** | ผู้ใช้: ${interaction.user} | รายการ: ${result.rows.length} | ชิ้นรวม: ${result.totalUnits} | ตัดเหรียญ: ${economy.currencySymbol} **${result.totalPrice.toLocaleString()}** | คำสั่งซื้อที่สร้าง: ${result.purchases.length} | fail: ${result.failures.length}`,
            );
          }
        }
      } catch (error) {
        console.error('ไม่สามารถส่ง log ชำระตะกร้าไปยัง shop-log ได้', error);
      }

      const codePreview = result.purchases
        .slice(0, 10)
        .map((row) => `\`${row.purchase.code}\``)
        .join(', ');
      const moreCodeText = result.purchases.length > 10
        ? ` และอีก ${result.purchases.length - 10} รายการ`
        : '';

      const lines = [
        'ชำระตะกร้าสำเร็จ ✅',
        `รวม ${result.rows.length} รายการ (${result.totalUnits} ชิ้น)`,
        `ตัดเหรียญ: ${economy.currencySymbol} **${result.totalPrice.toLocaleString()}**`,
        `สร้างคำสั่งซื้อ: **${result.purchases.length}** รายการ`,
      ];
      if (codePreview) {
        lines.push(`โค้ดอ้างอิง: ${codePreview}${moreCodeText}`);
      }
      if (result.failures.length > 0) {
        lines.push(`มี ${result.failures.length} รายการที่ระบบส่งของมีปัญหา (ตรวจสอบใน /inventory และ shop-log)`);
      }

      return interaction.editReply({
        content: lines.join('\n'),
      });
    }
    if (
      interaction.customId.startsWith('panel-') ||
      interaction.customId.startsWith('giveaway-')
    ) {
      return interaction.reply({
        content: 'ปุ่มนี้หมดอายุหรือยังไม่รองรับแล้ว ลองกดจากข้อความใหม่ล่าสุดอีกครั้ง',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`ไม่พบคำสั่งที่ชื่อ ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
    queueLeaderboardRefreshForGuild(
      interaction.client,
      interaction.guildId,
      `slash:${interaction.commandName}`,
    );
  } catch (error) {
    console.error(`เกิดข้อผิดพลาดระหว่างรันคำสั่ง ${interaction.commandName}`, error);
    const code = Number(error?.code || 0);
    if (code === 10062 || code === 40060) {
      // Unknown interaction / already acknowledged.
      return;
    }
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'เกิดข้อผิดพลาดขณะรันคำสั่งนี้',
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    } else {
      await interaction.reply({
        content: 'เกิดข้อผิดพลาดขณะรันคำสั่งนี้',
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }
  }
  } catch (error) {
    console.error('[interaction] unhandled error', error);
    const code = Number(error?.code || 0);
    if (code === 10062 || code === 40060) return;
    if (!interaction?.isRepliable || !interaction.isRepliable()) return;
    if (interaction.replied || interaction.deferred) {
      await interaction
        .followUp({
          content: 'ระบบมีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้ง',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => null);
      return;
    }
    await interaction
      .reply({
        content: 'ระบบมีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้ง',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => null);
  }
}

client.on(Events.InteractionCreate, handleInteractionCreate);

// Anti-spam and bad word checks
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const guild = message.guild;
  const member = message.member;

  // Check spam
  pushMessage(message.author.id, Date.now());
  const msgs = getRecentMessages(
    message.author.id,
    moderation.spam.intervalMs,
  );
  if (msgs.length >= moderation.spam.messages) {
    const mutedRole = guild.roles.cache.find((r) => r.name === roles.muted);
    if (mutedRole && member && !member.roles.cache.has(mutedRole.id)) {
      await member.roles.add(
        mutedRole,
        `ปิดแชทอัตโนมัติจากสแปม ${msgs.length} ข้อความ`,
      );
      addPunishment(
        member.id,
        'mute',
        'ปิดแชทอัตโนมัติ: สแปมข้อความ',
        client.user.id,
        moderation.spam.muteMinutes,
      );

      const logChannel = guild.channels.cache.find(
        (c) => c.name === channels.adminLog,
      );
      if (logChannel && logChannel.isTextBased && logChannel.isTextBased()) {
        await logChannel.send(
          `🤖 **ปิดแชทอัตโนมัติ** | ผู้ใช้: ${member} | เหตุผล: สแปมเกิน ${moderation.spam.messages} ข้อความ ภายใน ${Math.round(
            moderation.spam.intervalMs / 1000,
          )} วินาที`,
        );
      }
    }
  }

  // Check bad words
  const contentLower = message.content.toLowerCase();
  const hasSoft = moderation.badWordsSoft.some((w) =>
    contentLower.includes(w.toLowerCase()),
  );
  const hasHard = moderation.badWordsHard.some((w) =>
    contentLower.includes(w.toLowerCase()),
  );

  if (hasSoft || hasHard) {
    await message.delete().catch(() => null);

    if (hasHard && member) {
      // hard timeout
      const ms = moderation.hardTimeoutMinutes * 60 * 1000;
      if (member.moderatable) {
        await member.timeout(ms, 'ลงโทษอัตโนมัติ: คำหยาบรุนแรง').catch(() => null);
      }
      addPunishment(
        member.id,
        'timeout',
        'ลงโทษอัตโนมัติ: คำหยาบรุนแรง',
        client.user.id,
        moderation.hardTimeoutMinutes,
      );
    } else if (member) {
      // soft warning
      addPunishment(
        member.id,
        'warn',
        'เตือนอัตโนมัติ: คำหยาบ',
        client.user.id,
        null,
      );
    }

    const logChannel = guild.channels.cache.find(
      (c) => c.name === channels.adminLog,
    );
    if (logChannel && logChannel.isTextBased && logChannel.isTextBased()) {
      await logChannel.send(
        `🤖 **ดูแลแชทอัตโนมัติ** | ข้อความจาก ${message.author} ถูกลบ (คำหยาบ) ใน <#${message.channel.id}>`,
      );
    }
  }
});


client.on(Events.GuildMemberAdd, async (member) => {
  const guild = member.guild;
  const channel = guild.channels.cache.find(
    (c) =>
      c.name === (channels.inServer || channels.playerJoin) &&
      c.isTextBased &&
      c.isTextBased(),
  );
  if (!channel) return;

  const text = `👋 สวัสดี ${member} ยินดีต้อนรับสู่ **${guild.name}**! ขอให้สนุกนะ`;
  const avatar = member.user.displayAvatarURL({ extension: 'png', size: 512 });
  const username = encodeURIComponent(member.user.username);
  const avatarEnc = encodeURIComponent(avatar);
  const background = encodeURIComponent('https://i.imgur.com/O3DHIA5.jpeg');
  const memberLine = encodeURIComponent(`คุณคือสมาชิกคนที่ #${guild.memberCount}`);
  const welcomeLine = encodeURIComponent(`ยินดีต้อนรับสู่ ${guild.name}`);
  const cardUrl = `https://api.popcat.xyz/welcomecard?background=${background}&avatar=${avatarEnc}&text1=${username}&text2=${memberLine}&text3=${welcomeLine}`;

  await channel.send({
    content: text,
    embeds: [
      {
        color: 0x2f3136,
        image: { url: cardUrl },
      },
    ],
  });
});

if (require.main === module) {
  client.login(token);
}

module.exports = {
  client,
  handleInteractionCreate,
  openTicketFromPanel,
  formatOpsAlertMessage,
  bindOpsAlertRoute,
};
