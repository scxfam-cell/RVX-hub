// ═══════════════════════════════════════════════════════════════
//  📺  SONG CHANNELS  —  จัดการรายชื่อห้องรับไอดีเพลงแบบไดนามิก
//  แอดมินตั้ง/ลบห้องได้ด้วยคำสั่ง /songchannel โดยไม่ต้อง restart บอท
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs");
const path = require("path");
const cfg  = require("../config");

const FILE_PATH = path.join(__dirname, "..", "data", "songChannels.json");

// ── โหลดไฟล์ (สร้างใหม่อัตโนมัติถ้ายังไม่มี) ──────────────────
function load() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      // ครั้งแรก: seed ด้วยห้องเดิมจาก .env (SONG_CHANNEL_ID) ถ้ามี
      const seed = cfg.SONG_CHANNEL_ID ? [cfg.SONG_CHANNEL_ID] : [];
      save(seed);
      return seed;
    }
    const raw = fs.readFileSync(FILE_PATH, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error("[songChannels] โหลดไฟล์ล้มเหลว:", err.message);
    return cfg.SONG_CHANNEL_ID ? [cfg.SONG_CHANNEL_ID] : [];
  }
}

// ── บันทึกไฟล์ ────────────────────────────────────────────────
function save(arr) {
  try {
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(arr, null, 2), "utf8");
  } catch (err) {
    console.error("[songChannels] บันทึกไฟล์ล้มเหลว:", err.message);
  }
}

let channels = load();

// ── API ──────────────────────────────────────────────────────
function getAll() {
  return [...channels];
}

function isSongChannel(channelId) {
  return channels.includes(channelId);
}

function addChannel(channelId) {
  if (channels.includes(channelId)) return false;
  channels.push(channelId);
  save(channels);
  return true;
}

function removeChannel(channelId) {
  if (!channels.includes(channelId)) return false;
  channels = channels.filter((id) => id !== channelId);
  save(channels);
  return true;
}

module.exports = { getAll, isSongChannel, addChannel, removeChannel };
