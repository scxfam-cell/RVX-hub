// ═══════════════════════════════════════════════════════════════
//  🖼️  IMAGE DETECTOR  —  นับความถี่การส่งรูปภาพต่อคนในช่วงเวลาที่กำหนด
// ═══════════════════════════════════════════════════════════════

const windows = new Map(); // key: "guildId:userId" -> [timestamp, ...]

function isImageMessage(message) {
  if (message.attachments.size === 0) return false;
  return message.attachments.some((a) => (a.contentType || "").startsWith("image/"));
}

function checkImageSpam(guildId, userId, limit, intervalSeconds) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const windowMs = intervalSeconds * 1000;

  const arr = (windows.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  windows.set(key, arr);

  return arr.length > limit;
}

module.exports = { isImageMessage, checkImageSpam };
