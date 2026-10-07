// ═══════════════════════════════════════════════════════════════
//  🔗  LINK DETECTOR  —  ตรวจลิงก์ตามระดับ 0-3
//  0 = ปิด · 1 = กันคำเชิญ discord อื่น · 2 = +ลิงก์ไวรัส/หลอกลวง · 3 = กันทุกลิงก์
// ═══════════════════════════════════════════════════════════════

const INVITE_REGEX = /(discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[a-z0-9-]+/i;
const URL_REGEX    = /https?:\/\/[^\s]+/i;

// heuristic: คำ/โดเมนที่พบบ่อยในลิงก์หลอกเอา token, ปลอมของฟรี Nitro/ไอเทม ฯลฯ
// (ตรวจจับแบบ pattern เท่านั้น ไม่ได้ยืนยันผลจริงแบบ real-time scan)
const SUSPICIOUS_KEYWORDS = [
  "dizcord", "discrod", "discordapp-nitro", "discord-nitro", "discornitro",
  "steamcommunlty", "steamcommumity", "stearncommunity", "steam-comunity",
  "free-nitro", "nitro-gift", "gift-nitro", "discordgift", "discrodapp",
];

function checkLink(content, level) {
  if (!level || level <= 0) return null;

  if (INVITE_REGEX.test(content)) return "invite";

  if (level >= 2) {
    const lower = content.toLowerCase();
    if (SUSPICIOUS_KEYWORDS.some((kw) => lower.includes(kw))) return "malicious";
  }

  if (level >= 3 && URL_REGEX.test(content)) return "link";

  return null;
}

module.exports = { checkLink };
