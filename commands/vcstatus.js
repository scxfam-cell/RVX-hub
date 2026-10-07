const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vcstatus")
    .setDescription("📡 เช็คว่าบอทอยู่ในห้องเสียงไหนอยู่"),

  async execute(interaction) {
    const saved = global.voiceConnections?.get(interaction.guild.id);

    if (!saved) {
      return interaction.reply({
        content: "📡 บอทไม่ได้อยู่ในห้องเสียงไหนเลยตอนนี้",
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📡 สถานะห้องเสียง")
      .addFields(
        { name: "🎙️ ห้องที่อยู่", value: `**${saved.channelName}**`, inline: true },
        { name: "🆔 Channel ID",  value: `\`${saved.channelId}\``,   inline: true }
      )
      .setTimestamp()
      .setFooter({ text: interaction.guild.name });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
