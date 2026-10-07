// ═══════════════════════════════════════════════════════════════
//  📤  /export  —  Export เพลงทั้งหมดเป็นไฟล์
// ═══════════════════════════════════════════════════════════════
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const db              = require("../utils/database");
const { hasModRole }  = require("../utils/helpers");
const cfg             = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export")
    .setDescription("📤 Export รายชื่อเพลงทั้งหมด (mod เท่านั้น)")
    .addStringOption((opt) =>
      opt
        .setName("format")
        .setDescription("รูปแบบไฟล์")
        .setRequired(false)
        .addChoices(
          { name: "📄 TXT (ไอดี + ชื่อ)", value: "txt" },
          { name: "📊 CSV (ครบทุก field)", value: "csv" }
        )
    ),

  async execute(interaction) {
    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(cfg.COLOR_ERROR)
            .setTitle("🚫 ไม่มีสิทธิ์")
            .setDescription("คำสั่งนี้ใช้ได้เฉพาะ **Moderator** เท่านั้น"),
        ],
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const format   = interaction.options.getString("format") || "txt";
    const content  = format === "csv" ? db.exportCsv() : db.exportTxt();
    const filename = `songs_export_${Date.now()}.${format}`;
    const meta     = db.getMeta();

    const file = new AttachmentBuilder(Buffer.from(content, "utf-8"), {
      name: filename,
    });

    const embed = new EmbedBuilder()
      .setColor(cfg.COLOR_SUCCESS)
      .setTitle("📤 Export สำเร็จ!")
      .addFields(
        { name: "📁 ไฟล์", value: `\`${filename}\``, inline: true },
        { name: "🎵 เพลง", value: `${meta.totalSongs} เพลง`, inline: true },
        { name: "📊 รูปแบบ", value: format.toUpperCase(), inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "🎵 Song-ID Guardian" });

    return interaction.editReply({ embeds: [embed], files: [file] });
  },
};