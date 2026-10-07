// ═══════════════════════════════════════════════════════════════
//  🎧  /voicereward — ตั้งค่าระบบเหรียญห้องเสียง (แอดมินเท่านั้น)
// ═══════════════════════════════════════════════════════════════
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");
const voiceRewardConfig            = require("../utils/voiceRewardConfig");
const { restartAllSessions }       = require("../utils/voiceRewardManager");
const cfg                          = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("voicereward")
    .setDescription("⚙️ ตั้งค่าระบบเหรียญจากการออนห้องเสียง (แอดมินเท่านั้น)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("ตั้งค่าห้องแจ้งเตือน / เวลา")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("ห้องที่จะแจ้งเตือนตอนได้เหรียญ")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("minutes")
            .setDescription("อยู่ห้องกี่นาทีถึงได้เหรียญ 1 ครั้ง")
            .setMinValue(1)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("เปิด/ปิดระบบเหรียญจากห้องเสียง")
        .addBooleanOption((opt) =>
          opt
            .setName("enabled")
            .setDescription("true = เปิด, false = ปิด")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("ดูค่าที่ตั้งไว้ตอนนี้")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── ดูค่าปัจจุบัน ─────────────────────────────────────────
    if (sub === "status") {
      const s = voiceRewardConfig.getConfig();
      const embed = new EmbedBuilder()
        .setColor(cfg.COLOR_INFO)
        .setTitle("🎧 การตั้งค่าระบบเหรียญห้องเสียง")
        .addFields(
          { name: "สถานะ", value: s.enabled ? "🟢 เปิดใช้งาน" : "🔴 ปิดใช้งาน", inline: true },
          { name: "ห้องแจ้งเตือน", value: s.channelId ? `<#${s.channelId}>` : "ยังไม่ตั้ง", inline: true },
          { name: "เวลา", value: `${s.minutes} นาที / ครั้ง`, inline: true },
          { name: "เหรียญ", value: "🎲 สุ่ม 1-500 เหรียญ / ครั้ง (ยิ่งเยอะยิ่งหายาก)", inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── เปิด/ปิดระบบ ──────────────────────────────────────────
    if (sub === "toggle") {
      const enabled = interaction.options.getBoolean("enabled", true);
      voiceRewardConfig.saveConfig({ enabled });
      restartAllSessions(interaction.client);
      return interaction.reply({
        content: `${enabled ? "🟢 เปิด" : "🔴 ปิด"}ระบบเหรียญห้องเสียงแล้ว มีผลทันที`,
        ephemeral: true,
      });
    }

    // ── ตั้งค่าห้อง/เวลา ──────────────────────────────────────
    if (sub === "set") {
      const channel = interaction.options.getChannel("channel");
      const minutes = interaction.options.getInteger("minutes");

      if (!channel && minutes == null) {
        return interaction.reply({
          content: "⚠️ ต้องระบุอย่างน้อย 1 ค่า (channel / minutes)",
          ephemeral: true,
        });
      }

      const patch = {};
      if (channel) patch.channelId = channel.id;
      if (minutes != null) patch.minutes = minutes;

      const updated = voiceRewardConfig.saveConfig(patch);
      restartAllSessions(interaction.client); // ให้ session ที่รันอยู่ใช้ค่าใหม่ทันที

      const embed = new EmbedBuilder()
        .setColor(cfg.COLOR_SUCCESS)
        .setTitle("✅ อัปเดตการตั้งค่าแล้ว")
        .addFields(
          { name: "ห้องแจ้งเตือน", value: updated.channelId ? `<#${updated.channelId}>` : "ยังไม่ตั้ง", inline: true },
          { name: "เวลา", value: `${updated.minutes} นาที / ครั้ง`, inline: true },
          { name: "เหรียญ", value: "🎲 สุ่ม 1-500 เหรียญ / ครั้ง (ยิ่งเยอะยิ่งหายาก)", inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
