const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const {
  setLink,
  getLinkByUserId,
  getLinkBySteamId,
} = require('../store/linkStore');

function isStaff(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('linksteam')
    .setDescription(
      'ผูก SteamID (SCUM) กับ Discord เพื่อใช้ระบบส่งของ/สถิติอัตโนมัติ',
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('ผูก SteamID ของคุณ (ผูกได้ครั้งเดียว)')
        .addStringOption((opt) =>
          opt
            .setName('steamid')
            .setDescription('SteamID64 (ตัวเลข 15-25 หลัก)')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription(
              'ชื่อในเกม (ไม่จำเป็น ระบบจะดึงจาก SCUM log ให้อัตโนมัติ)',
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('me').setDescription('ดู SteamID ที่ลิงก์กับบัญชีคุณ'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unset')
        .setDescription('ยกเลิกลิงก์ SteamID (ต้องให้แอดมินดำเนินการ)'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('lookup')
        .setDescription('เช็กว่า SteamID นี้ลิงก์กับใคร (ทีมงาน)')
        .addStringOption((opt) =>
          opt.setName('steamid').setDescription('SteamID64').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('setuser')
        .setDescription('ลิงก์ SteamID ให้ผู้ใช้อื่น (ทีมงาน)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('ผู้ใช้ Discord').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('steamid').setDescription('SteamID64').setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('ชื่อในเกม (ไม่บังคับ)')
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const steamId = interaction.options.getString('steamid', true);
      const name = interaction.options.getString('name');

      const current = getLinkByUserId(interaction.user.id);
      if (current?.steamId && current.steamId !== steamId) {
        return interaction.reply({
          content:
            'บัญชีนี้ผูก SteamID ไปแล้ว หากต้องการเปลี่ยน กรุณาติดต่อแอดมินเท่านั้น',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (current?.steamId && current.steamId === steamId) {
        return interaction.reply({
          content: `คุณผูก SteamID นี้ไว้แล้ว: \`${steamId}\``,
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

      const res = setLink({
        steamId,
        userId: interaction.user.id,
        inGameName: name || null,
      });

      if (!res.ok) {
        return interaction.reply({
          content:
            'SteamID ไม่ถูกต้อง (ต้องเป็นตัวเลข 15-25 หลัก เช่น SteamID64)',
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        content:
          `ลิงก์สำเร็จ ✅\nSteamID: \`${res.steamId}\`\n` +
          'หมายเหตุ: ถ้าต้องการเปลี่ยน SteamID ต้องให้แอดมินดำเนินการ',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'me') {
      const link = getLinkByUserId(interaction.user.id);
      if (!link) {
        return interaction.reply({
          content: 'คุณยังไม่ได้ลิงก์ SteamID ใช้ `/linksteam set` ก่อน',
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        content:
          `SteamID ของคุณคือ: \`${link.steamId}\`` +
          (link.inGameName ? `\nชื่อในเกม: **${link.inGameName}**` : ''),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'unset') {
      return interaction.reply({
        content:
          'ไม่สามารถยกเลิก/เปลี่ยน SteamID ด้วยตัวเองได้ กรุณาติดต่อแอดมิน',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'lookup') {
      if (!isStaff(interaction)) {
        return interaction.reply({
          content: 'คำสั่งนี้สำหรับทีมงานเท่านั้น',
          flags: MessageFlags.Ephemeral,
        });
      }

      const steamId = interaction.options.getString('steamid', true);
      const link = getLinkBySteamId(steamId);
      if (!link) {
        return interaction.reply({
          content: 'ไม่พบลิงก์นี้',
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        content: `SteamID \`${steamId}\` ลิงก์กับ: <@${link.userId}>`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'setuser') {
      if (!isStaff(interaction)) {
        return interaction.reply({
          content: 'คำสั่งนี้สำหรับทีมงานเท่านั้น',
          flags: MessageFlags.Ephemeral,
        });
      }

      const user = interaction.options.getUser('user', true);
      const steamId = interaction.options.getString('steamid', true);
      const name = interaction.options.getString('name');

      const res = setLink({
        steamId,
        userId: user.id,
        inGameName: name || null,
      });
      if (!res.ok) {
        return interaction.reply({
          content:
            'SteamID ไม่ถูกต้อง (ต้องเป็นตัวเลข 15-25 หลัก เช่น SteamID64)',
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        content: `ลิงก์สำเร็จ ✅\nSteamID: \`${res.steamId}\`\nผู้ใช้: ${user}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
