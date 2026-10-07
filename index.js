// ═══════════════════════════════════════════════════════════════
//  🎵  SONG-ID GUARDIAN BOT  ·  Full System v2.0 + 🎀 สาวน้อย AI + 📌 Sticky System
//  🔍  v2.1 PATCH: + ระบบค้นหาเพลง + Auto Join Voice Channel
//  🎁  v2.2 PATCH: + ระบบ Giveaway
//  💬  v2.3 PATCH: + แจ้งเตือนในแชทแทน DM
// ═══════════════════════════════════════════════════════════════

const {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder,
  PermissionsBitField,
  ActivityType,
  REST,
  Routes,
  Partials,
} = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");
const fs   = require("fs");
const path = require("path");

const cfg    = require("./config");
const logger = require("./utils/logger");
const db     = require("./utils/database");
const {
  parseSongMessage,
  checkCooldown,
  hasBypassRole,
  sendLog,
  tempReply,
  makeEmbed,
} = require("./utils/helpers");
const { startDashboard }      = require("./dashboard/server");
const { handleStickyMessage } = require("./utils/stickyMessage");
const songChannels            = require("./utils/songChannels"); // 📺 ห้องรับไอดีเพลง (ตั้งได้ด้วย /songchannel)

// 🛡️ ระบบ Automod (กันสแปม/ลิงก์/อีโมจิ/รูป/บอทแปลก) — ตั้งค่าได้ด้วย /automod
const { handleAutomod }        = require("./utils/automod");
const { handleBotInviteGuard } = require("./utils/automod/botInviteGuard");
const { handleAIMessage, initServerKnowledge, handleReactionAdd } = require("./ai"); // 🏠 v6.0 + server knowledge // 🎀 AI System (สาวน้อย)

// ✅ โหลด buyrole
const buyRole = require("./commands/buyrole");

// 🎁 โหลดระบบแจกเหรียญ (แจกให้ทุกคนที่กดทัน — คนละระบบกับ giveawayManager ที่สุ่มผู้ชนะ)
const coinDropManager = require("./utils/coinDropManager");

// 🧧 โหลดระบบโดเนท
const donateCmd = require("./commands/donate");

// 🎁 โหลด giveaway
const { startGiveawayTimer, handleGiveawayButton } = require("./utils/giveawayManager");

// 🔍 โหลดระบบค้นหาสคริปต์ (roblox/audio checker + thai script list)
const { ensureInit: ensureScriptFinderInit } = require("./utils/scriptFinderCore");

// 📜 โหลดระบบตรวจสอบสคริปต์ (Script Monitor Hub)
const { startScriptMonitor } = require("./utils/scriptMonitor");

// 🎧 โหลดระบบให้เหรียญจากการออนห้องเสียง
const { handleVoiceStateUpdate, initExistingVoiceMembers } = require("./utils/voiceRewardManager");

// ──────────────────────────────────────────────
//  🤖  CLIENT
// ──────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

// 🔍 แขวน listener ของระบบ script finder ทันทีตอนบูต
// (แก้บั๊ก: เดิมแขวนตอนมีคนพิมพ์ /add /menuchekaudio /menuchekroblox ครั้งแรกเท่านั้น
//  ทำให้ปุ่ม/เมนูเก่าที่โพสต์ไว้ก่อน restart กดไม่ติดจนกว่าจะมีคนสั่งคำสั่งใหม่)
ensureScriptFinderInit(client);

// ──────────────────────────────────────────────
//  ⚡  LOAD SLASH COMMANDS
// ──────────────────────────────────────────────
client.commands = new Collection();

const cmdFiles = fs
  .readdirSync(path.join(__dirname, "commands"))
  .filter((f) => f.endsWith(".js"));

for (const file of cmdFiles) {
  const cmd = require(`./commands/${file}`);
  if (cmd.data?.name) client.commands.set(cmd.data.name, cmd);
  logger.info(`Loaded command: ${cmd.data?.name || file}`);
}

// ══════════════════════════════════════════════
//  🔍  SONG SEARCH SYSTEM (ระบบค้นหาเพลง)
// ══════════════════════════════════════════════

const SEARCH_MAX_RESULTS = 5;

function looksLikeSearch(text) {
  const lines = text.trim().split("\n");
  if (lines.length === 1 && /^\d{10,20}(\s.+)?$/.test(lines[0].trim())) return false;
  if (text.trim().length < 2) return false;
  return true;
}

function buildSearchEmbed(results, query, author) {
  if (results.length === 0) return null;

  const listText = results
    .slice(0, SEARCH_MAX_RESULTS)
    .map((s, i) =>
      `\`${String(i + 1).padStart(2, "0")}.\` **${s.name}**\n└ \`${s.id}\``
    )
    .join("\n");

  const moreText = results.length > SEARCH_MAX_RESULTS
    ? `\n*…และอีก ${results.length - SEARCH_MAX_RESULTS} เพลง ลองค้นให้เฉพาะเจาะจงขึ้น*`
    : "";

  return new EmbedBuilder()
    .setColor(cfg.COLOR_SUCCESS || "#57F287")
    .setAuthor({ name: author.tag, iconURL: author.displayAvatarURL() })
    .setTitle(`🔍 ผลการค้นหา: "${query}"`)
    .setDescription(listText + moreText)
    .setFooter({ text: `🎵 Song-ID Guardian · พบ ${results.length} เพลง` })
    .setTimestamp();
}

// ──────────────────────────────────────────────
//  📡  READY
// ──────────────────────────────────────────────
client.once("ready", async (c) => {
  logger.banner(c.user.tag);
  logger.success(`Servers: ${c.guilds.cache.size}`);
  logger.info(`Song channels: ${songChannels.getAll().join(", ") || "(ยังไม่ได้ตั้งค่า)"}`);
  logger.info(`Log channel:   ${cfg.LOG_CHANNEL_ID || "disabled"}`);
  logger.info(`Dashboard:     ${cfg.DASHBOARD_ENABLED ? `http://localhost:${cfg.DASHBOARD_PORT}` : "disabled"}`);
  logger.info(`DB songs:      ${db.getMeta().totalSongs}`);

  // ✅ Auto Join Voice Channel
  const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID || cfg.VOICE_CHANNEL_ID;
  if (VOICE_CHANNEL_ID) {
    try {
      for (const guild of c.guilds.cache.values()) {
        const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
        if (voiceChannel && voiceChannel.isVoiceBased()) {
          joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId:   guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: true,
          });
          logger.success(`[VOICE] ✅ เข้าร่วม voice channel: ${voiceChannel.name} (${guild.name})`);
          break;
        }
      }
    } catch (err) {
      logger.error(`[VOICE] ❌ เข้า voice channel ไม่ได้: ${err.message}`);
    }
  } else {
    logger.info("[VOICE] ไม่มี VOICE_CHANNEL_ID → ข้ามการ join voice");
  }

  logger.divider();

  c.user.setPresence({
    activities: [{ name: `🎵 ${db.getMeta().totalSongs} เพลง`, type: ActivityType.Watching }],
    status: "online",
  });

  setInterval(() => {
    c.user.setActivity(`🎵 ${db.getMeta().totalSongs} เพลง`, { type: ActivityType.Watching });
  }, 5 * 60 * 1000);

  // ✅ เริ่ม timer ถอดยศ + restore shop embed
  buyRole.startExpiryChecker(client);

  // 🏠 โหลดข้อมูลเซิร์ฟเวอร์ให้ AI (ดึงห้อง, role, กฎ อัตโนมัติ)
  initServerKnowledge(c);

  // 🎁 เริ่ม giveaway timer (restore giveaway ที่ยังไม่จบหลัง restart)
  startGiveawayTimer(client);

  // 📜 เริ่มระบบตรวจสอบสคริปต์ (เช็คสถานะลิงก์เป็นระยะ)
  startScriptMonitor(client);

  // 🎧 กู้คืนการนับเวลาให้คนที่ค้างอยู่ในห้องเสียงอยู่แล้ว (กรณีบอท restart)
  initExistingVoiceMembers(client);

  // 🎁 กู้คืนเวลาเข้าห้องเสียง + เริ่ม timer เช็คหมดอายุของระบบแจกเหรียญ
  coinDropManager.initVoiceJoinTimes(client);
  coinDropManager.startExpiryChecker(client);
});

// ──────────────────────────────────────────────
//  🎧  VOICE STATE UPDATE — ระบบเหรียญจากการออนห้องเสียง
// ──────────────────────────────────────────────
client.on("voiceStateUpdate", (oldState, newState) => {
  handleVoiceStateUpdate(oldState, newState, client);
  coinDropManager.trackVoiceJoin(oldState, newState);
});

// ──────────────────────────────────────────────
//  🤖  GUILD MEMBER ADD — ระบบกันแอดมินเชิญบอทแปลกเข้ามา
// ──────────────────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  try {
    await handleBotInviteGuard(member);
  } catch (err) {
    logger.error(`[ANTI-BOT-INVITE] error: ${err.message}`);
  }
});

// ──────────────────────────────────────────────
//  📨  MESSAGE CREATE
// ──────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  // 🛡️ Automod — เช็คทุกข้อความในเซิร์ฟเวอร์ (รวมบอทอื่นด้วย ยกเว้นตัวเองกับเจ้าของเซิร์ฟ)
  // ทำงานก่อนทุกระบบ เพราะถ้าผิดกฎ ข้อความต้องถูกลบก่อนที่ระบบอื่นจะอ่านเนื้อหาไปใช้ต่อ
  try {
    if (await handleAutomod(message)) return;
  } catch (err) {
    logger.error(`[AUTOMOD] error: ${err.message}`);
  }

  if (message.author.bot) return;

  // ✅ !buyrole — admin prefix command
  const usedCoinDropCmd = await coinDropManager.handleMessage(message);
  await buyRole.handleMessage(message);
  if (!usedCoinDropCmd) await coinDropManager.handleStickyRepost(message);

  // 📌 ระบบปักหมุด
  await handleStickyMessage(message);

  // 🎀 AI เดิม
  if (await handleAIMessage(message, logger, db)) return;

  
  // ─────────────────────────────────────────
  //  🎵 SONG CHANNEL — ตรวจไอดีเพลง + ค้นหา
  // ─────────────────────────────────────────
  if (!songChannels.isSongChannel(message.channelId)) return;

  const { author, member, content, guild } = message;

  logger.divider();
  logger.info(`${author.tag} → ${content.slice(0, 80).replace(/\n/g, " | ")}`);

  const { valid, invalid } = parseSongMessage(content);

  // 🔍 ถ้ามีบรรทัดที่ผิดรูปแบบ → ลองค้นหาเพลงก่อนที่จะลบ
  if (invalid.length > 0) {
    const rawQuery = content.trim();

    if (looksLikeSearch(rawQuery)) {
      const results = db.searchSongs ? db.searchSongs(rawQuery, SEARCH_MAX_RESULTS * 2) : [];

      if (results.length > 0) {
        logger.info(`[SEARCH] "${rawQuery}" → พบ ${results.length} เพลง`);
        const embed = buildSearchEmbed(results, rawQuery, author);
        await message.reply({ content: `🔍 ${author}`, embeds: [embed] });
        return;
      }

      logger.info(`[SEARCH] "${rawQuery}" → ไม่พบเพลง → silent delete`);
      await message.delete().catch(() => {});
      return;
    }
  }

  // ─────────────────────────────────────────
  //  logic เดิม: cooldown + validate + save
  //  (ทุกคนถูกตรวจเหมือนกันหมด ไม่มีการยกเว้นแอดมิน/role bypass แล้ว)
  // ─────────────────────────────────────────
  const cd = checkCooldown(author.id);
  if (cd.onCooldown) {
    logger.warn(`${author.tag} cooldown ${cd.remaining}s`);
    await message.delete().catch(() => {});
    await tempReply(message.channel, {
      content: `${author}`,
      embeds: [makeEmbed(cfg.COLOR_ERROR, "⏳ ช้าหน่อยนะ!", `รอ **${cd.remaining} วินาที** แล้วลองใหม่`)],
    });
    return;
  }

  logger.song(`valid=${valid.length}  invalid=${invalid.length}`);

  // ✅ ทุกบรรทัดเป็นไอดีเพลง
  if (invalid.length === 0 && valid.length > 0) {
    if (valid.length > cfg.MAX_SONGS_PER_MESSAGE) {
      await message.delete().catch(() => {});
      await tempReply(message.channel, {
        content: `${author}`,
        embeds: [makeEmbed(cfg.COLOR_ERROR, "🚫 เพลงเยอะเกิน!",
          `ส่งได้สูงสุด **${cfg.MAX_SONGS_PER_MESSAGE} เพลง** ต่อครั้ง\nคุณส่งมา **${valid.length} เพลง**`)],
      });
      return;
    }

    const { added, duplicates } = db.addSongs(valid, author.id, author.tag);
    logger.success(`เพิ่ม ${added.length} เพลง | ซ้ำ ${duplicates.length} เพลง`);

    // 🗑️ เข้าเว็บสำเร็จแล้ว → ลบข้อความต้นฉบับที่คนพิมพ์ทิ้งทันที
    await message.delete().catch(() => {});

    const meta     = db.getMeta();
    const songList = added.slice(0, 10)
      .map((s, i) => `\`${String(i + 1).padStart(2, "0")}.\` **${s.name}**\n└ \`${s.id}\``)
      .join("\n");
    const moreAdded = added.length > 10 ? `\n*…+${added.length - 10} เพลง*` : "";

    const dupList = duplicates.length > 0
      ? duplicates.slice(0, 5).map((d) => `• **${d.name}** (ส่งโดย ${d.original.addedByTag})`).join("\n")
        + (duplicates.length > 5 ? `\n*…+${duplicates.length - 5}*` : "")
      : null;

    const embed = new EmbedBuilder()
      .setColor(cfg.COLOR_SUCCESS)
      .setAuthor({ name: author.tag, iconURL: author.displayAvatarURL() })
      .setTitle(`✅ รับไอดีเพลงแล้ว ${added.length} เพลง`)
      .setDescription(added.length ? songList + moreAdded : "*(ทั้งหมดซ้ำ — ไม่มีเพลงใหม่)*")
      .setTimestamp()
      .setFooter({ text: `🎵 Song-ID Guardian · ${guild?.name}` });

    if (added.length > 0)
      embed.addFields({ name: "📦 ฐานข้อมูลทั้งหมด", value: `**${meta.totalSongs}** เพลง`, inline: true });
    if (dupList)
      embed.addFields({ name: `⚠️ ซ้ำ ${duplicates.length} เพลง`, value: dupList, inline: false });

    await tempReply(message.channel, { embeds: [embed] });
    await sendLog(client, new EmbedBuilder()
      .setColor(cfg.COLOR_LOG).setTitle("📋 [LOG] เพิ่มเพลง")
      .addFields(
        { name: "👤 ผู้ส่ง", value: `${author.tag} (${author.id})`, inline: true },
        { name: "✅ เพิ่ม",  value: `${added.length}`,              inline: true },
        { name: "⚠️ ซ้ำ",   value: `${duplicates.length}`,         inline: true }
      ).setTimestamp());
    return;
  }

  // ❌ มีบรรทัดที่ไม่ใช่ไอดีเพลง
  logger.delete(`ลบข้อความของ ${author.tag}`);
  await message.delete().catch(() => {});
  db.recordDeleted(author.id, author.tag, valid.length + invalid.length);

  const invalidPreview = invalid.slice(0, 5)
    .map((l) => `• \`${l.slice(0, 60)}\``).join("\n");

  const errorEmbed = new EmbedBuilder()
    .setColor(cfg.COLOR_ERROR).setTitle("❌ รูปแบบไม่ถูกต้อง!")
    .setDescription("ช่องนี้รับ **ไอดีเพลงเท่านั้น** ข้อความของคุณถูกลบแล้ว")
    .addFields(
      { name: "📌 รูปแบบที่ถูกต้อง", value: "```\n131963054557194 ที่ระหึก\n137462566140207 สารภาพลดโทษกึ่งหนึ่ง\n```" },
      { name: `❌ บรรทัดที่ผิด (${invalid.length})`,
        value: invalidPreview + (invalid.length > 5 ? `\n*…+${invalid.length - 5}*` : "") },
      valid.length > 0
        ? { name: "✅ บรรทัดที่ถูก", value: `${valid.length} บรรทัด (ส่งใหม่เฉพาะส่วนนี้ได้)` }
        : { name: "\u200b", value: "\u200b" }
    ).setTimestamp().setFooter({ text: "🎵 Song-ID Guardian" });

  await tempReply(message.channel, { content: `${author}`, embeds: [errorEmbed] });
  await sendLog(client, new EmbedBuilder()
    .setColor(cfg.COLOR_ERROR).setTitle("🗑️ [LOG] ลบข้อความ")
    .addFields(
      { name: "👤 ผู้ส่ง",     value: `${author.tag} (${author.id})`, inline: true },
      { name: "❌ บรรทัดผิด", value: `${invalid.length}`,            inline: true },
      { name: "✅ บรรทัดถูก", value: `${valid.length}`,              inline: true },
      { name: "📝 เนื้อหา",   value: `\`\`\`${content.slice(0, 300)}\`\`\`` }
    ).setTimestamp());
});

// ──────────────────────────────────────────────
//  🧬  REACTION ADD — ป้อนข้อมูลให้ระบบเรียนรู้สไตล์ของ AI
// ──────────────────────────────────────────────
client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch (err) {
    logger.warn(`[AI-LEARN] fetch reaction ล้มเหลว: ${err.message}`);
    return;
  }
  await handleReactionAdd(reaction, user);
});

// ──────────────────────────────────────────────
//  ⚡  INTERACTION  —  Slash Commands + Buttons
// ──────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  // ✅ buyrole interactions (select menu + modal)
  if (interaction.isStringSelectMenu()) await buyRole.handleSelect(interaction);
  if (interaction.isModalSubmit()) {
    // 📜 script add modal (กรอกรายละเอียดสคริปต์)
    const scriptCmdModal = client.commands.get("script");
    if (scriptCmdModal?.handleModalSubmit && (await scriptCmdModal.handleModalSubmit(interaction))) return;

    if (await donateCmd.handleModal(interaction)) return;
    await buyRole.handleModal(interaction);

    // ✅ verify code modal (กรอกรหัสยืนยัน)
    const verifyCmdModal = client.commands.get("setup-verify");
    if (verifyCmdModal?.handleModalSubmit && (await verifyCmdModal.handleModalSubmit(interaction))) return;
  }

  // 🧧 donate button (เปิด modal โดเนท)
  if (interaction.isButton() && (await donateCmd.handleButton(interaction))) return;

  // 📜 script check button (เช็คสถานะสด)
  if (interaction.isButton()) {
    const scriptCmdBtn = client.commands.get("script");
    if (scriptCmdBtn?.handleButton && (await scriptCmdBtn.handleButton(interaction))) return;
  }

  // ✅ verify button (ยืนยันตัวตนรับยศ)
  if (interaction.isButton()) {
    const verifyCmd = client.commands.get("setup-verify");
    if (verifyCmd?.handleButton && (await verifyCmd.handleButton(interaction))) return;
  }

  // 🎁 coin drop button (กดรับเหรียญ)
  if (interaction.isButton() && (await coinDropManager.handleButton(interaction))) return;

  // 🎁 giveaway button (เข้าร่วม)
  if (interaction.isButton()) await handleGiveawayButton(interaction);

  if (interaction.isChatInputCommand()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;

    logger.cmd(`/${interaction.commandName} by ${interaction.user.tag}`);
    try {
      await cmd.execute(interaction);
    } catch (err) {
      logger.error(`/${interaction.commandName}: ${err.message}`);
      const errMsg = { content: "❌ เกิดข้อผิดพลาด กรุณาลองใหม่", ephemeral: true };
      interaction.replied || interaction.deferred
        ? await interaction.followUp(errMsg)
        : await interaction.reply(errMsg);
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("list_")) {
    const listCmd = client.commands.get("list");
    if (listCmd?.handleButton) await listCmd.handleButton(interaction);
  }

  // 🛡️ automod panel button (เปิด/ปิดระบบความปลอดภัยแต่ละอย่าง)
  if (interaction.isButton() && interaction.customId.startsWith("automodpanel_toggle_")) {
    const panelCmd = client.commands.get("automodpanel");
    if (panelCmd?.handleButton) await panelCmd.handleButton(interaction);
  }
});

// ──────────────────────────────────────────────
//  🔥  ERROR HANDLING
// ──────────────────────────────────────────────
client.on("error", (err) => logger.error(`Client: ${err.message}`));
client.on("warn",  (msg) => logger.warn(msg));

process.on("unhandledRejection", (err) =>
  logger.error(`UnhandledRejection: ${err?.message ?? err}`)
);
process.on("uncaughtException", (err) => {
  // ⚠️ ไม่ process.exit(1) อีกต่อไป — เดิม error เดียว (เช่นโดนยิงเว็บ dashboard
  // ที่รันอยู่ process เดียวกัน) จะทำให้บอท Discord ทั้งตัวดับไปด้วย ต้องรันเอง
  // ตอนนี้แค่ log ไว้ ให้บอทเดิน (client) ต่อได้ตามปกติ
  logger.error(`UncaughtException: ${err?.stack || err?.message || err}`);
});

// ──────────────────────────────────────────────
//  🚀  START
// ──────────────────────────────────────────────
(async () => {
  try {
    const commandsPath = path.join(__dirname, "commands");
    const cmds = fs
      .readdirSync(commandsPath)
      .filter((f) => f.endsWith(".js"))
      .map((f) => require(path.join(commandsPath, f)).data.toJSON())
      .filter(Boolean);

    if (cmds.length > 0 && cfg.TOKEN && cfg.CLIENT_ID) {
      const rest = new REST({ version: "10" }).setToken(cfg.TOKEN);

      logger.info(`[AUTO-DEPLOY] 🧹 กำลังเคลียร์คำสั่งเก่าแบบ Global ที่ค้างอยู่...`);
      await rest.put(Routes.applicationCommands(cfg.CLIENT_ID), { body: [] });

      if (cfg.GUILD_ID) {
        logger.info(`[AUTO-DEPLOY] 🔄 กำลังยิงคำสั่ง ${cmds.length} คำสั่งเข้าเซิร์ฟเวอร์โดยตรง...`);
        await rest.put(
          Routes.applicationGuildCommands(cfg.CLIENT_ID, cfg.GUILD_ID),
          { body: cmds }
        );
        logger.success(`[AUTO-DEPLOY] ✅ อัปเดตคำสั่งเข้าเซิร์ฟเวอร์โดยตรงสำเร็จแล้ว!`);
      } else {
        logger.warn(`[AUTO-DEPLOY] ไม่พบ GUILD_ID ในคอนฟิก ระบบจะอัปเดตแบบ Global แทน`);
        await rest.put(Routes.applicationCommands(cfg.CLIENT_ID), { body: cmds });
        logger.success(`[AUTO-DEPLOY] ✅ Auto-deployed ${cmds.length} commands (Global)`);
      }
    }
  } catch (err) {
    logger.error("[AUTO-DEPLOY] ❌ เกิดข้อผิดพลาด: " + err.message);
  }

  startDashboard(client);
  client.login(cfg.TOKEN);
})();