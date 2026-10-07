// ═══════════════════════════════════════════════════════════════
//  🖨️  LOGGER  —  Console output แบบสวยงาม
// ═══════════════════════════════════════════════════════════════
const t = () =>
  new Date().toLocaleTimeString("th-TH", { hour12: false, timeZone: "Asia/Bangkok" });

const clr = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  magenta:"\x1b[35m",
  blue:   "\x1b[34m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
};

const pad = (label) => label.padEnd(7);

const logger = {
  info:    (msg) => console.log(`${clr.cyan}[${t()}] ${pad("INFO")}${clr.reset} ${msg}`),
  success: (msg) => console.log(`${clr.green}[${t()}] ${pad("OK")}${clr.reset} ${msg}`),
  warn:    (msg) => console.log(`${clr.yellow}[${t()}] ${pad("WARN")}${clr.reset} ${msg}`),
  error:   (msg) => console.log(`${clr.red}[${t()}] ${pad("ERROR")}${clr.reset} ${msg}`),
  song:    (msg) => console.log(`${clr.magenta}[${t()}] ${pad("SONG")}${clr.reset} 🎵 ${msg}`),
  delete:  (msg) => console.log(`${clr.red}[${t()}] ${pad("DELETE")}${clr.reset} 🗑️  ${msg}`),
  cmd:     (msg) => console.log(`${clr.blue}[${t()}] ${pad("CMD")}${clr.reset} ⚡ ${msg}`),
  web:     (msg) => console.log(`${clr.cyan}[${t()}] ${pad("WEB")}${clr.reset} 🌐 ${msg}`),

  divider: () => console.log(`${clr.gray}${"─".repeat(56)}${clr.reset}`),

  banner: (tag) => {
    console.log(`\n${clr.magenta}`);
    console.log("╔════════════════════════════════════════════════════╗");
    console.log("║   🎵  SONG-ID GUARDIAN BOT  ·  Full System v2.0   ║");
    console.log(`║   Logged in as: ${(tag || "").padEnd(34)}║`);
    console.log("╚════════════════════════════════════════════════════╝");
    console.log(`${clr.reset}\n`);
  },
};

module.exports = logger;