const { SlashCommandBuilder } = require("discord.js");
const { ensureInit, handleFindCommand } = require("../utils/scriptFinderCore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("find")
    .setDescription("ค้นหาสคริปต์ Roblox จาก ScriptBlox")
    .addStringOption((o) =>
      o.setName("ชื่อแมพ")
        .setDescription("ชื่อเกม/แมพที่ต้องการค้นหา")
        .setRequired(true)
    ),

  async execute(interaction) {
    ensureInit(interaction.client);
    const query = interaction.options.getString("ชื่อแมพ");
    await handleFindCommand(interaction, query);
  }
};
