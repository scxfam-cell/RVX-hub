// ══════════════════════════════════════════════════════════════
//  🪙  COIN HISTORY STORE — เก็บประวัติการเพิ่ม/หักเหรียญของผู้ใช้แต่ละคน
//  ที่แอดมินทำจากหลังบ้าน (หน้า /admin แท็บ "เหรียญผู้ใช้") ไว้โชว์เป็นตาราง
//  (วัน-เวลา / จำนวน / คงเหลือหลังทำ / แอดมินที่ทำ / หมายเหตุ)
//
//  เก็บเป็นไฟล์เดียว data/coin-history.json รูปแบบ:
//    { [userId]: [ {id, amount, balanceAfter, reason, adminName, adminId, createdAt}, ... ] }
//  รายการใหม่สุดอยู่หัวลิสต์เสมอ (unshift) และจำกัดจำนวนต่อผู้ใช้ไว้กันไฟล์บวม
// ══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

const FILE          = path.join(__dirname, "..", "data", "coin-history.json");
const MAX_PER_USER   = 200; // เก็บย้อนหลังสูงสุดต่อผู้ใช้ 1 คน

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
    console.error(`[CoinHistory] บันทึกไฟล์ไม่สำเร็จ: ${err.message}`);
  }
}

/**
 * บันทึกธุรกรรมเหรียญ 1 รายการให้ผู้ใช้คนหนึ่ง
 * @param {string} userId
 * @param {{amount:number, balanceAfter:number, reason?:string, adminName?:string, adminId?:string}} tx
 */
function record(userId, tx) {
  const id = String(userId || "").trim();
  if (!id) return;

  const data = loadAll();
  const list = data[id] || (data[id] = []);

  list.unshift({
    id:           `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    amount:       Number(tx.amount) || 0,
    balanceAfter: Number.isFinite(tx.balanceAfter) ? tx.balanceAfter : null,
    reason:       tx.reason || "",
    adminName:    tx.adminName || "ระบบ",
    adminId:      tx.adminId || null,
    createdAt:    new Date().toISOString(),
  });

  if (list.length > MAX_PER_USER) list.length = MAX_PER_USER;
  saveAll(data);
}

/**
 * ดึงประวัติธุรกรรมของผู้ใช้คนหนึ่ง (ล่าสุดก่อน)
 * @param {string} userId
 * @param {number} limit
 */
function getHistory(userId, limit = 100) {
  const id   = String(userId || "").trim();
  const data = loadAll();
  return (data[id] || []).slice(0, limit);
}

module.exports = { record, getHistory };
