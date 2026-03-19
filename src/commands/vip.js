const {
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const { roles } = require('../config');
const {
  buyVipForUser,
  getVipPlan,
  getMembership,
} = require('../services/vipService');
const {
  createDiscordCard,
  createMetricFields,
  createSection,
  formatCoins,
} = require('../utils/discordEmbedTheme');

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
    return interaction.reply({
      content: 'ไม่พบคำสั่งย่อย',
      flags: MessageFlags.Ephemeral,
    });
  },
};

async function handleList(interaction) {
  const plans = require('../config').vip.plans;
  const embeds = plans.map((plan, index) =>
    createDiscordCard({
      context: interaction,
      tone: 'vip',
      authorName: 'VIP Plans',
      title: `${plan.name}`,
      description: createSection('รายละเอียด', [plan.description]),
      fields: createMetricFields([
        { name: 'Plan ID', value: `\`${plan.id}\`` },
        { name: 'Duration', value: `${plan.durationDays} วัน` },
        { name: 'Price', value: formatCoins(plan.priceCoins) },
      ]),
      footerText: `แพ็กเกจ ${index + 1} / ${plans.length}`,
    }),
  );

  await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
}

async function handleBuy(interaction) {
  const planId = interaction.options.getString('plan', true);
  const plan = getVipPlan(planId);
  if (!plan) {
    return interaction.reply({
      content: 'ไม่พบแพ็กเกจ VIP นี้ กรุณาดูรายการด้วย `/vip list` ก่อน',
      flags: MessageFlags.Ephemeral,
    });
  }

  const result = await buyVipForUser({
    userId: interaction.user.id,
    plan,
    actor: `discord:${interaction.user.id}`,
    source: '/vip buy',
  });
  if (!result.ok) {
    if (result.reason === 'insufficient-balance') {
      const embed = createDiscordCard({
        context: interaction,
        tone: 'warn',
        authorName: 'VIP Purchase',
        title: 'เหรียญไม่พอ',
        fields: createMetricFields([
          { name: 'Required', value: formatCoins(plan.priceCoins) },
          { name: 'Current Balance', value: formatCoins(result.balance || 0) },
        ]),
        footerText: 'เติมเหรียญหรือเลือกแพ็กเกจที่เล็กลงแล้วลองใหม่',
      });
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content: 'ไม่สามารถเปิดใช้งาน VIP ได้ในตอนนี้ ระบบคืนเหรียญให้อัตโนมัติแล้ว กรุณาลองใหม่อีกครั้ง',
      flags: MessageFlags.Ephemeral,
    });
  }

  const guild = interaction.guild;
  if (guild) {
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (member) {
      const vipRole = guild.roles.cache.find((role) => role.name === roles.vip);
      if (vipRole) {
        await member.roles.add(vipRole, `ซื้อ VIP แพ็กเกจ ${plan.name} ผ่านบอท`).catch(() => null);
      }
    }
  }

  const embed = createDiscordCard({
    context: interaction,
    tone: 'vip',
    authorName: 'VIP Purchase',
    title: 'เปิดใช้งาน VIP สำเร็จ',
    description: createSection('แพ็กเกจ', [
      `คุณได้รับ **${plan.name}**`,
      `หมดอายุ <t:${Math.floor(result.membership.expiresAt.getTime() / 1000)}:F>`,
    ]),
    fields: createMetricFields([
      { name: 'Plan', value: plan.name },
      { name: 'Remaining Balance', value: formatCoins(result.balance || 0) },
    ]),
    footerText: 'สิทธิ์ VIP จะมีผลกับระบบที่ผูก role และ privileges ไว้',
  });

  await interaction.reply({ embeds: [embed] });
}

async function handlePerks(interaction) {
  const embed = createDiscordCard({
    context: interaction,
    tone: 'vip',
    authorName: 'VIP Benefits',
    title: 'สิทธิ์ของ VIP',
    description: createSection('สิทธิประโยชน์', [
      'คิวเข้าเซิร์ฟไวขึ้นตามที่เซิร์ฟเวอร์ตั้งค่า',
      'ยศ VIP พร้อมสีชื่อพิเศษ',
      'เข้าถึงห้องคุยเฉพาะ VIP',
      'โบนัสเหรียญตามนโยบายเซิร์ฟเวอร์',
      'สิทธิ์ตกแต่งหรือสิทธิ์พิเศษอื่นตามประกาศทีมงาน',
    ], { bullets: true }),
    footerText: 'รายละเอียดจริงขึ้นอยู่กับแพ็กเกจและ runtime config ปัจจุบัน',
  });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleStatus(interaction) {
  const membership = getMembership(interaction.user.id);
  if (!membership) {
    const embed = createDiscordCard({
      context: interaction,
      tone: 'neutral',
      authorName: 'VIP Status',
      title: 'ยังไม่มี VIP ที่ใช้งานอยู่',
      footerText: 'ใช้ /vip list เพื่อดูแพ็กเกจที่เปิดขาย',
    });
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  const plan = getVipPlan(membership.planId);
  const name = plan ? plan.name : membership.planId;
  const embed = createDiscordCard({
    context: interaction,
    tone: 'vip',
    authorName: 'VIP Status',
    title: name,
    fields: createMetricFields([
      { name: 'Plan', value: name },
      { name: 'Expires', value: `<t:${Math.floor(membership.expiresAt.getTime() / 1000)}:F>`, inline: false },
    ]),
    footerText: 'สถานะ VIP ปัจจุบันของบัญชีคุณ',
  });

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
