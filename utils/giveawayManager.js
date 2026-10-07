// ═══════════════════════════════════════════════════════════════
//  🎁  GIVEAWAY MANAGER  —  ระบบจัดการ Giveaway ทั้งหมด
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs");
const path = require("path");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DB_PATH = path.join(__dirname, "../data/giveaways.json");

// ══════════════════════════════════════════════
//  💾  DATABASE HELPERS
// ══════════════════════════════════════════════

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return {};
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getGiveaway(id) {
  return loadDB()[id] || null;
}

function setGiveaway(id, data) {
  const db = loadDB();
  db[id] = data;
  saveDB(db);
}

function deleteGiveaway(id) {
  const db = loadDB();
  delete db[id];
  saveDB(db);
}

function getAllGiveaways() {
  return loadDB();
}

// ══════════════════════════════════════════════
//  ⏰  TIME PARSER  ("30m", "1h", "2d")
// ══════════════════════════════════════════════

function parseTime(str) {
  const match = str.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const mul = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * mul[unit];
}

function formatTimeLeft(ms) {
  if (ms <= 0) return "หมดเวลา";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (d > 0) return `${d} วัน ${h} ชั่วโมง`;
  if (h > 0) return `${h} ชั่วโมง ${m} นาที`;
  if (m > 0) return `${m} นาที`;
  return `${s} วินาที`;
}

// ══════════════════════════════════════════════
//  🎨  EMBED BUILDERS
// ══════════════════════════════════════════════

function buildGiveawayEmbed(giveaway, timeLeft) {
  const progress = buildProgressBar(giveaway.participants.length, 20);
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🎉 GIVEAWAY")
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎁 **รางวัล**\n${giveaway.prize}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    )
    .addFields(
      { name: "👑 ผู้ชนะ",    value: `${giveaway.winnerCount} คน`,                         inline: true },
      { name: "👥 ผู้เข้าร่วม", value: `${giveaway.participants.length} คน`,                inline: true },
      { name: "⏰ เหลือเวลา", value: formatTimeLeft(timeLeft),                              inline: true },
      { name: "📊 Progress",  value: `${progress} **${giveaway.participants.length}** คน`, inline: false }
    )
    .setFooter({ text: "กดปุ่มด้านล่างเพื่อเข้าร่วม • จัดโดย " + giveaway.hostTag })
    .setTimestamp(new Date(giveaway.endTime));
}

function buildEndEmbed(giveaway, winners) {
  const winnerMentions = winners.length > 0
    ? winners.map(id => `🎉 <@${id}>`).join("\n")
    : "❌ ไม่มีผู้เข้าร่วม";

  return new EmbedBuilder()
    .setColor(winners.length > 0 ? 0x57f287 : 0xed4245)
    .setTitle("🏆 ผู้ชนะ Giveaway")
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎁 **รางวัล:** ${giveaway.prize}\n\n` +
      winnerMentions + "\n\n" +
      `━━━━━━━━━━━━━━━━━━━━`
    )
    .addFields(
      { name: "👥 ผู้เข้าร่วมทั้งหมด", value: `${giveaway.participants.length} คน`, inline: true },
      { name: "👑 จำนวนผู้ชนะ",        value: `${winners.length} คน`,               inline: true }
    )
    .setFooter({ text: "Giveaway สิ้นสุดแล้ว • จัดโดย " + giveaway.hostTag })
    .setTimestamp();
}

function buildDrawingEmbed(giveaway) {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🎲 กำลังสุ่มผู้ชนะ...")
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎁 **รางวัล:** ${giveaway.prize}\n\n` +
      `3️⃣  2️⃣  1️⃣\n\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    )
    .setFooter({ text: "กำลังสุ่ม..." })
    .setTimestamp();
}

function buildJoinButton(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("giveaway_join")
      .setLabel("🎉 เข้าร่วม")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

function buildProgressBar(current, max = 20) {
  const filled = Math.min(Math.round((current / Math.max(current, 20)) * max), max);
  return "█".repeat(filled) + "░".repeat(max - filled);
}

// ══════════════════════════════════════════════
//  🎲  DRAW WINNERS  (animation → ประกาศ)
// ══════════════════════════════════════════════

function pickWinners(participants, count) {
  const pool = [...participants];
  const winners = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  return winners;
}

async function runDrawAnimation(message, giveaway) {
  // ── Phase 1: "กำลังสุ่ม" ──
  await message.edit({
    embeds: [buildDrawingEmbed(giveaway)],
    components: [buildJoinButton(true)],
  });

  // ── Phase 2: สลับชื่อแบบ animation (ถ้ามีคนเข้า) ──
  if (giveaway.participants.length > 0) {
    const animNames = [...giveaway.participants]
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);

    for (let i = 0; i < 8; i++) {
      const shown = animNames[i % animNames.length];
      const animEmbed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("🎲 กำลังสุ่มผู้ชนะ...")
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🎁 **รางวัล:** ${giveaway.prize}\n\n` +
          `👤 <@${shown}>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━`
        )
        .setFooter({ text: "กำลังสุ่ม..." });

      await message.edit({ embeds: [animEmbed], components: [buildJoinButton(true)] });
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Phase 3: ประกาศผู้ชนะ ──
  const winners = pickWinners(giveaway.participants, giveaway.winnerCount);

  // บันทึกผู้ชนะลง DB
  giveaway.winners  = winners;
  giveaway.ended    = true;
  setGiveaway(giveaway.id, giveaway);

  await message.edit({
    embeds: [buildEndEmbed(giveaway, winners)],
    components: [buildJoinButton(true)],
  });

  // ── Phase 4: mention ผู้ชนะในช่อง ──
  if (winners.length > 0) {
    const congrats = winners.map(id => `<@${id}>`).join(" ");
    await message.channel.send(
      `🎉 **Congratulations!** ${congrats}\nคุณชนะ **${giveaway.prize}** !\n` +
      `> 📌 [คลิกดู Giveaway](${message.url})`
    );
  } else {
    await message.channel.send(`❌ Giveaway **${giveaway.prize}** สิ้นสุดแล้ว แต่ไม่มีผู้เข้าร่วม`);
  }

  return winners;
}

// ══════════════════════════════════════════════
//  ⏱️  TIMER SYSTEM  —  เช็คทุก 10 วินาที
// ══════════════════════════════════════════════

let _client = null;

async function tickGiveaways() {
  if (!_client) return;

  const db  = loadDB();
  const now = Date.now();

  for (const [id, giveaway] of Object.entries(db)) {
    if (giveaway.ended) continue;

    const timeLeft = giveaway.endTime - now;

    // ── หมดเวลา → จับรางวัล ──
    if (timeLeft <= 0) {
      try {
        const guild   = await _client.guilds.fetch(giveaway.guildId).catch(() => null);
        if (!guild) { deleteGiveaway(id); continue; }

        const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
        if (!channel) { deleteGiveaway(id); continue; }

        const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
        if (!message) {
          // message หาย → บันทึก ended ไว้เฉยๆ
          giveaway.ended = true;
          setGiveaway(id, giveaway);
          continue;
        }

        await runDrawAnimation(message, giveaway);
      } catch (err) {
        console.error(`[GIVEAWAY] ❌ tick error (${id}):`, err.message);
      }
      continue;
    }

    // ── อัปเดต embed เหลือเวลา (ทุก 30 วินาที หรือ ถ้าเหลือน้อยกว่า 1 นาที ทุก 10 วินาที) ──
    const shouldUpdate = timeLeft < 60_000 || timeLeft % 30_000 < 12_000;
    if (!shouldUpdate) continue;

    try {
      const guild   = await _client.guilds.fetch(giveaway.guildId).catch(() => null);
      if (!guild) continue;
      const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
      if (!channel) continue;
      const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      if (!message) continue;

      await message.edit({
        embeds: [buildGiveawayEmbed(giveaway, timeLeft)],
        components: [buildJoinButton(false)],
      });
    } catch { /* ข้าม */ }
  }
}

function startGiveawayTimer(client) {
  _client = client;
  setInterval(tickGiveaways, 10_000);
  console.log("[GIVEAWAY] ✅ Timer เริ่มทำงานแล้ว (ทุก 10 วินาที)");
}

// ══════════════════════════════════════════════
//  🎮  BUTTON HANDLER  (เข้าร่วม)
// ══════════════════════════════════════════════

async function handleGiveawayButton(interaction) {
  if (interaction.customId !== "giveaway_join") return false;

  await interaction.deferReply({ ephemeral: true });

  // ห้าม bot
  if (interaction.user.bot) {
    await interaction.editReply({ content: "❌ Bot เข้าร่วมไม่ได้" });
    return true;
  }

  const messageId = interaction.message.id;
  const giveaway  = getGiveaway(messageId);

  if (!giveaway) {
    await interaction.editReply({ content: "❌ ไม่พบ Giveaway นี้แล้ว" });
    return true;
  }

  if (giveaway.ended) {
    await interaction.editReply({ content: "❌ Giveaway นี้สิ้นสุดแล้ว" });
    return true;
  }

  if (Date.now() > giveaway.endTime) {
    await interaction.editReply({ content: "❌ Giveaway หมดเวลาแล้ว" });
    return true;
  }

  const userId = interaction.user.id;

  // กดซ้ำ
  if (giveaway.participants.includes(userId)) {
    await interaction.editReply({ content: "❌ คุณเข้าร่วมไปแล้ว" });
    return true;
  }

  // เพิ่มผู้เข้าร่วม
  giveaway.participants.push(userId);
  setGiveaway(messageId, giveaway);

  // อัปเดต embed
  const timeLeft = giveaway.endTime - Date.now();
  await interaction.message.edit({
    embeds: [buildGiveawayEmbed(giveaway, timeLeft)],
    components: [buildJoinButton(false)],
  });

  await interaction.editReply({ content: "✅ เข้าร่วมกิจกรรมแล้ว!" });
  return true;
}

// ══════════════════════════════════════════════
//  📤  EXPORTS
// ══════════════════════════════════════════════

module.exports = {
  parseTime,
  formatTimeLeft,
  buildGiveawayEmbed,
  buildEndEmbed,
  buildJoinButton,
  buildProgressBar,
  runDrawAnimation,
  pickWinners,
  startGiveawayTimer,
  handleGiveawayButton,
  getGiveaway,
  setGiveaway,
  deleteGiveaway,
  getAllGiveaways,
};