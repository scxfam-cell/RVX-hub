// ═══════════════════════════════════════════════════════════════
//  🎵  DAK SYSTEM — Roblox Music Tracker (drop-in command module)
//  Adapted to fit the { data, execute } command shape used by this
//  bot's index.js (commands/*.js auto-loader + auto-deploy).
//  No changes to index.js required — this file self-registers its
//  button / select-menu listeners on first use via interaction.client.
// ═══════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder,
  ChannelType,
  ChannelSelectMenuBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags
} = require("discord.js");
const axios = require("axios");
const fs    = require("fs").promises;
const path  = require("path");
const IS_V2     = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;

const em    = "<a:special_skyblue_star:1506949922744696973>";
const emo1  = "<a:emoji_1:1506949771557081109>";
const emo2  = "<a:emoji_2:1506949696936087654>";
const emo3  = "<a:emoji_3:1506949705504919715>";
const emo4  = "<a:emoji_4:1506949809758666863>";
const emo5  = "<a:emoji_5:1506949825713930325>";
const emo6  = "<a:emoji_6:1506949722299170816>";
const emo7  = "<a:emoji_7:1506949784269885490>";
const emo8  = "<a:emoji_8:1506949712744284214>";
const emo9  = "<a:emoji_9:1506934805516779571>";
const emo10 = "<a:emoji_10:1506949890415132732>";
const emo11 = "<a:emoji_11:1506949882127056969>";

const ALLOWED_CREATOR = "DistrokidOfficial";
const POLL_INTERVAL   = 15_000;
const SEND_DELAY      = 3_000;
const MIN_DURATION    = 30;
const API_URL         = "https://apis.roblox.com/toolbox-service/v2/assets:search";
const DATA_DIR        = "./data/dak";

const guilds = new Map();
const pendingSelect = new Map();
const loadingGuilds = new Map(); // guildId -> in-flight loadGuild() promise, กัน race condition
let initialized = false; // guards lazy self-registration (see ensureInit)

const LANGUAGE_PATTERNS = [
  {
    country: "Thailand", flag: "🇹🇭", lang: "Thai",
    keywords: ["ไทย","สาย","เพลง","ใจ","รัก","หัวใจ","ฝัน","คิดถึง","เธอ","ชีวิต","ทาง","เวลา","ความ","อยาก","เพราะ","หน้า","บอก"],
    regex: /[\u0E00-\u0E7F]/
  },
  {
    country: "Japan", flag: "🇯🇵", lang: "Japanese",
    keywords: [],
    regex: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/
  },
  {
    country: "South Korea", flag: "🇰🇷", lang: "Korean",
    keywords: [],
    regex: /[\uAC00-\uD7AF\u1100-\u11FF]/
  },
  {
    country: "China", flag: "🇨🇳", lang: "Chinese",
    keywords: [],
    regex: /[\u4E00-\u9FFF\u3400-\u4DBF]/
  },
  {
    country: "Russia", flag: "🇷🇺", lang: "Russian",
    keywords: [],
    regex: /[\u0400-\u04FF]/
  },
  {
    country: "Arab World", flag: "🌍", lang: "Arabic",
    keywords: [],
    regex: /[\u0600-\u06FF]/
  },
  {
    country: "Latin America", flag: "🌎", lang: "Spanish",
    keywords: ["amor","corazón","vida","noche","quiero","siempre","música","baile","eres","para"],
    regex: /[áéíóúüñ¿¡]/i
  },
  {
    country: "Brazil", flag: "🇧🇷", lang: "Portuguese",
    keywords: ["amor","saudade","você","meu","coração","vida","minha","para","não"],
    regex: /[ãõçâêô]/i
  },
  {
    country: "France", flag: "🇫🇷", lang: "French",
    keywords: ["amour","coeur","nuit","vie","tout","pour","avec","dans","être","nous"],
    regex: /[àâæçèéêëîïôœùûü]/i
  },
  {
    country: "Germany", flag: "🇩🇪", lang: "German",
    keywords: ["herz","liebe","nacht","traum","welt","immer","alles","nicht","ohne","durch"],
    regex: /[äöüßÄÖÜ]/
  },
  {
    country: "India", flag: "🇮🇳", lang: "Hindi",
    keywords: [],
    regex: /[\u0900-\u097F]/
  },
  {
    country: "Indonesia", flag: "🇮🇩", lang: "Indonesian",
    keywords: ["cinta","hati","jiwa","rindu","kamu","teman","hidup","mimpi","indah","bersama","sayang"],
    regex: null
  },
  {
    country: "International", flag: "🌐", lang: "English",
    keywords: ["love","heart","dream","night","life","soul","time","feel","world","shine","forever","moment"],
    regex: null
  }
];

function detectLanguageCountry(title, description = "") {
  const text = `${title} ${description}`.toLowerCase();

  for (const p of LANGUAGE_PATTERNS) {
    if (p.regex && p.regex.test(text)) {
      return { country: p.country, flag: p.flag, lang: p.lang };
    }
    if (p.keywords.length > 0 && p.keywords.some(k => text.includes(k.toLowerCase()))) {
      return { country: p.country, flag: p.flag, lang: p.lang };
    }
  }
  return { country: "International", flag: "🌐", lang: "English" };
}

function detectGenre(title) {
  const t = title.toLowerCase();
  // หมายเหตุ: ตัด \b ปิดท้ายออกสำหรับคำก้าน (stem) เพื่อให้ match รูปแบบเติม suffix ได้
  // เช่น "relax" ต้อง match "Relaxed Scene" ด้วย ไม่ใช่แค่คำว่า "relax" เป๊ะๆ
  if (/\b(lofi|lo-fi|chill|relax|sleep|stud(?:y|io))/.test(t)) return { name: "Lo-Fi / Chill", icon: "🌙" };
  if (/\b(edm|electronic|house|techno|danc|rav|club)/.test(t)) return { name: "EDM / Electronic", icon: "⚡" };
  if (/\b(trap|rap|hip.?hop|drill|bass|808)/.test(t)) return { name: "Hip-Hop / Trap", icon: "🎤" };
  if (/\b(pop|catchy|viral|hit|chart)/.test(t)) return { name: "Pop", icon: "🌟" };
  if (/\b(rock|metal|punk|guitar|band|drum)/.test(t)) return { name: "Rock / Metal", icon: "🎸" };
  if (/\b(jazz|blues|swing|funk|soul)/.test(t)) return { name: "Jazz / Soul", icon: "🎷" };
  if (/\b(classical|piano|orchestra|violin|string|opus)/.test(t)) return { name: "Classical", icon: "🎼" };
  if (/\b(phonk|slap|drift|car)/.test(t)) return { name: "Phonk", icon: "🚗" };
  if (/\b(ost|soundtrack|theme|score|cinemat|epic|film)/.test(t)) return { name: "Soundtrack / OST", icon: "🎬" };
  if (/\b(r&b|rnb|slow|smooth|groov)/.test(t)) return { name: "R&B / Groove", icon: "🎵" };
  if (/\b(country|folk|acoustic|indie)/.test(t)) return { name: "Acoustic / Folk", icon: "🪕" };
  if (/\b(christmas|holiday|festiv|xmas)/.test(t)) return { name: "Holiday / Festive", icon: "🎄" };
  return { name: "Unknown", icon: "🎧" };
}

function analyzeAudio(buf) {
  let offset = 0;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const id3Size =
      ((buf[6] & 0x7F) << 21) |
      ((buf[7] & 0x7F) << 14) |
      ((buf[8] & 0x7F) << 7)  |
       (buf[9] & 0x7F);
    offset = id3Size + 10;
  }
  let bitrate = 128;
  let sampleRate = 44100;
  let stereo = false;
  let frameFound = false;

  for (let i = offset; i < Math.min(buf.length - 4, offset + 16384); i++) {
    if (buf[i] === 0xFF && (buf[i+1] & 0xE0) === 0xE0) {
      const b1 = buf[i+1];
      const b2 = buf[i+2];
      const b3 = buf[i+3];
      const layer       = (b1 >> 1) & 0x03;
      const bitrateIdx  = (b2 >> 4) & 0x0F;
      const srIdx       = (b2 >> 2) & 0x03;
      const channelMode = (b3 >> 6) & 0x03;

      const bitrateTable = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
      const srTable      = [44100,48000,32000,0];

      if (bitrateIdx > 0 && bitrateIdx < 15 && srIdx < 3) {
        bitrate    = bitrateTable[bitrateIdx];
        sampleRate = srTable[srIdx];
        stereo     = channelMode !== 0x03;
        frameFound = true;
        break;
      }
    }
  }

  const audioBytes  = buf.length - offset;
  const durationSec = bitrate > 0 ? (audioBytes * 8) / (bitrate * 1000) : (buf.length * 8) / (128 * 1000);

  let sum     = 0;
  let peak    = 0;
  const start = offset;
  const end   = Math.min(buf.length, start + 200_000);
  const count = end - start;

  for (let i = start; i < end; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }

  const rms  = count > 0 ? Math.sqrt(sum / count) : 0;
  const dbfs = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
  const peakDb = peak > 1e-6 ? 20 * Math.log10(peak) : -100;

  const dr = Math.round(peakDb - dbfs);

  let bpm = 0;
  try {
    const windowSize = Math.min(10000, Math.floor(count / 4));
    if (windowSize > 100) {
      let peaks2 = 0;
      let prevEnergy = 0;
      for (let i = start; i < start + windowSize * 4; i += 4) {
        let blockEnergy = 0;
        for (let j = i; j < Math.min(i + 4, end); j++) {
          const v = (buf[j] - 128) / 128;
          blockEnergy += v * v;
        }
        if (blockEnergy > prevEnergy * 1.5 && blockEnergy > 0.01) peaks2++;
        prevEnergy = blockEnergy;
      }
      const analysedSecs = (windowSize * 4) / (bitrate * 1000 / 8);
      if (analysedSecs > 0) {
        bpm = Math.round((peaks2 / analysedSecs) * 60);
        if (bpm < 40 || bpm > 220) bpm = 0;
      }
    }
  } catch {}

  return {
    dbfs          : Math.round(dbfs * 10) / 10,
    peakDb        : Math.round(peakDb * 10) / 10,
    durationSec   : Math.max(0, durationSec),
    bitrate,
    sampleRate,
    stereo,
    dr            : Math.max(0, dr),
    bpm,
    frameFound
  };
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return "N/A";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`
    : `${m}:${s.toString().padStart(2,"0")}`;
}

function fmtSize(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(2)} MB`;
}

function dbfsMeter(db) {
  const bars = 14;
  const pct  = Math.max(0, Math.min(1, (db + 60) / 60));
  const filled = Math.round(pct * bars);
  const bar = "▰".repeat(filled) + "▱".repeat(bars - filled);
  let color = "🟢";
  if (db > -10) color = "🔴";
  else if (db > -20) color = "🟡";
  return `${color} \`${bar}\` \`${Math.round(pct * 100)}%\`  \`${db} dB\``;
}

function stateFile(guildId) {
  return path.join(DATA_DIR, `${guildId}.json`);
}

async function loadGuild(guildId) {
  try {
    const raw = JSON.parse(await fs.readFile(stateFile(guildId), "utf8"));
    guilds.set(guildId, {
      interval  : null,
      isRunning : false,
      lastSeen  : raw.lastSeen ?? {},
      stats     : raw.stats ?? { totalDetected: 0, byCountry: {}, byGenre: {} },
      config    : {
        mainChannelId  : raw.config?.mainChannelId  ?? null,
        loudChannelId  : raw.config?.loudChannelId  ?? null,
        quietChannelId : raw.config?.quietChannelId ?? null,
        loudThreshold  : raw.config?.loudThreshold  ?? -10,
        quietThreshold : raw.config?.quietThreshold ?? -30,
      }
    });
  } catch {
    guilds.set(guildId, {
      interval: null, isRunning: false, lastSeen: {},
      stats: { totalDetected: 0, byCountry: {}, byGenre: {} },
      config: { mainChannelId: null, loudChannelId: null, quietChannelId: null, loudThreshold: -10, quietThreshold: -30 }
    });
  }
}

// กัน race condition: ถ้ามีหลายจุดพยายามโหลด guild เดียวกันพร้อมกัน
// (เช่น auto-resume ตอน ensureInit + execute() ที่ผู้ใช้กด /dak พร้อมกัน)
// ให้รอ promise เดิมแทนที่จะยิง loadGuild() ซ้ำ ซึ่งจะรีเซ็ต isRunning
// กลายเป็นเปิด monitor ซ้อนกัน 2 ตัวได้
async function ensureGuildLoaded(guildId) {
  if (guilds.has(guildId)) return;
  if (loadingGuilds.has(guildId)) {
    await loadingGuilds.get(guildId);
    return;
  }
  const p = loadGuild(guildId);
  loadingGuilds.set(guildId, p);
  try {
    await p;
  } finally {
    loadingGuilds.delete(guildId);
  }
}

async function saveGuild(guildId) {
  const g = guilds.get(guildId);
  if (!g) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    stateFile(guildId),
    JSON.stringify({ config: g.config, lastSeen: g.lastSeen, stats: g.stats }, null, 2),
    "utf8"
  );
}

function getGuild(guildId) {
  if (!guilds.has(guildId)) {
    guilds.set(guildId, {
      interval: null, isRunning: false, lastSeen: {},
      stats: { totalDetected: 0, byCountry: {}, byGenre: {} },
      config: { mainChannelId: null, loudChannelId: null, quietChannelId: null, loudThreshold: -10, quietThreshold: -30 }
    });
  }
  return guilds.get(guildId);
}

const OGG_WRAP_HEADER = Buffer.from([0x4F, 0x67, 0x67, 0x53]);

async function downloadAudio(assetId) {
  const headers = {
    "User-Agent"     : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Referer"        : `https://www.roblox.com/library/${assetId}`,
    "Accept"         : "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  let buf = null;

  try {
    const r = await axios.get(
      `https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`,
      { headers, responseType: "arraybuffer", timeout: 20000, maxRedirects: 10 }
    );
    if (r.status === 200 && r.data?.byteLength > 1000) {
      buf = Buffer.from(r.data);
    }
  } catch {}

  if (!buf) {
    try {
      const vr = await axios.get(
        `https://develop.roblox.com/v2/assets/${assetId}/versions?sortOrder=Desc&limit=1`,
        { headers, timeout: 10000 }
      );
      const versionId = vr.data?.data?.[0]?.id;
      if (versionId) {
        const r2 = await axios.get(
          `https://assetdelivery.roblox.com/v2/assetId/${versionId}`,
          { headers, responseType: "arraybuffer", timeout: 20000, maxRedirects: 10 }
        );
        if (r2.status === 200 && r2.data?.byteLength > 1000) {
          buf = Buffer.from(r2.data);
        }
      }
    } catch {}
  }

  if (!buf) return null;

  const isMP3 = (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) ||
                (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33);

  const isOGG = buf.slice(0, 4).equals(OGG_WRAP_HEADER);

  if (isOGG) {
    for (let i = 4; i < Math.min(buf.length - 4, 65536); i++) {
      if (
        (buf[i] === 0x49 && buf[i+1] === 0x44 && buf[i+2] === 0x33) ||
        (buf[i] === 0xFF && (buf[i+1] & 0xE0) === 0xE0)
      ) {
        buf = buf.slice(i);
        break;
      }
    }
  }

  return buf;
}

function buildMainUI(guildId) {
  const g   = getGuild(guildId);
  const cfg = g.config;
  const runEmoji = g.isRunning ? "🟢" : "🔴";
  const runLabel = g.isRunning ? "ACTIVE — กำลังดักอยู่" : "OFFLINE — หยุดทำงาน";
  const songs = Object.keys(g.lastSeen).length;
  const total = g.stats?.totalDetected ?? 0;

  const chMain  = cfg.mainChannelId   ? `<#${cfg.mainChannelId}>`   : "`❌ ยังไม่ตั้งค่า`";
  const chLoud  = cfg.loudChannelId   ? `<#${cfg.loudChannelId}>`   : "`❌ ยังไม่ตั้งค่า`";
  const chQuiet = cfg.quietChannelId  ? `<#${cfg.quietChannelId}>`  : "`❌ ยังไม่ตั้งค่า`";

  const byCountry = g.stats?.byCountry ?? {};
  const topCountries = Object.entries(byCountry)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([c, v]) => `${v.flag} **${c}** \`${v.count}\``)
    .join("  ·  ") || "_ยังไม่มีข้อมูล_";

  return {
    flags: IS_V2,
    components: [{
      type: 17,
      accent_color: g.isRunning ? 0x00FF88 : 0xFF6B00,
      components: [
        {
          type: 10,
          content:
            `# 🎵  DAK System — Roblox Music Tracker\n` +
            `\`\`\`\n` +
            ` STATUS  : ${runEmoji}  ${runLabel}\n` +
            ` CREATOR : ${ALLOWED_CREATOR}\n` +
            ` INTERVAL: Every ${POLL_INTERVAL / 1000}s  │  SONGS SEEN: ${songs}  │  TOTAL HITS: ${total}\n` +
            `\`\`\`\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        },
        {
          type: 10,
          content:
            `### ⚡  Real-Time Features\n` +
            `> 🔄  **「 AUTO DETECT 」**  ดักเพลงใหม่ทุก **15 วินาที** อัตโนมัติ\n` +
            `> 🎧  **「 MP3 PLAYBACK 」**  ไฟล์ MP3 กดฟังได้เลยใน Discord ✅\n` +
            `> 📊  **「 dB ANALYSIS 」**  วิเคราะห์ dBFS + Peak + Dynamic Range\n` +
            `> 🌍  **「 COUNTRY ID 」**  ตรวจภาษา/ประเทศจาก title อัตโนมัติ\n` +
            `> 🎼  **「 GENRE DETECT 」**  ระบุ Genre เพลงจาก keywords\n` +
            `> 🔀  **「 dB ROUTING 」**  แยกห้องตามความดัง (Loud / Normal / Quiet)\n` +
            `> 🖥️ **「 MULTI SERVER 」**  ตั้งค่าแยกได้แต่ละ Server\n` +
            `> 📈 **「 STATS 」**  สถิติรายประเทศ + genre สะสม`
        },
        { type: 14, divider: true, spacing: 2 },
        {
          type: 10,
          content:
            `### ${emo6}  Channel Configuration\n` +
            `> 📢  **ห้องหลัก** _(ทุกเพลง)_ → ${chMain}\n` +
            `> 🔊  **ห้องเพลงดัง** _(> \`${cfg.loudThreshold} dBFS\`)_ → ${chLoud}\n` +
            `> 🔈  **ห้องเพลงเบา** _(< \`${cfg.quietThreshold} dBFS\`)_ → ${chQuiet}\n\n` +
            `### 🌍  Top Countries Detected\n` +
            `> ${topCountries}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        },
        { type: 14, divider: true, spacing: 2 },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "dak_start",  label: "▶  START",      style: 3, emoji: { id: "1506949771557081109", animated: true } },
            { type: 2, custom_id: "dak_stop",   label: "⏹  STOP",       style: 4, emoji: { id: "1506949696936087654", animated: true } },
            { type: 2, custom_id: "dak_info",   label: "📊  STATS",      style: 1, emoji: { id: "1506949705504919715", animated: true } },
            { type: 2, custom_id: "dak_test",   label: "🔬  TEST",       style: 2, emoji: { id: "1506949712744284214", animated: true } },
          ]
        },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "dak_cfg_main",   label: "📢  ห้องหลัก",    style: 2, emoji: { id: "1506949809758666863", animated: true } },
            { type: 2, custom_id: "dak_cfg_loud",   label: "🔊  ห้องดัง",     style: 2, emoji: { id: "1506949825713930325", animated: true } },
            { type: 2, custom_id: "dak_cfg_quiet",  label: "🔈  ห้องเบา",     style: 2, emoji: { id: "1506949722299170816", animated: true } },
            { type: 2, custom_id: "dak_cfg_db",     label: "🎚  ตั้งค่า dB",  style: 2, emoji: { id: "1506949784269885490", animated: true } },
          ]
        },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "dak_reset",   label: "🔄  รีเซ็ตประวัติ",    style: 2 },
            { type: 2, custom_id: "dak_refresh", label: "♻️  รีเฟรช UI",        style: 2 },
          ]
        }
      ]
    }]
  };
}

function buildChannelSelectUI(label) {
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("dak_channel_select")
      .setPlaceholder(`เลือกห้อง — ${label}`)
      .addChannelTypes(ChannelType.GuildText)
  );
  return {
    flags: IS_V2 | EPHEMERAL,
    components: [
      {
        type: 17,
        accent_color: 0x00CFFF,
        components: [
          {
            type: 10,
            content:
              `# ${emo8}  เลือกห้อง — ${label}\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `> ${emo4}  เลือก **Text Channel** ที่ต้องการรับการแจ้งเตือน\n` +
              `> ${emo5}  บอทต้องมีสิทธิ์ **Send Messages** ในห้องนั้น\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
          },
          { type: 14, divider: true, spacing: 1 }
        ]
      },
      row.toJSON()
    ]
  };
}

function buildDbConfigUI(guildId) {
  const g = getGuild(guildId);
  return {
    flags: IS_V2 | EPHEMERAL,
    components: [{
      type: 17,
      accent_color: 0xFFD700,
      components: [
        {
          type: 10,
          content:
            `# 🎚  dB Threshold Config\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        },
        {
          type: 10,
          content:
            `### ${emo3}  ค่าปัจจุบัน\n` +
            `> 🔊  **LOUD threshold** → เพลงดัง ถ้า dBFS **>** \`${g.config.loudThreshold} dB\`\n` +
            `> 🔈  **QUIET threshold** → เพลงเบา ถ้า dBFS **<** \`${g.config.quietThreshold} dB\`\n` +
            `> 🎵  ช่วงกลาง → ส่งแค่ห้องหลักอย่างเดียว\n\n` +
            `### ${emo7}  ตารางอ้างอิง dBFS\n` +
            `\`\`\`\n` +
            `  0 dBFS  ████████████  MAX (ดังสุด / clip)\n` +
            ` -6 dBFS  ███████████░  ดังมากๆ\n` +
            `-10 dBFS  ██████████░░  ดัง (default LOUD)\n` +
            `-18 dBFS  ████████░░░░  ปกติ (commercial)\n` +
            `-23 dBFS  ███████░░░░░  มาตรฐาน streaming\n` +
            `-30 dBFS  █████░░░░░░░  เบา (default QUIET)\n` +
            `-40 dBFS  ███░░░░░░░░░  เบามาก\n` +
            `-60 dBFS  █░░░░░░░░░░░  แทบไม่ได้ยิน\n` +
            `\`\`\`\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        },
        { type: 14, divider: true, spacing: 2 },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "dak_db_loud_up",    label: "🔊 Loud +5",   style: 3 },
            { type: 2, custom_id: "dak_db_loud_down",  label: "🔊 Loud -5",   style: 4 },
            { type: 2, custom_id: "dak_db_quiet_up",   label: "🔈 Quiet +5",  style: 3 },
            { type: 2, custom_id: "dak_db_quiet_down", label: "🔈 Quiet -5",  style: 4 },
          ]
        }
      ]
    }]
  };
}

function buildInfoUI(guildId) {
  const g    = getGuild(guildId);
  const cfg  = g.config;
  const songs = Object.keys(g.lastSeen).length;

  const recent = Object.keys(g.lastSeen).slice(-5).reverse();
  const recentText = recent.length
    ? recent.map((id, i) => `> \`${i+1}.\` \`${id}\` → [เปิดใน Roblox](https://www.roblox.com/library/${id})`).join("\n")
    : "> _ยังไม่มีเพลงที่ดักได้_";

  const byCountry = g.stats?.byCountry ?? {};
  const countryList = Object.entries(byCountry)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([c, v]) => `> ${v.flag}  **${c}**  \`${v.count} เพลง\``)
    .join("\n") || "> _ยังไม่มีข้อมูล_";

  const byGenre = g.stats?.byGenre ?? {};
  const genreList = Object.entries(byGenre)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g2, cnt]) => `> **${g2}**  \`${cnt}\``)
    .join("\n") || "> _ยังไม่มีข้อมูล_";

  return {
    flags: IS_V2 | EPHEMERAL,
    components: [{
      type: 17,
      accent_color: 0x00CFFF,
      components: [
        {
          type: 10,
          content: `# ${emo9}  DAK Statistics\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        },
        {
          type: 10,
          content:
            `### ${emo3}  System Status\n` +
            `\`\`\`\n` +
            ` STATUS   : ${g.isRunning ? "🟢 RUNNING" : "🔴 STOPPED"}\n` +
            ` CREATOR  : ${ALLOWED_CREATOR}\n` +
            ` INTERVAL : ${POLL_INTERVAL / 1000}s\n` +
            ` SEEN     : ${songs} IDs\n` +
            ` TOTAL    : ${g.stats?.totalDetected ?? 0} HITS\n` +
            ` CHANNELS : MAIN=${cfg.mainChannelId ? "✅" : "❌"}  LOUD=${cfg.loudChannelId ? "✅" : "❌"}  QUIET=${cfg.quietChannelId ? "✅" : "❌"}\n` +
            `\`\`\`\n\n` +
            `### 🌍  Top Countries\n${countryList}\n\n` +
            `### 🎸  Top Genres\n${genreList}\n\n` +
            `### ${emo5}  Last 5 Tracks\n${recentText}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        },
        { type: 14, divider: true, spacing: 1 }
      ]
    }]
  };
}

function buildSuccessUI(title, desc) {
  return {
    flags: IS_V2 | EPHEMERAL,
    components: [{
      type: 17,
      accent_color: 0x00FF88,
      components: [
        {
          type: 10,
          content:
            `# ${em}  ${title}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `> ✅  ${desc}`
        },
        { type: 14, divider: true, spacing: 1 }
      ]
    }]
  };
}

function buildErrorUI(msg) {
  return {
    flags: IS_V2 | EPHEMERAL,
    components: [{
      type: 17,
      accent_color: 0xFF4444,
      components: [
        {
          type: 10,
          content:
            `# 💥  ERROR\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `> ❌  **${msg}**`
        },
        { type: 14, divider: true, spacing: 1 }
      ]
    }]
  };
}

async function sendNotify(discordClient, guildId, item) {
  const g     = getGuild(guildId);
  const asset = item?.asset ?? {};
  const aid   = String(asset.id ?? "");
  const title = asset.title ?? asset.name ?? "ไม่มีชื่อ";
  const desc  = asset.description ?? "";

  const lower = title.toLowerCase();
  if (["sound effect","sfx","effect","ambient","footstep","gunshot","explosion","click","ui ","wind","rain","footsteps"]
      .some(k => lower.includes(k))) {
    console.log(`[DAK:${guildId}] ⛔ ข้าม SFX → "${title}"`);
    return;
  }

  const audioData = await downloadAudio(aid);
  if (!audioData || audioData.length < 1000) {
    console.log(`[DAK:${guildId}] ❌ ดาวน์โหลดล้มเหลว → ${aid}`);
    return;
  }

  const analysis = analyzeAudio(audioData);
  const { dbfs, peakDb, durationSec, bitrate, sampleRate, stereo, dr, bpm, frameFound } = analysis;

  if (durationSec > 0 && durationSec < MIN_DURATION) {
    console.log(`[DAK:${guildId}] ⛔ เพลงสั้นเกินไป ${Math.round(durationSec)}s → "${title}"`);
    return;
  }

  const { country, flag: countryFlag, lang } = detectLanguageCountry(title, desc);

  const genre = detectGenre(title);

  g.stats ??= { totalDetected: 0, byCountry: {}, byGenre: {} };
  g.stats.totalDetected = (g.stats.totalDetected ?? 0) + 1;
  if (!g.stats.byCountry[country]) g.stats.byCountry[country] = { count: 0, flag: countryFlag };
  g.stats.byCountry[country].count++;
  const genreKey = `${genre.icon} ${genre.name}`;
  g.stats.byGenre[genreKey] = (g.stats.byGenre[genreKey] ?? 0) + 1;

  let imageUrl = null;
  try {
    const t = await axios.get(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${aid}&size=420x420&format=Png`,
      { timeout: 8000 }
    );
    const thumb = t.data?.data?.[0];
    // ใช้รูปเฉพาะตอนที่ Roblox render เสร็จแล้วจริงๆ (state === "Completed")
    // ถ้ายัง Pending/Blocked/Error จะได้ไอคอนลำโพง generic — ข้ามไปดีกว่าโชว์รูปพัง
    if (thumb?.state === "Completed" && thumb?.imageUrl) {
      imageUrl = thumb.imageUrl;
    }
  } catch {}

  const dur  = fmtDuration(durationSec);
  const size = fmtSize(audioData.length);
  const srStr = sampleRate >= 1000 ? `${(sampleRate/1000).toFixed(1)} kHz` : `${sampleRate} Hz`;
  const chStr = stereo ? "Stereo 🎧" : "Mono 🔈";
  const bpmStr = bpm > 0 ? `~${bpm} BPM` : "N/A";

  let volTag   = "🎵 ปกติ (Normal)";
  let volColor = 0x00AA55;
  if (dbfs > g.config.loudThreshold)  { volTag = "🔊 ดัง (Loud)";   volColor = 0xFF2200; }
  if (dbfs < g.config.quietThreshold) { volTag = "🔈 เบา (Quiet)";  volColor = 0x0099FF; }

  const meter = dbfsMeter(dbfs);

  const safeTitle = title.replace(/[^\w\s\-_.]/g, "").replace(/\s+/g, "_").slice(0, 80) || aid;
  const mp3Filename = `${safeTitle}_${aid}.mp3`;

  const attachment = new AttachmentBuilder(audioData, {
    name        : mp3Filename,
    description : `${title} — ${ALLOWED_CREATOR} (${dur})`
  });

  const payload = {
    flags: IS_V2,
    components: [{
      type: 17,
      accent_color: volColor,
      components: [
        {
          type: 10,
          content:
            `# ${emo1}  Song Detected  ${volTag}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        },
        ...(imageUrl ? [{ type: 12, items: [{ media: { url: imageUrl } }] }] : []),
        {
          type: 10,
          content:
            `### ${emo3}  Track Info\n` +
            `> ${emo4}  **ชื่อ :** \`${title}\`\n` +
            `> ${emo5}  **Asset ID :** \`${aid}\`\n` +
            `> ${emo6}  **Creator :** \`${ALLOWED_CREATOR}\`\n` +
            `> ${emo7}  **ความยาว :** \`${dur}\`\n` +
            `> ${emo8}  **ขนาดไฟล์ :** \`${size}\`\n` +
            `> 🕒  **ตรวจพบ :** <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
            `### 🌍  Country + Genre\n` +
            `> ${countryFlag}  **ประเทศ :** \`${country}\`  (ภาษา: \`${lang}\`)\n` +
            `> ${genre.icon}  **แนวเพลง :** \`${genre.name}\`\n\n` +
            `### 📊  Audio Analysis\n` +
            `> 📶  **Volume :**  ${meter}\n` +
            `> 🔺  **Peak dBFS :** \`${peakDb} dB\`\n` +
            `> 🎚  **Dynamic Range :** \`${dr} dB\`\n` +
            `> ⚡  **BPM (approx) :** \`${bpmStr}\`\n` +
            `> 🎧  **Format :** \`${bitrate}kbps  ${srStr}  ${chStr}\`\n\n` +
            `> 🔗  [เปิดใน Roblox](https://www.roblox.com/library/${aid})\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${emo10}  **กด ▶ play ที่ไฟล์ด้านล่างเพื่อฟังทันที 👇**`
        },
        { type: 14, divider: true, spacing: 2 }
      ]
    }],
    files: [attachment]
  };

  if (g.config.mainChannelId) {
    const ch = discordClient.channels.cache.get(g.config.mainChannelId);
    if (ch) {
      await ch.send(payload).catch(e => console.error(`[DAK] send main:`, e.message));
    }
  }

  if (dbfs > g.config.loudThreshold && g.config.loudChannelId && g.config.loudChannelId !== g.config.mainChannelId) {
    const ch = discordClient.channels.cache.get(g.config.loudChannelId);
    if (ch) {
      await new Promise(r => setTimeout(r, SEND_DELAY));
      await ch.send(payload).catch(e => console.error(`[DAK] send loud:`, e.message));
    }
  }

  if (dbfs < g.config.quietThreshold && g.config.quietChannelId && g.config.quietChannelId !== g.config.mainChannelId) {
    const ch = discordClient.channels.cache.get(g.config.quietChannelId);
    if (ch) {
      await new Promise(r => setTimeout(r, SEND_DELAY));
      await ch.send(payload).catch(e => console.error(`[DAK] send quiet:`, e.message));
    }
  }

  console.log(`[DAK:${guildId}] ✅ ${title} | ${dur} | ${dbfs}dBFS | ${volTag} | ${country}${countryFlag} | ${genre.name}`);
}

async function runMonitor(discordClient, guildId) {
  const g = getGuild(guildId);
  try {
    const res = await axios.get(API_URL, {
      params: {
        searchCategoryType: "Audio",
        creatorName       : ALLOWED_CREATOR,
        limit             : 100,
        sortType          : "1"
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept"    : "application/json"
      },
      timeout: 12000
    });

    const assets = res.data?.creatorStoreAssets ?? [];
    let newCount = 0;

    for (const item of assets) {
      const aid = String(item?.asset?.id ?? "");
      const upd = item?.asset?.updateTime ?? item?.asset?.createdTime ?? "";
      if (!aid) continue;

      if (!g.lastSeen[aid] || g.lastSeen[aid] !== upd) {
        g.lastSeen[aid] = upd;
        newCount++;
        await sendNotify(discordClient, guildId, item);
        await new Promise(r => setTimeout(r, SEND_DELAY));
      }
    }

    if (newCount > 0) {
      await saveGuild(guildId);
      console.log(`[DAK:${guildId}] 🎵 พบเพลงใหม่ ${newCount} เพลง`);
    }

  } catch (err) {
    console.error(`[DAK:${guildId}] ❌ Monitor error:`, err.message);
  }
}

function startMonitor(discordClient, guildId) {
  const g = getGuild(guildId);
  if (g.isRunning) return;
  g.isRunning = true;
  runMonitor(discordClient, guildId);
  g.interval = setInterval(() => runMonitor(discordClient, guildId), POLL_INTERVAL);
  console.log(`[DAK:${guildId}] 🟢 เริ่มดัก`);
}

function stopMonitor(guildId) {
  const g = getGuild(guildId);
  if (!g.isRunning) return;
  clearInterval(g.interval);
  g.interval  = null;
  g.isRunning = false;
  console.log(`[DAK:${guildId}] 🔴 หยุดดัก`);
}

async function onStart(interaction, discordClient) {
  const guildId = interaction.guildId;
  const g = getGuild(guildId);
  if (g.isRunning) return interaction.reply(buildErrorUI("ระบบดักกำลังทำงานอยู่แล้ว — กด ⏹ STOP ก่อน"));
  if (!g.config.mainChannelId) return interaction.reply(buildErrorUI("กรุณาตั้งค่า 📢 ห้องหลักก่อน แล้วค่อยกด START"));
  startMonitor(discordClient, guildId);
  await interaction.reply(buildSuccessUI(
    "DAK System Started!",
    `กำลังดัก **${ALLOWED_CREATOR}** ทุก ${POLL_INTERVAL/1000}s → <#${g.config.mainChannelId}>`
  ));
}

async function onStop(interaction) {
  const guildId = interaction.guildId;
  const g = getGuild(guildId);
  if (!g.isRunning) return interaction.reply(buildErrorUI("ระบบดักไม่ได้ทำงานอยู่"));
  stopMonitor(guildId);
  await interaction.reply(buildSuccessUI("DAK System Stopped", "ระบบดักถูกปิดเรียบร้อยแล้ว ✅"));
}

async function onInfo(interaction) {
  await interaction.reply(buildInfoUI(interaction.guildId));
}

async function onReset(interaction) {
  const guildId = interaction.guildId;
  const g = getGuild(guildId);
  g.lastSeen = {};
  g.stats    = { totalDetected: 0, byCountry: {}, byGenre: {} };
  await saveGuild(guildId);
  await interaction.reply(buildSuccessUI("รีเซ็ตแล้ว!", "ล้างประวัติเพลงและสถิติทั้งหมด ระบบจะแจ้งเตือนใหม่ในรอบต่อไป"));
}

async function onRefresh(interaction) {
  const guildId = interaction.guildId;
  await ensureGuildLoaded(guildId);
  try {
    await interaction.update(buildMainUI(guildId));
  } catch {
    await interaction.reply(buildMainUI(guildId));
  }
}

async function onTest(interaction, discordClient) {
  const guildId = interaction.guildId;
  const g = getGuild(guildId);
  if (!g.config.mainChannelId) return interaction.reply(buildErrorUI("กรุณาตั้งค่าห้องหลักก่อน"));

  await interaction.reply(buildSuccessUI("กำลัง TEST", "กำลังดึงเพลงทดสอบ รอสักครู่..."));

  try {
    const res = await axios.get(API_URL, {
      params: { searchCategoryType: "Audio", creatorName: ALLOWED_CREATOR, limit: 5, sortType: "1" },
      timeout: 12000
    });
    const assets = res.data?.creatorStoreAssets ?? [];
    if (assets.length > 0) {
      await sendNotify(discordClient, guildId, assets[0]);
    } else {
      await interaction.followUp(buildErrorUI("ไม่พบเพลงจาก API"));
    }
  } catch (e) {
    await interaction.followUp(buildErrorUI(`API error: ${e.message}`));
  }
}

async function onCfgChannel(interaction, type) {
  const key = `${interaction.user.id}:${interaction.guildId}`;
  pendingSelect.set(key, type);
  const labels = { main: "ห้องหลัก (ทุกเพลง)", loud: "ห้องเพลงดัง", quiet: "ห้องเพลงเบา" };
  await interaction.reply(buildChannelSelectUI(labels[type] ?? type));
}

async function onChannelSelect(interaction) {
  const key     = `${interaction.user.id}:${interaction.guildId}`;
  const type    = pendingSelect.get(key) ?? "main";
  const guildId = interaction.guildId;
  const chId    = interaction.values[0];
  const g       = getGuild(guildId);
  pendingSelect.delete(key);

  const fieldMap = { main: "mainChannelId", loud: "loudChannelId", quiet: "quietChannelId" };
  const labels   = { main: "ห้องหลัก", loud: "ห้องเพลงดัง", quiet: "ห้องเพลงเบา" };
  g.config[fieldMap[type]] = chId;
  await saveGuild(guildId);

  await interaction.update(buildSuccessUI(
    `ตั้งค่า ${labels[type]} สำเร็จ`,
    `บันทึก <#${chId}> เป็น **${labels[type]}** แล้ว ✅`
  ));
}

async function onCfgDb(interaction) {
  await interaction.reply(buildDbConfigUI(interaction.guildId));
}

async function onDbAdjust(interaction, target, delta) {
  const guildId = interaction.guildId;
  const g       = getGuild(guildId);
  const field   = target === "loud" ? "loudThreshold" : "quietThreshold";
  g.config[field] = Math.min(0, Math.max(-60, g.config[field] + delta));
  await saveGuild(guildId);
  await interaction.update(buildDbConfigUI(guildId));
}

// ──────────────────────────────────────────────
//  🔌  SELF-REGISTRATION (no index.js changes needed)
//  ensureInit() runs once, the first time /dak is used.
//  It gets the live client via interaction.client and:
//   1. Attaches a dedicated interactionCreate listener that
//      only reacts to dak_* buttons / the dak channel select
//      menu (everything else is ignored, so it plays nicely
//      alongside your existing listeners in index.js).
//   2. Resumes any monitors that were running before restart.
// ──────────────────────────────────────────────
function ensureInit(discordClient) {
  if (initialized) return;
  initialized = true;

  discordClient.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) return; // handled by execute()

      if (interaction.guildId)
        await ensureGuildLoaded(interaction.guildId);

      if (interaction.isButton()) {
        const id = interaction.customId;
        if (!id || !id.startsWith("dak_")) return;

        if (id === "dak_start")           return onStart(interaction, discordClient);
        if (id === "dak_stop")            return onStop(interaction);
        if (id === "dak_info")            return onInfo(interaction);
        if (id === "dak_reset")           return onReset(interaction);
        if (id === "dak_refresh")         return onRefresh(interaction);
        if (id === "dak_test")            return onTest(interaction, discordClient);
        if (id === "dak_cfg_main")        return onCfgChannel(interaction, "main");
        if (id === "dak_cfg_loud")        return onCfgChannel(interaction, "loud");
        if (id === "dak_cfg_quiet")       return onCfgChannel(interaction, "quiet");
        if (id === "dak_cfg_db")          return onCfgDb(interaction);
        if (id === "dak_db_loud_up")      return onDbAdjust(interaction, "loud",   +5);
        if (id === "dak_db_loud_down")    return onDbAdjust(interaction, "loud",   -5);
        if (id === "dak_db_quiet_up")     return onDbAdjust(interaction, "quiet",  +5);
        if (id === "dak_db_quiet_down")   return onDbAdjust(interaction, "quiet",  -5);
        return;
      }

      if (interaction.isChannelSelectMenu() && interaction.customId === "dak_channel_select")
        return onChannelSelect(interaction);

    } catch (err) {
      console.error("[DAK] interaction error:", err);
      try {
        const errPayload = buildErrorUI(`Internal error: ${err.message?.slice(0, 100)}`);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errPayload);
        } else {
          await interaction.reply(errPayload);
        }
      } catch {}
    }
  });

  // Resume monitors that were active before the last restart.
  fs.readdir(DATA_DIR).then(async files => {
    for (const file of files.filter(f => f.endsWith(".json"))) {
      const guildId = file.replace(".json", "");
      await ensureGuildLoaded(guildId);
      const g = getGuild(guildId);
      if (g.config.mainChannelId) {
        console.log(`[DAK:${guildId}] 🔄 Auto-resuming monitor...`);
        startMonitor(discordClient, guildId);
      }
    }
  }).catch(() => {});

  console.log("[DAK] 🔌 Ultra V2 initialized (self-registered) — Language/Country/Genre detection enabled");
}

// ──────────────────────────────────────────────
//  📦  COMMAND EXPORT — matches this bot's { data, execute } shape
// ──────────────────────────────────────────────
const data = new SlashCommandBuilder()
  .setName("dak")
  .setDescription("🎵 ระบบดักเพลงใหม่จาก Roblox | Country/Genre Detection | MP3 Player");

async function execute(interaction) {
  ensureInit(interaction.client);
  const guildId = interaction.guildId;
  await ensureGuildLoaded(guildId);
  await interaction.reply(buildMainUI(guildId));
}

module.exports = { data, execute };