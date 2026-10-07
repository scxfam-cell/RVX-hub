// ═══════════════════════════════════════════════════════════════
//  🛠️  HELPERS  —  Parser, Cooldown, Embed utils
// ═══════════════════════════════════════════════════════════════
const { EmbedBuilder } = require("discord.js");
const cfg = require("../config");

// ── Pattern ตรวจจับไอดีเพลง ──────────────────────────────────
//  รูปแบบ: ตัวเลข 10+ หลัก ตามด้วยช่องว่าง แล้วต้องมี "ชื่อเพลง" ต่อท้าย (บังคับ ไม่ optional แล้ว)
//  ถ้าใส่แค่ไอดีเฉยๆ ไม่มีชื่อ → ไม่ match → ถือเป็น invalid
const SONG_LINE_RE = /^\d{10,}\s+\S.*$/;

/**
 * แยก content ออกเป็น valid (ไอดีเพลง+ชื่อ) กับ invalid (ข้อความอื่น/ไอดีที่ไม่มีชื่อ)
 * @returns {{ valid: {id,name,raw}[], invalid: string[] }}
 */
function parseSongMessage(content) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const valid   = [];
  const invalid = [];

  for (const line of lines) {
    if (SONG_LINE_RE.test(line)) {
      const sp   = line.search(/\s/);
      const id   = line.slice(0, sp);
      const name = line.slice(sp + 1).trim();
      valid.push({ id, name, raw: line });
    } else {
      invalid.push(line);
    }
  }

  return { valid, invalid };
}

// ── Cooldown Map ─────────────────────────────────────────────
const cooldownMap = new Map();

function checkCooldown(userId) {
  const now      = Date.now();
  const last     = cooldownMap.get(userId) || 0;
  const elapsed  = now - last;
  const limit    = cfg.COOLDOWN_SECONDS * 1000;

  if (elapsed < limit) {
    return { onCooldown: true, remaining: Math.ceil((limit - elapsed) / 1000) };
  }
  cooldownMap.set(userId, now);
  return { onCooldown: false, remaining: 0 };
}

// ── Role Check ───────────────────────────────────────────────
function hasBypassRole(member) {
  if (!member || !cfg.BYPASS_ROLE_IDS.length) return false;
  return cfg.BYPASS_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function hasModRole(member) {
  if (!member) return false;
  if (member.permissions.has(0x8n)) return true; // ADMINISTRATOR
  return cfg.MOD_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

// ── Safe DM ──────────────────────────────────────────────────
async function safeDM(user, payload) {
  try { await user.send(payload); } catch { /* DM ปิด */ }
}

// ── Send Log ─────────────────────────────────────────────────
async function sendLog(client, embed) {
  if (!cfg.LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(cfg.LOG_CHANNEL_ID);
    if (ch?.isTextBased()) await ch.send({ embeds: [embed] });
  } catch { /* log channel ไม่มี */ }
}

// ── Temp Reply (ลบเองอัตโนมัติ) ─────────────────────────────
async function tempReply(channel, payload, ms = cfg.EMBED_TIMEOUT_MS) {
  const msg = await channel.send(payload).catch(() => null);
  if (msg) setTimeout(() => msg.delete().catch(() => {}), ms);
  return msg;
}

// ── Pagination helper ────────────────────────────────────────
function paginate(arr, page, size = 10) {
  const total = Math.ceil(arr.length / size);
  const items = arr.slice((page - 1) * size, page * size);
  return { items, total, page, size };
}

// ── สร้าง Embed มาตรฐาน ────────────────────────────────────
function makeEmbed(color, title, description) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description || null)
    .setFooter({ text: "🎵 Song-ID Guardian" })
    .setTimestamp();
}

module.exports = {
  parseSongMessage,
  checkCooldown,
  hasBypassRole,
  hasModRole,
  safeDM,
  sendLog,
  tempReply,
  paginate,
  makeEmbed,
};