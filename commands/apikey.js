// ══════════════════════════════════════════════════════════════
//  🔑  /apikey — จัดการ API key ของ Public API (/api/public/songs)
//  ใช้ store ไฟล์เดียวกับเว็บ (utils/apiKeyStore.js) จึงสร้าง/ลบ
//  จากบอทแล้วเว็บเห็นผลทันที ไม่ต้องรีสตาร์ทอะไรเพิ่ม
//  สิทธิ์: เฉพาะเจ้าของเซิร์ฟเวอร์ Discord หรือคนที่มีสิทธิ์ Administrator
//
//  🔒 คีย์เต็มจะเก็บแบบ hash เท่านั้น (ดูรายละเอียดใน apiKeyStore.js)
//  โชว์ค่าเต็มให้เห็นแค่ตอน /apikey create ครั้งเดียว — เก็บให้ดี
// ══════════════════════════════════════════════════════════════
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const apiKeyStore = require("../utils/apiKeyStore");

function isAdmin(interaction) {
  const isOwner     = interaction.guild && String(interaction.guild.ownerId) === String(interaction.user.id);
  const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return !!(isOwner || isAdminPerm);
}

function formatExpiry(expiresAt, expired) {
  if (!expiresAt) return "ไม่มีวันหมดอายุ";
  const d = new Date(expiresAt).toLocaleString("th-TH");
  return expired ? `หมดอายุแล้ว (${d})` : `หมดอายุ: ${d}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("apikey")
    .setDescription("จัดการ API key สำหรับ Public API ของเว็บ (เฉพาะแอดมิน)")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("สร้าง API key ใหม่")
        .addStringOption((opt) =>
          opt
            .setName("label")
            .setDescription("ชื่อ/คำอธิบายว่าใครขอ เช่น ชื่อบอทหรือคนที่ขอ")
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("expires_days")
            .setDescription("หมดอายุใน (วัน) — ไม่ใส่ = ไม่มีวันหมดอายุ")
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("ดูรายการ API key ทั้งหมด")
    )
    .addSubcommand((sub) =>
      sub
        .setName("revoke")
        .setDescription("ลบ/เพิกถอน API key")
        .addStringOption((opt) =>
          opt
            .setName("id")
            .setDescription("id ของคีย์ที่ต้องการลบ (ดูได้จาก /apikey list)")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ คำสั่งนี้ใช้ได้เฉพาะเจ้าของเซิร์ฟเวอร์หรือแอดมินเท่านั้น",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // ── สร้างคีย์ใหม่ ──────────────────────────────────────────
    if (sub === "create") {
      const label        = interaction.options.getString("label");
      const expiresInDays = interaction.options.getInteger("expires_days");

      const { id, key, expiresAt } = apiKeyStore.createKey({
        label,
        createdBy: interaction.user.id,
        expiresInDays,
      });

      const embed = new EmbedBuilder()
        .setColor("#34d399")
        .setTitle("🔑 สร้าง API key สำเร็จ")
        .addFields(
          { name: "🏷️ ชื่อ", value: label },
          { name: "🆔 ID (ใช้ตอนจะลบ)", value: `\`${id}\`` },
          { name: "🔑 Key (ก๊อปไปให้คนขอได้เลย)", value: `\`\`\`${key}\`\`\`` },
          { name: "⏳ อายุการใช้งาน", value: formatExpiry(expiresAt, false) },
          { name: "⚠️ หมายเหตุ", value: "ระบบเก็บแค่ hash ของคีย์นี้ไว้ — จะไม่สามารถเรียกดูค่าเต็มซ้ำได้อีก ถ้าทำหายต้องสร้างใหม่แล้วลบอันเก่าทิ้ง" }
        )
        .setFooter({ text: `สร้างโดย ${interaction.user.username}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── ดูรายการคีย์ทั้งหมด ────────────────────────────────────
    if (sub === "list") {
      const keys = apiKeyStore.listKeys();
      if (!keys.length) {
        return interaction.reply({ content: "ยังไม่มี API key ที่สร้างไว้เลยครับ", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor("#60a5fa")
        .setTitle(`🔑 API keys ทั้งหมด (${keys.length})`)
        .setDescription(
          keys
            .map((k) => {
              const createdAt = new Date(k.createdAt).toLocaleString("th-TH");
              const status    = k.expired ? "🔴" : "🟢";
              return (
                `${status} **${k.label || "(ไม่มีชื่อ)"}**\n` +
                `ID: \`${k.id}\`  •  \`${k.prefix}\`\n` +
                `สร้างเมื่อ: ${createdAt}  •  ${formatExpiry(k.expiresAt, k.expired)}`
              );
            })
            .join("\n\n")
        )
        .setFooter({ text: "ใช้ /apikey revoke id:<ID> เพื่อลบ" });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── ลบคีย์ ────────────────────────────────────────────────
    if (sub === "revoke") {
      const id      = interaction.options.getString("id");
      const removed = apiKeyStore.revokeKey(id);

      return interaction.reply({
        content: removed
          ? "✅ ลบ API key เรียบร้อยแล้ว"
          : "⚠️ ไม่พบ API key ที่มี id นี้ (เช็คด้วย /apikey list อีกครั้ง)",
        ephemeral: true,
      });
    }
  },
};
