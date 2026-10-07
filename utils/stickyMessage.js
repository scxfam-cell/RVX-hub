const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const dataPath = path.join(__dirname, '..', 'data', 'pinnedMessage.json');

// โครงสร้างใหม่: เก็บเป็น map แยกตาม channelId
// { "1234567890": { messageId, content, image }, "9876543210": {...} }

function getAllStickyData() {
    if (!fs.existsSync(dataPath)) return {};
    try {
        const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        // เผื่อเจอไฟล์รูปแบบเก่า (object เดียว ไม่ได้แยกห้อง) ให้ migrate ทิ้งไปเลย
        if (raw && typeof raw === 'object' && ('content' in raw || 'messageId' in raw)) {
            return {};
        }
        return raw || {};
    } catch (e) {
        return {};
    }
}

function saveAllStickyData(all) {
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dataPath, JSON.stringify(all, null, 2));
}

function getStickyData(channelId) {
    const all = getAllStickyData();
    return all[channelId] || { messageId: null, content: null, image: null, style: 'embed' };
}

// style: 'embed' (มีกรอบ) หรือ 'plain' (ข้อความธรรมดา ไม่มีกรอบ)
function saveStickyData(channelId, id, content, image, style = 'embed') {
    const all = getAllStickyData();
    const prev = all[channelId] || {};
    all[channelId] = {
        messageId: id,
        content: content,
        image: image,
        style: style || prev.style || 'embed'
    };
    saveAllStickyData(all);
}

function removeStickyData(channelId) {
    const all = getAllStickyData();
    delete all[channelId];
    saveAllStickyData(all);
}

async function handleStickyMessage(message) {
    if (message.author.bot) return;

    const channelId = message.channel.id;
    let data = getStickyData(channelId);
    if (!data.content) return; // ห้องนี้ไม่ได้ตั้งค่า sticky message ไว้

    try {
        // 1. ลบข้อความเก่าของบอทในห้องนี้
        if (data.messageId) {
            try {
                const oldMsg = await message.channel.messages.fetch(data.messageId);
                if (oldMsg) await oldMsg.delete();
            } catch (err) {}
        }

        let newMsg;

        if (data.style === 'plain') {
            // ส่งเป็นข้อความธรรมดา ไม่มีกรอบ ไม่มี footer/โปรไฟล์เล็ก ๆ
            let plainContent = data.content;
            if (data.image && data.image.startsWith('http')) {
                plainContent += `\n${data.image}`;
            }
            newMsg = await message.channel.send({ content: plainContent });

        } else if (data.style === 'v2') {
            // 🆕 UI V2 (Components V2) — กล่องเนียน ๆ ไม่มีเส้นสีข้าง
            const containerComponents = [
                { type: 10, content: data.content } // Text Display
            ];

            if (data.image && data.image.startsWith('http')) {
                containerComponents.push({
                    type: 12, // Media Gallery
                    items: [{ media: { url: data.image } }]
                });
            }

            newMsg = await message.channel.send({
                flags: 1 << 15, // MessageFlags.IsComponentsV2
                components: [
                    { type: 17, components: containerComponents } // Container
                ]
            });

        } else {
            // ส่งเป็น Embed (มีกรอบ) — ไม่มี footer และไม่มี timestamp แล้ว
            const stickyEmbed = new EmbedBuilder()
                .setColor(0x00fbff)
                .setDescription(data.content);

            if (data.image && data.image.startsWith('http')) {
                stickyEmbed.setImage(data.image);
            }

            newMsg = await message.channel.send({ embeds: [stickyEmbed] });
        }

        // 2. บันทึก messageId ใหม่ (เฉพาะห้องนี้)
        saveStickyData(channelId, newMsg.id, data.content, data.image, data.style);

    } catch (error) {
        console.error(`เกิดข้อผิดพลาดในระบบ Sticky Message (ห้อง ${channelId}):`, error);
    }
}

module.exports = {
    handleStickyMessage,
    saveStickyData,
    getStickyData,
    removeStickyData,
    getAllStickyData
};
