// ═══════════════════════════════════════════════════════════════
//  📋  AUTOMOD LOG  —  ส่งแจ้งเตือนเข้าห้อง log กลาง (แยกสีตามระบบ)
// ═══════════════════════════════════════════════════════════════

const { EmbedBuilder } = require("discord.js");
const store = require("./store");

const COLORS = {
  antispam:      0xfee75c,
  antilink:      0xed4245,
  antiemoji:     0xeb459e,
  antiimage:     0x5865f2,
  antibotinvite: 0x992d22,
};

async function sendAutomodLog(client, guild, type, title, description, fields = []) {
  const cfg = store.getGuildConfig(guild.id);
  if (!cfg.logChannelId) return;

  const channel = guild.channels.cache.get(cfg.logChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS[type] || 0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (fields.length) embed.addFields(fields);

  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { sendAutomodLog };
