// ═══════════════════════════════════════════════════════════════
//  📜  SCRIPT MONITOR SYSTEM  ·  Premium Hub Edition
//  - เก็บรายการสคริปต์ (loadstring links) พร้อมข้อมูลระดับมืออาชีพ
//  - โพสต์ embed สไตล์ค่ายสคริปต์ใหญ่ ๆ ในห้องที่เลือก
//  - เช็คสถานะเป็นระยะ + ปุ่มเช็คสถานะสด + สถิติ Uptime
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs");
const path = require("path");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DATA_DIR  = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "scripts.json");

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // เช็คทุก 5 นาที (ปรับได้)
const FETCH_TIMEOUT_MS  = 10 * 1000;

// ──────────────────────────────────────────────
//  🏷️  BRAND CONFIG — แก้ตรงนี้ให้เป็นชื่อ/โลโก้ค่ายของคุณ
// ──────────────────────────────────────────────
const BRAND = {
  name: "NEXUS SCRIPT HUB",
  tagline: "Premium Roblox Script Provider",
  logoUrl: null,       // ใส่ URL โลโก้ เช่น "https://i.imgur.com/xxxx.png"
  bannerUrl: null,     // ใส่ URL แบนเนอร์ (ถ้าต้องการ setImage)
  colorOnline:  0x57F287,
  colorOffline: 0xED4245,
  colorPending: 0xFEE75C,
};

let logger;
try {
  logger = require("./logger");
} catch {
  logger = console;
}

// ──────────────────────────────────────────────
//  STORAGE
// ──────────────────────────────────────────────
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function loadScripts() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveScripts(list) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
}

// ──────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────
function extractUrl(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/https?:\/\/[^\s"')]+/i);
  return match ? match[0] : null;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Roblox/WinInet" },
    });
    const responseTime = Date.now() - startedAt;
    const body = await res.text().catch(() => "");
    const online = res.ok && body.trim().length > 0;

    return {
      online,
      statusCode: res.status,
      responseTime,
      error: online ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      online: false,
      statusCode: null,
      responseTime: Date.now() - startedAt,
      error: err.name === "AbortError" ? "Timeout" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function uptimePercent(entry) {
  if (!entry.checksTotal) return null;
  return Math.round((entry.checksOnline / entry.checksTotal) * 1000) / 10; // ทศนิยม 1 ตำแหน่ง
}

// ──────────────────────────────────────────────
//  EMBED & COMPONENTS  (สไตล์ค่ายใหญ่)
// ──────────────────────────────────────────────
function buildEmbed(entry) {
  const isPending = entry.lastStatus === null;
  const color = isPending
    ? BRAND.colorPending
    : entry.lastStatus
      ? BRAND.colorOnline
      : BRAND.colorOffline;

  const statusText = isPending
    ? "⏳ กำลังตรวจสอบ..."
    : entry.lastStatus
      ? "🟢 ออนไลน์ — ใช้งานได้ปกติ"
      : `🔴 ออฟไลน์ — ${entry.lastError || "ไม่ทราบสาเหตุ"}`;

  const keyText = entry.hasKey
    ? `🔑 **ต้องใช้คีย์**${entry.keyNote ? `\n> ${entry.keyNote}` : ""}`
    : "🆓 **ไม่ต้องใช้คีย์ (Key-less)**";

  const uptime = uptimePercent(entry);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${BRAND.name} · ${BRAND.tagline}`,
      iconURL: BRAND.logoUrl || undefined,
    })
    .setTitle(`✨ ${entry.name}`)
    .setDescription(
      `${entry.description ? `${entry.description}\n\n` : ""}` +
      `\`\`\`lua\n${entry.rawScript}\n\`\`\``
    )
    .addFields(
      { name: "📡 สถานะ", value: statusText, inline: true },
      { name: "🕹️ หมวดหมู่ / เกม", value: entry.category || "Universal", inline: true },
      { name: "📦 เวอร์ชัน", value: entry.version || "Latest", inline: true },
      { name: "🔐 การเข้าถึง", value: keyText, inline: false },
      {
        name: "📊 Uptime",
        value: uptime !== null ? `${uptime}% (${entry.checksOnline}/${entry.checksTotal} ครั้ง)` : "ยังไม่มีข้อมูล",
        inline: true,
      },
      {
        name: "🕓 เช็คล่าสุด",
        value: entry.lastCheckedAt ? `<t:${Math.floor(entry.lastCheckedAt / 1000)}:R>` : "ยังไม่เคยเช็ค",
        inline: true,
      },
      { name: "👤 เพิ่มโดย", value: `<@${entry.addedBy}>`, inline: true }
    )
    .setFooter({ text: `${BRAND.name} · Script ID: ${entry.id}` })
    .setTimestamp();

  if (entry.imageUrl) embed.setImage(entry.imageUrl);
  else if (BRAND.bannerUrl) embed.setImage(BRAND.bannerUrl);
  if (BRAND.logoUrl) embed.setThumbnail(BRAND.logoUrl);

  return embed;
}

function buildButtons(entry) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`scriptcheck_${entry.id}`)
      .setLabel("🔄 เช็คสถานะใหม่")
      .setStyle(ButtonStyle.Secondary)
  );
  return row;
}

// ──────────────────────────────────────────────
//  CORE ACTIONS
// ──────────────────────────────────────────────
async function addScript(client, data) {
  const {
    name, description, category, version,
    hasKey, keyNote, rawScript,
    channelId, guildId, addedBy,
    imageUrl,
  } = data;

  const url = extractUrl(rawScript);
  if (!url) throw new Error("ไม่พบลิงก์ http/https ในสคริปต์ที่ให้มา");

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error("ห้องที่เลือกใช้งานไม่ได้ หรือไม่ใช่ห้องข้อความ");

  const entry = {
    id: genId(),
    name: name || "สคริปต์ไม่มีชื่อ",
    description: description || "",
    category: category || "Universal",
    version: version || "",
    hasKey: !!hasKey,
    keyNote: keyNote || "",
    imageUrl: imageUrl || null,
    rawScript,
    url,
    channelId,
    guildId,
    messageId: null,
    addedBy,
    addedAt: Date.now(),
    lastStatus: null,
    lastCheckedAt: null,
    lastError: null,
    lastResponseTime: null,
    checksTotal: 0,
    checksOnline: 0,
  };

  const msg = await channel.send({ embeds: [buildEmbed(entry)], components: [buildButtons(entry)] });
  entry.messageId = msg.id;

  const list = loadScripts();
  list.push(entry);
  saveScripts(list);

  checkOne(client, entry.id).catch(() => {});

  return entry;
}

function listScripts(guildId) {
  const all = loadScripts();
  return guildId ? all.filter((s) => s.guildId === guildId) : all;
}

async function removeScript(id) {
  const list = loadScripts();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveScripts(list);
  return true;
}

async function checkOne(client, id) {
  const list = loadScripts();
  const entry = list.find((s) => s.id === id);
  if (!entry) return null;

  const result = await checkUrl(entry.url);
  entry.lastStatus       = result.online;
  entry.lastCheckedAt    = Date.now();
  entry.lastError        = result.error;
  entry.lastResponseTime = result.responseTime;
  entry.checksTotal      = (entry.checksTotal || 0) + 1;
  if (result.online) entry.checksOnline = (entry.checksOnline || 0) + 1;
  saveScripts(list);

  try {
    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
      if (msg) await msg.edit({ embeds: [buildEmbed(entry)], components: [buildButtons(entry)] });
    }
  } catch (err) {
    logger.warn?.(`[SCRIPT-MONITOR] อัปเดต embed ไม่ได้ (${entry.name}): ${err.message}`);
  }

  return { entry, result };
}

async function checkAll(client) {
  const list = loadScripts();
  for (const entry of list) {
    const prevStatus = entry.lastStatus;
    const out = await checkOne(client, entry.id);
    if (out && prevStatus === true && out.result.online === false) {
      logger.warn?.(`[SCRIPT-MONITOR] ⚠️ "${entry.name}" เพิ่งล่มไป!`);
    }
  }
}

function startScriptMonitor(client) {
  ensureStore();
  logger.info?.(`[SCRIPT-MONITOR] เริ่มระบบตรวจสอบสคริปต์ (ทุก ${CHECK_INTERVAL_MS / 60000} นาที)`);

  setTimeout(() => checkAll(client).catch((e) => logger.error?.(e.message)), 10 * 1000);

  setInterval(() => {
    checkAll(client).catch((e) => logger.error?.(`[SCRIPT-MONITOR] ${e.message}`));
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  addScript,
  removeScript,
  listScripts,
  checkOne,
  checkAll,
  startScriptMonitor,
  buildEmbed,
  buildButtons,
  extractUrl,
  BRAND,
};
