const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { vip, roles } = require('../config');
const { getWallet, removeCoins } = require('../store/memoryStore');
const {
  setMembership,
  getMembership,
} = require('../store/vipStore');

function getPlan(planId) {
  return vip.plans.find((p) => p.id === planId) || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vip')
    .setDescription('ระบบ VIP')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('ดูแพ็กเกจ VIP ทั้งหมด'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('buy')
        .setDescription('ซื้อ VIP ด้วยเหรียญ')
        .addStringOption((option) =>
          option
            .setName('plan')
            .setDescription('รหัสแพ็กเกจ VIP')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('perks').setDescription('ดูสิทธิ์ของ VIP'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('ดูสถานะ VIP ของตัวเอง'),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') return handleList(interaction);
    if (sub === 'buy') return handleBuy(interaction);
    if (sub === 'perks') return handlePerks(interaction);
    if (sub === 'status') return handleStatus(interaction);
  },
};

async function handleList(interaction) {
  const lines = vip.plans.map(
    (p) =>
      `รหัส: \`${p.id}\` | **${p.name}** | ${p.durationDays} วัน | ราคา: ${p.priceCoins.toLocaleString()} เหรียญ\n${p.description}`,
  );

  const embed = new EmbedBuilder()
    .setTitle('⭐ แพ็กเกจ VIP')
    .setDescription(lines.join('\n\n'))
    .setColor(0xffd700);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleBuy(interaction) {
  const planId = interaction.options.getString('plan', true);
  const plan = getPlan(planId);
  if (!plan) {
    return interaction.reply({
      content:
        'ไม่พบแพ็กเกจ VIP นี้ กรุณาดูรายการด้วย `/vip list` ก่อน',
      flags: MessageFlags.Ephemeral,
    });
  }

  const wallet = await getWallet(interaction.user.id);
  if (wallet.balance < plan.priceCoins) {
    return interaction.reply({
      content: `เหรียญไม่พอ ต้องการ ${plan.priceCoins.toLocaleString()} เหรียญ แต่คุณมีเพียง ${wallet.balance.toLocaleString()} เหรียญ`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await removeCoins(interaction.user.id, plan.priceCoins, {
    reason: 'vip_purchase',
    actor: `discord:${interaction.user.id}`,
    meta: {
      planId: plan.id,
      planName: plan.name,
      durationDays: plan.durationDays,
    },
  });

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000,
  );
  setMembership(interaction.user.id, plan.id, expiresAt);

  const guild = interaction.guild;
  if (guild) {
    const member = await guild.members.fetch(interaction.user.id).catch(
      () => null,
    );
    if (member) {
      const vipRole = guild.roles.cache.find((r) => r.name === roles.vip);
      if (vipRole) {
        await member.roles.add(
          vipRole,
          `ซื้อ VIP แพ็กเกจ ${plan.name} ผ่านบอท`,
        );
      }
    }
  }

  const membership = getMembership(interaction.user.id);
  await interaction.reply(
    `ขอบคุณที่สนับสนุนเซิร์ฟ! คุณได้ซื้อ **${plan.name}** แล้ว\nหมดอายุ: <t:${Math.floor(
      membership.expiresAt.getTime() / 1000,
    )}:F>`,
  );
}

async function handlePerks(interaction) {
  const lines = [
    '- คิวเข้าเซิร์ฟไวขึ้น (ช่องสำรองตามที่เซิร์ฟตั้งค่า)',
    '- ยศ VIP พร้อมสีชื่อพิเศษ',
    '- ห้องคุยเฉพาะ VIP',
    '- โบนัสเหรียญรายวันเล็กน้อย (สามารถทำเพิ่มโดยผูกกับระบบเศรษฐกิจ)',
    '- ของตกแต่ง / ตำแหน่งพิเศษ (ถ้าทำในเกม)',
  ];

  const embed = new EmbedBuilder()
    .setTitle('สิทธิ์ของ VIP (แนะนำ)')
    .setDescription(lines.join('\n'))
    .setColor(0xffa500);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleStatus(interaction) {
  const m = getMembership(interaction.user.id);
  if (!m) {
    return interaction.reply({
      content: 'คุณยังไม่มี VIP ที่ใช้งานอยู่',
      flags: MessageFlags.Ephemeral,
    });
  }

  const plan = getPlan(m.planId);
  const name = plan ? plan.name : m.planId;
  await interaction.reply({
    content: `คุณมี VIP: **${name}**\nหมดอายุ: <t:${Math.floor(
      m.expiresAt.getTime() / 1000,
    )}:F>`,
    flags: MessageFlags.Ephemeral,
  });
}
