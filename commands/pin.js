const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { saveStickyData, removeStickyData } = require('../utils/stickyMessage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pin')
        .setDescription('📌 ตั้งค่าข้อความปักหมุดล่างสุดอัตโนมัติ (Sticky Message) ในห้องนี้')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('message')
                .setDescription('ใส่เนื้อหาข้อความแผงบอร์ด (ใช้ \\n เพื่อขึ้นบรรทัดใหม่ได้) หรือพิมพ์ "off" เพื่อปิด')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('image_url')
                .setDescription('🔗 วางลิงก์รูปภาพแบนเนอร์ที่ต้องการแสดงด้านล่าง (ถ้ามี)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('style')
                .setDescription('รูปแบบการแสดงผล: มีกรอบ (embed) หรือข้อความธรรมดา')
                .setRequired(false)
                .addChoices(
                    { name: '📦 มีกรอบ (Embed)', value: 'embed' },
                    { name: '💬 ข้อความธรรมดา (ไม่มีกรอบ)', value: 'plain' },
                    { name: '🆕 UI V2 (กล่องใหม่ ไม่มีเส้นสีข้าง)', value: 'v2' }
                )
        ),

    async execute(interaction) {
        const rawContent = interaction.options.getString('message');
        const imageUrl = interaction.options.getString('image_url') || null;
        const style = interaction.options.getString('style') || 'embed';
        const channelId = interaction.channel.id;

        // พิมพ์ "off" เพื่อปิดระบบ sticky message เฉพาะห้องนี้
        if (rawContent.trim().toLowerCase() === 'off') {
            removeStickyData(channelId);
            const offEmbed = new EmbedBuilder()
                .setColor(0xff5555)
                .setTitle('🛑 ปิดระบบปักหมุดในห้องนี้แล้ว')
                .setDescription(`ปิดการทำงานของ sticky message สำหรับห้อง <#${channelId}> เรียบร้อยครับ`)
                .setTimestamp();
            return interaction.reply({ embeds: [offEmbed], ephemeral: true });
        }

        const formattedContent = rawContent.replace(/\\n/g, '\n');

        // บันทึกข้อมูลแยกตามห้องที่ใช้คำสั่งนี้อยู่
        saveStickyData(channelId, null, formattedContent, imageUrl, style);

        const styleLabel = style === 'plain'
            ? '💬 ข้อความธรรมดา (ไม่มีกรอบ)'
            : style === 'v2'
                ? '🆕 UI V2 (กล่องใหม่ ไม่มีเส้นสีข้าง)'
                : '📦 มีกรอบ (Embed)';

        const successEmbed = new EmbedBuilder()
            .setColor(0x00ff7b)
            .setTitle('✅ ตั้งค่าระบบปักหมุดเรียบร้อยแล้ว!')
            .setDescription(`ตั้งค่า sticky message สำหรับห้อง <#${channelId}> เรียบร้อยแล้ว\nรูปแบบ: ${styleLabel}\n\nกรุณาพิมพ์อะไรก็ได้ในห้องนี้ 1 ข้อความเพื่อเปิดใช้งานทันทีครับ`)
            .setTimestamp();

        return interaction.reply({ embeds: [successEmbed], ephemeral: true });
    }
};
