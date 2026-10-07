// ═══════════════════════════════════════════════════════════════
//  🔍  /search  —  ค้นหาเพลงในฐานข้อมูล
// ═══════════════════════════════════════════════════════════════
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const db  = require("../utils/database");
const cfg = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("🔍 ค้นหาเพลงในฐานข้อมูล")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("ชื่อเพลง หรือ ไอดีเพลง")
        .setRequired(true)
    ),

  async execute(interaction) {
    const query   = interaction.options.getString("query");
    const results = db.searchSongs(query);

    if (results.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(cfg.COLOR_ERROR)
            .setTitle("🔍 ไม่พบเพลง")
            .setDescription(`ไม่พบเพลงที่มีคำว่า **"${query}"**`)
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }

    const list = results.slice(0, 15).map((s, i) =>
      [
        `\`${String(i + 1).padStart(2, "0")}.\` **${s.name}**`,
        `└ ID: \`${s.id}\` · ❤️ ${s.votes.length} · โดย ${s.addedByTag}`,
      ].join("\n")
    );

    const embed = new EmbedBuilder()
      .setColor(cfg.COLOR_INFO)
      .setTitle(`🔍 ผลการค้นหา: "${query}"`)
      .setDescription(list.join("\n\n"))
      .setFooter({
        text: `พบ ${results.length} เพลง${results.length > 15 ? " (แสดง 15 อันดับแรก)" : ""}`,
      })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};