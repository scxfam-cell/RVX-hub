// ═══════════════════════════════════════════════════════════════
//   ⚙️  CONFIG  —  อ่านค่าจาก .env อัตโนมัติ
//   แก้ไขที่ไฟล์ .env เท่านั้น ไม่ต้องแตะไฟล์นี้
// ═══════════════════════════════════════════════════════════════
require("dotenv").config();
// ── helper แปลง string → array (comma-separated) ──────────────
const toArr = (val) =>
  val ? val.split(",").map((s) => s.trim()).filter(Boolean) : [];
// ── helper แปลง string → boolean ─────────────────────────────
const toBool = (val, fallback = false) =>
  val === undefined ? fallback : val.toLowerCase() === "true";
module.exports = {
  // ─── Discord ───────────────────────────────────────────────
  TOKEN:           process.env.TOKEN           || "",
  CLIENT_ID:       process.env.CLIENT_ID       || "",
  GUILD_ID:        process.env.GUILD_ID        || "", // 👈 บอทจะดึงค่า ID เซิร์ฟเวอร์จากไฟล์ .env ตรงนี้
  SONG_CHANNEL_ID: process.env.SONG_CHANNEL_ID || "",
  LOG_CHANNEL_ID:  process.env.LOG_CHANNEL_ID  || null,
  BYPASS_ROLE_IDS: toArr(process.env.BYPASS_ROLE_IDS),  // "id1,id2,id3"
  MOD_ROLE_IDS:    toArr(process.env.MOD_ROLE_IDS),
  // ─── Rules ─────────────────────────────────────────────────
  COOLDOWN_SECONDS:      parseInt(process.env.COOLDOWN_SECONDS      || "5",     10),
  MAX_SONGS_PER_MESSAGE: parseInt(process.env.MAX_SONGS_PER_MESSAGE || "50",    10),
  EMBED_TIMEOUT_MS:      parseInt(process.env.EMBED_TIMEOUT_MS      || "12000", 10),
  // ─── Database ──────────────────────────────────────────────
  DB_PATH: process.env.DB_PATH || "./data/songs.json",
  // ─── Web Dashboard ─────────────────────────────────────────
  DASHBOARD_PORT:    parseInt(process.env.DASHBOARD_PORT || "3000", 10),
  DASHBOARD_ENABLED: toBool(process.env.DASHBOARD_ENABLED, false),  // ปิดไว้ก่อน (hosting ส่วนใหญ่ไม่เปิด port)
  // ─── Discord OAuth ──────────────────────────────────────────
  DISCORD_CLIENT_ID:
    process.env.DISCORD_CLIENT_ID || "",

  DISCORD_CLIENT_SECRET:
    process.env.DISCORD_CLIENT_SECRET || "",

  SESSION_SECRET:
    process.env.SESSION_SECRET || "songguardian_session",

  // ─── 🧧 Donate System (TrueMoney) ───────────────────────────
  DONATE_PHONE:             process.env.DONATE_PHONE             || "",
  DONATE_LOG_CHANNEL_ID:    process.env.DONATE_LOG_CHANNEL_ID     || null,
  DONATE_ROLE_ID:           process.env.DONATE_ROLE_ID            || null,
  DONATE_MIN_AMOUNT:        parseInt(process.env.DONATE_MIN_AMOUNT || "0", 10),
  DONATE_NOTIFY_CHANNEL_ID: process.env.DONATE_NOTIFY_CHANNEL_ID  || null,
  DONATE_BANNER_URL:        process.env.DONATE_BANNER_URL         || "",
  DONATE_THUMBNAIL_URL:     process.env.DONATE_THUMBNAIL_URL      || "",
  COLOR_DONATE:             0xff6b6b,

  // ─── 🎧 Voice Reward System (ออนห้องเสียงได้เหรียญ) ───────────
  VOICE_REWARD_CHANNEL_ID: process.env.VOICE_REWARD_CHANNEL_ID || null, // ห้องแจ้งเตือนตอนได้เหรียญ (ว่างไว้ = ไม่แจ้งเตือน)
  VOICE_REWARD_MINUTES:    parseInt(process.env.VOICE_REWARD_MINUTES || "10", 10), // อยู่กี่นาทีถึงได้เหรียญ 1 ครั้ง
  VOICE_REWARD_COINS:      parseInt(process.env.VOICE_REWARD_COINS   || "1",  10), // ได้กี่เหรียญต่อครั้ง

  // ─── Colors (hex) ──────────────────────────────────────────
  COLOR_SUCCESS: 0x57f287,
  COLOR_ERROR:   0xed4245,
  COLOR_INFO:    0x5865f2,
  COLOR_WARN:    0xfee75c,
  COLOR_LOG:     0xeb459e,
};
