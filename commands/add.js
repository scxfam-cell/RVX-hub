const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js");
const { ensureInit } = require("../utils/scriptFinderCore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("add")
    .setDescription("เพิ่มสคริปต์ของคุณในรายการ >thai"),

  async execute(interaction) {
    ensureInit(interaction.client);

    const modal = new ModalBuilder()
      .setCustomId("add_script_modal")
      .setTitle("เพิ่มสคริปต์คนไทย");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("add_title")
          .setLabel("ชื่อสคริปต์")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("เช่น Blox Fruit Auto Farm")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("add_game")
          .setLabel("ชื่อแมพ")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("เช่น Blox Fruits")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("add_key")
          .setLabel("มีคีย์ไหม? (yes / no)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue("no")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("add_desc")
          .setLabel("คำอธิบาย")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("บอกคร่าวๆ ว่าสคริปต์ทำอะไร")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("add_script")
          .setLabel("สคริปต์")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("loadstring(game:HttpGet(...))()")
      )
    );

    await interaction.showModal(modal);
  }
};
