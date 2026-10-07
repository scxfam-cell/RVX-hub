// ══════════════════════════════════════════════════════════════
//  🔑  API KEY STORE — สำหรับระบบ Public API (/api/public/songs)
//  เก็บเป็นไฟล์ JSON เดียว — สร้าง/ลบผ่าน /api/admin/api-keys (เว็บ)
//  หรือ /apikey (บอท) ก็ได้ ใช้ store เดียวกัน
//
//  🔒 ความปลอดภัย:
//  - เก็บเฉพาะ "hash" (SHA-256) ของคีย์ ไม่เก็บคีย์เต็มไว้เลย
//    ต่อให้ไฟล์นี้หลุด/ถูกอ่านได้ ก็เอาคีย์จริงไปใช้ต่อไม่ได้
//    (คีย์สุ่ม 160 บิตอยู่แล้ว จึงไม่จำเป็นต้องใช้ bcrypt/scrypt
//    แบบรหัสผ่านที่มนุษย์ตั้งเอง — SHA-256 พอสำหรับ high-entropy secret)
//  - คีย์เต็มจะโชว์ให้เห็น "ครั้งเดียว" ตอนสร้างเท่านั้น
//  - แต่ละคีย์มี id สั้นๆ (ไม่ลับ) ไว้ใช้ดู/ลบ โดยไม่ต้องพิมพ์คีย์เต็มซ้ำ
//  - รองรับวันหมดอายุ (ไม่ตั้งก็ได้ = ไม่หมดอายุ)
// ══════════════════════════════════════════════════════════════
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "..", "data", "api-keys.json");

function loadAll() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw    = fs.readFileSync(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), "utf-8");
}

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function isExpired(record) {
  return !!record.expiresAt && Date.now() > new Date(record.expiresAt).getTime();
}

// รายการคีย์ทั้งหมด — คืนแค่ข้อมูลที่ไม่ลับ (ไม่มี hash/คีย์เต็มติดไปด้วย)
function listKeys() {
  return loadAll().map((k) => ({
    id:        k.id,
    label:     k.label,
    prefix:    k.prefix,       // เช่น "sgid_a1b2c3d4…" ไว้ดูจำได้ ไม่ใช่คีย์เต็ม
    createdAt: k.createdAt,
    createdBy: k.createdBy,
    expiresAt: k.expiresAt || null,
    expired:   isExpired(k),
  }));
}

// หา record ที่ตรงกับคีย์ (ใช้ภายในทั้ง isValidKey และ getKeyId) — ไม่คืน hash ออกไปข้างนอก
function findValidRecord(key) {
  if (!key) return null;
  const hash = hashKey(key);
  const record = loadAll().find((k) => k.hash === hash);
  if (!record) return null;
  if (isExpired(record)) return null;
  return record;
}

// เช็คว่าคีย์ใช้ได้จริงไหม (มีอยู่จริง + ยังไม่หมดอายุ)
function isValidKey(key) {
  return !!findValidRecord(key);
}

// คืน id (ไม่ลับ) ของคีย์จาก raw key — ใช้ตอนอยากรู้ว่า request นี้ "ใช้คีย์ไหน" อยู่
// (เช่น นับจำนวนคนใช้งานแยกตามคีย์แบบเรียลไทม์) คืน null ถ้าคีย์ไม่ถูกต้อง/หมดอายุ
function getKeyId(key) {
  const record = findValidRecord(key);
  return record ? record.id : null;
}

// สร้างคีย์ใหม่ — คืน { id, key, expiresAt } — "key" (ค่าเต็ม) จะไม่ถูกเก็บซ้ำที่ไหนอีก
// expiresInDays: จำนวนวันก่อนหมดอายุ (ไม่ใส่ / 0 / null = ไม่หมดอายุ)
function createKey({ label, createdBy, expiresInDays }) {
  const key    = "sgid_" + crypto.randomBytes(20).toString("hex");
  const id     = crypto.randomBytes(4).toString("hex"); // id สั้นๆ ไว้อ้างอิง ไม่ลับ
  const prefix = key.slice(0, 14) + "…";

  const days = Number(expiresInDays) || 0;
  const expiresAt = days > 0
    ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const list = loadAll();
  list.push({
    id,
    hash:      hashKey(key),
    prefix,
    label:     label || "",
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null,
    expiresAt,
  });
  saveAll(list);

  return { id, key, expiresAt };
}

// ลบคีย์ด้วย id (ไม่ใช่คีย์เต็ม) — คืน true ถ้าลบสำเร็จ
function revokeKey(id) {
  const list = loadAll();
  const next = list.filter((k) => k.id !== id);
  const removed = next.length !== list.length;
  saveAll(next);
  return removed;
}

module.exports = { listKeys, isValidKey, getKeyId, createKey, revokeKey };