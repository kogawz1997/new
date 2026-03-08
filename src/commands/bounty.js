const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { economy } = require('../config');
const {
  createBountyForUser,
  listActiveBountiesForUser,
  cancelBountyForUser,
} = require('../services/playerOpsService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bounty')
    .setDescription('ระบบค่าหัวผู้เล่น')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('ตั้งค่าหัวให้ผู้เล่น (ใช้ชื่อในเกม)')
        .addStringOption((option) =>
          option
            .setName('target')
            .setDescription('ชื่อตัวละครในเกมของเป้าหมาย')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('จำนวนเหรียญค่าหัว')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('ดูค่าหัวทั้งหมด'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('ยกเลิกค่าหัว')
        .addIntegerOption((option) =>
          option
            .setName('id')
            .setDescription('รหัสค่าหัว')
            .setRequired(true),
        ),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return handleAdd(interaction);
    if (sub === 'list') return handleList(interaction);
    if (sub === 'cancel') return handleCancel(interaction);
  },
};

async function handleAdd(interaction) {
  const targetName = interaction.options.getString('target', true);
  const amount = interaction.options.getInteger('amount', true);

  const result = createBountyForUser({
    targetName,
    amount,
    createdBy: interaction.user.id,
  });
  if (!result.ok) {
    return interaction.reply({
      content: 'ข้อมูลค่าหัวไม่ถูกต้อง',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply(
    `ตั้งค่าหัวให้ **${targetName}** จำนวน ${economy.currencySymbol} **${amount.toLocaleString()}** แล้ว (ID: **${result.bounty.id}**)`,
  );
}

async function handleList(interaction) {
  const list = listActiveBountiesForUser();
  if (list.length === 0) {
    return interaction.reply('ตอนนี้ยังไม่มีค่าหัวที่เปิดใช้งาน');
  }

  const lines = list.map(
    (bounty) =>
      `รหัส: **${bounty.id}** | เป้าหมาย: **${bounty.targetName}** | ค่าหัว: ${economy.currencySymbol} **${Number(bounty.amount || 0).toLocaleString()}**`,
  );

  const embed = new EmbedBuilder()
    .setTitle('ค่าหัวทั้งหมด')
    .setDescription(lines.join('\n'))
    .setColor(0xff4500);

  await interaction.reply({ embeds: [embed] });
}

async function handleCancel(interaction) {
  const id = interaction.options.getInteger('id', true);
  const isStaff = interaction.memberPermissions.has(
    PermissionFlagsBits.ManageGuild,
  );

  const result = cancelBountyForUser({
    id,
    requesterId: interaction.user.id,
    isStaff,
  });

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return interaction.reply({
        content: 'ไม่พบค่าหัวที่ต้องการ',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (result.reason === 'forbidden') {
      return interaction.reply({
        content: 'คุณไม่มีสิทธิ์ยกเลิกค่าหัวนี้ (ต้องเป็นคนตั้งหรือทีมงาน)',
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content: 'ยกเลิกค่าหัวไม่สำเร็จ',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply(
    `ยกเลิกค่าหัวรหัส **${id}** เรียบร้อยแล้ว (เป้าหมาย: **${result.bounty.targetName}**)`,
  );
}
