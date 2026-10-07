// ═══════════════════════════════════════════════════════════════
//  🛡️  AUTOMOD STORE  —  เก็บคอนฟิกทุกระบบ automod แบบถาวร
//  รีบอทแล้วไม่ต้องตั้งใหม่ (persist เป็นไฟล์ data/automod.json)
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "..", "..", "data", "automod.json");

function defaultGuildConfig() {
  return {
    logChannelId: null,
    strikeConfig: { timeoutAt: 3, kickAt: 5, banAt: 7, timeoutMinutes: 10 },
    strikes: {}, // userId -> จำนวนครั้งที่ทำผิดสะสม

    systems: {
      antispam: {
        enabled: true, messageLimit: 5, intervalSeconds: 6,
        exemptChannels: [], exemptUsers: [],
      },
      antilink: {
        enabled: true, defaultLevel: 1, // 0=ปิด 1=กันคำเชิญ 2=+ลิงก์ไวรัส 3=กันทุกลิงก์
        channelLevels: {}, // channelId -> level (override ค่า default)
        exemptChannels: [], exemptUsers: [],
      },
      antiemoji: {
        enabled: true, limit: 8,
        exemptChannels: [], exemptUsers: [],
      },
      antiimage: {
        enabled: true, imageLimit: 5, intervalSeconds: 10,
        exemptChannels: [], exemptUsers: [],
      },
      antibotinvite: {
        enabled: true,
        exemptUsers: [], // แอดมินที่เชิญบอทได้อิสระ + บอทที่อนุญาตไว้ล่วงหน้า
      },
    },
  };
}

function load() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      save({});
      return {};
    }
    return JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));
  } catch (err) {
    console.error("[automod/store] โหลดไฟล์ล้มเหลว:", err.message);
    return {};
  }
}

function save(d) {
  try {
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(d, null, 2), "utf8");
  } catch (err) {
    console.error("[automod/store] บันทึกไฟล์ล้มเหลว:", err.message);
  }
}

let data = load();

// ── คืนคอนฟิกของเซิร์ฟเวอร์นั้น ๆ (สร้างค่าเริ่มต้นให้ถ้ายังไม่มี) ──
function getGuildConfig(guildId) {
  if (!data[guildId]) {
    data[guildId] = defaultGuildConfig();
    save(data);
  }
  return data[guildId];
}

// ── เรียกทุกครั้งหลังแก้ค่าใน object ที่ได้จาก getGuildConfig ──
function persist() {
  save(data);
}

module.exports = { getGuildConfig, save: persist };
