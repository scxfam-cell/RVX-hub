// ═══════════════════════════════════════════════════════════════
//  /setuploader  —  แอดมินตั้งชื่อผู้อัพเพลง (แสดงเป็นตัวหนังสือสีเทาใต้ชื่อเพลงบนเว็บ)
// ═══════════════════════════════════════════════════════════════
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const db            = require("../utils/database");
const uploaderStore = require("../utils/uploaderStore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setuploader")
    .setDescription("ตั้ง/ลบชื่อผู้อัพเพลง (แสดงใต้ชื่อเพลงบนเว็บ)")
    .addStringOption((opt) =>
      opt.setName("songid").setDescription("ID เพลง").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("name")
        .setDescription("ชื่อผู้อัพเพลง (เว้นว่างไว้ = ลบชื่อออก)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const songId = interaction.options.getString("songid");
    const name   = interaction.options.getString("name");

    const songs = db.getAllSongs();
    const song  = songs.find((s) => s.id === songId);
    if (!song) {
      return interaction.reply({ content: `ไม่พบเพลง ID \`${songId}\``, ephemeral: true });
    }

    if (!name) {
      uploaderStore.clear(songId);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#9ca3af")
            .setTitle("ลบชื่อผู้อัพเพลงแล้ว")
            .addFields(
              { name: "เพลง", value: `${song.name}\n\`${songId}\`` },
              { name: "โดยแอดมิน", value: `<@${interaction.user.id}>` }
            )
            .setTimestamp(),
        ],
      });
    }

    uploaderStore.set(songId, name);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#a855f7")
          .setTitle("ตั้งชื่อผู้อัพเพลงแล้ว")
          .addFields(
            { name: "เพลง", value: `${song.name}\n\`${songId}\`` },
            { name: "ชื่อผู้อัพ", value: name },
            { name: "โดยแอดมิน", value: `<@${interaction.user.id}>` }
          )
          .setTimestamp(),
      ],
    });
  },
};
