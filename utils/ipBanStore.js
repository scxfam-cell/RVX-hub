// ═══════════════════════════════════════════════════════════════
//  🚫  IP BAN STORE — เก็บรายชื่อ IP ที่ถูกแบนไม่ให้เข้าเว็บ
//  เก็บลงไฟล์ JSON ตรงๆ (แพทเทิร์นเดียวกับ uploaderStore / commentStore
//  / apiKeyStore ที่มีอยู่แล้วในโปรเจกต์ ไม่ต้องพึ่ง database หลัก)
// ═══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

const DATA_DIR  = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "ip-bans.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}", "utf8");
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {}; // ไฟล์พังหรือว่าง — เริ่มใหม่แทนที่จะทำให้เว็บทั้งเว็บล่ม
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// normalize ตัด prefix ::ffff: (IPv4-mapped IPv6) ออก กัน IP เดียวกันโดนเก็บสองรูปแบบ
function normalizeIp(ip) {
  let v = String(ip || "").trim();
  if (v.startsWith("::ffff:")) v = v.slice(7);
  return v;
}

/** คืน record การแบน ถ้า ip นี้ถูกแบนอยู่ ไม่งั้นคืน null */
function isBanned(ip) {
  const data = readAll();
  return data[normalizeIp(ip)] || null;
}

/** แบน ip — reason/bannedBy ไว้บันทึกไว้ดูย้อนหลังว่าใครแบนเพราะอะไร */
function banIp(ip, { reason = "", bannedBy = "" } = {}) {
  const data = readAll();
  const key  = normalizeIp(ip);
  if (!key) return { success: false, error: "IP ไม่ถูกต้อง" };
  data[key] = { ip: key, reason: reason || "ไม่ระบุเหตุผล", bannedBy, bannedAt: new Date().toISOString() };
  writeAll(data);
  return { success: true, record: data[key] };
}

/** ปลดแบน ip — คืน true ถ้ามีอยู่จริงแล้วลบสำเร็จ, false ถ้าไม่เคยแบนไว้ */
function unbanIp(ip) {
  const data = readAll();
  const key  = normalizeIp(ip);
  if (!data[key]) return false;
  delete data[key];
  writeAll(data);
  return true;
}

/** รายการ IP ที่โดนแบนทั้งหมด เรียงจากแบนล่าสุดก่อน */
function listBans() {
  const data = readAll();
  return Object.values(data).sort((a, b) => new Date(b.bannedAt) - new Date(a.bannedAt));
}

module.exports = { isBanned, banIp, unbanIp, listBans, normalizeIp };
