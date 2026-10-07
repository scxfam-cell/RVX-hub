// ═══════════════════════════════════════════════════════════════
//  🛡️  AUTOMOD ORCHESTRATOR  —  เรียกจาก messageCreate หลักของบอท
//  เช็คทีละระบบ: antilink → antispam → antiemoji → antiimage
//  เจอผิดระบบแรกจะลบ+ลงโทษ+log แล้วหยุดเช็คระบบถัดไปทันที
// ═══════════════════════════════════════════════════════════════

const store  = require("./store");
const { isExempt }  = require("./exempt");
const { addStrike } = require("./strikes");
const { sendAutomodLog } = require("./log");
const { checkLink } = require("./linkDetector");
const { checkSpam } = require("./spamDetector");
const { countEmojis } = require("./emojiDetector");
const { isImageMessage, checkImageSpam } = require("./imageDetector");

const LINK_LABELS = { invite: "ลิงก์คำเชิญ Discord อื่น", malicious: "ลิงก์ต้องสงสัย/ไวรัส-ฟิชชิ่ง", link: "ลิงก์" };

async function punish(message, type, reason, title) {
  await message.delete().catch(() => {});
  const { count, actionTaken } = await addStrike(message.guild, message.member, reason);

  await sendAutomodLog(
    message.client, message.guild, type, title,
    `👤 ผู้ใช้: ${message.author} (\`${message.author.id}\`)\n📍 ห้อง: ${message.channel}\n📝 เหตุผล: ${reason}`,
    [
      { name: "🔢 ครั้งที่", value: `${count}`, inline: true },
      { name: "⚖️ การลงโทษ", value: actionTaken || "ยังไม่ถึงเกณฑ์ลงโทษ", inline: true },
    ]
  );
}

// คืนค่า true ถ้าข้อความถูกจัดการ (ลบ) แล้ว → ห้ามประมวลผลต่อในระบบอื่น
async function handleAutomod(message) {
  if (!message.guild) return false;
  if (message.author.id === message.client.user.id) return false; // ไม่เช็คตัวเอง
  if (message.author.id === message.guild.ownerId) return false;  // ไม่เช็คเจ้าของเซิร์ฟ

  const cfg = store.getGuildConfig(message.guild.id);
  const { channel, author, content } = message;
  const ctx = { channelId: channel.id, userId: author.id };

  // ── 🔗 Anti-Link ──
  const linkSys = cfg.systems.antilink;
  if (linkSys.enabled && !isExempt(linkSys, ctx)) {
    const level = linkSys.channelLevels[channel.id] ?? linkSys.defaultLevel;
    const matched = checkLink(content, level);
    if (matched) {
      await punish(message, "antilink",
        `ส่ง${LINK_LABELS[matched]}ในห้องที่กันระดับ ${level}`,
        "🔗 [ANTI-LINK] ตรวจพบลิงก์ต้องห้าม");
      return true;
    }
  }

  // ── 💬 Anti-Spam (ข้อความถี่เกิน) ──
  const spamSys = cfg.systems.antispam;
  if (spamSys.enabled && !isExempt(spamSys, ctx)) {
    if (checkSpam(message.guild.id, author.id, spamSys.messageLimit, spamSys.intervalSeconds)) {
      await punish(message, "antispam",
        `ส่งข้อความถี่เกินกำหนด (>${spamSys.messageLimit} ข้อความ/${spamSys.intervalSeconds}วิ)`,
        "💬 [ANTI-SPAM] ตรวจพบการสแปมข้อความ");
      return true;
    }
  }

  // ── 😂 Anti-Emoji Spam ──
  const emojiSys = cfg.systems.antiemoji;
  if (emojiSys.enabled && !isExempt(emojiSys, ctx)) {
    const n = countEmojis(content);
    if (n > emojiSys.limit) {
      await punish(message, "antiemoji",
        `ส่งอีโมจิ ${n} ตัวในข้อความเดียว (เกิน ${emojiSys.limit})`,
        "😂 [ANTI-EMOJI] ตรวจพบการสแปมอีโมจิ");
      return true;
    }
  }

  // ── 🖼️ Anti-Image Spam ──
  const imageSys = cfg.systems.antiimage;
  if (imageSys.enabled && !isExempt(imageSys, ctx) && isImageMessage(message)) {
    if (checkImageSpam(message.guild.id, author.id, imageSys.imageLimit, imageSys.intervalSeconds)) {
      await punish(message, "antiimage",
        `ส่งรูปถี่เกินกำหนด (>${imageSys.imageLimit} รูป/${imageSys.intervalSeconds}วิ)`,
        "🖼️ [ANTI-IMAGE] ตรวจพบการสแปมรูปภาพ");
      return true;
    }
  }

  return false;
}

module.exports = { handleAutomod };
