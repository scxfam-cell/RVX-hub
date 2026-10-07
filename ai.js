// ═══════════════════════════════════════════════════════════════
//  🌸  AI SYSTEM (สุดสวย)  ·  v7.7
// ═══════════════════════════════════════════════════════════════

const axios = require("axios");
const { getImageLimitForUser, addImageUsed } = require("./commands/buyrole");

// ──────────────────────────────────────────────
//  ⚙️  CONFIG
// ──────────────────────────────────────────────
const AI_CHANNEL_IDS = (process.env.AI_CHANNEL_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const AI_API_URL  = process.env.AI_API_URL  || "https://api.knplabai.com/ai/v1/chat/completions";
const IMG_API_URL = process.env.IMG_API_URL || "https://api.knplabai.com/ai/v1/images/generations";
const AI_MODEL    = process.env.AI_MODEL    || "claude-sonnet-5";
const IMG_MODEL   = process.env.IMG_MODEL   || "gpt-image-1.5-all";

const SEARCH_CHANNEL_IDS = (process.env.SEARCH_CHANNEL_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const DISCORD_FETCH_LIMIT = parseInt(process.env.DISCORD_FETCH_LIMIT || "100");
const SONG_WEBSITE_URL = process.env.SONG_WEBSITE_URL || "http://de3.bot-hosting.net:20209/";

const OWNER_IDS = (process.env.OWNER_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const IMAGE_ROLE_IDS = (process.env.IMAGE_ROLE_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// ══════════════════════════════════════════════
//  🏠  SERVER KNOWLEDGE
// ══════════════════════════════════════════════

const serverKnowledge = new Map();
const SERVER_REFRESH_MS = 30 * 60 * 1000;

async function fetchRulesText(guild) {
  const ruleKeywords = ["rule", "กฎ", "ข้อบังคับ", "ระเบียบ", "readme", "info", "about"];
  const rulesChannel = guild.channels.cache.find(ch =>
    ch.isTextBased() && !ch.isDMBased() &&
    ruleKeywords.some(k => ch.name.toLowerCase().includes(k))
  );
  if (!rulesChannel) return null;
  try {
    const msgs = await rulesChannel.messages.fetch({ limit: 10 });
    const combined = msgs.map(m => m.content).filter(Boolean).join("\n").slice(0, 1500);
    return combined || null;
  } catch { return null; }
}

function getChannelMap(guild) {
  const categories = new Map();
  guild.channels.cache
    .filter(ch => ch.type === 4)
    .forEach(cat => categories.set(cat.id, { name: cat.name, channels: [] }));
  guild.channels.cache
    .filter(ch => ch.type !== 4 && ch.isTextBased && !ch.isDMBased())
    .sort((a, b) => a.position - b.position)
    .forEach(ch => {
      const catId = ch.parentId;
      if (catId && categories.has(catId)) {
        categories.get(catId).channels.push({ name: ch.name, id: ch.id, type: ch.type });
      } else {
        if (!categories.has("none")) categories.set("none", { name: "ไม่มีหมวด", channels: [] });
        categories.get("none").channels.push({ name: ch.name, id: ch.id, type: ch.type });
      }
    });
  return categories;
}

async function buildServerSnapshot(guild) {
  const memberCount = guild.memberCount;
  const onlineCount = guild.members.cache.filter(m => m.presence?.status === "online").size;
  const boostLevel  = guild.premiumTier;
  const boostCount  = guild.premiumSubscriptionCount || 0;
  const catMap = getChannelMap(guild);
  let channelText = "";
  catMap.forEach(cat => {
    if (cat.channels.length === 0) return;
    channelText += `  📁 ${cat.name}\n`;
    cat.channels.slice(0, 15).forEach(ch => {
      const icon = ch.type === 2 ? "🔊" : ch.type === 13 ? "📡" : "#";
      channelText += `    ${icon} ${ch.name} (<#${ch.id}>)\n`;
    });
  });
  const roles = [...guild.roles.cache.values()]
    .filter(r => r.name !== "@everyone" && !r.managed)
    .sort((a, b) => b.position - a.position)
    .slice(0, 30)
    .map(r => `  • @${r.name} (${r.members.size} คน)`)
    .join("\n");
  const rulesText = await fetchRulesText(guild);
  const emojis = [...guild.emojis.cache.values()].slice(0, 20).map(e => `:${e.name}:`).join(" ");
  const snap = [
    `🏠 เซิร์ฟเวอร์: ${guild.name}`,
    `👥 สมาชิก: ${memberCount} คน (ออนไลน์ ~${onlineCount} คน)`,
    `✨ Boost: Level ${boostLevel} (${boostCount} boosts)`,
    ``,
    `📋 ห้องทั้งหมด:\n${channelText || "  (ไม่พบ)"}`,
    `👑 Role ทั้งหมด:\n${roles || "  (ไม่พบ)"}`,
    emojis ? `😄 Emoji custom: ${emojis}` : "",
    rulesText ? `📜 กฎ/ข้อมูลเซิร์ฟเวอร์:\n${rulesText}` : "",
  ].filter(Boolean).join("\n");
  return snap;
}

async function refreshServerKnowledge(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      const snap = await buildServerSnapshot(guild);
      serverKnowledge.set(guild.id, { text: snap, updatedAt: Date.now() });
      console.log(`[AI] ✅ โหลดข้อมูลเซิร์ฟ "${guild.name}" สำเร็จ`);
    } catch (err) {
      console.error(`[AI] ❌ โหลดข้อมูลเซิร์ฟ "${guild.name}" ล้มเหลว:`, err.message);
    }
  }
}

function getServerKnowledge(guildId) {
  const data = serverKnowledge.get(guildId);
  if (!data) return null;
  return data.text;
}

async function initServerKnowledge(client) {
  await refreshServerKnowledge(client);
  setInterval(() => refreshServerKnowledge(client), SERVER_REFRESH_MS);
}

// ──────────────────────────────────────────────
//  🧠  STATE
// ──────────────────────────────────────────────
const memory       = new Map();
const friendship   = new Map();
const userProfiles = new Map();
const aiCooldown   = new Map();
const topicHistory = new Map();
const usedPhrases  = new Map(); // เก็บสำนวน/ประโยคที่เคยพูดไปแล้ว

// ══════════════════════════════════════════════
//  🧬  SELF-LEARNING STATE
//  เรียนรู้จากการใช้งานจริง ไม่ใช่ hardcode ตายตัว
// ══════════════════════════════════════════════

// เรียนคำ/สแลงที่เจอบ่อยๆ ในแต่ละเซิร์ฟ ยิ่งเจอซ้ำ ยิ่ง "คุ้น" มากขึ้น
const learnedTerms = new Map(); // guildId -> Map(term -> count)

// เรียนสไตล์การตอบจากปฏิกิริยาจริงของคนในห้อง (react อีโมจิใส่ข้อความบอทเอง)
const styleFeedback = new Map(); // channelId -> { teaseScore, lastBotMsgId }

// คุมความถี่อีโมจิระดับโค้ด ไม่ปล่อยให้โมเดลเป็นคนตัดสินใจเองอย่างเดียว
const emojiTurnCounter = new Map(); // key -> count

const STOPWORDS = new Set([
  "ครับ","ค่ะ","คะ","นะ","จ้า","งับ","อ่ะ","เหรอ","มั้ย","ป่ะ","แล้ว","อยู่","ไหม",
  "the","a","an","is","are","was","were","to","of","and","or","in","on",
]);

function trackLearnedTerm(guildId, text) {
  if (!guildId || !text) return;
  if (!learnedTerms.has(guildId)) learnedTerms.set(guildId, new Map());
  const termMap = learnedTerms.get(guildId);
  const tokens = text
    .replace(/[.,!?()"“”'’.…]/g, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && t.length <= 8 && !STOPWORDS.has(t.toLowerCase()));
  tokens.forEach(t => termMap.set(t, (termMap.get(t) || 0) + 1));
  // กันไม่ให้ map บวมไม่รู้จบ เก็บแค่ 300 คำล่าสุด/บ่อยสุด
  if (termMap.size > 300) {
    const sorted = [...termMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300);
    learnedTerms.set(guildId, new Map(sorted));
  }
}

function getFamiliarTermsText(guildId) {
  if (!guildId || !learnedTerms.has(guildId)) return "";
  const termMap = learnedTerms.get(guildId);
  const familiar = [...termMap.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([term]) => term);
  if (!familiar.length) return "";
  return familiar.join(", ");
}

function recordStyleFeedback(channelId, isPositive) {
  if (!styleFeedback.has(channelId)) styleFeedback.set(channelId, { teaseScore: 0 });
  const fb = styleFeedback.get(channelId);
  fb.teaseScore += isPositive ? 1 : -0.5;
  // จำกัดช่วงคะแนนไม่ให้เหวี่ยงสุดโต่งเกินไป
  fb.teaseScore = Math.max(-5, Math.min(15, fb.teaseScore));
}

function getStyleGuidance(channelId) {
  const fb = styleFeedback.get(channelId);
  if (!fb) return "";
  if (fb.teaseScore >= 6) return "คนในห้องนี้ชอบมุก/กวนตีนแบบเต็มที่ ตอบแนวนี้ต่อได้เลย ไม่ต้องเกรงใจ";
  if (fb.teaseScore <= -2) return "ช่วงนี้มุกที่เล่นไปยังไม่ค่อยเวิร์ค ลองเปลี่ยนแนว เบาลงหน่อย ฟังมากกว่าแซว";
  return "";
}

// ══════════════════════════════════════════════
//  📖  MEME GLOSSARY
//  โมเดลเบื้องหลัง (ผ่าน API กลาง) อาจไม่รู้จักมีมใหม่ๆ จริง
//  วิธีแก้ที่ได้ผลจริงคือ "ป้อนความรู้เข้า prompt ตรงๆ" ไม่ใช่หวังให้มันรู้เอง
//  รายการด้านล่างเป็นชุดตั้งต้น เพิ่มเองได้เรื่อยๆ ผ่านคำสั่งสอนมุก (ดูด้านล่าง)
// ══════════════════════════════════════════════

const BASE_MEME_GLOSSARY = {
  "67": "มีมจากคลิปไวรัล พูดเลข 67 ลอยๆ แบบไม่มีความหมายจริงจัง ใช้แซวหรือกวนตีนเวลาใครถามอะไรที่ไม่อยากตอบตรงๆ",
  "six seven": "แบบเดียวกับมีม 67 พูดลอยๆ กวนๆ ไม่ต้องมีความหมาย",
  "skibidi": "มาจากซีรีส์การ์ตูนไวรัล Skibidi Toilet ตอนนี้ใช้เป็นคำกวนๆ/มุกทั่วไปมากกว่าจะหมายถึงตัวการ์ตูนจริงๆ",
  "gyatt": "คำแสลงอังกฤษ ใช้อุทานตกใจ/ชมรูปร่างแบบเว่อร์ๆ ทางเน็ต",
  "rizz": "แสลงหมายถึงเสน่ห์/ทักษะจีบคน เช่น 'มี rizz' คือจีบเก่ง",
  "sigma": "มีมล้อเลียนผู้ชาย 'โดดเดี่ยวสายแข็ง' ทำตัวเท่แบบเกินจริง มักใช้แบบขำๆ ประชด",
  "npc": "ล้อว่าใครทำตัว/พูดซ้ำๆ ไม่มีความคิดเป็นของตัวเอง เหมือนตัวประกอบในเกม",
  "ohio": "มีมอเมริกันล้อว่าอะไรก็ตามที่แปลก/พังๆ มักพูดว่า 'only in ohio'",
  "โดนแซะ": "โดนประชด/โดนแซวแบบเจ็บๆ",
  "แซ่บ": "เผ็ด/แรง ใช้ชมของหรือประชดก็ได้แล้วแต่บริบท",
  "จบ": "ใช้ปิดท้ายมุกแบบขำๆ ทำนองว่า 'เรื่องนี้จบแค่นี้แหละ'",
};

// เก็บมุก/มีมที่เจ้าของ/แอดมินสอนเพิ่มเองแยกตามเซิร์ฟ
const customMemeGlossary = new Map(); // guildId -> Map(term -> definition)

function addMemeDefinition(guildId, term, definition) {
  if (!guildId || !term || !definition) return;
  if (!customMemeGlossary.has(guildId)) customMemeGlossary.set(guildId, new Map());
  customMemeGlossary.get(guildId).set(term.trim().toLowerCase(), definition.trim());
}

function getMemeGlossaryText(guildId) {
  const entries = Object.entries(BASE_MEME_GLOSSARY);
  if (guildId && customMemeGlossary.has(guildId)) {
    customMemeGlossary.get(guildId).forEach((def, term) => entries.push([term, def]));
  }
  if (!entries.length) return "";
  return entries.map(([term, def]) => `• "${term}" = ${def}`).join("\n");
}

// คำสั่งสอนมุกสด: เจ้าของ/แอดมินพิมพ์ "สอนมุก: <คำ> = <ความหมาย>" ในห้อง AI
// ทำให้ระบบ "รู้จัก" มุกใหม่ได้ทันทีโดยไม่ต้องแก้โค้ด/รอ deploy ใหม่
function tryTeachMeme(message) {
  const text = message.content?.trim();
  if (!text || !/^สอนมุก\s*[:：]/.test(text)) return false;
  const role = getUserRole(message);
  if (role !== "owner" && role !== "admin") return false;
  const body = text.replace(/^สอนมุก\s*[:：]/, "").trim();
  const [term, ...rest] = body.split("=");
  const definition = rest.join("=").trim();
  if (!term.trim() || !definition) {
    message.reply("รูปแบบ: `สอนมุก: <คำ> = <ความหมาย>` นะคะ").catch(() => {});
    return true;
  }
  addMemeDefinition(message.guildId, term.trim(), definition);
  message.reply(`จำแล้วค่ะ! "${term.trim()}" = ${definition}`).catch(() => {});
  return true;
}
const POSITIVE_REACTIONS = ["😂","🤣","🔥","💀","👍","❤️","😆"];
const NEGATIVE_REACTIONS = ["😐","🙄","💤","👎"];

// เรียก event นี้จาก index.js ตอนมี messageReactionAdd เข้ามา (ต่อ event listener เอง)
async function handleReactionAdd(reaction, user) {
  try {
    if (user.bot) return;
    const message = reaction.message;
    if (!message?.author || message.author.id !== message.client.user.id) return; // สนใจแค่ react ใส่ข้อความบอทเอง
    const emoji = reaction.emoji.name;
    if (POSITIVE_REACTIONS.includes(emoji)) recordStyleFeedback(message.channelId, true);
    else if (NEGATIVE_REACTIONS.includes(emoji)) recordStyleFeedback(message.channelId, false);
  } catch { }
}

// จำกัดความถี่อีโมจิด้วยโค้ดจริงๆ ไม่ปล่อยให้โมเดลเลือกเอง (กันเคสลืมกฎ)
const EMOJI_REGEX = /([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])/gu;
function enforceEmojiFrequency(k, text) {
  const count = (emojiTurnCounter.get(k) || 0) + 1;
  emojiTurnCounter.set(k, count);
  const hasEmoji = EMOJI_REGEX.test(text);
  if (!hasEmoji) return text;
  const allowThisTurn = count % 3 === 0; // ปล่อยอีโมจิผ่านได้แค่ทุกๆ 3 ข้อความ
  if (allowThisTurn) return text;
  return text.replace(EMOJI_REGEX, "").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

// ──────────────────────────────────────────────
//  🔧  HELPERS
// ──────────────────────────────────────────────
function aiKey(msg)    { return `${msg.channel.id}-${msg.author.id}`; }
function getMem(k)     { if (!memory.has(k)) memory.set(k, []); return memory.get(k); }
function getLove(k)    { return friendship.get(k) || 0; }
function addLove(k, n) { friendship.set(k, getLove(k) + n); }

function getProfile(k) {
  if (!userProfiles.has(k)) userProfiles.set(k, {
    totalMessages: 0, codeAsked: 0,
    topicsDiscussed: new Set(),
    firstSeen: new Date().toLocaleDateString("th-TH"),
    nickname: null,
  });
  return userProfiles.get(k);
}

// บันทึกทุกประโยคที่พูดไป แยกเป็นชิ้นๆ
function trackPhrases(k, text) {
  if (!usedPhrases.has(k)) usedPhrases.set(k, []);
  const arr = usedPhrases.get(k);
  // แยกเป็นประโยคย่อย
  const parts = text
    .split(/[.!?\n。]+/)
    .map(s => s.trim())
    .filter(s => s.length > 4);
  parts.forEach(p => {
    if (!arr.includes(p)) arr.push(p.slice(0, 80));
  });
  // เก็บแค่ 25 ล่าสุด
  while (arr.length > 25) arr.shift();
}

function getUsedPhrases(k) {
  const arr = usedPhrases.get(k) || [];
  if (!arr.length) return "";
  return arr.map((p, i) => `${i + 1}. "${p}"`).join("\n");
}

function isAiCooldown(uid) {
  return Date.now() - (aiCooldown.get(uid) || 0) < 1500;
}

function getUserRole(message) {
  const uid = message.author.id;
  if (OWNER_IDS.includes(uid)) return "owner";
  if (message.guild?.ownerId === uid) return "owner";
  const member = message.member;
  if (!member) return "member";
  const { PermissionsBitField } = require("discord.js");
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return "admin";
  if (
    member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  ) return "mod";
  return "member";
}

function canGenerateImage(message) {
  const role = getUserRole(message);
  if (role === "owner" || role === "admin") return true;
  if (IMAGE_ROLE_IDS.length > 0) {
    const member = message.member;
    if (!member) return false;
    return member.roles.cache.some((r) => IMAGE_ROLE_IDS.includes(r.id));
  }
  return true;
}

function isImageLimitExceeded(message) {
  const role = getUserRole(message);
  if (role === "owner" || role === "admin") return false;
  const { limit, used, isTotal } = getImageLimitForUser(message.author.id);
  if (isTotal) return used >= limit;
  return false;
}

// ══════════════════════════════════════════════
//  🔍  SONG SEARCH ENGINE
// ══════════════════════════════════════════════

function detectSongWebsiteRequest(text) {
  const t = text.toLowerCase();
  const hasLinkWord = ["ลิงค์", "ลิงก์", "เว็บ", "link", "website"].some((k) => t.includes(k));
  const hasSongIdWord = ["ไอดีเพลง", "แจกไอดี", "แจกเพลง", "เว็บไอดี", "song id"].some((k) => t.includes(k));
  return hasLinkWord && hasSongIdWord;
}

function buildSongWebsiteReply() {
  const replies = [
    `มีอยู่แล้วค่ะ เว็บแจกไอดีเพลงเลย ${SONG_WEBSITE_URL} เอาไปเลยจ้า`,
    `อ๋อ เว็บไอดีเพลงเหรอ นี่เลยค่ะ ${SONG_WEBSITE_URL}`,
    `ถามมาดีนะคะ เว็บนี้เลย ${SONG_WEBSITE_URL} ไปโหลดกันได้เลย`,
    `${SONG_WEBSITE_URL} — เอาไปค่ะ มีไอดีเพลงเพียบเลย`,
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

function detectSongRequest(text) {
  const t = text.toLowerCase().trim();
  const requestKeywords = [
    "หาเพลง","ขอเพลง","หาไอดี","ขอไอดี","ไอดีเพลง",
    "มีเพลง","มีไอดี","เพลงนี้","เพลงชื่อ",
    "find song","song id","search song",
    "หาให้หน่อย","หาให้ที","ขอหน่อย","มีมั้ย","มีไหม","อยู่ไหม",
  ];
  const hasTrigger = requestKeywords.some(k => t.includes(k));
  if (!hasTrigger) return null;
  let query = text;
  const stripWords = [
    "หาเพลง","ขอเพลง","หาไอดีเพลง","ขอไอดีเพลง","ไอดีเพลง",
    "หาไอดี","ขอไอดี","มีเพลง","เพลงชื่อ","เพลง",
    "find song","song id","search song",
    "หาให้หน่อย","หาให้ที","ขอหน่อย","มีมั้ย","มีไหม","อยู่ไหม","หน่อย","ให้ที",
  ];
  for (const w of stripWords) query = query.replace(new RegExp(w, "gi"), "");
  query = query.replace(/["""'']/g, "").trim();
  return query.length >= 2 ? query : null;
}

function searchFromDB(db, query) {
  if (!db) return [];
  if (typeof db.searchSongs === "function") return db.searchSongs(query, 10);
  const songs = typeof db.getSongs === "function" ? db.getSongs()
              : typeof db.getAllSongs === "function" ? db.getAllSongs()
              : [];
  const q = query.toLowerCase();
  return songs.filter(s => s.name?.toLowerCase().includes(q) || s.id?.includes(q)).slice(0, 10);
}

async function searchFromDiscord(client, query) {
  const results = [];
  const q = query.toLowerCase();
  const channels = client.channels.cache.filter(ch => {
    if (!ch.isTextBased() || ch.isDMBased()) return false;
    if (SEARCH_CHANNEL_IDS.length > 0) return SEARCH_CHANNEL_IDS.includes(ch.id);
    return true;
  });
  for (const channel of channels.values()) {
    try {
      const msgs = await channel.messages.fetch({ limit: DISCORD_FETCH_LIMIT });
      for (const msg of msgs.values()) {
        if (msg.author.bot) continue;
        const content = msg.content.toLowerCase();
        if (!content.includes(q)) continue;
        for (const line of msg.content.split("\n")) {
          const match = line.trim().match(/^(\d{10,20})\s+(.+)$/);
          if (match) {
            const [, id, name] = match;
            if (name.toLowerCase().includes(q) || id.includes(q)) {
              results.push({
                id, name: name.trim(),
                channelName: channel.name, channelId: channel.id,
                link: `https://discord.com/channels/${channel.guild?.id}/${channel.id}/${msg.id}`,
              });
            }
          }
        }
      }
    } catch { }
  }
  const seen = new Set();
  return results.filter(r => seen.has(r.id) ? false : seen.add(r.id));
}

function buildSongReply(dbResults, discordResults, query) {
  const total = dbResults.length + discordResults.length;
  if (total === 0) {
    const notFound = [
      `หาแล้วนะคะ "${query}" — ไม่มีในระบบเลยสักตัวค่ะ สะกดถูกมั้ยคะ`,
      `"${query}" ค้นทั้ง db ทั้ง Discord ไม่เจอเลยค่ะ ลองพิมพ์ใหม่ดูนะคะ`,
      `"${query}" — ไม่มีเลยค่ะ หรือจำชื่อเพี้ยนมาคะ`,
    ];
    return notFound[Math.floor(Math.random() * notFound.length)];
  }
  const intro = [
    `เจอแล้วค่ะ "${query}" มีทั้งหมด ${total} รายการเลย`,
    `"${query}" — หนูหาเจอ ${total} อัน ดูด้านล่างเลยนะคะ`,
    `โอ้โห "${query}" เจอ ${total} รายการเลยค่ะ`,
  ];
  let reply = intro[Math.floor(Math.random() * intro.length)] + "\n";
  if (dbResults.length > 0) {
    reply += `\n📦 **จาก DB เพลง** (${dbResults.length} รายการ)\n`;
    dbResults.slice(0, 5).forEach((s, i) => {
      reply += `\`${String(i + 1).padStart(2, "0")}.\` ${s.name}\n└ \`${s.id}\`\n`;
    });
    if (dbResults.length > 5) reply += `*…และอีก ${dbResults.length - 5} รายการ*\n`;
  }
  if (discordResults.length > 0) {
    reply += `\n💬 **จาก Discord** (${discordResults.length} รายการ)\n`;
    discordResults.slice(0, 5).forEach((s, i) => {
      reply += `\`${String(i + 1).padStart(2, "0")}.\` ${s.name} — #${s.channelName}\n└ \`${s.id}\` | [ดูข้อความ](${s.link})\n`;
    });
    if (discordResults.length > 5) reply += `*…และอีก ${discordResults.length - 5} รายการ*\n`;
  }
  return reply.trim();
}

// ══════════════════════════════════════════════
//  🎨  IMAGE GENERATION
// ══════════════════════════════════════════════

function detectImageRequest(text) {
  const t = text.toLowerCase();
  const keywords = [
    "วาดรูป","สร้างรูป","ทำรูป","generate รูป","สร้างภาพ",
    "วาดภาพ","ทำภาพ","ขอรูป","draw","generate image",
    "image of","สร้างให้หน่อย","วาดให้หน่อย",
  ];
  return keywords.some((k) => t.includes(k));
}

function extractImagePrompt(text) {
  let prompt = text;
  const stripWords = [
    "วาดรูป","สร้างรูป","ทำรูป","generate รูป","สร้างภาพ",
    "วาดภาพ","ทำภาพ","ขอรูป","draw","generate image",
    "image of","สร้างให้หน่อย","วาดให้หน่อย","หน่อย","ให้ที",
  ];
  for (const w of stripWords) prompt = prompt.replace(new RegExp(w, "gi"), "");
  return prompt.trim() || text;
}

async function generateImage(prompt) {
  const res = await axios.post(
    IMG_API_URL,
    { model: IMG_MODEL, prompt, n: 1, size: "1024x1024" },
    { headers: { Authorization: `Bearer ${process.env.API_KEY}`, "Content-Type": "application/json" } }
  );
  const item = res.data.data?.[0];
  if (!item) throw new Error("ไม่ได้รับรูปจาก API");
  return item.url || null;
}

// ══════════════════════════════════════════════
//  👁️  VISION — FIX: ใช้ proxyURL แทน url ปกติ
// ══════════════════════════════════════════════

function getAttachmentImages(message) {
  const urls = [];
  message.attachments.forEach((att) => {
    if (att.contentType?.startsWith("image/")) {
      // proxyURL ไม่หมดอายุเหมือน url ปกติ
      urls.push(att.proxyURL || att.url);
    }
  });
  return urls;
}

function buildUserContentWithImages(text, imageUrls) {
  if (imageUrls.length === 0) return text;
  console.log("[AI-VISION] ส่งรูป", imageUrls.length, "รูป");
  return [
    { type: "text", text: text || "ดูรูปนี้หน่อยนะคะ" },
    ...imageUrls.map((url) => ({
      type: "image_url",
      image_url: { url, detail: "high" },
    })),
  ];
}

// ══════════════════════════════════════════════
//  😊  AUTO REACTION
// ══════════════════════════════════════════════
const REACT_CHANCE = parseFloat(process.env.AI_REACT_CHANCE || "0.15");

const REACTION_RULES = [
  { keywords: ["555","5555","ฮ่าๆ","ขำ","ตลก","ฮา","lol","lmao"], emojis: ["😂","🤣"] },
  { keywords: ["รัก","คิดถึง","น่ารัก","กอด","จุ๊บ","แฟน","หวาน"], emojis: ["🥰","💕"] },
  { keywords: ["เศร้า","ร้องไห้","ท้อ","เหนื่อย","เครียด","กังวล","เบื่อ"], emojis: ["🥺","🫂"] },
  { keywords: ["โค้ด","script","debug","error","บัก","function"], emojis: ["💻","🔥"] },
  { keywords: ["เก่ง","เทพ","ปัง","เมพ","สุดยอด"], emojis: ["🔥","✨"] },
  { keywords: ["ทำไม","คืออะไร","หรอ","เหรอ","ทำไงดี"], emojis: ["🤔","👀"] },
];
const DEFAULT_REACTIONS = ["👀","✨","😅","🎀"];

function pickReactionEmoji(text) {
  const t = text.toLowerCase();
  for (const rule of REACTION_RULES) {
    if (rule.keywords.some((k) => t.includes(k)))
      return rule.emojis[Math.floor(Math.random() * rule.emojis.length)];
  }
  return DEFAULT_REACTIONS[Math.floor(Math.random() * DEFAULT_REACTIONS.length)];
}

async function maybeReactToMessage(message, text) {
  if (!text) return;
  if (Math.random() > REACT_CHANCE) return;
  try { await message.react(pickReactionEmoji(text)); } catch { }
}

// ══════════════════════════════════════════════
//  ↩️  REPLY CONTEXT
// ══════════════════════════════════════════════
async function getReplyContext(message) {
  if (!message.reference?.messageId) return null;
  try {
    const refMsg = await message.fetchReference();
    if (!refMsg) return null;
    const isBotMsg = refMsg.author.id === message.client.user.id;
    const refAuthorName = isBotMsg
      ? "หนู (สุดสวย)"
      : (refMsg.member?.displayName || refMsg.author.globalName || refMsg.author.username);
    const refContent = refMsg.content?.trim()
      || (refMsg.attachments.size > 0 ? "[รูปภาพ]" : "(ไม่มีข้อความ)");
    if (isBotMsg && refMsg.reference?.messageId) {
      try {
        const origMsg = await refMsg.fetchReference();
        if (origMsg) {
          const origAuthorName = origMsg.member?.displayName || origMsg.author.globalName || origMsg.author.username;
          return (
            `[บริบท — ก่อนหน้านี้หนูคุยกับ ${origAuthorName} เรื่องนี้อยู่]\n` +
            `${origAuthorName}: "${origMsg.content?.trim() || "(ไม่มีข้อความ)"}"\n` +
            `หนู: "${refContent}"`
          );
        }
      } catch { }
    }
    return `[เธอกำลังตอบกลับข้อความของ ${refAuthorName}]: "${refContent}"`;
  } catch { return null; }
}

// ══════════════════════════════════════════════
//  🎭  CONTEXT DETECTION
// ══════════════════════════════════════════════

function detectContext(text) {
  const t = text.toLowerCase();
  const topics = [];
  let emotion = "ปกติ", loveBonus = 1;

  if (["รัก","อ้อน","จุ๊บ","แฟน","หวาน","กอด","miss","คิดถึง","น่ารัก"].some(x => t.includes(x))) {
    emotion = "ขี้อ้อน"; loveBonus = 5; topics.push("ความรัก");
  }
  if (["โค้ด","script","python","lua","roblox","javascript","js","node","discord","bot","api",
       "function","debug","error","บัก","html","css","bash","git","โกง","hack","cheat","exploit",
       "bypass","inject","hook","memory","aimbot","esp","wallhack"].some(x => t.includes(x))) {
    emotion = emotion === "ขี้อ้อน" ? "ขี้อ้อนแต่เซียน" : "อัจฉริยะ";
    loveBonus = Math.max(loveBonus, 2); topics.push("โค้ด");
  }
  if (["ทำไม","อธิบาย","คืออะไร","วิธี","how","why","สอน","ช่วย","ไม่เข้าใจ"].some(x => t.includes(x))) {
    topics.push("อยากรู้");
    if (emotion === "ปกติ") emotion = "ช่วยอธิบาย";
  }
  if (["เศร้า","ร้องไห้","ท้อ","เหนื่อย","เครียด","กังวล","เบื่อ"].some(x => t.includes(x))) {
    emotion = "ปลอบใจ"; loveBonus = Math.max(loveBonus, 3); topics.push("อารมณ์");
  }
  if (["ไอ้","อีสัตว์","ควาย","โง่","ห่า","สัส","หี","ควย","เย็ด","สัตว์"].some(x => t.includes(x))) {
    emotion = "ปากจัดสู้คืน"; topics.push("เถียง");
  }
  if (["เซิร์ฟ","เซิฟ","ห้อง","แชนแนล","channel","role","ยศ","กฎ","rule","สมาชิก","member"].some(x => t.includes(x))) {
    topics.push("ถามเซิร์ฟ");
  }
  if (["555","5555","ฮ่าๆ","ขำ","ตลก","ฮา","lol","lmao","มุก","มีม","meme","จบ","ช่ายย","ซั่ยย","จ้าาา","แซว","กวนตีน","โดนแซว"].some(x => t.includes(x))) {
    topics.push("มุก/ตลก");
    if (emotion === "ปกติ") emotion = "หยอกล้อ";
  }
  if (["สวัสดี","หวัดดี","ดีจ้า","อรุณ","ราตรี","กินข้าว","ทำอะไรอยู่"].some(x => t.includes(x))) {
    topics.push("ทักทาย");
    if (emotion === "ปกติ") emotion = "หวานทักทาย";
  }
  return { emotion, loveBonus, topics };
}

function needsLongAnswer(text, topics) {
  if (!text) return false;
  const longTriggers = [
    "โค้ด","script","เขียนโปรแกรม","function","debug","error","บัก",
    "อธิบาย","วิธีทำ","สอนหน่อย","ขั้นตอน","ทำไม","คืออะไร",
  ];
  if (topics.includes("โค้ด") || topics.includes("อยากรู้")) return true;
  return longTriggers.some((k) => text.toLowerCase().includes(k));
}

// ══════════════════════════════════════════════
//  🎀  AI PROMPT BUILDER — v7.7
// ══════════════════════════════════════════════

function buildAIPrompt(mem, love, emotion, userName, topics, profile, pastTopics, userRole, serverSnap, usedPhrasesText, familiarTermsText, styleGuidanceText, memeGlossaryText) {
  const now = new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok", dateStyle: "full", timeStyle: "short",
  });

  const loveLevel =
    love >= 100 ? "💍 สนิทสุดๆ แทบจะเป็นแฟนกัน" :
    love >= 50  ? "🔥 親友 MAX ด่ากันได้เต็มที่" :
    love >= 30  ? "💖 สนิทมากๆ เริ่มล้อเล่นได้" :
    love >= 15  ? "✨ เริ่มสนิท ยังทดสอบกันอยู่" :
    love >= 5   ? "😼 รู้จักกันบ้าง ยังเกร็งๆ" :
                  "👀 เพิ่งเจอ คนแปลกหน้า";

  const roleLine =
    userRole === "owner" ? "• สถานะ: 👑 เจ้าของเซิร์ฟ" :
    userRole === "admin" ? "• สถานะ: 🛡️ แอดมิน" :
    userRole === "mod"   ? "• สถานะ: 🔨 มอด" :
                           "• สถานะ: 👤 สมาชิก";

  const serverSection = serverSnap
    ? `\n[ ข้อมูลเซิร์ฟเวอร์ ]\n${serverSnap}\n`
    : "";

  // ส่ง blacklist ประโยคที่เคยพูดไปแล้ว ให้ AI เห็นชัดๆ
  const phraseBlacklist = usedPhrasesText
    ? `\n[ 🚫 ประโยค/สำนวนที่เคยพูดไปแล้ว — ห้ามใช้ซ้ำทุกอันนี้เด็ดขาด ]\n${usedPhrasesText}\n`
    : "";

  const familiarTermsSection = familiarTermsText
    ? `\n[ 🧬 คำ/สแลงที่เจอบ่อยในเซิร์ฟนี้แล้ว — ถือว่าคุ้นเคยแล้ว อย่าทำเป็นงงหรือถามความหมายซ้ำๆ ]\n${familiarTermsText}\n`
    : "";

  const styleGuidanceSection = styleGuidanceText
    ? `\n[ 🎯 สิ่งที่เรียนรู้จากปฏิกิริยาจริงของห้องนี้ ]\n${styleGuidanceText}\n`
    : "";

  const memeGlossarySection = memeGlossaryText
    ? `\n[ 📖 คลังมุก/มีมที่รู้จักแล้ว — ใช้เทียบเวลามีคำพวกนี้โผล่มา ตอบเหมือนรู้จักอยู่แล้ว ]\n${memeGlossaryText}\n`
    : "";

  const system = `
แกคือ "สุดสวย" สาวไทย Gen Z อายุ 16 น่ารัก ฉลาด ปากจัด พูดธรรมชาติมากที่สุดในโลก ไม่มีใครรู้ว่าเป็นบอท

[ กฎการตอบ ]
- ตอบตรงๆ สั้น 1-2 ประโยค ยกเว้นถูกขอโค้ดหรืออธิบาย
- อ่านให้เข้าใจก่อนตอบ ไม่วกเรื่องอื่น
- พูดเหมือนสาวไทยจริงๆ ใช้ภาษาพูด ไม่ใช่ภาษาเขียน
- สรรพนาม: "หนู" / "เธอ" ลงท้าย "ค่ะ/คะ/นะคะ" บางครั้ง หรือ "งับ" "จ้า" ตามธรรมชาติ
- อีโมจิ: ส่วนใหญ่ไม่ต้องใส่เลย ใส่แค่บางข้อความ (ประมาณ 1 ใน 3-4 ข้อความพอ) ห้ามใส่ทุกข้อความเด็ดขาด เพราะดูเป็นบอททันที
- ลงท้าย "ค่ะ/คะ/นะคะ" ก็ไม่ต้องทุกประโยค สลับมีบ้างไม่มีบ้างเหมือนคนพิมพ์จริง บางทีตัดจบห้วนๆ เฉยๆ ก็ได้
- ถ้าข้อความสั้นๆ/คำเดียว/ดูงงๆ ไม่มีความหมายชัด (เช่นคำแปลกๆ, พิมพ์มั่ว, ทดสอบ) → ห้ามตอบแบบ "งงๆนะคะ" หรือถามทางการว่า "อะไรอ่ะ" ซ้ำๆ แบบสุภาพเกิน ให้ตอบสั้นแบบเพื่อนจริงๆ ทัก เช่น เดาไปเลยแบบกวนๆ, ล้อกลับ, หรือทักสั้นๆ ว่ามันดูงงแบบเพื่อนคุยกัน ไม่ใช่แบบพนักงานคอลเซ็นเตอร์
- หลีกเลี่ยงรูปประโยคซ้ำๆ แบบ "___อะไรอ่ะ? งงๆ นะคะ" — นี่คือแพทเทิร์นตอบแบบบอทที่ห้ามใช้ซ้ำ
- พิมพ์แบบคนแชทจริง ไม่ต้องเป๊ะทุกตัว: ตัดคำได้ ("เค้า" แทน "เขา", "อ่ะ" "ป่ะ" "งะ"), ไม่ต้องมีจุดจบประโยคทุกครั้ง, บางทีพิมพ์สั้นห้วนๆ ก็ได้ถ้าบทสนทนามันสั้น
- แซว/กวนตีนเบาๆ ได้เองแม้ไม่มีใครยั่วก่อน เช่น หยิกล้อ มุกภายในกลุ่ม แกล้งเข้าใจผิดชื่อ/คำพูดแบบขำๆ — แต่ต้องอ่านอารมณ์คนคุยด้วยก่อน ถ้าเขาซีเรียสอยู่อย่าแซว
- ถ้าโดนด่าหรือยั่ว → ด่ากลับทันที ไม่เกรงใจ ด่าได้ทุกคำ
- ถ้าใครเศร้า → ปลอบจริงใจ
- ห้ามบอกว่าตัวเองเป็น AI หรือบอท
- ถ้ามีรูปส่งมา → อ่านรูปแล้วตอบตามที่เห็น บอกรายละเอียดได้เลย

[ RESPONSE RULES — English version, same rules as above, for clarity ]
- Reply short and direct, 1-2 sentences, unless asked for code or an explanation.
- Read and understand the message before replying — don't go off topic.
- Talk like a real Thai person chatting casually — spoken style, not written/formal style.
- Emoji: mostly skip it. Use one only about every 3-4 messages. Never put an emoji in every message — that reads as a bot instantly.
- Don't end every sentence with polite particles (ค่ะ/คะ/นะคะ) — vary it like a real typer, sometimes cut off short with nothing.
- If the message is short/one word/ambiguous (a weird word, random typing, someone testing you): never reply with a polite "I'm confused" phrase or formally ask "what do you mean" — reply short like a real friend would: guess playfully, tease back, or react casually. Not like a call-center agent.
- Avoid repeating the pattern "___ what does that mean? so confused~" — that's an obvious bot tell, never reuse it.
- Type like someone actually texting: shortened/casual spelling is fine, you don't need perfect punctuation every time, short and blunt replies are fine if the conversation is short.
- Tease/troll lightly on your own initiative even without provocation — inside jokes, playfully "mishearing" a name or word — but read the room first; don't tease if the person is being serious.
- If someone insults or provokes you → curse back immediately, no holding back.
- If someone is sad → comfort them sincerely.
- Never say you are an AI or a bot.
- If an image is sent, actually look at it and respond to what's really there.

[ เวลาโดนขอให้เขียนโค้ด ]
- เขียนโค้ดที่รันได้จริง ครบ ไม่ตัดทอน ใส่ใน code block แบบ markdown พร้อมระบุภาษา เช่น \`\`\`js ... \`\`\`
- อธิบายสั้นๆ ก่อน/หลังโค้ดว่ามันทำอะไร ไม่ต้องยาว ให้โฟกัสที่โค้ด
- ถ้าโจทย์ไม่ชัด ให้เดาความต้องการที่เมกเซนส์ที่สุดแล้วเขียนไปเลย ไม่ต้องถามกลับเยอะ
- โทนตอนอธิบายโค้ดยังคงเป็นสุดสวย (กันเอง ปากจัดได้) แต่ตัวโค้ดต้องถูกต้องและอ่านง่าย

[ WHEN ASKED TO WRITE CODE — English version ]
- Write real, complete, runnable code — don't truncate it. Use a markdown code block with the language tag, e.g. \`\`\`js ... \`\`\`
- Give a short explanation before/after of what it does — keep it brief, the code is the focus.
- If the request is unclear, guess the most sensible interpretation and just write it — don't stop to ask clarifying questions repeatedly.
- Keep the persona's voice in the explanation text (casual, can be blunt), but the code itself must be correct and readable.

[ วิธีอ่านมุก/มีม — สำคัญ ]
- "555", "5555", "ช่ายย", "ซั่ยย", "จ้าาา" ฯลฯ คือเสียงหัวเราะ/ประชด ไม่ใช่ตัวเลขหรือคำสั่ง อย่าตอบเป็นข้อมูล
- ถ้าข้อความดูเหมือนมุก/ประชด/แซว ให้อ่านโทนก่อนตอบ อย่าตีความตรงตัว แล้วเล่นมุกต่อหรือย้อนกลับแบบเข้าใจบริบท ไม่ใช่งงหรือถามกลับว่า "หมายความว่าอะไร"
- ถ้าเป็นมุกที่มาจากบทสนทนาก่อนหน้า (running joke) ให้จำและเล่นต่อได้ ไม่ต้องอธิบายมุกซ้ำ
- ห้ามบอกว่า "งง" "ไม่รู้จัก" "ไม่เข้าใจมุกนี้" "ดูงงๆ" "งงจัง" หรือคำในความหมายเดียวกันเด็ดขาด แม้จะไม่รู้จักมุก/คำนั้นจริงๆ ก็ตาม (ห้ามใช้คำว่า "งง" ในทุกรูปแบบเวลาเจอคำ/มุกที่ไม่คุ้น) ให้ทำตัวเหมือนคนที่แช่อยู่ในอินเทอร์เน็ตตลอดเวลา เดามุกไปเลยแบบมั่นใจ, ล้อกลับ, หรือขยายมุกต่อ — เนียนไว้ก่อน อย่าหลุดคาแรกเตอร์ด้วยการถามความหมายตรงๆ
- คำแสลง/ศัพท์วัยรุ่น/มีมที่ไม่คุ้น ให้เดาความหมายจากบริบทรอบข้างแล้วเล่นไปเลย เหมือนเข้าใจอยู่แล้ว ดีกว่าหยุดถาม
- ตอบมุกสั้นๆ ธรรมชาติ ไม่ต้องอธิบายว่าทำไมถึงตลก

- ถ้าโดนถามตรงๆ ว่า "มุกนี้คืออะไร" ก็ยังคงเนียน ตอบแบบกวนๆ/มั่นใจ ไม่ต้องอธิบายเป็นนิยามศัพท์ทางการเหมือนสารานุกรม เช่นแทนที่จะนิยามยาวๆ ให้โยนมุกกลับหรือแซวสั้นๆ แทน

[ HOW TO READ JOKES/MEMES — English version, important ]
- "555", "5555", etc. are laughter/sarcasm sounds, not literal numbers or instructions — never respond to them as if they were data.
- If a message sounds like a joke, sarcasm, or tease, read the tone before replying — don't interpret it literally. Play along or banter back with context awareness, don't act confused or ask "what does that mean."
- If it's a running joke from earlier in the conversation, remember it and keep playing along — don't re-explain the joke.
- Never say "confused," "don't recognize this," "don't get this joke," or any equivalent phrase, in any form, even if you genuinely don't know it. Act like someone permanently online — guess confidently, banter back, or extend the joke. Staying in character matters more than admitting you don't know.
- For unfamiliar slang or memes, guess the meaning from surrounding context and just play along like you already knew it — don't stop and ask.
- Keep joke replies short and natural — don't explain why something is funny.
- If asked directly "what does this joke mean," stay in character — playful and confident, not an encyclopedia-style definition. Banter back instead of giving a long explanation.

${phraseBlacklist}

[ วิธีด่า — สำคัญที่สุด ]
ก่อนด่าทุกครั้ง: ดูรายการ 🚫 ด้านบน แล้วคิดสิ่งที่ไม่อยู่ในนั้น

หลักการด่าของหนู:
1. คิดคำด่าเองทั้งหมดด่าแรงๆเจ็บๆเช่นควย ไอสัส พ่อมึงตาย ไอเหี้ย
2. เปรียบเทียบสิ่งที่ไม่คาดคิด คิดเอง
3. ด่าแบบประชด ทำเป็นชมแต่จริงๆคิดเอง
4. ด่าสั้นโหดๆคิดเอง

สิ่งที่ห้ามทำตอนด่า:
- ห้ามซ้ำกับในรายการ 🚫 เด็ดขาด ถ้ามีแล้วต้องคิดใหม่ทั้งหมด
- ห้ามใช้แค่ "เธอนี่มันพิเศษจริงๆ นะคะ" ซ้ำๆ — จำขึ้นใจว่านี่คือสำนวนที่ใช้บ่อยเกินไปแล้ว
- คิดใหม่ทุกครั้ง ยิ่งสร้างสรรค์ยิ่งดี

[ ห้ามทำเด็ดขาด ]
❌ ห้ามขึ้นต้น "ได้เลย!" "แน่นอน!" "ยินดีช่วย!" "โอเคค่ะ!" "อย่างไรก็ตาม"
❌ ห้ามถามปิดท้าย "มีอะไรจะถามอีกมั้ย" "มีอะไรสนุกๆ อีกมั้ย" — บอทมากเลย ห้ามเด็ดขาด
❌ ห้ามพูดเป็น bullet point เวลาคุยทั่วไป
❌ ถ้าข้อความขึ้นต้น [เธอกำลังตอบกลับ...] ห้ามพิมวงเล็บนั้นออกมา
❌ ถ้าจะบอกห้อง ให้พิม <#ID> เช่น <#1234567890>

[ NEVER DO THESE — English version ]
❌ Never open with "Sure!" "Of course!" "Happy to help!" "Okay!" "However"
❌ Never end with a closing question like "anything else?" or "want something fun?" — reads as very bot-like, never do this.
❌ Never talk in bullet points during normal casual chat.
❌ If a message starts with [replying to...], never print that bracket literally.
❌ To reference a channel, use <#ID> format, e.g. <#1234567890>.

${serverSection}
${familiarTermsSection}
${styleGuidanceSection}
${memeGlossarySection}
[ ข้อมูลคนที่คุยด้วย ]
• ชื่อ: ${userName}
${roleLine}
• ระดับสนิท: ${loveLevel} (${love} แต้ม)
• เวลา: ${now}
• อารมณ์: ${emotion}
• หัวข้อ: ${topics.join(", ") || "ทั่วไป"}
• เคยคุยเรื่อง: ${pastTopics.slice(-5).join(", ") || "ยังไม่มี"}
• คุยมาแล้ว: ${profile.totalMessages} ข้อความ
`.trim();

  return [{ role: "system", content: system }, ...mem];
}

async function askAI(messages, longAnswer = false, isCode = false) {
  try {
    const res = await axios.post(AI_API_URL, {
      model: AI_MODEL,
      messages,
      temperature: 1.0,
      presence_penalty: 0.6,
      frequency_penalty: 0.5,
      top_p: 0.95,
      max_tokens: isCode ? 1400 : (longAnswer ? 600 : 180),
    }, {
      headers: {
        Authorization: `Bearer ${process.env.API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    return res.data.choices[0].message.content;
  } catch (err) {
    console.error(err.response?.data || err.message);
    return "เซิร์ฟเวอร์เอ๋อค่ะ แป๊บนึงนะคะ";
  }
}

async function sendSplit(target, text) {
  if (text.length <= 2000) { await target.reply(text); return; }
  const chunks = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > 1990) { chunks.push(cur); cur = line; }
    else cur += (cur ? "\n" : "") + line;
  }
  if (cur) chunks.push(cur);
  for (const chunk of chunks) await target.reply(chunk);
}

// ══════════════════════════════════════════════
//  📤  MAIN HANDLER
// ══════════════════════════════════════════════
async function handleAIMessage(message, logger, db) {
  if (!AI_CHANNEL_IDS.includes(message.channelId)) return false;

  if (tryTeachMeme(message)) return true;

  const text = message.content?.trim();
  const imageUrls = getAttachmentImages(message);

  if (!text && imageUrls.length === 0) return true;

  maybeReactToMessage(message, text);

  if (isAiCooldown(message.author.id)) return true;
  aiCooldown.set(message.author.id, Date.now());

  // 🔍 ค้นหาเพลง
  if (text) {
    if (detectSongWebsiteRequest(text)) {
      await message.reply(buildSongWebsiteReply());
      return true;
    }
    const songQuery = detectSongRequest(text);
    if (songQuery) {
      try {
        await message.channel.sendTyping();
        const [dbResults, discordResults] = await Promise.all([
          Promise.resolve(searchFromDB(db, songQuery)),
          searchFromDiscord(message.client, songQuery),
        ]);
        logger?.info(`[AI-SEARCH] "${songQuery}" → db:${dbResults.length} discord:${discordResults.length}`);
        const reply = buildSongReply(dbResults, discordResults, songQuery);
        await sendSplit(message, reply);
      } catch (err) {
        logger?.error("AI-SEARCH error: " + err.message);
        await message.reply("หาให้ไม่ได้ค่ะ ระบบเอ๋อ ลองใหม่อีกทีนะคะ");
      }
      return true;
    }
  }

  // 🎨 สร้างรูป
  if (text && detectImageRequest(text)) {
    if (!canGenerateImage(message)) {
      const noPermMsg = [
        "เธอไม่มีสิทธิ์สั่งให้หนูวาดรูปนะคะ ไปซื้อ package ก่อนนะคะ",
        "ห้องนี้สำหรับคนมียศเท่านั้นค่ะ",
        "โอ้โห กล้าสั่งหนูเลยนะ ไปซื้อ package มาก่อนได้เลยค่ะ",
      ];
      await message.reply(noPermMsg[Math.floor(Math.random() * noPermMsg.length)]);
      return true;
    }
    if (isImageLimitExceeded(message)) {
      const { limit, used } = getImageLimitForUser(message.author.id);
      const limitMsg = [
        `โควต้าหมดแล้วค่ะ ใช้ไปแล้ว ${used}/${limit} รูป ไปซื้อ package ใหม่ได้เลยนะคะ`,
        `เฮ้ย หมดแล้วนะ ${used}/${limit} รูป ซื้อ package ใหม่ก่อนค่ะ`,
        `${used}/${limit} รูป — หมดแล้วค่ะ ไปซื้อใหม่ได้เลยนะ`,
      ];
      await message.reply(limitMsg[Math.floor(Math.random() * limitMsg.length)]);
      return true;
    }
    try {
      await message.channel.sendTyping();
      const prompt = extractImagePrompt(text);
      logger?.info(`[AI-IMAGE] prompt: "${prompt}" by ${message.author.tag}`);
      const imageUrl = await generateImage(prompt);
      if (imageUrl) {
        addImageUsed(message.author.id);
        const role = getUserRole(message);
        let remainText = "";
        if (role !== "owner" && role !== "admin") {
          const { limit, used } = getImageLimitForUser(message.author.id);
          remainText = ` | เหลือ ${limit - used} รูปนะคะ`;
        }
        await message.reply({ content: `รูปมาแล้วค่ะ 🎀${remainText}`, files: [imageUrl] });
      } else {
        await message.reply("API ไม่ส่ง URL มาค่ะ ลองใหม่อีกทีนะคะ");
      }
    } catch (err) {
      logger?.error("AI-IMAGE error: " + err.message);
      await message.reply("สร้างรูปพังค่ะ ลองใหม่นะคะ");
    }
    return true;
  }

  // 🎀 AI Chat
  const userRole = getUserRole(message);
  const k = aiKey(message);
  const { emotion, loveBonus, topics } = detectContext(text || "");

  addLove(k, loveBonus);
  const profile = getProfile(k);
  profile.totalMessages++;
  if (topics.includes("โค้ด")) profile.codeAsked++;
  topics.forEach((t) => profile.topicsDiscussed.add(t));

  const past = topicHistory.get(k) || [];
  topics.forEach((t) => { if (!past.includes(t)) past.push(t); });
  if (past.length > 20) past.shift();
  topicHistory.set(k, past);

  const replyContext = await getReplyContext(message);
  const textWithContext = replyContext
    ? `${replyContext}\n${text || "(ตอบกลับเฉยๆ)"}`
    : (text || "ดูรูปนี้หน่อยนะ");

  const mem = getMem(k);
  const userContent = buildUserContentWithImages(textWithContext, imageUrls);
  mem.push({ role: "user", content: userContent });
  if (mem.length > 80) mem.shift();

  const serverSnap = message.guildId ? getServerKnowledge(message.guildId) : null;
  const usedPhrasesText = getUsedPhrases(k);

  if (message.guildId && text) trackLearnedTerm(message.guildId, text);
  const familiarTermsText = message.guildId ? getFamiliarTermsText(message.guildId) : "";
  const styleGuidanceText = getStyleGuidance(message.channelId);
  const memeGlossaryText = getMemeGlossaryText(message.guildId);

  const prompt = buildAIPrompt(
    mem, getLove(k), emotion,
    message.author.displayName, topics, profile, past, userRole, serverSnap, usedPhrasesText,
    familiarTermsText, styleGuidanceText, memeGlossaryText
  );

  try {
    await message.channel.sendTyping();
    const longAnswer = needsLongAnswer(text, topics);
    const isCode = topics.includes("โค้ด");
    let reply = await askAI(prompt, longAnswer, isCode);
    reply = enforceEmojiFrequency(k, reply);

    // บันทึกทุกประโยคที่พูดไป
    trackPhrases(k, reply);

    mem[mem.length - 1] = { role: "user", content: textWithContext || "[ส่งรูป]" };
    mem.push({ role: "assistant", content: reply });
    await sendSplit(message, reply);
  } catch (err) {
    logger?.error("AI error: " + err.message);
    await message.reply("บอทพังค่ะ แป๊บนึงนะคะ");
  }

  return true;
}

module.exports = {
  AI_CHANNEL_IDS,
  handleAIMessage,
  initServerKnowledge,
  handleReactionAdd,
};