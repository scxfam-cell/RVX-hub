const { SlashCommandBuilder } = require("discord.js");
const { ensureInit, handleThaiCommand } = require("../utils/scriptFinderCore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("thai")
    .setDescription("ดูรายการสคริปต์คนไทยที่แชร์ไว้ในระบบ"),

  async execute(interaction) {
    ensureInit(interaction.client);
    await handleThaiCommand(interaction);
  }
};
