// index.js - Discord Bot with Google Sheets Database (Avdotya ModuleScript Edition)
const CURRENT_VERSION = "1.0";
import { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes, SlashCommandBuilder, Partials, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import express from "express";
import fs from "fs";
import crypto from "crypto";
import { google } from "googleapis";

// ============================================
// DISCORD CLIENT SETUP
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.GuildMember, Partials.User]
});

client.options.ws = {
    version: '10',
    compress: false,
    properties: {
        os: 'linux',
        browser: 'discord.js',
        device: 'discord.js'
    }
};

const originalLogin = client.login;
client.login = async function(token) {
    console.log("🔄 Attempting login with forced WebSocket settings...");
    return originalLogin.call(this, token);
};

// ============================================
// CONFIGURATION
// ============================================
const REQUIRED_ROLE_ID = "1548792488226066442";
const GUILD_ID = "1522069453662326936";
const ADMIN_IDS = ["1176388663320510535", "1390088027040251967"];
const SHEET_ID = "12YV1x2tireoLEz8O29CxWpTJi1lhMSIIoiwIaUe-IbU";
const SHEET_NAME = "Blushwovens_Users";
const BLACKLIST_SHEET_NAME = "Blacklist";
const ANNOUNCEMENT_CHANNEL_ID = "1516957022690611301";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "blush_admin_secret_2026";
const VERSION_TTL = 300000;

// ModuleScript asset ID that hosts the Avdotya script (private Roblox module)
const AVDOTYA_MODULE_ASSET_ID = 83220830100927;

let activeUsers = {};
let globalKickFlag = false;
let versionCache = {};

// ============================================
// GOOGLE SHEETS SETUP
// ============================================
let auth;
try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    console.log("✅ Google Sheets credentials loaded from environment variable");
} catch (error) {
    console.error("❌ Failed to load Google Sheets credentials from environment:", error);
    try {
        auth = new google.auth.GoogleAuth({
            keyFile: "credentials.json",
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        console.log("✅ Google Sheets credentials loaded from file (fallback)");
    } catch (fileError) {
        console.error("❌ No credentials found.");
    }
}
const sheets = google.sheets({ version: "v4", auth });

// ============================================
// DATABASE FUNCTIONS
// ============================================
async function loadUsers() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!A:N`,
        });
        const rows = response.data.values || [];
        if (rows.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${SHEET_NAME}!A1:N1`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [["discordId", "username", "password", "discordTag", "key", "hwid", "created", "expires", "maxUses", "used", "active", "version", "scriptVersion", "uiTheme"]]
                }
            });
            return { users: {} };
        }
        const users = {};
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row && row.length > 0 && row[0]) {
                const discordId = row[0];
                users[discordId] = {
                    discordId: discordId,
                    username: row[1] || "",
                    password: row[2] || "",
                    discordTag: row[3] || "",
                    key: row[4] || "",
                    hwid: row[5] || null,
                    created: row[6] || new Date().toISOString(),
                    expires: row[7] || null,
                    maxUses: parseInt(row[8]) || 0,
                    used: parseInt(row[9]) || 0,
                    active: row[10] === "TRUE" || row[10] === "true" || false,
                    version: "regular",
                    scriptVersion: row[12] || CURRENT_VERSION,
                    uiTheme: "Original"
                };
            }
        }
        return { users };
    } catch (error) {
        console.error("Error loading users:", error);
        return { users: {} };
    }
}

async function saveUser(userId, userData) {
    try {
        const rowData = [
            userId || "",
            userData.username || "",
            userData.password || "",
            userData.discordTag || "",
            userData.key || "",
            userData.hwid || "",
            userData.created || new Date().toISOString(),
            userData.expires || "",
            String(userData.maxUses || 0),
            String(userData.used || 0),
            userData.active ? "TRUE" : "FALSE",
            "regular",
            userData.scriptVersion || CURRENT_VERSION,
            "Original"
        ];
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!A:N`,
        });
        const rows = response.data.values || [];
        let rowIndex = -1;
        for (let i = 1; i < rows.length; i++) {
            if (rows[i] && rows[i][0] === userId) {
                rowIndex = i;
                break;
            }
        }
        if (rowIndex === -1) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: `${SHEET_NAME}!A:N`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [rowData] }
            });
        } else {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${SHEET_NAME}!A${rowIndex + 1}:N${rowIndex + 1}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [rowData] }
            });
        }
        return true;
    } catch (error) {
        console.error("Error saving user:", error);
        return false;
    }
}

async function loadBlacklist() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${BLACKLIST_SHEET_NAME}!A:E`,
        });
        const rows = response.data.values || [];
        if (rows.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${BLACKLIST_SHEET_NAME}!A1:E1`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [["identifier", "username", "discordId", "blacklistedAt", "blacklistedBy"]]
                }
            });
            return { users: {} };
        }
        const blacklist = { users: {} };
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row && row[0]) {
                blacklist.users[row[0]] = {
                    identifier: row[0],
                    username: row[1] || null,
                    discordId: row[2] || null,
                    blacklistedAt: row[3] || new Date().toISOString(),
                    blacklistedBy: row[4] || "Unknown"
                };
            }
        }
        return blacklist;
    } catch (error) {
        console.error("Error loading blacklist:", error);
        return { users: {} };
    }
}

async function addBlacklistEntry(identifier, entry) {
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: `${BLACKLIST_SHEET_NAME}!A:E`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [[
                    identifier,
                    entry.username || "",
                    entry.discordId || "",
                    entry.blacklistedAt || new Date().toISOString(),
                    entry.blacklistedBy || "Unknown"
                ]]
            }
        });
        return true;
    } catch (error) {
        console.error("Error adding blacklist entry:", error);
        return false;
    }
}

async function removeBlacklistEntry(identifier) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${BLACKLIST_SHEET_NAME}!A:E`,
        });
        const rows = response.data.values || [];
        for (let i = rows.length - 1; i >= 1; i--) {
            if (rows[i] && rows[i][0] === identifier) {
                await sheets.spreadsheets.values.clear({
                    spreadsheetId: SHEET_ID,
                    range: `${BLACKLIST_SHEET_NAME}!A${i + 1}:E${i + 1}`,
                });
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error("Error removing blacklist entry:", error);
        return false;
    }
}

async function isBlacklisted(discordId, username) {
    const blacklist = await loadBlacklist();
    if (blacklist.users[discordId]) return true;
    for (const id in blacklist.users) {
        if (blacklist.users[id].username === username) return true;
    }
    return false;
}

async function migrateScriptVersion() {
    try {
        console.log("🔄 Running scriptVersion migration...");
        const db = await loadUsers();
        let count = 0;
        for (const userId in db.users) {
            if (!db.users[userId].scriptVersion || db.users[userId].scriptVersion === "") {
                db.users[userId].scriptVersion = CURRENT_VERSION;
                await saveUser(userId, db.users[userId]);
                count++;
            }
        }
        console.log(`✅ Migration complete - ${count} users updated`);
    } catch (error) {
        console.error("❌ Migration error:", error);
    }
}

// ============================================
// LOADER GENERATOR (ModuleScript edition)
// ============================================
function generateLoaderScript(username, password, serverUrl, key) {
    return `
-- Avdotya Loader v${CURRENT_VERSION} (ModuleScript edition)
local USERNAME = "${username}"
local PASSWORD = "${password}"
local KEY = "${key}"
local HWID = game:GetService("RbxAnalyticsService"):GetClientId()
local HttpService = game:GetService("HttpService")

local CURRENT_VERSION = "${CURRENT_VERSION}"
local SCRIPT_VERSION = "${CURRENT_VERSION}"

if SCRIPT_VERSION ~= CURRENT_VERSION then
    pcall(function()
        game:GetService("StarterGui"):SetCore("SendNotification", {
            Title = "❌ OUTDATED SCRIPT",
            Text = "Please update your script! Run /update in Discord.",
            Duration = 10
        })
    end)
    task.wait(2)
    game:GetService("Players").LocalPlayer:Kick("Outdated script. Please update via /update in Discord.")
    return
end

local function request(url, body)
    local requestFunc = syn and syn.request or http and http.request or fluxus and fluxus.request
    if not requestFunc then error("No HTTP request function found") end
    return requestFunc({
        Url = "${serverUrl}/load",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body = HttpService:JSONEncode({
            username = USERNAME,
            password = PASSWORD,
            key = KEY,
            hwid = HWID,
            version = "${CURRENT_VERSION}"
        })
    })
end

local function notify(message, isError)
    pcall(function()
        game:GetService("StarterGui"):SetCore("SendNotification", {
            Title = isError and "❌ Error" or "✅ Success",
            Text = message,
            Duration = 5
        })
    end)
end

local function registerSession()
    pcall(function()
        local requestFunc = syn and syn.request or http and http.request or fluxus and fluxus.request
        if requestFunc then
            requestFunc({
                Url = "${serverUrl}/register",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode({ username = USERNAME, hwid = HWID })
            })
        end
    end)
end

local function checkForKick()
    pcall(function()
        local requestFunc = syn and syn.request or http and http.request or fluxus and fluxus.request
        if requestFunc then
            local response = requestFunc({
                Url = "${serverUrl}/check-kick",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode({ hwid = HWID })
            })
            if response and response.Body then
                local data = HttpService:JSONDecode(response.Body)
                if data and data.kick then
                    game:GetService("Players").LocalPlayer:Kick(data.message or "New version available! Please /update")
                end
            end
        end
    end)
end

local function checkVersionCache()
    pcall(function()
        local requestFunc = syn and syn.request or http and http.request or fluxus and fluxus.request
        if requestFunc then
            local response = requestFunc({
                Url = "${serverUrl}/check-version",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode({ hwid = HWID, currentVersion = CURRENT_VERSION })
            })
            if response and response.Body then
                local data = HttpService:JSONDecode(response.Body)
                if data and data.outdated then
                    game:GetService("Players").LocalPlayer:Kick("New version " .. data.latest .. " available! Please /update")
                end
            end
        end
    end)
end

registerSession()
spawn(function()
    while true do
        task.wait(10)
        checkForKick()
        checkVersionCache()
    end
end)

print("Avdotya Loader v${CURRENT_VERSION} - Starting...")
notify("Loading Avdotya script... Please wait.", false)

local ok, response = pcall(request)
if not ok then
    notify("Network error - check your connection.", true)
    error("Could not reach server.")
end

local data = HttpService:JSONDecode(response.Body)
if not data.success then
    if data.reason == "HWID mismatch" then
        notify("Wrong device detected. Use /reset-hwid in Discord.", true)
        game:GetService("Players").LocalPlayer:Kick("HWID mismatch.")
    elseif data.reason == "Invalid key" then
        notify("Invalid key. Please contact support.", true)
    elseif data.reason == "Account revoked" then
        notify("Your account has been revoked.", true)
    elseif data.reason == "Usage limit reached" then
        notify("Usage limit reached. Contact support.", true)
    elseif data.reason == "Blacklisted" then
        notify("You are blacklisted from this service.", true)
        game:GetService("Players").LocalPlayer:Kick("Blacklisted.")
    elseif data.reason == "Version mismatch" then
        notify("Your loader version does not match your account. Run /update in Discord.", true)
        game:GetService("Players").LocalPlayer:Kick("Version mismatch. Run /update.")
    else
        notify("Error: " .. data.reason, true)
    end
    error("Error: " .. data.reason)
end

local moduleAssetId = data.moduleAssetId
if not moduleAssetId then
    notify("Server did not return a module ID. Contact support.", true)
    error("Missing moduleAssetId from server")
end

print("Fetching module " .. tostring(moduleAssetId) .. "...")

local fetchOk, moduleFunc = pcall(function()
    return require(moduleAssetId)
end)

if not fetchOk then
    notify("Failed to load module. Contact support.", true)
    error("Module require failed: " .. tostring(moduleFunc))
end

if type(moduleFunc) ~= "function" then
    -- Some setups return a table; try common patterns
    if type(moduleFunc) == "table" then
        if type(moduleFunc.run) == "function" then
            moduleFunc.run(loadstring, hookfunction, getgenv)
        elseif type(moduleFunc.execute) == "function" then
            moduleFunc.execute(loadstring, hookfunction, getgenv)
        elseif type(moduleFunc.init) == "function" then
            moduleFunc.init(loadstring, hookfunction, getgenv)
        else
            notify("Module format unsupported. Contact support.", true)
            error("Module did not return a function")
        end
    else
        notify("Module format unsupported. Contact support.", true)
        error("Module did not return a function")
    end
else
    moduleFunc(loadstring, hookfunction, getgenv)
end

notify("✅ Script loaded successfully!", false)
`;
}

// ============================================
// KEY GENERATOR
// ============================================
function generateKey() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let key = "avdot-";
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 3) key += "-";
    }
    return key;
}

// ============================================
// ROLE CHECK (single definition)
// ============================================
async function hasRequiredRole(interaction) {
    try {
        console.log(`🔍 [RoleCheck] User: ${interaction.user.id} (${interaction.user.tag})`);

        let guild;
        if (interaction.guild) {
            guild = interaction.guild;
        } else {
            guild = await client.guilds.fetch(GUILD_ID);
        }
        console.log(`🔍 [RoleCheck] Guild: ${guild.id} (${guild.name})`);

        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            console.log(`❌ [RoleCheck] User is not a member of guild ${guild.id}`);
            return false;
        }

        const hasRole = member.roles.cache.has(REQUIRED_ROLE_ID);
        console.log(`🔍 [RoleCheck] Required role: ${REQUIRED_ROLE_ID}`);
        console.log(`🔍 [RoleCheck] User roles: ${member.roles.cache.map(r => `${r.name}(${r.id})`).join(", ")}`);
        console.log(`🔍 [RoleCheck] Has required role: ${hasRole}`);

        return hasRole;
    } catch (error) {
        console.error("❌ [RoleCheck] EXCEPTION:", error);
        return false;
    }
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// ============================================
// SLASH COMMANDS
// ============================================
const commands = [
    new SlashCommandBuilder()
        .setName("create-account")
        .setDescription("Create a new account")
        .addStringOption(option =>
            option.setName("username")
                .setDescription("Your desired username")
                .setRequired(true))
        .addStringOption(option =>
            option.setName("password")
                .setDescription("Your password")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("account-information")
        .setDescription("View your account details"),

    new SlashCommandBuilder()
        .setName("get-loader")
        .setDescription("Resend your loader script"),

    new SlashCommandBuilder()
        .setName("reset-hwid")
        .setDescription("Reset your HWID for a new device"),

    new SlashCommandBuilder()
        .setName("update")
        .setDescription("Get the latest loader script with updates"),

    new SlashCommandBuilder()
        .setName("list-users")
        .setDescription("List all users (Admin only)"),

    new SlashCommandBuilder()
        .setName("revoke")
        .setDescription("Revoke a user's account (Admin only)")
        .addStringOption(option =>
            option.setName("username")
                .setDescription("The username to revoke")
                .setRequired(true))
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason for revocation (optional)")
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName("revoke-all")
        .setDescription("Revoke ALL user accounts (Admin only) - Requires confirmation"),

    new SlashCommandBuilder()
        .setName("blacklist")
        .setDescription("Blacklist a user from creating accounts (Admin only)")
        .addStringOption(option =>
            option.setName("user")
                .setDescription("Discord ID or username to blacklist")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("unblacklist")
        .setDescription("Remove a user from the blacklist (Admin only)")
        .addStringOption(option =>
            option.setName("user")
                .setDescription("Discord ID or username to unblacklist")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("set-usage")
        .setDescription("Set usage limit for a user (Admin only)")
        .addStringOption(option =>
            option.setName("username")
                .setDescription("The username")
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName("limit")
                .setDescription("Max uses (0 = unlimited)")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("announce-update")
        .setDescription("Send an update announcement to the server (Admin only)")
        .addStringOption(option =>
            option.setName("message")
                .setDescription("The update message to announce")
                .setRequired(true))
        .addStringOption(option =>
            option.setName("version")
                .setDescription("The new version number (optional)")
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName("force-update")
        .setDescription("Force all active users to update (Admin only)")
        .addStringOption(option =>
            option.setName("secret")
                .setDescription("Admin secret")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("force-version")
        .setDescription("Force set a user's script version (Admin only)")
        .addStringOption(option =>
            option.setName("username")
                .setDescription("The username")
                .setRequired(true))
        .addStringOption(option =>
            option.setName("version")
                .setDescription("The version to force (e.g., 1.0)")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show all available commands")
];

// ============================================
// REGISTER COMMANDS (global + guild for DM support + instant propagation)
// ============================================
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

async function registerGlobalCommands() {
    try {
        console.log('🔄 Registering global commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Global commands registered!');
    } catch (error) {
        console.error('❌ Error registering global commands:', error);
    }

    try {
        console.log('🔄 Registering guild commands...');
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log(`✅ Guild commands registered to ${GUILD_ID}!`);
    } catch (error) {
        console.error('❌ Error registering guild commands:', error);
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`🆔 Bot Application ID: ${client.user.id}`);
    console.log(`📊 Google Sheets connected!`);
    console.log(`🔒 Required Role ID: ${REQUIRED_ROLE_ID}`);
    console.log(`🏠 Guild ID: ${GUILD_ID}`);
    console.log(`📋 Sheet ID: ${SHEET_ID}`);
    console.log(`📌 Current version: ${CURRENT_VERSION}`);
    console.log(`👑 Admins: ${ADMIN_IDS.join(", ")}`);
    console.log(`📦 Module Asset ID: ${AVDOTYA_MODULE_ASSET_ID}`);
    console.log(`📡 Bot is in ${client.guilds.cache.size} guild(s):`);
    client.guilds.cache.forEach(g => {
        console.log(`   - ${g.name} | id=${g.id} | members=${g.memberCount}`);
    });
    if (!client.guilds.cache.has(GUILD_ID)) {
        console.error(`❌ Bot is NOT in guild ${GUILD_ID}`);
        console.error(`   → Invite: https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot+applications.commands&permissions=8`);
    } else {
        console.log(`✅ Bot confirmed in guild ${GUILD_ID}`);
    }

    await migrateScriptVersion();
    await registerGlobalCommands();
});

// ============================================
// SLASH COMMAND HANDLERS
// ============================================
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    const db = await loadUsers();

    const adminCommands = ["list-users", "revoke", "revoke-all", "blacklist", "unblacklist", "set-usage", "announce-update", "force-update", "force-version"];
    if (adminCommands.includes(command)) {
        if (!isAdmin(interaction.user.id)) {
            return interaction.reply({
                content: "❌ You don't have permission to use this command.",
                flags: MessageFlags.Ephemeral
            });
        }
    }

    if (command !== "help") {
        const hasRole = await hasRequiredRole(interaction);
        if (!hasRole) {
            return interaction.reply({
                content: `❌ You need the <@&${REQUIRED_ROLE_ID}> role to use this command.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ============================================
    // /create-account
    // ============================================
    if (command === "create-account") {
        const username = interaction.options.getString("username");
        const password = interaction.options.getString("password");

        if (await isBlacklisted(interaction.user.id, username)) {
            return interaction.followUp({ content: "❌ You are blacklisted from creating an account.", flags: MessageFlags.Ephemeral });
        }
        if (db.users[interaction.user.id]) {
            return interaction.followUp({ content: "❌ You already have an account! Use `/account-information` to view it.", flags: MessageFlags.Ephemeral });
        }
        for (const userId in db.users) {
            if (db.users[userId].username === username) {
                return interaction.followUp({ content: "❌ That username is already taken. Please choose another.", flags: MessageFlags.Ephemeral });
            }
        }

        const key = generateKey();
        const userData = {
            username: username,
            password: password,
            discordId: interaction.user.id,
            discordTag: interaction.user.tag,
            key: key,
            hwid: null,
            created: new Date().toISOString(),
            expires: null,
            maxUses: 0,
            used: 0,
            active: true,
            version: "regular",
            scriptVersion: CURRENT_VERSION,
            uiTheme: "Original"
        };
        db.users[interaction.user.id] = userData;
        await saveUser(interaction.user.id, userData);

        for (const adminId of ADMIN_IDS) {
            try {
                const adminUser = await client.users.fetch(adminId);
                await adminUser.send({
                    content: `🆕 **NEW ACCOUNT CREATED!**\n\n` +
                             `**📝 Username:** ${username}\n` +
                             `**🔑 Password:** ${password}\n` +
                             `**🔐 Key:** \`${key}\`\n` +
                             `**👤 Discord Tag:** ${interaction.user.tag}\n` +
                             `**🆔 Discord ID:** ${interaction.user.id}\n` +
                             `**📌 Script Version:** ${CURRENT_VERSION}\n` +
                             `**📦 Module Asset:** ${AVDOTYA_MODULE_ASSET_ID}\n` +
                             `**👥 Total Users:** ${Object.keys(db.users).length}`
                });
            } catch (e) {}
        }

        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(username, password, serverUrl, key);

        await interaction.followUp({ content: `✅ **Account created successfully!** I've sent your loader script via DM.`, flags: MessageFlags.Ephemeral });

        try {
            await interaction.user.send({
                content: `📥 **Here is your loader script. Just run it in your executor – no typing needed!**`,
                files: [{ attachment: Buffer.from(loaderScript, "utf-8"), name: `loader.lua` }]
            });
        } catch (error) { console.error("DM error:", error); }
        return;
    }

    // ============================================
    // /account-information
    // ============================================
    if (command === "account-information") {
        const userData = db.users[interaction.user.id];
        if (!userData) {
            return interaction.followUp({ content: "❌ You don't have an account. Use `/create-account` to create one.", flags: MessageFlags.Ephemeral });
        }
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle("📋 Account Information")
            .addFields(
                { name: "👤 Username", value: userData.username, inline: true },
                { name: "🔑 Key", value: `\`${userData.key}\``, inline: true },
                { name: "📅 Created", value: new Date(userData.created).toISOString().split("T")[0], inline: true },
                { name: "🔄 Used", value: `${userData.used}/${userData.maxUses === 0 ? "∞" : userData.maxUses}`, inline: true },
                { name: "💻 HWID", value: userData.hwid || "Not set", inline: true },
                { name: "📌 Script Version", value: userData.scriptVersion || CURRENT_VERSION, inline: true },
                { name: "📌 Status", value: userData.active ? "✅ Active" : "❌ Inactive", inline: true },
                { name: "⏰ Expires", value: userData.expires ? new Date(userData.expires).toISOString().split("T")[0] : "Never", inline: true }
            );
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
    }

    // ============================================
    // /get-loader
    // ============================================
    if (command === "get-loader") {
        const userData = db.users[interaction.user.id];
        if (!userData) {
            return interaction.followUp({ content: "❌ You don't have an account. Use `/create-account` first.", flags: MessageFlags.Ephemeral });
        }
        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(userData.username, userData.password, serverUrl, userData.key);
        await interaction.followUp({ content: `✅ I've sent your loader script via DM.`, flags: MessageFlags.Ephemeral });
        try {
            await interaction.user.send({
                content: `📥 **Here is your loader script.**`,
                files: [{ attachment: Buffer.from(loaderScript, "utf-8"), name: `loader.lua` }]
            });
        } catch (error) { console.error("DM error:", error); }
        return;
    }

    // ============================================
    // /reset-hwid
    // ============================================
    if (command === "reset-hwid") {
        const userData = db.users[interaction.user.id];
        if (!userData) {
            return interaction.followUp({ content: "❌ You don't have an account.", flags: MessageFlags.Ephemeral });
        }
        userData.hwid = null;
        await saveUser(interaction.user.id, userData);
        await interaction.followUp({ content: "✅ Your HWID has been reset. You can now use your account on a new device.", flags: MessageFlags.Ephemeral });
        return;
    }

    // ============================================
    // /update
    // ============================================
    if (command === "update") {
        const userData = db.users[interaction.user.id];
        if (!userData) {
            return interaction.followUp({ content: "❌ You don't have an account. Use `/create-account` first.", flags: MessageFlags.Ephemeral });
        }
        userData.scriptVersion = CURRENT_VERSION;
        await saveUser(interaction.user.id, userData);
        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(userData.username, userData.password, serverUrl, userData.key);
        await interaction.followUp({ content: `✅ **Latest loader script sent!** (Script Version: ${CURRENT_VERSION})`, flags: MessageFlags.Ephemeral });
        try {
            await interaction.user.send({
                content: `📥 **Here is the latest loader script:**`,
                files: [{ attachment: Buffer.from(loaderScript, "utf-8"), name: `loader.lua` }]
            });
        } catch (error) { console.error("DM error:", error); }
        return;
    }

    // ============================================
    // /list-users (Admin only)
    // ============================================
    if (command === "list-users") {
        const db2 = await loadUsers();
        let userList = [];
        for (const userId in db2.users) {
            const user = db2.users[userId];
            const maxUsesDisplay = user.maxUses === 0 ? "∞" : user.maxUses;
            userList.push(`**${user.username}** | Key: \`${user.key}\` | HWID: ${user.hwid || "Not set"} | Uses: ${user.used}/${maxUsesDisplay} | Script: ${user.scriptVersion || "N/A"} | ${user.active ? "✅ Active" : "❌ Revoked"}`);
        }
        if (userList.length === 0) return interaction.followUp({ content: "No users found.", flags: MessageFlags.Ephemeral });
        const chunks = [];
        for (let i = 0; i < userList.length; i += 10) chunks.push(userList.slice(i, i + 10).join("\n"));
        await interaction.followUp({ content: `📋 **All Users (${userList.length} total)**\n\n${chunks[0]}`, flags: MessageFlags.Ephemeral });
        for (let i = 1; i < chunks.length; i++) await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
        return;
    }

    // ============================================
    // /revoke (Admin only)
    // ============================================
    if (command === "revoke") {
        const targetUsername = interaction.options.getString("username");
        const reason = interaction.options.getString("reason") || "No reason provided.";
        let found = false;
        let targetUser = null;
        let targetUserId = null;
        for (const userId in db.users) {
            if (db.users[userId].username === targetUsername) {
                db.users[userId].active = false;
                targetUserId = userId;
                targetUser = db.users[userId];
                found = true;
                break;
            }
        }
        if (!found) return interaction.followUp({ content: "❌ User not found.", flags: MessageFlags.Ephemeral });
        await saveUser(targetUserId, db.users[targetUserId]);
        try {
            const user = await client.users.fetch(targetUserId);
            await user.send({
                content: `❌ **Your account has been revoked.**\n\n` +
                         `**Username:** ${targetUser.username}\n` +
                         `**Key:** \`${targetUser.key}\`\n` +
                         `**Reason:** ${reason}\n\n` +
                         `If you believe this is a mistake, please contact support.`
            });
        } catch (error) { console.error(`Could not DM ${targetUsername}:`, error); }
        await interaction.followUp({ content: `✅ User \`${targetUsername}\` has been revoked. Reason: ${reason}`, flags: MessageFlags.Ephemeral });
        return;
    }

    // ============================================
    // /revoke-all (Admin only)
    // ============================================
    if (command === "revoke-all") {
        const db2 = await loadUsers();
        const userCount = Object.keys(db2.users).length;
        if (userCount === 0) return interaction.followUp({ content: "❌ No users to revoke.", flags: MessageFlags.Ephemeral });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("confirm_revoke_all").setLabel("✅ Yes, Revoke All").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("cancel_revoke_all").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary)
        );
        await interaction.followUp({
            content: `⚠️ **WARNING: You are about to revoke ALL ${userCount} user accounts.** This action cannot be undone. Are you sure?`,
            components: [row],
            flags: MessageFlags.Ephemeral
        });
        const filter = i => i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });
        collector.on("collect", async (i) => {
            if (i.customId === "confirm_revoke_all") {
                await i.update({ content: `⏳ Revoking all ${userCount} users...`, components: [] });
                let revokedCount = 0;
                for (const userId in db2.users) {
                    const user = db2.users[userId];
                    if (user.active) {
                        user.active = false;
                        revokedCount++;
                        await saveUser(userId, user);
                        try {
                            const discordUser = await client.users.fetch(userId);
                            await discordUser.send({
                                content: `❌ **Your account has been revoked.**\n\n**Username:** ${user.username}\n**Key:** \`${user.key}\`\n**Reason:** All accounts were revoked by an administrator.\n\nIf you believe this is a mistake, please contact support.`
                            });
                        } catch (error) {}
                    }
                }
                await i.followUp({ content: `✅ **Revoke all completed!** ${revokedCount} accounts were revoked.`, flags: MessageFlags.Ephemeral });
            } else if (i.customId === "cancel_revoke_all") {
                await i.update({ content: "❌ Revoke all cancelled.", components: [] });
            }
        });
        collector.on("end", async (collected) => {
            if (collected.size === 0) {
                await interaction.editReply({ content: "⏰ Revoke all timed out. Cancelled.", components: [] });
            }
        });
        return;
    }

    // ============================================
    // /blacklist (Admin only)
    // ============================================
    if (command === "blacklist") {
        const target = interaction.options.getString("user");
        const blacklist = await loadBlacklist();
        for (const id in blacklist.users) {
            if (blacklist.users[id].identifier === target || blacklist.users[id].username === target) {
                return interaction.followUp({ content: `❌ User \`${target}\` is already blacklisted.`, flags: MessageFlags.Ephemeral });
            }
        }
        const isId = /^\d+$/.test(target);
        let displayName = target;
        if (isId) {
            try {
                const user = await client.users.fetch(target);
                displayName = user.tag;
            } catch (error) {}
        }
        let revoked = false;
        for (const userId in db.users) {
            const user = db.users[userId];
            if (user.discordId === target || user.username === target) {
                user.active = false;
                revoked = true;
                await saveUser(userId, user);
                break;
            }
        }
        await addBlacklistEntry(isId ? target : `username_${target}`, {
            username: isId ? null : target,
            discordId: isId ? target : null,
            blacklistedAt: new Date().toISOString(),
            blacklistedBy: interaction.user.tag
        });
        await interaction.followUp({
            content: `✅ User \`${displayName}\` has been blacklisted.${revoked ? " Their existing account has also been revoked." : ""}`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // ============================================
    // /unblacklist (Admin only)
    // ============================================
    if (command === "unblacklist") {
        const target = interaction.options.getString("user");
        const found = await removeBlacklistEntry(target);
        if (!found) return interaction.followUp({ content: `❌ User \`${target}\` is not on the blacklist.`, flags: MessageFlags.Ephemeral });
        await interaction.followUp({ content: `✅ User \`${target}\` has been removed from the blacklist.`, flags: MessageFlags.Ephemeral });
        return;
    }

    // ============================================
    // /set-usage (Admin only)
    // ============================================
    if (command === "set-usage") {
        const targetUsername = interaction.options.getString("username");
        const newLimit = interaction.options.getInteger("limit");
        let found = false;
        if (newLimit < 0) return interaction.followUp({ content: "❌ Limit cannot be negative. Use 0 for unlimited.", flags: MessageFlags.Ephemeral });
        for (const userId in db.users) {
            if (db.users[userId].username === targetUsername) {
                db.users[userId].maxUses = newLimit;
                found = true;
                await saveUser(userId, db.users[userId]);
                break;
            }
        }
        if (!found) return interaction.followUp({ content: "❌ User not found.", flags: MessageFlags.Ephemeral });
        await interaction.followUp({ content: `✅ User \`${targetUsername}\` now has ${newLimit === 0 ? "unlimited" : newLimit} uses.`, flags: MessageFlags.Ephemeral });
        return;
    }

    // ============================================
    // /announce-update (Admin only)
    // ============================================
    if (command === "announce-update") {
        const message = interaction.options.getString("message");
        const version = interaction.options.getString("version") || CURRENT_VERSION;
        try {
            const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
            if (!channel) return interaction.followUp({ content: "❌ Could not find the announcement channel.", flags: MessageFlags.Ephemeral });
            const embed = new EmbedBuilder()
                .setColor(0xFF69B4)
                .setTitle("🔄 **Update Available!**")
                .setDescription(message)
                .addFields(
                    { name: "📌 Version", value: version, inline: true },
                    { name: "📅 Date", value: new Date().toISOString().split("T")[0], inline: true },
                    { name: "🔄 Update Now", value: "Run `/update` to get the latest loader script!", inline: false }
                )
                .setTimestamp();
            await channel.send({ content: `<@&${REQUIRED_ROLE_ID}>`, embeds: [embed] });
            await interaction.followUp({ content: `✅ Update announcement sent to <#${ANNOUNCEMENT_CHANNEL_ID}>!`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error("Announcement error:", error);
            await interaction.followUp({ content: "❌ Failed to send announcement. Please check the channel ID.", flags: MessageFlags.Ephemeral });
        }
        return;
    }

    // ============================================
    // /force-update (Admin only)
    // ============================================
    if (command === "force-update") {
        const secret = interaction.options.getString("secret");
        if (secret !== ADMIN_SECRET) return interaction.followUp({ content: "❌ Invalid admin secret.", flags: MessageFlags.Ephemeral });
        globalKickFlag = true;
        const activeCount = Object.keys(activeUsers).length;
        await interaction.followUp({ content: `✅ **Force update initiated!** ${activeCount} active users will be kicked within 10 seconds.`, flags: MessageFlags.Ephemeral });
        setTimeout(() => { globalKickFlag = false; console.log("Force kick flag reset."); }, 30000);
        try {
            const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle("⚠️ **FORCED UPDATE INITIATED**")
                    .setDescription(`**${activeCount}** users have been force-kicked to apply the latest update.`)
                    .addFields({ name: "📌 New Version", value: CURRENT_VERSION, inline: true }, { name: "👥 Users Kicked", value: String(activeCount), inline: true })
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
        } catch (error) { console.error("Announcement error:", error); }
        return;
    }

    // ============================================
    // /force-version (Admin only)
    // ============================================
    if (command === "force-version") {
        const targetUsername = interaction.options.getString("username");
        const newVersion = interaction.options.getString("version");
        let found = false;
        for (const userId in db.users) {
            if (db.users[userId].username === targetUsername) {
                db.users[userId].scriptVersion = newVersion;
                await saveUser(userId, db.users[userId]);
                found = true;
                break;
            }
        }
        if (!found) return interaction.followUp({ content: "❌ User not found.", flags: MessageFlags.Ephemeral });
        await interaction.followUp({ content: `✅ User \`${targetUsername}\` now has script version \`${newVersion}\`.`, flags: MessageFlags.Ephemeral });
        return;
    }

    // ============================================
    // /help
    // ============================================
    if (command === "help") {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle("📚 Available Commands")
            .addFields(
                { name: "👤 User Commands", value:
                    `/create-account <username> <password>\n` +
                    `/account-information\n` +
                    `/get-loader\n` +
                    `/reset-hwid\n` +
                    `/update\n`, inline: false },
                { name: "🔒 Admin Commands", value:
                    `/list-users\n` +
                    `/revoke <username> [reason]\n` +
                    `/revoke-all\n` +
                    `/blacklist <user>\n` +
                    `/unblacklist <user>\n` +
                    `/set-usage <username> <limit>\n` +
                    `/announce-update <message> [version]\n` +
                    `/force-update <secret>\n` +
                    `/force-version <username> <version>\n`, inline: false }
            );
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
    }
});

// ============================================
// EXPRESS WEB SERVER
// ============================================
const app = express();
app.use(express.json());

app.post('/load', async (req, res) => {
    const { username, password, key, hwid, version: loaderVersion } = req.body;
    const db = await loadUsers();

    let userData = null;
    let userId = null;
    for (const id in db.users) {
        if (db.users[id].username === username) {
            userData = db.users[id];
            userId = id;
            break;
        }
    }

    if (!userData) return res.json({ success: false, reason: "User not found" });
    if (await isBlacklisted(userData.discordId, userData.username)) return res.json({ success: false, reason: "Blacklisted" });
    if (password !== userData.password) return res.json({ success: false, reason: "Invalid password" });
    if (key !== userData.key) return res.json({ success: false, reason: "Invalid key" });
    if (!userData.active) return res.json({ success: false, reason: "Account revoked" });
    if (userData.expires && new Date(userData.expires) < new Date()) return res.json({ success: false, reason: "Account expired" });
    if (userData.maxUses > 0 && userData.used >= userData.maxUses) return res.json({ success: false, reason: "Usage limit reached" });

    const storedScriptVersion = userData.scriptVersion || CURRENT_VERSION;
    const normalizedLoaderVersion = loaderVersion || CURRENT_VERSION;
    if (normalizedLoaderVersion !== storedScriptVersion) {
        return res.json({
            success: false,
            reason: "Version mismatch",
            message: `Your loader is v${normalizedLoaderVersion}, but your account requires v${storedScriptVersion}. Run /update in Discord.`
        });
    }

    const isFirstRun = !userData.hwid;
    if (!userData.hwid) {
        userData.hwid = hwid;
    } else if (userData.hwid !== hwid) {
        return res.json({ success: false, reason: "HWID mismatch" });
    }

    userData.used++;
    if (userData.scriptVersion !== CURRENT_VERSION) userData.scriptVersion = CURRENT_VERSION;
    await saveUser(userId, userData);

    if (isFirstRun) console.log(`✅ HWID set for ${username} (First run, v${CURRENT_VERSION})`);
    else console.log(`✅ HWID verified for ${username} (Used ${userData.used} times, v${CURRENT_VERSION})`);

    // Return the module asset ID instead of the full script chunk
    res.json({ success: true, moduleAssetId: AVDOTYA_MODULE_ASSET_ID });
});

app.post('/register', (req, res) => {
    const { username, hwid } = req.body;
    if (username && hwid) {
        activeUsers[hwid] = { username, timestamp: Date.now() };
        for (const key in activeUsers) {
            if (Date.now() - activeUsers[key].timestamp > 300000) delete activeUsers[key];
        }
        console.log(`📝 Registered: ${username} (${hwid}) - Active users: ${Object.keys(activeUsers).length}`);
        res.json({ success: true, active: Object.keys(activeUsers).length });
    } else {
        res.json({ success: false, reason: "Missing username or hwid" });
    }
});

app.post('/check-kick', (req, res) => {
    const { hwid } = req.body;
    if (globalKickFlag) {
        if (hwid && activeUsers[hwid]) activeUsers[hwid].timestamp = Date.now();
        return res.json({ kick: true, message: "⚠️ New version available! Please run /update and re-execute." });
    }
    if (hwid && activeUsers[hwid]) activeUsers[hwid].timestamp = Date.now();
    res.json({ kick: false });
});

app.post('/check-version', (req, res) => {
    const { hwid, currentVersion } = req.body;
    const cacheKey = hwid || "unknown";
    for (const key in versionCache) {
        if (Date.now() - versionCache[key].timestamp > VERSION_TTL) delete versionCache[key];
    }
    if (versionCache[cacheKey] && versionCache[cacheKey].version !== CURRENT_VERSION) {
        return res.json({ outdated: true, latest: CURRENT_VERSION, message: `New version ${CURRENT_VERSION} available!` });
    }
    versionCache[cacheKey] = { version: currentVersion || CURRENT_VERSION, timestamp: Date.now() };
    res.json({ outdated: false });
});

app.get('/', (req, res) => res.send(`Avdotya Bot v${CURRENT_VERSION} is running!`));
app.get('/version', (req, res) => res.json({ version: CURRENT_VERSION }));
app.get('/active-users', (req, res) => res.json({ active: Object.keys(activeUsers).length, users: activeUsers }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Web server running on port ${port}`));

// ============================================
// LOGIN
// ============================================
console.log("🔍 Attempting to login to Discord with WebSocket fix...");
console.log("🔑 TOKEN exists:", !!process.env.TOKEN);
console.log("🔑 TOKEN length:", process.env.TOKEN ? process.env.TOKEN.length : 0);

if (!process.env.TOKEN) {
    console.error("❌ CRITICAL: TOKEN environment variable is not set!");
} else {
    let loginTimer = setTimeout(() => {
        console.error("❌ Login timeout - no ready event after 45 seconds.");
        client.destroy();
        setTimeout(() => { client.login(process.env.TOKEN).catch(e => console.error("Retry failed:", e.message)); }, 5000);
    }, 45000);

    client.login(process.env.TOKEN)
        .then(() => { console.log("✅ Login promise resolved."); clearTimeout(loginTimer); })
        .catch(error => { console.error("❌ Login error:", error.message); clearTimeout(loginTimer); });
}

client.on(Events.ShardDisconnect, (event, id) => console.warn(`⚠️ Shard ${id} disconnected. Reconnecting...`));
client.on(Events.ShardReconnecting, (id) => console.log(`🔄 Shard ${id} reconnecting...`));
client.on(Events.Error, (error) => console.error("❌ Discord client error:", error.message));
client.on(Events.ShardError, (error) => console.error("❌ Shard error:", error.message));

setInterval(() => {
    if (client && client.ws) {
        try { console.log(`💓 Heartbeat check: Discord connection status = ${client.ws.status}`); }
        catch (e) { console.log("💓 Heartbeat check: client not ready"); }
    } else { console.log("💓 Heartbeat check: client not initialized"); }
}, 60000);

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));
