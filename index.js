// index.js - Discord Bot with Google Sheets Database (Avdotya Script Edition)
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
                    version: "regular",               // kept for sheet compatibility
                    scriptVersion: row[12] || CURRENT_VERSION,
                    uiTheme: "Original"               // kept for sheet compatibility
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
// AVDOTYA SCRIPT (Single distributable script)
// ============================================
const AVDOITYA_SCRIPT = `
-- ============================================
-- SERVICES
-- ============================================
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")
local CoreGui = game:GetService("CoreGui")
local Stats = game:GetService("Stats")
local TweenService = game:GetService("TweenService")

local LocalPlayer = Players.LocalPlayer
local Camera = workspace.CurrentCamera
local Mouse = LocalPlayer:GetMouse()

local function safeFindFirstChild(parent, childName)
    if parent and parent:IsA("Instance") then return parent:FindFirstChild(childName) end
    return nil
end

local function safeWaitForChild(parent, childName, timeout)
    if parent and parent:IsA("Instance") then return parent:WaitForChild(childName, timeout or 5) end
    return nil
end

local function W2S(pos)
    if not pos then return nil end
    if typeof(pos) == "CFrame" then pos = pos.Position end
    if typeof(pos) ~= "Vector3" then return nil end
    local ok, r = pcall(function() return Camera:WorldToViewportPoint(pos) end)
    if ok and r and r.Z > 0 then return {X = r.X, Y = r.Y, Z = r.Z} end
    return nil
end

local function IsKnocked(char)
    if not char then return false end
    local bodyEffects = safeFindFirstChild(char, "BodyEffects")
    if not bodyEffects then return false end
    local ko = safeFindFirstChild(bodyEffects, "K.O")
    if ko and ko.Value == true then return true end
    return false
end

local CachedPing = 50
task.spawn(function()
    while task.wait(1) do
        pcall(function()
            local stats = safeFindFirstChild(Stats, "PerformanceStats")
            if stats then
                local pingObj = safeFindFirstChild(stats, "Ping")
                if pingObj then CachedPing = pingObj:GetValue() end
            end
        end)
    end
end)

local function GetPredictionTime()
    local ping = CachedPing or 50
    if ping <= 50 then return 0.02
    elseif ping <= 60 then return 0.025
    elseif ping <= 70 then return 0.03
    elseif ping <= 80 then return 0.035
    elseif ping <= 90 then return 0.04
    elseif ping <= 100 then return 0.045
    elseif ping <= 110 then return 0.05
    elseif ping <= 120 then return 0.055
    elseif ping <= 130 then return 0.06
    elseif ping <= 140 then return 0.065
    elseif ping <= 150 then return 0.07
    elseif ping <= 160 then return 0.075
    elseif ping <= 170 then return 0.08
    elseif ping <= 180 then return 0.085
    elseif ping <= 190 then return 0.09
    else return 0.1 end
end

local function easeLinear(t) return t end
local function easeQuad(t) return t * t end
local function easeSine(t) return 1 - math.cos(t * math.pi / 2) end
local function easeBack(t)
    local c = 1.70158
    return t * t * ((c + 1) * t - c)
end
local function easeElastic(t)
    if t == 0 then return 0 end
    if t == 1 then return 1 end
    return 2 ^ (-10 * t) * math.sin((t * 10 - 0.75) * (2 * math.pi / 3)) + 1
end
local function easeBounce(t)
    if t < 1 / 2.75 then return 7.5625 * t * t end
    if t < 2 / 2.75 then
        t = t - 1.5 / 2.75
        return 7.5625 * t * t + 0.75
    end
    if t < 2.5 / 2.75 then
        t = t - 2.25 / 2.75
        return 7.5625 * t * t + 0.9375
    end
    t = t - 2.625 / 2.75
    return 7.5625 * t * t + 0.984375
end

local easingFunctions = {
    ["Linear"] = easeLinear,
    ["Quad"] = easeQuad,
    ["Sine"] = easeSine,
    ["Back"] = easeBack,
    ["Elastic"] = easeElastic,
    ["Bounce"] = easeBounce,
}

local ST = {
    SilentAim = false,
    SilentAimFOV = 1000,
    SilentAimShowFOV = false,
    SilentAimPart = "Head",
    RevolverBypass = false,
    WallCheck = false,
    SilentAimKnockCheck = false,
    Camlock = false,
    CamlockKey = Enum.KeyCode.E,
    CamlockMode = "Toggle",
    CamlockFOV = 300,
    CamlockPart = "Head",
    CamlockSmoothness = 0.08,
    CamlockPrediction = 0.12,
    CamlockShowFOV = false,
    CamlockSmoothingStyle = "Linear",
    CamlockLockTarget = true,
    CamlockTarget = nil,
    CamlockKnockCheck = false,
    ESP = false,
    ESPBox = false,
    ESPName = false,
    ESPHealth = false,
    ESPDistance = false,
    ESPTracers = false,
    ESPKnockedCheck = true,
    ESPColor = Color3.fromRGB(255, 153, 170),
    SpeedhackEnabled = false,
    SpeedKey = Enum.KeyCode.Q,
    SpeedValue = 50,
    JumpBoostEnabled = false,
    JumpKey = Enum.KeyCode.Z,
    JumpValue = 150,
    BulletSpread = true,
    BulletSpreadValue = 100,
    Fog = false,
    FogDensity = 0.02,
    FogColor = Color3.fromRGB(110, 90, 90),
    Teleport = false,
    TeleportTarget = "",
    Whitelist = {},
    Hitbox = false,
    HitboxSize = 10,
    HitboxOpacity = 0.9,
    FlameLock = false,
    FlameLockKey = Enum.KeyCode.B,
    FlameLockSmoothness = 0.5,
    FlameLockFOV = 250,
    GUIAccent = Color3.fromRGB(181, 31, 77),
    GUIBorder = Color3.fromRGB(50, 50, 50),
    GUIText = Color3.fromRGB(180, 180, 180),
    GUITextSecondary = Color3.fromRGB(120, 120, 120),
    GUIPanel = Color3.fromRGB(8, 8, 8),
    GUIButton = Color3.fromRGB(20, 20, 20),
    UIBackground = Color3.fromRGB(8, 8, 8),
    FPSCap = 240,
}

local ApplyColors
local MainFrame, OuterBorder, TabIndicator, TabSeparator, TitleText
local TabContents = {}
local SliderData = {}
local DropdownData = {}
local ToggleVisuals = {}
local ToggleBindings = {}
local ToggleCallbacks = {}
local ToggleBindButtons = {}
local BindingStateKey = nil
local BindRefreshCallbacks = {}

local GuiToggleSerial = 0
local AnimateGuiOpen
local AnimateGuiClose
local PulseAccent
local UpdateMove

local ScreenGui = Instance.new("ScreenGui")
ScreenGui.Name = "AvdotyasGUI"
ScreenGui.ResetOnSpawn = false
ScreenGui.IgnoreGuiInset = true
ScreenGui.Parent = CoreGui
ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Global
ScreenGui.Enabled = true

local _0xn1 = 100
local _0x52a0d5 = { BulletSpread = { Enabled = true, Amount = 100 } }
local _0x9ba38e

_0x9ba38e = hookfunction(math.random, function(...)
    local args = { ... }
    if checkcaller() then return _0x9ba38e(...) end
    if (#args == 0) or (args[1] == -0.05 and args[2] == 0.05) or (args[1] == -0.1) or (args[1] == -0.05) then
        if _0x52a0d5.BulletSpread.Enabled then
            return _0x9ba38e(...) * (_0x52a0d5.BulletSpread.Amount / _0xn1)
        end
    end
    return _0x9ba38e(...)
end)

local function UpdateBulletSpread()
    if ST.BulletSpread then
        _0x52a0d5.BulletSpread.Enabled = true
        _0x52a0d5.BulletSpread.Amount = math.min(ST.BulletSpreadValue or 100, 100)
    else
        _0x52a0d5.BulletSpread.Enabled = false
        _0x52a0d5.BulletSpread.Amount = 0
    end
end

local handler = nil
local oldFunc = nil
local gunHandlerLoaded = false

local SilentAimFOVCircle = Drawing.new("Circle")
SilentAimFOVCircle.Visible = false
SilentAimFOVCircle.Color = ST.GUIAccent
SilentAimFOVCircle.Thickness = 1.5
SilentAimFOVCircle.Transparency = 0.5
SilentAimFOVCircle.Radius = 1000
SilentAimFOVCircle.Filled = false

pcall(function()
    handler = require(game:GetService("ReplicatedStorage").Modules.GunHandler)
    gunHandlerLoaded = true
    oldFunc = handler.getAim
end)

local function getClosestPart(char)
    local closest = nil
    local shortestDist = math.huge
    if not Mouse or not Mouse.X or not Mouse.Y then
        return safeFindFirstChild(char, "Head")
    end
    local mousePos = Vector2.new(Mouse.X, Mouse.Y)
    local parts = {"Head", "HumanoidRootPart", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot", "LeftUpperArm", "LeftLowerArm", "LeftHand", "RightUpperArm", "RightLowerArm", "RightHand"}
    for _, partName in pairs(parts) do
        local p = safeFindFirstChild(char, partName)
        if p then
            local screenPos, onScreen = Camera:WorldToScreenPoint(p.Position)
            if onScreen then
                local dist = (Vector2.new(screenPos.X, screenPos.Y) - mousePos).Magnitude
                if dist < shortestDist then
                    shortestDist = dist
                    closest = p
                end
            end
        end
    end
    return closest or safeFindFirstChild(char, "Head")
end

local function getClosest()
    if not Mouse or not Mouse.X or not Mouse.Y then return nil end
    local mousePos = Vector2.new(Mouse.X, Mouse.Y)
    local best = nil
    local bestScore = math.huge
    local maxFOV = ST.SilentAimFOV or 1000
    local myChar = LocalPlayer.Character

    for _, player in ipairs(Players:GetPlayers()) do
        if player ~= LocalPlayer and player.Character then
            local hum = safeFindFirstChild(player.Character, "Humanoid")
            if hum and hum.Health > 0 then
                if ST.SilentAimKnockCheck and IsKnocked(player.Character) then continue end
                if ST.Whitelist[player.UserId] then continue end
                local char = player.Character
                local part
                local partName = ST.SilentAimPart or "Head"
                if partName == "Closest Part" then part = getClosestPart(char)
                elseif partName == "Head" then part = safeFindFirstChild(char, "Head")
                elseif partName == "Body" or partName == "HumanoidRootPart" then part = safeFindFirstChild(char, "HumanoidRootPart")
                elseif partName == "Left Leg" then part = safeFindFirstChild(char, "LeftUpperLeg") or safeFindFirstChild(char, "LeftLeg")
                elseif partName == "Right Leg" then part = safeFindFirstChild(char, "RightUpperLeg") or safeFindFirstChild(char, "RightLeg")
                elseif partName == "Left Arm" then part = safeFindFirstChild(char, "LeftUpperArm") or safeFindFirstChild(char, "LeftArm")
                elseif partName == "Right Arm" then part = safeFindFirstChild(char, "RightUpperArm") or safeFindFirstChild(char, "RightArm")
                else part = safeFindFirstChild(char, "Head") end
                if part then
                    local screenPos, onScreen = Camera:WorldToScreenPoint(part.Position)
                    if onScreen then
                        local screenVec = Vector2.new(screenPos.X, screenPos.Y)
                        local crosshairDist = (screenVec - mousePos).Magnitude
                        if crosshairDist < maxFOV then
                            local visible = true
                            if ST.WallCheck then
                                local ray = Ray.new(Camera.CFrame.Position, (part.Position - Camera.CFrame.Position).Unit * 500)
                                local hit = Workspace:FindPartOnRayWithIgnoreList(ray, {myChar, Camera})
                                if not (hit and hit:IsDescendantOf(char)) then visible = false end
                            end
                            if visible then
                                local physicalDist = (Camera.CFrame.Position - part.Position).Magnitude
                                local score = crosshairDist + physicalDist * 0.05
                                if score < bestScore then
                                    bestScore = score
                                    best = part
                                end
                            end
                        end
                    end
                end
            end
        end
    end
    return best
end

local function UpdateSilentAim()
    if handler and gunHandlerLoaded then
        if ST.SilentAim then
            handler.getAim = function(origin, maxDist)
                if ST.RevolverBypass then
                    local currentTool = LocalPlayer.Character and LocalPlayer.Character:FindFirstChildOfClass("Tool")
                    if currentTool and (currentTool.Name == "[Revolver]" or currentTool.Name == "Revolver") then
                        if oldFunc then return oldFunc(origin, maxDist) end
                    end
                end
                local target = getClosest()
                if target then
                    local predT = GetPredictionTime()
                    local predictedPos = target.Position + (target.Velocity or Vector3.new()) * predT
                    local dir = (predictedPos - origin).Unit
                    local dist = (predictedPos - origin).Magnitude
                    return dir, math.min(dist, maxDist or 200)
                end
                if oldFunc then return oldFunc(origin, maxDist) end
                return (CFrame.new(origin, origin + Vector3.new(0, 0, -1))).LookVector, 200
            end
        else
            if oldFunc then handler.getAim = oldFunc end
        end
    end
end

-- CAMLOCK
local CamlockActive = false
local CamlockConnection = nil
local CamlockFOVCircle = nil
local CamlockStartTime = 0
local CamlockStartCFrame = nil
local CamlockTargetCFrame = nil
local CamlockCurrentTarget = nil

pcall(function()
    CamlockFOVCircle = Drawing.new("Circle")
    CamlockFOVCircle.Visible = false
    CamlockFOVCircle.Color = ST.GUIAccent
    CamlockFOVCircle.Thickness = 1.5
    CamlockFOVCircle.Transparency = 0.5
    CamlockFOVCircle.Radius = 300
    CamlockFOVCircle.Filled = false
end)

local function getPartForAim(char, partName)
    if not char then return nil end
    local part = safeFindFirstChild(char, partName)
    if part then return part end
    if partName == "Torso" or partName == "UpperTorso" then
        part = safeFindFirstChild(char, "UpperTorso") or safeFindFirstChild(char, "Torso") or safeFindFirstChild(char, "HumanoidRootPart")
        if part then return part end
    end
    if partName == "HumanoidRootPart" then
        part = safeFindFirstChild(char, "HumanoidRootPart") or safeFindFirstChild(char, "Torso") or safeFindFirstChild(char, "UpperTorso")
        if part then return part end
    end
    return safeFindFirstChild(char, "Head")
end

local function IsValidTarget(player)
    if not player then return false end
    if player == LocalPlayer then return false end
    if not player.Character then return false end
    local hum = safeFindFirstChild(player.Character, "Humanoid")
    if not hum or hum.Health <= 0 then return false end
    if ST.CamlockKnockCheck and IsKnocked(player.Character) then return false end
    if ST.Whitelist[player.UserId] then return false end
    return true
end

local function FindBestCamTarget()
    local closest, shortest = nil, ST.CamlockFOV or 300
    local cx = Camera.ViewportSize.X / 2
    local cy = Camera.ViewportSize.Y / 2

    if ST.CamlockLockTarget and ST.CamlockTarget and IsValidTarget(ST.CamlockTarget) then
        return ST.CamlockTarget
    else
        if ST.CamlockLockTarget and ST.CamlockTarget then ST.CamlockTarget = nil end
    end

    for _, player in ipairs(Players:GetPlayers()) do
        if IsValidTarget(player) then
            local partName = ST.CamlockPart or "Head"
            local part = getPartForAim(player.Character, partName)
            if part then
                local sc = W2S(part.Position)
                if sc then
                    local dx = sc.X - cx
                    local dy = sc.Y - cy
                    local dist = math.sqrt(dx * dx + dy * dy)
                    if dist < shortest then
                        shortest = dist
                        closest = player
                    end
                end
            end
        end
    end
    if ST.CamlockLockTarget and closest then ST.CamlockTarget = closest end
    return closest
end

local function UpdateCamlock()
    if CamlockConnection then CamlockConnection:Disconnect(); CamlockConnection = nil end
    if not ST.Camlock then return end
    CamlockConnection = RunService.RenderStepped:Connect(function()
        if CamlockActive then
            local target = FindBestCamTarget()
            if target and target.Character then
                local partName = ST.CamlockPart or "Head"
                local part = getPartForAim(target.Character, partName)
                if part then
                    local pos = part.Position
                    local hum = safeFindFirstChild(target.Character, "Humanoid")
                    if ST.CamlockPrediction > 0 and hum then
                        local predictionTime = GetPredictionTime()
                        pos = pos + (hum.MoveDirection * ST.CamlockPrediction * 10 * predictionTime * 2)
                    end
                    if CamlockCurrentTarget ~= target then
                        CamlockStartTime = tick()
                        CamlockStartCFrame = Camera.CFrame
                        CamlockTargetCFrame = CFrame.new(Camera.CFrame.Position, pos)
                        CamlockCurrentTarget = target
                    else
                        CamlockTargetCFrame = CFrame.new(Camera.CFrame.Position, pos)
                    end
                    local elapsed = tick() - CamlockStartTime
                    local duration = 0.5
                    local progress = math.min(elapsed / duration, 1)
                    local easingFunc = easingFunctions[ST.CamlockSmoothingStyle] or easeLinear
                    local lerpFactor = easingFunc(progress)
                    if progress >= 1 then Camera.CFrame = CamlockTargetCFrame
                    else Camera.CFrame = CamlockStartCFrame:Lerp(CamlockTargetCFrame, lerpFactor) end
                end
            else
                CamlockCurrentTarget = nil
                CamlockStartTime = 0
                CamlockStartCFrame = nil
                CamlockTargetCFrame = nil
            end
        else
            CamlockCurrentTarget = nil
            CamlockStartTime = 0
            CamlockStartCFrame = nil
            CamlockTargetCFrame = nil
        end
    end)
end

-- FLAMELOCK
local FlameLockTarget = nil
local FlameLockConnection = nil
local FlameLockActive = false

local function GetPlayerAtCenter()
    if not Camera then return nil end
    local screenCenter = Vector2.new(Camera.ViewportSize.X / 2, Camera.ViewportSize.Y / 2)
    local closestPlayer, closestDist = nil, math.huge
    local fov = ST.FlameLockFOV or 250
    for _, plr in ipairs(Players:GetPlayers()) do
        if plr ~= LocalPlayer and plr.Character and safeFindFirstChild(plr.Character, "Head") then
            if ST.SilentAimKnockCheck and IsKnocked(plr.Character) then continue end
            if ST.Whitelist[plr.UserId] then continue end
            local head = safeFindFirstChild(plr.Character, "Head")
            if head then
                local screenPos, onScreen = Camera:WorldToViewportPoint(head.Position)
                if onScreen then
                    local dist = (Vector2.new(screenPos.X, screenPos.Y) - screenCenter).Magnitude
                    if dist < fov and dist < closestDist then
                        closestDist = dist
                        closestPlayer = plr
                    end
                end
            end
        end
    end
    return closestPlayer
end

local function GetPredictedHeadPosition(head)
    if not head then return nil end
    local myRoot = LocalPlayer.Character and safeFindFirstChild(LocalPlayer.Character, "HumanoidRootPart")
    if not myRoot then return head.Position end
    local velocity = head.Velocity
    local horizontalVelocity = Vector3.new(velocity.X, 0, velocity.Z)
    local horizontalSpeed = horizontalVelocity.Magnitude
    local verticalSpeed = math.abs(velocity.Y)
    local distance = (head.Position - myRoot.Position).Magnitude
    local predictionTime = GetPredictionTime()
    if distance > 75 then predictionTime = predictionTime + 0.03
    elseif distance > 40 then predictionTime = predictionTime + 0.01 end
    local lookVector = (head.Position - myRoot.Position).Unit
    local sideVector = lookVector:Cross(Vector3.new(0, 1, 0)).Unit
    local lateralSpeed = math.abs(horizontalVelocity:Dot(sideVector))
    local forwardSpeed = math.abs(horizontalVelocity:Dot(lookVector))
    local usePrediction = lateralSpeed > forwardSpeed * 0.6
    if verticalSpeed > 1 and horizontalSpeed < 0.1 then return head.Position end
    if horizontalSpeed < 0.5 or not usePrediction then return head.Position end
    return head.Position + horizontalVelocity * predictionTime
end

local function StartFlameLock()
    if FlameLockConnection then return end
    FlameLockConnection = RunService.RenderStepped:Connect(function()
        if not ST.FlameLock or not FlameLockActive then
            local char0 = LocalPlayer.Character
            if char0 then
                local h0 = safeFindFirstChild(char0, "Humanoid")
                if h0 then h0.AutoRotate = true end
            end
            return
        end
        local char = LocalPlayer.Character
        if not char then return end
        local rootPart = safeFindFirstChild(char, "HumanoidRootPart")
        local humanoid = safeFindFirstChild(char, "Humanoid")
        if not rootPart or not humanoid then return end
        if not FlameLockTarget or not FlameLockTarget.Character then
            FlameLockTarget = GetPlayerAtCenter()
            if not FlameLockTarget then return end
        end
        local head = safeFindFirstChild(FlameLockTarget.Character, "Head")
        if not head then FlameLockTarget = nil return end
        local distanceVec = head.Position - rootPart.Position
        local flatDistance = Vector3.new(distanceVec.X, 0, distanceVec.Z).Magnitude
        local verticalOffset = math.abs(distanceVec.Y)
        if flatDistance <= 1.2 and verticalOffset > 2 then humanoid.AutoRotate = true return end
        local predicted = GetPredictedHeadPosition(head)
        if not predicted then return end
        local targetPos = Vector3.new(predicted.X, rootPart.Position.Y, predicted.Z)
        local direction = (targetPos - rootPart.Position).Unit
        local lookVector = Vector3.new(direction.X, 0, direction.Z)
        local desired = CFrame.new(rootPart.Position, rootPart.Position + lookVector)
        local smooth = ST.FlameLockSmoothness or 0.5
        rootPart.CFrame = rootPart.CFrame:Lerp(desired, smooth)
        humanoid.AutoRotate = false
    end)
end

local function StopFlameLock()
    FlameLockActive = false
    if FlameLockConnection then FlameLockConnection:Disconnect(); FlameLockConnection = nil end
    FlameLockTarget = nil
    local char = LocalPlayer.Character
    if char then
        local humanoid = safeFindFirstChild(char, "Humanoid")
        if humanoid then humanoid.AutoRotate = true end
    end
end

local function ToggleFlameLockActive()
    if not ST.FlameLock then StopFlameLock() return end
    FlameLockActive = not FlameLockActive
    if FlameLockActive then
        FlameLockTarget = GetPlayerAtCenter()
        StartFlameLock()
    else
        StopFlameLock()
    end
end

-- ESP
local ESPData = {}
local espInitialized = false

local function MakeESP(player)
    local d = {}
    pcall(function()
        d.Box = Drawing.new("Square"); d.Box.Visible = false; d.Box.Color = ST.ESPColor; d.Box.Thickness = 1.5; d.Box.Filled = false
        d.Name = Drawing.new("Text"); d.Name.Visible = false; d.Name.Color = ST.ESPColor; d.Name.Size = 16; d.Name.Center = true; d.Name.Outline = true; d.Name.Font = Drawing.Fonts.UI
        d.Distance = Drawing.new("Text"); d.Distance.Visible = false; d.Distance.Color = ST.ESPColor; d.Distance.Size = 13; d.Distance.Center = true; d.Distance.Outline = true; d.Distance.Font = Drawing.Fonts.UI
        d.Health = Drawing.new("Square"); d.Health.Visible = false; d.Health.Filled = true; d.Health.Thickness = 1
        d.Tracer = Drawing.new("Line"); d.Tracer.Visible = false; d.Tracer.Color = ST.ESPColor; d.Tracer.Thickness = 1
        ESPData[player] = d
    end)
end

local function HideESP(d)
    pcall(function()
        if d.Box then d.Box.Visible = false end
        if d.Name then d.Name.Visible = false end
        if d.Distance then d.Distance.Visible = false end
        if d.Health then d.Health.Visible = false end
        if d.Tracer then d.Tracer.Visible = false end
    end)
end

local function UpdateESP()
    for player, d in pairs(ESPData) do
        if not d then continue end
        if ST.Whitelist[player.UserId] or not player.Character or player == LocalPlayer then
            HideESP(d); continue
        end
        if ST.ESPKnockedCheck and IsKnocked(player.Character) then HideESP(d); continue end
        local hum = safeFindFirstChild(player.Character, "Humanoid")
        local head = safeFindFirstChild(player.Character, "Head")
        local root = safeFindFirstChild(player.Character, "HumanoidRootPart")
        if not (hum and head and root and hum.Health > 0) then HideESP(d); continue end
        local rootPos, rootOnScreen = Camera:WorldToViewportPoint(root.Position)
        if not rootOnScreen then HideESP(d); continue end
        local headPos = Camera:WorldToViewportPoint(head.Position + Vector3.new(0, 0.5, 0))
        local legPos = Camera:WorldToViewportPoint(root.Position - Vector3.new(0, 3, 0))
        if not headPos or not legPos or not rootPos then HideESP(d); continue end
        local boxHeight = math.max(math.abs(headPos.Y - legPos.Y), 2)
        local boxWidth = boxHeight / 2
        local boxX = rootPos.X - boxWidth / 2
        local boxY = rootPos.Y - boxHeight / 2
        local color = ST.ESPColor
        pcall(function()
            if d.Box then d.Box.Color = color; d.Box.Size = Vector2.new(boxWidth, boxHeight); d.Box.Position = Vector2.new(boxX, boxY); d.Box.Visible = ST.ESP and ST.ESPBox end
            if d.Name then d.Name.Color = color; d.Name.Position = Vector2.new(rootPos.X, boxY - 16); d.Name.Text = player.Name; d.Name.Visible = ST.ESP and ST.ESPName end
            if d.Distance then local dist = math.floor((Camera.CFrame.Position - root.Position).Magnitude); d.Distance.Color = color; d.Distance.Position = Vector2.new(rootPos.X, boxY + boxHeight + 2); d.Distance.Text = tostring(dist) .. "m"; d.Distance.Visible = ST.ESP and ST.ESPDistance end
            if d.Health then local ratio = math.clamp(hum.Health / math.max(hum.MaxHealth, 1), 0, 1); d.Health.Color = Color3.fromRGB(255 - math.floor(255 * ratio), math.floor(255 * ratio), 70); d.Health.Size = Vector2.new(3, boxHeight * ratio); d.Health.Position = Vector2.new(boxX - 6, boxY + boxHeight * (1 - ratio)); d.Health.Visible = ST.ESP and ST.ESPHealth end
            if d.Tracer then d.Tracer.Color = color; d.Tracer.From = Vector2.new(Camera.ViewportSize.X / 2, Camera.ViewportSize.Y); d.Tracer.To = Vector2.new(rootPos.X, rootPos.Y + boxHeight / 2); d.Tracer.Visible = ST.ESP and ST.ESPTracers end
        end)
    end
end

local function InitializeESP()
    if espInitialized then return end
    for _, player in ipairs(Players:GetPlayers()) do if player ~= LocalPlayer then MakeESP(player) end end
    Players.PlayerAdded:Connect(function(player) if player ~= LocalPlayer then MakeESP(player) end end)
    espInitialized = true
end

Players.PlayerRemoving:Connect(function(player)
    local d = ESPData[player]
    if d then
        pcall(function()
            if d.Box then d.Box:Remove() end
            if d.Name then d.Name:Remove() end
            if d.Distance then d.Distance:Remove() end
            if d.Health then d.Health:Remove() end
            if d.Tracer then d.Tracer:Remove() end
        end)
        ESPData[player] = nil
    end
end)

-- SPEEDHACK + JUMP BOOST
local DEFAULT_WALKSPEED = 16
local DEFAULT_JUMPPOWER = 50

UpdateMove = function()
    local char = LocalPlayer.Character
    if not char then return end
    local hum = safeFindFirstChild(char, "Humanoid")
    if not hum then return end
    if ST.SpeedhackEnabled then hum.WalkSpeed = ST.SpeedValue or 50 end
    if ST.JumpBoostEnabled then hum.UseJumpPower = true hum.JumpPower = ST.JumpValue or 150 end
end

RunService.RenderStepped:Connect(UpdateMove)

local function BindCharacterMovement(char)
    local hum = safeWaitForChild(char, "Humanoid", 5)
    if not hum then return end
    hum:GetPropertyChangedSignal("WalkSpeed"):Connect(function()
        if ST.SpeedhackEnabled then hum.WalkSpeed = ST.SpeedValue or 50 end
    end)
    hum:GetPropertyChangedSignal("JumpPower"):Connect(function()
        if ST.JumpBoostEnabled then hum.JumpPower = ST.JumpValue or 150 hum.UseJumpPower = true end
    end)
end
if LocalPlayer.Character then BindCharacterMovement(LocalPlayer.Character) end
LocalPlayer.CharacterAdded:Connect(BindCharacterMovement)

-- HITBOX
local function UpdateHitbox()
    for _, player in ipairs(Players:GetPlayers()) do
        if player == LocalPlayer then continue end
        if ST.Whitelist[player.UserId] then
            local char = player.Character
            if char then
                local root = safeFindFirstChild(char, "HumanoidRootPart")
                if root then root.Size = Vector3.new(2, 2, 1) root.Transparency = 1 root.Material = Enum.Material.Plastic root.CanCollide = false end
            end
            continue
        end
        local char = player.Character
        if not char then continue end
        local root = safeFindFirstChild(char, "HumanoidRootPart")
        if not root then continue end
        local be = safeFindFirstChild(char, "BodyEffects")
        local ko = be and safeFindFirstChild(be, "K.O")
        local isKO = ko and ko.Value == true
        if isKO then root.Size = Vector3.new(2, 2, 1) root.Transparency = 1 root.Material = Enum.Material.Plastic root.CanCollide = false continue end
        if ST.Hitbox then
            root.Size = Vector3.new(ST.HitboxSize, ST.HitboxSize, ST.HitboxSize)
            root.Transparency = ST.HitboxOpacity
            root.BrickColor = BrickColor.new("Bright red")
            root.Material = Enum.Material.Neon
            root.CanCollide = false
        else
            root.Size = Vector3.new(2, 2, 1)
            root.Transparency = 1
            root.BrickColor = BrickColor.new("Medium stone grey")
            root.Material = Enum.Material.Plastic
            root.CanCollide = false
        end
    end
end

-- FOG
local OriginalFogStart = Lighting.FogStart
local OriginalFogEnd = Lighting.FogEnd
local OriginalFogColor = Lighting.FogColor

local function UpdateFog()
    if ST.Fog then
        local targetEnd = math.clamp(500 - (ST.FogDensity * 4500), 50, 500)
        Lighting.FogEnd = targetEnd
        Lighting.FogStart = 0
        Lighting.FogColor = ST.FogColor
    else
        Lighting.FogStart = OriginalFogStart
        Lighting.FogEnd = OriginalFogEnd
        Lighting.FogColor = OriginalFogColor
    end
end

local function TeleportToPlayer(targetName)
    if targetName == "" then return end
    local targetLower = targetName:lower()
    for _, player in ipairs(Players:GetPlayers()) do
        if player == LocalPlayer then continue end
        if player.Character and player.Character:FindFirstChild("HumanoidRootPart") then
            if player.Name:lower():find(targetLower, 1, true) == 1 then
                local root = player.Character.HumanoidRootPart
                if root then
                    local myRoot = LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("HumanoidRootPart")
                    if myRoot then myRoot.CFrame = root.CFrame * CFrame.new(0, 0, 3) end
                end
                break
            end
        end
    end
end

local function ApplyFPSCap()
    local cap = math.clamp(math.floor(ST.FPSCap or 240), 30, 1000)
    ST.FPSCap = cap
    if type(setfpscap) == "function" then pcall(function() setfpscap(cap) end) return true end
    return false
end

local function SetToggleState(stateKey, state, callback)
    state = state == true
    ST[stateKey] = state
    local visual = ToggleVisuals[stateKey]
    if visual then visual(state) end
    local cb = callback or ToggleCallbacks[stateKey]
    if cb then cb(state) end
end

local function CreateKeybindButton(parent, stateKey)
    local bind = Instance.new("TextButton")
    bind.Size = UDim2.new(0, 42, 0, 17)
    bind.Position = UDim2.new(1, -112, 0.5, -8.5)
    bind.BackgroundColor3 = Color3.fromRGB(20, 20, 20)
    bind.BackgroundTransparency = 0
    bind.BorderSizePixel = 1
    bind.BorderColor3 = Color3.fromRGB(50, 50, 50)
    bind.TextColor3 = Color3.fromRGB(150, 150, 150)
    bind.TextSize = 8
    bind.Font = Enum.Font.SourceSans
    bind.Text = ToggleBindings[stateKey] and ToggleBindings[stateKey].Name or (ST[stateKey] and ST[stateKey].Name) or "Bind"
    bind.AutoButtonColor = false
    bind.ZIndex = 7
    bind.Parent = parent
    bind:SetAttribute("ColorRole", "Button")
    ToggleBindButtons[stateKey] = bind
    bind.MouseEnter:Connect(function()
        if BindingStateKey ~= stateKey then
            TweenService:Create(bind, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundColor3 = Color3.fromRGB(32, 32, 32), TextColor3 = Color3.fromRGB(210, 210, 210)}):Play()
        end
    end)
    bind.MouseLeave:Connect(function()
        if BindingStateKey ~= stateKey then
            TweenService:Create(bind, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundColor3 = Color3.fromRGB(20, 20, 20), TextColor3 = Color3.fromRGB(150, 150, 150)}):Play()
        end
    end)
    bind.MouseButton1Click:Connect(function()
        BindingStateKey = stateKey
        bind.Text = "Press..."
        bind.BackgroundColor3 = ST.GUIAccent
        bind.BackgroundTransparency = 0.35
    end)
    return bind
end

local function CreateToggleButton(parent, x, y, text, stateKey, callback, allowBind)
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(1, -10, 0, 21)
    frame.Position = UDim2.new(0, 5, 0, y)
    frame.BackgroundTransparency = 0
    frame.BackgroundColor3 = ST.GUIPanel
    frame.BorderSizePixel = 0
    frame.ZIndex = 6
    frame.Parent = parent
    frame:SetAttribute("ColorRole", "Panel")
    local label = Instance.new("TextLabel")
    label.Size = UDim2.new(0, 115, 1, 0)
    label.Position = UDim2.new(0, x, 0, 0)
    label.Text = text
    label.TextColor3 = ST.GUIText
    label.TextSize = 10
    label.Font = Enum.Font.SourceSans
    label.BackgroundTransparency = 1
    label.TextXAlignment = Enum.TextXAlignment.Left
    label.ZIndex = 7
    label.Parent = frame
    label:SetAttribute("ColorRole", "Text")
    if allowBind then CreateKeybindButton(frame, stateKey) end
    local btn = Instance.new("TextButton")
    btn.Size = UDim2.new(0, 54, 1, -2)
    btn.Position = UDim2.new(1, -59, 0, 1)
    btn.BackgroundColor3 = ST[stateKey] and ST.GUIAccent or Color3.fromRGB(30, 30, 30)
    btn.BackgroundTransparency = ST[stateKey] and 0.3 or 0
    btn.BorderSizePixel = 1
    btn.BorderColor3 = ST[stateKey] and ST.GUIAccent or Color3.fromRGB(60, 60, 60)
    btn.Text = ST[stateKey] and "ON" or "OFF"
    btn.TextColor3 = Color3.fromRGB(200, 200, 200)
    btn.TextSize = 10
    btn.Font = Enum.Font.SourceSansBold
    btn.AutoButtonColor = false
    btn.ZIndex = 7
    btn.Parent = frame
    btn:SetAttribute("ColorRole", "Button")
    local function updateVisual(state)
        btn.Text = state and "ON" or "OFF"
        TweenService:Create(btn, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundColor3 = state and ST.GUIAccent or Color3.fromRGB(30, 30, 30), BackgroundTransparency = state and 0.3 or 0, BorderColor3 = state and ST.GUIAccent or Color3.fromRGB(60, 60, 60)}):Play()
    end
    ToggleVisuals[stateKey] = updateVisual
    ToggleCallbacks[stateKey] = callback
    btn.MouseButton1Click:Connect(function() SetToggleState(stateKey, not ST[stateKey]) end)
    return btn
end

local function CreateToggle(parent, x, y, text, stateKey, callback)
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(1, -10, 0, 19)
    frame.Position = UDim2.new(0, 5, 0, y)
    frame.BackgroundTransparency = 0
    frame.BackgroundColor3 = ST.GUIPanel
    frame.BorderSizePixel = 0
    frame.ZIndex = 6
    frame.Parent = parent
    frame:SetAttribute("ColorRole", "Panel")
    local label = Instance.new("TextLabel")
    label.Size = UDim2.new(0, 125, 1, 0)
    label.Position = UDim2.new(0, x, 0, 0)
    label.Text = text
    label.TextColor3 = ST.GUIText
    label.TextSize = 10
    label.Font = Enum.Font.SourceSans
    label.BackgroundTransparency = 1
    label.TextXAlignment = Enum.TextXAlignment.Left
    label.ZIndex = 7
    label.Parent = frame
    label:SetAttribute("ColorRole", "Text")
    local check = Instance.new("TextButton")
    check.Size = UDim2.new(0, 14, 0, 14)
    check.Position = UDim2.new(1, -12, 0.5, -7)
    check.BackgroundColor3 = ST[stateKey] and ST.GUIAccent or Color3.fromRGB(30, 30, 30)
    check.BackgroundTransparency = 0
    check.BorderSizePixel = 1
    check.BorderColor3 = ST[stateKey] and ST.GUIAccent or Color3.fromRGB(60, 60, 60)
    check.Text = ""
    check.AutoButtonColor = false
    check.ZIndex = 7
    check.Parent = frame
    check:SetAttribute("ColorRole", "Button")
    local function updateVisual(state)
        TweenService:Create(check, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundColor3 = state and ST.GUIAccent or Color3.fromRGB(30, 30, 30), BorderColor3 = state and ST.GUIAccent or Color3.fromRGB(60, 60, 60)}):Play()
    end
    ToggleVisuals[stateKey] = updateVisual
    ToggleCallbacks[stateKey] = callback
    check.MouseButton1Click:Connect(function() SetToggleState(stateKey, not ST[stateKey]) end)
    return check
end

local function CreateToggleWithBind(parent, y, text, enabledKey, keyStateKey, callback, onBindChanged)
    local btn = Instance.new("TextButton")
    btn.Size = UDim2.new(1, -10, 0, 26)
    btn.Position = UDim2.new(0, 5, 0, y)
    btn.BackgroundColor3 = ST[enabledKey] and ST.GUIAccent or Color3.fromRGB(30, 30, 30)
    btn.BackgroundTransparency = ST[enabledKey] and 0.3 or 0
    btn.BorderSizePixel = 1
    btn.BorderColor3 = ST[enabledKey] and ST.GUIAccent or Color3.fromRGB(60, 60, 60)
    btn.TextColor3 = Color3.fromRGB(220, 220, 220)
    btn.TextSize = 11
    btn.Font = Enum.Font.SourceSansBold
    btn.AutoButtonColor = false
    btn.ZIndex = 7
    btn.Parent = parent
    btn:SetAttribute("ColorRole", "Button")
    local function refresh()
        local state = ST[enabledKey]
        local key = ST[keyStateKey]
        local keyName = key and tostring(key.Name) or "NONE"
        keyName = keyName:gsub("Enum%.KeyCode%.", "")
        btn.Text = text .. "  [" .. keyName .. "]  " .. (state and "ON" or "OFF")
        TweenService:Create(btn, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundColor3 = state and ST.GUIAccent or Color3.fromRGB(30, 30, 30), BackgroundTransparency = state and 0.3 or 0, BorderColor3 = state and ST.GUIAccent or Color3.fromRGB(60, 60, 60)}):Play()
    end
    refresh()
    btn.MouseButton1Click:Connect(function()
        if BindingStateKey == keyStateKey then return end
        ST[enabledKey] = not ST[enabledKey]
        refresh()
        if callback then callback(ST[enabledKey]) end
    end)
    btn.MouseButton2Click:Connect(function()
        BindingStateKey = keyStateKey
        btn.Text = "Press a key...  (right-click to cancel)"
    end)
    if onBindChanged then onBindChanged(refresh) end
    return btn, refresh
end

UserInputService.InputBegan:Connect(function(input, gpe)
    if input.KeyCode == Enum.KeyCode.RightShift then
        GuiToggleSerial = GuiToggleSerial + 1
        if ScreenGui.Enabled then AnimateGuiClose() else ScreenGui.Enabled = true AnimateGuiOpen() PulseAccent() end
        return
    end
    if BindingStateKey and input.UserInputType == Enum.UserInputType.Keyboard then
        if input.KeyCode == Enum.KeyCode.Escape then
            BindingStateKey = nil
            for k, v in pairs(ToggleVisuals) do v(ST[k]) end
            return
        end
        if UserInputService:GetFocusedTextBox() then return end
        local stateKey = BindingStateKey
        ST[stateKey] = input.KeyCode
        for k, refreshFn in pairs(BindRefreshCallbacks) do pcall(refreshFn) end
        BindingStateKey = nil
        local bindButton = ToggleBindButtons[stateKey]
        if bindButton then bindButton.Text = input.KeyCode.Name bindButton.BackgroundColor3 = Color3.fromRGB(20, 20, 20) bindButton.BackgroundTransparency = 0 end
        return
    end
    if gpe or UserInputService:GetFocusedTextBox() then return end
    if input.KeyCode == (ST.SpeedKey or Enum.KeyCode.Q) then
        ST.SpeedhackEnabled = not ST.SpeedhackEnabled
        for k, refreshFn in pairs(BindRefreshCallbacks) do pcall(refreshFn) end
        if not ST.SpeedhackEnabled then
            local char = LocalPlayer.Character
            if char then
                local hum = safeFindFirstChild(char, "Humanoid")
                if hum then hum.WalkSpeed = DEFAULT_WALKSPEED end
            end
        end
    end
    if input.KeyCode == (ST.JumpKey or Enum.KeyCode.Z) then
        ST.JumpBoostEnabled = not ST.JumpBoostEnabled
        for k, refreshFn in pairs(BindRefreshCallbacks) do pcall(refreshFn) end
        if not ST.JumpBoostEnabled then
            local char = LocalPlayer.Character
            if char then
                local hum = safeFindFirstChild(char, "Humanoid")
                if hum then hum.UseJumpPower = false hum.JumpPower = DEFAULT_JUMPPOWER end
            end
        end
    end
    if input.KeyCode == (ST.FlameLockKey or Enum.KeyCode.B) then ToggleFlameLockActive() end
    for stateKey, keyCode in pairs(ToggleBindings) do
        if input.KeyCode == keyCode then SetToggleState(stateKey, not ST[stateKey]) break end
    end
end)

ApplyColors = function()
    if MainFrame then MainFrame.BackgroundColor3 = ST.UIBackground end
    local function updateDescendants(obj)
        if not obj then return end
        for _, child in ipairs(obj:GetDescendants()) do
            local role = child:GetAttribute("ColorRole")
            if role then
                if role == "Accent" then
                    if child:IsA("TextLabel") or child:IsA("TextButton") then child.TextColor3 = ST.GUIAccent
                    elseif child:IsA("Frame") then child.BackgroundColor3 = ST.GUIAccent end
                elseif role == "Text" then
                    if child:IsA("TextLabel") or child:IsA("TextButton") or child:IsA("TextBox") then child.TextColor3 = ST.GUIText end
                elseif role == "SecondaryText" then
                    if child:IsA("TextLabel") or child:IsA("TextButton") then child.TextColor3 = ST.GUITextSecondary end
                elseif role == "Border" then
                    if child:IsA("Frame") then child.BorderColor3 = ST.GUIBorder end
                elseif role == "Panel" then
                    if child:IsA("Frame") then child.BackgroundColor3 = ST.GUIPanel child.BackgroundTransparency = 0 end
                elseif role == "Button" then
                    if child:IsA("TextButton") then child.BackgroundColor3 = ST.GUIButton child.BackgroundTransparency = 0 child.BorderColor3 = ST.GUIBorder
                    elseif child:IsA("Frame") then child.BackgroundColor3 = ST.GUIButton child.BackgroundTransparency = 0 end
                end
            end
        end
    end
    if MainFrame then updateDescendants(MainFrame) end
    if SliderData then for _, data in pairs(SliderData) do if data.fill then data.fill.BackgroundColor3 = ST.GUIAccent end if data.valueLabel then data.valueLabel.TextColor3 = ST.GUIAccent end end end
    if DropdownData then for _, data in pairs(DropdownData) do if data.list and data.list:IsA("ScrollingFrame") then data.list.ScrollBarImageColor3 = ST.GUIAccent end end end
    if TabContents then
        for _, content in pairs(TabContents) do
            if content then for _, child in ipairs(content:GetDescendants()) do if child:IsA("ScrollingFrame") then child.ScrollBarImageColor3 = ST.GUIAccent end end end
        end
    end
    if OuterBorder then OuterBorder.BackgroundColor3 = ST.GUIAccent end
    if TabIndicator then TabIndicator.BackgroundColor3 = ST.GUIAccent end
    if TabSeparator then TabSeparator.BackgroundColor3 = ST.GUIAccent end
    if TitleText then TitleText.TextColor3 = ST.GUIAccent end
    for stateKey, visual in pairs(ToggleVisuals) do visual(ST[stateKey]) end
    for k, refreshFn in pairs(BindRefreshCallbacks) do pcall(refreshFn) end
    if CamlockFOVCircle then CamlockFOVCircle.Color = ST.GUIAccent end
    if SilentAimFOVCircle then SilentAimFOVCircle.Color = ST.GUIAccent end
end

local function updateBackgroundCallback() ApplyColors() end
local function updateAccentCallback() ApplyColors() end
local function updatePanelCallback() ApplyColors() end
local function updateButtonCallback() ApplyColors() end
local function updateTextCallback() ApplyColors() end
local function updateSecondaryTextCallback() ApplyColors() end
local function updateBorderCallback() ApplyColors() end

local function CreateColorWheel(parent, x, y, labelText, stateKey, onColorChanged)
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(1, -10, 0, 26)
    frame.Position = UDim2.new(0, 5, 0, y)
    frame.BackgroundTransparency = 0
    frame.BackgroundColor3 = ST.GUIPanel
    frame.BorderSizePixel = 0
    frame.ZIndex = 6
    frame.Parent = parent
    frame:SetAttribute("ColorRole", "Panel")
    local label = Instance.new("TextLabel")
    label.Size = UDim2.new(0, 100, 1, 0)
    label.Position = UDim2.new(0, x, 0, 0)
    label.Text = labelText
    label.TextColor3 = ST.GUITextSecondary
    label.TextSize = 10
    label.Font = Enum.Font.SourceSans
    label.BackgroundTransparency = 1
    label.TextXAlignment = Enum.TextXAlignment.Left
    label.ZIndex = 7
    label.Parent = frame
    label:SetAttribute("ColorRole", "SecondaryText")
    local colorBtn = Instance.new("TextButton")
    colorBtn.Size = UDim2.new(0, 22, 0, 22)
    colorBtn.Position = UDim2.new(1, -26, 0.5, -11)
    colorBtn.BackgroundColor3 = ST[stateKey] or Color3.fromRGB(255, 153, 170)
    colorBtn.BackgroundTransparency = 0
    colorBtn.BorderSizePixel = 1
    colorBtn.BorderColor3 = Color3.fromRGB(60, 60, 60)
    colorBtn.Text = ""
    colorBtn.AutoButtonColor = false
    colorBtn.ZIndex = 7
    colorBtn.Parent = frame
    colorBtn:SetAttribute("ColorRole", "Button")
    local picker = Instance.new("Frame")
    picker.Size = UDim2.new(0, 164, 0, 172)
    picker.BackgroundColor3 = Color3.fromRGB(16, 16, 16)
    picker.BorderSizePixel = 1
    picker.BorderColor3 = Color3.fromRGB(55, 55, 55)
    picker.Visible = false
    picker.ZIndex = 100
    picker.Parent = ScreenGui
    picker:SetAttribute("ColorRole", "Panel")
    local titleBar = Instance.new("TextLabel")
    titleBar.Size = UDim2.new(1, 0, 0, 17)
    titleBar.BackgroundColor3 = Color3.fromRGB(25, 25, 25)
    titleBar.Text = "Color picker"
    titleBar.TextColor3 = Color3.fromRGB(190, 190, 190)
    titleBar.TextSize = 10
    titleBar.Font = Enum.Font.SourceSans
    titleBar.TextXAlignment = Enum.TextXAlignment.Left
    titleBar.ZIndex = 101
    titleBar.Parent = picker
    local sv = Instance.new("Frame")
    sv.Size = UDim2.new(0, 130, 0, 130)
    sv.Position = UDim2.new(0, 5, 0, 21)
    sv.BackgroundColor3 = Color3.fromHSV(0, 1, 1)
    sv.Active = true
    sv.ZIndex = 101
    sv.Parent = picker
    local satOverlay = Instance.new("Frame")
    satOverlay.Size = UDim2.new(1, 0, 1, 0)
    satOverlay.BackgroundColor3 = Color3.new(1, 1, 1)
    satOverlay.ZIndex = 102
    satOverlay.Active = true
    satOverlay.Parent = sv
    local satGrad = Instance.new("UIGradient")
    satGrad.Transparency = NumberSequence.new({NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(1, 1)})
    satGrad.Parent = satOverlay
    local valOverlay = Instance.new("Frame")
    valOverlay.Size = UDim2.new(1, 0, 1, 0)
    valOverlay.BackgroundColor3 = Color3.new(0, 0, 0)
    valOverlay.ZIndex = 103
    valOverlay.Active = true
    valOverlay.Parent = sv
    local valGrad = Instance.new("UIGradient")
    valGrad.Rotation = 90
    valGrad.Transparency = NumberSequence.new({NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(1, 0)})
    valGrad.Parent = valOverlay
    local svMarker = Instance.new("Frame")
    svMarker.Size = UDim2.new(0, 6, 0, 6)
    svMarker.AnchorPoint = Vector2.new(0.5, 0.5)
    svMarker.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    svMarker.BorderColor3 = Color3.fromRGB(20, 20, 20)
    svMarker.BorderSizePixel = 1
    svMarker.ZIndex = 104
    svMarker.Parent = sv
    local hue = Instance.new("Frame")
    hue.Size = UDim2.new(0, 14, 0, 130)
    hue.Position = UDim2.new(0, 140, 0, 21)
    hue.BackgroundColor3 = Color3.fromRGB(255, 0, 0)
    hue.BorderSizePixel = 1
    hue.BorderColor3 = Color3.fromRGB(45, 45, 45)
    hue.Active = true
    hue.ZIndex = 101
    hue.Parent = picker
    local hueGrad = Instance.new("UIGradient")
    hueGrad.Rotation = 90
    hueGrad.Color = ColorSequence.new({
        ColorSequenceKeypoint.new(0.00, Color3.fromRGB(255, 0, 0)),
        ColorSequenceKeypoint.new(0.17, Color3.fromRGB(255, 255, 0)),
        ColorSequenceKeypoint.new(0.33, Color3.fromRGB(0, 255, 0)),
        ColorSequenceKeypoint.new(0.50, Color3.fromRGB(0, 255, 255)),
        ColorSequenceKeypoint.new(0.67, Color3.fromRGB(0, 0, 255)),
        ColorSequenceKeypoint.new(0.83, Color3.fromRGB(255, 0, 255)),
        ColorSequenceKeypoint.new(1.00, Color3.fromRGB(255, 0, 0))
    })
    hueGrad.Parent = hue
    local hueMarker = Instance.new("Frame")
    hueMarker.Size = UDim2.new(1, 4, 0, 3)
    hueMarker.Position = UDim2.new(0, -2, 0, 0)
    hueMarker.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    hueMarker.ZIndex = 104
    hueMarker.Parent = hue
    local hexBox = Instance.new("TextBox")
    hexBox.Size = UDim2.new(0, 73, 0, 17)
    hexBox.Position = UDim2.new(0, 5, 1, -22)
    hexBox.BackgroundColor3 = Color3.fromRGB(28, 28, 28)
    hexBox.BorderSizePixel = 1
    hexBox.BorderColor3 = Color3.fromRGB(55, 55, 55)
    hexBox.TextColor3 = Color3.fromRGB(180, 180, 180)
    hexBox.TextSize = 9
    hexBox.Font = Enum.Font.SourceSans
    hexBox.ClearTextOnFocus = false
    hexBox.ZIndex = 101
    hexBox.Parent = picker
    local rgbBox = Instance.new("TextBox")
    rgbBox.Size = UDim2.new(0, 80, 0, 17)
    rgbBox.Position = UDim2.new(0, 82, 1, -22)
    rgbBox.BackgroundColor3 = Color3.fromRGB(28, 28, 28)
    rgbBox.BorderSizePixel = 1
    rgbBox.BorderColor3 = Color3.fromRGB(55, 55, 55)
    rgbBox.TextColor3 = Color3.fromRGB(180, 180, 180)
    rgbBox.TextSize = 9
    rgbBox.Font = Enum.Font.SourceSans
    rgbBox.ClearTextOnFocus = false
    rgbBox.ZIndex = 101
    rgbBox.Parent = picker
    local h, s, v = Color3.toHSV(ST[stateKey] or Color3.fromRGB(255, 153, 170))
    local function updatePickerVisuals(color)
        h, s, v = Color3.toHSV(color)
        sv.BackgroundColor3 = Color3.fromHSV(h, 1, 1)
        svMarker.Position = UDim2.new(s, 0, 1 - v, 0)
        hueMarker.Position = UDim2.new(0, -2, math.clamp(h, 0, 1), -1)
        local r = math.floor(color.R * 255 + 0.5)
        local g = math.floor(color.G * 255 + 0.5)
        local b = math.floor(color.B * 255 + 0.5)
        hexBox.Text = string.format("#%02X%02X%02X", r, g, b)
        rgbBox.Text = string.format("%d, %d, %d", r, g, b)
        colorBtn.BackgroundColor3 = color
    end
    local function setColor(color)
        if not color then return end
        ST[stateKey] = color
        updatePickerVisuals(color)
        if onColorChanged then onColorChanged(color) end
    end
    local function updateFromSV(input)
        if not input or not input.Position then return end
        local px = math.clamp((input.Position.X - sv.AbsolutePosition.X) / math.max(sv.AbsoluteSize.X, 1), 0, 1)
        local py = math.clamp((input.Position.Y - sv.AbsolutePosition.Y) / math.max(sv.AbsoluteSize.Y, 1), 0, 1)
        setColor(Color3.fromHSV(h, px, 1 - py))
    end
    local function updateFromHue(input)
        if not input or not input.Position then return end
        local py = math.clamp((input.Position.Y - hue.AbsolutePosition.Y) / math.max(hue.AbsoluteSize.Y - 1, 1), 0, 1)
        h = py
        setColor(Color3.fromHSV(h, s, v))
    end
    local draggingSV, draggingHue = false, false
    sv.InputBegan:Connect(function(input) if input.UserInputType == Enum.UserInputType.MouseButton1 then draggingSV = true updateFromSV(input) end end)
    satOverlay.InputBegan:Connect(function(input) if input.UserInputType == Enum.UserInputType.MouseButton1 then draggingSV = true updateFromSV(input) end end)
    valOverlay.InputBegan:Connect(function(input) if input.UserInputType == Enum.UserInputType.MouseButton1 then draggingSV = true updateFromSV(input) end end)
    hue.InputBegan:Connect(function(input) if input.UserInputType == Enum.UserInputType.MouseButton1 then draggingHue = true updateFromHue(input) end end)
    UserInputService.InputChanged:Connect(function(input)
        if input.UserInputType ~= Enum.UserInputType.MouseMovement then return end
        if draggingSV then updateFromSV(input) elseif draggingHue then updateFromHue(input) end
    end)
    UserInputService.InputEnded:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 then draggingSV = false draggingHue = false end
    end)
    local function parseHex(str)
        str = str:gsub("#", ""):gsub("%s+", "")
        if #str ~= 6 then return nil end
        local r = tonumber(str:sub(1,2), 16)
        local g = tonumber(str:sub(3,4), 16)
        local b = tonumber(str:sub(5,6), 16)
        if r and g and b then return Color3.fromRGB(r, g, b) end
        return nil
    end
    hexBox.FocusLost:Connect(function()
        local color = parseHex(hexBox.Text)
        if color then setColor(color) else updatePickerVisuals(ST[stateKey]) end
    end)
    rgbBox.FocusLost:Connect(function()
        local r, g, b = rgbBox.Text:match("(%d+)%s*[, ]%s*(%d+)%s*[, ]%s*(%d+)")
        r, g, b = tonumber(r), tonumber(g), tonumber(b)
        if r and g and b then setColor(Color3.fromRGB(math.clamp(r,0,255), math.clamp(g,0,255), math.clamp(b,0,255)))
        else updatePickerVisuals(ST[stateKey]) end
    end)
    local pickerOpen = false
    colorBtn.MouseEnter:Connect(function() TweenService:Create(colorBtn, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BorderColor3 = ST.GUIAccent}):Play() end)
    colorBtn.MouseLeave:Connect(function() if not pickerOpen then TweenService:Create(colorBtn, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BorderColor3 = Color3.fromRGB(60,60,60)}):Play() end end)
    colorBtn.MouseButton1Click:Connect(function()
        pickerOpen = not pickerOpen
        if pickerOpen then
            updatePickerVisuals(ST[stateKey])
            local btnPos = colorBtn.AbsolutePosition
            local btnSize = colorBtn.AbsoluteSize
            if not btnPos or not btnSize then return end
            local x = btnPos.X + btnSize.X + 5
            local y = btnPos.Y - 80
            if x + 164 > Camera.ViewportSize.X then x = btnPos.X - 164 - 5 end
            if y < 0 then y = 0 end
            if y + 172 > Camera.ViewportSize.Y then y = Camera.ViewportSize.Y - 172 end
            picker.Position = UDim2.new(0, x, 0, y)
            picker.Visible = true
            picker.Size = UDim2.new(0, 164, 0, 0)
            TweenService:Create(picker, TweenInfo.new(0.20, Enum.EasingStyle.Quart, Enum.EasingDirection.Out), {Size = UDim2.new(0, 164, 0, 172)}):Play()
        else
            local t = TweenService:Create(picker, TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {Size = UDim2.new(0, 164, 0, 0)})
            t:Play()
            t.Completed:Connect(function() if not pickerOpen then picker.Visible = false end end)
        end
    end)
    updatePickerVisuals(ST[stateKey])
    return colorBtn
end

local function CreateSectionTitle(parent, y, text)
    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, -10, 0, 16)
    title.Position = UDim2.new(0, 5, 0, y)
    title.Text = text
    title.TextColor3 = ST.GUIText
    title.TextSize = 11
    title.Font = Enum.Font.SourceSans
    title.BackgroundTransparency = 1
    title.TextXAlignment = Enum.TextXAlignment.Left
    title.ZIndex = 7
    title.Parent = parent
    title:SetAttribute("ColorRole", "Text")
    return title
end

local function CreateDivider(parent, y, width)
    local div = Instance.new("Frame")
    div.Size = UDim2.new(width or 1, 0, 0, 1)
    div.Position = UDim2.new(0, 5, 0, y)
    div.BackgroundColor3 = ST.GUIAccent
    div.BackgroundTransparency = 0.4
    div.BorderSizePixel = 0
    div.ZIndex = 6
    div.Parent = parent
    div:SetAttribute("ColorRole", "Accent")
    return div
end

local function CreateLabel(parent, x, y, text, color)
    local label = Instance.new("TextLabel")
    label.Size = UDim2.new(0, 120, 0, 18)
    label.Position = UDim2.new(0, x, 0, y)
    label.Text = text
    label.TextColor3 = color or ST.GUIText
    label.TextSize = 11
    label.Font = Enum.Font.SourceSans
    label.BackgroundTransparency = 1
    label.TextXAlignment = Enum.TextXAlignment.Left
    label.ZIndex = 7
    label.Parent = parent
    label:SetAttribute("ColorRole", "Text")
    return label
end

local function CreateSlider(parent, x, y, text, min, max, default, stateKey, callback)
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(1, -10, 0, 25)
    frame.Position = UDim2.new(0, 5, 0, y)
    frame.BackgroundTransparency = 0
    frame.BackgroundColor3 = ST.GUIPanel
    frame.BorderSizePixel = 0
    frame.ZIndex = 6
    frame.Parent = parent
    frame:SetAttribute("ColorRole", "Panel")
    local label = Instance.new("TextLabel")
    label.Size = UDim2.new(0, 100, 0, 16)
    label.Position = UDim2.new(0, x, 0, 0)
    label.Text = text
    label.TextColor3 = ST.GUITextSecondary
    label.TextSize = 10
    label.Font = Enum.Font.SourceSans
    label.BackgroundTransparency = 1
    label.TextXAlignment = Enum.TextXAlignment.Left
    label.ZIndex = 7
    label.Parent = frame
    label:SetAttribute("ColorRole", "SecondaryText")
    local valueLabel = Instance.new("TextLabel")
    valueLabel.Size = UDim2.new(0, 30, 0, 16)
    valueLabel.Position = UDim2.new(1, -35, 0, 0)
    valueLabel.Text = tostring(default)
    valueLabel.TextColor3 = ST.GUIAccent
    valueLabel.TextSize = 10
    valueLabel.Font = Enum.Font.SourceSans
    valueLabel.BackgroundTransparency = 1
    valueLabel.TextXAlignment = Enum.TextXAlignment.Right
    valueLabel.ZIndex = 7
    valueLabel.Parent = frame
    valueLabel:SetAttribute("ColorRole", "Accent")
    local track = Instance.new("Frame")
    track.Size = UDim2.new(1, -125, 0, 3)
    track.Position = UDim2.new(0, 105, 0, 17)
    track.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
    track.BorderSizePixel = 0
    track.ZIndex = 6
    track.Parent = frame
    local fill = Instance.new("Frame")
    local percent = (default - min) / (max - min)
    fill.Size = UDim2.new(percent, 0, 1, 0)
    fill.BackgroundColor3 = ST.GUIAccent
    fill.BorderSizePixel = 0
    fill.ZIndex = 7
    fill.Parent = track
    fill:SetAttribute("ColorRole", "Accent")
    local knob = Instance.new("Frame")
    knob.Size = UDim2.new(0, 10, 0, 10)
    knob.Position = UDim2.new(percent, -5, 0.5, -5)
    knob.BackgroundColor3 = Color3.fromRGB(200, 200, 200)
    knob.BorderSizePixel = 0
    knob.ZIndex = 7
    knob.Parent = track
    SliderData[frame] = { fill = fill, valueLabel = valueLabel }
    local value = default
    local dragging = false
    local function updateSlider(input)
        if not track or not track.AbsolutePosition then return end
        if not input or not input.Position then return end
        local pos = input.Position.X - track.AbsolutePosition.X
        if not pos then return end
        local newPercent = math.clamp(pos / math.max(track.AbsoluteSize.X, 1), 0, 1)
        value = min + (max - min) * newPercent
        value = math.round(value * 100) / 100
        fill.Size = UDim2.new(newPercent, 0, 1, 0)
        knob.Position = UDim2.new(newPercent, -5, 0.5, -5)
        valueLabel.Text = tostring(value)
        ST[stateKey] = value
        if callback then callback(value) end
    end
    knob.InputBegan:Connect(function(input) if input.UserInputType == Enum.UserInputType.MouseButton1 then dragging = true updateSlider(input) end end)
    track.InputBegan:Connect(function(input) if input.UserInputType == Enum.UserInputType.MouseButton1 then dragging = true updateSlider(input) end end)
    UserInputService.InputChanged:Connect(function(input) if dragging and input.UserInputType == Enum.UserInputType.MouseMovement then updateSlider(input) end end)
    UserInputService.InputEnded:Connect(function(input) if input.UserInputType == Enum.UserInputType.MouseButton1 then dragging = false end end)
    return fill
end

local function CreateDropdown(parent, x, y, text, options, default, stateKey, callback)
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(1, -10, 0, 20)
    frame.Position = UDim2.new(0, 5, 0, y)
    frame.BackgroundTransparency = 0
    frame.BackgroundColor3 = ST.GUIPanel
    frame.BorderSizePixel = 0
    frame.ZIndex = 6
    frame.Parent = parent
    frame:SetAttribute("ColorRole", "Panel")
    local label = Instance.new("TextLabel")
    label.Size = UDim2.new(0, 100, 1, 0)
    label.Position = UDim2.new(0, x, 0, 0)
    label.Text = text
    label.TextColor3 = ST.GUIText
    label.TextSize = 11
    label.Font = Enum.Font.SourceSans
    label.BackgroundTransparency = 1
    label.TextXAlignment = Enum.TextXAlignment.Left
    label.ZIndex = 7
    label.Parent = frame
    label:SetAttribute("ColorRole", "Text")
    local selected = default or options[1]
    if ST[stateKey] then selected = ST[stateKey] end
    local btn = Instance.new("TextButton")
    btn.Size = UDim2.new(0, 120, 1, 0)
    btn.Position = UDim2.new(1, -135, 0, 0)
    btn.Text = selected
    btn.TextColor3 = Color3.fromRGB(200, 200, 200)
    btn.TextSize = 10
    btn.Font = Enum.Font.SourceSans
    btn.BackgroundColor3 = Color3.fromRGB(20, 20, 20)
    btn.BorderSizePixel = 1
    btn.BorderColor3 = Color3.fromRGB(50, 50, 50)
    btn.ZIndex = 7
    btn.Parent = frame
    btn:SetAttribute("ColorRole", "Button")
    local list = Instance.new("ScrollingFrame")
    list.Size = UDim2.new(0, 135, 0, 0)
    list.Position = UDim2.new(1, -135, 1, 0)
    list.BackgroundColor3 = Color3.fromRGB(15, 15, 15)
    list.BorderSizePixel = 1
    list.BorderColor3 = Color3.fromRGB(50, 50, 50)
    list.Visible = false
    list.ZIndex = 15
    list.CanvasSize = UDim2.new(0, 0, 0, #options * 20)
    list.ScrollBarThickness = 3
    list.ScrollBarImageColor3 = ST.GUIAccent
    list.Parent = frame
    list:SetAttribute("ColorRole", "Panel")
    DropdownData[frame] = { list = list }
    local maxHeight = math.min(#options * 20, 100)
    list.Size = UDim2.new(0, 135, 0, maxHeight)
    for i, opt in ipairs(options) do
        local optBtn = Instance.new("TextButton")
        optBtn.Size = UDim2.new(1, 0, 0, 18)
        optBtn.Position = UDim2.new(0, 0, 0, (i - 1) * 18)
        optBtn.Text = opt
        optBtn.TextColor3 = Color3.fromRGB(200, 200, 200)
        optBtn.TextSize = 10
        optBtn.Font = Enum.Font.SourceSans
        optBtn.BackgroundColor3 = Color3.fromRGB(25, 25, 25)
        optBtn.BorderSizePixel = 0
        optBtn.ZIndex = 16
        optBtn.Parent = list
        optBtn:SetAttribute("ColorRole", "Button")
        optBtn.MouseEnter:Connect(function() optBtn.BackgroundColor3 = ST.GUIAccent optBtn.BackgroundTransparency = 0.5 end)
        optBtn.MouseLeave:Connect(function() optBtn.BackgroundColor3 = Color3.fromRGB(25, 25, 25) optBtn.BackgroundTransparency = 0 end)
        optBtn.MouseButton1Click:Connect(function()
            selected = opt
            btn.Text = opt
            list.Visible = false
            ST[stateKey] = opt
            if callback then callback(opt) end
        end)
    end
    local dropdownOpen = false
    btn.MouseButton1Click:Connect(function()
        dropdownOpen = not dropdownOpen
        if dropdownOpen then
            list.Visible = true
        else
            list.Visible = false
        end
    end)
    return btn
end

-- GUI BUILDER
MainFrame = Instance.new("Frame")
MainFrame.Size = UDim2.new(0, 500, 0, 420)
MainFrame.Position = UDim2.new(0.5, -250, 0.5, -210)
MainFrame.BackgroundColor3 = ST.UIBackground
MainFrame.BorderSizePixel = 0
MainFrame.ZIndex = 0
MainFrame.Parent = ScreenGui
MainFrame:SetAttribute("ColorRole", "Panel")

OuterBorder = Instance.new("Frame")
OuterBorder.Size = UDim2.new(1, 0, 1, 0)
OuterBorder.BackgroundColor3 = ST.GUIAccent
OuterBorder.BackgroundTransparency = 0.8
OuterBorder.BorderSizePixel = 0
OuterBorder.ZIndex = 3
OuterBorder.Parent = MainFrame
OuterBorder:SetAttribute("ColorRole", "Accent")

local InnerBorder = Instance.new("Frame")
InnerBorder.Size = UDim2.new(1, -2, 1, -2)
InnerBorder.Position = UDim2.new(0, 1, 0, 1)
InnerBorder.BackgroundColor3 = Color3.fromRGB(12, 12, 12)
InnerBorder.BackgroundTransparency = 0.85
InnerBorder.BorderSizePixel = 0
InnerBorder.ZIndex = 4
InnerBorder.Parent = MainFrame

local MainScale = Instance.new("UIScale")
MainScale.Scale = 0.92
MainScale.Parent = MainFrame

local TitleBar = Instance.new("Frame")
TitleBar.Size = UDim2.new(1, 0, 0, 20)
TitleBar.Position = UDim2.new(0, 3, 0, 2)
TitleBar.BackgroundTransparency = 1
TitleBar.ZIndex = 5
TitleBar.Parent = MainFrame

local draggingWin, dragStartWin, startPosWin = false, nil, nil
TitleBar.InputBegan:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseButton1 then
        draggingWin = true
        dragStartWin = input.Position
        startPosWin = MainFrame.Position
    end
end)
TitleBar.InputEnded:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseButton1 then draggingWin = false end
end)
UserInputService.InputChanged:Connect(function(input)
    if draggingWin and input.UserInputType == Enum.UserInputType.MouseMovement and input.Position then
        local delta = input.Position - dragStartWin
        MainFrame.Position = UDim2.new(startPosWin.X.Scale, startPosWin.X.Offset + delta.X, startPosWin.Y.Scale, startPosWin.Y.Offset + delta.Y)
    end
end)

TitleText = Instance.new("TextLabel")
TitleText.Size = UDim2.new(0.6, 0, 1, 0)
TitleText.Text = "avdotya.exe - " .. os.date("%b. %d. %Y | %I:%M %p")
TitleText.TextColor3 = ST.GUIAccent
TitleText.TextSize = 10
TitleText.Font = Enum.Font.SourceSans
TitleText.BackgroundTransparency = 1
TitleText.TextXAlignment = Enum.TextXAlignment.Left
TitleText.ZIndex = 5
TitleText.Parent = TitleBar
TitleText:SetAttribute("ColorRole", "Accent")

spawn(function()
    while task.wait(60) do
        TitleText.Text = "avdotya.exe - " .. os.date("%b. %d. %Y | %I:%M %p")
    end
end)

local TabBar = Instance.new("Frame")
TabBar.Size = UDim2.new(1, 0, 0, 22)
TabBar.Position = UDim2.new(0, 0, 0, 22)
TabBar.BackgroundTransparency = 1
TabBar.ZIndex = 5
TabBar.Parent = MainFrame

local Tabs = {"Camlock", "Silent", "Visual", "Hitbox", "Movement", "Flamelock", "Players", "Settings"}
local TabButtons = {}

for i, tabName in ipairs(Tabs) do
    local btn = Instance.new("TextButton")
    btn.Size = UDim2.new(1 / #Tabs, 0, 1, 0)
    btn.Position = UDim2.new((i - 1) / #Tabs, 0, 0, 0)
    btn.Text = tabName
    btn.TextColor3 = (i == 1) and ST.GUIText or Color3.fromRGB(100, 100, 100)
    btn.TextSize = 10
    btn.Font = Enum.Font.SourceSans
    btn.BackgroundTransparency = 1
    btn.BorderSizePixel = 0
    btn.ZIndex = 5
    btn.Parent = TabBar
    btn:SetAttribute("ColorRole", "Text")
    TabButtons[tabName] = btn
    local content = Instance.new("ScrollingFrame")
    content.Size = UDim2.new(1, -6, 1, -50)
    content.Position = UDim2.new(0, 3, 0, 46)
    content.BackgroundTransparency = 1
    content.BorderSizePixel = 0
    content.ClipsDescendants = true
    content.ScrollingDirection = Enum.ScrollingDirection.Y
    content.ElasticBehavior = Enum.ElasticBehavior.Never
    content.Visible = (i == 1)
    content.ScrollBarThickness = 3
    content.ScrollBarImageColor3 = ST.GUIAccent
    content.CanvasSize = UDim2.new(0, 0, 0, 1600)
    content.ZIndex = 5
    content.Parent = MainFrame
    content:SetAttribute("ColorRole", "Panel")
    TabContents[tabName] = content
    btn.MouseButton1Click:Connect(function()
        for tab, c in pairs(TabContents) do c.Visible = false end
        for _, b in pairs(TabButtons) do TweenService:Create(b, TweenInfo.new(0.15), {TextColor3 = Color3.fromRGB(100,100,100)}):Play() end
        TweenService:Create(btn, TweenInfo.new(0.2), {TextColor3 = ST.GUIAccent}):Play()
        content.Visible = true
        if TabIndicator then
            TweenService:Create(TabIndicator, TweenInfo.new(0.25, Enum.EasingStyle.Quart), {Position = UDim2.new((i - 1) / #Tabs, 5, 0, 42), Size = UDim2.new(1 / #Tabs, -10, 0, 2)}):Play()
        end
    end)
end

TabSeparator = Instance.new("Frame")
TabSeparator.Size = UDim2.new(1, -6, 0, 1)
TabSeparator.Position = UDim2.new(0, 3, 0, 44)
TabSeparator.BackgroundColor3 = ST.GUIAccent
TabSeparator.BackgroundTransparency = 0.6
TabSeparator.ZIndex = 5
TabSeparator.Parent = MainFrame
TabSeparator:SetAttribute("ColorRole", "Accent")

TabIndicator = Instance.new("Frame")
TabIndicator.Size = UDim2.new(1 / #Tabs, -10, 0, 2)
TabIndicator.Position = UDim2.new(0, 5, 0, 42)
TabIndicator.BackgroundColor3 = ST.GUIAccent
TabIndicator.ZIndex = 5
TabIndicator.Parent = MainFrame
TabIndicator:SetAttribute("ColorRole", "Accent")

-- CAMLOCK TAB
local camlockContent = TabContents["Camlock"]
local cy = 5
CreateSectionTitle(camlockContent, cy, "Camlock"); cy = cy + 20
CreateToggleButton(camlockContent, 5, cy, "Camlock [ON/OFF]", "Camlock", function(state) CamlockActive = state if not state then ST.CamlockTarget = nil end UpdateCamlock() end, true); cy = cy + 28
CreateSlider(camlockContent, 5, cy, "Camlock FOV", 50, 500, 300, "CamlockFOV"); cy = cy + 32
CreateSlider(camlockContent, 5, cy, "Smoothness", 0.01, 0.5, 0.08, "CamlockSmoothness"); cy = cy + 32
CreateSlider(camlockContent, 5, cy, "Prediction", 0, 0.5, 0.12, "CamlockPrediction"); cy = cy + 32
CreateDropdown(camlockContent, 5, cy, "Aim Part", {"Head","HumanoidRootPart","UpperTorso","LowerTorso","Left Leg","Right Leg","Left Arm","Right Arm"}, "Head", "CamlockPart"); cy = cy + 24
CreateDropdown(camlockContent, 5, cy, "Mode", {"Toggle","Hold"}, "Toggle", "CamlockMode"); cy = cy + 24
CreateToggle(camlockContent, 5, cy, "Show FOV Circle", "CamlockShowFOV"); cy = cy + 24
CreateToggle(camlockContent, 5, cy, "Knock Check", "CamlockKnockCheck"); cy = cy + 24
camlockContent.CanvasSize = UDim2.new(0,0,0, cy+50)

-- SILENT TAB
local silentContent = TabContents["Silent"]
local sy = 5
CreateToggleButton(silentContent, 5, sy, "Silent Aim [ON/OFF]", "SilentAim", function(state) UpdateSilentAim() end, true); sy = sy + 28
CreateSlider(silentContent, 5, sy, "FOV Radius", 50, 1000, 1000, "SilentAimFOV", function(val) SilentAimFOVCircle.Radius = val end); sy = sy + 32
CreateToggle(silentContent, 5, sy, "Show FOV Circle", "SilentAimShowFOV"); sy = sy + 24
CreateDropdown(silentContent, 5, sy, "Aim Part", {"Head","HumanoidRootPart","Left Leg","Right Leg","Left Arm","Right Arm","Closest Part"}, "Head", "SilentAimPart"); sy = sy + 24
CreateToggle(silentContent, 5, sy, "Revolver Bypass", "RevolverBypass"); sy = sy + 22
CreateToggle(silentContent, 5, sy, "Wall Check", "WallCheck"); sy = sy + 22
CreateToggle(silentContent, 5, sy, "Knock Check", "SilentAimKnockCheck"); sy = sy + 28
CreateDivider(silentContent, sy, 0.9); sy = sy + 6
CreateSectionTitle(silentContent, sy, "Bullet Spread"); sy = sy + 20
CreateToggle(silentContent, 5, sy, "Bullet Spread [ON/OFF]", "BulletSpread", function(state) UpdateBulletSpread() end); sy = sy + 24
CreateSlider(silentContent, 5, sy, "Spread Amount", 0, 100, 100, "BulletSpreadValue", function(value) UpdateBulletSpread() end); sy = sy + 32
silentContent.CanvasSize = UDim2.new(0,0,0, sy+50)

-- VISUAL TAB
local visualContent = TabContents["Visual"]
local vy = 5
CreateToggle(visualContent, 5, vy, "ESP [ON/OFF]", "ESP", function(state) if state and not espInitialized then InitializeESP() end end); vy = vy + 24
CreateToggle(visualContent, 5, vy, "ESP Boxes", "ESPBox"); vy = vy + 22
CreateToggle(visualContent, 5, vy, "ESP Names", "ESPName"); vy = vy + 22
CreateToggle(visualContent, 5, vy, "ESP Health", "ESPHealth"); vy = vy + 22
CreateToggle(visualContent, 5, vy, "ESP Distance", "ESPDistance"); vy = vy + 22
CreateToggle(visualContent, 5, vy, "ESP Tracers", "ESPTracers"); vy = vy + 28
CreateDivider(visualContent, vy, 0.9); vy = vy + 6
CreateSectionTitle(visualContent, vy, "ESP Color"); vy = vy + 20
CreateColorWheel(visualContent, 5, vy, "Select Color", "ESPColor"); vy = vy + 30
CreateDivider(visualContent, vy, 0.9); vy = vy + 6
CreateToggleButton(visualContent, 5, vy, "Fog [ON/OFF]", "Fog", function(state) UpdateFog() end, false); vy = vy + 28
CreateSlider(visualContent, 5, vy, "Fog Density", 0.001, 0.1, 0.02, "FogDensity", function(value) UpdateFog() end); vy = vy + 32
CreateColorWheel(visualContent, 5, vy, "Fog Color", "FogColor", UpdateFog); vy = vy + 30
vy = vy + 200
visualContent.CanvasSize = UDim2.new(0,0,0, vy)

-- HITBOX TAB
local hitboxContent = TabContents["Hitbox"]
local hy = 5
CreateSectionTitle(hitboxContent, hy, "Hitbox Expander"); hy = hy + 20
CreateToggleButton(hitboxContent, 5, hy, "Hitbox [ON/OFF]", "Hitbox", function(state) UpdateHitbox() end, true); hy = hy + 28
CreateSlider(hitboxContent, 5, hy, "Size", 2, 30, 10, "HitboxSize", function(value) UpdateHitbox() end); hy = hy + 32
CreateSlider(hitboxContent, 5, hy, "Opacity", 0.1, 1, 0.9, "HitboxOpacity", function(value) UpdateHitbox() end); hy = hy + 32
hitboxContent.CanvasSize = UDim2.new(0,0,0, hy+50)

-- MOVEMENT TAB
local movementContent = TabContents["Movement"]
local my = 5
CreateSectionTitle(movementContent, my, "Speedhack"); my = my + 20
local _, speedRefresh = CreateToggleWithBind(
    movementContent, my, "Speedhack", "SpeedhackEnabled", "SpeedKey",
    function(state)
        if not state then
            local char = LocalPlayer.Character
            if char then
                local hum = safeFindFirstChild(char, "Humanoid")
                if hum then hum.WalkSpeed = DEFAULT_WALKSPEED end
            end
        end
    end,
    function(refreshFn) table.insert(BindRefreshCallbacks, refreshFn) end
)
my = my + 32
CreateSlider(movementContent, 5, my, "Speed Value", 16, 300, 50, "SpeedValue", function(value)
    if ST.SpeedhackEnabled then
        local char = LocalPlayer.Character
        if char then
            local hum = safeFindFirstChild(char, "Humanoid")
            if hum then hum.WalkSpeed = value end
        end
    end
end); my = my + 32
CreateLabel(movementContent, 5, my, "Left-click to toggle  Right-click to bind", Color3.fromRGB(150,150,150)); my = my + 20
CreateDivider(movementContent, my, 0.9); my = my + 6
CreateSectionTitle(movementContent, my, "Jump Boost"); my = my + 20
local _, jumpRefresh = CreateToggleWithBind(
    movementContent, my, "Jump Boost", "JumpBoostEnabled", "JumpKey",
    function(state)
        if not state then
            local char = LocalPlayer.Character
            if char then
                local hum = safeFindFirstChild(char, "Humanoid")
                if hum then hum.UseJumpPower = false hum.JumpPower = DEFAULT_JUMPPOWER end
            end
        end
    end,
    function(refreshFn) table.insert(BindRefreshCallbacks, refreshFn) end
)
my = my + 32
CreateSlider(movementContent, 5, my, "Jump Power", 50, 500, 150, "JumpValue", function(value)
    if ST.JumpBoostEnabled then
        local char = LocalPlayer.Character
        if char then
            local hum = safeFindFirstChild(char, "Humanoid")
            if hum then hum.UseJumpPower = true hum.JumpPower = value end
        end
    end
end); my = my + 32
CreateLabel(movementContent, 5, my, "Left-click to toggle  Right-click to bind", Color3.fromRGB(150,150,150)); my = my + 20
CreateDivider(movementContent, my, 0.9); my = my + 6
CreateToggle(movementContent, 5, my, "Teleport", "Teleport"); my = my + 24
CreateLabel(movementContent, 5, my, "Target Name", Color3.fromRGB(160,160,160)); my = my + 18
local tpInput = Instance.new("TextBox")
tpInput.Size = UDim2.new(0,150,0,20); tpInput.Position = UDim2.new(0,5,0,my)
tpInput.BackgroundColor3 = Color3.fromRGB(20,20,20)
tpInput.BorderSizePixel = 1
tpInput.BorderColor3 = Color3.fromRGB(50,50,50)
tpInput.PlaceholderText = "username..."
tpInput.TextColor3 = Color3.fromRGB(200,200,200)
tpInput.PlaceholderColor3 = Color3.fromRGB(80,80,80)
tpInput.Font = Enum.Font.SourceSans
tpInput.TextSize = 11
tpInput.ZIndex = 7
tpInput.Parent = movementContent
tpInput:SetAttribute("ColorRole", "Text")
tpInput.FocusLost:Connect(function() ST.TeleportTarget = tpInput.Text end)
my = my + 24
local tpActionBtn = Instance.new("TextButton")
tpActionBtn.Size = UDim2.new(0,80,0,20); tpActionBtn.Position = UDim2.new(0,160,0,my-22)
tpActionBtn.Text = "TELEPORT"
tpActionBtn.TextColor3 = Color3.fromRGB(200,200,200)
tpActionBtn.TextSize = 10
tpActionBtn.Font = Enum.Font.SourceSans
tpActionBtn.BackgroundColor3 = ST.GUIAccent
tpActionBtn.BackgroundTransparency = 0.3
tpActionBtn.BorderSizePixel = 0
tpActionBtn.ZIndex = 7
tpActionBtn.Parent = movementContent
tpActionBtn:SetAttribute("ColorRole", "Accent")
tpActionBtn.MouseButton1Click:Connect(function() TeleportToPlayer(ST.TeleportTarget) end)
my = my + 24
movementContent.CanvasSize = UDim2.new(0,0,0, my+50)

-- FLAMELOCK TAB
local flameContent = TabContents["Flamelock"]
local fy = 5
CreateSectionTitle(flameContent, fy, "Flamelock"); fy = fy + 20
CreateToggleButton(flameContent, 5, fy, "Flamelock [ON/OFF]", "FlameLock", function(state)
    if state then FlameLockActive = false ToggleFlameLockActive() else StopFlameLock() end
end, false); fy = fy + 28
local flameKeyFrame = Instance.new("Frame")
flameKeyFrame.Size = UDim2.new(1, -10, 0, 24)
flameKeyFrame.Position = UDim2.new(0, 5, 0, fy)
flameKeyFrame.BackgroundTransparency = 1
flameKeyFrame.Parent = flameContent
CreateKeybindButton(flameKeyFrame, "FlameLockKey"); fy = fy + 28
CreateSlider(flameContent, 5, fy, "FOV", 50, 500, 250, "FlameLockFOV"); fy = fy + 32
CreateSlider(flameContent, 5, fy, "Smoothness", 0.05, 1, 0.5, "FlameLockSmoothness"); fy = fy + 32
flameContent.CanvasSize = UDim2.new(0,0,0, fy+50)

-- PLAYERS TAB
local playersContent = TabContents["Players"]
local py = 5
CreateSectionTitle(playersContent, py, "Whitelist"); py = py + 20
local wlScroll = Instance.new("ScrollingFrame")
wlScroll.Size = UDim2.new(1,-10,0,120); wlScroll.Position = UDim2.new(0,5,0,py)
wlScroll.BackgroundColor3 = Color3.fromRGB(10,10,10)
wlScroll.BorderSizePixel = 1
wlScroll.BorderColor3 = Color3.fromRGB(40,40,40)
wlScroll.ScrollBarThickness = 3
wlScroll.ScrollBarImageColor3 = ST.GUIAccent
wlScroll.Parent = playersContent
local function UpdateWhitelist()
    for _, child in pairs(wlScroll:GetChildren()) do if child:IsA("Frame") then child:Destroy() end end
    local idx = 0
    for _, player in ipairs(Players:GetPlayers()) do
        if player == LocalPlayer then continue end
        idx = idx + 1
        local row = Instance.new("Frame")
        row.Size = UDim2.new(1,0,0,20)
        row.Position = UDim2.new(0,0,0,(idx-1)*22)
        row.BackgroundTransparency = 1
        row.Parent = wlScroll
        local nameLabel = Instance.new("TextLabel")
        nameLabel.Size = UDim2.new(0.6,0,1,0)
        nameLabel.Position = UDim2.new(0,5,0,0)
        nameLabel.Text = player.Name
        nameLabel.TextColor3 = ST.GUIText
        nameLabel.TextSize = 10
        nameLabel.Font = Enum.Font.SourceSans
        nameLabel.BackgroundTransparency = 1
        nameLabel.TextXAlignment = Enum.TextXAlignment.Left
        nameLabel.Parent = row
        local isWL = ST.Whitelist[player.UserId] == true
        local wlBtn = Instance.new("TextButton")
        wlBtn.Size = UDim2.new(0,60,1,-2)
        wlBtn.Position = UDim2.new(1,-65,0,1)
        wlBtn.Text = isWL and "WHITELISTED" or "WHITELIST"
        wlBtn.TextColor3 = Color3.fromRGB(200,200,200)
        wlBtn.TextSize = 9
        wlBtn.Font = Enum.Font.SourceSans
        wlBtn.BackgroundColor3 = isWL and ST.GUIAccent or Color3.fromRGB(30,30,30)
        wlBtn.BorderSizePixel = 1
        wlBtn.BorderColor3 = Color3.fromRGB(50,50,50)
        wlBtn.Parent = row
        wlBtn.MouseButton1Click:Connect(function()
            local newState = not (ST.Whitelist[player.UserId] == true)
            ST.Whitelist[player.UserId] = newState
            wlBtn.Text = newState and "WHITELISTED" or "WHITELIST"
            wlBtn.BackgroundColor3 = newState and ST.GUIAccent or Color3.fromRGB(30,30,30)
            UpdateHitbox()
            UpdateESP()
        end)
    end
    wlScroll.CanvasSize = UDim2.new(0,0,0, math.max(idx*22, 120))
end
UpdateWhitelist()
Players.PlayerAdded:Connect(UpdateWhitelist)
Players.PlayerRemoving:Connect(UpdateWhitelist)
py = py + 130
playersContent.CanvasSize = UDim2.new(0,0,0, py+50)

-- SETTINGS TAB
local settingsContent = TabContents["Settings"]
local sety = 5
CreateSectionTitle(settingsContent, sety, "UI Customization"); sety = sety + 20
CreateLabel(settingsContent, 5, sety, "UI Background Color", Color3.fromRGB(160,160,160)); sety = sety + 18
CreateColorWheel(settingsContent, 5, sety, "Background", "UIBackground", updateBackgroundCallback); sety = sety + 30
CreateLabel(settingsContent, 5, sety, "Accent Color", Color3.fromRGB(160,160,160)); sety = sety + 18
CreateColorWheel(settingsContent, 5, sety, "Accent", "GUIAccent", updateAccentCallback); sety = sety + 30
CreateLabel(settingsContent, 5, sety, "Panel Background", Color3.fromRGB(160,160,160)); sety = sety + 18
CreateColorWheel(settingsContent, 5, sety, "Panel", "GUIPanel", updatePanelCallback); sety = sety + 30
CreateLabel(settingsContent, 5, sety, "Button Background", Color3.fromRGB(160,160,160)); sety = sety + 18
CreateColorWheel(settingsContent, 5, sety, "Button", "GUIButton", updateButtonCallback); sety = sety + 30
CreateLabel(settingsContent, 5, sety, "Text Color", Color3.fromRGB(160,160,160)); sety = sety + 18
CreateColorWheel(settingsContent, 5, sety, "Text", "GUIText", updateTextCallback); sety = sety + 30
CreateLabel(settingsContent, 5, sety, "Secondary Text Color", Color3.fromRGB(160,160,160)); sety = sety + 18
CreateColorWheel(settingsContent, 5, sety, "Secondary Text", "GUITextSecondary", updateSecondaryTextCallback); sety = sety + 30
CreateLabel(settingsContent, 5, sety, "Border Color", Color3.fromRGB(160,160,160)); sety = sety + 18
CreateColorWheel(settingsContent, 5, sety, "Border", "GUIBorder", updateBorderCallback); sety = sety + 30
CreateDivider(settingsContent, sety, 0.9); sety = sety + 7
CreateSectionTitle(settingsContent, sety, "Performance"); sety = sety + 20
CreateSlider(settingsContent, 5, sety, "FPS Cap", 30, 1000, ST.FPSCap, "FPSCap", function(value) ApplyFPSCap() end); sety = sety + 30
CreateDivider(settingsContent, sety, 0.9); sety = sety + 6
CreateSectionTitle(settingsContent, sety, "Credits"); sety = sety + 20
CreateLabel(settingsContent, 5, sety, "further coding", Color3.fromRGB(150,150,150)); sety = sety + 18
CreateLabel(settingsContent, 5, sety, "@avdotya - GUI Design Features", Color3.fromRGB(150,150,150)); sety = sety + 18
CreateLabel(settingsContent, 5, sety, "Version 7.5 - DA HOOD", Color3.fromRGB(120,120,120)); sety = sety + 18
settingsContent.CanvasSize = UDim2.new(0,0,0, sety+50)

AnimateGuiOpen = function()
    MainScale.Scale = 0.92
    OuterBorder.BackgroundTransparency = 1
    InnerBorder.BackgroundTransparency = 1
    MainFrame.Visible = true
    TweenService:Create(MainScale, TweenInfo.new(0.35, Enum.EasingStyle.Back, Enum.EasingDirection.Out), {Scale = 1}):Play()
    TweenService:Create(OuterBorder, TweenInfo.new(0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundTransparency = 0.8}):Play()
    TweenService:Create(InnerBorder, TweenInfo.new(0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundTransparency = 0.85}):Play()
end

AnimateGuiClose = function()
    TweenService:Create(OuterBorder, TweenInfo.new(0.20, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {BackgroundTransparency = 1}):Play()
    TweenService:Create(InnerBorder, TweenInfo.new(0.20, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {BackgroundTransparency = 1}):Play()
    TweenService:Create(MainScale, TweenInfo.new(0.20, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {Scale = 0.92}):Play()
    task.delay(0.25, function() ScreenGui.Enabled = false end)
end

PulseAccent = function()
    local old = OuterBorder.BackgroundTransparency
    local a = TweenService:Create(OuterBorder, TweenInfo.new(0.10, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundTransparency = 0.35})
    local b = TweenService:Create(OuterBorder, TweenInfo.new(0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {BackgroundTransparency = old})
    a:Play()
    a.Completed:Connect(function() b:Play() end)
end

RunService.RenderStepped:Connect(function()
    UpdateESP()
    if ST.CamlockShowFOV and CamlockFOVCircle then
        CamlockFOVCircle.Visible = true
        CamlockFOVCircle.Radius = ST.CamlockFOV or 300
        CamlockFOVCircle.Position = Vector2.new(Camera.ViewportSize.X / 2, Camera.ViewportSize.Y / 2)
        CamlockFOVCircle.Color = ST.GUIAccent
    else
        if CamlockFOVCircle then CamlockFOVCircle.Visible = false end
    end
    if ST.SilentAimShowFOV and SilentAimFOVCircle then
        SilentAimFOVCircle.Visible = true
        SilentAimFOVCircle.Radius = ST.SilentAimFOV or 1000
        SilentAimFOVCircle.Position = Vector2.new(Camera.ViewportSize.X / 2, Camera.ViewportSize.Y / 2)
        SilentAimFOVCircle.Color = ST.GUIAccent
    else
        if SilentAimFOVCircle then SilentAimFOVCircle.Visible = false end
    end
end)

ApplyColors()
task.defer(AnimateGuiOpen)
InitializeESP()
UpdateFog()
UpdateSilentAim()
UpdateBulletSpread()
UpdateHitbox()
ApplyFPSCap()
UpdateMove()
ApplyColors()

print(math.random(100000, 999999))
`;

// ============================================
// LOADER GENERATOR
// ============================================
function generateLoaderScript(username, password, serverUrl, key) {
    return `
-- Avdotya Loader v${CURRENT_VERSION}
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
                Body = HttpService:JSONEncode({
                    username = USERNAME,
                    hwid = HWID
                })
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

notify("✅ Script loaded successfully!", false)
loadstring(data.chunk)()
`;
}

// ============================================
// KEY GENERATOR
// ============================================
function generateKey() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let key = "AVD-";
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 3) key += "-";
    }
    return key;
}

// ============================================
// ROLE CHECK
// ============================================
async function hasRequiredRole(interaction) {
    try {
        if (interaction.guild) {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            if (!member) return false;
            return member.roles.cache.has(REQUIRED_ROLE_ID);
        }
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(interaction.user.id);
        if (!member) return false;
        return member.roles.cache.has(REQUIRED_ROLE_ID);
    } catch (error) {
        console.error("Role check error:", error);
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
// REGISTER COMMANDS
// ============================================
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

async function registerGlobalCommands() {
    try {
        console.log('🔄 Registering global commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Global commands registered successfully!');
    } catch (error) {
        console.error('❌ Error registering global commands:', error);
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`📊 Google Sheets connected!`);
    console.log(`🔒 Required Role ID: ${REQUIRED_ROLE_ID}`);
    console.log(`🏠 Guild ID: ${GUILD_ID}`);
    console.log(`📋 Sheet ID: ${SHEET_ID}`);
    console.log(`📌 Current version: ${CURRENT_VERSION}`);
    console.log(`👑 Admins: ${ADMIN_IDS.join(", ")}`);

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
            return interaction.followUp({
                content: "❌ You are blacklisted from creating an account.",
                flags: MessageFlags.Ephemeral
            });
        }

        if (db.users[interaction.user.id]) {
            return interaction.followUp({
                content: "❌ You already have an account! Use `/account-information` to view it.",
                flags: MessageFlags.Ephemeral
            });
        }

        for (const userId in db.users) {
            if (db.users[userId].username === username) {
                return interaction.followUp({
                    content: "❌ That username is already taken. Please choose another.",
                    flags: MessageFlags.Ephemeral
                });
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

        try {
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
                                 `**💻 HWID:** Not set\n` +
                                 `**📅 Created:** ${new Date().toISOString().split("T")[0]}\n` +
                                 `**📌 Script Version:** ${CURRENT_VERSION}\n` +
                                 `**👥 Total Users:** ${Object.keys(db.users).length}`
                    });
                } catch (e) {}
            }
        } catch (error) {
            console.error("Admin DM error:", error);
        }

        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(username, password, serverUrl, key);

        await interaction.followUp({
            content: `✅ **Account created successfully!** I've sent your loader script via DM.`,
            flags: MessageFlags.Ephemeral
        });

        try {
            await interaction.user.send({
                content: `📥 **Here is your loader script. Just run it in your executor – no typing needed!**`,
                files: [{
                    attachment: Buffer.from(loaderScript, "utf-8"),
                    name: `loader.lua`
                }]
            });
        } catch (error) {
            console.error("DM error:", error);
        }
        return;
    }

    // ============================================
    // /account-information
    // ============================================
    if (command === "account-information") {
        const userData = db.users[interaction.user.id];
        if (!userData) {
            return interaction.followUp({
                content: "❌ You don't have an account. Use `/create-account` to create one.",
                flags: MessageFlags.Ephemeral
            });
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
            return interaction.followUp({
                content: "❌ You don't have an account. Use `/create-account` first.",
                flags: MessageFlags.Ephemeral
            });
        }

        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(userData.username, userData.password, serverUrl, userData.key);

        await interaction.followUp({
            content: `✅ I've sent your loader script via DM.`,
            flags: MessageFlags.Ephemeral
        });

        try {
            await interaction.user.send({
                content: `📥 **Here is your loader script.**`,
                files: [{
                    attachment: Buffer.from(loaderScript, "utf-8"),
                    name: `loader.lua`
                }]
            });
        } catch (error) {
            console.error("DM error:", error);
        }
        return;
    }

    // ============================================
    // /reset-hwid
    // ============================================
    if (command === "reset-hwid") {
        const userData = db.users[interaction.user.id];
        if (!userData) {
            return interaction.followUp({
                content: "❌ You don't have an account.",
                flags: MessageFlags.Ephemeral
            });
        }

        userData.hwid = null;
        await saveUser(interaction.user.id, userData);

        await interaction.followUp({
            content: "✅ Your HWID has been reset. You can now use your account on a new device.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // ============================================
    // /update
    // ============================================
    if (command === "update") {
        const userData = db.users[interaction.user.id];
        if (!userData) {
            return interaction.followUp({
                content: "❌ You don't have an account. Use `/create-account` first.",
                flags: MessageFlags.Ephemeral
            });
        }

        userData.scriptVersion = CURRENT_VERSION;
        await saveUser(interaction.user.id, userData);

        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(userData.username, userData.password, serverUrl, userData.key);

        await interaction.followUp({
            content: `✅ **Latest loader script sent!** (Script Version: ${CURRENT_VERSION})`,
            flags: MessageFlags.Ephemeral
        });

        try {
            await interaction.user.send({
                content: `📥 **Here is the latest loader script:**`,
                files: [{
                    attachment: Buffer.from(loaderScript, "utf-8"),
                    name: `loader.lua`
                }]
            });
        } catch (error) {
            console.error("DM error:", error);
        }
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

        if (userList.length === 0) {
            return interaction.followUp({
                content: "No users found.",
                flags: MessageFlags.Ephemeral
            });
        }

        const chunks = [];
        for (let i = 0; i < userList.length; i += 10) {
            chunks.push(userList.slice(i, i + 10).join("\n"));
        }

        await interaction.followUp({
            content: `📋 **All Users (${userList.length} total)**\n\n${chunks[0]}`,
            flags: MessageFlags.Ephemeral
        });

        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({
                content: chunks[i],
                flags: MessageFlags.Ephemeral
            });
        }
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

        if (!found) {
            return interaction.followUp({
                content: "❌ User not found.",
                flags: MessageFlags.Ephemeral
            });
        }

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
        } catch (error) {
            console.error(`Could not DM ${targetUsername}:`, error);
        }

        await interaction.followUp({
            content: `✅ User \`${targetUsername}\` has been revoked. Reason: ${reason}`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // ============================================
    // /revoke-all (Admin only)
    // ============================================
    if (command === "revoke-all") {
        const db2 = await loadUsers();
        const userCount = Object.keys(db2.users).length;

        if (userCount === 0) {
            return interaction.followUp({
                content: "❌ No users to revoke.",
                flags: MessageFlags.Ephemeral
            });
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId("confirm_revoke_all")
                    .setLabel("✅ Yes, Revoke All")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId("cancel_revoke_all")
                    .setLabel("❌ Cancel")
                    .setStyle(ButtonStyle.Secondary)
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
                await i.update({
                    content: `⏳ Revoking all ${userCount} users...`,
                    components: []
                });

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
                                content: `❌ **Your account has been revoked.**\n\n` +
                                         `**Username:** ${user.username}\n` +
                                         `**Key:** \`${user.key}\`\n` +
                                         `**Reason:** All accounts were revoked by an administrator.\n\n` +
                                         `If you believe this is a mistake, please contact support.`
                            });
                        } catch (error) {}
                    }
                }

                await i.followUp({
                    content: `✅ **Revoke all completed!** ${revokedCount} accounts were revoked.`,
                    flags: MessageFlags.Ephemeral
                });

            } else if (i.customId === "cancel_revoke_all") {
                await i.update({
                    content: "❌ Revoke all cancelled.",
                    components: []
                });
            }
        });

        collector.on("end", async (collected) => {
            if (collected.size === 0) {
                await interaction.editReply({
                    content: "⏰ Revoke all timed out. Cancelled.",
                    components: []
                });
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
                return interaction.followUp({
                    content: `❌ User \`${target}\` is already blacklisted.`,
                    flags: MessageFlags.Ephemeral
                });
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

        if (!found) {
            return interaction.followUp({
                content: `❌ User \`${target}\` is not on the blacklist.`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.followUp({
            content: `✅ User \`${target}\` has been removed from the blacklist.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // ============================================
    // /set-usage (Admin only)
    // ============================================
    if (command === "set-usage") {
        const targetUsername = interaction.options.getString("username");
        const newLimit = interaction.options.getInteger("limit");
        let found = false;

        if (newLimit < 0) {
            return interaction.followUp({
                content: "❌ Limit cannot be negative. Use 0 for unlimited.",
                flags: MessageFlags.Ephemeral
            });
        }

        for (const userId in db.users) {
            if (db.users[userId].username === targetUsername) {
                db.users[userId].maxUses = newLimit;
                found = true;
                await saveUser(userId, db.users[userId]);
                break;
            }
        }

        if (!found) {
            return interaction.followUp({
                content: "❌ User not found.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.followUp({
            content: `✅ User \`${targetUsername}\` now has ${newLimit === 0 ? "unlimited" : newLimit} uses.`,
            flags: MessageFlags.Ephemeral
        });
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
            if (!channel) {
                return interaction.followUp({
                    content: "❌ Could not find the announcement channel.",
                    flags: MessageFlags.Ephemeral
                });
            }

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

            await channel.send({
                content: `<@&${REQUIRED_ROLE_ID}>`,
                embeds: [embed]
            });

            await interaction.followUp({
                content: `✅ Update announcement sent to <#${ANNOUNCEMENT_CHANNEL_ID}>!`,
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            console.error("Announcement error:", error);
            await interaction.followUp({
                content: "❌ Failed to send announcement. Please check the channel ID.",
                flags: MessageFlags.Ephemeral
            });
        }
        return;
    }

    // ============================================
    // /force-update (Admin only)
    // ============================================
    if (command === "force-update") {
        const secret = interaction.options.getString("secret");

        if (secret !== ADMIN_SECRET) {
            return interaction.followUp({
                content: "❌ Invalid admin secret.",
                flags: MessageFlags.Ephemeral
            });
        }

        globalKickFlag = true;
        const activeCount = Object.keys(activeUsers).length;

        await interaction.followUp({
            content: `✅ **Force update initiated!** ${activeCount} active users will be kicked within 10 seconds. They will need to run /update and re-execute.`,
            flags: MessageFlags.Ephemeral
        });

        setTimeout(() => {
            globalKickFlag = false;
            console.log("Force kick flag reset.");
        }, 30000);

        try {
            const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle("⚠️ **FORCED UPDATE INITIATED**")
                    .setDescription(`**${activeCount}** users have been force-kicked to apply the latest update.\n\nRun \`/update\` and re-execute the loader to continue.`)
                    .addFields(
                        { name: "📌 New Version", value: CURRENT_VERSION, inline: true },
                        { name: "👥 Users Kicked", value: String(activeCount), inline: true }
                    )
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error("Announcement error:", error);
        }
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

        if (!found) {
            return interaction.followUp({
                content: "❌ User not found.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.followUp({
            content: `✅ User \`${targetUsername}\` now has script version \`${newVersion}\`.`,
            flags: MessageFlags.Ephemeral
        });
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
                    `/force-version <username> <version>\n`, inline: false },
                { name: "ℹ️ Other", value: `/help`, inline: false }
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

    if (!userData) {
        return res.json({ success: false, reason: "User not found" });
    }

    if (await isBlacklisted(userData.discordId, userData.username)) {
        return res.json({ success: false, reason: "Blacklisted" });
    }

    if (password !== userData.password) {
        return res.json({ success: false, reason: "Invalid password" });
    }

    if (key !== userData.key) {
        return res.json({ success: false, reason: "Invalid key" });
    }

    if (!userData.active) {
        return res.json({ success: false, reason: "Account revoked" });
    }

    if (userData.expires && new Date(userData.expires) < new Date()) {
        return res.json({ success: false, reason: "Account expired" });
    }

    if (userData.maxUses > 0 && userData.used >= userData.maxUses) {
        return res.json({ success: false, reason: "Usage limit reached" });
    }

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
    if (userData.scriptVersion !== CURRENT_VERSION) {
        userData.scriptVersion = CURRENT_VERSION;
    }
    await saveUser(userId, userData);

    if (isFirstRun) {
        console.log(`✅ HWID set for ${username} (First run, v${CURRENT_VERSION})`);
    } else {
        console.log(`✅ HWID verified for ${username} (Used ${userData.used} times, v${CURRENT_VERSION})`);
    }

    res.json({ success: true, chunk: AVDOITYA_SCRIPT });
});

app.post('/register', (req, res) => {
    const { username, hwid } = req.body;
    if (username && hwid) {
        activeUsers[hwid] = {
            username,
            timestamp: Date.now()
        };
        for (const key in activeUsers) {
            if (Date.now() - activeUsers[key].timestamp > 300000) {
                delete activeUsers[key];
            }
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
        if (hwid && activeUsers[hwid]) {
            activeUsers[hwid].timestamp = Date.now();
        }
        return res.json({
            kick: true,
            message: "⚠️ New version available! Please run /update and re-execute."
        });
    }
    if (hwid && activeUsers[hwid]) {
        activeUsers[hwid].timestamp = Date.now();
    }
    res.json({ kick: false });
});

app.post('/check-version', (req, res) => {
    const { hwid, currentVersion } = req.body;
    const cacheKey = hwid || "unknown";

    for (const key in versionCache) {
        if (Date.now() - versionCache[key].timestamp > VERSION_TTL) {
            delete versionCache[key];
        }
    }

    if (versionCache[cacheKey] && versionCache[cacheKey].version !== CURRENT_VERSION) {
        return res.json({
            outdated: true,
            latest: CURRENT_VERSION,
            message: `New version ${CURRENT_VERSION} available!`
        });
    }

    versionCache[cacheKey] = {
        version: currentVersion || CURRENT_VERSION,
        timestamp: Date.now()
    };
    res.json({ outdated: false });
});

app.get('/', (req, res) => res.send(`Avdotya Bot v${CURRENT_VERSION} is running!`));
app.get('/version', (req, res) => {
    res.json({ version: CURRENT_VERSION });
});
app.get('/active-users', (req, res) => {
    res.json({
        active: Object.keys(activeUsers).length,
        users: activeUsers
    });
});

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
    if (process.env.TOKEN.length < 50) {
        console.error("❌ WARNING: Token seems too short. Please check your token.");
    }

    client.once(Events.ClientReady, () => {
        console.log("✅ Discord client is ready and logged in!");
    });

    let loginTimer = setTimeout(() => {
        console.error("❌ Login timeout - no ready event after 45 seconds.");
        console.log("🔄 Client may be stuck. Destroying and retrying...");
        client.destroy();
        setTimeout(() => {
            client.login(process.env.TOKEN).catch(e => console.error("Retry failed:", e.message));
        }, 5000);
    }, 45000);

    client.login(process.env.TOKEN)
        .then(() => {
            console.log("✅ Login promise resolved.");
            clearTimeout(loginTimer);
        })
        .catch(error => {
            console.error("❌ Login error:", error.message);
            clearTimeout(loginTimer);
        });
}

client.on(Events.ShardDisconnect, (event, id) => {
    console.warn(`⚠️ Shard ${id} disconnected. Reconnecting...`);
});

client.on(Events.ShardReconnecting, (id) => {
    console.log(`🔄 Shard ${id} reconnecting...`);
});

client.on(Events.Error, (error) => {
    console.error("❌ Discord client error:", error.message);
});

client.on(Events.ShardError, (error) => {
    console.error("❌ Shard error:", error.message);
});

setInterval(() => {
    if (client && client.ws) {
        try {
            const status = client.ws.status;
            console.log(`💓 Heartbeat check: Discord connection status = ${status}`);
        } catch (e) {
            console.log("💓 Heartbeat check: client not ready");
        }
    } else {
        console.log("💓 Heartbeat check: client not initialized");
    }
}, 60000);

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});
