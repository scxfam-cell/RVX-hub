// ═══════════════════════════════════════════════════════════════
//  ⚡  REGISTER SLASH COMMANDS  —  รันครั้งเดียวเพื่อ register
//  node deploy-commands.js
// ═══════════════════════════════════════════════════════════════
const { REST, Routes } = require("discord.js");
const cfg = require("./config");
const fs  = require("fs");
const path = require("path");

const commands = fs
  .readdirSync(path.join(__dirname, "commands"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => require(`./commands/${f}`).data.toJSON());

const rest = new REST({ version: "10" }).setToken(cfg.TOKEN);

(async () => {
  try {
    console.log(`\x1b[36m[DEPLOY]\x1b[0m Registering ${commands.length} slash commands…`);

    await rest.put(Routes.applicationCommands(cfg.CLIENT_ID), {
      body: commands,
    });

    console.log(`\x1b[32m[DEPLOY]\x1b[0m ✅ Registered successfully!`);
    commands.forEach((c) => console.log(`  · /${c.name}`));
  } catch (err) {
    console.error(`\x1b[31m[DEPLOY]\x1b[0m ❌ Error:`, err);
  }
})();