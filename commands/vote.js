// ═══════════════════════════════════════════════════════════════
//  ❤️  /vote  —  โหวตเพลงที่ชอบ
// ═══════════════════════════════════════════════════════════════
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const db  = require("../utils/database");
const cfg = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vote")
    .setDescription("❤️ โหวต (หรือยกเลิกโหวต) เพลงที่ชอบ")
    .addStringOption((opt) =>
      opt
        .setName("id")
        .setDescription("ไอดีเพลงที่ต้องการโหวต")
        .setRequired(true)
    ),

  async execute(interaction) {
    const songId = interaction.options.getString("id").trim();
    const all    = db.getAllSongs();
    const song   = all.find((s) => s.id === songId);

    if (!song) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(cfg.COLOR_ERROR)
            .setTitle("❌ ไม่พบเพลง")
            .setDescription(`ไม่พบไอดีเพลง \`${songId}\` ในระบบ`),
        ],
        ephemeral: true,
      });
    }

    const newCount  = db.voteSong(songId, interaction.user.id);
    const hasVoted  = db.getAllSongs().find((s) => s.id === songId)?.votes.includes(interaction.user.id);
    const action    = hasVoted ? "❤️ โหวตแล้ว!" : "💔 ยกเลิกโหวตแล้ว";

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(hasVoted ? cfg.COLOR_SUCCESS : cfg.COLOR_WARN)
          .setTitle(action)
          .addFields(
            { name: "🎵 เพลง",  value: song.name,        inline: true },
            { name: "❤️ Votes", value: `${newCount} โหวต`, inline: true }
          )
          .setTimestamp()
          .setFooter({ text: "🎵 Song-ID Guardian" }),
      ],
      ephemeral: true,
    });
  },
};