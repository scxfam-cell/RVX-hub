// ═══════════════════════════════════════════════════════════════
//  🛒  /checkinshop — จัดการร้านแลกยศของระบบเช็คอินรายวัน
// ═══════════════════════════════════════════════════════════════
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const checkinDB = require("../utils/checkinDB");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("checkinshop")
    .setDescription("จัดการร้านแลกยศของระบบเช็คอินรายวัน")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("เพิ่มยศเข้าร้านแลกยศ")
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("ยศที่จะเพิ่มเข้าร้าน").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("price")
            .setDescription("ราคา (เหรียญ)")
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("ลบยศออกจากร้านแลกยศ")
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("ยศที่จะลบออกจากร้าน").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("แสดงรายการยศทั้งหมดในร้านแลกยศ")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /checkinshop add ────────────────────────────────────
    if (sub === "add") {
      const role  = interaction.options.getRole("role");
      const price = interaction.options.getInteger("price");

      if (role.managed) {
        return interaction.reply({
          content: "ยศนี้เป็นยศของบอท/อินทิเกรชัน ไม่สามารถแจกผ่านระบบได้",
          ephemeral: true,
        });
      }

      checkinDB.addRole(role.id, role.name, price);

      const embed = new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle("เพิ่มยศเข้าร้านสำเร็จ")
        .setDescription(`ยศ **${role.name}** ราคา **${price} เหรียญ**`);

      return interaction.reply({ embeds: [embed] });
    }

    // ── /checkinshop remove ─────────────────────────────────
    if (sub === "remove") {
      const role    = interaction.options.getRole("role");
      const removed = checkinDB.removeRole(role.id);

      const embed = new EmbedBuilder()
        .setColor(removed ? 0x34d399 : 0xf87171)
        .setTitle(removed ? "ลบยศออกจากร้านสำเร็จ" : "ไม่พบยศนี้ในร้าน")
        .setDescription(`ยศ **${role.name}**`);

      return interaction.reply({ embeds: [embed], ephemeral: !removed });
    }

    // ── /checkinshop list ────────────────────────────────────
    if (sub === "list") {
      const roles = checkinDB.getRoles();

      if (!roles.length) {
        return interaction.reply({
          content: "ยังไม่มียศในร้านแลกยศ ใช้ `/checkinshop add` เพื่อเพิ่ม",
          ephemeral: true,
        });
      }

      const desc = roles
        .map((r, i) => `${i + 1}. <@&${r.id}> — **${r.price}** เหรียญ`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle("รายการยศในร้านแลกยศ")
        .setDescription(desc);

      return interaction.reply({ embeds: [embed] });
    }
  },
};