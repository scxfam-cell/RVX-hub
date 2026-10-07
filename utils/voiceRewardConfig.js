// ═══════════════════════════════════════════════════════════════
//  💾  VOICE REWARD CONFIG — ตั้งค่าระบบเหรียญห้องเสียง (JSON file)
//  แก้ไขได้ผ่านคำสั่ง /voicereward ในดิสคอร์ด ไม่ต้องแตะ .env
// ═══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");
const cfg  = require("../config");

const DATA_DIR  = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "voiceReward.json");

function defaultConfig() {
  return {
    enabled:   true,
    channelId: cfg.VOICE_REWARD_CHANNEL_ID || null,
    minutes:   cfg.VOICE_REWARD_MINUTES    || 10,
    coins:     cfg.VOICE_REWARD_COINS      || 1,
  };
}

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultConfig(), null, 2));
  }
}

function getConfig() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultConfig();
  }
}

function saveConfig(partial) {
  const updated = { ...getConfig(), ...partial };
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

module.exports = { getConfig, saveConfig };
