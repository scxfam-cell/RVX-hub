// ═══════════════════════════════════════════════════════════════
//  🛡️  /automodpanel  —  แผงควบคุมระบบความปลอดภัยทั้งหมดในที่เดียว
//  รวม antispam / antilink / antiemoji / antiimage / antibotinvite
//  กดปุ่มเปิด/ปิดได้ทันที ไม่ต้องพิมพ์หลายคำสั่ง — ค่าที่ตั้งเซฟถาวร
//  ไม่หายแม้รีบอท (เก็บใน data/automod.json ผ่าน utils/automod/store.js)
// ═══════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");
const store = require("../utils/automod/store");

const SYSTEMS = [
  { key: "antispam",      emoji: "💬", label: "กันสแปมข้อความ" },
  { key: "antilink",      emoji: "🔗", label: "กันลิงก์" },
  { key: "antiemoji",     emoji: "😂", label: "กันสแปมอีโมจิ" },
  { key: "antiimage",     emoji: "🖼️", label: "กันสแปมรูปภาพ" },
  { key: "antibotinvite", emoji: "🤖", label: "กันเชิญบอทแปลกปลอม" },
];

const LINK_LEVEL_TEXT = ["ปิด", "กันคำเชิญ", "+ลิงก์ไวรัส/ฟิชชิ่ง", "กันทุกลิงก์"];

function detailText(key, sys) {
  switch (key) {
    case "antispam":
      return `จำกัด ${sys.messageLimit} ข้อความ / ${sys.intervalSeconds} วิ`;
    case "antilink":
      return `ระดับ ${sys.defaultLevel} (${LINK_LEVEL_TEXT[sys.defaultLevel] ?? "?"})`;
    case "antiemoji":
      return `จำกัด ${sys.limit} ตัว / ข้อความ`;
    case "antiimage":
      return `จำกัด ${sys.imageLimit} รูป / ${sys.intervalSeconds} วิ`;
    case "antibotinvite":
      return `ยกเว้นไว้ ${sys.exemptUsers.length} รายการ`;
    default:
      return "";
  }
}

function buildEmbed(guild, cfg) {
  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle("🛡️ แผงควบคุมระบบความปลอดภัย (Automod)")
    .setDescription(
      "กดปุ่มด้านล่างเพื่อ **เปิด/ปิด** แต่ละระบบได้เลย ไม่ต้องพิมพ์คำสั่งซับซ้อน\n" +
      "✅ ค่าที่ตั้งจะถูกบันทึกอัตโนมัติ ไม่หายแม้รีสตาร์ทบอท"
    )
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp();

  for (const s of SYSTEMS) {
    const sys = cfg.systems[s.key];
    embed.addFields({
      name: `${s.emoji} ${s.label}`,
      value: `${sys.enabled ? "✅ เปิดอยู่" : "❌ ปิดอยู่"}\n${detailText(s.key, sys)}`,
      inline: true,
    });
  }
  return embed;
}

function buildRows(cfg) {
  const row = new ActionRowBuilder();
  for (const s of SYSTEMS) {
    const enabled = cfg.systems[s.key].enabled;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`automodpanel_toggle_${s.key}`)
        .setLabel(`${s.emoji} ${enabled ? "ปิด" : "เปิด"}${s.label}`)
        .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );
  }
  return [row];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("automodpanel")
    .setDescription("แผงควบคุมระบบความปลอดภัยทั้งหมดในที่เดียว (เปิด/ปิดด้วยปุ่ม)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const cfg = store.getGuildConfig(interaction.guild.id);
    await interaction.reply({
      embeds: [buildEmbed(interaction.guild, cfg)],
      components: buildRows(cfg),
    });
  },

  // เรียกจาก index.js ตอน customId ขึ้นต้นด้วย "automodpanel_toggle_"
  async handleButton(interaction) {
    if (!interaction.customId.startsWith("automodpanel_toggle_")) return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "⚠️ ต้องมีสิทธิ์ Manage Server ถึงจะกดปุ่มนี้ได้",
        ephemeral: true,
      });
    }

    const key = interaction.customId.replace("automodpanel_toggle_", "");
    const cfg = store.getGuildConfig(interaction.guild.id);
    if (!cfg.systems[key]) return;

    cfg.systems[key].enabled = !cfg.systems[key].enabled;
    store.save();

    await interaction.update({
      embeds: [buildEmbed(interaction.guild, cfg)],
      components: buildRows(cfg),
    });
  },
};
