// ═══════════════════════════════════════════════════════════════
//  🎁  COIN DROP MANAGER  —  ระบบแจกเหรียญด้วยปุ่ม (เฉพาะคนออนห้องเสียง)
//  คำสั่ง:   !แจก <เหรียญ/คน> [จำนวนคนสูงสุด] [เวลาหมดอายุ] [นาทีที่ต้องออนห้องเสียง]
//  ปิดก่อนเวลา: !แจกปิด
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs");
const path = require("path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require("discord.js");

const db  = require("./checkinDB"); // ✏️ PATCH: เดิม require("./database") ซึ่งไม่มี addCoins ทำให้กดรับเหรียญแล้ว error เหรียญไม่เข้า — เหรียญจริงอยู่ใน checkinDB.js
const cfg = require("../config");
const { parseTime } = require("./giveawayManager"); // reuse parser "30m"/"1h"/"2d"

const DB_PATH = path.join(__dirname, "../data/coindrops.json");
const DEFAULT_REQUIRE_MINUTES =
  parseInt(process.env.COINDROP_REQUIRE_MINUTES, 10) || cfg.VOICE_REWARD_MINUTES || 10;

const STICKY_MIN_INTERVAL_MS = 2000; // กันรีโพสต์ถี่เกินไปตอนแชทไว (rate-limit)
const lastRepostAt = {}; // channelId -> timestamp ล่าสุดที่รีโพสต์

// ══════════════════════════════════════════════
//  💾  DATABASE (JSON file — เก็บแยกจากเงินหลัก แค่เก็บสถานะการแจก)
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

function getDrop(id) {
  return loadDB()[id] || null;
}

function setDrop(id, data) {
  const all = loadDB();
  all[id] = data;
  saveDB(all);
}

function findActiveDropInChannel(channelId) {
  const all = loadDB();
  return Object.values(all).find((d) => !d.ended && d.channelId === channelId) || null;
}

function makeDropId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ══════════════════════════════════════════════
//  🎧  VOICE JOIN TIME TRACKER
//  เก็บ "เวลาที่เข้าห้องเสียงล่าสุด" ต่อคน → เอาไว้คำนวณว่าออนมานานกี่นาทีแล้ว
//  (ย้ายห้องเสียงไปมา ไม่รีเซ็ตเวลา นับต่อเนื่อง — จะรีเซ็ตก็ต่อเมื่อออกจากห้องเสียงไปเลย)
// ══════════════════════════════════════════════
const voiceJoinTimes = new Map(); // key: "guildId:userId" -> timestamp (ms)

function trackVoiceJoin(oldState, newState) {
  const key = `${newState.guild.id}:${newState.id}`;
  const wasInVoice = !!oldState.channelId;
  const isInVoice  = !!newState.channelId;

  if (!wasInVoice && isInVoice) {
    voiceJoinTimes.set(key, Date.now());
  } else if (wasInVoice && !isInVoice) {
    voiceJoinTimes.delete(key);
  }
}

// เรียกตอนบอทบูต — คนที่ค้างอยู่ในห้องเสียงอยู่แล้ว จะเริ่มนับเวลาใหม่ตอนนี้
// (ข้อจำกัด: ถ้าบอท restart คนที่ออนอยู่ก่อนหน้าจะถูกนับเวลาใหม่ตั้งแต่ตอนบูต ไม่ใช่ตอนที่เขาเข้าจริง)
function initVoiceJoinTimes(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const [, channel] of guild.channels.cache) {
      if (!channel.isVoiceBased?.()) continue;
      for (const [memberId] of channel.members) {
        const key = `${guild.id}:${memberId}`;
        if (!voiceJoinTimes.has(key)) voiceJoinTimes.set(key, Date.now());
      }
    }
  }
}

function getVoiceMinutes(guildId, userId) {
  const joinedAt = voiceJoinTimes.get(`${guildId}:${userId}`);
  if (!joinedAt) return 0;
  return (Date.now() - joinedAt) / 60000;
}

// ══════════════════════════════════════════════
//  🎨  BUTTON BUILDER — ปุ่มล้วนๆ ไม่มี embed/กรอบ
// ══════════════════════════════════════════════
function buildButtonRow(drop, disabled = false) {
  const amt = drop.amountPerPerson.toLocaleString("th-TH");
  let label = drop.ended ? `🚫 หมดแล้ว — ${amt} เหรียญ` : `🎁 รับ ${amt} เหรียญ`;

  if (!drop.ended && drop.maxClaims) {
    const remain = Math.max(drop.maxClaims - drop.claimed.length, 0);
    label += ` (เหลือ ${remain}/${drop.maxClaims})`;
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`coindrop_claim_${drop.id}`)
      .setLabel(label.slice(0, 80))
      .setStyle(drop.ended ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(disabled || drop.ended)
  );
}

// ══════════════════════════════════════════════
//  📨  !แจก  /  !แจกปิด  —  คำสั่งแอดมิน (prefix, เหมือน !buyrole)
// ══════════════════════════════════════════════
async function handleMessage(message) {
  const content = message.content.trim();

  // ─── !แจกปิด — ปิดการแจกในห้องนี้ก่อนเวลา ───
  if (content === "!แจกปิด") {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.reply("❌ คำสั่งนี้ใช้ได้เฉพาะ Admin เท่านั้น").catch(() => {});
      return true;
    }
    await message.delete().catch(() => {});

    const drop = findActiveDropInChannel(message.channelId);
    if (!drop) {
      const warn = await message.channel.send("⚠️ ไม่มีการแจกเหรียญที่กำลังทำงานอยู่ในห้องนี้");
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      return true;
    }

    drop.ended = true;
    setDrop(drop.id, drop);

    const oldMsg = await message.channel.messages.fetch(drop.messageId).catch(() => null);
    if (oldMsg) await oldMsg.edit({ components: [buildButtonRow(drop, true)] }).catch(() => {});
    return true;
  }

  if (!content.startsWith("!แจก")) return false;
  if (content.startsWith("!แจกปิด")) return false; // กันชนกับบล็อกบน

  // ─── !แจก <เหรียญ> [จำนวนคน] [เวลา] [นาทีรอ] ───
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await message.reply("❌ คำสั่งนี้ใช้ได้เฉพาะ Admin เท่านั้น").catch(() => {});
    return true;
  }

  const args   = content.split(/\s+/).slice(1);
  const amount = parseInt(args[0], 10);

  if (!args[0] || isNaN(amount) || amount <= 0) {
    await message.reply(
      "📌 **วิธีใช้:** `!แจก <เหรียญ/คน> [จำนวนคนสูงสุด] [เวลาหมดอายุ] [นาทีที่ต้องออนห้องเสียง]`\n" +
      "ตัวอย่าง:\n" +
      "`!แจก 100000` → คนละ 100,000 เหรียญ ไม่จำกัดคน ไม่หมดเวลา (ต้องออนห้องเสียง 10 นาทีตามดีฟอลต์)\n" +
      "`!แจก 500 50` → คนละ 500 เหรียญ จำกัด 50 คนแรก ไม่หมดเวลา\n" +
      "`!แจก 500 50 30m` → เหมือนบน แต่หมดเวลาใน 30 นาที\n" +
      "`!แจก 500 50 30m 15` → เหมือนบน แต่ต้องออนห้องเสียงมาแล้ว 15 นาทีถึงกดรับได้\n" +
      "ปิดก่อนเวลา: `!แจกปิด`"
    ).catch(() => {});
    return true;
  }

  let maxClaims = null;
  let endTime = null;
  let requireMinutes = DEFAULT_REQUIRE_MINUTES;

  let idx = 1;
  if (args[idx] && /^\d+$/.test(args[idx])) {
    const n = parseInt(args[idx], 10);
    maxClaims = n > 0 ? n : null;
    idx++;
  }
  if (args[idx]) {
    const ms = parseTime(args[idx]);
    if (ms) {
      endTime = Date.now() + ms;
      idx++;
    }
  }
  if (args[idx] && /^\d+$/.test(args[idx])) {
    requireMinutes = Math.max(0, parseInt(args[idx], 10));
  }

  // ห้ามแจกซ้อนกันในห้องเดียวกัน กันสับสน
  if (findActiveDropInChannel(message.channelId)) {
    await message.reply("⚠️ ห้องนี้มีการแจกเหรียญที่ยังไม่จบอยู่แล้ว พิมพ์ `!แจกปิด` ก่อนถ้าจะเปิดใหม่").catch(() => {});
    return true;
  }

  await message.delete().catch(() => {});

  const drop = {
    id: makeDropId(),
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: null,
    hostId: message.author.id,
    hostTag: message.author.tag,
    amountPerPerson: amount,
    maxClaims,
    endTime,
    requireMinutes,
    claimed: [],
    ended: false,
    createdAt: Date.now(),
  };

  const sent = await message.channel.send({ components: [buildButtonRow(drop, false)] });
  drop.messageId = sent.id;
  setDrop(drop.id, drop);

  return true;
}

// ══════════════════════════════════════════════
//  📌  STICKY REPOST — ปุ่มอยู่ล่างสุดตลอด (มีคนพิมพ์ → ลบปุ่มเก่า สร้างใหม่)
// ══════════════════════════════════════════════
async function handleStickyRepost(message) {
  if (message.author?.bot) return;

  const drop = findActiveDropInChannel(message.channelId);
  if (!drop) return;

  // หมดเวลาแล้ว → ปิดแทนที่จะรีโพสต์
  if (drop.endTime && Date.now() > drop.endTime) {
    drop.ended = true;
    setDrop(drop.id, drop);
    const oldMsg = await message.channel.messages.fetch(drop.messageId).catch(() => null);
    if (oldMsg) await oldMsg.edit({ components: [buildButtonRow(drop, true)] }).catch(() => {});
    return;
  }

  const now = Date.now();
  if (lastRepostAt[message.channelId] && now - lastRepostAt[message.channelId] < STICKY_MIN_INTERVAL_MS) return;
  lastRepostAt[message.channelId] = now;

  const oldMsg = await message.channel.messages.fetch(drop.messageId).catch(() => null);
  if (oldMsg) await oldMsg.delete().catch(() => {});

  const sent = await message.channel.send({ components: [buildButtonRow(drop, false)] }).catch(() => null);
  if (sent) {
    drop.messageId = sent.id;
    setDrop(drop.id, drop);
  }
}

// ══════════════════════════════════════════════
//  🎮  BUTTON HANDLER — กดรับเหรียญ
// ══════════════════════════════════════════════
async function handleButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("coindrop_claim_")) return false;

  const dropId = interaction.customId.replace("coindrop_claim_", "");
  const drop = getDrop(dropId);

  await interaction.deferReply({ ephemeral: true });

  if (!drop) {
    await interaction.editReply("❌ ไม่พบการแจกเหรียญนี้แล้ว");
    return true;
  }
  if (drop.ended) {
    await interaction.editReply("❌ การแจกเหรียญนี้จบแล้ว");
    return true;
  }
  if (drop.endTime && Date.now() > drop.endTime) {
    drop.ended = true;
    setDrop(dropId, drop);
    await interaction.message.edit({ components: [buildButtonRow(drop, true)] }).catch(() => {});
    await interaction.editReply("❌ หมดเวลาแจกแล้ว");
    return true;
  }
  if (drop.maxClaims && drop.claimed.length >= drop.maxClaims) {
    drop.ended = true;
    setDrop(dropId, drop);
    await interaction.message.edit({ components: [buildButtonRow(drop, true)] }).catch(() => {});
    await interaction.editReply("❌ เหรียญหมดแล้ว");
    return true;
  }
  if (drop.claimed.includes(interaction.user.id)) {
    await interaction.editReply("⚠️ คุณรับไปแล้ว รับซ้ำไม่ได้");
    return true;
  }

  // ── เช็คห้องเสียง ──
  const voiceChannelId = interaction.member?.voice?.channelId;
  if (!voiceChannelId) {
    await interaction.editReply(
      `❌ กรุณาเข้าห้องเสียงก่อน แล้วรออย่างน้อย **${drop.requireMinutes} นาที** ถึงจะกดรับได้`
    );
    return true;
  }

  const minutesIn = getVoiceMinutes(interaction.guildId, interaction.user.id);
  if (minutesIn < drop.requireMinutes) {
    const remain = Math.ceil(drop.requireMinutes - minutesIn);
    await interaction.editReply(
      `⏳ คุณอยู่ห้องเสียงมาแล้ว **${Math.floor(minutesIn)} นาที** ต้องรออีก **${remain} นาที** ถึงจะกดรับได้`
    );
    return true;
  }

  // ── ผ่านเงื่อนไขทั้งหมด → จ่ายเหรียญเข้าระบบเดิม (เว็บเห็นด้วยทันที) ──
  drop.claimed.push(interaction.user.id);
  const isFull = drop.maxClaims && drop.claimed.length >= drop.maxClaims;
  if (isFull) drop.ended = true;
  setDrop(dropId, drop);

  const { coins } = db.addCoins(interaction.user.id, drop.amountPerPerson);

  await interaction.message.edit({ components: [buildButtonRow(drop, isFull)] }).catch(() => {});

  await interaction.editReply(
    `✅ รับไปแล้ว **${drop.amountPerPerson.toLocaleString("th-TH")} เหรียญ**! (คงเหลือทั้งหมด ${coins.toLocaleString("th-TH")} เหรียญ)`
  );
  return true;
}

// ══════════════════════════════════════════════
//  ⏱️  EXPIRY CHECKER — ปิดปุ่มอัตโนมัติเมื่อหมดเวลา แม้ไม่มีใครพิมพ์/กด
// ══════════════════════════════════════════════
function startExpiryChecker(client) {
  setInterval(async () => {
    const all = loadDB();
    const now = Date.now();

    for (const drop of Object.values(all)) {
      if (drop.ended || !drop.endTime || now < drop.endTime) continue;
      drop.ended = true;
      setDrop(drop.id, drop);

      try {
        const channel = await client.channels.fetch(drop.channelId).catch(() => null);
        const msg = channel && (await channel.messages.fetch(drop.messageId).catch(() => null));
        if (msg) await msg.edit({ components: [buildButtonRow(drop, true)] }).catch(() => {});
      } catch {}
    }
  }, 15_000);
}

// ══════════════════════════════════════════════
//  📤  EXPORTS
// ══════════════════════════════════════════════
module.exports = {
  handleMessage,
  handleStickyRepost,
  handleButton,
  trackVoiceJoin,
  initVoiceJoinTimes,
  startExpiryChecker,
};