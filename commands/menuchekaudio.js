const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require("discord.js");

const axios = require("axios");
const { ensureInit } = require("../utils/scriptFinderCore");

const headers = {
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json"
};

async function getAudioInfo(assetId) {
  try {
    const res = await axios.get(
      `https://economy.roblox.com/v2/assets/${assetId}/details`,
      { headers, timeout: 8000 }
    );

    const d = res.data;

    if (d?.Name) {
      return {
        found: true,
        name: d.Name,
        creator: d.Creator?.Name || "Unknown"
      };
    }
  } catch {}

  try {
    const res2 = await axios.get(
      `https://catalog.roblox.com/v1/catalog/items/${assetId}/details?itemType=Asset`,
      { headers, timeout: 8000 }
    );

    const d = res2.data;

    if (d?.name) {
      return {
        found: true,
        name: d.name,
        creator: d.creatorName || "Unknown"
      };
    }
  } catch {}

  return { found: false };
}

async function checkAudioStatus(assetId) {
  try {
    const res = await axios.get(
      `https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`,
      {
        headers,
        timeout: 8000,
        maxRedirects: 5
      }
    );

    return res.status === 200;
  } catch {
    return false;
  }
}

async function checkAudio(assetId) {
  const id = assetId.trim();

  if (!id || isNaN(id)) {
    return {
      id,
      valid: false
    };
  }

  const [info, usable] = await Promise.all([
    getAudioInfo(id),
    checkAudioStatus(id)
  ]);

  return {
    id,
    valid: true,
    name: info.found ? info.name : "ไม่พบชื่อเพลง",
    creator: info.found ? info.creator : "Unknown",
    usable
  };
}

async function downloadAudio(assetId) {
  try {
    const res = await axios.get(
      `https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`,
      {
        headers,
        timeout: 15000,
        maxRedirects: 10,
        responseType: "arraybuffer"
      }
    );

    if (res.status === 200 && res.data?.byteLength > 0) {
      return Buffer.from(res.data);
    }

    return null;
  } catch {
    return null;
  }
}

function buildMenuEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎵 ระบบเช็ค Audio ID Roblox")
    .setDescription("**✨ สามารถกดดูวิธีใช้ด้านล่างเลย**")
    .setImage("https://i.ibb.co/MyqgC2jy/e553da676a4aff13ce0960f81000f42b.jpg");
}

function buildMenuRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("audio_open")
      .setLabel("🔍 เช็คสถานะ")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("audio_preview")
      .setLabel("🎧 โหลด MP3")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("audio_help")
      .setLabel("❓ วิธีใช้")
      .setStyle(ButtonStyle.Secondary)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("menuchekaudio")
    .setDescription("เมนูเช็คไอดีเพลง Roblox"),

  async execute(interaction) {
    ensureInit(interaction.client);
    await interaction.reply({
      embeds: [buildMenuEmbed()],
      components: [buildMenuRow()]
    });
  },

  async showModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId("audio_modal")
      .setTitle("🎵 เช็ค Audio ID");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("audio_query")
          .setLabel("ใส่ Audio ID")
          .setPlaceholder("123456789,987654321")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
  },

  async showPreviewModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId("audio_preview_modal")
      .setTitle("🎧 โหลดเสียง MP3");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("audio_preview_query")
          .setLabel("ใส่ Audio ID")
          .setPlaceholder("123456789")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
  },

  async checkAudio(interaction, query) {
    await interaction.deferReply({ ephemeral: true });

    const ids = query
      .split(",")
      .map(v => v.trim())
      .filter(Boolean)
      .slice(0, 20);

    const results = await Promise.all(
      ids.map(id => checkAudio(id))
    );

    const usable = results.filter(r => r.valid && r.usable);
    const unusable = results.filter(r => r.valid && !r.usable);

    const embed1 = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle(`✅ ใช้ได้ ${usable.length}`)
      .setDescription(
        usable.length
          ? usable.map(r =>
              `> \`${r.id}\` — ${r.name}`
            ).join("\n")
          : "ไม่มี"
      );

    const embed2 = new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle(`❌ ใช้ไม่ได้ ${unusable.length}`)
      .setDescription(
        unusable.length
          ? unusable.map(r =>
              `> \`${r.id}\` — ${r.name}`
            ).join("\n")
          : "ไม่มี"
      );

    await interaction.editReply({
      embeds: [embed1, embed2]
    });
  },

  async previewAudio(interaction, query) {
    await interaction.deferReply({ ephemeral: true });

    const ids = query
      .split(",")
      .map(v => v.trim())
      .filter(Boolean)
      .slice(0, 3);

    const files = [];

    for (const id of ids) {
      const buffer = await downloadAudio(id);

      if (buffer) {
        files.push(
          new AttachmentBuilder(buffer, {
            name: `${id}.mp3`
          })
        );
      }
    }

    if (!files.length) {
      return interaction.editReply("❌ โหลดเสียงไม่ได้");
    }

    await interaction.editReply({
      content: `✅ โหลดสำเร็จ ${files.length} ไฟล์`,
      files
    });
  }
};
