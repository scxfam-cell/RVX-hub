// ═══════════════════════════════════════════════════════════════
//  🔍  SCRIPT FINDER SYSTEM — shared core
//  Powers: /add, /menuchekroblox, /menuchekaudio, /find, /thai, /setlog
//  + พิมพ์ชื่อแมพเฉยๆ (ไม่ต้องมีคำสั่ง) ในห้องที่ตั้งด้วย /setlog → หาให้อัตโนมัติ
//
//  ⚠️ วางไฟล์นี้ไว้ที่ utils/ เท่านั้น — ห้ามวางใน commands/
//  เพราะไฟล์นี้ไม่มี data/execute แบบ slash command ถ้าเอาไปวางใน
//  commands/ จะทำให้ auto-deploy ตอน index.js บูตพังทั้งระบบ
//  (ดูคอมเมนต์ในบรรทัด auto-deploy ของ index.js ประกอบ)
//
//  ensureInit(client) ถูกเรียกตอนบอทบูตจาก index.js โดยตรง
//  (ไม่ได้รอ execute() ของสแลชคอมมานด์แล้ว) เพื่อให้ listener
//  ทั้ง messageCreate (พิมพ์ชื่อแมพเฉยๆ) และ interactionCreate
//  (ปุ่ม/modal ของทั้ง 3 ระบบ) พร้อมทำงานทันทีทุกครั้งที่ restart
// ═══════════════════════════════════════════════════════════════

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

const DATA_DIR      = path.join(__dirname, "..", "data");
const CHANNELS_FILE = path.join(DATA_DIR, "scriptfinder-channels.json");
const THAI_FILE     = path.join(DATA_DIR, "scriptfinder-thai.json");

const sessions     = new Map(); // scriptblox pagination sessions
const thaiSessions = new Map(); // thai-script pagination sessions
let scriptChannels = {};        // guildId -> locked channelId (จาก !setlog)
let initialized    = false;

// ──────────────────────────────────────────────
//  💾  DATA PERSISTENCE
// ──────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadChannels() {
  ensureDataDir();
  if (!fs.existsSync(CHANNELS_FILE)) fs.writeFileSync(CHANNELS_FILE, "{}");
  try {
    scriptChannels = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
  } catch {
    scriptChannels = {};
  }
}

function saveChannels() {
  ensureDataDir();
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(scriptChannels, null, 2));
}

function loadThai() {
  ensureDataDir();
  if (!fs.existsSync(THAI_FILE)) fs.writeFileSync(THAI_FILE, "[]");
  try {
    return JSON.parse(fs.readFileSync(THAI_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveThai(data) {
  ensureDataDir();
  fs.writeFileSync(THAI_FILE, JSON.stringify(data, null, 2));
}

// ──────────────────────────────────────────────
//  🌐  SCRIPTBLOX API + EMBEDS
// ──────────────────────────────────────────────
async function fetchScripts(query) {
  const res = await axios.get(`https://scriptblox.com/api/script/search?q=${encodeURIComponent(query)}`);
  return res.data.result.scripts;
}

function createEmbed(script, page, total) {
  let img = script.image;
  if (img?.startsWith("/")) img = "https://scriptblox.com" + img;
  if (!img) img = "https://scriptblox.com/static/logo.png";

  return new EmbedBuilder()
    .setTitle(script.title || "ไม่มีชื่อ")
    .setURL(`https://scriptblox.com/script/${script.slug}`)
    .setDescription(
      `> 🔹 **แมพ:** ${script.game?.name || "-"}\n` +
      `> 🔹 **Key:** ${script.key ? "มีคีย์" : "ไม่มีคีย์"}\n` +
      `> 🔹 **Views:** ${script.views || 0}\n\n` +
      "```lua\n" + (script.script?.slice(0, 300) || "ไม่มีสคริปต์") + "\n```"
    )
    .setImage(img)
    .setFooter({ text: `ScriptBlox | หน้า ${page}/${total}` })
    .setColor(0x2b2d31);
}

function createButtons(page, total, script) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sf_first").setLabel("⏪").setStyle(ButtonStyle.Success).setDisabled(page === 1),
      new ButtonBuilder().setCustomId("sf_prev").setLabel("⬅️").setStyle(ButtonStyle.Primary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId("sf_page").setLabel(`${page}/${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("sf_next").setLabel("➡️").setStyle(ButtonStyle.Primary).setDisabled(page === total),
      new ButtonBuilder().setCustomId("sf_last").setLabel("⏩").setStyle(ButtonStyle.Success).setDisabled(page === total)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sf_copy").setLabel("Copy").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setLabel("View").setStyle(ButtonStyle.Link).setURL(`https://scriptblox.com/script/${script.slug}`)
    )
  ];
}

// ──────────────────────────────────────────────
//  🇹🇭  THAI SCRIPT LIST + EMBEDS
// ──────────────────────────────────────────────
function createThaiEmbed(script, page, total) {
  const embed = new EmbedBuilder()
    .setTitle(script.title || "ไม่มีชื่อ")
    .setDescription(
      `> 🔹 **แมพ:** ${script.game || "-"}\n` +
      `> 🔹 **Key:** ${script.key ? "มีคีย์" : "ไม่มีคีย์"}\n` +
      `> 🔹 **Desc:** ${script.desc || "-"}\n\n` +
      "```lua\n" + (script.script || "").slice(0, 400) + "\n```"
    )
    .setFooter({ text: `สคริปต์คนไทย | หน้า ${page}/${total}` })
    .setColor(0x2b2d31);

  if (script.image)  embed.setImage(script.image);
  if (script.avatar) embed.setThumbnail(script.avatar);
  return embed;
}

function createThaiButtons(page, total) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sf_thai_first").setLabel("⏪").setStyle(ButtonStyle.Success).setDisabled(page === 1),
      new ButtonBuilder().setCustomId("sf_thai_prev").setLabel("⬅️").setStyle(ButtonStyle.Primary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId("sf_thai_page").setLabel(`${page}/${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("sf_thai_next").setLabel("➡️").setStyle(ButtonStyle.Primary).setDisabled(page === total),
      new ButtonBuilder().setCustomId("sf_thai_last").setLabel("⏩").setStyle(ButtonStyle.Success).setDisabled(page === total)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sf_thai_copy").setLabel("Copy").setStyle(ButtonStyle.Secondary)
    )
  ];
}

function looksLikeSearch(text) {
  const lines = text.trim().split("\n");
  if (lines.length === 1 && /^\d{10,20}(\s.+)?$/.test(lines[0].trim())) return false;
  if (text.trim().length < 2) return false;
  return true;
}

// ──────────────────────────────────────────────
//  🔌  SELF-REGISTRATION (no index.js changes needed)
// ──────────────────────────────────────────────
function ensureInit(client) {
  if (initialized) return;
  initialized = true;
  loadChannels();

  // ── พิมพ์ชื่อแมพเฉยๆ ในห้องที่ตั้งด้วย /setlog → ค้นหาให้อัตโนมัติ ──
  // (ไม่ต้องพิมพ์คำสั่ง/สัญลักษณ์ใดๆ ก่อนหน้า)
  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;

      const allowed = scriptChannels[message.guild.id];
      if (!allowed || message.channelId !== allowed) return;

      const query = message.content.trim();
      if (!query) return;

      try {
        const scripts = await fetchScripts(query);
        if (!scripts.length) {
          await message.reply("ไม่เจอ script 💀");
          return;
        }

        const page = 1;
        const sent = await message.reply({
          embeds:     [createEmbed(scripts[0], page, scripts.length)],
          components: createButtons(page, scripts.length, scripts[0])
        });
        sessions.set(sent.id, { scripts, page, user: message.author.id });
      } catch (err) {
        console.error("[ScriptFinder] fetch error:", err.message);
        await message.reply("❌ API ERROR");
      }
    } catch (err) {
      console.error("[ScriptFinder] messageCreate error:", err.message);
    }
  });

  // ── buttons + modals for all 3 systems ──
  client.on("interactionCreate", async (interaction) => {
    try {
      // ═══ MODALS ═══
      if (interaction.isModalSubmit()) {
        if (interaction.customId === "rb_modal") {
          const name = interaction.fields.getTextInputValue("rb_name");
          const cmd  = interaction.client.commands.get("menuchekroblox");
          if (cmd?.checkProfile) return cmd.checkProfile(interaction, name);
          return;
        }

        if (interaction.customId === "audio_modal") {
          const query = interaction.fields.getTextInputValue("audio_query");
          const cmd   = interaction.client.commands.get("menuchekaudio");
          if (cmd?.checkAudio) return cmd.checkAudio(interaction, query);
          return;
        }

        if (interaction.customId === "audio_preview_modal") {
          const query = interaction.fields.getTextInputValue("audio_preview_query");
          const cmd   = interaction.client.commands.get("menuchekaudio");
          if (cmd?.previewAudio) return cmd.previewAudio(interaction, query);
          return;
        }

        if (interaction.customId === "add_script_modal") {
          const title  = interaction.fields.getTextInputValue("add_title");
          const game   = interaction.fields.getTextInputValue("add_game");
          const key    = interaction.fields.getTextInputValue("add_key").toLowerCase() === "yes";
          const desc   = interaction.fields.getTextInputValue("add_desc");
          const script = interaction.fields.getTextInputValue("add_script");

          const scripts = loadThai();
          scripts.push({
            title, game, key, desc, script,
            image: null,
            avatar: interaction.user.displayAvatarURL({ extension: "png", size: 128 })
          });
          saveThai(scripts);

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("✅ เพิ่มสคริปต์สำเร็จ")
                .setDescription(
                  `> 🔹 **Title:** ${title}\n` +
                  `> 🔹 **แมพ:** ${game}\n` +
                  `> 🔹 **Key:** ${key ? "มี" : "ไม่มี"}\n` +
                  `> 🔹 **Desc:** ${desc}`
                )
                .setThumbnail(interaction.user.displayAvatarURL())
                .setColor(0x2b2d31)
            ],
            flags: 64
          });
        }

        return;
      }

      // ═══ BUTTONS ═══
      if (interaction.isButton()) {
        const id = interaction.customId;

        if (id === "rb_open") {
          const cmd = interaction.client.commands.get("menuchekroblox");
          if (cmd?.showModal) return cmd.showModal(interaction);
          return;
        }

        if (id === "audio_open") {
          const cmd = interaction.client.commands.get("menuchekaudio");
          if (cmd?.showModal) return cmd.showModal(interaction);
          return;
        }

        if (id === "audio_preview") {
          const cmd = interaction.client.commands.get("menuchekaudio");
          if (cmd?.showPreviewModal) return cmd.showPreviewModal(interaction);
          return;
        }

        if (id === "audio_help") {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❓ วิธีใช้งาน Audio Checker")
                .setDescription(
                  "> 🔍 กดปุ่ม **เช็คสถานะ** เพื่อเช็คว่า Audio ID ใช้งานได้ไหม\n" +
                  "**วิธีใช้**\n" +
                  "• กรอก Audio ID ที่ต้องการเช็ค\n" +
                  "• ถ้ามีหลายไอดี คั่นด้วย `,`\n" +
                  "• ตัวอย่าง: `123456789,987654321`\n\n" +
                  "> 🎧 กดปุ่ม **โหลด MP3** เพื่อฟังเสียงของไอดีนั้นๆ\n" +
                  "**วิธีใช้**\n" +
                  "• กรอก Audio ID ที่ต้องการฟัง\n" +
                  "• สูงสุดได้ 3 ไอดี คั่นด้วย `,`\n" +
                  "• ตัวอย่าง: `123456789,987654321`"
                )
                .setColor(0x5865f2)
            ],
            ephemeral: true
          });
        }

        // ── ScriptBlox pagination ──
        const data = sessions.get(interaction.message.id);
        if (data && id.startsWith("sf_") && !id.startsWith("sf_thai_")) {
          if (interaction.user.id !== data.user) {
            return interaction.reply({ content: "ไม่ใช่ของคุณนะ 😑", ephemeral: true });
          }

          if (id === "sf_copy") {
            let text = data.scripts[data.page - 1].script || "ไม่มีสคริปต์";
            text = text.replace(/`/g, "\\`");
            if (text.length > 1500) text = text.slice(0, 1500) + "...";
            return interaction.reply({ content: `\`${text}\``, ephemeral: true });
          }

          if (id === "sf_first") data.page = 1;
          if (id === "sf_last")  data.page = data.scripts.length;
          if (id === "sf_prev")  data.page--;
          if (id === "sf_next")  data.page++;

          const script = data.scripts[data.page - 1];
          return interaction.update({
            embeds:     [createEmbed(script, data.page, data.scripts.length)],
            components: createButtons(data.page, data.scripts.length, script)
          });
        }

        // ── Thai script pagination ──
        const tdata = thaiSessions.get(interaction.message.id);
        if (tdata && id.startsWith("sf_thai_")) {
          if (interaction.user.id !== tdata.user) {
            return interaction.reply({ content: "ไม่ใช่ของคุณนะ 😑", ephemeral: true });
          }

          if (id === "sf_thai_copy") {
            let text = tdata.scripts[tdata.page - 1].script || "ไม่มีสคริปต์";
            text = text.replace(/`/g, "\\`");
            if (text.length > 1500) text = text.slice(0, 1500) + "...";
            return interaction.reply({ content: `\`${text}\``, ephemeral: true });
          }

          if (id === "sf_thai_first") tdata.page = 1;
          if (id === "sf_thai_last")  tdata.page = tdata.scripts.length;
          if (id === "sf_thai_prev")  tdata.page--;
          if (id === "sf_thai_next")  tdata.page++;

          const script = tdata.scripts[tdata.page - 1];
          return interaction.update({
            embeds:     [createThaiEmbed(script, tdata.page, tdata.scripts.length)],
            components: createThaiButtons(tdata.page, tdata.scripts.length)
          });
        }
      }
    } catch (err) {
      console.error("[ScriptFinder] interaction error:", err);
      try {
        const payload = { content: "❌ เกิดข้อผิดพลาด กรุณาลองใหม่", ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {}
    }
  });

  console.log("[ScriptFinder] 🔌 initialized (self-registered) — script finder + roblox/audio checker enabled");
}

// ──────────────────────────────────────────────
//  ⚡  SLASH-COMMAND HANDLERS (/find · /thai · /setlog)
//  ใช้แทน ">ชื่อแมพ", ">thai", "!setlog" เดิม — session/ปุ่ม
//  ยังใช้กลไกเดียวกับของเดิมทั้งหมด (ผูกกับ message id)
// ──────────────────────────────────────────────
async function handleFindCommand(interaction, query) {
  if (interaction.guild) {
    const allowed = scriptChannels[interaction.guild.id];
    if (allowed && interaction.channelId !== allowed) {
      return interaction.reply({
        content: `❌ ใช้คำสั่งนี้ได้เฉพาะห้อง <#${allowed}>`,
        ephemeral: true
      });
    }
  }

  await interaction.deferReply();

  try {
    const scripts = await fetchScripts(query);
    if (!scripts.length) {
      return interaction.editReply("ไม่เจอ script 💀");
    }

    const page = 1;
    await interaction.editReply({
      embeds:     [createEmbed(scripts[0], page, scripts.length)],
      components: createButtons(page, scripts.length, scripts[0])
    });

    const sent = await interaction.fetchReply();
    sessions.set(sent.id, { scripts, page, user: interaction.user.id });
  } catch (err) {
    console.error("[ScriptFinder] fetch error:", err.message);
    await interaction.editReply("❌ API ERROR");
  }
}

async function handleThaiCommand(interaction) {
  if (interaction.guild) {
    const allowed = scriptChannels[interaction.guild.id];
    if (allowed && interaction.channelId !== allowed) {
      return interaction.reply({
        content: `❌ ใช้คำสั่งนี้ได้เฉพาะห้อง <#${allowed}>`,
        ephemeral: true
      });
    }
  }

  const scripts = loadThai();
  if (!scripts.length) {
    return interaction.reply({ content: "ยังไม่มีสคริปต์คนไทยในระบบ", ephemeral: true });
  }

  const page = 1;
  await interaction.reply({
    embeds:     [createThaiEmbed(scripts[0], page, scripts.length)],
    components: createThaiButtons(page, scripts.length)
  });

  const sent = await interaction.fetchReply();
  thaiSessions.set(sent.id, { scripts, page, user: interaction.user.id });
}

async function handleSetLogCommand(interaction, channel) {
  if (!interaction.guild) {
    return interaction.reply({ content: "❌ ใช้ได้ในเซิร์ฟเวอร์เท่านั้น", ephemeral: true });
  }

  scriptChannels[interaction.guild.id] = channel.id;
  saveChannels();

  return interaction.reply({
    content: `✅ ตั้งห้อง ${channel} เป็นห้องค้นหาสคริปต์แล้ว (ล็อกไว้เฉพาะห้องนี้)`,
    ephemeral: true
  });
}

module.exports = {
  ensureInit,
  loadThai,
  saveThai,
  looksLikeSearch,
  handleFindCommand,
  handleThaiCommand,
  handleSetLogCommand
};
