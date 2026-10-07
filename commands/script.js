// ═══════════════════════════════════════════════════════════════
//  📜  /script  —  ระบบจัดการสคริปต์สไตล์ค่ายใหญ่ (เฉพาะแอดมิน)
//  add    : เปิดฟอร์มกรอกรายละเอียดสคริปต์แบบมืออาชีพ + เลือกห้องที่จะโพสต์
//  list   : ดูรายการสคริปต์ทั้งหมดในเซิร์ฟเวอร์นี้
//  remove : ลบสคริปต์ออกจากระบบ (ไม่ลบข้อความในห้อง)
//  check  : บังคับเช็คสถานะทันที
// ═══════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const {
  addScript,
  listScripts,
  removeScript,
  checkOne,
  extractUrl,
} = require("../utils/scriptMonitor");

// เก็บข้อมูลชั่วคราวระหว่างรอผู้ใช้กรอก Modal (key = userId)
const pending = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

function setPending(userId, data) {
  pending.set(userId, data);
  setTimeout(() => pending.delete(userId), PENDING_TTL_MS);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("script")
    .setDescription("จัดการระบบสคริปต์ (แอดมินเท่านั้น)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("เพิ่มสคริปต์ใหม่ — เปิดฟอร์มกรอกรายละเอียด")
        .addStringOption((opt) =>
          opt
            .setName("สคริปต์")
            .setDescription("วางลิงก์ loadstring หรือ URL ของสคริปต์")
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName("ห้อง")
            .setDescription("ห้องที่จะให้บอทโพสต์สคริปต์")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addBooleanOption((opt) =>
          opt
            .setName("มีคีย์")
            .setDescription("สคริปต์นี้ต้องใช้คีย์เพื่อปลดล็อคหรือไม่")
            .setRequired(true)
        )
        .addAttachmentOption((opt) =>
          opt
            .setName("รูปภาพ")
            .setDescription("รูปภาพ/แบนเนอร์ประกอบสคริปต์ (ไม่บังคับ)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("ดูรายการสคริปต์ทั้งหมดในเซิร์ฟเวอร์นี้")
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("ลบสคริปต์ออกจากระบบ")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Script ID (ดูได้จาก /script list)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("check")
        .setDescription("บังคับเช็คสถานะสคริปต์ทันที")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Script ID (ดูได้จาก /script list)").setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── ADD → เปิดฟอร์ม (Modal) ─────────────
    if (sub === "add") {
      const rawScript = interaction.options.getString("สคริปต์");
      const channel   = interaction.options.getChannel("ห้อง");
      const hasKey    = interaction.options.getBoolean("มีคีย์");
      const image     = interaction.options.getAttachment("รูปภาพ");

      if (!extractUrl(rawScript)) {
        await interaction.reply({
          content: "❌ ไม่พบลิงก์ http/https ที่ถูกต้องในสคริปต์ที่วางมา ลองตรวจสอบอีกครั้งครับ",
          ephemeral: true,
        });
        return;
      }

      if (image && !image.contentType?.startsWith("image/")) {
        await interaction.reply({
          content: "❌ ไฟล์ที่แนบมาไม่ใช่รูปภาพ กรุณาแนบไฟล์ .png / .jpg / .webp / .gif",
          ephemeral: true,
        });
        return;
      }

      setPending(interaction.user.id, {
        rawScript,
        channelId: channel.id,
        guildId: interaction.guildId,
        hasKey,
        imageUrl: image?.url || null,
      });

      const modal = new ModalBuilder()
        .setCustomId(`scriptaddmodal_${interaction.user.id}`)
        .setTitle("📜 เพิ่มสคริปต์ใหม่ — กรอกรายละเอียด");

      const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("ชื่อสคริปต์")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("เช่น NEXUS Universal Hub")
        .setRequired(true)
        .setMaxLength(80);

      const descInput = new TextInputBuilder()
        .setCustomId("description")
        .setLabel("คำอธิบาย / ฟีเจอร์เด่น")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("เช่น Auto Farm, ESP, Speed Hack, รองรับทุกเกม...")
        .setRequired(true)
        .setMaxLength(500);

      const categoryInput = new TextInputBuilder()
        .setCustomId("category")
        .setLabel("หมวดหมู่ / เกมที่รองรับ")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("เช่น Universal, Blox Fruits, Pet Sim 99")
        .setRequired(true)
        .setMaxLength(80);

      const versionInput = new TextInputBuilder()
        .setCustomId("version")
        .setLabel("เวอร์ชัน (ไม่บังคับ)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("เช่น v2.5.1")
        .setRequired(false)
        .setMaxLength(30);

      const keyNoteInput = new TextInputBuilder()
        .setCustomId("keyNote")
        .setLabel("รายละเอียดคีย์ (ถ้ามี)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("เช่น คีย์ใช้ได้ 24 ชม. รับที่ลิงก์คีย์ระบบ")
        .setRequired(false)
        .setMaxLength(150);

      modal.addComponents(
        new (require("discord.js").ActionRowBuilder)().addComponents(nameInput),
        new (require("discord.js").ActionRowBuilder)().addComponents(descInput),
        new (require("discord.js").ActionRowBuilder)().addComponents(categoryInput),
        new (require("discord.js").ActionRowBuilder)().addComponents(versionInput),
        new (require("discord.js").ActionRowBuilder)().addComponents(keyNoteInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // ── LIST ─────────────────────────────────
    if (sub === "list") {
      const scripts = listScripts(interaction.guildId);
      if (scripts.length === 0) {
        await interaction.reply({ content: "📭 ยังไม่มีสคริปต์ในระบบเลยครับ", ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("📜 รายการสคริปต์ทั้งหมด")
        .setDescription(
          scripts
            .map((s) => {
              const status = s.lastStatus === null ? "⏳" : s.lastStatus ? "🟢" : "🔴";
              const key = s.hasKey ? "🔑" : "🆓";
              return `${status} ${key} **${s.name}** — <#${s.channelId}>\n└ หมวดหมู่: ${s.category || "-"} · ID: \`${s.id}\``;
            })
            .join("\n\n")
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // ── REMOVE ───────────────────────────────
    if (sub === "remove") {
      const id = interaction.options.getString("id");
      const ok = await removeScript(id);
      await interaction.reply({
        content: ok ? `🗑️ ลบสคริปต์ \`${id}\` ออกจากระบบแล้ว` : `❌ ไม่พบสคริปต์ ID \`${id}\``,
        ephemeral: true,
      });
      return;
    }

    // ── CHECK ────────────────────────────────
    if (sub === "check") {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.options.getString("id");
      const out = await checkOne(interaction.client, id);

      if (!out) {
        await interaction.editReply({ content: `❌ ไม่พบสคริปต์ ID \`${id}\`` });
        return;
      }

      const { entry, result } = out;
      await interaction.editReply({
        content: result.online
          ? `✅ **${entry.name}** ยังทำงานปกติ (HTTP ${result.statusCode}, ${result.responseTime}ms)`
          : `❌ **${entry.name}** ใช้งานไม่ได้ (${result.error})`,
      });
      return;
    }
  },

  // เรียกจาก interactionCreate เมื่อ isModalSubmit()
  async handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith("scriptaddmodal_")) return false;

    const data = pending.get(interaction.user.id);
    if (!data) {
      await interaction.reply({ content: "⏰ ฟอร์มหมดอายุแล้ว กรุณาใช้ /script add ใหม่อีกครั้ง", ephemeral: true });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    const name        = interaction.fields.getTextInputValue("name");
    const description = interaction.fields.getTextInputValue("description");
    const category     = interaction.fields.getTextInputValue("category");
    const version      = interaction.fields.getTextInputValue("version") || "";
    const keyNote      = interaction.fields.getTextInputValue("keyNote") || "";

    try {
      const entry = await addScript(interaction.client, {
        name, description, category, version,
        hasKey: data.hasKey,
        keyNote,
        rawScript: data.rawScript,
        channelId: data.channelId,
        guildId: data.guildId,
        addedBy: interaction.user.id,
        imageUrl: data.imageUrl,
      });

      pending.delete(interaction.user.id);

      await interaction.editReply({
        content: `✅ เพิ่มสคริปต์ **${entry.name}** เรียบร้อย → โพสต์ที่ <#${entry.channelId}> แล้ว\nระบบจะเช็คสถานะให้อัตโนมัติทุก 5 นาที\nID: \`${entry.id}\``,
      });
    } catch (err) {
      await interaction.editReply({ content: `❌ เพิ่มสคริปต์ไม่สำเร็จ: ${err.message}` });
    }
    return true;
  },

  // เรียกจาก interactionCreate เมื่อ isButton()
  async handleButton(interaction) {
    if (!interaction.customId.startsWith("scriptcheck_")) return false;

    const id = interaction.customId.replace("scriptcheck_", "");
    await interaction.deferReply({ ephemeral: true });
    const out = await checkOne(interaction.client, id);

    if (!out) {
      await interaction.editReply({ content: "❌ ไม่พบสคริปต์นี้ในระบบแล้ว" });
      return true;
    }

    const { entry, result } = out;
    await interaction.editReply({
      content: result.online
        ? `✅ **${entry.name}** ยังทำงานปกติ (HTTP ${result.statusCode}, ${result.responseTime}ms)`
        : `❌ **${entry.name}** ใช้งานไม่ได้ (${result.error})`,
    });
    return true;
  },
};
