// ═══════════════════════════════════════════════════════════════
//  ✅  /setup-verify  —  ระบบยืนยันตัวตนด้วยรหัสสุ่ม (เฉพาะแอดมิน)
//  กดปุ่ม → บอทสุ่มรหัส → กดกรอกรหัส → พิมพ์ให้ตรง → รับยศ
// ═══════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require("discord.js");

const CODE_TTL_MS   = 3 * 60 * 1000; // รหัสหมดอายุใน 3 นาที
const MAX_ATTEMPTS  = 3;
const pending = new Map(); // userId -> { code, roleId, attempts, expires }

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ตัด 0/O, 1/I กันสับสน
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup-verify")
    .setDescription("ตั้งค่าระบบยืนยันตัวตนด้วยรหัสสุ่ม (แอดมินเท่านั้น)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt.setName("ห้อง").setDescription("ห้องที่จะโพสต์ปุ่มยืนยันตัวตน")
        .addChannelTypes(ChannelType.GuildText).setRequired(true)
    )
    .addRoleOption((opt) =>
      opt.setName("ยศ").setDescription("ยศที่จะให้เมื่อยืนยันสำเร็จ").setRequired(true)
    )
    .addAttachmentOption((opt) =>
      opt.setName("รูปภาพ").setDescription("แบนเนอร์ (ไม่บังคับ)").setRequired(false)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel("ห้อง");
    const role    = interaction.options.getRole("ยศ");
    const image   = interaction.options.getAttachment("รูปภาพ");

    if (image && !image.contentType?.startsWith("image/")) {
      await interaction.reply({ content: "❌ ไฟล์ที่แนบมาไม่ใช่รูปภาพ", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle("✨ ยืนยันตัวตนด้วยรหัสสุ่ม ❗")
      .setDescription("➡ กดปุ่มด้านล่าง บอทจะสุ่มรหัสให้ แล้วนำรหัสไปกรอกเพื่อรับยศครับ");
    if (image) embed.setImage(image.url);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`verifystart_${role.id}`)
        .setLabel("ยืนยันตัวตน").setEmoji("🤍").setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `✅ ตั้งค่าระบบยืนยันตัวตนที่ ${channel} เรียบร้อย (ยศ: ${role})`, ephemeral: true });
  },

  // เรียกจาก interactionCreate เมื่อ isButton()
  async handleButton(interaction) {
    // ปุ่มแรก: กดแล้วสุ่มรหัส
    if (interaction.customId.startsWith("verifystart_")) {
      const roleId = interaction.customId.replace("verifystart_", "");

      if (interaction.member.roles.cache.has(roleId)) {
        await interaction.reply({ content: "✅ คุณยืนยันตัวตนแล้วครับ", ephemeral: true });
        return true;
      }

      const code = genCode();
      pending.set(interaction.user.id, {
        code, roleId, attempts: 0, expires: Date.now() + CODE_TTL_MS,
      });
      setTimeout(() => {
        const p = pending.get(interaction.user.id);
        if (p && p.code === code) pending.delete(interaction.user.id);
      }, CODE_TTL_MS);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`verifyenter_${roleId}`)
          .setLabel("📝 กรอกรหัสยืนยัน").setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({
        content: `🔐 รหัสยืนยันของคุณคือ: \`${code}\`\nกดปุ่มด้านล่างแล้วพิมพ์รหัสนี้ภายใน 3 นาทีครับ`,
        components: [row],
        ephemeral: true,
      });
      return true;
    }

    // ปุ่มสอง: เปิดฟอร์มกรอกรหัส
    if (interaction.customId.startsWith("verifyenter_")) {
      const roleId = interaction.customId.replace("verifyenter_", "");
      const p = pending.get(interaction.user.id);

      if (!p || p.expires < Date.now()) {
        await interaction.reply({ content: "⏰ รหัสหมดอายุแล้ว กดปุ่ม \"ยืนยันตัวตน\" ใหม่อีกครั้งครับ", ephemeral: true });
        return true;
      }

      const modal = new ModalBuilder()
        .setCustomId(`verifymodal_${roleId}`)
        .setTitle("ยืนยันตัวตน");

      const input = new TextInputBuilder()
        .setCustomId("code")
        .setLabel("กรอกรหัสยืนยัน 6 หลัก")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("เช่น A1B2C3")
        .setMinLength(6)
        .setMaxLength(6)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    return false;
  },

  // เรียกจาก interactionCreate เมื่อ isModalSubmit()
  async handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith("verifymodal_")) return false;

    const roleId = interaction.customId.replace("verifymodal_", "");
    const typed  = interaction.fields.getTextInputValue("code").trim().toUpperCase();
    const p = pending.get(interaction.user.id);

    if (!p || p.expires < Date.now()) {
      await interaction.reply({ content: "⏰ รหัสหมดอายุแล้ว กดปุ่ม \"ยืนยันตัวตน\" ใหม่อีกครั้งครับ", ephemeral: true });
      return true;
    }

    if (typed !== p.code) {
      p.attempts += 1;
      if (p.attempts >= MAX_ATTEMPTS) {
        pending.delete(interaction.user.id);
        await interaction.reply({ content: "❌ กรอกรหัสผิดครบจำนวนครั้งแล้ว กดปุ่ม \"ยืนยันตัวตน\" เพื่อขอรหัสใหม่ครับ", ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ รหัสไม่ถูกต้อง (เหลือ ${MAX_ATTEMPTS - p.attempts} ครั้ง) ลองใหม่ได้ที่ปุ่ม "กรอกรหัสยืนยัน" ครับ`, ephemeral: true });
      }
      return true;
    }

    const role = interaction.guild.roles.cache.get(roleId);
    pending.delete(interaction.user.id);

    if (!role) {
      await interaction.reply({ content: "❌ ไม่พบยศนี้แล้ว ติดต่อแอดมินครับ", ephemeral: true });
      return true;
    }

    try {
      await interaction.member.roles.add(role);
      await interaction.reply({ content: `🎉 ยืนยันตัวตนสำเร็จ! รับยศ **${role.name}** แล้วครับ`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ บอทไม่มีสิทธิ์ให้ยศนี้ (เช็คตำแหน่ง role ของบอทด้วยครับ)", ephemeral: true });
    }
    return true;
  },
};
