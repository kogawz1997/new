const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const {
  createEvent,
  listEvents,
  getEvent,
  joinEvent,
  startEvent,
  endEvent,
  getParticipants,
} = require('../store/eventStore');
const { economy } = require('../config');
const { creditCoins } = require('../services/coinService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('ระบบอีเวนต์ในเซิร์ฟ')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('สร้างอีเวนต์ใหม่')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('ชื่ออีเวนต์')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('time')
            .setDescription('วันเวลาเริ่ม (ข้อความ)')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('reward')
            .setDescription('ของรางวัล / เหรียญ (ข้อความ)')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('ดูรายการอีเวนต์'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('join')
        .setDescription('เข้าร่วมอีเวนต์')
        .addIntegerOption((option) =>
          option
            .setName('id')
            .setDescription('ID อีเวนต์')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('ประกาศเริ่มอีเวนต์')
        .addIntegerOption((option) =>
          option
            .setName('id')
            .setDescription('ID อีเวนต์')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('สรุปผลอีเวนต์')
        .addIntegerOption((option) =>
          option
            .setName('id')
            .setDescription('ID อีเวนต์')
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('winner')
            .setDescription('ผู้ชนะ (ถ้ามีคนเดียว)')
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('coins')
            .setDescription('เหรียญที่จะมอบให้ผู้ชนะ (ถ้ามี)')
            .setRequired(false)
            .setMinValue(1),
        ),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: 'คำสั่งนี้สำหรับแอดมินเท่านั้น',
          flags: MessageFlags.Ephemeral,
        });
      }
      return handleCreate(interaction);
    }
    if (sub === 'list') return handleList(interaction);
    if (sub === 'join') return handleJoin(interaction);
    if (sub === 'start') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: 'คำสั่งนี้สำหรับแอดมินเท่านั้น',
          flags: MessageFlags.Ephemeral,
        });
      }
      return handleStart(interaction);
    }
    if (sub === 'end') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: 'คำสั่งนี้สำหรับแอดมินเท่านั้น',
          flags: MessageFlags.Ephemeral,
        });
      }
      return handleEnd(interaction);
    }
  },
};

async function handleCreate(interaction) {
  const name = interaction.options.getString('name', true);
  const time = interaction.options.getString('time', true);
  const reward = interaction.options.getString('reward', true);

  const ev = createEvent({ name, time, reward });

  await interaction.reply(
    `สร้างอีเวนต์ใหม่แล้ว (ID: **${ev.id}**)\nชื่อ: **${ev.name}**\nเวลา: ${ev.time}\nของรางวัล: ${ev.reward}`,
  );
}

async function handleList(interaction) {
  const list = listEvents();
  if (list.length === 0) {
    return interaction.reply('ยังไม่มีอีเวนต์ในระบบ');
  }

  const lines = list.map(
    (e) =>
      `ID: **${e.id}** | **${e.name}** | เวลา: ${e.time} | สถานะ: ${e.status}`,
  );

  const embed = new EmbedBuilder()
    .setTitle('📅 อีเวนต์ทั้งหมด')
    .setDescription(lines.join('\n'))
    .setColor(0x8a2be2);

  await interaction.reply({ embeds: [embed] });
}

async function handleJoin(interaction) {
  const id = interaction.options.getInteger('id', true);
  const res = joinEvent(id, interaction.user.id);
  if (!res) {
    return interaction.reply({
      content: 'ไม่พบอีเวนต์ที่ต้องการ',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply(
    `${interaction.user} เข้าร่วมอีเวนต์ **${res.ev.name}** แล้ว`,
  );
}

async function handleStart(interaction) {
  const id = interaction.options.getInteger('id', true);
  const ev = startEvent(id);
  if (!ev) {
    return interaction.reply({
      content: 'ไม่พบอีเวนต์ที่ต้องการ',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply(
    `🎉 อีเวนต์ **${ev.name}** เริ่มแล้ว! ใครจะเข้าร่วมใช้คำสั่ง \`/event join id:${ev.id}\``,
  );
}

async function handleEnd(interaction) {
  const id = interaction.options.getInteger('id', true);
  const winner = interaction.options.getUser('winner');
  const coins = interaction.options.getInteger('coins');

  const ev = endEvent(id);
  if (!ev) {
    return interaction.reply({
      content: 'ไม่พบอีเวนต์ที่ต้องการ',
      flags: MessageFlags.Ephemeral,
    });
  }

  const participants = getParticipants(id);

  if (winner && coins && coins > 0) {
    await creditCoins({
      userId: winner.id,
      amount: coins,
      reason: 'event_reward',
      actor: `discord:${interaction.user.id}`,
      meta: {
        eventId: ev.id,
        eventName: ev.name,
      },
    });
  }

  const lines = [
    `✅ อีเวนต์ **${ev.name}** สิ้นสุดแล้ว`,
    `ผู้เข้าร่วมทั้งหมด: **${participants.length}** คน`,
  ];
  if (winner) {
    lines.push(
      `ผู้ชนะ: ${winner} ได้รับ ${economy.currencySymbol} **${(
        coins || 0
      ).toLocaleString()}**`,
    );
  }

  await interaction.reply(lines.join('\n'));
}
