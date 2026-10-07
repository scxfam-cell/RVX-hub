// ═══════════════════════════════════════════════════════════════
//  🚫  USER BAN STORE — แบนผู้ใช้ตาม Discord ID โดยตรง
//  ต่างจาก ipBanStore ตรงที่ผูกกับบัญชี Discord ไม่ใช่เครื่อง/เครือข่าย
//  ผู้ใช้ที่โดนแบนจะเข้าเว็บไม่ได้ทันทีที่ login ด้วยบัญชีนั้น ไม่ว่าจะสลับ
//  IP/อุปกรณ์ไปกี่รอบก็ตาม (ตราบใดที่ยัง login บัญชีเดิม)
// ═══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

const DATA_DIR  = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "user-bans.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}", "utf8");
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

/** คืน record การแบน ถ้า userId นี้ถูกแบนอยู่ ไม่งั้นคืน null */
function isBanned(userId) {
  const data = readAll();
  return data[String(userId || "")] || null;
}

/** แบน userId — username ไว้โชว์ในตารางแอดมินเฉยๆ ไม่กระทบ logic */
function banUser(userId, { username = "", reason = "", bannedBy = "" } = {}) {
  const data = readAll();
  const key  = String(userId || "").trim();
  if (!key) return { success: false, error: "Discord ID ไม่ถูกต้อง" };
  data[key] = { userId: key, username, reason: reason || "ไม่ระบุเหตุผล", bannedBy, bannedAt: new Date().toISOString() };
  writeAll(data);
  return { success: true, record: data[key] };
}

function unbanUser(userId) {
  const data = readAll();
  const key  = String(userId || "");
  if (!data[key]) return false;
  delete data[key];
  writeAll(data);
  return true;
}

function listBans() {
  const data = readAll();
  return Object.values(data).sort((a, b) => new Date(b.bannedAt) - new Date(a.bannedAt));
}

module.exports = { isBanned, banUser, unbanUser, listBans };
