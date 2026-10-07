// ═══════════════════════════════════════════════════════════════
//  📺  /songchannel  —  ตั้งค่าห้องรับไอดีเพลง (เฉพาะแอดมิน)
//  add    → เพิ่มห้องให้เป็นห้องรับไอดีเพลง
//  remove → เอาห้องออกจากระบบรับไอดีเพลง
//  list   → ดูรายการห้องที่เปิดใช้งานอยู่ตอนนี้
// ═══════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

const songChannels = require("../utils/songChannels");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("songchannel")
    .setDescription("ตั้งค่าห้องรับไอดีเพลง (แอดมินเท่านั้น)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName("add")
        .setDescription("เพิ่มห้องนี้ให้เป็นห้องรับไอดีเพลง")
        .addChannelOption((opt) =>
          opt.setName("ห้อง").setDescription("ห้องที่จะเปิดรับไอดีเพลง")
            .addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("remove")
        .setDescription("เอาห้องนี้ออกจากระบบรับไอดีเพลง")
        .addChannelOption((opt) =>
          opt.setName("ห้อง").setDescription("ห้องที่จะปิดรับไอดีเพลง")
            .addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list")
        .setDescription("ดูรายการห้องรับไอดีเพลงทั้งหมด")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
      const channel = interaction.options.getChannel("ห้อง");
      const added = songChannels.addChannel(channel.id);

      await interaction.reply({
        content: added
          ? `✅ เปิดรับไอดีเพลงที่ห้อง ${channel} เรียบร้อยแล้วครับ`
          : `⚠️ ห้อง ${channel} เป็นห้องรับไอดีเพลงอยู่แล้ว`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "remove") {
      const channel = interaction.options.getChannel("ห้อง");
      const removed = songChannels.removeChannel(channel.id);

      await interaction.reply({
        content: removed
          ? `✅ ปิดรับไอดีเพลงที่ห้อง ${channel} แล้วครับ`
          : `⚠️ ห้อง ${channel} ไม่ได้อยู่ในระบบรับไอดีเพลงอยู่แล้ว`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const ids = songChannels.getAll();
      const listText = ids.length
        ? ids.map((id) => `• <#${id}>`).join("\n")
        : "*(ยังไม่มีห้องที่ตั้งไว้)*";

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📺 ห้องรับไอดีเพลงทั้งหมด")
        .setDescription(listText)
        .setFooter({ text: `ทั้งหมด ${ids.length} ห้อง` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  },
};
