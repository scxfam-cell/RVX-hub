// ═══════════════════════════════════════════════════════════════
//  📝  UPLOADER LABEL STORE
//  เก็บ "ชื่อผู้อัพเพลง" ที่แอดมินตั้งเอง แยกต่างหากจาก database.js เดิม
//  ไฟล์ข้อมูล: data/uploaders.json  รูปแบบ { "<songId>": "<ชื่อ>" }
// ═══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "uploaders.json");

function load() {
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

// ดึงชื่อผู้อัพของเพลง ID นี้ (คืน null ถ้ายังไม่ได้ตั้ง)
function get(songId) {
  const data = load();
  return data[songId] || null;
}

// ตั้ง/แก้ชื่อผู้อัพของเพลง ID นี้
function set(songId, name) {
  const data = load();
  data[songId] = name;
  save(data);
  return data[songId];
}

// ลบชื่อผู้อัพของเพลง ID นี้ (กลับไปเป็นค่าว่าง)
function clear(songId) {
  const data = load();
  if (songId in data) {
    delete data[songId];
    save(data);
    return true;
  }
  return false;
}

// คืนทั้งหมด { songId: name }
function getAll() {
  return load();
}

module.exports = { get, set, clear, getAll };
