// ═══════════════════════════════════════════════════════════════
//  ✏️  /renamesong  —  แอดมันแก้ไขชื่อเพลงในฐานข้อมูล
//  วางไฟล์นี้ไว้ในโฟลเดอร์ commands/ (ระบบจะโหลดอัตโนมัติจาก index.js)
// ═══════════════════════════════════════════════════════════════
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");
const cfg    = require("../config");
const db     = require("../utils/database");
const logger = require("../utils/logger");
const { sendLog } = require("../utils/helpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("renamesong")
    .setDescription("✏️ เปลี่ยนชื่อเพลงในฐานข้อมูล (แอดมันเท่านั้น)")
    .addStringOption((opt) =>
      opt
        .setName("id")
        .setDescription("Song ID ที่ต้องการเปลี่ยนชื่อ")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("newname")
        .setDescription("ชื่อเพลงใหม่")
        .setRequired(true)
        .setMaxLength(100)
    )
    // ซ่อนคำสั่งจาก user ทั่วไปในเมนู Discord (แอดมันเซิร์ฟเวอร์เท่านั้น)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    // ✅ เช็คสิทธิ์ซ้ำอีกชั้น (กันกรณี permission override ในเซิร์ฟเวอร์)
    const isAdmin = interaction.member?.permissions.has(
      PermissionsBitField.Flags.Administrator
    );
    if (!isAdmin) {
      return interaction.reply({
        content: "❌ คำสั่งนี้ใช้ได้เฉพาะแอดมันเท่านั้น",
        ephemeral: true,
      });
    }

    const songId  = interaction.options.getString("id").trim();
    const newName = interaction.options.getString("newname").trim();

    if (!newName) {
      return interaction.reply({
        content: "❌ กรุณาระบุชื่อเพลงใหม่ให้ถูกต้อง",
        ephemeral: true,
      });
    }

    const result = db.renameSong(songId, newName);

    if (!result.success) {
      return interaction.reply({
        content: `❌ ไม่พบ Song ID \`${songId}\` ในฐานข้อมูล`,
        ephemeral: true,
      });
    }

    logger.success?.(
      `[RENAME] ${interaction.user.tag} เปลี่ยนชื่อ ${songId}: "${result.oldName}" → "${result.newName}"`
    );

    const embed = new EmbedBuilder()
      .setColor(cfg.COLOR_SUCCESS || "#57F287")
      .setAuthor({
        name: interaction.user.tag,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle("✏️ เปลี่ยนชื่อเพลงสำเร็จ")
      .addFields(
        { name: "🆔 Song ID", value: `\`${songId}\``, inline: false },
        { name: "🔤 ชื่อเดิม", value: result.oldName || "*(ไม่มี)*", inline: true },
        { name: "✨ ชื่อใหม่", value: result.newName, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "🎵 Song-ID Guardian" });

    await interaction.reply({ embeds: [embed] });

    // 📋 ส่ง log เข้าห้อง log (ถ้าตั้งค่า LOG_CHANNEL_ID ไว้)
    await sendLog(
      interaction.client,
      new EmbedBuilder()
        .setColor(cfg.COLOR_LOG || "#a855f7")
        .setTitle("📋 [LOG] เปลี่ยนชื่อเพลง")
        .addFields(
          { name: "👤 แอดมิน", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
          { name: "🆔 Song ID", value: `\`${songId}\``, inline: false },
          { name: "🔤 ชื่อเดิม", value: result.oldName || "*(ไม่มี)*", inline: true },
          { name: "✨ ชื่อใหม่", value: result.newName, inline: true }
        )
        .setTimestamp()
    );
  },
};