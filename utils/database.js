// ═══════════════════════════════════════════════════════════════
//  🗄️  DATABASE  —  JSON persistence layer
//  ✏️  PATCH: + renameSong (สำหรับคำสั่ง /renamesong)
//  🗑️  PATCH: + deleteSong (ลบเพลงถาวรเมื่อโดนแบน — ไม่เก็บ record ไว้)
// ═══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");
const cfg  = require("../config");

// ── โครงสร้างข้อมูล ──────────────────────────────────────────
const DEFAULT_DB = {
  songs:       {},   // songId → { name, addedBy, addedByTag, addedAt, votes: [], banned: false, bannedAt: null }
  stats:       {},   // userId → { sent: 0, deleted: 0, tag: "" }
  meta:        { totalAdded: 0, totalDeleted: 0, lastUpdated: null },
  visitors:    { total: 0 },
  deletionLog: [],   // [{ id, name, reason, deletedBy, deletedAt }, ...] ล่าสุดอยู่หน้าสุด (สำหรับหน้าแอดมิน)
};

let db = {
  ...DEFAULT_DB,
  songs:       {},
  stats:       {},
  meta:        { ...DEFAULT_DB.meta },
  visitors:    { total: 0 },
  deletionLog: [],
};

// ── โหลดจาก disk ─────────────────────────────────────────────
function load() {
  const dir = path.dirname(cfg.DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(cfg.DB_PATH)) {
    try {
      const raw = fs.readFileSync(cfg.DB_PATH, "utf-8");
      db = { ...DEFAULT_DB, ...JSON.parse(raw) };
      if (!db.visitors) db.visitors = { total: 0 };
      if (!Array.isArray(db.deletionLog)) db.deletionLog = []; // migration: ไฟล์เก่ายังไม่มี field นี้
      // ── migration: เติม field ที่อาจขาดในข้อมูลเก่า ──────
      Object.keys(db.songs).forEach((id) => {
        if (typeof db.songs[id].banned   === "undefined") db.songs[id].banned   = false;
        if (typeof db.songs[id].bannedAt === "undefined") db.songs[id].bannedAt = null;
      });
    } catch {
      db = {
        ...DEFAULT_DB,
        songs:       {},
        stats:       {},
        meta:        { ...DEFAULT_DB.meta },
        visitors:    { total: 0 },
        deletionLog: [],
      };
    }
  }
}

// ── บันทึกลง disk ─────────────────────────────────────────────
function save() {
  db.meta.lastUpdated = new Date().toISOString();
  fs.writeFileSync(cfg.DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

// ── CRUD Songs ────────────────────────────────────────────────

/** เพิ่มเพลง — return { added, duplicates } */
function addSongs(songs, userId, userTag) {
  const added      = [];
  const duplicates = [];

  for (const { id, name } of songs) {
    if (db.songs[id]) {
      duplicates.push({ id, name, original: db.songs[id] });
    } else {
      db.songs[id] = {
        name,
        addedBy:    userId,
        addedByTag: userTag,
        addedAt:    new Date().toISOString(),
        votes:      [],
        banned:     false,
        bannedAt:   null,
      };
      added.push({ id, name });
      db.meta.totalAdded++;
    }
  }

  if (!db.stats[userId]) db.stats[userId] = { sent: 0, deleted: 0, tag: userTag };
  db.stats[userId].sent += added.length;
  db.stats[userId].tag   = userTag;

  save();
  return { added, duplicates };
}

/** ค้นหาเพลงจากชื่อหรือ id */
function searchSongs(query) {
  const q = query.toLowerCase();
  return Object.entries(db.songs)
    .filter(([id, s]) => id.includes(q) || s.name.toLowerCase().includes(q))
    .map(([id, s]) => ({ id, ...s }));
}

/** ดึงเพลงทั้งหมดแบบ array */
function getAllSongs() {
  return Object.entries(db.songs).map(([id, s]) => ({ id, ...s }));
}

/** ลงโหวตเพลง — toggle แล้ว return { count, voted } */
function voteSong(songId, userId) {
  if (!db.songs[songId]) return { count: 0, voted: false };
  const votes = db.songs[songId].votes;
  const idx   = votes.indexOf(userId);
  if (idx === -1) { votes.push(userId); }
  else            { votes.splice(idx, 1); }
  save();
  return {
    count: db.songs[songId].votes.length,
    voted: db.songs[songId].votes.includes(userId),
  };
}

/**
 * mark เพลงว่าโดนแบนหรือเปล่า
 * (⚠️ เก็บฟังก์ชันนี้ไว้เผื่อใช้งานที่อื่น แต่ระบบตรวจแบนหลักตอนนี้
 *  ใช้ deleteSong() แทนแล้ว — ดูด้านล่าง)
 * @param {string}  songId
 * @param {boolean} isBanned  true = โดนแบน, false = ปลดแบน
 * @returns {boolean}  false ถ้าหา song ไม่เจอ
 */
function setBanned(songId, isBanned = true) {
  if (!db.songs[songId]) return false;
  db.songs[songId].banned   = isBanned;
  db.songs[songId].bannedAt = isBanned ? new Date().toISOString() : null;
  save();
  return true;
}

/**
 * 🗑️ ลบเพลงออกจากระบบถาวร (ใช้ตอนตรวจเจอว่าโดนแบน — ไม่เก็บ record ตัวเพลงไว้เลย
 *  ต่างจาก setBanned ที่แค่ mark flag ไว้ อันนี้ delete ออกจาก db.songs จริงๆ)
 *  ✏️ PATCH: เก็บ "ประวัติการลบ" แยกไว้ต่างหากใน db.deletionLog เพื่อให้หน้าแอดมิน
 *  โชว์ "เพลงที่ถูกลบล่าสุด" ได้ — ไม่กระทบพฤติกรรมเดิมของ caller ที่มีอยู่แล้ว
 *  เพราะ meta เป็น optional ทั้งหมด
 * @param {string} songId
 * @param {{ reason?: string, by?: string }} [meta]  reason: เหตุผลที่ลบ (เช่น "auto-scan", "admin", "banned"), by: ผู้ลบ (userId ถ้าเป็นแอดมินกดลบเอง)
 * @returns {boolean} false ถ้าหาเพลงไม่เจอ
 */
function deleteSong(songId, meta = {}) {
  if (!db.songs[songId]) return false;
  const removed = db.songs[songId];

  delete db.songs[songId];
  db.meta.totalDeleted = (db.meta.totalDeleted || 0) + 1;

  if (!Array.isArray(db.deletionLog)) db.deletionLog = [];
  db.deletionLog.unshift({
    id:        songId,
    name:      removed.name,
    reason:    meta.reason || "unknown",
    deletedBy: meta.by || null,
    deletedAt: new Date().toISOString(),
  });
  // เก็บย้อนหลังแค่ 200 รายการล่าสุดพอ กันไฟล์ db บวมไม่จำกัด
  if (db.deletionLog.length > 200) db.deletionLog.length = 200;

  save();
  return true;
}

/**
 * 📜 ดึงประวัติเพลงที่ถูกลบล่าสุด (สำหรับหน้าแอดมิน)
 * @param {number} limit
 */
function getRecentDeletions(limit = 20) {
  if (!Array.isArray(db.deletionLog)) return [];
  return db.deletionLog.slice(0, limit);
}

/**
 * ✏️ เปลี่ยนชื่อเพลง (ใช้กับคำสั่ง /renamesong ของแอดมัน)
 * @param {string} songId
 * @param {string} newName
 * @returns {{ success: boolean, oldName?: string, newName?: string }}
 */
function renameSong(songId, newName) {
  if (!db.songs[songId]) return { success: false };

  const oldName = db.songs[songId].name;
  db.songs[songId].name = newName;
  save();

  return { success: true, oldName, newName };
}

/** ดึงเฉพาะเพลงที่โดนแบน (⚠️ ปัจจุบันเพลงที่โดนแบนจะถูกลบทิ้งทันที
 *  ฟังก์ชันนี้จะคืนค่าว่างเปล่าเป็นปกติ เก็บไว้เผื่อ backward-compat) */
function getBannedSongs() {
  return Object.entries(db.songs)
    .filter(([, s]) => s.banned === true)
    .map(([id, s]) => ({ id, ...s }));
}

/** stats ของ user */
function getUserStats(userId) {
  return db.stats[userId] || { sent: 0, deleted: 0, tag: "ไม่ทราบ" };
}

/** leaderboard ผู้ส่งเยอะสุด */
function getLeaderboard(limit = 10) {
  return Object.entries(db.stats)
    .map(([id, s]) => ({ userId: id, ...s }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, limit);
}

/** export ทั้งหมดเป็น text */
function exportTxt() {
  const lines = Object.entries(db.songs).map(
    ([id, s]) => `${id} ${s.name}${s.banned ? " [BANNED]" : ""}`
  );
  return lines.join("\n");
}

/** export เป็น CSV */
function exportCsv() {
  const header = "ID,Name,AddedBy,AddedAt,Votes,Banned,BannedAt\n";
  const rows   = Object.entries(db.songs)
    .map(([id, s]) =>
      `${id},"${s.name.replace(/"/g, '""')}","${s.addedByTag}","${s.addedAt}",${s.votes.length},${s.banned ? "true" : "false"},"${s.bannedAt || ""}"`
    )
    .join("\n");
  return header + rows;
}

/** meta ทั่วไป */
function getMeta() {
  return {
    ...db.meta,
    totalSongs:  Object.keys(db.songs).length,
    totalUsers:  Object.keys(db.stats).length,
    totalBanned: Object.values(db.songs).filter((s) => s.banned).length,
  };
}

/** เพิ่มสถิติ deleted */
function recordDeleted(userId, userTag, count = 1) {
  if (!db.stats[userId]) db.stats[userId] = { sent: 0, deleted: 0, tag: userTag };
  db.stats[userId].deleted += count;
  db.stats[userId].tag      = userTag;
  db.meta.totalDeleted      += count;
  save();
}

// ── VISITORS ─────────────────────────────────────────────────
function trackVisitor(doCount) {
  if (!db.visitors) db.visitors = { total: 0 };
  if (doCount) db.visitors.total++;
  save();
  return db.visitors.total;
}

function getVisitors() {
  if (!db.visitors) db.visitors = { total: 0 };
  return db.visitors.total;
}

// โหลดตอน require
load();

module.exports = {
  addSongs,
  searchSongs,
  getAllSongs,
  voteSong,
  setBanned,
  deleteSong,
  getRecentDeletions,
  renameSong,
  getBannedSongs,
  getUserStats,
  getLeaderboard,
  exportTxt,
  exportCsv,
  getMeta,
  recordDeleted,
  trackVisitor,
  getVisitors,
  getRaw: () => db,
};