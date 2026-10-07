// ══════════════════════════════════════════════════════════════
//  🆕  FIRST-SEEN STORE — จำวันแรกที่แต่ละคนเคย Login เข้าเว็บด้วย Discord
//
//  webUserStore.updatedAt จะถูกเขียนทับทุกครั้งที่มีคน login ใหม่ (ใช้บอก
//  "ล่าสุดเมื่อไหร่" ได้ แต่ใช้ทำกราฟ "ผู้ใช้ใหม่ต่อวัน" ไม่ได้ตรงๆ) จึงแยก
//  เก็บ "วันแรก" ไว้ต่างหากที่นี่ — เขียนแค่ครั้งเดียวต่อผู้ใช้ 1 คน ไม่มีวันถูกทับ
//
//  เก็บเป็นไฟล์เดียว data/first-seen.json รูปแบบ: { [userId]: isoDateString }
// ══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "first-seen.json");

function loadAll() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data), "utf-8");
  } catch (err) {
    console.error(`[FirstSeen] บันทึกไฟล์ไม่สำเร็จ: ${err.message}`);
  }
}

/**
 * เรียกทุกครั้งที่มีคน login สำเร็จ — บันทึกเฉพาะครั้งแรกเท่านั้น (มีอยู่แล้วจะไม่ทับ)
 * @param {string} userId
 * @returns {string} วัน-เวลาแรกที่เคยเห็นผู้ใช้คนนี้ (ISO string)
 */
function markSeen(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;

  const data = loadAll();
  if (!data[id]) {
    data[id] = new Date().toISOString();
    saveAll(data);
  }
  return data[id];
}

/** คืนทั้งหมดเป็น { userId: isoDateString } */
function getAll() {
  return loadAll();
}

module.exports = { markSeen, getAll };
