// ═══════════════════════════════════════════════════════════════
//  📋  /list  —  ดูรายชื่อเพลงทั้งหมด (Paginate)
// ═══════════════════════════════════════════════════════════════
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const db       = require("../utils/database");
const { paginate } = require("../utils/helpers");
const cfg      = require("../config");

const PAGE_SIZE = 10;

function buildEmbed(items, page, total) {
  const list = items.map((s, i) =>
    [
      `\`${String((page - 1) * PAGE_SIZE + i + 1).padStart(3, "0")}.\` **${s.name}**`,
      `└ \`${s.id}\` · ❤️ ${s.votes.length} · ${s.addedByTag}`,
    ].join("\n")
  );

  return new EmbedBuilder()
    .setColor(cfg.COLOR_INFO)
    .setTitle("🎵 รายชื่อเพลงทั้งหมด")
    .setDescription(list.join("\n\n") || "ยังไม่มีเพลงในระบบ")
    .setFooter({ text: `หน้า ${page}/${total} · รวม ${db.getMeta().totalSongs} เพลง` })
    .setTimestamp();
}

function buildRow(page, total) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`list_prev_${page}`)
      .setLabel("◀ ก่อนหน้า")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`list_page_${page}`)
      .setLabel(`${page} / ${total}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`list_next_${page}`)
      .setLabel("ถัดไป ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= total)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("list")
    .setDescription("📋 ดูรายชื่อเพลงทั้งหมดในระบบ")
    .addIntegerOption((opt) =>
      opt.setName("page").setDescription("หน้าที่ต้องการ").setRequired(false)
    ),

  async execute(interaction) {
    const all      = db.getAllSongs().sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    const page     = Math.max(1, interaction.options.getInteger("page") || 1);
    const { items, total } = paginate(all, page, PAGE_SIZE);

    if (all.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(cfg.COLOR_WARN)
            .setTitle("📋 ยังไม่มีเพลง")
            .setDescription("ยังไม่มีเพลงในฐานข้อมูลเลย"),
        ],
        ephemeral: true,
      });
    }

    await interaction.reply({
      embeds: [buildEmbed(items, page, total)],
      components: total > 1 ? [buildRow(page, total)] : [],
      ephemeral: true,
    });
  },

  // ── Button handler (ลงทะเบียนใน index.js) ──
  async handleButton(interaction) {
    const [, action, pageStr] = interaction.customId.split("_");
    const currentPage = parseInt(pageStr, 10);
    const all = db.getAllSongs().sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    const newPage = action === "next" ? currentPage + 1 : currentPage - 1;
    const { items, total } = paginate(all, newPage, PAGE_SIZE);

    await interaction.update({
      embeds: [buildEmbed(items, newPage, total)],
      components: [buildRow(newPage, total)],
    });
  },
};