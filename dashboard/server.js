// ═══════════════════════════════════════════════════════════════
//  🌐  WEB DASHBOARD SERVER  —  Express REST API + Static
//  📋  PATCH: + ระบบ Web Logs แจ้งเตือนเข้า Discord
//  🔒  PATCH: + ระบบบังคับเข้าเซิร์ฟเวอร์ Discord ก่อนใช้งานเว็บ (Guild Gate)
//  🗑️  PATCH: เพลงที่โดนแบนจะถูกลบออกจากระบบทันที (ไม่ mark banned เก็บไว้แล้ว)
//  🧾  PATCH: + ประวัติธุรกรรมเหรียญ / รูป preview คอสเมติก / กราฟแนวโน้ม /
//             badge แจ้งเตือนแท็บ / ยืนยัน 2 ชั้นสำหรับ action เสี่ยงสูง
// ═══════════════════════════════════════════════════════════════
const express         = require("express");
const path            = require("path");
const session         = require("express-session");
const passport        = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const db              = require("../utils/database");
const checkinDB       = require("../utils/checkinDB");
const uploaderStore   = require("../utils/uploaderStore");
const logger          = require("../utils/logger");
const cfg             = require("../config");
const axios            = require("axios");
const rateLimit        = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const helmet          = require("helmet");
const webpush          = require("web-push");
const commentStore    = require("../utils/commentStore");
const apiKeyStore     = require("../utils/apiKeyStore");
const webUserStore    = require("../utils/webUserStore");
const ipBanStore      = require("../utils/ipBanStore"); // 🚫 PATCH: ระบบแบน IP ผู้ใช้ทั้งเครื่อง
const userBanStore    = require("../utils/userBanStore"); // 🚫 PATCH: ระบบแบนผู้ใช้ตาม Discord ID
const coinHistoryStore = require("../utils/coinHistoryStore"); // 🧾 PATCH: ประวัติธุรกรรมเหรียญ
const firstSeenStore   = require("../utils/firstSeenStore");   // 🆕 PATCH: วันแรกที่แต่ละคน login (ใช้ทำกราฟผู้ใช้ใหม่)
const fs               = require("fs"); // ย้ายขึ้นมาบนสุด เพราะตอนนี้ใช้ตั้งแต่ส่วนแคชปกเพลงแล้ว

// Node 18+ มี fetch built-in, ถ้าต่ำกว่าให้ติดตั้ง node-fetch
const nodeFetch = globalThis.fetch ?? (() => { try { return require("node-fetch"); } catch { return null; } })();
const apiFetch  = nodeFetch || globalThis.fetch;

// ── ฟังก์ชันตรวจ Roblox ban (server-side) ───────────────────
async function checkRobloxBan(songId) {
  const TIMEOUT_MS = 7000;

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    const res = await apiFetch(
      `https://assetdelivery.roblox.com/v1/asset/?id=${encodeURIComponent(songId)}`,
      {
        signal:  ctrl.signal,
        headers: {
          "User-Agent":       "Roblox/WinInet",
          "Accept":           "*/*",
          "Accept-Encoding":  "identity",
        },
        redirect: "follow",
      }
    );
    clearTimeout(tid);

    if (res.status === 403) {
      return { banned: true, reason: "HTTP 403 – asset moderated by Roblox" };
    }
    if (res.status === 404) {
      return { banned: true, reason: "HTTP 404 – asset not found" };
    }
    if (res.status === 400) {
      return { banned: true, reason: "HTTP 400 – invalid asset ID" };
    }
    if (res.status === 200) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("audio") || ct.includes("octet-stream")) {
        return { banned: false, reason: "ok" };
      }
      return { banned: true, reason: `Unexpected content-type: ${ct}` };
    }
    return { banned: false, reason: `HTTP ${res.status} – assumed ok` };

  } catch (err) {
    if (err.name === "AbortError") {
      return { banned: false, reason: "timeout – assumed ok" };
    }
    throw new Error(`Roblox fetch failed: ${err.message}`);
  }
}

// ── ดึงชื่อเพลงจริงจาก Roblox (ใช้ตอนอัพเพลงผ่านเว็บ — ไม่ต้องให้ผู้ใช้พิมพ์ชื่อเอง) ──
// ใช้ API เก่าของ Roblox (marketplace/productinfo) ซึ่งยังใช้งานได้กับ asset ทั่วไป
// รวมถึงไฟล์เสียง คืนชื่อจริงที่ตั้งไว้ตอนอัพขึ้น Roblox
async function fetchRobloxAssetInfo(assetId) {
  try {
    const { data } = await axios.get("https://api.roblox.com/marketplace/productinfo", {
      params:  { assetId },
      timeout: 6000,
    });
    const name = typeof data?.Name === "string" ? data.Name.trim() : "";
    return { name: name || null };
  } catch (err) {
    logger.web?.(`[AssetInfo] ดึงชื่อเพลง ${assetId} ไม่สำเร็จ: ${err.message}`);
    return { name: null };
  }
}

// ── ระบบเล่นเพลงในเว็บ: โหลดไฟล์เสียงจาก Roblox ผ่าน axios (เสถียรกว่า fetch/undici) ──
// + แคชในหน่วยความจำ กันโหลดซ้ำ/ลด error จากการยิง request ไปหา Roblox บ่อยเกินไป
const audioCache        = new Map(); // songId -> { buffer, contentType, ts }
const AUDIO_CACHE_TTL   = 5 * 60 * 1000;  // เก็บแคช 5 นาที (ลดจาก 15 นาที)
const AUDIO_CACHE_MAX   = 15;              // เก็บสูงสุด 15 เพลง (ลดจาก 80 — ไฟล์เสียงแต่ละไฟล์กินหน่วยความจำหลาย MB
                                            // ถ้าเก็บ 80 ไฟล์พร้อมกันอาจกิน RAM ได้เป็นร้อย MB จนเกินโควต้าโฮสต์)

function getCachedAudio(id) {
  const hit = audioCache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.ts > AUDIO_CACHE_TTL) { audioCache.delete(id); return null; }
  return hit;
}
function setCachedAudio(id, buffer, contentType) {
  if (audioCache.size >= AUDIO_CACHE_MAX) {
    const oldestKey = audioCache.keys().next().value;
    audioCache.delete(oldestKey);
  }
  audioCache.set(id, { buffer, contentType, ts: Date.now() });
}

// ── ปกเพลง (cover art) ───────────────────────────────────────
//  ดึงจาก Roblox โดยตรงก่อนเป็นอันดับแรก (thumbnails.roblox.com รองรับ asset
//  ทุกประเภทรวมถึง Audio — ถ้าคนอัพเพลงตั้งรูปปกไว้ตอนอัพขึ้น Roblox จะได้ปกจริง)
//  ถ้า Roblox ไม่มีรูปให้ (สถานะ Error/Blocked หรือเป็นไอคอนเริ่มต้น) ค่อย fallback
//  ไปเดาจากชื่อเพลงผ่าน iTunes Search API (ไม่ต้องใช้ API key) แทน
//
//  💾 PATCH: เพลงที่ "เจอปกแล้ว" จะแคชแบบไม่มีวันหมดอายุ (ttl: Infinity) + เซฟลงไฟล์
//  cover-cache.json ด้วย กันบอท restart แล้วต้องไปถามซ้ำใหม่ทั้งคลัง — ข้อมูลที่เก็บคือ
//  แค่ "URL รูป" (string สั้นๆ) เท่านั้น ไม่ได้โหลดไฟล์ภาพมาเก็บเอง จึงกินพื้นที่น้อยมาก
//  (หลักพัน-หมื่นเพลง ก็ยังแค่ไม่กี่ MB) ส่วนเพลงที่ "ยังไม่เจอปก" (เช่น Roblox ยัง Pending)
//  ยังคงแคชสั้นๆ แค่ 15 นาทีในหน่วยความจำเหมือนเดิม ไม่เซฟลงไฟล์ เพื่อให้ลองใหม่ได้เรื่อยๆ
const coverCache      = new Map(); // songId -> { url: string|null, ts, ttl }  ttl:Infinity = ถาวร
const COVER_CACHE_TTL_MISS = 15 * 60 * 1000; // 15 นาที (ยังไม่เจอปก/Roblox ยัง Pending — แคชสั้นๆ)
const COVER_CACHE_MAX = 5000; // เพดานจำนวนเพลงที่เก็บใน memory (กัน RAM บวมถ้าคลังเพลงใหญ่มากๆ)
const COVER_CACHE_FILE = path.join(__dirname, "..", "data", "cover-cache.json");

function loadCoverCacheFromDisk() {
  try {
    if (!fs.existsSync(COVER_CACHE_FILE)) return;
    const raw    = fs.readFileSync(COVER_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    let loaded = 0;
    for (const [id, url] of Object.entries(parsed)) {
      if (typeof url === "string" && url) {
        coverCache.set(id, { url, ts: Date.now(), ttl: Infinity });
        loaded++;
      }
    }
    logger.web?.(`[CoverArt] โหลดแคชปกเพลงจากไฟล์แล้ว — ${loaded} เพลง`);
  } catch (err) {
    logger.error(`[CoverArt] โหลดแคชปกจากไฟล์ไม่สำเร็จ: ${err.message}`);
  }
}

// เขียนไฟล์แบบ debounce (รวมหลายเพลงที่เจอปกใกล้ๆ กันแล้วเซฟทีเดียว) กันเขียนไฟล์รัวๆ
// ตอนสแกน/อัพเพลงเข้ามาทีละเยอะๆ
let coverCacheSaveTimer = null;
function scheduleCoverCacheSave() {
  if (coverCacheSaveTimer) return;
  coverCacheSaveTimer = setTimeout(() => {
    coverCacheSaveTimer = null;
    saveCoverCacheToDisk();
  }, 5000);
}
function saveCoverCacheToDisk() {
  try {
    const obj = {};
    for (const [id, entry] of coverCache) {
      if (entry.ttl === Infinity && entry.url) obj[id] = entry.url; // เก็บเฉพาะปกที่เจอจริงถาวร
    }
    fs.mkdirSync(path.dirname(COVER_CACHE_FILE), { recursive: true });
    fs.writeFileSync(COVER_CACHE_FILE, JSON.stringify(obj), "utf-8");
  } catch (err) {
    logger.error(`[CoverArt] บันทึกแคชปกลงไฟล์ไม่สำเร็จ: ${err.message}`);
  }
}
loadCoverCacheFromDisk(); // โหลดตั้งแต่ตอนบอทเริ่มทำงาน ก่อนมีใครเข้าเว็บด้วยซ้ำ

function getCachedCover(id) {
  const hit = coverCache.get(id);
  if (!hit) return undefined;
  if (hit.ttl !== Infinity && Date.now() - hit.ts > hit.ttl) { coverCache.delete(id); return undefined; }
  return hit.url;
}
function setCachedCover(id, url) {
  // เจอปกจริง → แคชถาวร (ttl: Infinity) + เซฟลงไฟล์ / ไม่เจอ (รวมถึง Pending) → แคชสั้น 15 นาทีใน memory เฉยๆ
  const ttl = url ? Infinity : COVER_CACHE_TTL_MISS;

  if (coverCache.size >= COVER_CACHE_MAX && !coverCache.has(id)) {
    // ตอนใกล้เต็มเพดาน ไล่ลบตัวที่เป็นแคช "miss" ชั่วคราวออกก่อน (ของถาวรที่เจอปกแล้วไม่ควรโดนเบียด)
    const missKey = [...coverCache.entries()].find(([, v]) => v.ttl !== Infinity)?.[0];
    coverCache.delete(missKey ?? coverCache.keys().next().value);
  }

  coverCache.set(id, { url, ts: Date.now(), ttl });
  if (ttl === Infinity) scheduleCoverCacheSave();
}

// 🗑️ PATCH: ลบปกเพลงออกจากแคช (memory + ไฟล์ cover-cache.json) — เรียกทุกครั้งที่เพลง
// ถูกลบออกจากระบบเพราะโดนแบน เพลงที่ไม่มีอยู่ในคลังแล้วไม่จำเป็นต้องเก็บปกไว้อีกต่อไป
// กันไฟล์ cover-cache.json บวมขึ้นเรื่อยๆ แบบไม่มีวันเล็กลง (เดิม coverCache แคชแบบ
// ttl: Infinity เมื่อเจอปกแล้ว จึงไม่เคยถูกล้างเองแม้เพลงจะถูกลบไปแล้วก็ตาม)
function removeCachedCover(id) {
  if (coverCache.delete(id)) scheduleCoverCacheSave();
}

// Roblox ใช้รูปเดียวกัน (hash เดิม) เป็น "ไอคอนเริ่มต้น" ให้กับ asset ที่ไม่มีรูปปกตั้งไว้
// เก็บ hash นี้ไว้เทียบ กันเอาไอคอนกลางๆ ที่ไม่ใช่ปกจริงมาโชว์เป็นปกเพลง
const ROBLOX_PLACEHOLDER_HASHES = new Set([
  "e7d1420dd3f1a2e2984c1e8c2fbcc891", // ไอคอนเริ่มต้นของ Audio ที่ไม่มีปก (พบบ่อยสุด)
]);

// thumbnails.roblox.com เป็น async job: ถ้า thumbnail ยังไม่เคยถูกสร้างมาก่อน (เช่นเพลง
// เพิ่งอัพใหม่) รอบแรกจะได้ state "Pending" กลับมาแทน "Completed" ทันที ต้องขอซ้ำอีก
// สักครู่ถึงจะได้รูปจริง ไม่ใช่ไม่มีรูปเลย — เดิมโค้ดถือว่า Pending = ไม่มีปก แล้วแคช null
// ไว้ยาว 24 ชม. ทำให้เพลงใหม่ไม่มีวันได้ปกเลยจนกว่าแคชจะหมดอายุ
const THUMBNAIL_RETRY_ATTEMPTS = 3;
const THUMBNAIL_RETRY_DELAY_MS = 700;

async function fetchRobloxThumbnail(assetId) {
  for (let attempt = 1; attempt <= THUMBNAIL_RETRY_ATTEMPTS; attempt++) {
    try {
      const { data } = await axios.get("https://thumbnails.roblox.com/v1/assets", {
        params: {
          assetIds:   assetId,
          size:       "250x250",
          format:     "Png",
          isCircular: false,
        },
        timeout: 6000,
      });
      const hit = data?.data?.[0];

      // Roblox ยังไม่สร้างรูปเสร็จ (asset เพิ่งอัพใหม่) — รอสั้นๆ แล้วขอซ้ำอัตโนมัติ
      if (hit?.state === "Pending") {
        if (attempt < THUMBNAIL_RETRY_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, THUMBNAIL_RETRY_DELAY_MS * attempt));
          continue;
        }
        return null; // ลองครบจำนวนแล้วยังไม่เสร็จ — ปล่อยให้ fallback ไป iTunes และแคชสั้นๆ
      }

      if (!hit || hit.state !== "Completed" || !hit.imageUrl) return null;

      // เช็คว่าเป็นไอคอนเริ่มต้นแบบกลางๆ ไหม (ไม่ใช่ปกจริงที่คนอัพตั้งไว้)
      const isPlaceholder = [...ROBLOX_PLACEHOLDER_HASHES].some((h) => hit.imageUrl.includes(h));
      if (isPlaceholder) return null;

      return hit.imageUrl;
    } catch (err) {
      logger.web?.(`[CoverArt] Roblox thumbnail lookup failed for ${assetId}: ${err.message}`);
      return null;
    }
  }
  return null;
}

function cleanSongTitleForSearch(name) {
  return String(name || "")
    .replace(/^[\s\-–—•.]+/, "")                 // ตัดขีด/จุดนำหน้าชื่อ เช่น "- ทหารแบกปืน"
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")        // ตัดวงเล็บ/แท็กในชื่อ เช่น (Official), [Slowed]
    .replace(/\b(id|sound\s*id|roblox)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
async function resolveCoverArtByName(songName) {
  const term = cleanSongTitleForSearch(songName);
  if (!term) return null;
  try {
    const { data } = await axios.get("https://itunes.apple.com/search", {
      params: { term, media: "music", entity: "song", limit: 1 },
      timeout: 6000,
    });
    const hit = data?.results?.[0];
    if (!hit?.artworkUrl100) return null;
    // ขอไซซ์ใหญ่ขึ้นจากลิงก์ 100x100 เริ่มต้น
    return hit.artworkUrl100.replace("100x100bb", "600x600bb");
  } catch (err) {
    logger.web?.(`[CoverArt] iTunes lookup failed for "${term}": ${err.message}`);
    return null;
  }
}

// รวมสองแหล่ง: ลอง Roblox (ตรงตาม ID) ก่อน ถ้าไม่มีค่อย fallback ไปเดาจากชื่อเพลง
async function resolveCoverArt(songId, songName) {
  const fromRoblox = await fetchRobloxThumbnail(songId);
  if (fromRoblox) return fromRoblox;
  return resolveCoverArtByName(songName);
}

async function downloadRobloxAudioBuffer(songId, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  try {
    const res = await axios.get(
      `https://assetdelivery.roblox.com/v1/asset/?id=${encodeURIComponent(songId)}`,
      {
        headers: {
          "User-Agent":      "Roblox/WinInet",
          "Accept":          "*/*",
          "Accept-Encoding": "identity",
        },
        timeout:       12000,
        maxRedirects:  10,
        responseType:  "arraybuffer",
        validateStatus: () => true,
      }
    );

    if (res.status === 403 || res.status === 404 || res.status === 400) {
      return { ok: false, status: 404, error: "เพลงนี้โดนแบนหรือไม่พบไฟล์เสียงบน Roblox" };
    }
    // 401 = Roblox จำกัดสิทธิ์การเข้าถึงไฟล์นี้จากภายนอก (ไม่ใช่โดนแบน) — บาง asset ผู้สร้าง
    // ตั้งค่าไว้แบบนี้ ทำให้ยังใช้ SoundId ในเกม Roblox ได้ปกติ แต่ดาวน์โหลดตรงผ่าน
    // assetdelivery.roblox.com แบบนี้ไม่ได้ ไม่มีทางสำเร็จถ้าลองซ้ำ จึงตอบกลับทันทีโดยไม่ retry
    if (res.status === 401) {
      return { ok: false, status: 401, error: "เพลงนี้ Roblox จำกัดสิทธิ์ให้ฟังนอกเกมไม่ได้ (ยังใช้ในเกมได้ตามปกติ)" };
    }
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentType = res.headers["content-type"] || "";
    if (!contentType.includes("audio") && !contentType.includes("octet-stream")) {
      return { ok: false, status: 415, error: "ไฟล์นี้ไม่ใช่ไฟล์เสียง เพลงนี้อาจโดนแบนไปแล้ว" };
    }

    const buffer = Buffer.from(res.data);
    if (!buffer.length) throw new Error("ไฟล์เสียงว่างเปล่า");

    return {
      ok: true,
      buffer,
      contentType: contentType.includes("octet-stream") ? "audio/mpeg" : contentType,
    };
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 400 * attempt)); // backoff แล้วลองใหม่
      return downloadRobloxAudioBuffer(songId, attempt + 1);
    }
    logger.error(`[AudioProxy] download failed for ${songId}: ${err.message}`);
    return { ok: false, status: 502, error: "โหลดเสียงล้มเหลวหลายครั้ง กรุณาลองใหม่ภายหลัง" };
  }
}

async function streamRobloxAudio(songId, req, res) {
  try {
    let entry = getCachedAudio(songId);

    if (!entry) {
      const result = await downloadRobloxAudioBuffer(songId);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      entry = { buffer: result.buffer, contentType: result.contentType };
      setCachedAudio(songId, result.buffer, result.contentType);
    }

    const { buffer, contentType } = entry;

    // รองรับ Range request (กด seek/เลื่อนเพลง) จากแคชในหน่วยความจำโดยตรง
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end   = match[2] ? parseInt(match[2], 10) : buffer.length - 1;
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= buffer.length) end = buffer.length - 1;
        if (start > end) { start = 0; end = buffer.length - 1; }

        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${buffer.length}`);
        res.setHeader("Content-Length", end - start + 1);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.end(buffer.subarray(start, end + 1));
      }
    }

    res.status(200);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(buffer);
  } catch (err) {
    logger.error(`[AudioProxy] ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: "โหลดเสียงล้มเหลว กรุณาลองใหม่ภายหลัง" });
  }
}

// ══════════════════════════════════════════════════════════════
//  📋  WEB LOG SYSTEM — ส่ง embed แจ้งเตือนเข้า Discord
// ══════════════════════════════════════════════════════════════
async function sendWebLog(client, { title, color, fields, thumbnail }) {
  try {
    const channelId = cfg.WEB_LOG_CHANNEL_ID || process.env.WEB_LOG_CHANNEL_ID;
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(color || "#a855f7")
      .setTitle(title)
      .addFields(fields)
      .setTimestamp()
      .setFooter({ text: "🌐 Song-ID Dashboard · Web Activity Log" });

    if (thumbnail) embed.setThumbnail(thumbnail);

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error(`[WebLog] ${err.message}`);
  }
}

function avatarUrlServer(user) {
  if (user.avatar) {
    const ext = user.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }
  try {
    const idx = (BigInt(user.id) >> BigInt(22)) % BigInt(6);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

// ── ดึงกรอบโปรไฟล์ที่ผู้ใช้คนนี้ "สวมใส่อยู่ตอนนี้" (real-time, ไม่ใช่ snapshot ตอนบันทึก) ──
// ใช้ตรงนี้แทนการฝัง frameId ไว้ตอนสร้างข้อมูล เพื่อให้กรอบที่โชว์อัปเดตทันทีที่ผู้ใช้เปลี่ยนกรอบใหม่
// และไม่ต้องพึ่งว่า store เดิม (เช่น commentStore) จะยอมเก็บฟิลด์ใหม่ๆที่ไม่รู้จักหรือไม่
function currentFrameOf(userId) {
  if (!userId) return { frameId: null, frameName: null };
  try {
    const frameId = checkinDB.getUserCosmetics(userId)?.frame || null;
    if (!frameId) return { frameId: null, frameName: null };
    const frameItem = checkinDB.getCosmeticCatalog().find((c) => c.id === frameId);
    return { frameId: frameItem?.id || null, frameName: frameItem?.name || null };
  } catch {
    return { frameId: null, frameName: null };
  }
}

// ── ฟังก์ชันเดา country จาก IP ผู้เข้าชม ──────────────────────────
// ใช้ ip-api.com (ฟรี ไม่ต้อง API key) ผ่าน axios ที่มีอยู่แล้วในโปรเจกต์
// แทน geoip-lite เพราะโฮสต์บางที่ (เช่น Pterodactyl panel) ไม่มีช่องให้รัน
// `npm install` เพิ่มเอง — วิธีนี้ไม่ต้องติดตั้งอะไรใหม่เลย
// + แคชผลต่อ IP ไว้ 6 ชม. กันยิงถล่ม ip-api.com (limit ฟรี 45 ครั้ง/นาที)
const ipCountryCache = new Map(); // ip -> { country, ts }
const IP_COUNTRY_TTL  = 6 * 60 * 60 * 1000;

async function lookupCountry(req) {
  try {
    let ip = req.ip || req.connection?.remoteAddress || "";
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    if (!ip || ip === "::1" || ip === "127.0.0.1") return null; // localhost ไม่มีข้อมูลประเทศ

    const cached = ipCountryCache.get(ip);
    if (cached && Date.now() - cached.ts < IP_COUNTRY_TTL) return cached.country;

    const res = await axios.get(`http://ip-api.com/json/${encodeURIComponent(ip)}`, {
      params:  { fields: "status,countryCode" },
      timeout: 3000,
    });

    const country = res.data?.status === "success" ? res.data.countryCode : null;
    ipCountryCache.set(ip, { country, ts: Date.now() });
    return country;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  💾  SIMPLE FILE-BASED SESSION STORE (ไม่ต้อง npm install เพิ่ม)
//  เก็บ session แต่ละอันเป็น 1 ไฟล์ .json ใน data/sessions/
//  รอดจากการรีสตาร์ทบอท (ต่างจาก MemoryStore เริ่มต้นของ express-session)
// ══════════════════════════════════════════════════════════════
class SimpleFileStore extends session.Store {
  constructor(opts = {}) {
    super();
    this.dir = opts.dir;
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(sid) {
    const safe = String(sid).replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }

  get(sid, cb) {
    fs.readFile(this._file(sid), "utf-8", (err, data) => {
      if (err) return cb(null, null); // ไม่มีไฟล์ → ไม่มี session (ต้อง login ใหม่)
      try {
        const parsed = JSON.parse(data);
        if (parsed.expires && Date.now() > parsed.expires) {
          this.destroy(sid, () => {});
          return cb(null, null);
        }
        cb(null, parsed.session);
      } catch {
        cb(null, null);
      }
    });
  }

  set(sid, sessionData, cb) {
    const maxAge  = sessionData.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
    const payload = JSON.stringify({ session: sessionData, expires: Date.now() + maxAge });
    fs.writeFile(this._file(sid), payload, "utf-8", (err) => cb && cb(err));
  }

  destroy(sid, cb) {
    fs.unlink(this._file(sid), () => cb && cb());
  }

  touch(sid, sessionData, cb) {
    this.set(sid, sessionData, cb);
  }
}

// ══════════════════════════════════════════════════════════════
//  🔔  BROWSER PUSH NOTIFICATIONS — แจ้งเตือนทันทีที่มีเพลงใหม่เข้าคลัง
//  (ไม่ต้องเปิดเว็บค้างไว้ — ทำงานผ่าน Service Worker + Web Push API)
//
//  วิธีเปิดใช้งาน:
//   1) npm install web-push
//   2) สร้าง VAPID key คู่หนึ่งครั้งเดียว: npx web-push generate-vapid-keys
//   3) ใส่ VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ไว้ใน config.js หรือ .env
// ══════════════════════════════════════════════════════════════
const PUSH_SUB_FILE = path.join(__dirname, "..", "data", "push-subscriptions.json");

const VAPID_PUBLIC_KEY  = cfg.VAPID_PUBLIC_KEY  || process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE_KEY = cfg.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || "";
const VAPID_CONTACT     = cfg.VAPID_CONTACT_EMAIL || process.env.VAPID_CONTACT_EMAIL || "mailto:admin@example.com";

let pushReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushReady = true;
  } catch (err) {
    logger.error(`[Push] ตั้งค่า VAPID ไม่สำเร็จ: ${err.message}`);
  }
} else {
  logger.error("[Push] ยังไม่ได้ตั้งค่า VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — ระบบแจ้งเตือนเพลงใหม่จะปิดอยู่ (รัน `npx web-push generate-vapid-keys` เพื่อสร้างคีย์)");
}

function loadPushSubscriptions() {
  try {
    if (!fs.existsSync(PUSH_SUB_FILE)) return [];
    const raw = fs.readFileSync(PUSH_SUB_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePushSubscriptions(subs) {
  try {
    fs.mkdirSync(path.dirname(PUSH_SUB_FILE), { recursive: true });
    fs.writeFileSync(PUSH_SUB_FILE, JSON.stringify(subs, null, 2), "utf-8");
  } catch (err) {
    logger.error(`[Push] บันทึกรายชื่อผู้ติดตามไม่สำเร็จ: ${err.message}`);
  }
}

// ส่ง push แจ้งเตือนไปหาผู้ติดตามทุกคน — ลบทิ้งอัตโนมัติถ้า subscription ตายแล้ว (410/404)
async function broadcastPush(payload) {
  if (!pushReady) return;
  const subs = loadPushSubscriptions();
  if (!subs.length) return;

  const body = JSON.stringify(payload);
  const stillValid = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body);
        stillValid.push(sub);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // ผู้ใช้เลิกติดตาม/ล้าง browser data ไปแล้ว → ลบทิ้งเงียบๆ
        } else {
          logger.error(`[Push] ส่งแจ้งเตือนไม่สำเร็จ: ${err.message}`);
          stillValid.push(sub); // error ชั่วคราว เก็บ subscription ไว้ก่อน
        }
      }
    })
  );

  savePushSubscriptions(stillValid);
}

// ── เฝ้าดูเพลงใหม่ในฐานข้อมูล (poll ทุก 20 วิ) แล้วยิงแจ้งเตือนอัตโนมัติ ──
// ใช้วิธี poll แทนการ hook เข้ากับจุดเพิ่มเพลงโดยตรง เพื่อให้ทำงานได้
// ไม่ว่าเพลงจะถูกเพิ่มเข้ามาจากส่วนไหนของบอทก็ตาม (Discord command, slash command ฯลฯ)
function startNewSongPushWatcher() {
  let knownIds = new Set();
  try {
    knownIds = new Set(db.getAllSongs().map((s) => s.id));
  } catch (err) {
    logger.error(`[PushWatcher] โหลดรายการเพลงเริ่มต้นไม่สำเร็จ: ${err.message}`);
  }

  setInterval(() => {
    try {
      const all = db.getAllSongs();
      const freshSongs = all.filter((s) => !s.deleted && !knownIds.has(s.id));

      freshSongs.forEach((s) => {
        broadcastPush({
          title: "🎵 มีเพลงใหม่เข้าคลัง!",
          body: s.name || `เพลง ID ${s.id}`,
          url: "/",
          tag: `new-song-${s.id}`,
        });
      });

      knownIds = new Set(all.map((s) => s.id));
    } catch (err) {
      logger.error(`[PushWatcher] ${err.message}`);
    }
  }, 20 * 1000);
}

// ══════════════════════════════════════════════════════════════
//  🤖  AUTO BAN SCANNER — ไล่เช็คเพลงทั้งหมดในคลังเป็นระยะๆ โดยอัตโนมัติ
//  (ทำงานเองบนเซิร์ฟเวอร์ ไม่ต้องมีใครเปิดเว็บอยู่ก็ทำงาน) เพลงที่เจอว่า
//  โดนแบนจะถูกลบออกจากระบบทันที ไม่เก็บ record ไว้ — เหมือนปุ่ม "สแกนทั้งหมด"
//  บนเว็บทุกประการ แค่รันเองอัตโนมัติแทนที่จะรอมีคนกดปุ่ม
// ══════════════════════════════════════════════════════════════
const AUTO_SCAN_INTERVAL_MS = cfg.AUTO_BAN_SCAN_INTERVAL_MS || 6 * 60 * 60 * 1000; // ค่าเริ่มต้น: ทุก 6 ชั่วโมง
const AUTO_SCAN_DELAY_MS    = 250; // เว้นจังหวะระหว่างเพลงกันยิง Roblox ถล่ม

let autoScanRunning = false;

// สถานะสแกนล่าสุด (ใช้ให้หน้าแอดมิน poll ดู progress แบบเรียลไทม์ได้)
// triggeredBy: "auto" = รอบอัตโนมัติ, หรือ "admin:<discordId>" = แอดมินกดสั่งเอง
let scanProgress = {
  running:     false,
  checked:     0,
  total:       0,
  deleted:     0,
  deletedList: [],
  triggeredBy: null,
  startedAt:   null,
  finishedAt:  null,
};

async function runAutoBanScan(client, opts = {}) {
  if (autoScanRunning) return { started: false, alreadyRunning: true }; // กันสแกนซ้อนกันถ้ารอบก่อนยังไม่เสร็จ
  autoScanRunning = true;

  const songs = db.getAllSongs();
  let checked = 0;
  let deleted = 0;
  const deletedList = [];

  scanProgress = {
    running:     true,
    checked:     0,
    total:       songs.length,
    deleted:     0,
    deletedList: [],
    triggeredBy: opts.triggeredBy || "auto",
    startedAt:   Date.now(),
    finishedAt:  null,
  };

  logger.web(`[AutoBanScan] เริ่มสแกน (${scanProgress.triggeredBy}) — ทั้งหมด ${songs.length} เพลง`);

  try {
    for (const song of songs) {
      try {
        const result = await checkRobloxBan(song.id);
        if (result.banned) {
          db.deleteSong(song.id, { reason: "auto-scan" });
          removeCachedCover(song.id);
          deleted++;
          deletedList.push({ id: song.id, name: song.name, reason: result.reason });
          scanProgress.deleted = deleted;
          scanProgress.deletedList = deletedList;
          logger.web(`[AutoBanScan] ${song.id} "${song.name}" → BANNED, ลบออกจากระบบแล้ว (${result.reason})`);
        }
      } catch (err) {
        logger.error(`[AutoBanScan] เช็ค ${song.id} ไม่สำเร็จ: ${err.message}`);
      }
      checked++;
      scanProgress.checked = checked;
      await new Promise((r) => setTimeout(r, AUTO_SCAN_DELAY_MS));
    }
  } finally {
    autoScanRunning = false;
    scanProgress.running    = false;
    scanProgress.finishedAt = Date.now();
  }

  logger.web(`[AutoBanScan] สแกนเสร็จ · ตรวจ ${checked} เพลง · ลบไป ${deleted} เพลง`);

  if (deleted > 0) {
    // สรุปผลเป็น log เดียว (กันสแปมแชนแนลถ้าลบพร้อมกันหลายเพลง) — โชว์สูงสุด 10 รายการแรก
    const preview = deletedList
      .slice(0, 10)
      .map((s) => `\`${s.id}\` ${s.name}`)
      .join("\n");
    const more = deletedList.length > 10 ? `\n...และอีก ${deletedList.length - 10} เพลง` : "";

    const isManual = scanProgress.triggeredBy && scanProgress.triggeredBy.startsWith("admin:");
    sendWebLog(client, {
      title: isManual ? "🗑️ สแกนโดยแอดมิน: ลบเพลงที่โดนแบน" : "🗑️ สแกนอัตโนมัติ: ลบเพลงที่โดนแบน",
      color: "#f87171",
      fields: [
        { name: "📊 ผลสแกน", value: `ตรวจทั้งหมด ${checked} เพลง · ลบไป ${deleted} เพลง` },
        { name: "🎵 รายการที่ลบ", value: (preview + more) || "-" },
      ],
    });
  }

  return { started: true, alreadyRunning: false, checked, deleted };
}

function startAutoBanScanner(client) {
  // รอบแรกหน่วงไว้ 2 นาทีหลังบอทออนไลน์ กันชนกับตอนบอทเพิ่งเริ่มโหลดข้อมูล
  setTimeout(() => runAutoBanScan(client), 2 * 60 * 1000);
  setInterval(() => runAutoBanScan(client), AUTO_SCAN_INTERVAL_MS);
  logger.web(`[AutoBanScan] ตั้งเวลาไว้แล้ว — สแกนอัตโนมัติทุก ${Math.round(AUTO_SCAN_INTERVAL_MS / 3600000)} ชั่วโมง`);
}

// ══════════════════════════════════════════════════════════════
//  🎨  COSMETICS PREVIEW — หา URL รูป preview ของไอเทมคอสเมติกแต่ละชิ้น
//  ลองใช้ฟิลด์ที่แคตตาล็อกอาจมีอยู่แล้วก่อน (previewUrl/image/icon) ถ้าไม่มี
//  ค่อย fallback ไปเดา path จาก public/cosmetics/<id>.png (ถ้ามีไฟล์จริงอยู่)
//  ไม่เจอเลย → คืน null แล้วฝั่งหน้าเว็บจะโชว์กรอบเปล่าแทนเอง ไม่พังหน้า
// ══════════════════════════════════════════════════════════════
function resolveCosmeticPreview(item, publicDir) {
  if (item.previewUrl) return item.previewUrl;
  if (item.image) return item.image;
  if (item.icon) return item.icon;
  try {
    const guess = `${item.id}.png`;
    if (fs.existsSync(path.join(publicDir, "cosmetics", guess))) return `/cosmetics/${guess}`;
  } catch { /* ignore — fallback เป็น null ด้านล่าง */ }
  return null;
}

function startDashboard(client) {
  if (!cfg.DASHBOARD_ENABLED) return;

  const otpStore = new Map();
  const onlineVisitors = new Map(); // clientId -> lastSeen (ms) — สำหรับนับคนออนไลน์ตอนนี้
  const ONLINE_TTL_MS = 45 * 1000;  // ถือว่ายัง "ออนไลน์" ถ้า ping มาภายใน 45 วิ
  const app = express();

  // ── Security hardening ─────────────────────────────────────────
  app.set("trust proxy", 1); // เชื่อ header จาก reverse proxy ของโฮสต์ ให้เช็ค IP ผู้ใช้ถูกต้อง
  app.use(helmet({ contentSecurityPolicy: false })); // ปิด CSP ไว้ก่อน กันชนกับ inline script ของ dashboard
  app.use(express.json({ limit: "100kb" })); // จำกัดขนาด body กัน payload มหึมามาถล่ม memory

  // ดัก JSON เพี้ยน/parse ไม่ได้ ให้ตอบ 400 เฉยๆ แทนที่จะหลุดเป็น uncaught error
  app.use((err, req, res, next) => {
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      return res.status(400).json({ success: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" });
    }
    next(err);
  });

  // ── 🚫 PATCH: ระบบแบน IP — เช็คทุก request ตั้งแต่ต้นทาง ก่อนถึง route ไหนทั้งนั้น ──
  // ต้องอยู่หลัง trust proxy (เพื่อ req.ip ถูกต้องหลัง reverse proxy) แต่อยู่ก่อน
  // rate limiter/route อื่นๆ ทั้งหมด กันเครื่องที่โดนแบนยิง endpoint ไหนก็ตามผ่านเข้ามาได้
  function getClientIp(req) {
    let ip = req.ip || req.connection?.remoteAddress || "";
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    return ip;
  }
  app.use((req, res, next) => {
    const ip = getClientIp(req);
    const ban = ipBanStore.isBanned(ip);
    if (!ban) return next();

    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ success: false, error: "IP นี้ถูกระงับการเข้าถึงเว็บนี้" });
    }
    // ไม่ใช่ /api/ — เป็นการโหลดหน้าเว็บตรงๆ ตอบเป็นหน้า HTML บล็อกง่ายๆ แทน
    res.status(403).type("html").send(`
      <!doctype html><html lang="th"><meta charset="utf-8">
      <title>ถูกระงับการเข้าถึง</title>
      <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
        background:#0d0a14;color:#f1eeff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="text-align:center;padding:24px;max-width:360px;">
          <div style="font-size:40px;margin-bottom:10px;">🚫</div>
          <div style="font-size:17px;font-weight:700;margin-bottom:6px;">IP นี้ถูกระงับการเข้าถึง</div>
          <div style="font-size:13px;color:rgba(241,238,255,.6);">อุปกรณ์/เครือข่ายนี้ไม่สามารถเข้าใช้งานเว็บนี้ได้</div>
        </div>
      </body></html>
    `);
  });

  // Rate limit ทั่วไป: กัน spam/DoS ทุก endpoint ใต้ /api
  // ⚠️ เดิม max: 120/นาที ครอบคลุมทุก endpoint รวม /api/cover ด้วย (นอกจาก coverLimiter เฉพาะ
  // จุดแล้ว) ทำให้แค่โหลดปกเพลง 60 การ์ดในหน้าเดียวก็ใช้โควต้ารวมไปเกือบครึ่งแล้ว ยังไม่นับ
  // /api/songs ที่ poll ทุก 15 วิ + /api/presence/ping + อื่นๆ — เพิ่มเพดานขึ้นให้พอสำหรับ
  // การใช้งานจริงต่อผู้ใช้ 1 คน
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "คำขอถี่เกินไป กรุณาลองใหม่ภายหลัง" },
  });
  app.use("/api/", generalLimiter);

  // Rate limit เข้มขึ้นสำหรับจุดที่เสี่ยงถูกยิงถล่ม/สแปมเป็นพิเศษ
  const audioLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "กดฟังเพลงถี่เกินไป กรุณารอสักครู่" },
  });
  // เดิม max: 60/นาที ต่ำเกินไปมาก — โหมดการ์ดโชว์ 60 เพลง/หน้า และการ์ดที่อยู่ในจอ
  // (หรือใกล้จอ ด้วย rootMargin 200px) จะยิงขอปกเกือบพร้อมกันทันทีตอนโหลดหน้า/เปลี่ยนหน้า
  // ทำให้ชนเพดานตั้งแต่หน้าแรก แล้วหน้าถัดไปโดนบล็อกยาว — เพิ่มเพดานขึ้นมาก เพราะ endpoint นี้
  // มี cache ในหน่วยความจำฝั่งเซิร์ฟเวอร์อยู่แล้ว (coverCache) คำขอส่วนใหญ่ตอบจาก cache ไม่ได้ยิง
  // ไป Roblox/iTunes จริงทุกครั้ง จึงรับโหลดสูงๆ ได้โดยไม่กระทบต้นทาง
  const coverLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "ขอปกเพลงถี่เกินไป กรุณารอสักครู่" },
  });
  const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "ขอ OTP บ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
  });
  const voteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "โหวตถี่เกินไป กรุณารอสักครู่" },
  });
  // ไม่จำกัดจำนวนเพลงที่อัพได้ต่อวัน (มีระบบสแกนลบเพลงที่โดนแบน/ใช้ไม่ได้อยู่แล้ว)
  // แต่ยังจำกัด "ความถี่ในการกดส่งฟอร์ม" กันคนยิงสแปมรัวๆ
  const submitLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "ส่งเพลงถี่เกินไป กรุณารอสักครู่" },
  });

  app.use(
    session({
      store: new SimpleFileStore({
        dir: path.join(__dirname, "..", "sessions"),
      }),
      secret:            cfg.SESSION_SECRET,
      resave:            false,
      saveUninitialized: false,
      cookie:            { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: "lax" },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // ── 🚫 PATCH: บล็อกบัญชี Discord ที่โดนแบน — เช็คทุก request ที่มี session
  // login อยู่ (ไม่ว่าจะ route ไหนต้องการ auth หรือไม่ก็ตาม) ผูกกับตัวบัญชีจริง
  // สลับ IP/อุปกรณ์เท่าไหร่ก็ยังโดนบล็อกอยู่ดีตราบใดที่ login บัญชีเดิม
  app.use((req, res, next) => {
    if (!req.user?.id) return next(); // ยังไม่ login ก็ปล่อยผ่าน (จะโดน requireAuth ของแต่ละ route จัดการเอง)
    const ban = userBanStore.isBanned(req.user.id);
    if (!ban) return next();

    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ success: false, error: "บัญชีนี้ถูกระงับการเข้าถึงเว็บนี้" });
    }
    res.status(403).type("html").send(`
      <!doctype html><html lang="th"><meta charset="utf-8">
      <title>บัญชีถูกระงับ</title>
      <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
        background:#0d0a14;color:#f1eeff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="text-align:center;padding:24px;max-width:360px;">
          <div style="font-size:40px;margin-bottom:10px;">🚫</div>
          <div style="font-size:17px;font-weight:700;margin-bottom:6px;">บัญชีนี้ถูกระงับการเข้าถึง</div>
          <div style="font-size:13px;color:rgba(241,238,255,.6);">บัญชี Discord นี้ไม่สามารถใช้งานเว็บนี้ได้อีก</div>
        </div>
      </body></html>
    `);
  });

  // ── Middleware: ต้อง login ก่อน ────────────────────────────────
  function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "ต้องเข้าสู่ระบบด้วย Discord ก่อน" });
    next();
  }

  // ── Middleware: ต้องเป็นเจ้าของเซิร์ฟเวอร์ Discord เท่านั้น ─────────────
  // เช็คสด ๆ จากตัวเซิร์ฟเวอร์ Discord เลย (guild.ownerId) ไม่ต้องมาไล่กรอก ID เอง
  let ownerIdCache = null; // { id, ts }
  const OWNER_CHECK_TTL = 60 * 1000; // แคช 1 นาที กันยิง API ถล่ม

  async function getGuildOwnerId() {
    if (ownerIdCache && Date.now() - ownerIdCache.ts < OWNER_CHECK_TTL) return ownerIdCache.id;

    const guild = client.guilds.cache.get(cfg.GUILD_ID);
    if (!guild) return null;

    // ownerId มักจะอยู่ใน cache อยู่แล้ว แต่ fetch ซ้ำเผื่อเจ้าของเปลี่ยน/โอนเซิร์ฟเวอร์
    let ownerId = guild.ownerId;
    if (!ownerId) {
      const fresh = await guild.fetch().catch(() => null);
      ownerId = fresh?.ownerId || null;
    }

    ownerIdCache = { id: ownerId, ts: Date.now() };
    return ownerId;
  }

  async function requireOwner(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "ต้องเข้าสู่ระบบด้วย Discord ก่อน" });

    const ownerId = await getGuildOwnerId();
    if (!ownerId) {
      logger.error("[Security] หาเจ้าของเซิร์ฟเวอร์ Discord ไม่เจอ (เช็ค GUILD_ID / บอทอยู่ในเซิร์ฟหรือยัง)");
      return res.status(503).json({ error: "ระบบตรวจสอบเจ้าของเซิร์ฟยังไม่พร้อมใช้งาน" });
    }
    if (String(req.user.id) !== String(ownerId)) {
      return res.status(403).json({ error: "เฉพาะเจ้าของเซิร์ฟเวอร์ Discord เท่านั้น" });
    }
    next();
  }

  // ── Middleware: ต้องมี API key ของบอทเท่านั้น (สำหรับ endpoint ภายใน) ──
  function requireBotKey(req, res, next) {
    const expected = cfg.BOT_API_KEY || process.env.BOT_API_KEY;
    if (!expected) {
      logger.error("[Security] ยังไม่ได้ตั้งค่า BOT_API_KEY — ปิดการใช้งาน endpoint นี้ไว้ก่อนเพื่อความปลอดภัย");
      return res.status(503).json({ success: false, error: "ระบบยังไม่พร้อมใช้งาน" });
    }
    if (req.headers["x-api-key"] !== expected) {
      return res.status(401).json({ success: false, error: "unauthorized" });
    }
    next();
  }

  // ══════════════════════════════════════════════════════════════
  //  🔒  GUILD GATE — ต้อง login ด้วย Discord + "ยังอยู่ในเซิร์ฟเวอร์จริง"
  //  ถึงจะเข้าเว็บ/ใช้ API ได้ ถ้าออกจากเซิร์ฟเวอร์เมื่อไหร่ session จะถูก
  //  เตะทิ้งทันที ต้อง login ผ่าน Discord ใหม่ถึงจะกลับเข้าได้อีกครั้ง
  // ══════════════════════════════════════════════════════════════
  const memberCheckCache = new Map(); // userId -> { isMember, ts }
  const MEMBER_CHECK_TTL = 30 * 1000; // เช็คซ้ำทุก 30 วิ ต่อคน (กันยิง API ถล่ม)

  async function isStillGuildMember(userId) {
    const cached = memberCheckCache.get(userId);
    if (cached && Date.now() - cached.ts < MEMBER_CHECK_TTL) return cached.isMember;

    const guild = client.guilds.cache.get(cfg.GUILD_ID);
    if (!guild) return false;

    // เช็คจาก cache ก่อน (เร็ว ไม่ยิง API) — cache นี้อัพเดตอัตโนมัติทันที
    // ที่มีคนออกจากเซิร์ฟเวอร์ เพราะเปิด intent GuildMembers ไว้แล้ว
    let isMember = guild.members.cache.has(userId);

    // เผื่อ cache ยังไม่มีข้อมูล (เช่นบอทเพิ่ง restart) ลอง fetch จริงอีกที
    if (!isMember) {
      const member = await guild.members.fetch(userId).catch(() => null);
      isMember = !!member;
    }

    memberCheckCache.set(userId, { isMember, ts: Date.now() });
    return isMember;
  }

  // เคลียร์แคชทันทีเมื่อมีคนออกจากเซิร์ฟเวอร์ → ครั้งถัดไปที่เข้าเว็บจะถูกเตะออกทันที
  // (ไม่ต้องรอ TTL หมดอายุ)
  client.on("guildMemberRemove", (member) => {
    if (member.guild.id === cfg.GUILD_ID) {
      memberCheckCache.set(member.id, { isMember: false, ts: Date.now() });
    }
  });
  client.on("guildMemberAdd", (member) => {
    if (member.guild.id === cfg.GUILD_ID) {
      memberCheckCache.set(member.id, { isMember: true, ts: Date.now() });
    }
  });

  async function requireGuildMember(req, res, next) {
    if (!req.user) {
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "ต้องเข้าสู่ระบบด้วย Discord ก่อน" });
      }
      return res.redirect("/auth/discord");
    }

    const ok = await isStillGuildMember(req.user.id);
    if (!ok) {
      req.logout(() => {});
      if (req.path.startsWith("/api/")) {
        return res.status(403).json({ error: "คุณไม่ได้อยู่ในเซิร์ฟเวอร์ Discord ของเราแล้ว" });
      }
      return res.redirect("/not-member");
    }

    next();
  }

  // ── Passport ─────────────────────────────────────────────────
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));

  passport.use(
    new DiscordStrategy(
      {
        clientID:     cfg.DISCORD_CLIENT_ID,
        clientSecret: cfg.DISCORD_CLIENT_SECRET,
        callbackURL:  "http://de3.bot-hosting.net:20209/auth/discord/callback",
        scope:        ["identify"],
      },
      (accessToken, refreshToken, profile, done) => {
        process.nextTick(() => done(null, profile));
      }
    )
  );

  // ══════════════════════════════════════════════════════════════
  //  🔑  AUTH ROUTES — ต้องประกาศ "ก่อน" gate เสมอ ไม่งั้นจะวนลูป redirect
  // ══════════════════════════════════════════════════════════════
  app.get("/auth/discord", passport.authenticate("discord"));

  app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", { failureRedirect: "/" }),
    async (req, res) => {
      // เช็คทันทีหลัง login เสร็จว่าเป็นสมาชิกเซิร์ฟเวอร์จริงไหม
      const ok = await isStillGuildMember(req.user.id);
      if (!ok) {
        return res.redirect("/not-member");
      }

      // 💾 จำโปรไฟล์ไว้ ใช้จับคู่กับ "คนอัพเพลง" ในลีดเดอร์บอร์ด
      // (เพื่อโชว์รูปโปรไฟล์จริงถ้าคนอัพเพลงคนนั้นเคยเชื่อมดิสคอร์ดกับเว็บ)
      webUserStore.save({
        id:       req.user.id,
        username: req.user.username,
        avatar:   avatarUrlServer(req.user),
      });

      // 🆕 PATCH: จำวันแรกที่คนนี้เคย login ไว้ (ใช้ทำกราฟ "ผู้ใช้ใหม่ต่อวัน" ในหน้าแอดมิน
      // — webUserStore.save() ด้านบนอัปเดตทุกครั้งที่ login จึงใช้บอก "วันแรก" ไม่ได้
      // ฟังก์ชันนี้บันทึกแค่ครั้งแรกเท่านั้น เรียกซ้ำกี่ครั้งก็ไม่ทับของเดิม)
      firstSeenStore.markSeen(req.user.id);

      // 📋 LOG: มีคนเข้าเว็บ + login สำเร็จ (พร้อมรูปโปรไฟล์)
      sendWebLog(client, {
        title: "🔓 มีคนเข้าเว็บและ Login สำเร็จ",
        color: "#60a5fa",
        thumbnail: avatarUrlServer(req.user),
        fields: [
          { name: "👤 ชื่อผู้ใช้", value: `${req.user.username}` },
          { name: "🆔 User ID",   value: `${req.user.id}` },
          { name: "🔗 โปรไฟล์",   value: `<@${req.user.id}>` },
        ],
      });
      res.redirect("/");
    }
  );

  app.get("/logout", (req, res) => {
    const u = req.user;
    if (u) {
      sendWebLog(client, {
        title: "🚪 ออกจากระบบ",
        color: "#9ca3af",
        thumbnail: avatarUrlServer(u),
        fields: [
          { name: "👤 ชื่อผู้ใช้", value: `${u.username}` },
          { name: "🆔 User ID",   value: `${u.id}` },
        ],
      });
    }
    req.logout(() => res.redirect("/"));
  });

  // ── หน้าแจ้งเตือนถ้าไม่ได้อยู่ในเซิร์ฟเวอร์ (ต้องเปิดได้โดยไม่ผ่าน gate) ──
  app.get("/not-member", (_req, res) => {
    res.send(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ต้องเข้าเซิร์ฟเวอร์ก่อน</title>
      <style>
        body{background:#0d0a14;color:#f1eeff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px}
        .box{max-width:420px}
        h1{color:#f87171;font-size:22px;margin-bottom:12px}
        p{color:rgba(255,255,255,.6);line-height:1.8;font-size:14px}
        .btns{margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
        a{display:inline-block;background:#a855f7;color:#fff;text-decoration:none;
          padding:10px 20px;border-radius:10px;font-weight:700;font-size:13px}
        a.secondary{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15)}
      </style></head>
      <body><div class="box">
        <h1>🚫 คุณไม่ได้อยู่ในเซิร์ฟเวอร์ของเรา</h1>
        <p>เว็บนี้ต้องเข้าเซิร์ฟเวอร์ Discord ของเราก่อนถึงจะใช้งานได้<br>
           กรุณาเข้าเซิร์ฟเวอร์แล้วกด "เข้าสู่ระบบใหม่" อีกครั้ง</p>
        <div class="btns">
          <a href="https://discord.gg/WQePykh3yJ" target="_blank">เข้าเซิร์ฟเวอร์ Discord</a>
          <a href="/auth/discord" class="secondary">เข้าสู่ระบบใหม่</a>
        </div>
      </div></body></html>`);
  });

  // ══════════════════════════════════════════════════════════════
  //  🌍 PUBLIC API — สำหรับบอท/เว็บภายนอก อ่านข้อมูลเพลงแบบ read-only
  //  ต้องอยู่ "ก่อน" guild gate เสมอ เพราะผู้เรียกเป็น bot ภายนอก
  //  ไม่มี session Discord ของเซิร์ฟเวอร์นี้
  // ══════════════════════════════════════════════════════════════
  const publicApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.headers["x-api-key"] || ipKeyGenerator(req.ip),
    message: { error: "คำขอถี่เกินไป (จำกัด 60 ครั้ง/นาที ต่อ API key)" },
  });

  // ── นับ "คนใช้ API อยู่ตอนนี้" แบบเรียลไทม์ แยกตามคีย์ (สำหรับโชว์ในหน้าแอดมิน) ──
  //  ทุกครั้งที่มี request ผ่าน requireApiKey สำเร็จ จะบันทึก (คีย์ id + IP) + เวลาล่าสุดไว้
  //  แล้วนับ "ออนไลน์ตอนนี้" = จำนวน IP ที่ไม่ซ้ำกัน (ต่อคีย์ และรวมทุกคีย์) ที่ยิง request
  //  มาในช่วง 60 วิที่ผ่านมา (ใช้แนวคิดเดียวกับ onlineVisitors ที่นับคนเข้าเว็บหลักด้านล่าง)
  const apiOnlineVisitors = new Map(); // `${keyId}:${ip}` -> { keyId, ts }
  const API_ONLINE_TTL_MS = 60 * 1000;

  function markApiOnline(keyId, req) {
    const ip = ipKeyGenerator(req.ip);
    apiOnlineVisitors.set(`${keyId}:${ip}`, { keyId, ts: Date.now() });
  }
  function pruneApiOnline() {
    const now = Date.now();
    for (const [k, v] of apiOnlineVisitors) {
      if (now - v.ts > API_ONLINE_TTL_MS) apiOnlineVisitors.delete(k);
    }
  }
  function getApiOnlineCount() {
    pruneApiOnline();
    return apiOnlineVisitors.size;
  }
  function getApiOnlineByKey() {
    pruneApiOnline();
    const counts = {};
    for (const { keyId } of apiOnlineVisitors.values()) {
      counts[keyId] = (counts[keyId] || 0) + 1;
    }
    return counts;
  }

  function requireApiKey(req, res, next) {
    const key   = req.headers["x-api-key"];
    const keyId = key ? apiKeyStore.getKeyId(key) : null;
    if (!keyId) {
      return res.status(401).json({ error: "API key ไม่ถูกต้องหรือไม่ได้ระบุ (ใส่ header X-API-Key)" });
    }
    markApiOnline(keyId, req);
    next();
  }

  // ── API: จำนวนคนใช้ Public API อยู่ตอนนี้ (real-time, รวมและแยกตามคีย์) ──
  app.get("/api/admin/api-online", requireGuildMember, requireOwner, (_req, res) => {
    res.json({ online: getApiOnlineCount(), byKey: getApiOnlineByKey() });
  });

  app.get("/api/public/songs", publicApiLimiter, requireApiKey, (req, res) => {
    let songs = db.getAllSongs();

    if (req.query.banned === "true")  songs = songs.filter((s) => s.banned);
    if (req.query.banned === "false") songs = songs.filter((s) => !s.banned);

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    songs = songs
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
      .slice(0, limit)
      .map((s) => ({
        id:      s.id,
        name:    s.name,
        votes:   Array.isArray(s.votes) ? s.votes.length : (s.votes || 0),
        banned:  !!s.banned,
        addedAt: s.addedAt,
      }));

    res.json(songs);
  });

  // ── API-key management — เฉพาะเจ้าของเซิร์ฟเวอร์ (ต้อง login ก่อน) ──
  app.get("/api/admin/api-keys", requireGuildMember, requireOwner, (_req, res) => {
    res.json({ keys: apiKeyStore.listKeys() });
  });

  app.post("/api/admin/api-keys", requireGuildMember, requireOwner, (req, res) => {
    const result = apiKeyStore.createKey({
      label:         req.body?.label || "",
      createdBy:     req.user.id,
      expiresInDays: req.body?.expiresInDays,
    });
    // result.key คือคีย์เต็ม — จะไม่ถูกเก็บที่ไหนอีก (เก็บแค่ hash) โชว์ให้ผู้ใช้ครั้งนี้ครั้งเดียว
    res.json({ success: true, ...result });
  });

  app.delete("/api/admin/api-keys/:id", requireGuildMember, requireOwner, (req, res) => {
    const removed = apiKeyStore.revokeKey(req.params.id);
    res.json({ success: removed });
  });

  // ══════════════════════════════════════════════════════════════
  //  🛠️  ADMIN DASHBOARD API — เฉพาะเจ้าของเซิร์ฟเวอร์ Discord เท่านั้น
  //  (หน้า /admin ฝั่ง frontend เรียก endpoint กลุ่มนี้ทั้งหมด)
  // ══════════════════════════════════════════════════════════════
  const adminGate = [requireGuildMember, requireOwner];

  // ── ภาพรวม/สถิติ ────────────────────────────────────────────
  app.get("/api/admin/stats", ...adminGate, (_req, res) => {
    res.json({
      meta:             db.getMeta(),
      visitors:         db.getVisitors(),
      leaderboard:      db.getLeaderboard(10),
      recentDeletions:  db.getRecentDeletions(20),
      coinsLeaderboard: checkinDB.getCoinsLeaderboard(5),
    });
  });

  // ── ภาพรวม: กราฟแนวโน้ม (เพลงเพิ่ม/ลบต่อวัน, ผู้ใช้ใหม่ต่อวัน) ──────
  // ใช้ db.getAllSongs() (เพลงที่ยัง active, มี addedAt) รวมกับ db.getRecentDeletions()
  // (ประวัติลบ มี deletedAt) และ firstSeenStore (วันแรกที่แต่ละคน login) มาจัดกลุ่มตามวัน
  app.get("/api/admin/stats/trends", ...adminGate, (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);

      const dayKeys = [];
      const base = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        dayKeys.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
      }
      const idx = Object.fromEntries(dayKeys.map((k, i) => [k, i]));

      const songsAdded   = new Array(days).fill(0);
      const songsDeleted = new Array(days).fill(0);
      const newUsers     = new Array(days).fill(0);

      db.getAllSongs().forEach((s) => {
        const key = String(s.addedAt || "").slice(0, 10);
        if (key in idx) songsAdded[idx[key]]++;
      });

      // ดึงประวัติลบย้อนหลังมากพอให้ครอบคลุมช่วงที่เลือก (สูงสุด 90 วัน)
      const deletions = db.getRecentDeletions(3000);
      deletions.forEach((d) => {
        const key = String(d.deletedAt || "").slice(0, 10);
        if (key in idx) songsDeleted[idx[key]]++;
      });

      Object.values(firstSeenStore.getAll()).forEach((iso) => {
        const key = String(iso || "").slice(0, 10);
        if (key in idx) newUsers[idx[key]]++;
      });

      res.json({ days: dayKeys, songsAdded, songsDeleted, newUsers });
    } catch (err) {
      logger.error(`[Trends] ${err.message}`);
      res.status(500).json({ error: "โหลดข้อมูลแนวโน้มไม่สำเร็จ" });
    }
  });

  // ── badge แจ้งเตือนบนแท็บ sidebar — ตัวเลข "ต้องดู" ของแต่ละหมวด ────
  // ฝั่งนี้กำหนดเองว่านับอะไร ปรับ logic ได้ตามต้องการ ไม่มีข้อมูล = 0 เสมอ (ไม่พังหน้า)
  app.get("/api/admin/badge-counts", ...adminGate, (_req, res) => {
    try {
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

      // เพลงที่ถูกลบอัตโนมัติ (สแกน/บอทแจ้ง/ผู้ใช้ตรวจสอบ) ใน 24 ชม.ล่าสุด — เผื่อมีปัญหาผิดปกติ
      const recentDeletions = db.getRecentDeletions(200);
      const recentAutoDeleted = recentDeletions.filter((d) =>
        d.reason && d.reason !== "admin" && new Date(d.deletedAt).getTime() >= dayAgo
      ).length;

      // ไอเทมคอสเมติกที่กำลังลดราคาอยู่ตอนนี้ (เผื่อลืมยกเลิก/ต่อโปรโมชั่น)
      let cosmeticsOnSale = 0;
      try { cosmeticsOnSale = checkinDB.getCosmeticCatalog().filter((c) => c.onSale).length; } catch {}

      // API key ที่ใกล้หมดอายุภายใน 3 วัน
      let expiringKeys = 0;
      try {
        expiringKeys = apiKeyStore.listKeys().filter((k) =>
          k.expiresAt && new Date(k.expiresAt).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000
        ).length;
      } catch {}

      let ipBanCount = 0;
      try { ipBanCount = ipBanStore.listBans().length; } catch {}

      res.json({
        songs:     recentAutoDeleted,
        roles:     0,
        coins:     0,
        cosmetics: cosmeticsOnSale,
        webusers:  0,
        ipbans:    ipBanCount,
        keys:      expiringKeys,
      });
    } catch (err) {
      logger.error(`[BadgeCounts] ${err.message}`);
      res.status(500).json({ error: "โหลด badge ไม่สำเร็จ" });
    }
  });

  // ── จัดการเพลง: ค้นหา/แสดงรายการ (รองรับค้นหา + limit กันโหลดหนักถ้าคลังใหญ่) ──
  app.get("/api/admin/songs", ...adminGate, (req, res) => {
    const q     = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    let songs = q ? db.searchSongs(q) : db.getAllSongs();
    songs = songs
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
      .slice(0, limit)
      .map((s) => ({
        id:      s.id,
        name:    s.name,
        addedBy: s.addedByTag || s.addedBy,
        addedAt: s.addedAt,
        votes:   Array.isArray(s.votes) ? s.votes.length : (s.votes || 0),
      }));

    res.json({ songs, total: db.getAllSongs().length });
  });

  // ── จัดการเพลง: แก้ไขชื่อ (ใช้ฟังก์ชันเดียวกับคำสั่ง /renamesong) ──
  app.patch("/api/admin/songs/:id", ...adminGate, (req, res) => {
    const newName = String(req.body?.name || "").trim();
    if (!newName) return res.status(400).json({ success: false, error: "กรุณาระบุชื่อเพลงใหม่" });
    if (newName.length > 150) return res.status(400).json({ success: false, error: "ชื่อเพลงยาวเกินไป" });

    const result = db.renameSong(req.params.id, newName);
    if (!result.success) return res.status(404).json({ success: false, error: "ไม่พบเพลงนี้ในระบบ" });

    sendWebLog(client, {
      title: "✏️ แก้ไขชื่อเพลง (จากหน้าแอดมิน)",
      color: "#60a5fa",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🎵 ID",     value: `\`${req.params.id}\`` },
        { name: "เดิม → ใหม่", value: `${result.oldName} → ${result.newName}` },
      ],
    });

    res.json({ success: true, ...result });
  });

  // ── จัดการเพลง: ลบถาวร (แยกจากระบบลบเพราะโดนแบน — อันนี้แอดมินลบเองมือ) ──
  app.delete("/api/admin/songs/:id", ...adminGate, (req, res) => {
    const songs = db.getAllSongs();
    const song  = songs.find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ success: false, error: "ไม่พบเพลงนี้ในระบบ" });

    const ok = db.deleteSong(req.params.id, { reason: "admin", by: req.user.id });
    if (!ok) return res.status(404).json({ success: false, error: "ไม่พบเพลงนี้ในระบบ" });
    removeCachedCover(req.params.id);

    sendWebLog(client, {
      title: "🗑️ ลบเพลง (จากหน้าแอดมิน)",
      color: "#f87171",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🎵 เพลง",   value: `${song.name}\n\`${req.params.id}\`` },
      ],
    });

    res.json({ success: true });
  });

  // ── 🚫 PATCH: จัดการแบน IP — ดูรายการ / แบนใหม่ / ปลดแบน ──────────────
  app.get("/api/admin/ip-bans", ...adminGate, (_req, res) => {
    res.json({ success: true, bans: ipBanStore.listBans() });
  });

  app.post("/api/admin/ip-bans", ...adminGate, (req, res) => {
    const ip     = String(req.body?.ip || "").trim();
    const reason = String(req.body?.reason || "").trim().slice(0, 200);
    if (!ip) return res.status(400).json({ success: false, error: "กรุณาระบุ IP" });

    const result = ipBanStore.banIp(ip, { reason, bannedBy: `${req.user.username} (${req.user.id})` });
    if (!result.success) return res.status(400).json(result);

    sendWebLog(client, {
      title: "🚫 แบน IP",
      color: "#f87171",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🌐 IP",     value: `\`${result.record.ip}\`` },
        { name: "📝 เหตุผล", value: result.record.reason },
      ],
    });

    res.json({ success: true, record: result.record });
  });

  app.delete("/api/admin/ip-bans/:ip", ...adminGate, (req, res) => {
    const ok = ipBanStore.unbanIp(req.params.ip);
    if (!ok) return res.status(404).json({ success: false, error: "ไม่พบ IP นี้ในรายการแบน" });

    sendWebLog(client, {
      title: "✅ ปลดแบน IP",
      color: "#34d399",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🌐 IP",     value: `\`${req.params.ip}\`` },
      ],
    });

    res.json({ success: true });
  });

  // ── 🚫 แบนผู้ใช้ตาม Discord ID — ดูรายการ / แบนใหม่ / ปลดแบน ──────────
  // ── 👤 รายชื่อทุกคนที่เคย Login เข้าเว็บ — ดึงจาก webUserStore ที่บันทึกไว้
  // ตั้งแต่ครั้งแรกที่แต่ละคน login อยู่แล้ว จึงเห็นคนเก่าๆ ย้อนหลังได้ทันที
  // ไม่ต้องรอให้ใครสลับ logout/login ใหม่ — แนบสถานะแบนของแต่ละคนไปด้วยเลย
  app.get("/api/admin/web-users", ...adminGate, (_req, res) => {
    const users = webUserStore.getAll().map((u) => ({
      id:        u.id,
      username:  u.username,
      avatar:    u.avatar,
      updatedAt: u.updatedAt,
      banned:    !!userBanStore.isBanned(u.id),
    }));
    res.json({ success: true, users });
  });

  app.get("/api/admin/user-bans", ...adminGate, (_req, res) => {
    res.json({ success: true, bans: userBanStore.listBans() });
  });

  app.post("/api/admin/user-bans", ...adminGate, (req, res) => {
    const userId  = String(req.body?.userId || "").trim();
    const reason  = String(req.body?.reason || "").trim().slice(0, 200);
    if (!userId) return res.status(400).json({ success: false, error: "กรุณาระบุ Discord ID" });

    const result = userBanStore.banUser(userId, { reason, bannedBy: `${req.user.username} (${req.user.id})` });
    if (!result.success) return res.status(400).json(result);

    sendWebLog(client, {
      title: "🚫 แบนผู้ใช้ (Discord ID)",
      color: "#f87171",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🆔 ผู้ถูกแบน", value: `\`${userId}\`` },
        { name: "📝 เหตุผล", value: result.record.reason },
      ],
    });

    res.json({ success: true, record: result.record });
  });

  app.delete("/api/admin/user-bans/:userId", ...adminGate, (req, res) => {
    const ok = userBanStore.unbanUser(req.params.userId);
    if (!ok) return res.status(404).json({ success: false, error: "ไม่พบผู้ใช้นี้ในรายการแบน" });

    sendWebLog(client, {
      title: "✅ ปลดแบนผู้ใช้",
      color: "#34d399",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🆔 ID",     value: `\`${req.params.userId}\`` },
      ],
    });

    res.json({ success: true });
  });


  app.get("/api/admin/discord-roles", ...adminGate, (_req, res) => {
    const guild = client.guilds.cache.get(cfg.GUILD_ID);
    if (!guild) return res.status(503).json({ success: false, error: "ไม่พบเซิร์ฟเวอร์ Discord" });

    const shopRoleIds = new Set(checkinDB.getRoles().map((r) => r.id));
    const roles = guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed) // ตัด @everyone และยศที่บอท/อินทิเกรชันคุมเอง
      .map((r) => ({
        id:       r.id,
        name:     r.name,
        color:    r.hexColor,
        inShop:   shopRoleIds.has(r.id),
        position: r.position,
      }))
      .sort((a, b) => b.position - a.position);

    res.json({ roles });
  });

  // ── จัดการยศ/ร้านค้า: รายการยศในร้าน ─────────────────────────
  app.get("/api/admin/roles", ...adminGate, (_req, res) => {
    res.json({ roles: checkinDB.getRoles() });
  });

  // ── จัดการยศ/ร้านค้า: เพิ่มยศใหม่เข้าร้าน หรือแก้ราคา/ชื่อยศที่มีอยู่แล้ว ──
  //  (checkinDB.addRole อัปเดตทับของเดิมให้อัตโนมัติถ้า roleId ซ้ำ)
  app.post("/api/admin/roles", ...adminGate, (req, res) => {
    const { roleId, name, price } = req.body || {};
    const priceNum = Number(price);

    if (!roleId || !name) return res.status(400).json({ success: false, error: "กรุณาระบุยศและชื่อ" });
    if (!Number.isFinite(priceNum) || priceNum < 0)
      return res.status(400).json({ success: false, error: "ราคาต้องเป็นตัวเลขไม่ติดลบ" });

    const roles = checkinDB.addRole(String(roleId), String(name).trim().slice(0, 100), Math.round(priceNum));

    sendWebLog(client, {
      title: "🏷️ อัปเดตร้านยศ (จากหน้าแอดมิน)",
      color: "#fbbf24",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🏷️ ยศ",    value: `${name} (\`${roleId}\`)` },
        { name: "🪙 ราคา",   value: `${Math.round(priceNum)} เหรียญ` },
      ],
    });

    res.json({ success: true, roles });
  });

  // ── จัดการยศ/ร้านค้า: ลบยศออกจากร้าน (ไม่กระทบยศจริงในดิสคอร์ด) ──
  app.delete("/api/admin/roles/:id", ...adminGate, (req, res) => {
    const removed = checkinDB.removeRole(req.params.id);
    if (!removed) return res.status(404).json({ success: false, error: "ไม่พบยศนี้ในร้าน" });

    sendWebLog(client, {
      title: "🗑️ ลบยศออกจากร้าน (จากหน้าแอดมิน)",
      color: "#9ca3af",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🏷️ ยศ ID", value: `\`${req.params.id}\`` },
      ],
    });

    res.json({ success: true });
  });

  // ── จัดการเหรียญผู้ใช้ (✏️ PATCH: เพิ่ม/หักเหรียญตรงจากหลังบ้าน) ────
  //  GET  /api/admin/coins/:userId                → ดูยอดเหรียญปัจจุบันของ user
  //  POST /api/admin/coins/:userId {amount,reason} → บวก(amount>0)/หัก(amount<0)
  //         หักแล้วเหรียญจะไม่มีวันติดลบ (ถ้าหักเกินยอดที่มี จะเหลือ 0)
  //         🧾 PATCH: ทุกครั้งที่ทำจะถูกบันทึกลงประวัติธุรกรรม (coinHistoryStore) ด้วย
  //  GET  /api/admin/coins/:userId/history          → ดูประวัติธุรกรรมย้อนหลัง
  // ──────────────────────────────────────────────────────────────
  app.get("/api/admin/coins/:userId", ...adminGate, (req, res) => {
    const userId = String(req.params.userId || "").trim();
    if (!/^\d{5,25}$/.test(userId)) {
      return res.status(400).json({ success: false, error: "User ID ไม่ถูกต้อง (ต้องเป็นตัวเลขไอดีดิสคอร์ด)" });
    }
    const u = checkinDB.getUser(userId);
    res.json({ userId, coins: u.coins });
  });

  app.post("/api/admin/coins/:userId", ...adminGate, (req, res) => {
    const userId = String(req.params.userId || "").trim();
    if (!/^\d{5,25}$/.test(userId)) {
      return res.status(400).json({ success: false, error: "User ID ไม่ถูกต้อง (ต้องเป็นตัวเลขไอดีดิสคอร์ด)" });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ success: false, error: "กรุณาระบุจำนวนเหรียญที่ถูกต้อง" });
    }
    const reason = String(req.body?.reason || "").trim().slice(0, 200);

    // กันเหรียญติดลบ: ถ้าจะหักเกินยอดที่มี ให้หักเหลือ 0 แทน
    const before  = checkinDB.getUser(userId).coins;
    const applied = amount < 0 ? -Math.min(-amount, before) : amount;

    const { coins } = checkinDB.addCoins(userId, Math.round(applied));

    // 🧾 PATCH: บันทึกลงประวัติธุรกรรมทุกครั้งที่แอดมินเพิ่ม/หักเหรียญจากหลังบ้าน
    coinHistoryStore.record(userId, {
      amount:       Math.round(applied),
      balanceAfter: coins,
      reason,
      adminName:    `${req.user.username} (${req.user.id})`,
      adminId:      req.user.id,
    });

    sendWebLog(client, {
      title: applied >= 0 ? "🪙 แอดมินเพิ่มเหรียญ" : "🪙 แอดมินหักเหรียญ",
      color: applied >= 0 ? "#34d399" : "#f87171",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน",         value: `${req.user.username} (${req.user.id})` },
        { name: "🎯 ผู้ใช้เป้าหมาย", value: `<@${userId}>\n(${userId})` },
        { name: applied >= 0 ? "➕ เพิ่ม" : "➖ หัก", value: `${Math.abs(applied)} เหรียญ` },
        { name: "🪙 ยอดคงเหลือ",     value: `${coins} เหรียญ` },
        ...(reason ? [{ name: "📝 หมายเหตุ", value: reason }] : []),
      ],
    });

    res.json({ success: true, userId, coins, applied });
  });

  app.get("/api/admin/coins/:userId/history", ...adminGate, (req, res) => {
    const userId = String(req.params.userId || "").trim();
    if (!/^\d{5,25}$/.test(userId)) {
      return res.status(400).json({ success: false, error: "User ID ไม่ถูกต้อง (ต้องเป็นตัวเลขไอดีดิสคอร์ด)" });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    res.json({ transactions: coinHistoryStore.getHistory(userId, limit) });
  });

  // ── จัดการร้านคอสเมติก (ธีมสี/กรอบโปรไฟล์): ดูแคตตาล็อกพร้อมราคาจริง ──
  //  🎨 PATCH: แต่ละไอเทมแนบ previewUrl มาด้วย (ดู resolveCosmeticPreview ด้านบน)
  app.get("/api/admin/cosmetics", ...adminGate, (_req, res) => {
    const publicDir = path.join(__dirname, "public");
    const catalog = checkinDB.getCosmeticCatalog().map((c) => ({
      ...c,
      previewUrl: resolveCosmeticPreview(c, publicDir),
    }));
    res.json({ catalog });
  });

  // ── จัดการร้านคอสเมติก: แก้ราคาปกติ (ถาวร) ──
  app.post("/api/admin/cosmetics/:id/price", ...adminGate, (req, res) => {
    const priceNum = Number(req.body?.price);
    const result = checkinDB.setCosmeticPrice(req.params.id, priceNum);
    if (!result.success) return res.status(400).json(result);

    sendWebLog(client, {
      title: "🪙 แก้ราคาคอสเมติก (จากหน้าแอดมิน)",
      color: "#fbbf24",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🎨 ไอเทม",  value: `${result.item.name} (\`${req.params.id}\`)` },
        { name: "🪙 ราคาใหม่", value: `${result.item.price} เหรียญ` },
      ],
    });

    res.json(result);
  });

  // ── จัดการร้านคอสเมติก: ตั้งลดราคาชั่วคราว กำหนดวัน-เวลาหมดโปรโมชั่น (หมดแล้วราคากลับปกติเอง) ──
  app.post("/api/admin/cosmetics/:id/sale", ...adminGate, (req, res) => {
    const { salePrice, saleUntil } = req.body || {};
    const result = checkinDB.setCosmeticSale(req.params.id, Number(salePrice), saleUntil);
    if (!result.success) return res.status(400).json(result);

    sendWebLog(client, {
      title: "🏷️ ตั้งลดราคาคอสเมติก (จากหน้าแอดมิน)",
      color: "#f472b6",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 แอดมิน", value: `${req.user.username} (${req.user.id})` },
        { name: "🎨 ไอเทม",  value: `${result.item.name} (\`${req.params.id}\`)` },
        { name: "🔥 ราคาลด", value: `${result.item.salePrice} เหรียญ (จาก ${result.item.basePrice})` },
        { name: "⏰ หมดโปรโมชั่น", value: new Date(result.item.saleUntil).toLocaleString("th-TH") },
      ],
    });

    res.json(result);
  });

  // ── จัดการร้านคอสเมติก: ยกเลิกโปรโมชั่นลดราคาก่อนกำหนด ──
  app.delete("/api/admin/cosmetics/:id/sale", ...adminGate, (req, res) => {
    const result = checkinDB.clearCosmeticSale(req.params.id);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  // ── จัดการเพลง: สั่งสแกนตรวจแบนทั้งหมดด้วยมือ (ใช้ฟังก์ชันเดียวกับสแกนอัตโนมัติ) ──
  //  ไม่ await จนจบ — สั่งให้เริ่มทำงานแล้วตอบกลับทันที ฝั่งหน้าเว็บจะ poll
  //  /api/admin/scan-banned/status เพื่อดู progress สดๆ แทน
  app.post("/api/admin/scan-banned", ...adminGate, (req, res) => {
    if (autoScanRunning) {
      return res.status(409).json({ success: false, error: "กำลังสแกนอยู่แล้ว กรุณารอให้เสร็จก่อน", ...scanProgress });
    }

    runAutoBanScan(client, { triggeredBy: `admin:${req.user.id}` }).catch((err) => {
      logger.error(`[AutoBanScan] สแกนโดยแอดมิน (${req.user.id}) ล้มเหลว: ${err.message}`);
    });

    res.json({ success: true, started: true });
  });

  // ── จัดการเพลง: ดู progress ของการสแกนล่าสุด (ไม่ว่าจะเริ่มจากอัตโนมัติหรือแอดมินกดเอง) ──
  app.get("/api/admin/scan-banned/status", ...adminGate, (_req, res) => {
    res.json(scanProgress);
  });

  // ── หน้าแอดมิน (ต้อง login + เป็นเจ้าของเซิร์ฟเวอร์เท่านั้น) ─────────
  //  ⚠️ เก็บไฟล์ admin.html ไว้ "นอก" โฟลเดอร์ public/ โดยเจตนา เพื่อไม่ให้
  //  ใครเข้าตรงๆ ผ่าน static file serving ได้โดยข้าม middleware เช็คสิทธิ์นี้
  app.get("/admin", async (req, res) => {
    if (!req.user) return res.redirect("/auth/discord");

    const ownerId = await getGuildOwnerId();
    const isOwner = !!ownerId && String(req.user.id) === String(ownerId);
    if (!isOwner) {
      return res.status(403).send(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ไม่มีสิทธิ์เข้าถึง</title>
        <style>
          body{background:#0d0a14;color:#f1eeff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px}
          .box{max-width:420px}
          h1{color:#f87171;font-size:22px;margin-bottom:12px}
          p{color:rgba(255,255,255,.6);line-height:1.8;font-size:14px}
          a{display:inline-block;margin-top:20px;background:#a855f7;color:#fff;text-decoration:none;
            padding:10px 20px;border-radius:10px;font-weight:700;font-size:13px}
        </style></head>
        <body><div class="box">
          <h1>🚫 หน้านี้เฉพาะเจ้าของเซิร์ฟเวอร์เท่านั้น</h1>
          <p>บัญชีของคุณไม่มีสิทธิ์เข้าหน้าแอดมิน</p>
          <a href="/">กลับหน้าแรก</a>
        </div></body></html>`);
    }

    res.sendFile(path.join(__dirname, "admin.html"));
  });

  // ── หน้าร้านค้า (URL สวย /shop แทนที่จะต้องเปิด /shop.html ตรงๆ) ─────
  app.get("/shop", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "shop.html"));
  });

  // ── หน้าโปรไฟล์: /profile ไม่ระบุ id → ไปโปรไฟล์ตัวเอง (ต้อง login ก่อน) ──
  app.get("/profile", (req, res) => {
    if (req.user) return res.redirect(`/profile/${req.user.id}`);
    res.redirect("/");
  });

  // ── หน้าโปรไฟล์: ดูของใครก็ได้ผ่าน id (ไม่ต้อง login ก็ดูได้) ──────────
  app.get("/profile/:id", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "profile.html"));
  });

  // ══════════════════════════════════════════════════════════════
  //  🔓  ปิด Guild Gate แล้ว — ทุกคนเข้าเว็บ/ดูเพลงได้เลยโดยไม่ต้อง
  //  Login Discord ก่อน ระบบจะขอ Login เฉพาะตอนทำ action ที่จำเป็นจริงๆ
  //  (โหวต / คอมเมนต์ / เช็คอิน) ผ่าน requireAuth ที่ endpoint นั้นๆ แทน
  // ══════════════════════════════════════════════════════════════

  // ── Static ───────────────────────────────────────────────────
  app.use(express.static(path.join(__dirname, "public")));

  // ── API: Meta ────────────────────────────────────────────────
  app.get("/api/meta", (_req, res) => {
    res.json(db.getMeta());
  });

  // ── API: All Songs ───────────────────────────────────────────
  app.get("/api/songs", (req, res) => {
    const { q } = req.query;
    const songs = q ? db.searchSongs(q) : db.getAllSongs();
    const withUploader = songs.map((s) => ({ ...s, uploaderName: uploaderStore.get(s.id) }));
    res.json(withUploader.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt)));
  });

  // ── API: ปกเพลง (best-effort, ไม่ใช่ปกจริงจาก Roblox — ดูหมายเหตุที่ resolveCoverArt) ──
  app.get("/api/cover/:id", coverLimiter, async (req, res) => {
    const songId = String(req.params.id || "").trim();
    if (!songId) return res.status(400).json({ error: "Missing song id" });

    const cached = getCachedCover(songId);
    if (cached !== undefined) return res.json({ cover: cached });

    const song = db.getAllSongs().find((s) => s.id === songId);
    if (!song) return res.status(404).json({ error: "Not found" });

    const url = await resolveCoverArt(songId, song.name);
    // เจอปกจริง → แคชถาวร + เซฟลงไฟล์กันบอท restart / ไม่เจอ (รวมถึงกรณี Roblox ยัง Pending)
    // → แคชสั้นแค่ 15 นาทีใน memory เฉยๆ ให้กลับมาลองใหม่ได้เร็ว
    setCachedCover(songId, url);
    res.json({ cover: url });
  });

  // ── API: Leaderboard ─────────────────────────────────────────
  app.get("/api/leaderboard", (_req, res) => {
    res.json(db.getLeaderboard(10));
  });

  // ── API: Export ──────────────────────────────────────────────
  app.get("/api/export", (req, res) => {
    const fmt      = req.query.format === "csv" ? "csv" : "txt";
    const content  = fmt === "csv" ? db.exportCsv() : db.exportTxt();
    const filename = `songs_export_${Date.now()}.${fmt}`;
    res.setHeader("Content-Type", fmt === "csv" ? "text/csv" : "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  });

  // ── API: Single Song ─────────────────────────────────────────
  app.get("/api/songs/:id", (req, res) => {
    const songs = db.getAllSongs();
    const song  = songs.find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Not found" });
    res.json({ ...song, uploaderName: uploaderStore.get(song.id) });
  });

  // ── API: คอมเมนต์ใต้เพลง ──────────────────────────────────────
  const commentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "คอมเมนต์ถี่เกินไป กรุณารอสักครู่" },
  });

  app.get("/api/songs/:id/comments", (req, res) => {
    const songs = db.getAllSongs();
    const song  = songs.find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Song not found" });
    const comments = commentStore.getComments(req.params.id).map((c) => ({
      ...c,
      ...currentFrameOf(c.userId),
    }));
    res.json({ comments });
  });

  app.post("/api/songs/:id/comments", commentLimiter, requireAuth, (req, res) => {
    const songs = db.getAllSongs();
    const song  = songs.find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ success: false, error: "Song not found" });

    const result = commentStore.addComment(req.params.id, {
      userId:   req.user.id,
      username: req.user.username,
      avatar:   avatarUrlServer(req.user),
      text:     req.body?.text,
    });
    if (!result.success) return res.status(400).json(result);

    // 📋 LOG: มีคอมเมนต์ใหม่
    sendWebLog(client, {
      title: "💬 มีคอมเมนต์ใหม่",
      color: "#818cf8",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "🎵 เพลง",    value: `${song.name}\n\`${song.id}\`` },
        { name: "👤 โดย",     value: `${req.user.username} (${req.user.id})` },
        { name: "📝 ข้อความ", value: result.comment.text.slice(0, 200) },
      ],
    });

    res.json({ success: true, comment: result.comment });
  });

  // ── API: แก้ไข/ลบคอมเมนต์ตัวเอง (ภายใน 5 นาทีหลังโพสต์เท่านั้น) ─────
  app.patch("/api/songs/:id/comments/:commentId", commentLimiter, requireAuth, (req, res) => {
    const result = commentStore.updateComment(req.params.id, req.params.commentId, req.user.id, req.body?.text);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  app.delete("/api/songs/:id/comments/:commentId", requireAuth, (req, res) => {
    const result = commentStore.deleteComment(req.params.id, req.params.commentId, req.user.id);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  // ── API: Hall of Fame — ผู้อัพเพลงเยอะสุด / คอมเมนต์เยอะสุด / เหรียญเยอะสุด ─
  app.get("/api/hall-of-fame", async (_req, res) => {
    const active = db.getAllSongs().filter((s) => !s.deleted);

    const uploaderCounts = {};
    active.forEach((s) => {
      const tag = s.addedByTag || s.addedBy || "@User";
      uploaderCounts[tag] = (uploaderCounts[tag] || 0) + 1;
    });
    const topUploaders = Object.entries(uploaderCounts)
      .map(([tag, count]) => {
        const web = webUserStore.get(tag); // เคยเชื่อมดิสคอร์ดกับเว็บไหม
        return {
          tag,
          count,
          connected: !!web,
          avatar:    web ? web.avatar : null,
          discordId: web ? web.id : null,
          ...currentFrameOf(web ? web.id : null),
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topCommenters = commentStore.getTopCommenters(5);

    // 🪙 อันดับเหรียญเยอะสุด — ใช้ userId (Discord ID) โดยตรงจากระบบเช็คอิน
    // แล้วพยายามหาชื่อ/รูปโปรไฟล์จริงจาก guild member ก่อน (เร็วสุด, cache อยู่แล้ว)
    // ถ้าไม่เจอค่อย fallback ไปที่ webUserStore (คนที่เคย login เว็บไว้)
    const rawCoins = checkinDB.getCoinsLeaderboard(5);
    const guild    = client.guilds.cache.get(cfg.GUILD_ID);

    const topCoins = await Promise.all(
      rawCoins.map(async ({ userId, coins }) => {
        let username = null;
        let avatar   = null;
        let connected = false;

        // 1) ลองเอาจาก guild member cache/fetch ก่อน (ไม่ต้องพึ่งว่าเคย login เว็บหรือยัง)
        try {
          let member = guild?.members.cache.get(userId) || null;
          if (!member && guild) member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            username  = member.user.username;
            avatar    = avatarUrlServer(member.user);
            connected = true;
          }
        } catch { /* ignore, fallback ด้านล่าง */ }

        // 2) เผื่อ fetch guild member ไม่ได้ (เช่นออกจากเซิร์ฟไปแล้ว) แต่เคย login เว็บไว้ก่อนหน้า
        if (!connected) {
          const web = webUserStore.get(userId);
          if (web) {
            username  = web.username;
            avatar    = web.avatar;
            connected = true;
          }
        }

        return {
          userId,
          coins,
          connected,
          username:  username || `User ${userId.slice(-4)}`,
          avatar,
          ...currentFrameOf(userId),
        };
      })
    );

    res.json({ topUploaders, topCommenters, topCoins });
  });

  // ── API: หา Discord ID ของผู้อัพจาก tag/username ที่โชว์ในการ์ดเพลง ──
  // (เพลงเก็บแค่ addedByTag เป็นข้อความ ไม่ได้เก็บ userId ตรงๆ เลยต้องย้อนหาแบบนี้
  //  ใช้ helper ตัวเดียวกับที่ /api/hall-of-fame ใช้หา discordId ของ topUploaders)
  app.get("/api/resolve-uploader/:tag", (req, res) => {
    const tag = req.params.tag;
    const web = webUserStore.get(tag);
    if (!web || !web.id) return res.status(404).json({ error: "ไม่พบโปรไฟล์ผู้ใช้นี้" });
    res.json({ id: web.id });
  });

  // ── API: ดูโปรไฟล์ของใครก็ได้ (public, ไม่ต้อง login) — สำหรับหน้า /profile/:id ──
  app.get("/api/profile/:id", async (req, res) => {
    const targetId = req.params.id;

    // 1) ลองเอาจาก guild member cache/fetch ก่อน (เชื่อถือได้สุด ไม่ต้องพึ่งว่าเคย login เว็บหรือยัง)
    let username = null;
    let avatar   = null;
    try {
      const guild = client.guilds.cache.get(cfg.GUILD_ID);
      let member  = guild?.members.cache.get(targetId) || null;
      if (!member && guild) member = await guild.members.fetch(targetId).catch(() => null);
      if (member) {
        username = member.user.username;
        avatar   = avatarUrlServer(member.user);
      }
    } catch { /* ignore, fallback ด้านล่าง */ }

    // 2) เผื่อ fetch guild member ไม่ได้ (เช่นออกจากเซิร์ฟไปแล้ว) แต่เคย login เว็บไว้ก่อนหน้า
    if (!username) {
      const web = webUserStore.get(targetId);
      if (web) { username = web.username; avatar = web.avatar; }
    }

    if (!username) {
      return res.status(404).json({ error: "ไม่พบโปรไฟล์นี้ (ผู้ใช้นี้อาจไม่ได้อยู่ในดิสคอร์ดแล้ว หรือยังไม่เคย Login เข้าเว็บ)" });
    }

    const cosmetics = checkinDB.getUserCosmetics(targetId);
    const catalog   = checkinDB.getCosmeticCatalog();
    const frameItem = catalog.find((c) => c.id === cosmetics.frame);
    const themeItem = catalog.find((c) => c.id === cosmetics.theme);

    const mySongs = db.getAllSongs()
      .filter((s) => !s.deleted && (s.addedByTag || s.addedBy) === username)
      .map((s) => ({
        id:      s.id,
        name:    s.name,
        addedAt: s.addedAt,
        votes:   Array.isArray(s.votes) ? s.votes.length : (s.votes || 0),
      }))
      .sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));

    const totalLikes = mySongs.reduce((sum, s) => sum + (s.votes || 0), 0);
    const followInfo = checkinDB.getFollowInfo(targetId, req.user?.id);

    res.json({
      id:          targetId,
      username,
      avatar,
      bio:         checkinDB.getUserBio(targetId),
      frameId:     frameItem?.id || null,
      frameName:   frameItem?.name || null,
      themeColors: themeItem?.colors || null,
      isSelf:      !!(req.user && String(req.user.id) === String(targetId)),
      songCount:   mySongs.length,
      songs:       mySongs,
      totalLikes,
      followersCount:   followInfo.followersCount,
      followingCount:   followInfo.followingCount,
      viewerIsFollowing: followInfo.viewerIsFollowing,
    });
  });

  // ── API: ติดตาม / เลิกติดตามผู้ใช้คนอื่น (ต้อง login) ──────────
  app.post("/api/profile/:id/follow", requireAuth, (req, res) => {
    const targetId = req.params.id;
    const result = checkinDB.followUser(req.user.id, targetId);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  app.post("/api/profile/:id/unfollow", requireAuth, (req, res) => {
    const targetId = req.params.id;
    const result = checkinDB.unfollowUser(req.user.id, targetId);
    res.json(result);
  });

  // ── API: รายชื่อผู้ติดตาม/กำลังติดตามของคนคนหนึ่ง (public) ──────
  app.get("/api/profile/:id/followers", async (req, res) => {
    const targetId = String(req.params.id);
    const raw = require("fs").readFileSync(path.join(__dirname, "..", "data", "checkin.json"), "utf8");
    const all = JSON.parse(raw).users || {};
    const followerIds = Object.keys(all).filter(
      (uid) => Array.isArray(all[uid].following) && all[uid].following.includes(targetId)
    );
    const list = await resolveUserSummaries(followerIds);
    res.json({ users: list });
  });

  app.get("/api/profile/:id/following", async (req, res) => {
    const targetId = String(req.params.id);
    const u = checkinDB.getUser(targetId);
    const list = await resolveUserSummaries(u.following || []);
    res.json({ users: list });
  });

  // ── ช่วยแปลง userId[] ให้เป็น {id, username, avatar} เพื่อโชว์ในลิสต์ผู้ติดตาม ──
  async function resolveUserSummaries(ids) {
    const guild = client.guilds.cache.get(cfg.GUILD_ID);
    const out = [];
    for (const uid of ids) {
      let username = null, avatar = null;
      let member = guild?.members.cache.get(uid) || null;
      if (!member && guild) member = await guild.members.fetch(uid).catch(() => null);
      if (member) { username = member.user.username; avatar = avatarUrlServer(member.user); }
      if (!username) {
        const web = webUserStore.get(uid);
        if (web) { username = web.username; avatar = web.avatar; }
      }
      if (username) out.push({ id: uid, username, avatar });
    }
    return out;
  }

  // ── API: แก้ไบโอของตัวเอง (สูงสุด 150 ตัวอักษร) ────────────────────
  app.post("/api/profile/bio", requireAuth, (req, res) => {
    const bio = checkinDB.setUserBio(req.user.id, req.body?.bio);
    res.json({ success: true, bio });
  });

  // ── API: รายชื่อผู้อัพเพลงทั้งหมด (ไม่ซ้ำ) — ใช้แสดงเครดิตท้ายเว็บ ───
  app.get("/api/uploaders", (_req, res) => {
    const all   = uploaderStore.getAll(); // { songId: name }
    const names = [...new Set(Object.values(all).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "th")
    );
    res.json(names);
  });

  // ══════════════════════════════════════════════════════════════
  //  🎵  API: อัพโหลด Song ID ผ่านเว็บ — ต้อง Login Discord ก่อน
  //  - ไม่จำกัดจำนวนเพลง/วัน (มีระบบลบเพลงที่โดนแบน/ใช้ไม่ได้อยู่แล้ว)
  //  - ส่งได้หลาย ID พร้อมกันในครั้งเดียว (ตัดจำนวนสูงสุดต่อคำขอไว้กันสแปม)
  //  - บังคับต้องมีชื่อเพลงจากผู้ใช้เสมอ (อัปเดต 2026-09) — เดิมดึงชื่อจาก Roblox
  //    อัตโนมัติ แต่บางเพลงดึงไม่ได้แล้วเข้าคลังเป็น "Song ID 12345" เฉยๆ จึงเปลี่ยน
  //    มาบังคับผู้ใช้กรอกชื่อเอง (ผู้ใช้ login อยู่แล้วจึงมี Discord id ผูกกับทุกชื่อ
  //    ที่ใส่มา ตรวจสอบย้อนหลังได้ถ้ามีปัญหา) ยังเรียก Roblox API เพื่อเช็คแบน/ยืนยัน
  //    ว่า asset มีอยู่จริงตามเดิม
  //  - ผู้อัพใช้ชื่อ Discord ของคนที่ login อยู่เสมอ (ผูกกับ session เท่านั้น
  //    ห้ามรับ "ผู้อัพ" จาก client โดยตรง กันสวมรอยเหมือนระบบโหวต)
  // ══════════════════════════════════════════════════════════════
  const MAX_IDS_PER_SUBMIT = 30; // กันคนยิง ID เป็นพันๆ อันมาในคำขอเดียวจนเซิร์ฟเวอร์ค้าง
  const MAX_NAME_LEN = 120; // กันชื่อยาวเกินจนพังหน้าเว็บ/ฐานข้อมูล

  // รองรับทั้งเลข ID ล้วนๆ และลิงก์ เช่น roblox.com/library/123456/ชื่อเพลง
  function extractSongId(raw) {
    const str = String(raw || "").trim();
    if (!str) return null;
    const match = str.match(/(\d{5,})/); // Song ID ของ Roblox ยาวอย่างน้อย 5 หลัก
    return match ? match[1] : null;
  }

  // ตัดอักขระควบคุม/ขึ้นบรรทัดใหม่ออก ยุบช่องว่างซ้ำ ตัดความยาว กันชื่อมั่ว/พังหน้าเว็บ
  function sanitizeSongName(raw) {
    if (typeof raw !== "string") return "";
    const cleaned = raw.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.slice(0, MAX_NAME_LEN);
  }

  app.post("/api/songs/submit", submitLimiter, requireAuth, async (req, res) => {
    let raw = req.body?.ids;
    if (!Array.isArray(raw)) raw = String(raw || "").split(/[\n,]+/); // เผื่อ client ส่งมาเป็น textarea ก้อนเดียว

    // ชื่อที่ผู้ใช้พิมพ์เองต่อ ID (optional) — ส่งมาเป็น { [id]: name }
    const rawNames = (req.body?.names && typeof req.body.names === "object") ? req.body.names : {};

    // แยก ID ออกจากข้อความ/ลิงก์ ตัดค่าว่างและ ID ที่ซ้ำกันเองในคำขอเดียวออก
    const cleaned = [...new Set(raw.map(extractSongId).filter(Boolean))].slice(0, MAX_IDS_PER_SUBMIT);

    // แม็ป ID (ที่ผ่านการตรวจสอบแล้ว) -> ชื่อที่ผู้ใช้ตั้งเอง หลัง sanitize
    const userNames = {};
    for (const id of cleaned) {
      const n = sanitizeSongName(rawNames[id]);
      if (n) userNames[id] = n;
    }

    if (!cleaned.length) {
      return res.status(400).json({ success: false, error: "ไม่พบ Song ID ที่ถูกต้องเลย กรุณาใส่ ID หรือลิงก์เพลง" });
    }

    const existingIds = new Set(db.getAllSongs().map((s) => s.id));
    const userTag      = `@${req.user.username}`;
    const results       = [];   // ผลลัพธ์ต่อ ID ที่จะตอบกลับไปให้หน้าเว็บ
    const toAdd         = [];   // { id, name } เฉพาะรายการที่ผ่านการตรวจสอบแล้ว รอส่งเข้า db.addSongs ทีเดียว

    for (const id of cleaned) {
      if (existingIds.has(id)) {
        results.push({ id, ok: false, reason: "มีเพลงนี้ในคลังอยู่แล้ว" });
        continue;
      }
      // บังคับต้องมีชื่อเพลงเสมอ — เดิมถ้าดึงชื่อจาก Roblox ไม่ได้จะ fallback เป็น
      // "Song ID 12345" เฉยๆ ทำให้เพลงเข้าคลังแบบไม่มีชื่อจริง ตอนนี้ปฏิเสธไปเลยแทน
      if (!userNames[id]) {
        results.push({ id, ok: false, reason: "กรุณาใส่ชื่อเพลงสำหรับ ID นี้" });
        continue;
      }
      try {
        const banCheck = await checkRobloxBan(id);
        if (banCheck.banned) {
          results.push({ id, ok: false, reason: `ใช้งานไม่ได้: ${banCheck.reason}` });
          continue;
        }

        // ยังเรียก fetchRobloxAssetInfo เพื่อยืนยันว่า asset มีอยู่จริง แต่ชื่อที่บันทึก
        // ใช้ค่าที่ผู้ใช้กรอกมาเสมอ (บังคับใส่แล้วตั้งแต่ต้นทาง ไม่ fallback เป็นชื่อกลางๆ อีก)
        await fetchRobloxAssetInfo(id);
        const name = userNames[id];

        toAdd.push({ id, name });
        existingIds.add(id); // กันซ้ำกันเองถ้ามี ID ซ้ำหลุดมาในชุดเดียวกัน (ปกติ Set กรองไปแล้ว แต่กันไว้อีกชั้น)
      } catch (err) {
        logger.error(`[SongSubmit] ${id}: ${err.message}`);
        results.push({ id, ok: false, reason: "ตรวจสอบไม่สำเร็จ กรุณาลองใหม่ภายหลัง" });
      }
    }

    // บันทึกทั้งหมดที่ผ่านการตรวจสอบเข้า db ทีเดียว (db.addSongs อัพเดต stats/meta ให้ในตัว)
    let addedList = [];
    if (toAdd.length) {
      const { added, duplicates } = db.addSongs(toAdd, req.user.id, userTag);
      addedList = added;

      added.forEach(({ id, name }) => {
        uploaderStore.set(id, req.user.username);
        results.push({ id, ok: true, name });
      });
      // เผื่อกรณีชนกันแบบ race condition (มีคนอื่นอัพ ID เดียวกันเข้ามาพร้อมกันพอดี)
      duplicates.forEach(({ id }) => {
        results.push({ id, ok: false, reason: "มีเพลงนี้ในคลังอยู่แล้ว" });
      });
    }

    if (addedList.length) {
      const preview = addedList.slice(0, 10).map((r) => `\`${r.id}\` ${r.name}`).join("\n");
      const more    = addedList.length > 10 ? `\n...และอีก ${addedList.length - 10} เพลง` : "";

      // 📋 LOG: มีคนอัพเพลงใหม่ผ่านเว็บ — ชื่อทั้งหมดเป็นชื่อที่ผู้อัพกรอกเอง (บังคับใส่แล้ว)
      sendWebLog(client, {
        title: "🎵 มีคนอัพเพลงใหม่ผ่านเว็บ",
        color: "#34d399",
        thumbnail: avatarUrlServer(req.user),
        fields: [
          { name: "👤 ผู้อัพ", value: `${req.user.username} (${req.user.id})` },
          { name: "📊 สำเร็จ", value: `${addedList.length} / ${cleaned.length} ID` },
          { name: "🎶 รายการ", value: preview + more },
        ],
      });
    }

    res.json({ success: true, addedCount: addedList.length, results });
  });

  // ── API: Banned Songs (list) ─────────────────────────────────
  // ⚠️ เก็บ endpoint นี้ไว้เพื่อ backward-compat แต่ตอนนี้เพลงที่โดนแบน
  // จะถูกลบออกจาก db.songs ทันที ดังนั้น list นี้จะว่างเปล่าเป็นปกติ
  app.get("/api/banned", (_req, res) => {
    res.json(db.getBannedSongs());
  });

  // ── API: ลบเพลงเพราะโดนแบน (เรียกได้เฉพาะบอท/สคริปต์ภายในเท่านั้น ต้องมี x-api-key) ──
  //  🗑️ PATCH: เดิม endpoint นี้ใช้ mark banned flag (setBanned) — ตอนนี้เปลี่ยนเป็น
  //  ลบเพลงออกจากระบบถาวรทันทีที่ตรวจพบว่าโดนแบน ไม่เก็บ record ไว้อีกต่อไป
  app.post("/api/banned", requireBotKey, (req, res) => {
    const { songId } = req.body;
    if (!songId) {
      return res.status(400).json({ success: false, error: "Missing songId" });
    }

    const songs = db.getAllSongs();
    const song  = songs.find((s) => s.id === String(songId));

    const ok = db.deleteSong(String(songId), { reason: "bot-report" });
    if (!ok) {
      return res.status(404).json({ success: false, error: "Song not found" });
    }
    removeCachedCover(String(songId));

    logger.web(`[BanCheck] ${songId}${song ? ` "${song.name}"` : ""} → ลบออกจากระบบแล้ว (แจ้งจากบอท)`);

    sendWebLog(client, {
      title: "🗑️ ลบเพลงเพราะโดนแบน (จากบอท)",
      color: "#f87171",
      fields: [
        { name: "🎵 เพลง",      value: `${song ? song.name : "ไม่ทราบชื่อ"}\n\`${songId}\`` },
      ],
    });

    res.json({ success: true, songId: String(songId), deleted: true });
  });

  // ── API: สตรีมไฟล์เสียง (ให้เว็บเล่นเพลงได้ในตัว ไม่ต้องไป Roblox) ──
  app.get("/api/audio/:id", audioLimiter, (req, res) => {
    const songId = String(req.params.id || "").trim();
    if (!songId || !/^\d+$/.test(songId)) {
      return res.status(400).json({ error: "Song ID ไม่ถูกต้อง" });
    }
    streamRobloxAudio(songId, req, res);
  });

  // ── API: Check Roblox Ban (single song) ─────────────────────
  //  🗑️ PATCH: ถ้าตรวจเจอว่าโดนแบน จะ "ลบเพลงออกจากระบบทันที" แทนการ mark flag
  //  ไม่มีสถานะ "โดนแบนแต่ยังอยู่ในคลัง" อีกต่อไป — เพลงหายจากลิสต์เลย
  app.post("/api/check-banned", async (req, res) => {
    const { songId } = req.body;

    if (!songId) {
      return res.status(400).json({ success: false, error: "Missing songId" });
    }

    const songs = db.getAllSongs();
    const song  = songs.find((s) => s.id === String(songId));
    if (!song) {
      return res.status(404).json({ success: false, error: "Song not found in database" });
    }

    try {
      const result = await checkRobloxBan(String(songId));

      if (result.banned) {
        // โดนแบน → ลบออกจากระบบถาวรทันที ไม่เก็บ record ตัวเพลงไว้ (รวมถึงปกเพลงที่แคชไว้)
        db.deleteSong(String(songId), { reason: "user-check" });
        removeCachedCover(String(songId));
        logger.web(`[BanCheck] ${songId} "${song.name}" → BANNED, ลบออกจากระบบแล้ว (${result.reason})`);

        // 📋 LOG: ลบเพลงเพราะโดนแบน
        sendWebLog(client, {
          title: "🗑️ ลบเพลงเพราะโดนแบน",
          color: "#f87171",
          fields: [
            { name: "🎵 เพลง",   value: `${song.name}\n\`${songId}\`` },
            { name: "📝 สาเหตุ", value: result.reason },
          ],
        });

        return res.json({
          success: true,
          songId:  String(songId),
          name:    song.name,
          banned:  true,
          deleted: true,
          reason:  result.reason,
        });
      }

      // ไม่โดนแบน → ปกติ ไม่ต้องแก้อะไร
      res.json({
        success: true,
        songId:  String(songId),
        name:    song.name,
        banned:  false,
        deleted: false,
        reason:  result.reason,
      });
    } catch (err) {
      logger.web(`[BanCheck ERROR] ${songId}: ${err.message}`);
      res.status(500).json({
        success: false,
        error:   "ตรวจสอบสถานะเพลงไม่สำเร็จ กรุณาลองใหม่ภายหลัง",
        songId:  String(songId),
      });
    }
  });

  // ── API: Send OTP via Discord DM (ขอได้เฉพาะบัญชีตัวเองที่ login อยู่) ──
  app.post("/api/send-otp", otpLimiter, requireAuth, async (req, res) => {
    const userId = req.user.id;
    try {
      const otp  = Math.floor(100000 + Math.random() * 900000).toString();
      const user = await client.users.fetch(userId);
      await user.send(`🔐 รหัส OTP ของคุณคือ: **${otp}**\nหมดอายุใน 5 นาที`);
      otpStore.set(userId, { otp, expires: Date.now() + 5 * 60 * 1000 });
      res.json({ success: true });
    } catch {
      res.status(404).json({ error: "ส่ง DM ไม่ได้ — ตรวจสอบว่าเปิดรับ DM จากสมาชิกในเซิร์ฟเวอร์ไว้" });
    }
  });

  // ── API: Verify OTP (เช็คได้เฉพาะบัญชีตัวเองที่ login อยู่) ──────
  app.post("/api/verify-otp", otpLimiter, requireAuth, (req, res) => {
    const userId = req.user.id;
    const { otp } = req.body;
    const record = otpStore.get(userId);
    if (!record)               return res.status(400).json({ error: "ไม่พบ OTP" });
    if (Date.now() > record.expires) return res.status(400).json({ error: "OTP หมดอายุ" });
    if (record.otp !== otp)    return res.status(400).json({ error: "OTP ไม่ถูกต้อง" });
    otpStore.delete(userId);
    res.json({ success: true });
  });

  // ── API: Vote ────────────────────────────────────────────────
  // ต้อง login ด้วย Discord ก่อนถึงจะโหวตได้ — ใช้ req.user.id จาก session ที่ login จริง
  // เท่านั้น ห้ามรับ userId จาก client เด็ดขาด (แก้ก่อนหน้านี้ client ส่ง userId มาเอง
  // ทำให้ใครก็พิมพ์ Discord ID คนอื่นมาโหวตแทนได้ หรือลบ localStorage แล้วโหวตซ้ำได้ไม่จำกัด)
  app.post("/api/vote", voteLimiter, requireAuth, (req, res) => {
    const { songId } = req.body;
    const userId = req.user.id;
    if (!songId) {
      return res.status(400).json({ success: false, error: "Missing songId" });
    }
    const songs = db.getAllSongs();
    const song  = songs.find((s) => s.id === songId);
    if (!song) return res.status(404).json({ success: false, error: "Song not found" });
    const result = db.voteSong(songId, userId);

    // 📋 LOG: โหวต / ยกเลิกโหวต
    sendWebLog(client, {
      title: result.voted ? "❤️ มีคนโหวตเพลง" : "💔 มีคนยกเลิกโหวต",
      color: result.voted ? "#f472b6" : "#6b7280",
      fields: [
        { name: "🎵 เพลง",   value: `${song.name}\n\`${songId}\`` },
        { name: "👤 โดย",    value: `<@${userId}>\n(${userId})` },
        { name: "📊 ยอดรวม", value: `${result.count} โหวต` },
      ],
    });

    res.json({ success: true, votes: result.count, voted: result.voted });
  });

  // ── API: Visitors ────────────────────────────────────────────
  app.post("/api/visitors", (req, res) => {
    const { count } = req.body;
    const total = db.trackVisitor(count === true);
    res.json({ total });
  });

  app.get("/api/visitors", (_req, res) => {
    res.json({ total: db.getVisitors() });
  });

  // ── API: Presence — ผู้เข้าชมออนไลน์ตอนนี้ ───────────────────
  app.post("/api/presence/ping", async (req, res) => {
    const { clientId, device } = req.body;
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });
    // ถ้า login ด้วย Discord อยู่ ให้ผูกชื่อ/รูปไว้กับ clientId นี้ด้วย
    // เพื่อให้เจ้าของเซิร์ฟดูได้ว่าใครออนไลน์อยู่บ้าง (ผู้ที่ยังไม่ login จะโชว์เป็น "ผู้เยี่ยมชม")
    const identity = req.user
      ? { id: req.user.id, username: req.user.username, avatar: avatarUrlServer(req.user) }
      : null;

    const validDevices = ["mobile", "tablet", "desktop"];
    const safeDevice   = validDevices.includes(device) ? device : null;
    const country       = await lookupCountry(req);
    const prev          = onlineVisitors.get(String(clientId));

    onlineVisitors.set(String(clientId), {
      lastSeen: Date.now(),
      user:     identity,
      device:   safeDevice || prev?.device || null,
      country:  country || prev?.country || null,
    });
    res.json({ success: true });
  });

  app.get("/api/presence/online", (_req, res) => {
    const now = Date.now();
    let count = 0;
    for (const [id, v] of onlineVisitors) {
      if (now - v.lastSeen > ONLINE_TTL_MS) onlineVisitors.delete(id);
      else count++;
    }
    res.json({ online: count });
  });

  // ── API: รายชื่อคนออนไลน์ตอนนี้ — เฉพาะเจ้าของ/แอดมินเซิร์ฟเวอร์ ──
  app.get("/api/presence/online-list", requireOwner, (_req, res) => {
    const now = Date.now();
    const list = [];
    for (const [id, v] of onlineVisitors) {
      if (now - v.lastSeen > ONLINE_TTL_MS) {
        onlineVisitors.delete(id);
        continue;
      }
      list.push({
        clientId:   id,
        loggedIn:   !!v.user,
        username:   v.user ? v.user.username : "ผู้เยี่ยมชม (ยังไม่ login)",
        avatar:     v.user ? v.user.avatar : null,
        discordId:  v.user ? v.user.id : null,
        device:     v.device || null,
        country:    v.country || null,
        lastSeenMs: now - v.lastSeen,
      });
    }
    // เรียงคนที่ login ไว้ก่อน แล้วตามด้วยคนที่เพิ่ง ping ล่าสุด
    list.sort((a, b) => (b.loggedIn - a.loggedIn) || (a.lastSeenMs - b.lastSeenMs));
    res.json({ online: list.length, users: list });
  });

  // ── API: Push Notifications — ระบบแจ้งเตือนเพลงใหม่ ──────────
  app.get("/api/push/vapid-public-key", (_req, res) => {
    if (!pushReady) return res.status(503).json({ error: "ระบบแจ้งเตือนยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งค่า VAPID key)" });
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  app.post("/api/push/subscribe", (req, res) => {
    const sub = req.body;
    if (!sub || !sub.endpoint || !sub.keys) {
      return res.status(400).json({ success: false, error: "Invalid push subscription" });
    }
    const subs = loadPushSubscriptions();
    if (!subs.find((s) => s.endpoint === sub.endpoint)) {
      subs.push(sub);
      savePushSubscriptions(subs);
    }
    res.json({ success: true });
  });

  app.post("/api/push/unsubscribe", (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ success: false, error: "Missing endpoint" });
    const subs = loadPushSubscriptions().filter((s) => s.endpoint !== endpoint);
    savePushSubscriptions(subs);
    res.json({ success: true });
  });

  // ── API: Me ──────────────────────────────────────────────────
  app.get("/api/me", async (req, res) => {
    if (!req.user) return res.json({ loggedIn: false });

    // เช็คว่าเป็นเจ้าของเซิร์ฟเวอร์ Discord ไหม (ใช้ตรรกะเดียวกับ requireOwner)
    // เพื่อให้ฝั่งหน้าเว็บซ่อน/โชว์ปุ่มที่เฉพาะแอดมินเท่านั้น เช่น panel สแกนตรวจแบนทั้งหมด
    let isAdmin = false;
    try {
      const ownerId = await getGuildOwnerId();
      isAdmin = !!ownerId && String(req.user.id) === String(ownerId);
    } catch { /* ถ้าเช็คไม่ได้ ให้ถือว่าไม่ใช่แอดมินไว้ก่อนเพื่อความปลอดภัย */ }

    res.json({
      loggedIn: true,
      isAdmin,
      user: {
        id:       req.user.id,
        username: req.user.username,
        avatar:   req.user.avatar,
      },
    });
  });

  // ── API: สถานะเช็คอินของฉัน ─────────────────────────────────────
  app.get("/api/checkin/status", requireAuth, (req, res) => {
    const u = checkinDB.getUser(req.user.id);
    res.json({
      coins:       u.coins,
      streak:      u.streak,
      canCheckin:  checkinDB.canCheckin(req.user.id),
      canGacha:    checkinDB.canGacha(req.user.id),
      lastCheckin: u.lastCheckin,
    });
  });

  // ── API: กดเช็คอิน ──────────────────────────────────────────────
  app.post("/api/checkin/claim", requireAuth, (req, res) => {
    const result = checkinDB.doCheckin(req.user.id);
    if (!result.success) return res.status(400).json(result);

    // 📋 LOG: เช็คอินรายวัน
    sendWebLog(client, {
      title: "📅 เช็คอินรายวัน",
      color: "#34d399",
      thumbnail: avatarUrlServer(req.user),
      fields: [
        { name: "👤 ผู้ใช้", value: `${req.user.username} (${req.user.id})` },
        { name: "🪙 ได้รับ", value: `${result.reward} เหรียญ` },
        { name: "🔥 สตรีค",  value: `${result.streak || "-"} วัน` },
      ],
    });

    res.json(result);
  });

  // ── API: รายการยศในร้าน (ดูได้ไม่ต้อง login) ────────────────────
  app.get("/api/checkin/roles", (_req, res) => {
    res.json(checkinDB.getRoles());
  });

  // ── API: แลกยศ ──────────────────────────────────────────────────
  app.post("/api/checkin/redeem", requireAuth, async (req, res) => {
    const { roleId } = req.body;
    if (!roleId) return res.status(400).json({ success: false, error: "Missing roleId" });

    const result = checkinDB.redeemRole(req.user.id, roleId);
    if (!result.success) return res.status(400).json(result);

    try {
      const guild = client.guilds.cache.get(cfg.GUILD_ID);
      if (!guild) throw new Error("ไม่พบเซิร์ฟเวอร์ Discord");

      const member = await guild.members.fetch(req.user.id).catch(() => null);
      if (!member) throw new Error("คุณต้องเป็นสมาชิกในดิสคอร์ดก่อนถึงจะแลกยศได้");

      await member.roles.add(roleId);

      // 📋 LOG: แลกยศสำเร็จ
      sendWebLog(client, {
        title: "🎁 แลกยศสำเร็จ",
        color: "#fbbf24",
        thumbnail: avatarUrlServer(req.user),
        fields: [
          { name: "👤 ผู้ใช้", value: `${req.user.username} (${req.user.id})` },
          { name: "🏷️ ยศ",    value: `${result.role.name}` },
          { name: "🪙 ราคา",   value: `${result.role.price} เหรียญ` },
        ],
      });

      res.json({ success: true, coins: result.coins, role: result.role });
    } catch (err) {
      checkinDB.refund(req.user.id, result.role.price); // คืนเหรียญถ้าให้ยศไม่สำเร็จ
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── API: ข้อมูลระบบสร้างยศกำหนดเอง (ราคา / สร้างได้วันนี้ไหม) ────
  app.get("/api/checkin/custom-role-info", requireAuth, (req, res) => {
    res.json({
      price: checkinDB.getCustomRolePrice(),
      canCreate: checkinDB.canCreateCustomRole(req.user.id),
    });
  });

  // ── API: สร้างยศกำหนดเอง (ตั้งชื่อ+เลือกสีเอง) — วันละ 1 ยศ ──────
  app.post("/api/checkin/create-role", requireAuth, async (req, res) => {
    let { name, color } = req.body;
    if (!name || !color)
      return res.status(400).json({ success: false, error: "กรุณากรอกชื่อยศและเลือกสี" });

    name = String(name).trim().slice(0, 60);
    color = String(color).trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(color))
      return res.status(400).json({ success: false, error: "รูปแบบสีไม่ถูกต้อง" });
    if (!color.startsWith("#")) color = `#${color}`;

    const result = checkinDB.reserveCustomRole(req.user.id, name, color);
    if (!result.success) return res.status(400).json(result);

    try {
      const guild = client.guilds.cache.get(cfg.GUILD_ID);
      if (!guild) throw new Error("ไม่พบเซิร์ฟเวอร์ Discord");

      const member = await guild.members.fetch(req.user.id).catch(() => null);
      if (!member) throw new Error("คุณต้องเป็นสมาชิกในดิสคอร์ดก่อนถึงจะสร้างยศได้");

      const botMember = guild.members.me || (await guild.members.fetchMe());
      if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        throw new Error("บอทไม่มีสิทธิ์ Manage Roles ในเซิร์ฟเวอร์ กรุณาแจ้งแอดมิน");
      }

      const newRole = await guild.roles.create({
        name,
        color,
        reason: `สร้างยศกำหนดเองผ่านเว็บโดย ${req.user.username} (${req.user.id})`,
      });

      // จัดตำแหน่งยศให้อยู่ใต้ role สูงสุดของบอทเสมอ กันปัญหาบอทจัดการยศตัวเองไม่ได้ในอนาคต
      try {
        await newRole.setPosition(Math.max(botMember.roles.highest.position - 1, 1));
      } catch {}

      await member.roles.add(newRole.id);
      checkinDB.commitCustomRole(req.user.id, newRole.id, name, color);

      // 📋 LOG: สร้างยศกำหนดเองสำเร็จ
      sendWebLog(client, {
        title: "🎨 สร้างยศกำหนดเองสำเร็จ",
        color: "#a855f7",
        thumbnail: avatarUrlServer(req.user),
        fields: [
          { name: "👤 ผู้ใช้", value: `${req.user.username} (${req.user.id})` },
          { name: "🏷️ ชื่อยศ", value: name },
          { name: "🎨 สี", value: color },
          { name: "🪙 ราคา", value: `${result.price} เหรียญ` },
        ],
      });

      res.json({ success: true, coins: result.coins, role: { id: newRole.id, name, color } });
    } catch (err) {
      checkinDB.rollbackCustomRole(req.user.id, result.price, result.prevLastCustomRole);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── API: กาชาปองประจำวัน (สุ่มเหรียญ 1 ครั้ง/วัน) ────────────────
  app.post("/api/gacha", requireAuth, (req, res) => {
    const result = checkinDB.doGacha(req.user.id);
    if (!result.success) return res.status(400).json(result);

    if (result.jackpot) {
      sendWebLog(client, {
        title: "🎰 แจ็คพอตกาชาปอง!",
        color: "#fbbf24",
        thumbnail: avatarUrlServer(req.user),
        fields: [
          { name: "👤 ผู้ใช้", value: `${req.user.username} (${req.user.id})` },
          { name: "🪙 ได้รับ", value: `${result.reward} เหรียญ` },
        ],
      });
    }

    res.json(result);
  });

  // ── API: ร้านคอสเมติก (ธีมสี / กรอบโปรไฟล์) ─────────────────────
  app.get("/api/cosmetics/catalog", (req, res) => {
    const catalog = checkinDB.getCosmeticCatalog();
    if (!req.user) return res.json({ catalog, owned: [], equipped: null });
    const mine = checkinDB.getUserCosmetics(req.user.id);
    res.json({ catalog, owned: mine.owned, equipped: { theme: mine.theme, frame: mine.frame } });
  });

  app.post("/api/cosmetics/redeem", requireAuth, (req, res) => {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ success: false, error: "Missing itemId" });
    const result = checkinDB.redeemCosmetic(req.user.id, itemId);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  app.post("/api/cosmetics/equip", requireAuth, (req, res) => {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ success: false, error: "Missing itemId" });
    const result = checkinDB.equipCosmetic(req.user.id, itemId);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  // ── Fallback → index.html ────────────────────────────────────
  app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  // ── Global error handler (ต้องอยู่ท้ายสุดเสมอ) ─────────────────
  // ดัก error ที่หลุดจาก route ไหนก็ตาม (sync throw หรือ next(err)) กันไม่ให้
  // มันหลุดขึ้นไปเป็น uncaughtException แล้วทำให้ทั้งบอทดับตามไปด้วย
  app.use((err, req, res, _next) => {
    logger.error(`[Dashboard] Unhandled route error: ${err?.stack || err?.message || err}`);
    if (res.headersSent) return;
    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  });

  // ── กันเว็บดับทั้งตัวถ้ามี error หลุดจาก async route ที่ลืม catch ──
  process.on("unhandledRejection", (err) => {
    logger.error(`[Dashboard] UnhandledRejection: ${err?.stack || err?.message || err}`);
  });

  // เริ่มเฝ้าดูเพลงใหม่เพื่อส่ง push notification (ทำงานแม้ผู้ใช้ปิดเว็บอยู่)
  startNewSongPushWatcher();

  // เริ่มระบบสแกนตรวจแบนอัตโนมัติ (ทำงานเองเป็นระยะ ไม่ต้องมีคนเปิดเว็บ/กดปุ่ม)
  startAutoBanScanner(client);

  app.listen(cfg.DASHBOARD_PORT, () => {
    logger.web(`Dashboard running → http://localhost:${cfg.DASHBOARD_PORT}`);
  });
}

module.exports = { startDashboard };