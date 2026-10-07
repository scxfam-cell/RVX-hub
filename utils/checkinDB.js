// ═══════════════════════════════════════════════════════════════
//  💾  CHECK-IN DATABASE — coins, streaks, role shop (JSON file)
// ═══════════════════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

const DATA_DIR  = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "checkin.json");

const DEFAULT_REWARD = parseInt(process.env.CHECKIN_REWARD, 10) || 10;

// ── สร้างยศกำหนดเอง (ชื่อ+สีเอง) — จำกัด 1 ยศ/วัน/คน ────────────
const CUSTOM_ROLE_PRICE = parseInt(process.env.CUSTOM_ROLE_PRICE, 10) || 1000;
const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;

// ── กาชาปองประจำวัน (สุ่มเหรียญ 1 ครั้ง/วัน) ───────────────────
// weight ยิ่งเยอะยิ่งมีโอกาสออกบ่อย รวม weight ทั้งหมด = 100
const GACHA_TABLE = [
  { min: 5,   max: 15,  weight: 55 }, // ธรรมดา
  { min: 16,  max: 30,  weight: 30 }, // ดี
  { min: 31,  max: 60,  weight: 12 }, // เยี่ยม
  { min: 100, max: 100, weight: 3 },  // แจ็คพอต 🎉
];

// ── ร้านคอสเมติก (ธีมสี / กรอบโปรไฟล์) — ของสะสม ไม่ใช่ยศ Discord ───
const COSMETIC_CATALOG = [
  { id: "theme_default", type: "theme", name: "ม่วงคลาสสิก",  price: 0,   colors: { accent: "#a855f7", accent2: "#c084fc", accent3: "#7c3aed" } },
  { id: "theme_pink",    type: "theme", name: "ชมพูหวาน",     price: 80,  colors: { accent: "#f472b6", accent2: "#f9a8d4", accent3: "#db2777" } },
  { id: "theme_blue",    type: "theme", name: "น้ำเงินสายฟ้า", price: 80,  colors: { accent: "#60a5fa", accent2: "#93c5fd", accent3: "#2563eb" } },
  { id: "theme_green",   type: "theme", name: "เขียวมรกต",    price: 80,  colors: { accent: "#34d399", accent2: "#6ee7b7", accent3: "#059669" } },
  { id: "theme_gold",    type: "theme", name: "ทองหรู",       price: 150, colors: { accent: "#fbbf24", accent2: "#fde68a", accent3: "#d97706" } },
  { id: "frame_none",    type: "frame", name: "ไม่มีกรอบ",     price: 0,   css: "" },
  { id: "frame_neon",    type: "frame", name: "กรอบนีออน",     price: 60,  css: "0 0 0 2px #a855f7, 0 0 14px rgba(168,85,247,.7)" },
  { id: "frame_gold",    type: "frame", name: "กรอบทอง",       price: 120, css: "0 0 0 2px #fbbf24, 0 0 14px rgba(251,191,36,.7)" },
  { id: "frame_ice",     type: "frame", name: "กรอบน้ำแข็ง",   price: 120, css: "0 0 0 2px #60a5fa, 0 0 14px rgba(96,165,250,.7)" },
  { id: "frame_rainbow", type: "frame", name: "กรอบสีรุ้ง",     price: 999 },
  { id: "frame_wings",   type: "frame", name: "ปีกขาว",       price: 5000 },
  { id: "frame_crown",   type: "frame", name: "มงกุฎทอง",     price: 3000 },
  { id: "frame_thunder", type: "frame", name: "กรอบสายฟ้า",   price: 350 },
  { id: "frame_bubbles", type: "frame", name: "กรอบฟองทะเล",  price: 250 },
  { id: "frame_tech",    type: "frame", name: "กรอบเทคโนโลยี", price: 400 },
];

// ── File helpers ─────────────────────────────────────────────
function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {}, roles: [] }, null, 2));
  }
}

function load() {
  ensureFile();
  try {
    const raw  = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!data.users) data.users = {};
    if (!data.roles) data.roles = [];
    if (!data.cosmeticOverrides) data.cosmeticOverrides = {}; // ราคา/ส่วนลดที่แอดมินปรับ (แยกจาก catalog คงที่)
    return data;
  } catch {
    return { users: {}, roles: [], cosmeticOverrides: {} };
  }
}

function save(data) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function defaultUser() {
  return {
    coins: 0,
    streak: 0,
    lastCheckin: null,
    lastGacha: null,
    lastCustomRole: null,
    customRoles: [],
    bio: "",
    cosmetics: { owned: ["theme_default", "frame_none"], theme: "theme_default", frame: "frame_none" },
    following: [], // รายชื่อ userId ที่เรากดติดตามอยู่
  };
}

// ── Users ────────────────────────────────────────────────────
function getUser(userId) {
  const data = load();
  if (!data.users[userId]) {
    data.users[userId] = defaultUser();
    save(data);
  }
  const u = data.users[userId];
  if (u.lastGacha === undefined) u.lastGacha = null;
  if (u.lastCustomRole === undefined) u.lastCustomRole = null;
  if (!u.customRoles) u.customRoles = [];
  if (typeof u.bio !== "string") u.bio = "";
  if (!u.cosmetics) u.cosmetics = { owned: ["theme_default", "frame_none"], theme: "theme_default", frame: "frame_none" };
  if (!Array.isArray(u.following)) u.following = [];
  return u;
}

// ── โปรไฟล์: ข้อความแนะนำตัวสั้นๆ ที่ผู้ใช้ตั้งเอง (เหมือนไบโอในติ๊กต๊อก) ──
function getUserBio(userId) {
  return getUser(userId).bio || "";
}

function setUserBio(userId, bio) {
  const clean = String(bio || "").slice(0, 150);
  const data  = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  data.users[userId].bio = clean;
  save(data);
  return clean;
}

function canCheckin(userId) {
  const u = getUser(userId);
  return u.lastCheckin !== todayStr();
}

function doCheckin(userId) {
  const data = load();
  if (!data.users[userId]) {
    data.users[userId] = defaultUser();
  }
  const u     = data.users[userId];
  const today = todayStr();

  if (u.lastCheckin === today) {
    return { success: false, error: "เช็คอินไปแล้ววันนี้" };
  }

  const yest = yesterdayStr();
  u.streak      = u.lastCheckin === yest ? u.streak + 1 : 1;
  u.lastCheckin = today;
  u.coins      += DEFAULT_REWARD;

  save(data);
  return { success: true, reward: DEFAULT_REWARD, coins: u.coins, streak: u.streak };
}

function refund(userId, amount) {
  const data = load();
  if (!data.users[userId]) {
    data.users[userId] = defaultUser();
  }
  data.users[userId].coins += amount;
  save(data);
  return data.users[userId].coins;
}

// ── บวกเหรียญตรงๆ จากระบบภายนอก (เช่น ระบบออนห้องเสียง) ───────
function addCoins(userId, amount) {
  const data = load();
  if (!data.users[userId]) {
    data.users[userId] = defaultUser();
  }
  data.users[userId].coins += amount;
  save(data);
  return { coins: data.users[userId].coins };
}

// ── อันดับเหรียญเยอะสุด (สำหรับ Hall of Fame) ──────────────────
function getCoinsLeaderboard(limit = 5) {
  const data = load();
  return Object.entries(data.users)
    .map(([userId, u]) => ({ userId, coins: u.coins || 0 }))
    .filter((u) => u.coins > 0)
    .sort((a, b) => b.coins - a.coins)
    .slice(0, limit);
}

// ── Roles (Shop) ─────────────────────────────────────────────
function getRoles() {
  return load().roles;
}

function addRole(roleId, name, price) {
  const data   = load();
  const exists = data.roles.find((r) => r.id === roleId);
  if (exists) {
    exists.name  = name;
    exists.price = price;
  } else {
    data.roles.push({ id: roleId, name, price });
  }
  save(data);
  return data.roles;
}

function removeRole(roleId) {
  const data   = load();
  const before = data.roles.length;
  data.roles   = data.roles.filter((r) => r.id !== roleId);
  save(data);
  return data.roles.length < before;
}

function redeemRole(userId, roleId) {
  const data = load();
  const role = data.roles.find((r) => r.id === roleId);
  if (!role) return { success: false, error: "ไม่พบยศนี้ในร้าน" };

  if (!data.users[userId]) {
    data.users[userId] = defaultUser();
  }
  const u = data.users[userId];

  if (u.coins < role.price) {
    return { success: false, error: "เหรียญไม่พอ" };
  }

  u.coins -= role.price;
  save(data);
  return { success: true, coins: u.coins, role };
}

// ── สร้างยศกำหนดเอง (ชื่อ+สีเอง) — จำกัด 1 ยศ/วัน/คน ────────────
function getCustomRolePrice() {
  return CUSTOM_ROLE_PRICE;
}

function canCreateCustomRole(userId) {
  const u = getUser(userId);
  return u.lastCustomRole !== todayStr();
}

// ขั้นที่ 1: ตรวจสอบ + หักเหรียญ + ล็อกโควต้าวันนี้ไว้ก่อน (ก่อนไปยิง Discord API)
// คืนค่า prevLastCustomRole ไว้ด้วย เผื่อต้อง rollback ถ้าสร้าง role ใน Discord ไม่สำเร็จ
function reserveCustomRole(userId, name, color) {
  name = String(name || "").trim();
  if (!name) return { success: false, error: "กรุณาตั้งชื่อยศ" };
  if (name.length > 60) return { success: false, error: "ชื่อยศยาวเกินไป (ไม่เกิน 60 ตัวอักษร)" };
  if (!HEX_COLOR_RE.test(color || "")) return { success: false, error: "รูปแบบสีไม่ถูกต้อง" };

  const data = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  const u = data.users[userId];
  if (u.lastCustomRole === undefined) u.lastCustomRole = null;
  if (!u.customRoles) u.customRoles = [];

  const today = todayStr();
  if (u.lastCustomRole === today) {
    return { success: false, error: "วันนี้สร้างยศไปแล้ว สร้างได้วันละ 1 ยศ พรุ่งนี้ค่อยมาใหม่นะ" };
  }
  if (u.coins < CUSTOM_ROLE_PRICE) {
    return { success: false, error: "เหรียญไม่พอ" };
  }

  const prevLastCustomRole = u.lastCustomRole;
  u.coins -= CUSTOM_ROLE_PRICE;
  u.lastCustomRole = today;
  save(data);

  return { success: true, coins: u.coins, price: CUSTOM_ROLE_PRICE, prevLastCustomRole };
}

// ขั้นที่ 2: สร้าง role ใน Discord สำเร็จแล้ว → บันทึกลงประวัติผู้ใช้
function commitCustomRole(userId, roleId, name, color) {
  const data = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  const u = data.users[userId];
  if (!u.customRoles) u.customRoles = [];
  u.customRoles.push({ roleId, name, color, createdAt: new Date().toISOString() });
  save(data);
  return u.customRoles;
}

// ถ้าสร้าง role ใน Discord ไม่สำเร็จ → คืนเหรียญ + คืนโควต้าของวันนี้
function rollbackCustomRole(userId, amount, prevLastCustomRole) {
  const data = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  const u = data.users[userId];
  u.coins += amount;
  u.lastCustomRole = prevLastCustomRole ?? null;
  save(data);
  return u.coins;
}

// ── กาชาปองประจำวัน ──────────────────────────────────────────
function canGacha(userId) {
  const u = getUser(userId);
  return u.lastGacha !== todayStr();
}

function pickGachaReward() {
  const totalWeight = GACHA_TABLE.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const tier of GACHA_TABLE) {
    if (roll < tier.weight) {
      return tier.min === tier.max ? tier.min : tier.min + Math.floor(Math.random() * (tier.max - tier.min + 1));
    }
    roll -= tier.weight;
  }
  return GACHA_TABLE[0].min;
}

function doGacha(userId) {
  const data = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  const u     = data.users[userId];
  const today = todayStr();

  if (u.lastGacha === today) {
    return { success: false, error: "วันนี้กาชาปองไปแล้ว พรุ่งนี้ค่อยมาใหม่นะ" };
  }

  const reward = pickGachaReward();
  u.lastGacha  = today;
  u.coins     += reward;

  save(data);
  return { success: true, reward, coins: u.coins, jackpot: reward >= 100 };
}

// ── ร้านคอสเมติก (ธีมสี / กรอบโปรไฟล์) ───────────────────────
// ราคาจริงคำนวณสดทุกครั้งที่เรียก ไม่ได้จำสถานะไว้ล่วงหน้า —
// พอเลยกำหนดเวลาลดราคา (saleUntil) ราคาจะกลับเป็นปกติเองอัตโนมัติ ไม่ต้องมี cron ใดๆ
function withPricing(item, overrides) {
  const ov = overrides[item.id] || {};
  const basePrice = typeof ov.price === "number" ? ov.price : item.price;

  let onSale = false, effectivePrice = basePrice;
  if (typeof ov.salePrice === "number" && ov.saleUntil) {
    const untilMs = new Date(ov.saleUntil).getTime();
    if (!isNaN(untilMs) && untilMs > Date.now() && ov.salePrice < basePrice) {
      onSale = true;
      effectivePrice = ov.salePrice;
    }
  }

  return {
    ...item,
    price: effectivePrice,
    basePrice,
    onSale,
    salePrice:  onSale ? ov.salePrice : null,
    saleUntil:  onSale ? ov.saleUntil : null,
  };
}

function getCosmeticCatalog() {
  const { cosmeticOverrides } = load();
  return COSMETIC_CATALOG.map((item) => withPricing(item, cosmeticOverrides));
}

function getUserCosmetics(userId) {
  const u = getUser(userId);
  return u.cosmetics;
}

// ── แอดมิน: แก้ราคาปกติของไอเทม (ถาวร ไม่ใช่ลดราคาชั่วคราว) ──
function setCosmeticPrice(itemId, price) {
  const item = COSMETIC_CATALOG.find((c) => c.id === itemId);
  if (!item) return { success: false, error: "ไม่พบไอเทมนี้ในแคตตาล็อก" };
  if (!Number.isFinite(price) || price < 0) return { success: false, error: "ราคาต้องเป็นตัวเลขไม่ติดลบ" };

  const data = load();
  if (!data.cosmeticOverrides[itemId]) data.cosmeticOverrides[itemId] = {};
  data.cosmeticOverrides[itemId].price = Math.round(price);
  save(data);
  return { success: true, item: withPricing(item, data.cosmeticOverrides) };
}

// ── แอดมิน: ตั้งลดราคาชั่วคราว พร้อมกำหนดวัน-เวลาที่จะหมดโปรโมชั่น ──
// saleUntil รับเป็น ISO string (เช่นจาก <input type="datetime-local"> ของหน้าแอดมิน)
function setCosmeticSale(itemId, salePrice, saleUntil) {
  const item = COSMETIC_CATALOG.find((c) => c.id === itemId);
  if (!item) return { success: false, error: "ไม่พบไอเทมนี้ในแคตตาล็อก" };
  if (!Number.isFinite(salePrice) || salePrice < 0) return { success: false, error: "ราคาลดต้องเป็นตัวเลขไม่ติดลบ" };

  const untilMs = new Date(saleUntil).getTime();
  if (!saleUntil || isNaN(untilMs)) return { success: false, error: "กรุณาระบุวัน-เวลาที่จะหมดโปรโมชั่น" };
  if (untilMs <= Date.now()) return { success: false, error: "เวลาหมดโปรโมชั่นต้องเป็นอนาคต" };

  const data = load();
  if (!data.cosmeticOverrides[itemId]) data.cosmeticOverrides[itemId] = {};
  const basePrice = typeof data.cosmeticOverrides[itemId].price === "number" ? data.cosmeticOverrides[itemId].price : item.price;
  if (salePrice >= basePrice) return { success: false, error: "ราคาลดต้องน้อยกว่าราคาปกติ" };

  data.cosmeticOverrides[itemId].salePrice = Math.round(salePrice);
  data.cosmeticOverrides[itemId].saleUntil = new Date(untilMs).toISOString();
  save(data);
  return { success: true, item: withPricing(item, data.cosmeticOverrides) };
}

// ── แอดมิน: ยกเลิกโปรโมชั่นลดราคาก่อนกำหนด (ราคากลับปกติทันที) ──
function clearCosmeticSale(itemId) {
  const item = COSMETIC_CATALOG.find((c) => c.id === itemId);
  if (!item) return { success: false, error: "ไม่พบไอเทมนี้ในแคตตาล็อก" };

  const data = load();
  if (data.cosmeticOverrides[itemId]) {
    delete data.cosmeticOverrides[itemId].salePrice;
    delete data.cosmeticOverrides[itemId].saleUntil;
    save(data);
  }
  return { success: true, item: withPricing(item, data.cosmeticOverrides) };
}

function redeemCosmetic(userId, itemId) {
  const item = getCosmeticCatalog().find((c) => c.id === itemId); // ใช้ราคาจริง ณ ตอนนี้ (รวมส่วนลดถ้ามี)
  if (!item) return { success: false, error: "ไม่พบไอเทมนี้ในร้าน" };

  const data = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  const u = data.users[userId];
  if (!u.cosmetics) u.cosmetics = { owned: ["theme_default", "frame_none"], theme: "theme_default", frame: "frame_none" };

  if (u.cosmetics.owned.includes(itemId)) {
    return { success: false, error: "คุณมีไอเทมนี้อยู่แล้ว" };
  }
  if (u.coins < item.price) {
    return { success: false, error: "เหรียญไม่พอ" };
  }

  u.coins -= item.price;
  u.cosmetics.owned.push(itemId);
  save(data);
  return { success: true, coins: u.coins, item };
}

function equipCosmetic(userId, itemId) {
  const item = COSMETIC_CATALOG.find((c) => c.id === itemId);
  if (!item) return { success: false, error: "ไม่พบไอเทมนี้ในร้าน" };

  const data = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  const u = data.users[userId];
  if (!u.cosmetics) u.cosmetics = { owned: ["theme_default", "frame_none"], theme: "theme_default", frame: "frame_none" };

  if (!u.cosmetics.owned.includes(itemId)) {
    return { success: false, error: "คุณยังไม่มีไอเทมนี้ กรุณาแลกก่อน" };
  }

  if (item.type === "theme") u.cosmetics.theme = itemId;
  else if (item.type === "frame") u.cosmetics.frame = itemId;

  save(data);
  return { success: true, cosmetics: u.cosmetics };
}

// ═══════════════════════════════════════════════════════════════
//  👥  ระบบติดตาม (follow) — เก็บแค่ "following" ของแต่ละคน
//  แล้วคำนวณ "followers" (ใครติดตามเรา) จากการไล่สแกน users ทั้งหมด
//  เพราะจำนวนผู้ใช้ไม่ได้เยอะระดับต้องทำ index แยก ทำแบบนี้พอเพียงและไม่ซับซ้อนเกินจำเป็น
// ═══════════════════════════════════════════════════════════════
function followUser(userId, targetId) {
  targetId = String(targetId);
  if (String(userId) === targetId) return { success: false, error: "ติดตามตัวเองไม่ได้" };
  const data = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  if (!data.users[targetId]) data.users[targetId] = defaultUser();
  const u = data.users[userId];
  if (!Array.isArray(u.following)) u.following = [];
  if (!u.following.includes(targetId)) u.following.push(targetId);
  save(data);
  return { success: true, following: true, followersCount: countFollowers(targetId, data) };
}

function unfollowUser(userId, targetId) {
  targetId = String(targetId);
  const data = load();
  if (!data.users[userId]) data.users[userId] = defaultUser();
  const u = data.users[userId];
  if (!Array.isArray(u.following)) u.following = [];
  u.following = u.following.filter((id) => id !== targetId);
  save(data);
  return { success: true, following: false, followersCount: countFollowers(targetId, data) };
}

function countFollowers(targetId, preloadedData) {
  const data = preloadedData || load();
  targetId = String(targetId);
  let count = 0;
  for (const uid in data.users) {
    const u = data.users[uid];
    if (Array.isArray(u.following) && u.following.includes(targetId)) count++;
  }
  return count;
}

function isFollowing(userId, targetId) {
  const data = load();
  const u = data.users[userId];
  if (!u || !Array.isArray(u.following)) return false;
  return u.following.includes(String(targetId));
}

// ── สรุปข้อมูลติดตามของคนคนหนึ่ง สำหรับแสดงในหน้าโปรไฟล์ ──
// viewerId (ถ้ามี) ใช้เช็คว่าเรากำลังติดตามคนนี้อยู่ไหม (โชว์ปุ่มติดตาม/เลิกติดตาม)
function getFollowInfo(targetId, viewerId) {
  targetId = String(targetId);
  const data = load();
  const target = data.users[targetId];
  const followingCount = target && Array.isArray(target.following) ? target.following.length : 0;
  const followersCount = countFollowers(targetId, data);
  let viewerIsFollowing = false;
  if (viewerId && data.users[viewerId] && Array.isArray(data.users[viewerId].following)) {
    viewerIsFollowing = data.users[viewerId].following.includes(targetId);
  }
  return { followersCount, followingCount, viewerIsFollowing };
}

module.exports = {
  getUser,
  canCheckin,
  doCheckin,
  refund,
  addCoins,
  getCoinsLeaderboard,
  getRoles,
  addRole,
  removeRole,
  redeemRole,
  getCustomRolePrice,
  canCreateCustomRole,
  reserveCustomRole,
  commitCustomRole,
  rollbackCustomRole,
  canGacha,
  doGacha,
  getCosmeticCatalog,
  getUserCosmetics,
  redeemCosmetic,
  equipCosmetic,
  setCosmeticPrice,
  setCosmeticSale,
  clearCosmeticSale,
  getUserBio,
  setUserBio,
  followUser,
  unfollowUser,
  isFollowing,
  getFollowInfo,
};