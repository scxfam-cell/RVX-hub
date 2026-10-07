// ═══════════════════════════════════════════════════════════════
//  ⚖️  STRIKES  —  นับความผิดสะสม แล้วลงโทษอัตโนมัติเมื่อครบเกณฑ์
//  ครบ timeoutAt → timeout, ครบ kickAt → เตะ, ครบ banAt → แบน
// ═══════════════════════════════════════════════════════════════

const store = require("./store");

async function addStrike(guild, member, reason) {
  const cfg = store.getGuildConfig(guild.id);

  if (!member) return { count: 0, actionTaken: null };

  const uid = member.id;
  cfg.strikes[uid] = (cfg.strikes[uid] || 0) + 1;
  const count = cfg.strikes[uid];
  const sc = cfg.strikeConfig;

  let actionTaken = null;
  try {
    if (sc.banAt && count >= sc.banAt) {
      await member.ban({ reason: `Automod: ครบ ${count} ครั้ง — ${reason}` });
      actionTaken = "🔨 แบนถาวร";
      delete cfg.strikes[uid];
    } else if (sc.kickAt && count >= sc.kickAt) {
      await member.kick(`Automod: ครบ ${count} ครั้ง — ${reason}`);
      actionTaken = "👢 เตะออกจากเซิร์ฟเวอร์";
    } else if (sc.timeoutAt && count >= sc.timeoutAt) {
      await member.timeout(sc.timeoutMinutes * 60 * 1000, `Automod: ครบ ${count} ครั้ง — ${reason}`);
      actionTaken = `⏳ Timeout ${sc.timeoutMinutes} นาที`;
    }
  } catch (err) {
    actionTaken = `⚠️ ลงโทษไม่สำเร็จ (สิทธิ์ไม่พอ/ยศสูงกว่าบอท): ${err.message}`;
  }

  store.save();
  return { count, actionTaken };
}

function resetStrikes(guildId, userId) {
  const cfg = store.getGuildConfig(guildId);
  delete cfg.strikes[userId];
  store.save();
}

module.exports = { addStrike, resetStrikes };
