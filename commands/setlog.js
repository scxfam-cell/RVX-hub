const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { ensureInit, handleSetLogCommand } = require("../utils/scriptFinderCore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("ตั้งห้องที่อนุญาตให้ใช้คำสั่งค้นหาสคริปต์ (แอดมินเท่านั้น)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("ห้องที่จะล็อกไว้ใช้ค้นหาสคริปต์")
        .setRequired(true)
    ),

  async execute(interaction) {
    ensureInit(interaction.client);
    const channel = interaction.options.getChannel("channel");
    await handleSetLogCommand(interaction, channel);
  }
};
