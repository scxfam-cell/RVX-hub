// ═══════════════════════════════════════════════════════════════
//  🎧  VOICE REWARD MANAGER
//  ระบบให้เหรียญตามเวลาที่อยู่ในห้องเสียง (ทุกห้อง ยกเว้นห้อง AFK)
//  ค่าต่างๆ (ห้องแจ้งเตือน / นาที / เหรียญ / เปิด-ปิด) ตั้งผ่านคำสั่ง
//  /voicereward ในดิสคอร์ดได้แบบ real-time ไม่ต้อง restart บอท
// ═══════════════════════════════════════════════════════════════
const { EmbedBuilder } = require("discord.js");
const checkinDB       = require("./checkinDB");
const logger          = require("./logger");
const cfg             = require("../config");
const voiceRewardConfig = require("./voiceRewardConfig");

// userId -> { intervalId, member, voiceChannel, client }
const activeSessions = new Map();

// ── ตารางสุ่มเหรียญจากการออนห้องเสียง (1-500) ─────────────────
// weight ยิ่งเยอะยิ่งมีโอกาสออกบ่อย รวม weight ทั้งหมด = 100
// ช่วงเลขน้อย = โอกาสสูง (ออกบ่อย) / ช่วงเลขสูงใกล้ 500 = โอกาสน้อยมาก (ของหายาก)
const VOICE_REWARD_TABLE = [
  { min: 1,   max: 3,   weight: 65 }, // ธรรมดา (บ่อยสุด)
  { min: 4,   max: 8,   weight: 22 }, // ดี
  { min: 9,   max: 20,  weight: 9 },  // เยี่ยม
  { min: 21,  max: 60,  weight: 3 },  // หายาก
  { min: 61,  max: 500, weight: 1 },  // หายากมาก 🎉
];

function pickVoiceReward() {
  const totalWeight = VOICE_REWARD_TABLE.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const tier of VOICE_REWARD_TABLE) {
    if (roll < tier.weight) {
      return tier.min === tier.max ? tier.min : tier.min + Math.floor(Math.random() * (tier.max - tier.min + 1));
    }
    roll -= tier.weight;
  }
  return VOICE_REWARD_TABLE[0].min;
}

// ── เริ่มนับเวลาให้ user ที่เพิ่งเข้าห้องเสียง ─────────────────
function startSession(member, voiceChannel, client) {
  if (activeSessions.has(member.id)) return; // มี session อยู่แล้ว ไม่เริ่มซ้ำ

  const settings = voiceRewardConfig.getConfig();
  if (!settings.enabled) return; // ปิดระบบอยู่ → ไม่เริ่มนับ

  const intervalId = setInterval(async () => {
    try {
      const liveSettings = voiceRewardConfig.getConfig();
      if (!liveSettings.enabled) return; // ปิดระบบระหว่างทาง → ข้ามรอบนี้ (session จะถูกล้างตอน restartAllSessions)

      const reward = pickVoiceReward();
      const result = checkinDB.addCoins(member.id, reward);
      logger.info(
        `[VOICE-REWARD] ${member.user.tag} +${reward} เหรียญ (รวม ${result.coins}) จากห้อง ${voiceChannel.name}`
      );
      await sendRewardAnnouncement(client, member, voiceChannel, result.coins, reward);
    } catch (err) {
      logger.error(`[VOICE-REWARD] ให้เหรียญล้มเหลว (${member.user.tag}): ${err.message}`);
    }
  }, settings.minutes * 60 * 1000);

  activeSessions.set(member.id, { intervalId, member, voiceChannel, client });
  logger.info(`[VOICE-REWARD] เริ่มนับเวลาให้ ${member.user.tag} ในห้อง "${voiceChannel.name}"`);
}

// ── หยุดนับเวลา (ออกจากห้อง / ย้ายห้อง / ออกจากดิสคอร์ด) ──────
function stopSession(userId) {
  const session = activeSessions.get(userId);
  if (!session) return;
  clearInterval(session.intervalId);
  activeSessions.delete(userId);
}

// ── ส่ง embed แจ้งเตือนเข้าห้องที่กำหนดตอนได้เหรียญ ────────────
async function sendRewardAnnouncement(client, member, voiceChannel, totalCoins, reward) {
  const settings = voiceRewardConfig.getConfig();
  if (!settings.channelId) return; // ไม่ได้ตั้งห้องแจ้งเตือนไว้ → ข้าม

  try {
    const channel = await client.channels.fetch(settings.channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(cfg.COLOR_SUCCESS)
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setDescription(
        `🎧 **${member.user.tag}** ได้รับ **${reward} เหรียญ** จากการออนห้อง **${voiceChannel.name}**\n` +
        `💰 เหรียญรวมตอนนี้: **${totalCoins}**`
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error(`[VOICE-REWARD] ส่งแจ้งเตือนล้มเหลว: ${err.message}`);
  }
}

// ── Handler หลัก เรียกจาก client.on("voiceStateUpdate", ...) ──
function handleVoiceStateUpdate(oldState, newState, client) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guild        = newState.guild;
  const afkChannelId = guild.afkChannelId;

  const wasInChannel = oldState.channelId;
  const nowInChannel  = newState.channelId;

  // แค่ mute/deaf/สลับกล้อง ไม่ได้เปลี่ยนห้อง → ไม่ต้องทำอะไร
  if (wasInChannel === nowInChannel) return;

  // ออกจากห้องเดิม หรือย้ายห้อง → หยุด session เดิมก่อนเสมอ
  stopSession(member.id);

  // เข้าห้องใหม่ (ไม่ใช่ห้อง AFK) → เริ่ม session ใหม่
  if (nowInChannel && nowInChannel !== afkChannelId) {
    const voiceChannel = newState.channel;
    if (voiceChannel) startSession(member, voiceChannel, client);
  }
}

// ── ตอนบอทเพิ่ง restart: เช็คคนที่ค้างอยู่ในห้องเสียงอยู่แล้ว
//    ให้เริ่มนับเวลาใหม่ทันที ──
function initExistingVoiceMembers(client) {
  const settings = voiceRewardConfig.getConfig();
  if (!settings.enabled) return;

  for (const guild of client.guilds.cache.values()) {
    const afkChannelId = guild.afkChannelId;
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased() || channel.id === afkChannelId) continue;
      for (const member of channel.members.values()) {
        if (member.user.bot) continue;
        startSession(member, channel, client);
      }
    }
  }
  if (activeSessions.size > 0) {
    logger.success(`[VOICE-REWARD] กู้คืน session: ${activeSessions.size} คนที่ค้างอยู่ในห้องเสียง`);
  }
}

// ── เรียกใช้หลังแอดมินเปลี่ยนค่าตั้งค่า เพื่อให้ session ที่รันอยู่
//    ใช้ค่าใหม่ทันที (นาที/เหรียญ/เปิด-ปิด) โดยไม่ต้องรอคนออก-เข้าห้องใหม่ ──
function restartAllSessions(client) {
  const entries = [...activeSessions.values()];
  for (const session of entries) {
    clearInterval(session.intervalId);
    activeSessions.delete(session.member.id);
  }

  const settings = voiceRewardConfig.getConfig();
  if (!settings.enabled) return; // ปิดระบบ → ไม่เริ่ม session ใหม่

  for (const session of entries) {
    startSession(session.member, session.voiceChannel, session.client || client);
  }
}

module.exports = {
  handleVoiceStateUpdate,
  initExistingVoiceMembers,
  restartAllSessions,
};
