const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const axios = require("axios");
const { ensureInit } = require("../utils/scriptFinderCore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("menuchekroblox")
    .setDescription("ตั้งเมนูเช็คโปรไฟล์ Roblox")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("channel").setDescription("ห้องที่จะส่งเมนู").setRequired(true)),

  async execute(interaction) {
    ensureInit(interaction.client);

    const channel = interaction.options.getChannel("channel");
    if (!channel.isTextBased()) return interaction.reply({ content: "❌ ต้องเป็นห้องข้อความ", flags: 64 });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("rb_open").setLabel("🔍 เช็คโปรไฟล์ Roblox").setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle("🔍 Roblox Profile Checker")
      .setDescription(
        "> 🔹 กรอก Username เพื่อเช็คโปรไฟล์\n" +
        "> 🔹 ดูยอดเพื่อน ผู้ติดตาม อายุบัญชี\n" +
        "> 🔹 กดปุ่มด้านล่างได้เลย"
      )
      .setImage("https://i.ibb.co/ymwYygcQ/bc0c64245baf831ea307270ac710133a-1.jpg")
      .setColor(0x2b2d31);

    await channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: `✅ ส่งเมนูไปยัง ${channel} แล้ว`, flags: 64 });
  },

  async showModal(interaction) {
    const modal = new ModalBuilder().setCustomId("rb_modal").setTitle("เช็คโปรไฟล์ Roblox");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("rb_name")
          .setLabel("Username")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("ใส่ Username Roblox")
      )
    );
    await interaction.showModal(modal);
  },

  async checkProfile(interaction, name) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const search = await axios.post("https://users.roproxy.com/v1/usernames/users", { usernames: [name] });
      const user   = search.data.data[0];
      if (!user) return interaction.editReply({ content: "❌ ไม่พบผู้ใช้นี้" });

      const id      = user.id;
      const profile = await axios.get(`https://users.roproxy.com/v1/users/${id}`);
      const friends = await axios.get(`https://friends.roproxy.com/v1/users/${id}/friends/count`);
      const follow  = await axios.get(`https://friends.roproxy.com/v1/users/${id}/followers/count`);

      const created  = new Date(profile.data.created);
      const diffDays = Math.floor((Date.now() - created) / 86400000);
      const avatar   = await axios.get(`https://thumbnails.roproxy.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png`);
      const avatarUrl = avatar.data.data[0]?.imageUrl || null;

      const embed = new EmbedBuilder()
        .setTitle(`👤 ${profile.data.name}`)
        .setDescription(
          `> 🆔 **ID:** ${id}\n` +
          `> 🏷️ **Display:** ${profile.data.displayName}\n` +
          `> 👥 **เพื่อน:** ${friends.data.count}\n` +
          `> 🌟 **ผู้ติดตาม:** ${follow.data.count}\n` +
          `> 📅 **สมัคร:** ${created.toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}\n` +
          `> ⏳ **อายุบัญชี:** ${diffDays} วัน\n` +
          `> 📝 **Bio:** ${profile.data.description?.slice(0, 150) || "ไม่มี"}`
        )
        .setThumbnail(avatarUrl)
        .setColor(0x2b2d31)
        .setFooter({ text: "Roblox Profile Checker" });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: "❌ ดึงข้อมูลไม่ได้" });
    }
  }
};
