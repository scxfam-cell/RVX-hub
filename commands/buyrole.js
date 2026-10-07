// ═══════════════════════════════════════════════════════════════
//  🛒  BUY ROLE SYSTEM  ·  TrueMoney Voucher + Auto Role
//  📌  Persistent Embed — Admin prefix !buyrole only
//  🖼️  v2: Total image limit (ไม่จำกัดต่อวัน นับรวมทั้งหมด)
// ═══════════════════════════════════════════════════════════════

const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
} = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ──────────────────────────────────────────────
//  ⚙️  CONFIG
// ──────────────────────────────────────────────
const TRUEMONEY_PHONE = process.env.TRUEMONEY_PHONE || "0983832640";
const IMAGE_ROLE_IDS = (process.env.IMAGE_ROLE_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const DB_PATH = process.env.BUYROLE_DB || "./data/buyrole.json";

// ──────────────────────────────────────────────
//  📦  PACKAGES
// ──────────────────────────────────────────────
const PACKAGES = {
  basic: { id: "basic", name: "🥉 Basic", price: 49,  days: 7,  totalImg: 14, description: "7 วัน | รวม 14 รูป" },
  pro:   { id: "pro",   name: "🥈 Pro",   price: 69,  days: 14, totalImg: 42, description: "14 วัน | รวม 42 รูป" },
  vip:   { id: "vip",   name: "🥇 VIP",   price: 109, days: 30, totalImg: 90, description: "30 วัน | รวม 90 รูป" },
};

// ──────────────────────────────────────────────
//  🗄️  DATABASE
// ──────────────────────────────────────────────
function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify({ purchases: {}, usedVouchers: [], shopMessage: null }));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { purchases: {}, usedVouchers: [], shopMessage: null };
  }
}

function saveDB(db) {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("BuyRole DB save error:", err.message);
  }
}

function isVoucherUsed(voucherCode) {
  return loadDB().usedVouchers.includes(voucherCode);
}

function savePurchase(userId, pkg, expireAt, voucherCode) {
  const db = loadDB();
  db.purchases[userId] = {
    package:  pkg.id,
    totalImg: pkg.totalImg,  // โควต้ารวมทั้งหมด
    usedImg:  0,             // นับสะสม
    expireAt,
    boughtAt: Date.now(),
  };
  db.usedVouchers.push(voucherCode);
  saveDB(db);
}

function getPurchase(userId) {
  return loadDB().purchases[userId] || null;
}

// ── นับรูปที่ใช้ไปแล้ว (บันทึกลง DB) ──
function addImageUsed(userId) {
  const db = loadDB();
  if (db.purchases[userId]) {
    db.purchases[userId].usedImg = (db.purchases[userId].usedImg || 0) + 1;
    saveDB(db);
  }
}

// ── คืนค่า { limit, used, isTotal } ──
function getImageLimitForUser(userId) {
  const purchase = getPurchase(userId);

  // ไม่มี package → ใช้ค่า default จาก .env (daily fallback)
  if (!purchase) {
    return {
      limit:   parseInt(process.env.IMAGE_DAILY_LIMIT || "10"),
      used:    0,
      isTotal: false,
    };
  }

  // package หมดอายุ
  if (!purchase.expireAt || Date.now() >= purchase.expireAt) {
    return { limit: 0, used: purchase.usedImg || 0, isTotal: true };
  }

  return {
    limit:   purchase.totalImg,
    used:    purchase.usedImg || 0,
    isTotal: true,
  };
}

// ──────────────────────────────────────────────
//  🎨  BUILD SHOP EMBED + SELECT MENU
// ──────────────────────────────────────────────
function buildShopEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("✨  ร้านค้า — ยศสร้างรูป AI")
    .setDescription(
      "```\nเลือก package ที่ต้องการจากเมนูด้านล่าง\nชำระด้วย TrueMoney Gift Voucher เท่านั้น\n```\n"
    )
    .addFields(
      {
        name:  "🥉  Basic  —  49 ฿",
        value: "```\n7 วัน  │  รวม 14 รูป\n```",
        inline: false,
      },
      {
        name:  "🥈  Pro  —  69 ฿",
        value: "```\n14 วัน  │  รวม 42 รูป\n```",
        inline: false,
      },
      {
        name:  "🥇  VIP  —  109 ฿",
        value: "```\n30 วัน  │  รวม 90 รูป\n```",
        inline: false,
      }
    )
    .setFooter({ text: "ยศจะถูกถอดอัตโนมัติเมื่อหมดอายุ • ราคารวม VAT แล้ว" })
    .setTimestamp();

  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("buyrole_select")
      .setPlaceholder("🛒  เลือก package ที่ต้องการ...")
      .addOptions([
        { label: "🥉 Basic — 49 ฿",  description: "7 วัน | รวม 14 รูป",  value: "basic" },
        { label: "🥈 Pro — 69 ฿",    description: "14 วัน | รวม 42 รูป", value: "pro"   },
        { label: "🥇 VIP — 109 ฿",   description: "30 วัน | รวม 90 รูป", value: "vip"   },
      ])
  );

  return { embeds: [embed], components: [select] };
}

// ──────────────────────────────────────────────
//  📌  PERSISTENT SHOP — restore on boot
// ──────────────────────────────────────────────
async function restoreShopMessage(client) {
  const db = loadDB();
  if (!db.shopMessage) return;

  const { channelId, messageId } = db.shopMessage;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) {
      db.shopMessage = null;
      saveDB(db);
      return;
    }
    await msg.edit(buildShopEmbed()).catch(() => {});
    console.log("[BuyRole] ✅ Restored shop message");
  } catch (err) {
    console.error("[BuyRole] restore error:", err.message);
  }
}

// ──────────────────────────────────────────────
//  💳  TRUEMONEY VOUCHER API
// ──────────────────────────────────────────────
async function redeemVoucher(voucherUrl) {
  try {
    let url = voucherUrl.trim();
    if (!url.startsWith("http")) url = `https://gift.truemoney.com/campaign/?v=${url}`;
    const hash = url.split("v=")[1];

    const res = await axios.post(
      `https://gift.truemoney.com/campaign/vouchers/${hash}/redeem`,
      { mobile: TRUEMONEY_PHONE, voucher_hash: hash },
      { headers: { "Content-Type": "application/json" } }
    );

    const data = res.data;
    if (data?.status?.code === "SUCCESS") {
      return { success: true, amount: parseFloat(data.data.voucher.redeemed_amount_baht), message: "สำเร็จ" };
    }
    return { success: false, amount: 0, message: data?.status?.message || "voucher ไม่ถูกต้อง" };
  } catch (err) {
    return { success: false, amount: 0, message: err.response?.data?.status?.message || err.message };
  }
}

// ──────────────────────────────────────────────
//  ⏰  AUTO REMOVE EXPIRED ROLES
// ──────────────────────────────────────────────
async function checkExpiredRoles(client) {
  const db = loadDB();
  const now = Date.now();

  for (const [userId, data] of Object.entries(db.purchases)) {
    if (data.expireAt && now >= data.expireAt) {
      for (const guild of client.guilds.cache.values()) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;
          for (const roleId of IMAGE_ROLE_IDS) {
            if (member.roles.cache.has(roleId)) {
              await member.roles.remove(roleId);
              await member.send(
                `⏰ **ยศหมดอายุแล้ว!**\nPackage **${data.package.toUpperCase()}** ของคุณหมดอายุแล้ว\nสามารถซื้อใหม่ได้ที่ร้านค้าในเซิร์ฟเวอร์ครับ`
              ).catch(() => {});
            }
          }
        } catch {}
      }
      delete db.purchases[userId];
    }
  }
  saveDB(db);
}

// ──────────────────────────────────────────────
//  📤  EXPORTS
// ──────────────────────────────────────────────
module.exports = {
  getImageLimitForUser,
  addImageUsed,
  getPurchase,

  // ─── เริ่ม timer + restore shop embed ───
  startExpiryChecker(client) {
    checkExpiredRoles(client);
    setInterval(() => checkExpiredRoles(client), 5 * 60 * 1000);
    restoreShopMessage(client);
  },

  // ─── dummy data สำหรับ auto-deploy ───
  data: { name: "buyrole", toJSON: () => null },

  // ─── !buyrole — admin prefix command ───
  async handleMessage(message) {
    if (message.author.bot) return;
    if (!message.content.trim().startsWith("!buyrole")) return;

    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.reply({ content: "❌ คำสั่งนี้ใช้ได้เฉพาะ Admin เท่านั้น", ephemeral: true }).catch(() => {});
      return;
    }

    await message.delete().catch(() => {});

    const db = loadDB();
    if (db.shopMessage) {
      try {
        const ch = await message.client.channels.fetch(db.shopMessage.channelId).catch(() => null);
        const old = await ch?.messages.fetch(db.shopMessage.messageId).catch(() => null);
        await old?.delete().catch(() => {});
      } catch {}
    }

    const sent = await message.channel.send(buildShopEmbed());
    db.shopMessage = { channelId: sent.channelId, messageId: sent.id };
    saveDB(db);
  },

  // ─── Handle Select Menu ───
  async handleSelect(interaction) {
    if (interaction.customId !== "buyrole_select") return false;

    const pkgId = interaction.values[0];
    const pkg = PACKAGES[pkgId];
    if (!pkg) return false;

    const modal = new ModalBuilder()
      .setCustomId(`buyrole_modal_${pkgId}`)
      .setTitle(`${pkg.name} — ${pkg.price} ฿`);

    const voucherInput = new TextInputBuilder()
      .setCustomId("voucher_code")
      .setLabel(`กรอก TrueMoney Voucher Code (${pkg.price} ฿)`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("https://gift.truemoney.com/campaign/?v=XXXXXXXX หรือ code")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(voucherInput));
    await interaction.showModal(modal);
    return true;
  },

  // ─── Handle Modal Submit ───
  async handleModal(interaction) {
    if (!interaction.customId.startsWith("buyrole_modal_")) return false;

    const pkgId = interaction.customId.replace("buyrole_modal_", "");
    const pkg = PACKAGES[pkgId];
    if (!pkg) return false;

    await interaction.deferReply({ ephemeral: true });

    const voucherCode = interaction.fields.getTextInputValue("voucher_code").trim();

    if (isVoucherUsed(voucherCode)) {
      await interaction.editReply("❌ **Voucher นี้ถูกใช้ไปแล้ว** กรุณาใช้ voucher ใหม่ครับ");
      return true;
    }

    await interaction.editReply("⏳ กำลังตรวจสอบ voucher...");
    const result = await redeemVoucher(voucherCode);

    if (!result.success) {
      await interaction.editReply(`❌ **Voucher ไม่ถูกต้อง**\n${result.message}`);
      return true;
    }

    if (result.amount < pkg.price) {
      await interaction.editReply(
        `❌ **จำนวนเงินไม่ถูกต้อง**\nVoucher มีมูลค่า **${result.amount} ฿** แต่ package นี้ต้องการ **${pkg.price} ฿**`
      );
      return true;
    }

    const member = interaction.member;
    const expireAt = Date.now() + pkg.days * 24 * 60 * 60 * 1000;
    let roleGiven = false;

    for (const roleId of IMAGE_ROLE_IDS) {
      try {
        const role = interaction.guild.roles.cache.get(roleId);
        if (role) { await member.roles.add(role); roleGiven = true; }
      } catch (err) {
        console.error("BuyRole add role error:", err.message);
      }
    }

    if (!roleGiven) {
      await interaction.editReply("⚠️ ได้รับเงินแล้วแต่ให้ยศไม่ได้ กรุณาติดต่อ admin ครับ");
      return true;
    }

    savePurchase(interaction.user.id, pkg, expireAt, voucherCode);

    const expireDate = new Date(expireAt).toLocaleDateString("th-TH", {
      timeZone: "Asia/Bangkok",
      dateStyle: "full",
    });

    const successEmbed = new EmbedBuilder()
      .setTitle(`✅ ซื้อสำเร็จ! ${pkg.name}`)
      .addFields(
        { name: "💰 ชำระเงิน",     value: `${result.amount} ฿`, inline: true },
        { name: "📅 หมดอายุ",      value: expireDate,             inline: true },
        { name: "🖼️ รูปทั้งหมด",  value: `${pkg.totalImg} รูป`, inline: true },
      )
      .setDescription("ได้รับยศแล้ว! พิมพ์ **วาดรูป [คำอธิบาย]** ในช่อง AI ได้เลยครับ 🎨")
      .setFooter({ text: "ยศจะถูกถอดอัตโนมัติเมื่อหมดอายุ" });

    await interaction.editReply({ content: "", embeds: [successEmbed] });
    return true;
  },
};