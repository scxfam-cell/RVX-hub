// ═══════════════════════════════════════════════════════════════
//  🧧  /donate-data : ดูยอดโดเนทรวม (แอดมินเท่านั้น)
// ═══════════════════════════════════════════════════════════════
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");
const cfg = require("../config");

const DB_PATH = path.join(__dirname, "..", "data", "donateDb.json");

const DONATE_BANNER_URL =
  "https://cdn.discordapp.com/attachments/1518593515712413706/1523149509738233856/file_0000000046f871f8bf3f3f9af88c4a4b.jpg";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("donate-data")
    .setDescription("ดูยอดโดเนทรวมทั้งหมด (แอดมินเท่านั้น)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify({ money: 0, count: 0 }, null, 2));
    }
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));

    const embed = new EmbedBuilder()
      .setColor(cfg.COLOR_SUCCESS || "#FFD700")
      .setAuthor({ name: interaction.guild?.name || "Donate Stats", iconURL: interaction.guild?.iconURL() || undefined })
      .setTitle("🧧 สถิติการโดเนททั้งหมด")
      .setThumbnail(DONATE_BANNER_URL)
      .addFields(
        { name: "💰 ยอดโดเนทรวม", value: `\`\`\`${Number(db.money).toLocaleString()} บาท\`\`\``, inline: true },
        { name: "👥 จำนวนผู้โดเนท", value: `\`\`\`${db.count} คน\`\`\``, inline: true }
      )
      .setImage(DONATE_BANNER_URL)
      .setFooter({ text: "🧧 Donate System", iconURL: DONATE_BANNER_URL })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
