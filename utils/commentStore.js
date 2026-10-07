// ══════════════════════════════════════════════════════════════
//  💬  COMMENT STORE — เก็บคอมเมนต์ใต้เพลงแบบไฟล์ JSON
//  (ไม่ต้องตั้ง database เพิ่ม ใช้ pattern เดียวกับ uploaderStore.js)
// ══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

const FILE           = path.join(__dirname, "..", "data", "comments.json");
const MAX_PER_SONG   = 200; // เก็บคอมเมนต์ล่าสุดต่อเพลงไม่เกินเท่านี้ กันไฟล์บวม
const MAX_TEXT_LEN   = 200; // ตัดความยาวข้อความ ให้ตรงกับ maxlength ฝั่งหน้าเว็บ
const EDIT_WINDOW_MS = 5 * 60 * 1000; // แก้ไข/ลบคอมเมนต์ตัวเองได้ภายใน 5 นาทีหลังโพสต์เท่านั้น

// ── กันสแปม ────────────────────────────────────────────────────
const SPAM_KEY          = "__spam"; // เก็บสถิติล่าสุดของแต่ละคนไว้ในไฟล์เดียวกัน (ไม่ใช่ song id)
const COOLDOWN_MS       = 15 * 1000;      // ห่างกันอย่างน้อย 15 วิ ต่อ 1 คอมเมนต์ (ทุกเพลงรวมกัน)
const DUPLICATE_WINDOW_MS = 3 * 60 * 1000; // ข้อความเดิมซ้ำภายใน 3 นาที = สแปม
const MAX_REPEAT_CHARS  = 8; // ตัวอักษรเดิมติดกันเกินเท่านี้ถือว่าสแปม เช่น "อออออออออ"

function loadAll() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const raw    = fs.readFileSync(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf-8");
}

// คืนคอมเมนต์ของเพลง เรียงใหม่สุดก่อน
function getComments(songId) {
  const all  = loadAll();
  const list = Array.isArray(all[songId]) ? all[songId] : [];
  return [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ตรวจข้อความที่เป็นตัวอักษรเดิมซ้ำรัวๆ เช่น "อออออออออ" หรือ "555555555555"
function isRepeatedCharSpam(text) {
  return new RegExp(`(.)\\1{${MAX_REPEAT_CHARS - 1},}`).test(text);
}

function getSpamRecord(all, userId) {
  return all[SPAM_KEY] && all[SPAM_KEY][userId] ? all[SPAM_KEY][userId] : null;
}

function setSpamRecord(all, userId, text) {
  if (!all[SPAM_KEY]) all[SPAM_KEY] = {};
  all[SPAM_KEY][userId] = { text, at: new Date().toISOString() };
}

// เพิ่มคอมเมนต์ใหม่ — คืน { success, comment } หรือ { success:false, error }
function addComment(songId, { userId, username, avatar, text, frameCss }) {
  const clean = String(text ?? "").trim().slice(0, MAX_TEXT_LEN);
  if (!clean) return { success: false, error: "กรุณาพิมพ์ข้อความก่อนส่ง" };
  if (!userId) return { success: false, error: "ไม่พบข้อมูลผู้ใช้" };
  if (isRepeatedCharSpam(clean)) {
    return { success: false, error: "ข้อความดูเหมือนสแปม กรุณาพิมพ์ให้เป็นประโยคปกติ" };
  }

  const all  = loadAll();
  const prev = getSpamRecord(all, userId);

  if (prev) {
    const msSinceLast = Date.now() - new Date(prev.at).getTime();
    if (msSinceLast < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - msSinceLast) / 1000);
      return { success: false, error: `คอมเมนต์ถี่เกินไป กรุณารออีก ${waitSec} วินาที` };
    }
    if (prev.text === clean && msSinceLast < DUPLICATE_WINDOW_MS) {
      return { success: false, error: "คุณเพิ่งส่งข้อความนี้ไปแล้ว กรุณาอย่าพิมพ์ซ้ำ" };
    }
  }

  if (!Array.isArray(all[songId])) all[songId] = [];

  const comment = {
    id:        `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    username:  username || "ผู้ใช้",
    avatar:    avatar || null,
    frameCss:  frameCss || null, // กรอบโปรไฟล์ที่สวมใส่อยู่ตอนคอมเมนต์ (จาก checkinDB cosmetics)
    text:      clean,
    createdAt: new Date().toISOString(),
  };

  all[songId].push(comment);
  setSpamRecord(all, userId, clean);
  if (all[songId].length > MAX_PER_SONG) {
    all[songId] = all[songId].slice(-MAX_PER_SONG);
  }

  saveAll(all);
  return { success: true, comment };
}

// แก้ไขคอมเมนต์ตัวเอง — เฉพาะเจ้าของคอมเมนต์ และภายใน EDIT_WINDOW_MS หลังโพสต์เท่านั้น
function updateComment(songId, commentId, userId, newText) {
  const clean = String(newText ?? "").trim().slice(0, MAX_TEXT_LEN);
  if (!clean) return { success: false, error: "กรุณาพิมพ์ข้อความก่อนบันทึก" };

  const all  = loadAll();
  const list = Array.isArray(all[songId]) ? all[songId] : [];
  const c    = list.find((x) => x.id === commentId);

  if (!c) return { success: false, error: "ไม่พบคอมเมนต์นี้" };
  if (c.userId !== userId) return { success: false, error: "แก้ไขได้เฉพาะคอมเมนต์ของตัวเอง" };
  if (Date.now() - new Date(c.createdAt).getTime() > EDIT_WINDOW_MS) {
    return { success: false, error: "เกินเวลาแก้ไขแล้ว (แก้ไขได้ภายใน 5 นาทีหลังโพสต์)" };
  }

  c.text      = clean;
  c.editedAt  = new Date().toISOString();
  saveAll(all);
  return { success: true, comment: c };
}

// ลบคอมเมนต์ตัวเอง — เฉพาะเจ้าของคอมเมนต์ และภายใน EDIT_WINDOW_MS หลังโพสต์เท่านั้น
function deleteComment(songId, commentId, userId) {
  const all  = loadAll();
  const list = Array.isArray(all[songId]) ? all[songId] : [];
  const c    = list.find((x) => x.id === commentId);

  if (!c) return { success: false, error: "ไม่พบคอมเมนต์นี้" };
  if (c.userId !== userId) return { success: false, error: "ลบได้เฉพาะคอมเมนต์ของตัวเอง" };
  if (Date.now() - new Date(c.createdAt).getTime() > EDIT_WINDOW_MS) {
    return { success: false, error: "เกินเวลาลบแล้ว (ลบได้ภายใน 5 นาทีหลังโพสต์)" };
  }

  all[songId] = list.filter((x) => x.id !== commentId);
  saveAll(all);
  return { success: true };
}

// รวมยอดคอมเมนต์ทั้งหมดของแต่ละคน ใช้ทำหน้า Hall of Fame
function getTopCommenters(limit = 5) {
  const all = loadAll();
  const byUser = {};
  for (const songId of Object.keys(all)) {
    const list = Array.isArray(all[songId]) ? all[songId] : [];
    for (const c of list) {
      if (!byUser[c.userId]) {
        byUser[c.userId] = { userId: c.userId, username: c.username, avatar: c.avatar, count: 0 };
      }
      byUser[c.userId].count++;
      // เก็บชื่อ/รูปล่าสุดไว้ (เผื่อเปลี่ยนชื่อ/รูปโปรไฟล์ทีหลัง)
      if (new Date(c.createdAt) > new Date(byUser[c.userId]._latestAt || 0)) {
        byUser[c.userId].username  = c.username;
        byUser[c.userId].avatar    = c.avatar;
        byUser[c.userId]._latestAt = c.createdAt;
      }
    }
  }
  return Object.values(byUser)
    .map(({ _latestAt, ...rest }) => rest)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

module.exports = { getComments, addComment, updateComment, deleteComment, getTopCommenters };
