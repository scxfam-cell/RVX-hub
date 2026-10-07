// ═══════════════════════════════════════════════════════════════
//  🎁  /giveaway  —  ระบบ Giveaway ครบวงจร
//  Commands: start · reroll · end · cancel · list
// ═══════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");

const cfg = require("../config");
const {
  parseTime,
  formatTimeLeft,
  buildGiveawayEmbed,
  buildEndEmbed,
  buildJoinButton,
  runDrawAnimation,
  pickWinners,
  getGiveaway,
  setGiveaway,
  deleteGiveaway,
  getAllGiveaways,
} = require("../utils/giveawayManager");

// ── Guard: Admin only ──────────────────────────────────────────
function isAdmin(member) {
  return member?.permissions.has(PermissionsBitField.Flags.Administrator);
}

// ══════════════════════════════════════════════
//  COMMAND DEFINITION
// ══════════════════════════════════════════════

module.exports = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("🎁 ระบบ Giveaway")

    // ── /giveaway start ──────────────────────
    .addSubcommand(sub =>
      sub
        .setName("start")
        .setDescription("🎉 เริ่ม Giveaway ใหม่")
        .addStringOption(opt =>
          opt.setName("prize").setDescription("ของรางวัล").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("duration").setDescription("เวลา เช่น 30m, 1h, 2d").setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("winners").setDescription("จำนวนผู้ชนะ").setRequired(true).setMinValue(1).setMaxValue(20)
        )
        .addChannelOption(opt =>
          opt.setName("channel").setDescription("ห้องประกาศ (ถ้าไม่เลือก = ห้องปัจจุบัน)").setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName("mention").setDescription("แท็กใคร?").setRequired(false)
            .addChoices(
              { name: "@everyone",  value: "@everyone"  },
              { name: "@here",      value: "@here"      },
              { name: "ไม่แท็ก",    value: "none"       },
            )
        )
    )

    // ── /giveaway reroll ─────────────────────
    .addSubcommand(sub =>
      sub
        .setName("reroll")
        .setDescription("🔄 สุ่มผู้ชนะใหม่")
        .addStringOption(opt =>
          opt.setName("message_id").setDescription("Message ID ของ Giveaway").setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("winners").setDescription("จำนวนผู้ชนะ (ถ้าไม่ระบุ = ค่าเดิม)").setRequired(false).setMinValue(1)
        )
    )

    // ── /giveaway end ────────────────────────
    .addSubcommand(sub =>
      sub
        .setName("end")
        .setDescription("🛑 จบ Giveaway ทันที")
        .addStringOption(opt =>
          opt.setName("message_id").setDescription("Message ID ของ Giveaway").setRequired(true)
        )
    )

    // ── /giveaway cancel ─────────────────────
    .addSubcommand(sub =>
      sub
        .setName("cancel")
        .setDescription("❌ ยกเลิก Giveaway")
        .addStringOption(opt =>
          opt.setName("message_id").setDescription("Message ID ของ Giveaway").setRequired(true)
        )
    )

    // ── /giveaway list ───────────────────────
    .addSubcommand(sub =>
      sub.setName("list").setDescription("📊 ดูรายการ Giveaway ที่กำลังดำเนินอยู่")
    ),

  // ════════════════════════════════════════════
  //  EXECUTE
  // ════════════════════════════════════════════
  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        content: "❌ คำสั่งนี้ใช้ได้เฉพาะ **Administrator** เท่านั้น",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // ──────────────────────────────────────────
    //  🎉  START
    // ──────────────────────────────────────────
    if (sub === "start") {
      const prize       = interaction.options.getString("prize");
      const durationStr = interaction.options.getString("duration");
      const winnerCount = interaction.options.getInteger("winners");
      const targetCh    = interaction.options.getChannel("channel") || interaction.channel;
      const mention     = interaction.options.getString("mention") || "none";

      const duration = parseTime(durationStr);
      if (!duration) {
        return interaction.reply({
          content: "❌ รูปแบบเวลาไม่ถูกต้อง!\nตัวอย่าง: `30m`, `1h`, `2d`, `30s`",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const endTime  = Date.now() + duration;
      const timeLeft = duration;

      // สร้าง placeholder giveaway ก่อน (ยังไม่มี messageId)
      const tempData = {
        id:           "temp",
        messageId:    "temp",
        channelId:    targetCh.id,
        guildId:      interaction.guildId,
        host:         interaction.user.id,
        hostTag:      interaction.user.tag,
        prize,
        winnerCount,
        participants: [],
        endTime,
        ended:        false,
        winners:      [],
      };

      const msg = await targetCh.send({
        content: mention !== "none" ? mention : undefined,
        embeds: [buildGiveawayEmbed(tempData, timeLeft)],
        components: [buildJoinButton(false)],
      });

      // บันทึก DB ด้วย messageId จริง
      const giveaway = { ...tempData, id: msg.id, messageId: msg.id };
      setGiveaway(msg.id, giveaway);

      await interaction.editReply({
        content:
          `✅ สร้าง Giveaway สำเร็จ!\n` +
          `🎁 รางวัล: **${prize}**\n` +
          `👑 ผู้ชนะ: **${winnerCount}** คน\n` +
          `⏰ เวลา: **${formatTimeLeft(duration)}**\n` +
          `📢 ห้อง: ${targetCh}\n` +
          `🔗 [ไปดู Giveaway](${msg.url})`,
      });
      return;
    }

    // ──────────────────────────────────────────
    //  🔄  REROLL
    // ──────────────────────────────────────────
    if (sub === "reroll") {
      const messageId  = interaction.options.getString("message_id");
      const newCount   = interaction.options.getInteger("winners");
      const giveaway   = getGiveaway(messageId);

      if (!giveaway) {
        return interaction.reply({ content: "❌ ไม่พบ Giveaway นี้", ephemeral: true });
      }
      if (!giveaway.ended) {
        return interaction.reply({ content: "❌ Giveaway ยังไม่สิ้นสุด ใช้ `/giveaway end` ก่อน", ephemeral: true });
      }
      if (giveaway.participants.length === 0) {
        return interaction.reply({ content: "❌ ไม่มีผู้เข้าร่วม สุ่มใหม่ไม่ได้", ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const count   = newCount || giveaway.winnerCount;
      const winners = pickWinners(giveaway.participants, count);

      giveaway.winners = winners;
      setGiveaway(messageId, giveaway);

      // หา message และอัปเดต
      try {
        const ch  = await interaction.guild.channels.fetch(giveaway.channelId);
        const msg = await ch.messages.fetch(messageId);
        await msg.edit({ embeds: [buildEndEmbed(giveaway, winners)], components: [buildJoinButton(true)] });

        const congrats = winners.map(id => `<@${id}>`).join(" ");
        await ch.send(`🔄 **Reroll!** ผู้ชนะใหม่: ${congrats}\n🎁 รางวัล: **${giveaway.prize}**`);
      } catch { /* message หายก็ไม่เป็นไร */ }

      await interaction.editReply({ content: `✅ Reroll สำเร็จ! ผู้ชนะใหม่ ${winners.length} คน` });
      return;
    }

    // ──────────────────────────────────────────
    //  🛑  END
    // ──────────────────────────────────────────
    if (sub === "end") {
      const messageId = interaction.options.getString("message_id");
      const giveaway  = getGiveaway(messageId);

      if (!giveaway) {
        return interaction.reply({ content: "❌ ไม่พบ Giveaway นี้", ephemeral: true });
      }
      if (giveaway.ended) {
        return interaction.reply({ content: "❌ Giveaway นี้สิ้นสุดไปแล้ว", ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      // หยุดเวลาทันที
      giveaway.endTime = Date.now();
      setGiveaway(messageId, giveaway);

      try {
        const ch  = await interaction.guild.channels.fetch(giveaway.channelId);
        const msg = await ch.messages.fetch(messageId);
        await runDrawAnimation(msg, giveaway);
      } catch (err) {
        return interaction.editReply({ content: `❌ เกิดข้อผิดพลาด: ${err.message}` });
      }

      await interaction.editReply({ content: "✅ จบ Giveaway แล้ว ประกาศผลแล้ว!" });
      return;
    }

    // ──────────────────────────────────────────
    //  ❌  CANCEL
    // ──────────────────────────────────────────
    if (sub === "cancel") {
      const messageId = interaction.options.getString("message_id");
      const giveaway  = getGiveaway(messageId);

      if (!giveaway) {
        return interaction.reply({ content: "❌ ไม่พบ Giveaway นี้", ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      // ลบ message ถ้ายังอยู่
      try {
        const ch  = await interaction.guild.channels.fetch(giveaway.channelId);
        const msg = await ch.messages.fetch(messageId);
        await msg.delete();
      } catch { /* message หายแล้ว ก็โอเค */ }

      deleteGiveaway(messageId);
      await interaction.editReply({ content: `✅ ยกเลิก Giveaway **${giveaway.prize}** แล้ว` });
      return;
    }

    // ──────────────────────────────────────────
    //  📊  LIST
    // ──────────────────────────────────────────
    if (sub === "list") {
      const all     = getAllGiveaways();
      const active  = Object.values(all).filter(g => !g.ended && g.guildId === interaction.guildId);

      if (active.length === 0) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(cfg.COLOR_WARN)
              .setTitle("📊 Giveaway ที่กำลังดำเนินอยู่")
              .setDescription("ไม่มี Giveaway ที่กำลังดำเนินอยู่ในขณะนี้")
              .setTimestamp(),
          ],
          ephemeral: true,
        });
      }

      const lines = active.map((g, i) => {
        const timeLeft = g.endTime - Date.now();
        return (
          `\`${String(i + 1).padStart(2, "0")}.\` **${g.prize}**\n` +
          `└ ⏰ เหลือ ${formatTimeLeft(timeLeft)} · 👥 ${g.participants.length} คน · ID: \`${g.messageId}\``
        );
      });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(cfg.COLOR_INFO)
            .setTitle(`📊 Giveaway ที่กำลังดำเนินอยู่ (${active.length})`)
            .setDescription(lines.join("\n\n"))
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }
  },
};