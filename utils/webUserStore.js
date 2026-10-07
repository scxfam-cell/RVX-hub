// ══════════════════════════════════════════════════════════════
//  👤  WEB USER STORE — จำโปรไฟล์คนที่เคย Login เข้าเว็บด้วย Discord
//  ใช้จับคู่ "ชื่อคนอัพเพลง" (เก็บเป็นข้อความจากบอท) กับคนที่เคย
//  ล็อกอินเข้าเว็บ เพื่อโชว์รูปโปรไฟล์จริงในลีดเดอร์บอร์ด "คนส่งสูงสุด"
//
//  หมายเหตุ: จับคู่ด้วย "username" (ตัวเล็กทั้งหมด) เพราะ Discord
//  ยุคใหม่ไม่มี #0000 ต่อท้ายแล้ว username จึงไม่ซ้ำกันในระบบ
//  ถ้าชื่อที่บอทบันทึกไว้ไม่ตรงกับ username จริงของคนนั้น (เช่น
//  บอทบันทึกเป็น "ชื่อเล่นในดิสคอร์ด/nickname" แทน) จะจับคู่ไม่ได้
// ══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "web-users.json");

function loadAll() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const raw = fs.readFileSync(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // เงียบไว้พอ — ไม่ใช่ข้อมูลสำคัญระดับต้องหยุดเว็บถ้าเขียนไม่สำเร็จ
  }
}

// บันทึก/อัปเดตโปรไฟล์คนที่เพิ่ง Login สำเร็จ
function save({ id, username, avatar }) {
  if (!username) return;
  const all = loadAll();
  all[username.toLowerCase()] = { id, username, avatar, updatedAt: Date.now() };
  saveAll(all);
}

// ค้นหาโปรไฟล์จาก "ชื่อคนอัพเพลง" (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
function get(usernameOrTag) {
  if (!usernameOrTag) return null;
  // เผื่อชื่อเก่ามีรูปแบบ "name#1234" ให้ตัดส่วน #discriminator ทิ้งก่อนจับคู่
  const clean = String(usernameOrTag).split("#")[0].trim().toLowerCase();
  const all = loadAll();
  return all[clean] || null;
}

// 📋 PATCH: คืนโปรไฟล์ "ทุกคน" ที่เคย Login ไว้ทั้งหมด (ย้อนหลังได้ทันที เพราะ
// ข้อมูลถูก save() ไว้ตั้งแต่ครั้งแรกที่แต่ละคน login อยู่แล้ว ไม่ต้องรอ login ใหม่)
// เรียงจาก login ล่าสุดก่อน ใช้กับหน้าแอดมินสำหรับดูรายชื่อ/แบนผู้ใช้
function getAll() {
  const all = loadAll();
  return Object.values(all).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

module.exports = { save, get, getAll };