// ═══════════════════════════════════════════════════════════════
//  😂  EMOJI DETECTOR  —  นับจำนวนอีโมจิในข้อความเดียว
// ═══════════════════════════════════════════════════════════════

const CUSTOM_EMOJI_REGEX  = /<a?:\w+:\d+>/g;
const UNICODE_EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

function countEmojis(content) {
  const custom  = content.match(CUSTOM_EMOJI_REGEX) || [];
  const unicode = content.match(UNICODE_EMOJI_REGEX) || [];
  return custom.length + unicode.length;
}

module.exports = { countEmojis };
