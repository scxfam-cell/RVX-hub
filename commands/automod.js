// ═══════════════════════════════════════════════════════════════
//  🛡️  /automod  —  ศูนย์รวมตั้งค่าระบบป้องกัน (เฉพาะแอดมิน)
//  setup · status · antispam · antilink · antiemoji · antiimage
//  antibotinvite · strikes
// ═══════════════════════════════════════════════════════════════

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const store = require("../utils/automod/store");

// ── ตัวช่วย: เพิ่ม option ยกเว้นห้อง/ผู้ใช้-บอท ให้ subcommand "exempt" ──
function withExemptOptions(sub) {
  return sub
    .addStringOption((o) =>
      o.setName("การกระทำ").setDescription("เพิ่มหรือลบการยกเว้น").setRequired(true)
        .addChoices({ name: "เพิ่ม", value: "add" }, { name: "ลบ", value: "remove" })
    )
    .addChannelOption((o) =>
      o.setName("ห้อง").setDescription("ห้องที่จะยกเว้น (ถ้ามี)").setRequired(false)
    )
    .addUserOption((o) =>
      o.setName("ผู้ใช้หรือบอท").setDescription("ผู้ใช้/บอทที่จะยกเว้น (ถ้ามี)").setRequired(false)
    );
}

// ── ตัวช่วย: ประมวลผล subcommand "exempt" แบบเดียวกันทุกระบบ ──
function handleExempt(interaction, sysConfig) {
  const action  = interaction.options.getString("การกระทำ");
  const channel = interaction.options.getChannel("ห้อง");
  const user    = interaction.options.getUser("ผู้ใช้หรือบอท");

  if (!channel && !user) return "❌ ต้องระบุห้อง หรือ ผู้ใช้/บอท อย่างน้อย 1 อย่างครับ";

  const results = [];
  if (channel) {
    if (action === "add") {
      if (!sysConfig.exemptChannels.includes(channel.id)) sysConfig.exemptChannels.push(channel.id);
      results.push(`ยกเว้นห้อง ${channel} แล้ว`);
    } else {
      sysConfig.exemptChannels = sysConfig.exemptChannels.filter((id) => id !== channel.id);
      results.push(`เอาห้อง ${channel} ออกจากรายการยกเว้นแล้ว`);
    }
  }
  if (user) {
    const label = user.bot ? "บอท" : "ผู้ใช้";
    if (action === "add") {
      if (!sysConfig.exemptUsers.includes(user.id)) sysConfig.exemptUsers.push(user.id);
      results.push(`ยกเว้น${label} ${user} แล้ว`);
    } else {
      sysConfig.exemptUsers = sysConfig.exemptUsers.filter((id) => id !== user.id);
      results.push(`เอา${label} ${user} ออกจากรายการยกเว้นแล้ว`);
    }
  }
  store.save();
  return `✅ ${results.join(" และ ")}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("automod")
    .setDescription("ระบบป้องกันสแปม/ลิงก์/บอทแปลก (แอดมินเท่านั้น)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand((s) => s.setName("setup").setDescription("สร้างห้องแจ้งเตือน automod อัตโนมัติ"))
    .addSubcommand((s) => s.setName("status").setDescription("ดูสถานะการตั้งค่าทั้งหมด"))

    .addSubcommandGroup((g) => g.setName("antispam").setDescription("กันสแปมข้อความถี่")
      .addSubcommand((s) => s.setName("config").setDescription("ตั้งค่าระบบ")
        .addBooleanOption((o) => o.setName("เปิดใช้งาน").setDescription("เปิด/ปิดระบบ").setRequired(false))
        .addIntegerOption((o) => o.setName("จำนวนข้อความ").setDescription("จำนวนข้อความสูงสุดต่อช่วงเวลา").setRequired(false).setMinValue(2).setMaxValue(50))
        .addIntegerOption((o) => o.setName("วินาที").setDescription("ช่วงเวลาเป็นวินาที").setRequired(false).setMinValue(2).setMaxValue(120))
      )
      .addSubcommand((s) => withExemptOptions(s.setName("exempt").setDescription("ยกเว้นห้อง/ผู้ใช้/บอท")))
    )

    .addSubcommandGroup((g) => g.setName("antilink").setDescription("กันลิงก์ต้องห้าม")
      .addSubcommand((s) => s.setName("set").setDescription("ตั้งระดับการกันลิงก์")
        .addIntegerOption((o) =>
          o.setName("ระดับ").setDescription("ระดับการกันลิงก์").setRequired(true)
            .addChoices(
              { name: "0 - ปิด", value: 0 },
              { name: "1 - กันเฉพาะลิงก์คำเชิญ Discord อื่น", value: 1 },
              { name: "2 - กันลิงก์คำเชิญ + ลิงก์ไวรัส/หลอกลวง", value: 2 },
              { name: "3 - กันทุกลิงก์", value: 3 },
            )
        )
        .addChannelOption((o) => o.setName("ห้อง").setDescription("ถ้าไม่ระบุ = ตั้งเป็นค่าเริ่มต้นทั้งเซิร์ฟเวอร์").setRequired(false))
      )
      .addSubcommand((s) => withExemptOptions(s.setName("exempt").setDescription("ยกเว้นห้อง/ผู้ใช้/บอท")))
    )

    .addSubcommandGroup((g) => g.setName("antiemoji").setDescription("กันสแปมอีโมจิ")
      .addSubcommand((s) => s.setName("config").setDescription("ตั้งค่าระบบ")
        .addBooleanOption((o) => o.setName("เปิดใช้งาน").setDescription("เปิด/ปิดระบบ").setRequired(false))
        .addIntegerOption((o) => o.setName("จำนวนสูงสุด").setDescription("จำนวนอีโมจิสูงสุดต่อข้อความ").setRequired(false).setMinValue(1).setMaxValue(100))
      )
      .addSubcommand((s) => withExemptOptions(s.setName("exempt").setDescription("ยกเว้นห้อง/ผู้ใช้/บอท")))
    )

    .addSubcommandGroup((g) => g.setName("antiimage").setDescription("กันสแปมรูปภาพ")
      .addSubcommand((s) => s.setName("config").setDescription("ตั้งค่าระบบ")
        .addBooleanOption((o) => o.setName("เปิดใช้งาน").setDescription("เปิด/ปิดระบบ").setRequired(false))
        .addIntegerOption((o) => o.setName("จำนวนรูป").setDescription("จำนวนรูปสูงสุดต่อช่วงเวลา").setRequired(false).setMinValue(2).setMaxValue(50))
        .addIntegerOption((o) => o.setName("วินาที").setDescription("ช่วงเวลาเป็นวินาที").setRequired(false).setMinValue(2).setMaxValue(120))
      )
      .addSubcommand((s) => withExemptOptions(s.setName("exempt").setDescription("ยกเว้นห้อง/ผู้ใช้/บอท")))
    )

    .addSubcommandGroup((g) => g.setName("antibotinvite").setDescription("กันแอดมินเชิญบอทแปลกเข้ามา")
      .addSubcommand((s) => s.setName("config").setDescription("ตั้งค่าระบบ")
        .addBooleanOption((o) => o.setName("เปิดใช้งาน").setDescription("เปิด/ปิดระบบ").setRequired(false))
      )
      .addSubcommand((s) => s.setName("exempt").setDescription("ยกเว้นแอดมิน(เชิญบอทได้อิสระ) หรือยกเว้นบอทตัวใดตัวหนึ่ง")
        .addStringOption((o) =>
          o.setName("การกระทำ").setDescription("เพิ่มหรือลบการยกเว้น").setRequired(true)
            .addChoices({ name: "เพิ่ม", value: "add" }, { name: "ลบ", value: "remove" })
        )
        .addUserOption((o) => o.setName("ผู้ใช้หรือบอท").setDescription("แอดมินหรือบอทที่จะยกเว้น").setRequired(true))
      )
    )

    .addSubcommandGroup((g) => g.setName("strikes").setDescription("ตั้งเกณฑ์การลงโทษสะสม")
      .addSubcommand((s) => s.setName("config").setDescription("ตั้งเกณฑ์จำนวนครั้ง")
        .addIntegerOption((o) => o.setName("timeout_ที่ครั้ง").setDescription("ครบกี่ครั้งเริ่ม timeout").setRequired(false).setMinValue(1))
        .addIntegerOption((o) => o.setName("เตะ_ที่ครั้ง").setDescription("ครบกี่ครั้งเตะออก").setRequired(false).setMinValue(1))
        .addIntegerOption((o) => o.setName("แบน_ที่ครั้ง").setDescription("ครบกี่ครั้งแบน").setRequired(false).setMinValue(1))
        .addIntegerOption((o) => o.setName("timeout_นาที").setDescription("timeout กี่นาที").setRequired(false).setMinValue(1).setMaxValue(40320))
      )
      .addSubcommand((s) => s.setName("reset").setDescription("ล้างจำนวนครั้งที่ทำผิดของคนคนหนึ่ง")
        .addUserOption((o) => o.setName("ผู้ใช้").setDescription("ผู้ใช้ที่จะล้างสถิติ").setRequired(true))
      )
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    const cfg = store.getGuildConfig(guild.id);
    const group = interaction.options.getSubcommandGroup(false);
    const sub   = interaction.options.getSubcommand();

    // ── /automod setup ──
    if (!group && sub === "setup") {
      let channel = cfg.logChannelId ? guild.channels.cache.get(cfg.logChannelId) : null;
      if (!channel) {
        try {
          channel = await guild.channels.create({
            name: "🛡️-automod-log",
            type: ChannelType.GuildText,
            topic: "ห้องแจ้งเตือนของระบบ Automod (สแปม/ลิงก์/บอทแปลก) — ห้ามลบ",
            permissionOverwrites: [
              { id: guild.roles.everyone, deny: [PermissionFlagsBits.SendMessages] },
            ],
          });
          cfg.logChannelId = channel.id;
          store.save();
        } catch (err) {
          await interaction.reply({ content: `❌ สร้างห้องไม่สำเร็จ: ${err.message}`, ephemeral: true });
          return;
        }
      }
      await interaction.reply({ content: `✅ ตั้งห้องแจ้งเตือน automod เป็น ${channel} เรียบร้อยครับ`, ephemeral: true });
      return;
    }

    // ── /automod status ──
    if (!group && sub === "status") {
      const s = cfg.systems;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🛡️ สถานะระบบ Automod")
        .addFields(
          { name: "📋 ห้อง Log", value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : "*(ยังไม่ได้ตั้ง — ใช้ /automod setup)*" },
          { name: "💬 Anti-Spam", value: `${s.antispam.enabled ? "🟢 เปิด" : "🔴 ปิด"} · ${s.antispam.messageLimit} ข้อความ/${s.antispam.intervalSeconds}วิ · ยกเว้นห้อง ${s.antispam.exemptChannels.length} · ยกเว้นคน ${s.antispam.exemptUsers.length}` },
          { name: "🔗 Anti-Link", value: `${s.antilink.enabled ? "🟢 เปิด" : "🔴 ปิด"} · ระดับเริ่มต้น ${s.antilink.defaultLevel} · ห้องตั้งเฉพาะ ${Object.keys(s.antilink.channelLevels).length} · ยกเว้นคน ${s.antilink.exemptUsers.length}` },
          { name: "😂 Anti-Emoji", value: `${s.antiemoji.enabled ? "🟢 เปิด" : "🔴 ปิด"} · สูงสุด ${s.antiemoji.limit} ตัว/ข้อความ · ยกเว้นคน ${s.antiemoji.exemptUsers.length}` },
          { name: "🖼️ Anti-Image", value: `${s.antiimage.enabled ? "🟢 เปิด" : "🔴 ปิด"} · ${s.antiimage.imageLimit} รูป/${s.antiimage.intervalSeconds}วิ · ยกเว้นคน ${s.antiimage.exemptUsers.length}` },
          { name: "🤖 Anti-Bot-Invite", value: `${s.antibotinvite.enabled ? "🟢 เปิด" : "🔴 ปิด"} · ยกเว้น ${s.antibotinvite.exemptUsers.length} คน/บอท` },
          { name: "⚖️ เกณฑ์ลงโทษสะสม", value: `Timeout ที่ครั้ง ${cfg.strikeConfig.timeoutAt} (${cfg.strikeConfig.timeoutMinutes} นาที) · เตะที่ครั้ง ${cfg.strikeConfig.kickAt} · แบนที่ครั้ง ${cfg.strikeConfig.banAt}` },
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // ── antispam / antiemoji / antiimage: config + exempt รูปแบบเดียวกัน ──
    if (group === "antispam") {
      const s = cfg.systems.antispam;
      if (sub === "config") {
        const en  = interaction.options.getBoolean("เปิดใช้งาน");
        const lim = interaction.options.getInteger("จำนวนข้อความ");
        const sec = interaction.options.getInteger("วินาที");
        if (en !== null)  s.enabled = en;
        if (lim !== null) s.messageLimit = lim;
        if (sec !== null) s.intervalSeconds = sec;
        store.save();
        await interaction.reply({ content: `✅ ตั้งค่า Anti-Spam แล้ว (${s.enabled ? "เปิด" : "ปิด"} · ${s.messageLimit} ข้อความ/${s.intervalSeconds}วิ)`, ephemeral: true });
      } else {
        await interaction.reply({ content: handleExempt(interaction, s), ephemeral: true });
      }
      return;
    }

    if (group === "antiemoji") {
      const s = cfg.systems.antiemoji;
      if (sub === "config") {
        const en  = interaction.options.getBoolean("เปิดใช้งาน");
        const lim = interaction.options.getInteger("จำนวนสูงสุด");
        if (en !== null)  s.enabled = en;
        if (lim !== null) s.limit = lim;
        store.save();
        await interaction.reply({ content: `✅ ตั้งค่า Anti-Emoji แล้ว (${s.enabled ? "เปิด" : "ปิด"} · สูงสุด ${s.limit} ตัว/ข้อความ)`, ephemeral: true });
      } else {
        await interaction.reply({ content: handleExempt(interaction, s), ephemeral: true });
      }
      return;
    }

    if (group === "antiimage") {
      const s = cfg.systems.antiimage;
      if (sub === "config") {
        const en  = interaction.options.getBoolean("เปิดใช้งาน");
        const lim = interaction.options.getInteger("จำนวนรูป");
        const sec = interaction.options.getInteger("วินาที");
        if (en !== null)  s.enabled = en;
        if (lim !== null) s.imageLimit = lim;
        if (sec !== null) s.intervalSeconds = sec;
        store.save();
        await interaction.reply({ content: `✅ ตั้งค่า Anti-Image แล้ว (${s.enabled ? "เปิด" : "ปิด"} · ${s.imageLimit} รูป/${s.intervalSeconds}วิ)`, ephemeral: true });
      } else {
        await interaction.reply({ content: handleExempt(interaction, s), ephemeral: true });
      }
      return;
    }

    // ── antilink ──
    if (group === "antilink") {
      const s = cfg.systems.antilink;
      if (sub === "set") {
        const level   = interaction.options.getInteger("ระดับ");
        const channel = interaction.options.getChannel("ห้อง");
        if (level > 0) s.enabled = true;
        if (channel) {
          s.channelLevels[channel.id] = level;
        } else {
          s.defaultLevel = level;
        }
        store.save();
        await interaction.reply({
          content: channel
            ? `✅ ตั้งระดับกันลิงก์ห้อง ${channel} เป็นระดับ ${level} แล้ว`
            : `✅ ตั้งระดับกันลิงก์เริ่มต้นทั้งเซิร์ฟเวอร์เป็นระดับ ${level} แล้ว`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({ content: handleExempt(interaction, s), ephemeral: true });
      }
      return;
    }

    // ── antibotinvite ──
    if (group === "antibotinvite") {
      const s = cfg.systems.antibotinvite;
      if (sub === "config") {
        const en = interaction.options.getBoolean("เปิดใช้งาน");
        if (en !== null) s.enabled = en;
        store.save();
        await interaction.reply({ content: `✅ Anti-Bot-Invite: ${s.enabled ? "🟢 เปิด" : "🔴 ปิด"}`, ephemeral: true });
      } else {
        const action = interaction.options.getString("การกระทำ");
        const user   = interaction.options.getUser("ผู้ใช้หรือบอท");
        if (action === "add") {
          if (!s.exemptUsers.includes(user.id)) s.exemptUsers.push(user.id);
        } else {
          s.exemptUsers = s.exemptUsers.filter((id) => id !== user.id);
        }
        store.save();
        await interaction.reply({ content: `✅ ${action === "add" ? "ยกเว้น" : "เอาออกจากยกเว้น"} ${user} แล้ว`, ephemeral: true });
      }
      return;
    }

    // ── strikes ──
    if (group === "strikes") {
      if (sub === "config") {
        const t = interaction.options.getInteger("timeout_ที่ครั้ง");
        const k = interaction.options.getInteger("เตะ_ที่ครั้ง");
        const b = interaction.options.getInteger("แบน_ที่ครั้ง");
        const m = interaction.options.getInteger("timeout_นาที");
        if (t !== null) cfg.strikeConfig.timeoutAt = t;
        if (k !== null) cfg.strikeConfig.kickAt = k;
        if (b !== null) cfg.strikeConfig.banAt = b;
        if (m !== null) cfg.strikeConfig.timeoutMinutes = m;
        store.save();
        await interaction.reply({
          content: `✅ ตั้งเกณฑ์ลงโทษแล้ว (timeout: ${cfg.strikeConfig.timeoutAt} · เตะ: ${cfg.strikeConfig.kickAt} · แบน: ${cfg.strikeConfig.banAt} · timeout ${cfg.strikeConfig.timeoutMinutes} นาที)`,
          ephemeral: true,
        });
      } else {
        const user = interaction.options.getUser("ผู้ใช้");
        delete cfg.strikes[user.id];
        store.save();
        await interaction.reply({ content: `✅ ล้างสถิติของ ${user} แล้ว`, ephemeral: true });
      }
      return;
    }
  },
};
