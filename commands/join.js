const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require("@discordjs/voice");

// เก็บ connection ไว้ใช้ร่วมกับ leave/vcstatus
if (!global.voiceConnections) global.voiceConnections = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("🎀 เชิญบอทเข้าห้องเสียงที่คุณอยู่"),

  async execute(interaction) {
    // เฉพาะแอดมินหรือ ManageGuild
    if (
      !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
      !interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      return interaction.reply({ content: "❌ ต้องเป็นแอดมินถึงใช้คำสั่งนี้ได้นะ 💀", ephemeral: true });
    }

    const vc = interaction.member.voice?.channel;
    if (!vc) {
      return interaction.reply({ content: "⚠️ เข้าห้องเสียงก่อนแล้วค่อยเรียกนะ 😤", ephemeral: true });
    }

    const perms = vc.permissionsFor(interaction.guild.members.me);
    if (!perms.has(PermissionsBitField.Flags.Connect)) {
      return interaction.reply({ content: "❌ บอทไม่มีสิทธิ์เข้าห้องนั้น 🥹", ephemeral: true });
    }

    try {
      // ถ้ามี connection เดิมอยู่ให้ destroy ก่อน
      const old = global.voiceConnections.get(interaction.guild.id);
      if (old) { try { old.destroy(); } catch {} }

      const connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
      });

      // auto-rejoin ถ้าหลุด
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
          global.voiceConnections.delete(interaction.guild.id);
        }
      });

      global.voiceConnections.set(interaction.guild.id, { connection, channelId: vc.id, channelName: vc.name });

      return interaction.reply({ content: `✅ เข้าห้อง **${vc.name}** แล้วนะ~ 🎀🔥` });
    } catch (err) {
      console.error("join error:", err.message);
      return interaction.reply({ content: "❌ เข้าห้องไม่ได้ ลองใหม่นะ ;-;", ephemeral: true });
    }
  },
};
