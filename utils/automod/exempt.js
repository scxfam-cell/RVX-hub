// ═══════════════════════════════════════════════════════════════
//  ✅  EXEMPT CHECK  —  ใช้ร่วมกันทุกระบบ automod
// ═══════════════════════════════════════════════════════════════

function isExempt(sysConfig, { channelId, userId }) {
  if (sysConfig.exemptChannels?.includes(channelId)) return true;
  if (sysConfig.exemptUsers?.includes(userId)) return true;
  return false;
}

module.exports = { isExempt };
