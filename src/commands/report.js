const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { channels } = require('../config');
const {
  createDiscordCard,
  createMetricFields,
  createSection,
} = require('../utils/discordEmbedTheme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('รายงานผู้เล่นหรือผู้ใช้ที่ทำผิดกติกา')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('คนที่ต้องการรายงาน')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('เหตุผลหรือรายละเอียด')
        .setRequired(true),
    )
    .addAttachmentOption((option) =>
      option
        .setName('evidence')
        .setDescription('แนบรูปหรือคลิปหลักฐาน (ถ้ามี)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const evidence = interaction.options.getAttachment('evidence');
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content: 'คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์',
        flags: MessageFlags.Ephemeral,
      });
    }

    const evidenceChannel = guild.channels.cache.find(
      (channel) => channel.name === channels.evidence,
    );

    const embed = createDiscordCard({
      context: interaction,
      tone: 'danger',
      authorName: 'Incident Report',
      title: 'รายงานผู้เล่น / ผู้ใช้',
      description: createSection('เหตุผล', [reason]),
      fields: createMetricFields([
        { name: 'ผู้รายงาน', value: `${interaction.user} (\`${interaction.user.tag}\`)`, inline: false },
        { name: 'ผู้ถูกรายงาน', value: `${target} (\`${target.tag}\`)`, inline: false },
        { name: 'หลักฐาน', value: evidence?.url || 'ไม่มีไฟล์แนบ', inline: false },
      ]),
      thumbnail:
        target.displayAvatarURL?.({ extension: 'png', size: 256 })
        || target.avatarURL?.({ extension: 'png', size: 256 })
        || null,
      footerText: 'ระบบส่งต่อให้ทีมงานใน evidence channel แล้ว',
    });

    if (evidence?.url) {
      embed.setImage(evidence.url);
    }

    if (evidenceChannel && evidenceChannel.isTextBased && evidenceChannel.isTextBased()) {
      await evidenceChannel.send({ embeds: [embed] });
    }

    const replyEmbed = createDiscordCard({
      context: interaction,
      tone: 'success',
      authorName: 'Report Submitted',
      title: 'ส่งรายงานให้ทีมงานแล้ว',
      description: createSection('ขอบคุณ', [
        'ทีมงานได้รับรายงานของคุณแล้ว',
        'หากมีหลักฐานเพิ่ม สามารถเปิด ticket หรือส่งเพิ่มให้ทีมงานได้',
      ]),
      footerText: 'ขอบคุณที่ช่วยดูแลคอมมูนิตี้',
    });

    await interaction.reply({
      embeds: [replyEmbed],
      flags: MessageFlags.Ephemeral,
    });
  },
};
