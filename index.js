// index.js - Discord Bot with Role Check and User-Specific Keys
import { Client, GatewayIntentBits, Events, EmbedBuilder } from "discord.js";
import express from "express";
import fs from "fs";
import crypto from "crypto";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

// ============================================
// CONFIGURATION
// ============================================
const REQUIRED_ROLE_ID = "YOUR_ROLE_ID_HERE"; // Replace with your role ID
const ADMIN_ID = "YOUR_DISCORD_ID_HERE"; // Replace with your Discord ID
const DB_PATH = "./database.json";

// ============================================
// DATABASE HANDLING
// ============================================
function loadDatabase() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, keys: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDatabase(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateKey() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let key = "BLUSH-";
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 3) key += "-";
    }
    return key;
}

function hasRequiredRole(member) {
    if (!member) return false;
    return member.roles.cache.has(REQUIRED_ROLE_ID);
}

// ============================================
// DISCORD BOT COMMANDS
// ============================================

client.once(Events.ClientReady, () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`📊 Database loaded from ${DB_PATH}`);
    console.log(`🔒 Required Role ID: ${REQUIRED_ROLE_ID}`);
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith("!")) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const db = loadDatabase();

    // ============================================
    // ROLE CHECK (except for help)
    // ============================================
    if (command !== "help") {
        const member = message.guild?.members.cache.get(message.author.id);
        if (!hasRequiredRole(member)) {
            return message.reply(`❌ You need the <@&${REQUIRED_ROLE_ID}> role to use this command.`);
        }
    }

    // ============================================
    // !create account <username>
    // ============================================
    if (command === "create" && args[0] === "account") {
        const username = args[1];
        if (!username) {
            return message.reply("❌ Usage: `!create account <username>`");
        }

        if (db.users[message.author.id]) {
            return message.reply("❌ You already have an account! Use `!account information` to view it.");
        }

        const newKey = generateKey();
        db.users[message.author.id] = {
            username: username,
            discordId: message.author.id,
            discordTag: message.author.tag,
            key: newKey,
            hwid: null,
            created: new Date().toISOString(),
            expires: null,
            maxUses: 5,
            used: 0,
            active: true
        };

        db.keys[newKey] = {
            owner: message.author.id,
            username: username,
            created: new Date().toISOString(),
            expires: null,
            maxUses: 5,
            used: 0,
            active: true,
            hwid: null
        };

        saveDatabase(db);

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle("✅ Account Created Successfully!")
            .setDescription(`Welcome **${username}**!`)
            .addFields(
                { name: "🔑 Your Key", value: `\`${newKey}\``, inline: false },
                { name: "📅 Created", value: new Date().toISOString().split("T")[0], inline: true },
                { name: "🔄 Max Uses", value: "5", inline: true },
                { name: "📌 Instructions", value: "Keep your key safe! Use `!account information` to view your details." }
            )
            .setFooter({ text: "Do not share your key with anyone!" });

        await message.reply({ embeds: [embed] });
        return;
    }

    // ============================================
    // !account information
    // ============================================
    if (command === "account" && args[0] === "information") {
        const userData = db.users[message.author.id];
        if (!userData) {
            return message.reply("❌ You don't have an account. Use `!create account <username>` to create one.");
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle("📋 Account Information")
            .addFields(
                { name: "👤 Username", value: userData.username, inline: true },
                { name: "🔑 Key", value: `\`${userData.key}\``, inline: true },
                { name: "📅 Created", value: new Date(userData.created).toISOString().split("T")[0], inline: true },
                { name: "🔄 Used", value: `${userData.used}/${userData.maxUses}`, inline: true },
                { name: "💻 HWID", value: userData.hwid || "Not set", inline: true },
                { name: "📌 Status", value: userData.active ? "✅ Active" : "❌ Inactive", inline: true },
                { name: "⏰ Expires", value: userData.expires ? new Date(userData.expires).toISOString().split("T")[0] : "Never", inline: true }
            )
            .setFooter({ text: "Use !reset hwid to reset your HWID" });

        await message.reply({ embeds: [embed] });
        return;
    }

    // ============================================
    // !reset hwid
    // ============================================
    if (command === "reset" && args[0] === "hwid") {
        const userData = db.users[message.author.id];
        if (!userData) {
            return message.reply("❌ You don't have an account.");
        }

        userData.hwid = null;
        if (db.keys[userData.key]) {
            db.keys[userData.key].hwid = null;
        }
        saveDatabase(db);

        await message.reply("✅ Your HWID has been reset. You can now use your key on a new device.");
        return;
    }

    // ============================================
    // !get key
    // ============================================
    if (command === "get" && args[0] === "key") {
        const userData = db.users[message.author.id];
        if (!userData) {
            return message.reply("❌ You don't have an account. Use `!create account <username>` first.");
        }

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle("🔑 Your Key")
            .setDescription(`\`${userData.key}\``)
            .addFields(
                { name: "📌 Usage", value: `${userData.used}/${userData.maxUses} uses remaining`, inline: true },
                { name: "💻 HWID", value: userData.hwid || "Not set", inline: true }
            )
            .setFooter({ text: "Keep this key private! Do not share it." });

        await message.reply({ embeds: [embed] });
        return;
    }

    // ============================================
    // !renew key <key> <days> (admin only)
    // ============================================
    if (command === "renew" && args[0] === "key") {
        if (message.author.id !== ADMIN_ID) {
            return message.reply("❌ You don't have permission to use this command.");
        }

        const targetKey = args[1];
        if (!targetKey) {
            return message.reply("❌ Usage: `!renew key <key> <days>`");
        }

        const days = parseInt(args[2]) || 30;
        const keyData = db.keys[targetKey];
        if (!keyData) {
            return message.reply("❌ Key not found.");
        }

        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + days);
        keyData.expires = newExpiry.toISOString();

        const userData = db.users[keyData.owner];
        if (userData) {
            userData.expires = keyData.expires;
        }

        saveDatabase(db);
        await message.reply(`✅ Key \`${targetKey}\` renewed for ${days} days.`);
        return;
    }

    // ============================================
    // !revoke <key> (admin only)
    // ============================================
    if (command === "revoke") {
        if (message.author.id !== ADMIN_ID) {
            return message.reply("❌ You don't have permission to use this command.");
        }

        const targetKey = args[0];
        if (!targetKey) {
            return message.reply("❌ Usage: `!revoke <key>`");
        }

        const keyData = db.keys[targetKey];
        if (!keyData) {
            return message.reply("❌ Key not found.");
        }

        keyData.active = false;
        const userData = db.users[keyData.owner];
        if (userData) {
            userData.active = false;
        }
        saveDatabase(db);

        await message.reply(`✅ Key \`${targetKey}\` has been revoked.`);
        return;
    }

    // ============================================
    // !help
    // ============================================
    if (command === "help") {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle("📚 Available Commands")
            .addFields(
                { name: "!create account <username>", value: "Create a new account and generate your key", inline: false },
                { name: "!account information", value: "View your account details and key status", inline: false },
                { name: "!get key", value: "Display your key", inline: false },
                { name: "!reset hwid", value: "Reset your HWID to use the key on a new device", inline: false }
            )
            .setFooter({ text: "Admins: !renew key <key> <days> | !revoke <key>" });

        await message.reply({ embeds: [embed] });
        return;
    }
});

// ============================================
// EXPRESS WEB SERVER
// ============================================
const app = express();
app.use(express.json());

// ============================================
// YOUR BLUSHWOVENS SCRIPT
// ============================================
const SCRIPT = `
-- Paste your full Blushwovens script here
print("Blushwovens loaded successfully!")
`;

// ============================================
// API ENDPOINT FOR ROBLOX LOADER
// ============================================
app.post('/load', (req, res) => {
    const { username, key, hwid } = req.body;
    const db = loadDatabase();

    const keyData = db.keys[key];
    if (!keyData) {
        return res.json({ success: false, reason: "Invalid key" });
    }

    if (!keyData.active) {
        return res.json({ success: false, reason: "Key revoked" });
    }

    if (keyData.username !== username) {
        return res.json({ success: false, reason: "Username mismatch" });
    }

    if (keyData.expires && new Date(keyData.expires) < new Date()) {
        return res.json({ success: false, reason: "Key expired" });
    }

    if (keyData.maxUses > 0 && keyData.used >= keyData.maxUses) {
        return res.json({ success: false, reason: "Usage limit reached" });
    }

    // HWID check
    if (!keyData.hwid) {
        keyData.hwid = hwid;
    } else if (keyData.hwid !== hwid) {
        return res.json({ success: false, reason: "HWID mismatch" });
    }

    keyData.used++;
    saveDatabase(db);

    res.json({ success: true, chunk: SCRIPT });
});

app.get('/', (req, res) => res.send('Discord Bot is running!'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Web server running on port ${port}`));

// ============================================
// LOGIN
// ============================================
client.login(process.env.TOKEN);
