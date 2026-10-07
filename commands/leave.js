const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leave")
    .setDescription("🚪 ไล่บอทออกจากห้องเสียง"),

  async execute(interaction) {
    if (
      !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
      !interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      return interaction.reply({ content: "❌ ต้องเป็นแอดมินถึงใช้คำสั่งนี้ได้นะ 💀", ephemeral: true });
    }

    const saved = global.voiceConnections?.get(interaction.guild.id);
    if (!saved) {
      return interaction.reply({ content: "⚠️ บอทไม่ได้อยู่ในห้องเสียงไหนเลยนะ 🙃", ephemeral: true });
    }

    try {
      saved.connection.destroy();
    } catch {}

    global.voiceConnections.delete(interaction.guild.id);
    return interaction.reply({ content: "👋 ออกจากห้องแล้วนะ บาย~ 🎀" });
  },
};
