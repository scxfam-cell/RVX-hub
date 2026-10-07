// ═══════════════════════════════════════════════════════════════
//  🧧  DONATE SYSTEM (TrueMoney ซองอั่งเปา)
//  พอร์ตมาจาก Danate Bot (Python/nextcord) → discord.js
// ═══════════════════════════════════════════════════════════════
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const cfg = require("../config");
const logger = require("../utils/logger");

const DB_PATH = path.join(__dirname, "..", "data", "donateDb.json");

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ money: 0, count: 0 }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const VOUCHER_REGEX = /^https:\/\/gift\.truemoney\.com\/campaign\/\?v=[a-zA-Z0-9]{18}$/;

async function sendDonateLog(client, embed) {
  const channelId = cfg.DONATE_LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
}

const DONATE_BANNER_URL =
  "https://cdn.discordapp.com/attachments/1518593515712413706/1523149509738233856/file_0000000046f871f8bf3f3f9af88c4a4b.jpg";

function buildPanelEmbed() {
  const minAmount = cfg.DONATE_MIN_AMOUNT || 0;
  const roleId = cfg.DONATE_ROLE_ID;

  const embed = new EmbedBuilder()
    .setTitle("🧧 ระบบโดเนทผ่านซองอั่งเปา")
    .setDescription(
      "```diff\n+ ขอบคุณสำหรับเงินโดเนททุกบาททุกสตางค์ 🧧\n```\n" +
      "> 🔗 กดปุ่มด้านล่าง แล้ววางลิงก์ซองอั่งเปา **TrueMoney Wallet**\n" +
      "> ⚡ ระบบตรวจสอบและรับเงินให้ทันทีแบบอัตโนมัติ\n" +
      "> 🎁 โดเนทถึงยอดที่กำหนด รับยศพิเศษฟรี!"
    )
    .setColor(cfg.COLOR_DONATE || "#FF6B6B")
    .setImage(cfg.DONATE_BANNER_URL || DONATE_BANNER_URL)
    .setThumbnail(cfg.DONATE_THUMBNAIL_URL || "https://cdn.discordapp.com/emojis/1090662644327194674.png")
    .addFields(
      {
        name: "💵 ยอดขั้นต่ำรับยศ",
        value: minAmount ? `\`${minAmount}\` บาท` : "*ไม่กำหนด*",
        inline: true,
      },
      {
        name: "🏷️ ยศที่ได้รับ",
        value: roleId ? `<@&${roleId}>` : "*ไม่กำหนด*",
        inline: true,
      },
      {
        name: "✅ สถานะระบบ",
        value: "```🟢 พร้อมใช้งาน```",
        inline: true,
      }
    )
    .setFooter({ text: "🧧 Donate System · TrueMoney Wallet", iconURL: DONATE_BANNER_URL })
    .setTimestamp();

  return embed;
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("donate_open_modal")
      .setLabel("กดเพื่อโดเนท")
      .setEmoji("🧧")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("donate_view_stats")
      .setLabel("ดูยอดโดเนทรวม")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary)
  );
}

module.exports = {
  // ── /topup : โพสต์ปุ่มโดเนท (แอดมินเท่านั้น) ──
  data: new SlashCommandBuilder()
    .setName("topup")
    .setDescription("โพสต์ปุ่มโดเนทซองอั่งเปา (แอดมินเท่านั้น)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    await interaction.reply({
      embeds: [buildPanelEmbed()],
      components: [buildPanelRow()],
    });
  },

  // เรียกจาก interactionCreate ใน index.js:
  //   if (interaction.isButton()) { if (await donateCmd.handleButton(interaction)) return; }
  async handleButton(interaction) {
    if (interaction.customId === "donate_view_stats") {
      const db = loadDb();
      const embed = new EmbedBuilder()
        .setColor(cfg.COLOR_SUCCESS || "#FFD700")
        .setAuthor({ name: interaction.guild?.name || "Donate Stats", iconURL: interaction.guild?.iconURL() || undefined })
        .setTitle("🧧 สถิติการโดเนททั้งหมด")
        .setThumbnail(DONATE_BANNER_URL)
        .addFields(
          { name: "💰 ยอดโดเนทรวม", value: `\`\`\`${Number(db.money).toLocaleString()} บาท\`\`\``, inline: true },
          { name: "👥 จำนวนผู้โดเนท", value: `\`\`\`${db.count} คน\`\`\``, inline: true }
        )
        .setFooter({ text: "🧧 Donate System" })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return true;
    }

    if (interaction.customId !== "donate_open_modal") return false;

    const modal = new ModalBuilder()
      .setCustomId("donate_modal")
      .setTitle("โดเนทผ่านระบบซองอั่งเปา");

    const input = new TextInputBuilder()
      .setCustomId("donate_link")
      .setLabel("เติมเงินด้วยอังเปา (ห้ามมีตัว # ในลิงก์)")
      .setPlaceholder("กรอกลิงก์ซองอั่งเปา💸💰 | URL")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  },

  // เรียกจาก interactionCreate ใน index.js:
  //   if (interaction.isModalSubmit()) { if (await donateCmd.handleModal(interaction)) return; }
  async handleModal(interaction) {
    if (interaction.customId !== "donate_modal") return false;

    const link = interaction.fields.getTextInputValue("donate_link").trim();

    if (!VOUCHER_REGEX.test(link)) {
      await interaction.reply({ content: "❌ ลิงก์ซองอั่งเปาไม่ถูกต้อง", ephemeral: true });
      return true;
    }

    const voucherCode = link.split("?v=")[1];

    try {
      const res = await fetch(
        `https://gift.truemoney.com/campaign/vouchers/${voucherCode}/redeem`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
          },
          body: JSON.stringify({
            mobile: cfg.DONATE_PHONE,
            voucher_hash: voucherCode,
          }),
        }
      );
      const data = await res.json();

      if (res.status === 200 && data?.status?.code === "SUCCESS") {
        const amount = Number(data.data.tickets[0].amount_baht);

        const db = loadDb();
        db.money += amount;
        db.count += 1;
        saveDb(db);

        const successEmbed = new EmbedBuilder()
          .setColor(cfg.COLOR_SUCCESS || "#57F287")
          .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
          .setTitle("✅ รับเงินโดเนทสำเร็จ")
          .setThumbnail(interaction.user.displayAvatarURL())
          .addFields(
            { name: "👤 ผู้โดเนท", value: `<@${interaction.user.id}>`, inline: true },
            { name: "💰 จำนวนเงิน", value: `\`${amount}\` บาท`, inline: true },
            { name: "🧧 สร้างซองโดย", value: `\`${data.data.owner_profile.full_name}\``, inline: false }
          )
          .setImage(DONATE_BANNER_URL)
          .setFooter({ text: "🧧 Donate System", iconURL: DONATE_BANNER_URL })
          .setTimestamp();

        await interaction.reply({ content: "✅ รับเงินสำเร็จ ขอบคุณสำหรับการโดเนทครับ", ephemeral: true });
        await sendDonateLog(interaction.client, successEmbed);

        // ให้ยศอัตโนมัติเมื่อยอดถึงเกณฑ์
        if (amount >= (cfg.DONATE_MIN_AMOUNT || 0) && cfg.DONATE_ROLE_ID) {
          const member = interaction.member;
          const role = interaction.guild.roles.cache.get(cfg.DONATE_ROLE_ID);
          if (role && !member.roles.cache.has(role.id)) {
            await member.roles.add(role).catch(() => {});
            if (cfg.DONATE_NOTIFY_CHANNEL_ID) {
              const notifyChannel = await interaction.guild.channels
                .fetch(cfg.DONATE_NOTIFY_CHANNEL_ID)
                .catch(() => null);
              if (notifyChannel) {
                await notifyChannel.send({
                  embeds: [
                    new EmbedBuilder()
                      .setColor(cfg.COLOR_SUCCESS || "#57F287")
                      .setDescription(
                        `${interaction.user} โดเนทสำเร็จ ${amount} บาท\n\n**ได้รับยศ**\n• <@&${role.id}>`
                      ),
                  ],
                });
              }
            }
          }
        }
        return true;
      }

      const failEmbed = new EmbedBuilder()
        .setColor(cfg.COLOR_ERROR || "#ED4245")
        .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
        .setTitle("❌ รับเงินโดเนทไม่สำเร็จ")
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: "👤 ผู้ส่ง", value: `<@${interaction.user.id}>`, inline: true },
          { name: "🔗 ลิงก์", value: `\`${link}\``, inline: false }
        )
        .setFooter({ text: "🧧 Donate System" })
        .setTimestamp();

      await interaction.reply({
        content: "ซองอั่งเปานี้ถูกใช้ไปแล้ว หรือลิงก์ไม่ถูกต้อง",
        ephemeral: true,
      });
      await sendDonateLog(interaction.client, failEmbed);
      return true;
    } catch (err) {
      logger.error(`[DONATE] ${err.message}`);
      await interaction.reply({
        content: "❌ เกิดข้อผิดพลาดในการรับเงิน กรุณาลองใหม่",
        ephemeral: true,
      });
      return true;
    }
  },
};
