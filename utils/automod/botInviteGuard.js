// ═══════════════════════════════════════════════════════════════
//  🤖  ANTI-BOT-INVITE  —  เตะบอทที่ไม่ได้รับอนุญาตออกทันที
//  ยกเว้น: เจ้าของเซิร์ฟเวอร์ / แอดมิน-บอทที่ตั้งยกเว้นไว้ด้วย /automod antibotinvite exempt
//  ⚠️ ต้องให้บอทมีสิทธิ์ "View Audit Log" และ "Kick Members" ถึงจะทำงานได้ครบ
// ═══════════════════════════════════════════════════════════════

const { AuditLogEvent } = require("discord.js");
const store = require("./store");
const { sendAutomodLog } = require("./log");

async function handleBotInviteGuard(member) {
  if (!member.user.bot) return;       // สนใจเฉพาะ "บอท" ที่เข้ามาใหม่
  if (member.id === member.client.user.id) return; // ไม่เช็คตัวเอง

  const guild = member.guild;
  const cfg = store.getGuildConfig(guild.id);
  const sys = cfg.systems.antibotinvite;
  if (!sys.enabled) return;

  // หาว่าใครเป็นคนกดอนุมัติแอดบอทตัวนี้เข้ามา (จาก Audit Log)
  let inviter = null;
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs.entries.find((e) => e.target?.id === member.id);
    inviter = entry?.executor || null;
  } catch (err) {
    // ไม่มีสิทธิ์ดู audit log หรือ error อื่น — inviter จะเป็น null
  }

  const isOwner    = inviter?.id === guild.ownerId;
  const inviterOk  = inviter && sys.exemptUsers.includes(inviter.id);
  const botOk      = sys.exemptUsers.includes(member.id);

  if (isOwner || inviterOk || botOk) return; // ได้รับอนุญาต ไม่ต้องทำอะไร

  const inviterText = inviter ? `${inviter.tag} (\`${inviter.id}\`)` : "ไม่ทราบ (หา audit log ไม่เจอ)";

  try {
    await member.kick("Automod: บอทไม่ได้รับอนุญาต ถูกเชิญโดยไม่ใช่เจ้าของเซิร์ฟ/ผู้ที่ได้รับอนุญาต");
    await sendAutomodLog(member.client, guild, "antibotinvite",
      "🤖 [ANTI-BOT-INVITE] เตะบอทที่ไม่ได้รับอนุญาตออกแล้ว",
      `บอท: ${member.user.tag} (\`${member.id}\`)\nผู้เชิญ: ${inviterText}`);
  } catch (err) {
    await sendAutomodLog(member.client, guild, "antibotinvite",
      "🤖 [ANTI-BOT-INVITE] ⚠️ เตะบอทไม่สำเร็จ",
      `บอท: ${member.user.tag} (\`${member.id}\`)\nผู้เชิญ: ${inviterText}\nเหตุผลที่เตะไม่สำเร็จ: ${err.message}`);
  }
}

module.exports = { handleBotInviteGuard };
