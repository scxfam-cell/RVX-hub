// ═══════════════════════════════════════════════════════════════
//  📊  /stats  —  สถิติรายคน + leaderboard
// ═══════════════════════════════════════════════════════════════
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const db  = require("../utils/database");
const cfg = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("📊 ดูสถิติการส่งเพลง")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("ดูสถิติของคนนี้").setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;
    const stats  = db.getUserStats(target.id);
    const meta   = db.getMeta();
    const board  = db.getLeaderboard(5);

    // หาอันดับของ user
    const allStats = db.getLeaderboard(9999);
    const rank     = allStats.findIndex((s) => s.userId === target.id) + 1;

    // เพลงที่ user นี้ส่ง (เรียง vote สูงสุด)
    const userSongs = db
      .getAllSongs()
      .filter((s) => s.addedBy === target.id)
      .sort((a, b) => b.votes.length - a.votes.length)
      .slice(0, 5);

    const topSongsList = userSongs.length
      ? userSongs
          .map((s, i) => `\`${i + 1}.\` **${s.name}** · ❤️ ${s.votes.length}`)
          .join("\n")
      : "ยังไม่มีเพลง";

    const leaderStr = board
      .map((s, i) => {
        const medal = ["🥇", "🥈", "🥉"][i] || `\`${i + 1}.\``;
        return `${medal} **${s.tag || "ไม่ทราบ"}** — ${s.sent} เพลง`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(cfg.COLOR_INFO)
      .setAuthor({
        name:    target.tag || target.username,
        iconURL: target.displayAvatarURL(),
      })
      .setTitle("📊 สถิติการส่งเพลง")
      .addFields(
        {
          name:   "🎵 ส่งเพลงทั้งหมด",
          value:  `**${stats.sent}** เพลง`,
          inline: true,
        },
        {
          name:   "🗑️ ถูกลบ",
          value:  `**${stats.deleted}** ครั้ง`,
          inline: true,
        },
        {
          name:   "🏆 อันดับ",
          value:  rank ? `**#${rank}**` : "ยังไม่มีข้อมูล",
          inline: true,
        },
        {
          name:   "🌟 เพลงยอดนิยมของคุณ",
          value:  topSongsList,
          inline: false,
        },
        {
          name:   "🏅 Leaderboard Top 5",
          value:  leaderStr || "ยังไม่มีข้อมูล",
          inline: false,
        },
        {
          name:   "📦 ภาพรวมระบบ",
          value:  `เพลงทั้งหมด: **${meta.totalSongs}** · ผู้ใช้: **${meta.totalUsers}**`,
          inline: false,
        }
      )
      .setTimestamp()
      .setFooter({ text: "🎵 Song-ID Guardian" });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};