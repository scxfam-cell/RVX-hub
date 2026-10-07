// ═══════════════════════════════════════════════════════════════
//  ➕  /addsong  —  แอดมินเพิ่มไอดีเพลง (ทีละ 1 หรือหลายไอดีพร้อมกัน)
// ═══════════════════════════════════════════════════════════════
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");
const cfg = require("../config");
const db  = require("../utils/database");
const uploaderStore = require("../utils/uploaderStore");
const { parseSongMessage } = require("../utils/helpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("addsong")
    .setDescription("[แอดมิน] เพิ่มไอดีเพลง (ใส่ทีละเพลง หรือหลายเพลงพร้อมกันได้)")
    .addStringOption((opt) =>
      opt.setName("list")
        .setDescription("รูปแบบ: id ชื่อเพลง (ขึ้นบรรทัดใหม่เพื่อใส่หลายเพลง)")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("uploader")
        .setDescription("ชื่อผู้อัพเพลง (ใช้กับทุกเพลงในลิสต์นี้ ถ้าไม่ใส่จะไม่มีชื่อแสดง)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return interaction.reply({
        content: "❌ คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น",
        ephemeral: true,
      });
    }

    // แทน \n ตัวจริง (กรณี client ส่งมาเป็น literal "\n" ตอน paste ในบาง client)
    const raw = interaction.options.getString("list").replace(/\\n/g, "\n");
    const uploaderName = interaction.options.getString("uploader")?.trim() || null;

    const { valid, invalid } = parseSongMessage(raw);

    if (valid.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(cfg.COLOR_ERROR || "#ED4245")
            .setTitle("❌ ไม่พบไอดีเพลงที่ถูกต้อง")
            .setDescription(
              "**รูปแบบที่ถูกต้อง (บรรทัดละ 1 เพลง):**\n" +
              "```\n131963054557194 ที่ระหึก\n137462566140207 สารภาพลดโทษกึ่งหนึ่ง\n```"
            ),
        ],
        ephemeral: true,
      });
    }

    const { added, duplicates } = db.addSongs(valid, interaction.user.id, interaction.user.tag);
    const meta = db.getMeta();

    // ตั้งชื่อผู้อัพให้ทุกเพลงที่เพิ่มสำเร็จในรอบนี้ (ถ้าแอดมินใส่ชื่อมา)
    if (uploaderName && added.length > 0) {
      added.forEach((s) => uploaderStore.set(s.id, uploaderName));
    }

    const songList = added.slice(0, 15)
      .map((s, i) => `\`${String(i + 1).padStart(2, "0")}.\` **${s.name}**\n└ \`${s.id}\``)
      .join("\n");
    const moreAdded = added.length > 15 ? `\n*…+${added.length - 15} เพลง*` : "";

    const dupList = duplicates.length > 0
      ? duplicates.slice(0, 10)
          .map((d) => `• **${d.name}** \`${d.id}\` (มีอยู่แล้ว, เพิ่มโดย ${d.original.addedByTag})`)
          .join("\n") + (duplicates.length > 10 ? `\n*…+${duplicates.length - 10}*` : "")
      : null;

    const invalidText = invalid.length > 0
      ? invalid.slice(0, 5).map((l) => `• \`${l.slice(0, 60)}\``).join("\n")
        + (invalid.length > 5 ? `\n*…+${invalid.length - 5}*` : "")
      : null;

    const embed = new EmbedBuilder()
      .setColor(added.length > 0 ? (cfg.COLOR_SUCCESS || "#57F287") : (cfg.COLOR_ERROR || "#ED4245"))
      .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
      .setTitle(`✅ เพิ่มเพลงสำเร็จ ${added.length} เพลง`)
      .setDescription(added.length ? songList + moreAdded : "*(ทั้งหมดซ้ำหรือรูปแบบผิด — ไม่มีเพลงใหม่)*")
      .setTimestamp()
      .setFooter({ text: "🎵 Song-ID Guardian" });

    if (added.length > 0)
      embed.addFields({ name: "📦 ฐานข้อมูลทั้งหมด", value: `${meta.totalSongs} เพลง`, inline: true });
    if (uploaderName && added.length > 0)
      embed.addFields({ name: "👤 ชื่อผู้อัพ", value: uploaderName, inline: true });
    if (dupList)
      embed.addFields({ name: `⚠️ ซ้ำ ${duplicates.length} เพลง`, value: dupList, inline: false });
    if (invalidText)
      embed.addFields({ name: `❌ รูปแบบผิด ${invalid.length} บรรทัด`, value: invalidText, inline: false });

    await interaction.reply({ embeds: [embed] });
  },
};
