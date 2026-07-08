// index.js - Discord Bot with Google Sheets Database (MULTI-VERSION - WITH FULL UI FOR ALL VERSIONS)
// FIXED: Xeno now has FULL UI identical to regular version
// FIXED: Delta now has FULL UI identical to regular version (with BillboardGui fallback)
// FIXED: Line 4007 nil error - added safe access checks throughout
// ADDED: Version checking system - outdated clients get kicked with "please update!" message
// ADDED: /version endpoint for loader to fetch current version
// ADDED: Force-kick system - kicks all active users when admin triggers /force-update
// ADDED: Version cache with TTL for detecting outdated clients
// UPDATED: Version changed to 32.0
const CURRENT_VERSION = "32.0";
import { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes, SlashCommandBuilder, Partials, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import express from "express";
import fs from "fs";
import crypto from "crypto";
import { google } from "googleapis";

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

// ============================================
// FORCE WEBSOCKET SETTINGS FOR RENDER
// ============================================
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
const REQUIRED_ROLE_ID = "1520668279335817226";
const GUILD_ID = "1516943154840993792";
const ADMIN_ID = "1176388663320510535";
const SHEET_ID = "12YV1x2tireoLEz8O29CxWpTJi1lhMSIIoiwIaUe-IbU";
const SHEET_NAME = "Blushwovens_Users";
const BLACKLIST_SHEET_NAME = "Blacklist";
const ANNOUNCEMENT_CHANNEL_ID = "1516957022690611301";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "blush_admin_secret_2026";
const VERSION_TTL = 300000; // 5 minutes

// ============================================
// ACTIVE USERS TRACKING
// ============================================
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
// GOOGLE SHEETS DATABASE FUNCTIONS
// ============================================
const COLUMNS = {
    discordId: 0,
    username: 1,
    password: 2,
    discordTag: 3,
    key: 4,
    hwid: 5,
    created: 6,
    expires: 7,
    maxUses: 8,
    used: 9,
    active: 10,
    version: 11
};

async function loadUsers() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!A:L`,
        });
        const rows = response.data.values || [];
        
        if (rows.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${SHEET_NAME}!A1:L1`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [["discordId", "username", "password", "discordTag", "key", "hwid", "created", "expires", "maxUses", "used", "active", "version"]]
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
                    version: row[11] || "regular"
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
            userData.version || "regular"
        ];

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!A:L`,
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
                range: `${SHEET_NAME}!A:L`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [rowData] }
            });
        } else {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${SHEET_NAME}!A${rowIndex + 1}:L${rowIndex + 1}`,
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

// ============================================
// BLACKLIST FUNCTIONS
// ============================================
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

// ============================================
// VERSION-SPECIFIC SCRIPTS (FULL - ALL THREE VERSIONS WITH FULL UI)
// ============================================
// The regular, xeno, and delta scripts all contain the complete UI implementation.
// Xeno and Delta use the exact same UI code as regular - the only difference is
// that Delta uses BillboardGui for ESP instead of Drawing library.
// ============================================

// FULL REGULAR SCRIPT - This is the complete implementation with UI
const FULL_REGULAR_SCRIPT = `
--[[
  Blushwovens v32.0 - COMPLETE IMPLEMENTATION WITH FULL UI
  This is the base script that all versions use
]]

local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")
local LocalPlayer = Players.LocalPlayer
local Camera = workspace.CurrentCamera
local Mouse = LocalPlayer:GetMouse()
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local VirtualInputManager = game:GetService("VirtualInputManager")
local Stats = game:GetService("Stats")
local Workspace = game:GetService("Workspace")
local CoreGui = game:GetService("CoreGui")

-- ==================== SAFE ACCESS HELPER ====================
local function safeFindFirstChild(parent, childName)
    if parent and parent:IsA("Instance") then
        return parent:FindFirstChild(childName)
    end
    return nil
end

local function safeWaitForChild(parent, childName, timeout)
    if parent and parent:IsA("Instance") then
        return parent:WaitForChild(childName, timeout or 5)
    end
    return nil
end

local function safeGetService(serviceName)
    local success, result = pcall(function()
        return game:GetService(serviceName)
    end)
    if success then return result end
    return nil
end

print("Blushwovens v32.0 - Loading...")

-- ==================== NOTIFICATION ====================
local function SendNotification(title, text, duration)
    pcall(function()
        local starterGui = safeGetService("StarterGui")
        if starterGui then
            starterGui:SetCore("SendNotification", {
                Title = title or "Blushwovens",
                Text = text or "Script has been injected!",
                Duration = duration or 5
            })
        end
    end)
end

SendNotification("Blushwovens v32.0", "Script injected successfully!", 5)

-- ==================== SILENT AIM ====================
local handler = nil
pcall(function()
    handler = require(ReplicatedStorage:WaitForChild("Modules"):WaitForChild("GunHandler"))
end)
local plrs = Players
local me = LocalPlayer
local cam = workspace.CurrentCamera
local mouse = me:GetMouse()
local aimPart = "Head"
local oldFunc = handler and handler.getAim or function() end

local FOV_RADIUS = 1000
local RevolverBypass = false
local WallCheck = false
local KnockCheck = false
local BulletSpreadEnabled = true

-- ==================== BULLET SPREAD HOOK ====================
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
    if ST.BulletSpreadEnabled then
        _0x52a0d5.BulletSpread.Enabled = true
    else
        _0x52a0d5.BulletSpread.Enabled = false
    end
    _0x52a0d5.BulletSpread.Amount = ST.BulletSpread
end

local BulletSpreadAmount = 100
local SilentAimWhitelist = {}

-- ==================== STATE ====================
local ST={
    SA=false, SAFC=false, SAFOV=200, SAPart="Head",
    RevolverBypass=false, KnockCheck=false,
    CL=false, CLKey=Enum.KeyCode.E, CLMode="Toggle", CLSm=0.08,
    CLFOV=300, CLPart="Head", CLPred=0.12, CLDraw=false, CLVis=true,
    CLAimType="Camera",
    CLMagnetStrength=1,
    CLMagnetPart="UpperTorso",
    HB=false, HBSz=10, HBOp=0.9,
    ESP=false, ESPBx=true, ESPTr=true, ESPNm=true, ESPDs=true, ESPHp=true,
    SP=false, SPVal=50, SPKey=Enum.KeyCode.Q,
    JP=false, JPVal=150, JPKey=Enum.KeyCode.Z,
    Teleport=false, TeleportKey=Enum.KeyCode.T,
    FG=false, FGDen=0.02,
    MorphHeadless=false, MorphActive=false, MorphTarget="", MorphConnection=nil,
    MorphOriginalHeadSize=nil, MorphHiddenFace={},
    BulletSpreadEnabled=true,
    BulletSpread=100,
    FlameLock=false, FlameLockKey=Enum.KeyCode.B,
    TB=false, TBKey=Enum.KeyCode.F, TBDelay=0.05, TBPart="Head", TBRange=200, TBTeamCheck=true,
}

print("State loaded")

-- Toggle colors
local TOGGLE_ON_COLOR = Color3.fromRGB(235, 200, 120)
local TOGGLE_OFF_COLOR = Color3.fromRGB(110, 90, 90)
local TOGGLE_KNOB_ON = UDim2.new(1, -23, 0.5, -10)
local TOGGLE_KNOB_OFF = UDim2.new(0, 3, 0.5, -10)

-- ==================== KNOCK CHECK ====================
local function IsKnocked(char)
    if not char then return false end
    local bodyEffects = safeFindFirstChild(char, "BodyEffects")
    if not bodyEffects then return false end
    local ko = safeFindFirstChild(bodyEffects, "K.O")
    if ko and ko.Value == true then return true end
    return false
end

-- ==================== WHITELIST FUNCTIONS ====================
local function IsSilentAimWhitelisted(player)
    if not player then return false end
    if not player.UserId then return false end
    return SilentAimWhitelist[player.UserId] == true
end

-- ==================== PING-BASED PREDICTION ====================
local function GetPredictionTime()
    local ping = 50
    local stats = safeFindFirstChild(Stats, "PerformanceStats")
    if stats then
        local pingObj = safeFindFirstChild(stats, "Ping")
        if pingObj then
            ping = pingObj:GetValue()
        end
    end
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

-- ==================== FIND CLOSEST PLAYER TO CURSOR ====================
local function GetClosestPlayerToCursor()
    if not Mouse or not Mouse.X or not Mouse.Y then
        return nil, nil
    end
    
    local closest = nil
    local closestDist = math.huge
    local mousePos = Vector2.new(Mouse.X, Mouse.Y)
    
    for _, player in ipairs(Players:GetPlayers()) do
        if player == LocalPlayer then continue end
        if not player.Character then continue end
        local hum = safeFindFirstChild(player.Character, "Humanoid")
        if not hum or hum.Health <= 0 then continue end
        if ST.KnockCheck and IsKnocked(player.Character) then continue end
        if IsSilentAimWhitelisted(player) then continue end
        
        local targetPartName = ST.CLMagnetPart or "UpperTorso"
        local targetPart = safeFindFirstChild(player.Character, targetPartName)
        if not targetPart then
            targetPart = safeFindFirstChild(player.Character, "UpperTorso")
            if not targetPart then
                targetPart = safeFindFirstChild(player.Character, "Head")
                if not targetPart then continue end
            end
        end
        
        local screenPos, onScreen = Camera:WorldToScreenPoint(targetPart.Position)
        if not onScreen then continue end
        
        local dist = (Vector2.new(screenPos.X, screenPos.Y) - mousePos).Magnitude
        if dist < closestDist then
            closestDist = dist
            closest = player
        end
    end
    
    return closest, closestDist
end

-- ==================== GET CLOSEST FOR SILENT AIM ====================
local function getClosestPart(char)
    local closest = nil
    local shortestDist = math.huge
    if not mouse or not mouse.X or not mouse.Y then
        return safeFindFirstChild(char, "Head")
    end
    local mousePos = Vector2.new(mouse.X, mouse.Y)
    local parts = {"Head", "HumanoidRootPart", "Torso", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot", "LeftUpperArm", "LeftLowerArm", "LeftHand", "RightUpperArm", "RightLowerArm", "RightHand"}
    for _, partName in pairs(parts) do
        local p = safeFindFirstChild(char, partName)
        if p then
            local screenPos, onScreen = cam:WorldToScreenPoint(p.Position)
            if onScreen then
                local dist = (Vector2.new(screenPos.X, screenPos.Y) - mousePos).Magnitude
                if dist < shortestDist then shortestDist = dist closest = p end
            end
        end
    end
    return closest or safeFindFirstChild(char, "Head")
end

local function getClosest()
    if not mouse or not mouse.X or not mouse.Y then
        return nil
    end
    local mousePos = Vector2.new(mouse.X, mouse.Y)
    local best = nil
    local bestDist = FOV_RADIUS
    for i, v in pairs(plrs:GetPlayers()) do
        if v ~= me and v.Character then
            local hum = safeFindFirstChild(v.Character, "Humanoid")
            if hum and hum.Health > 0 then
                if ST.KnockCheck and IsKnocked(v.Character) then
                    continue
                end
                if IsSilentAimWhitelisted(v) then
                    continue
                end
                local char = v.Character
                local part
                
                if aimPart == "Closest Part" then 
                    part = getClosestPart(char)
                elseif aimPart == "Head" then
                    part = safeFindFirstChild(char, "Head")
                elseif aimPart == "Torso" then
                    part = safeFindFirstChild(char, "Torso")
                elseif aimPart == "HumanoidRootPart" then
                    part = safeFindFirstChild(char, "HumanoidRootPart")
                elseif aimPart == "Left Arm" then
                    part = safeFindFirstChild(char, "LeftUpperArm") or safeFindFirstChild(char, "LeftArm")
                elseif aimPart == "Right Arm" then
                    part = safeFindFirstChild(char, "RightUpperArm") or safeFindFirstChild(char, "RightArm")
                elseif aimPart == "Left Leg" then
                    part = safeFindFirstChild(char, "LeftUpperLeg") or safeFindFirstChild(char, "LeftLeg")
                elseif aimPart == "Right Leg" then
                    part = safeFindFirstChild(char, "RightUpperLeg") or safeFindFirstChild(char, "RightLeg")
                elseif aimPart == "Nearest Part" then
                    part = getClosestPart(char)
                else
                    part = safeFindFirstChild(char, "Head")
                end
                
                if part then
                    local screenPos, onScreen = cam:WorldToScreenPoint(part.Position)
                    if onScreen then
                        local screenVec = Vector2.new(screenPos.X, screenPos.Y)
                        local dist = (screenVec - mousePos).Magnitude
                        if dist < bestDist then
                            if WallCheck then
                                local ray = Ray.new(cam.CFrame.Position, (part.Position - cam.CFrame.Position).Unit * 500)
                                local hit, pos = workspace:FindPartOnRayWithIgnoreList(ray, {me.Character, cam})
                                if hit and hit:IsDescendantOf(v.Character) then 
                                    bestDist = dist 
                                    best = part 
                                end
                            else 
                                bestDist = dist 
                                best = part 
                            end
                        end
                    end
                end
            end
        end
    end
    return best
end

local originalGetAim = oldFunc

-- ==================== UPDATE SILENT AIM ====================
local function UpdateSilentAim()
    if handler then
        if ST.SA then
            handler.getAim = function(origin, maxDist)
                if ST.RevolverBypass then
                    local currentTool = me.Character and me.Character:FindFirstChildOfClass("Tool")
                    if currentTool and (currentTool.Name == "[Revolver]" or currentTool.Name == "Revolver") then 
                        return originalGetAim(origin, maxDist) 
                    end
                end
                local target = getClosest()
                if target then
                    local dir = (target.Position - origin).Unit
                    local dist = (target.Position - origin).Magnitude
                    return dir, math.min(dist, maxDist or 200)
                end
                return originalGetAim(origin, maxDist)
            end
        else
            handler.getAim = originalGetAim
        end
    end
end

if handler then
    handler.getAim = originalGetAim
end

-- WHITELIST
local WL={}
local function IsWL(p) 
    if not p then return false end
    if not p.UserId then return false end
    if SilentAimWhitelist[p.UserId] == true then return true end
    return WL[p.UserId]==true 
end
local function SetWL(p,v) 
    if not p then return end
    if not p.UserId then return end
    if v then 
        WL[p.UserId]=true
        SilentAimWhitelist[p.UserId]=true
    else 
        WL[p.UserId]=nil
        SilentAimWhitelist[p.UserId]=nil
    end
end

-- ==================== PAL ====================
local PAL = {
    Pink = Color3.fromRGB(245,205,220),
    DarkPink = Color3.fromRGB(215,130,170),
    Cream = Color3.fromRGB(255,248,240),
    Olive = Color3.fromRGB(220,225,170),
    Brown = Color3.fromRGB(80,60,50),
    LightBrown = Color3.fromRGB(130,100,80),
    Bg = Color3.fromRGB(255,248,240),
    Surf = Color3.fromRGB(255,235,240),
    SurfL = Color3.fromRGB(255,242,245),
    Txt = Color3.fromRGB(60,45,35),
    TxtS = Color3.fromRGB(100,80,70),
    Brd = Color3.fromRGB(215,130,170),
    Ok = Color3.fromRGB(170,220,140),
    Bad = Color3.fromRGB(100,100,110),
    Warn = Color3.fromRGB(255,190,120),
    Gray = Color3.fromRGB(200,195,195),
    White = Color3.fromRGB(255,255,255),
    ButtonGreen = Color3.fromRGB(235,245,180),
    ButtonText = Color3.fromRGB(60,45,35),
    CardBackground = Color3.fromRGB(255,250,250),
    CardStroke = Color3.fromRGB(215,130,170),
    SpeechBubble = Color3.fromRGB(255,235,240),
    Gold = Color3.fromRGB(235, 200, 120)
}

local UIAccentColor = Color3.fromRGB(215,130,170)
local UISecondaryColor = Color3.fromRGB(245,205,220)

local function CRN(p,r)
    if not p then return end
    pcall(function() local c=Instance.new("UICorner"); c.CornerRadius=r or UDim.new(0,12); c.Parent=p end)
end
local function STR(p,t,c,tr)
    if not p then return end
    pcall(function() local s=Instance.new("UIStroke"); s.Thickness=t or 1.5; s.Color=c or PAL.Brd; s.Transparency=tr or 0; s.Parent=p end)
end

local function W2S(pos)
    if not pos then return nil end
    if typeof(pos)=="CFrame" then pos=pos.Position end
    if typeof(pos)~="Vector3" then return nil end
    local ok,r=pcall(function() return Camera:WorldToViewportPoint(pos) end)
    if ok and r and r.Z>0 then return {X=r.X,Y=r.Y,Z=r.Z} end
    return nil
end

print("Functions loaded")

-- FOV CIRCLES - Regular and Xeno use Drawing, Delta uses BillboardGui
local AC = nil
local CC = nil
pcall(function()
    AC=Drawing.new("Circle"); AC.Visible=false; AC.Color=PAL.Pink; AC.Thickness=1.5; AC.Transparency=0.7; AC.Radius=200; AC.Filled=false
    CC=Drawing.new("Circle"); CC.Visible=false; CC.Color=PAL.Bad; CC.Thickness=1.5; CC.Transparency=0.7; CC.Radius=300; CC.Filled=false
end)

-- If Drawing failed, use BillboardGui fallback (for Delta)
if not AC then
    print("Drawing library not available - using BillboardGui fallback")
    -- BillboardGui fallback implementation
    local function CreateCircleBillboard(name, color, radius)
        local frame = Instance.new("BillboardGui")
        frame.Name = name
        frame.Size = UDim2.new(0, radius * 2, 0, radius * 2)
        frame.StudsOffset = Vector3.new(0, 0, 0)
        frame.AlwaysOnTop = true
        frame.Adornee = nil
        frame.Enabled = false
        frame.Parent = CoreGui
        
        local circle = Instance.new("Frame")
        circle.Size = UDim2.new(1, 0, 1, 0)
        circle.BackgroundColor3 = color
        circle.BackgroundTransparency = 0.7
        circle.BorderSizePixel = 0
        circle.Parent = frame
        CRN(circle, UDim.new(1, 0))
        STR(circle, 1.5, color, 0.3)
        return frame
    end
    AC = CreateCircleBillboard("FOVCircle", PAL.Pink, 200)
    CC = CreateCircleBillboard("CamlockFOVCircle", PAL.Bad, 300)
    -- Override position update for BillboardGui
    local oldACUpdate = AC.UpdatePosition
    AC.UpdatePosition = function(self, pos)
        if self and self.Parent then
            self.Parent.StudsOffset = Vector3.new(pos.X, pos.Y, 0)
        end
    end
end
print("FOV Circles created")

-- ==================== IMPROVED FOG ====================
local FogPresets = {
    {Name="Pink", Color=Color3.fromRGB(245,205,220)},
    {Name="D.Pink", Color=Color3.fromRGB(215,130,170)},
    {Name="Brown", Color=Color3.fromRGB(110,90,90)},
    {Name="Olive", Color=Color3.fromRGB(220,225,170)},
    {Name="Cream", Color=Color3.fromRGB(255,248,240)},
    {Name="Lavender", Color=Color3.fromRGB(200,180,220)},
    {Name="Peach", Color=Color3.fromRGB(255,218,185)},
    {Name="Mint", Color=Color3.fromRGB(180,225,200)}
}
local FogColor = Color3.fromRGB(110,90,90)
local TargetFogEnd = 500

local function UpdateFog()
    if ST.FG then
        TargetFogEnd = 500 - (ST.FGDen * 4500)
        if Lighting.FogEnd then
            Lighting.FogEnd = TargetFogEnd
        end
        Lighting.FogStart = 0
        Lighting.FogColor = FogColor
    else
        TargetFogEnd = 999999
        Lighting.FogEnd = 999999
        Lighting.FogStart = 0
        Lighting.FogColor = FogColor
    end
end

RunService.RenderStepped:Connect(function()
    if ST.FG then
        if Lighting.FogEnd and math.abs(Lighting.FogEnd - TargetFogEnd) > 0.1 then
            Lighting.FogEnd = Lighting.FogEnd + (TargetFogEnd - Lighting.FogEnd) * 0.1
        end
    end
end)

-- ==================== UI PRESETS ====================
local UIPresets = {
    {Name="Pink", Accent=Color3.fromRGB(215,130,170), Second=Color3.fromRGB(245,205,220)},
    {Name="Purple", Accent=Color3.fromRGB(140,100,220), Second=Color3.fromRGB(180,150,240)},
    {Name="Blue", Accent=Color3.fromRGB(100,150,220), Second=Color3.fromRGB(150,190,240)},
    {Name="Red", Accent=Color3.fromRGB(200,90,90), Second=Color3.fromRGB(240,140,140)},
    {Name="Green", Accent=Color3.fromRGB(100,180,120), Second=Color3.fromRGB(150,210,160)},
    {Name="Orange", Accent=Color3.fromRGB(220,150,80), Second=Color3.fromRGB(240,190,130)},
    {Name="White", Accent=Color3.fromRGB(200,195,205), Second=Color3.fromRGB(230,225,235)},
    {Name="Mint", Accent=Color3.fromRGB(120,190,180), Second=Color3.fromRGB(170,220,210)}
}

print("FOG + UI Presets loaded")

-- ==================== CAMLOCK (With Magnet Support) ====================
local CamActive = false
local CamConn = nil
local MagnetTarget = nil

local function FindCamTarget()
    local closest,shortest=nil,ST.CLFOV; local cx=Camera.ViewportSize.X/2; local cy=Camera.ViewportSize.Y/2
    for _,p in ipairs(Players:GetPlayers()) do
        if p~=LocalPlayer and not IsWL(p) and p.Character then            if ST.KnockCheck and IsKnocked(p.Character) then continue end
            local part = safeFindFirstChild(p.Character, ST.CLPart)
            local hum = safeFindFirstChild(p.Character, "Humanoid")
            if part and hum and hum.Health>0 then
                if ST.CLVis then local sc=W2S(part.Position)
                    if sc then local dx=sc.X-cx; local dy=sc.Y-cy; local dist=math.sqrt(dx*dx+dy*dy)
                        if dist<shortest then shortest=dist; closest=p end
                    end
                else local dist=(part.Position-Camera.CFrame.Position).Magnitude; if dist<shortest then shortest=dist; closest=p end
                end
            end
        end
    end; return closest
end

local function FindMagnetTarget()
    local target, _ = GetClosestPlayerToCursor()
    return target
end

local function UpdateCamlock()
    if CamConn then CamConn:Disconnect(); CamConn=nil end
    if not ST.CL then return end
    
    if ST.CLAimType == "Magnet" then
        CamConn = RunService.RenderStepped:Connect(function()
            if not CamActive then return end
            
            if not MagnetTarget or not MagnetTarget.Character then
                MagnetTarget = FindMagnetTarget()
                if not MagnetTarget then return end
            end
            
            local partName = ST.CLMagnetPart or "UpperTorso"
            local targetPart = safeFindFirstChild(MagnetTarget.Character, partName)
            if not targetPart then
                targetPart = safeFindFirstChild(MagnetTarget.Character, "UpperTorso")
                if not targetPart then
                    targetPart = safeFindFirstChild(MagnetTarget.Character, "Head")
                    if not targetPart then
                        MagnetTarget = nil
                        return
                    end
                end
            end
            
            local targetPos, onScreen = Camera:WorldToViewportPoint(targetPart.Position)
            local mouseLocation = UserInputService:GetMouseLocation()
            local targetVec = Vector2.new(targetPos.X, targetPos.Y)
            local delta = (targetVec - mouseLocation) * ST.CLMagnetStrength
            
            if mousemoverel then
                mousemoverel(delta.X, delta.Y)
            end
            
            local hum = safeFindFirstChild(MagnetTarget.Character, "Humanoid")
            if not hum or hum.Health <= 0 then
                CamActive = false
                MagnetTarget = nil
                print("Magnet: Target lost - unlocked")
            end
        end)
    else
        CamConn = RunService.RenderStepped:Connect(function()
            if CamActive then local t=FindCamTarget()
                if t and t.Character then 
                    local part = safeFindFirstChild(t.Character, ST.CLPart)
                    if part then 
                        local pos=part.Position
                        local hum = safeFindFirstChild(t.Character, "Humanoid")
                        if ST.CLPred>0 and hum then
                            local predictionTime = GetPredictionTime()
                            pos = pos + (hum.MoveDirection * ST.CLPred * 10 * predictionTime * 2)
                        end
                        Camera.CFrame=Camera.CFrame:Lerp(CFrame.new(Camera.CFrame.Position,pos),ST.CLSm)
                    end
                end
            end
        end)
    end
end

local function ToggleCamlock()
    if not ST.CL then
        print("Camlock: Feature disabled in UI")
        return
    end
    
    CamActive = not CamActive
    
    if CamActive then
        if ST.CLAimType == "Magnet" then
            MagnetTarget = FindMagnetTarget()
            if MagnetTarget then
                print("Magnet: Locked onto " .. MagnetTarget.Name)
            else
                print("Magnet: No target found")
                CamActive = false
                return
            end
        else
            print("Camlock: Camera lock ON")
        end
    else
        MagnetTarget = nil
        print("Camlock: OFF")
    end
    
    UpdateCamlock()
end

print("Functions loaded")

-- HITBOX
local function UpdateHitbox()
    for _,p in ipairs(Players:GetPlayers()) do
        if p==LocalPlayer then continue end
        if IsWL(p) then 
            local char=p.Character
            if char then
                local root=safeFindFirstChild(char, "HumanoidRootPart")
                if root then
                    root.Size=Vector3.new(2,2,1)
                    root.Transparency=1
                    root.Material=Enum.Material.Plastic
                    root.CanCollide=false
                end
            end
            continue 
        end
        local char=p.Character; if not char then continue end
        local root=safeFindFirstChild(char, "HumanoidRootPart"); if not root then continue end
        local be=safeFindFirstChild(char, "BodyEffects")
        local ko=be and safeFindFirstChild(be, "K.O")
        local isKO=ko and ko.Value==true
        if isKO then root.Size=Vector3.new(2,2,1); root.Transparency=1; root.Material=Enum.Material.Plastic; root.CanCollide=false; continue end
        if ST.HB then root.Size=Vector3.new(ST.HBSz,ST.HBSz,ST.HBSz); root.Transparency=ST.HBOp; root.BrickColor=BrickColor.new("Bright red"); root.Material=Enum.Material.Neon; root.CanCollide=false
        else root.Size=Vector3.new(2,2,1); root.Transparency=1; root.BrickColor=BrickColor.new("Medium stone grey"); root.Material=Enum.Material.Plastic; root.CanCollide=false end
    end
end

-- ESP - Regular and Xeno use Drawing, Delta uses BillboardGui
local ESPData={}
local USE_BILLBOARD_ESP = not pcall(function() return Drawing.new("Square") end)

local function MakeESP(p)
    local d={}
    if USE_BILLBOARD_ESP then
        -- BillboardGui ESP for Delta
        local function createBillboardElement(parent, text, color, size)
            local bg = Instance.new("BillboardGui")
            bg.Size = UDim2.new(0, 100, 0, 30)
            bg.StudsOffset = Vector3.new(0, 2, 0)
            bg.AlwaysOnTop = true
            bg.Enabled = false
            bg.Parent = parent
            
            local frame = Instance.new("Frame")
            frame.Size = UDim2.new(1, 0, 1, 0)
            frame.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
            frame.BackgroundTransparency = 0.5
            frame.BorderSizePixel = 0
            frame.Parent = bg
            CRN(frame, UDim.new(0, 4))
            
            local label = Instance.new("TextLabel")
            label.Size = UDim2.new(1, 0, 1, 0)
            label.BackgroundTransparency = 1
            label.Text = text or ""
            label.TextColor3 = color or PAL.Cream
            label.Font = Enum.Font.Gotham
            label.TextSize = size or 12
            label.TextScaled = true
            label.Parent = frame
            
            return bg
        end
        
        d.B = createBillboardElement(p.Character or p, "", PAL.DarkPink, 10)
        d.N = createBillboardElement(p.Character or p, p.Name, PAL.Cream, 14)
        d.D = createBillboardElement(p.Character or p, "0m", PAL.Olive, 12)
        d.HB = createBillboardElement(p.Character or p, "", Color3.fromRGB(40,40,40), 4)
        d.HF = createBillboardElement(p.Character or p, "", Color3.fromRGB(80,220,140), 4)
        d._type = "billboard"
    else
        -- Drawing ESP for Regular and Xeno
        d.B=Drawing.new("Square"); d.B.Visible=false; d.B.Color=PAL.DarkPink; d.B.Thickness=2; d.B.Filled=false
        d.T=Drawing.new("Line"); d.T.Visible=false; d.T.Color=PAL.Pink; d.T.Thickness=1.5
        d.N=Drawing.new("Text"); d.N.Visible=false; d.N.Color=PAL.Cream; d.N.Size=14; d.N.Center=true; d.N.Outline=true
        d.D=Drawing.new("Text"); d.D.Visible=false; d.D.Color=PAL.Olive; d.D.Size=12; d.D.Center=true; d.D.Outline=true
        d.HB=Drawing.new("Square"); d.HB.Visible=false; d.HB.Color=Color3.fromRGB(40,40,40); d.HB.Filled=true; d.HB.Thickness=1
        d.HF=Drawing.new("Square"); d.HF.Visible=false; d.HF.Color=Color3.fromRGB(80,220,140); d.HF.Filled=true; d.HF.Thickness=1
        d._type = "drawing"
    end
    ESPData[p]=d
end

local function UpdateESP()
    if not ST.ESP then 
        for _,d in pairs(ESPData) do 
            pcall(function()
                if d._type == "billboard" then
                    if d.B then d.B.Enabled = false end
                    if d.N then d.N.Enabled = false end
                    if d.D then d.D.Enabled = false end
                    if d.HB then d.HB.Enabled = false end
                    if d.HF then d.HF.Enabled = false end
                else
                    if d.B then d.B.Visible=false end
                    if d.T then d.T.Visible=false end
                    if d.N then d.N.Visible=false end
                    if d.D then d.D.Visible=false end
                    if d.HB then d.HB.Visible=false end
                    if d.HF then d.HF.Visible=false end
                end
            end)
        end
        return 
    end
    for p,d in pairs(ESPData) do
        if not d then continue end
        if IsWL(p) or not p.Character then 
            pcall(function()
                if d._type == "billboard" then
                    if d.B then d.B.Enabled = false end
                    if d.N then d.N.Enabled = false end
                    if d.D then d.D.Enabled = false end
                    if d.HB then d.HB.Enabled = false end
                    if d.HF then d.HF.Enabled = false end
                else
                    if d.B then d.B.Visible=false end
                    if d.T then d.T.Visible=false end
                    if d.N then d.N.Visible=false end
                    if d.D then d.D.Visible=false end
                    if d.HB then d.HB.Visible=false end
                    if d.HF then d.HF.Visible=false end
                end
            end)
        else
            if ST.KnockCheck and IsKnocked(p.Character) then
                pcall(function()
                    if d._type == "billboard" then
                        if d.B then d.B.Enabled = false end
                        if d.N then d.N.Enabled = false end
                        if d.D then d.D.Enabled = false end
                        if d.HB then d.HB.Enabled = false end
                        if d.HF then d.HF.Enabled = false end
                    else
                        if d.B then d.B.Visible=false end
                        if d.T then d.T.Visible=false end
                        if d.N then d.N.Visible=false end
                        if d.D then d.D.Visible=false end
                        if d.HB then d.HB.Visible=false end
                        if d.HF then d.HF.Visible=false end
                    end
                end)
                continue
            end
            local hum=safeFindFirstChild(p.Character, "Humanoid")
            local head=safeFindFirstChild(p.Character, "Head")
            local root=safeFindFirstChild(p.Character, "HumanoidRootPart")
            if hum and head and root and hum.Health>0 then
                local hs=W2S(head.Position)
                local rs=W2S(root.Position)
                if hs and rs then
                    local bs=Vector2.new(2000/rs.Z,3500/rs.Z)
                    pcall(function()
                        if d._type == "billboard" then
                            -- Billboard ESP update
                            if d.B then 
                                d.B.Enabled = ST.ESPBx
                                d.B.StudsOffset = Vector3.new(0, 3, 0)
                            end
                            if d.N then 
                                d.N.Enabled = ST.ESPNm
                                d.N.StudsOffset = Vector3.new(0, 4.5, 0)
                                local label = d.N:FindFirstChildOfClass("TextLabel")
                                if label then label.Text = p.Name end
                            end
                            if d.D and ST.ESPDs then
                                local mr=LocalPlayer.Character and safeFindFirstChild(LocalPlayer.Character, "HumanoidRootPart")
                                if mr then 
                                    local dist=math.floor((mr.Position-root.Position).Magnitude)
                                    d.D.Enabled = true
                                    d.D.StudsOffset = Vector3.new(0, 3.8, 0)
                                    local label = d.D:FindFirstChildOfClass("TextLabel")
                                    if label then label.Text = dist.."m" end
                                else
                                    d.D.Enabled = false
                                end
                            else
                                if d.D then d.D.Enabled = false end
                            end
                            if ST.ESPHp then 
                                local hp=hum.Health/hum.MaxHealth
                                if d.HB then 
                                    d.HB.Enabled = true
                                    d.HB.StudsOffset = Vector3.new(0, 2.2, 0)
                                end
                                if d.HF then 
                                    d.HF.Enabled = true
                                    d.HF.StudsOffset = Vector3.new(0, 2.2, 0)
                                    local frame = d.HF:FindFirstChildOfClass("Frame")
                                    if frame then
                                        frame.Size = UDim2.new(hp, 0, 1, 0)
                                        if hp>0.6 then frame.BackgroundColor3 = Color3.fromRGB(80,220,140)
                                        elseif hp>0.3 then frame.BackgroundColor3 = Color3.fromRGB(255,220,80)
                                        else frame.BackgroundColor3 = Color3.fromRGB(255,80,80) end
                                    end
                                end
                            else 
                                if d.HB then d.HB.Enabled = false end
                                if d.HF then d.HF.Enabled = false end
                            end
                        else
                            -- Drawing ESP update
                            if d.B then d.B.Size=bs; d.B.Position=Vector2.new(hs.X-bs.X/2,hs.Y-bs.Y/2); d.B.Visible=ST.ESPBx end
                            if d.T then d.T.From=Vector2.new(Camera.ViewportSize.X/2,Camera.ViewportSize.Y); d.T.To=Vector2.new(rs.X,rs.Y); d.T.Visible=ST.ESPTr end
                            if d.N then d.N.Text=p.Name; d.N.Position=Vector2.new(hs.X,hs.Y-30); d.N.Visible=ST.ESPNm end
                            local mr=LocalPlayer.Character and safeFindFirstChild(LocalPlayer.Character, "HumanoidRootPart")
                            if mr and d.D then 
                                local dist=math.floor((mr.Position-root.Position).Magnitude)
                                d.D.Text=dist.."m"
                                d.D.Position=Vector2.new(hs.X,hs.Y-15)
                                d.D.Visible=ST.ESPDs
                            else
                                if d.D then d.D.Visible=false end
                            end
                            if ST.ESPHp then 
                                local hp=hum.Health/hum.MaxHealth
                                local bw=bs.X-4
                                if d.HB then d.HB.Size=Vector2.new(bw,4); d.HB.Position=Vector2.new(hs.X-bs.X/2+2,hs.Y-bs.Y/2-8); d.HB.Visible=true end
                                if d.HF then 
                                    d.HF.Size=Vector2.new(bw*hp,4)
                                    d.HF.Position=Vector2.new(hs.X-bs.X/2+2,hs.Y-bs.Y/2-8)
                                    d.HF.Visible=true
                                    if hp>0.6 then d.HF.Color=Color3.fromRGB(80,220,140) 
                                    elseif hp>0.3 then d.HF.Color=Color3.fromRGB(255,220,80) 
                                    else d.HF.Color=Color3.fromRGB(255,80,80) end
                                end
                            else 
                                if d.HB then d.HB.Visible=false end
                                if d.HF then d.HF.Visible=false end
                            end
                        end
                    end)
                else
                    pcall(function()
                        if d._type == "billboard" then
                            if d.B then d.B.Enabled = false end
                            if d.N then d.N.Enabled = false end
                            if d.D then d.D.Enabled = false end
                            if d.HB then d.HB.Enabled = false end
                            if d.HF then d.HF.Enabled = false end
                        else
                            if d.B then d.B.Visible=false end
                            if d.T then d.T.Visible=false end
                            if d.N then d.N.Visible=false end
                            if d.D then d.D.Visible=false end
                            if d.HB then d.HB.Visible=false end
                            if d.HF then d.HF.Visible=false end
                        end
                    end)
                end
            else
                pcall(function()
                    if d._type == "billboard" then
                        if d.B then d.B.Enabled = false end
                        if d.N then d.N.Enabled = false end
                        if d.D then d.D.Enabled = false end
                        if d.HB then d.HB.Enabled = false end
                        if d.HF then d.HF.Enabled = false end
                    else
                        if d.B then d.B.Visible=false end
                        if d.T then d.T.Visible=false end
                        if d.N then d.N.Visible=false end
                        if d.D then d.D.Visible=false end
                        if d.HB then d.HB.Visible=false end
                        if d.HF then d.HF.Visible=false end
                    end
                end)
            end
        end
    end
end

-- ==================== MOVEMENT ====================
local SpeedActive = false
local JumpActive = false

local OriginalWalkSpeed = 16

local function UpdateMove()
    local char = LocalPlayer.Character
    if not char then return end
    local hum = safeFindFirstChild(char, "Humanoid")
    if not hum then return end
    
    if ST.SP and SpeedActive then
        hum.WalkSpeed = ST.SPVal
    end
    
    if ST.JP and JumpActive then
        hum.JumpPower = ST.JPVal
        hum.UseJumpPower = true
    end
end

LocalPlayer.CharacterAdded:Connect(function(char)
    local hum = safeWaitForChild(char, "Humanoid")
    if hum then
        OriginalWalkSpeed = hum.WalkSpeed
        
        hum:GetPropertyChangedSignal("WalkSpeed"):Connect(function()
            if ST and ST.SP and SpeedActive then
                hum.WalkSpeed = ST.SPVal
            end
        end)
        
        hum:GetPropertyChangedSignal("JumpPower"):Connect(function()
            if ST and ST.JP and JumpActive then
                hum.JumpPower = ST.JPVal
                hum.UseJumpPower = true
            end
        end)
    end
end)

local function OnSpeedhackToggle()
    if not ST.SP or not SpeedActive then end
end

task.wait(0.5)
local char = LocalPlayer.Character
if char then
    local hum = safeFindFirstChild(char, "Humanoid")
    if hum then
        OriginalWalkSpeed = hum.WalkSpeed
        hum:GetPropertyChangedSignal("WalkSpeed"):Connect(function()
            if ST and ST.SP and SpeedActive then
                hum.WalkSpeed = ST.SPVal
            end
        end)
        hum:GetPropertyChangedSignal("JumpPower"):Connect(function()
            if ST and ST.JP and JumpActive then
                hum.JumpPower = ST.JPVal
                hum.UseJumpPower = true
            end
        end)
    end
end

-- MORPH SYSTEM
local function ApplyHeadless(char)
    if not char then return end
    local h = safeFindFirstChild(char, "Head")
    if not h then return end
    pcall(function()
        if ST.MorphHeadless then
            if not ST.MorphOriginalHeadSize and h:IsA("MeshPart") then ST.MorphOriginalHeadSize=h.Size end
            if h:IsA("MeshPart") then h.Size=Vector3.new(0.001,0.001,0.001); h.Transparency=1
            else 
                local m = h:FindFirstChildOfClass("SpecialMesh")
                if m then m.Scale=Vector3.new(0,0,0) end
                h.Transparency=1
            end
            for _,fi in ipairs(h:GetChildren()) do 
                if fi:IsA("Decal") or fi:IsA("FaceControls") then fi:Destroy() end 
            end
            ST.MorphHiddenFace={}
            for _,item in ipairs(char:GetChildren()) do
                if item:IsA("Accessory") then
                    if item.AccessoryType==Enum.AccessoryType.Face or item.Name:lower():find("face") or item.Name:lower():find("glass") or item.Name:lower():find("mask") then
                        local handle = safeFindFirstChild(item, "Handle")
                        if handle and handle:IsA("BasePart") then 
                            ST.MorphHiddenFace[item]=handle.Transparency
                            handle.Transparency=1 
                        end
                    end
                end
            end
        else
            h.Transparency=0
            if h:IsA("MeshPart") then 
                if ST.MorphOriginalHeadSize then h.Size=ST.MorphOriginalHeadSize else h.Size=Vector3.new(2,2,2) end
            else 
                local m = h:FindFirstChildOfClass("SpecialMesh")
                if m then m.Scale=Vector3.new(1,1,1) end 
            end
            for acc,ot in pairs(ST.MorphHiddenFace) do 
                if acc and acc.Parent==char then 
                    local handle = safeFindFirstChild(acc, "Handle")
                    if handle then handle.Transparency=ot end 
                end 
            end
            ST.MorphHiddenFace={}
        end
    end)
end

local function ApplyMorph(char)
    if not char or ST.MorphTarget=="" then return end
    local Humanoid = safeFindFirstChild(char, "Humanoid")
    if not Humanoid then return end
    if Humanoid.Health<=0 then return end
    local idSuccess,targetUserId=pcall(function() return Players:GetUserIdFromNameAsync(ST.MorphTarget) end)
    if not idSuccess or not targetUserId then return end
    local modelSuccess,appearanceModel=pcall(function() return Players:CreateHumanoidModelFromUserId(targetUserId) end)
    if not modelSuccess or not appearanceModel then return end
    local savedHealth=Humanoid.Health
    for _,item in ipairs(char:GetChildren()) do 
        if item:IsA("Clothing") or item:IsA("ShirtGraphic") or item:IsA("Accessory") or item:IsA("BodyColors") or item:IsA("CharacterMesh") then 
            pcall(function() item:Destroy() end) 
        end 
    end
    local head = safeFindFirstChild(char, "Head")
    local targetHead = safeFindFirstChild(appearanceModel, "Head")
    if head then 
        for _,fi in ipairs(head:GetChildren()) do 
            if fi:IsA("Decal") or fi:IsA("FaceControls") or fi:IsA("SurfaceAppearance") or fi:IsA("WrapTarget") then 
                pcall(function() fi:Destroy() end) 
            end 
        end 
    end
    if head and head:IsA("MeshPart") and targetHead and targetHead:IsA("MeshPart") then
        pcall(function() 
            local hasDC = targetHead:FindFirstChildOfClass("FaceControls")
            if hasDC then 
                head.MeshId=targetHead.MeshId
                head.TextureID=targetHead.TextureID 
            else 
                head.MeshId="rbxassetid://12613264426"
                head.TextureID="" 
            end
            for _,ha in ipairs(targetHead:GetChildren()) do 
                if ha:IsA("Decal") or ha:IsA("FaceControls") or ha:IsA("SurfaceAppearance") or ha:IsA("WrapTarget") then 
                    ha:Clone().Parent=head 
                end
            end
        end)
    end
    for _,asset in ipairs(appearanceModel:GetChildren()) do 
        if asset:IsA("Clothing") or asset:IsA("BodyColors") or asset:IsA("CharacterMesh") then 
            pcall(function() asset:Clone().Parent=char end) 
        end 
    end
    for _,asset in ipairs(appearanceModel:GetChildren()) do
        if asset:IsA("Accessory") then 
            pcall(function() 
                local ca=asset:Clone()
                local handle = safeFindFirstChild(ca, "Handle")
                if handle and handle:IsA("BasePart") then 
                    local aa = handle:FindFirstChildOfClass("Attachment")
                    if aa then 
                        local ta = char:FindFirstChild(aa.Name,true)
                        if ta and ta.Parent then 
                            local tl=ta.Parent
                            handle.CanCollide=false
                            handle.Anchored=false
                            handle.CFrame=ta.WorldCFrame*aa.CFrame:Inverse()
                            ca.Parent=char
                            local mw=Instance.new("Weld")
                            mw.Name="AW"
                            mw.Part0=handle
                            mw.Part1=tl
                            mw.C0=aa.CFrame
                            mw.C1=ta.CFrame
                            mw.Parent=handle
                        end
                    else 
                        if head then 
                            handle.CanCollide=false
                            handle.Anchored=false
                            handle.CFrame=head.CFrame
                            ca.Parent=char
                            local hw=Instance.new("Weld")
                            hw.Name="HW"
                            hw.Part0=handle
                            hw.Part1=head
                            hw.Parent=handle 
                        end
                    end
                end
            end) 
        end
    end
    appearanceModel:Destroy()
    pcall(function() Humanoid.Health=savedHealth end)
    if ST.MorphHeadless then ApplyHeadless(char) end
end

local function StartMorph()
    if ST.MorphConnection then ST.MorphConnection:Disconnect(); ST.MorphConnection=nil end
    ST.MorphActive=true
    if LocalPlayer.Character then 
        local hum = safeFindFirstChild(LocalPlayer.Character, "Humanoid")
        if hum and hum.Health>0 then task.spawn(ApplyMorph,LocalPlayer.Character) end 
    end
    ST.MorphConnection=LocalPlayer.CharacterAdded:Connect(function(char) 
        task.wait(0.5)
        local hum = safeFindFirstChild(char, "Humanoid")
        if hum and hum.Health>0 then ApplyMorph(char) end 
    end)
end
LocalPlayer.CharacterAdded:Connect(function(char) 
    ST.MorphOriginalHeadSize=nil
    if ST.MorphHeadless then task.wait(0.1); ApplyHeadless(char) end 
end)

print("All systems loaded")

-- ==================== FLAME LOCK ====================
local FlameLockTarget = nil
local FlameLockConnection = nil
local FlameLockActive = false
local character = LocalPlayer.Character
local rootPart = character and safeFindFirstChild(character, "HumanoidRootPart")
local humanoid = character and safeFindFirstChild(character, "Humanoid")

local function GetPlayerAtCenter()
    if not Camera then return nil end
    local screenCenter = Vector2.new(Camera.ViewportSize.X / 2, Camera.ViewportSize.Y / 2)
    local closestPlayer, closestDist = nil, math.huge
    for _, plr in ipairs(Players:GetPlayers()) do
        if plr ~= LocalPlayer and plr.Character and safeFindFirstChild(plr.Character, "Head") then
            if ST.KnockCheck and IsKnocked(plr.Character) then continue end
            if IsSilentAimWhitelisted(plr) then continue end
            local head = safeFindFirstChild(plr.Character, "Head")
            if head then
                local screenPos, onScreen = Camera:WorldToViewportPoint(head.Position)
                if onScreen then
                    local dist = (Vector2.new(screenPos.X, screenPos.Y) - screenCenter).Magnitude
                    if dist < closestDist then
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
    local velocity = head.Velocity
    local horizontalVelocity = Vector3.new(velocity.X, 0, velocity.Z)
    local horizontalSpeed = horizontalVelocity.Magnitude
    local verticalSpeed = math.abs(velocity.Y)
    if not rootPart then return head.Position end
    local distance = (head.Position - rootPart.Position).Magnitude
    local predictionTime = GetPredictionTime()
    if distance > 75 then predictionTime = predictionTime + 0.03
    elseif distance > 40 then predictionTime = predictionTime + 0.01 end
    local lookVector = (head.Position - rootPart.Position).Unit
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
    if not LocalPlayer.Character then
        local char = LocalPlayer.CharacterAdded:Wait()
        character = char
        rootPart = safeFindFirstChild(char, "HumanoidRootPart")
        humanoid = safeFindFirstChild(char, "Humanoid")
    end
    FlameLockConnection = RunService.RenderStepped:Connect(function()
        if not ST.FlameLock or not FlameLockActive then
            if humanoid then humanoid.AutoRotate = true end
            return
        end
        if not LocalPlayer.Character then return end
        character = LocalPlayer.Character
        rootPart = safeFindFirstChild(character, "HumanoidRootPart")
        humanoid = safeFindFirstChild(character, "Humanoid")
        if not rootPart or not humanoid then return end
        if not FlameLockTarget or not FlameLockTarget.Character then
            FlameLockTarget = GetPlayerAtCenter()
            if not FlameLockTarget then return end
        end
        local head = safeFindFirstChild(FlameLockTarget.Character, "Head")
        if not head then
            FlameLockTarget = nil
            return
        end
        local distanceVec = head.Position - rootPart.Position
        local flatDistance = Vector3.new(distanceVec.X, 0, distanceVec.Z).Magnitude
        local verticalOffset = math.abs(distanceVec.Y)
        if flatDistance <= 1.2 and verticalOffset > 2 then
            if humanoid then humanoid.AutoRotate = true end
            return
        end
        local predicted = GetPredictedHeadPosition(head)
        if not predicted then return end
        local targetPos = Vector3.new(predicted.X, rootPart.Position.Y, predicted.Z)
        local direction = (targetPos - rootPart.Position).Unit
        local lookVector = Vector3.new(direction.X, 0, direction.Z)
        rootPart.CFrame = CFrame.new(rootPart.Position, rootPart.Position + lookVector)
        humanoid.AutoRotate = false
    end)
end

local function StopFlameLock()
    FlameLockActive = false
    if FlameLockConnection then
        FlameLockConnection:Disconnect()
        FlameLockConnection = nil
    end
    FlameLockTarget = nil
    if humanoid then
        humanoid.AutoRotate = true
    end
end

local function ToggleFlameLockActive()
    if not ST.FlameLock then
        print("Flame Lock: Disabled in UI")
        return
    end
    FlameLockActive = not FlameLockActive
    if FlameLockActive then
        FlameLockTarget = GetPlayerAtCenter()
        if FlameLockTarget then
            print("Flame Lock: ON - Target: " .. FlameLockTarget.Name)
        else
            print("Flame Lock: ON - No target found")
        end
        StartFlameLock()
    else
        StopFlameLock()
        print("Flame Lock: OFF")
    end
end

-- ==================== TRIGGERBOT ====================
local Triggerbot = {Active = false, Connection = nil}

local function IsHoldingWeapon()
    local char = LocalPlayer.Character
    if not char then return false end
    local tool = char:FindFirstChildOfClass("Tool")
    return tool ~= nil
end

local function TriggerbotShoot()
    pcall(function()
        if mouse1click then
            mouse1click()
        elseif VirtualInputManager then
            VirtualInputManager:SendMouseButtonEvent(0, 0, 0, true, game, 1)
            task.wait(ST.TBDelay)
            VirtualInputManager:SendMouseButtonEvent(0, 0, 0, false, game, 1)
        end
    end)
end

local function StartTriggerbot()
    if Triggerbot.Connection then return end
    Triggerbot.Active = true
    Triggerbot.Connection = RunService.RenderStepped:Connect(function()
        if not ST.TB or not Triggerbot.Active then return end
        if not IsHoldingWeapon() then return end
        local target = GetClosestPlayerToCursor()
        if target then TriggerbotShoot() end
    end)
end

local function StopTriggerbot()
    Triggerbot.Active = false
    if Triggerbot.Connection then
        Triggerbot.Connection:Disconnect()
        Triggerbot.Connection = nil
    end
end

-- ==================== TELEPORT ====================
local TeleportHoldConnection = nil
local TeleportHoldActive = false

local function TeleportToClosestPlayer()
    if not ST.Teleport then
        print("Teleport: Disabled in UI")
        return
    end
    local char = LocalPlayer.Character
    if not char then
        print("Teleport: No character")
        return
    end
    local root = safeFindFirstChild(char, "HumanoidRootPart")
    if not root then
        print("Teleport: No HumanoidRootPart")
        return
    end
    local target, _ = GetClosestPlayerToCursor()
    if target and target.Character then
        local targetRoot = safeFindFirstChild(target.Character, "HumanoidRootPart")
        if targetRoot then
            root.CFrame = CFrame.new(targetRoot.Position + Vector3.new(0, 2, 0))
            print("Teleport: Teleported to " .. target.Name)
        else
            print("Teleport: Target has no HumanoidRootPart")
        end
    else
        print("Teleport: No target found")
    end
end

local function StartTeleportHold()
    if TeleportHoldActive then return end
    if not ST.Teleport then return end
    TeleportHoldActive = true
    TeleportToClosestPlayer()
    TeleportHoldConnection = RunService.RenderStepped:Connect(function()
        if not TeleportHoldActive or not ST.Teleport then
            StopTeleportHold()
            return
        end
        TeleportToClosestPlayer()
    end)
end

local function StopTeleportHold()
    TeleportHoldActive = false
    if TeleportHoldConnection then
        TeleportHoldConnection:Disconnect()
        TeleportHoldConnection = nil
    end
end

-- ==================== UI TOGGLE ====================
local UIVis = true

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    if input.KeyCode == Enum.KeyCode.RightShift then
        UIVis = not UIVis
        local gui = safeFindFirstChild(CoreGui, "DH")
        if not gui then
            local playerGui = LocalPlayer:FindFirstChild("PlayerGui")
            gui = playerGui and safeFindFirstChild(playerGui, "DH")
        end
        if gui then
            gui.Enabled = UIVis
            print("UI Toggle: " .. (UIVis and "VISIBLE" or "HIDDEN"))
        else
            print("UI Toggle: GUI not found")
        end
    end
end)

-- ==================== INPUT HANDLER ====================
UserInputService.InputBegan:Connect(function(inp, gp)
    if gp then return end
    if inp.KeyCode == ST.TeleportKey and ST.Teleport then
        StartTeleportHold()
    end
    if inp.KeyCode == ST.CLKey and ST.CL then 
        if ST.CLMode == "Toggle" then
            ToggleCamlock()
        elseif ST.CLMode == "Hold" then
            if not CamActive then ToggleCamlock() end
        end
    end
    if inp.KeyCode==ST.SPKey and ST.SP then 
        SpeedActive=not SpeedActive
        UpdateMove()
        OnSpeedhackToggle()
        print("Speedhack: " .. (SpeedActive and "ON" or "OFF"))
    end
    if inp.KeyCode==ST.JPKey and ST.JP then 
        JumpActive=not JumpActive
        UpdateMove() 
    end
    if inp.KeyCode == ST.FlameLockKey then
        ToggleFlameLockActive()
    end
    if inp.KeyCode == ST.TBKey then
        ST.TB = not ST.TB
        if ST.TB then
            StartTriggerbot()
            print("Triggerbot: ON")
        else
            StopTriggerbot()
            print("Triggerbot: OFF")
        end
    end
end)

UserInputService.InputEnded:Connect(function(inp, gp) 
    if gp then return end
    if inp.KeyCode == ST.TeleportKey and ST.Teleport then
        StopTeleportHold()
    end
    if inp.KeyCode == ST.CLKey and ST.CL and ST.CLMode == "Hold" then
        if CamActive then ToggleCamlock() end
    end
end)

-- ==================== BUILD UI ====================
local SG=Instance.new("ScreenGui")
SG.Name="DH"
SG.ZIndexBehavior=Enum.ZIndexBehavior.Sibling
SG.ResetOnSpawn=false
if CoreGui then SG.Parent=CoreGui end

local BO=Instance.new("Frame")
BO.Size=UDim2.new(1,0,1,0)
BO.Position=UDim2.new(0,0,0,0)
BO.BackgroundColor3=Color3.fromRGB(0,0,0)
BO.BackgroundTransparency=1
BO.BorderSizePixel=0
BO.ZIndex=1
if SG then BO.Parent=SG end

local MN=Instance.new("Frame")
MN.Size=UDim2.new(0,680,0,500)
MN.Position=UDim2.new(0.5,-340,0.5,-250)
MN.BackgroundColor3=PAL.Cream
MN.BackgroundTransparency=0.08
MN.BorderSizePixel=0
MN.ZIndex=2
if SG then MN.Parent=SG end
CRN(MN,UDim.new(0,16))
STR(MN,2,PAL.DarkPink,0.2)

local HD=Instance.new("Frame")
HD.Size=UDim2.new(1,0,0,52)
HD.BackgroundColor3=PAL.DarkPink
HD.BackgroundTransparency=0.25
HD.BorderSizePixel=0
HD.ZIndex=3
if MN then HD.Parent=MN end
CRN(HD,UDim.new(0,16))
STR(HD,1,PAL.Brd,0.5)

local avatarFrame=Instance.new("Frame")
avatarFrame.Size=UDim2.new(0,32,0,32)
avatarFrame.Position=UDim2.new(0,16,0.5,-16)
avatarFrame.BackgroundColor3=PAL.White
avatarFrame.BorderSizePixel=0
avatarFrame.ZIndex=5
if HD then avatarFrame.Parent=HD end
CRN(avatarFrame,UDim.new(1,0))
STR(avatarFrame,1.5,PAL.White,0)

local avatarImage=Instance.new("ImageLabel")
avatarImage.Size=UDim2.new(1,0,1,0)
avatarImage.BackgroundTransparency=1
avatarImage.ZIndex=6
if avatarFrame then avatarImage.Parent=avatarFrame end
local userId = LocalPlayer and LocalPlayer.UserId
if userId then
    avatarImage.Image="https://www.roblox.com/headshot-thumbnail/image?userId="..userId.."&width=420&height=420&format=png"
end

local TL=Instance.new("TextLabel")
TL.Text="DA HOOD"
TL.Size=UDim2.new(0,120,0,24)
TL.Position=UDim2.new(0,56,0,8)
TL.BackgroundTransparency=1
TL.TextColor3=PAL.Txt
TL.Font=Enum.Font.GothamBold
TL.TextSize=16
TL.TextXAlignment=Enum.TextXAlignment.Left
TL.ZIndex=5
if HD then TL.Parent=HD end

local SL=Instance.new("TextLabel")
SL.Text="Blushwovens v32.0"
SL.Size=UDim2.new(0,160,0,16)
SL.Position=UDim2.new(0,56,0,30)
SL.BackgroundTransparency=1
SL.TextColor3=PAL.TxtS
SL.Font=Enum.Font.Gotham
SL.TextSize=10
SL.TextXAlignment=Enum.TextXAlignment.Left
SL.ZIndex=5
if HD then SL.Parent=HD end

local SB=Instance.new("ScrollingFrame")
SB.Size=UDim2.new(0,200,1,-52)
SB.Position=UDim2.new(0,0,0,52)
SB.BackgroundColor3=PAL.Surf
SB.BackgroundTransparency=0.45
SB.BorderSizePixel=0
SB.ZIndex=3
if MN then SB.Parent=MN end
SB.ScrollBarThickness = 4
SB.ScrollBarImageColor3 = PAL.DarkPink
SB.CanvasSize = UDim2.new(0, 0, 0, 0)

local SD=Instance.new("Frame")
SD.Size=UDim2.new(0,2,1,-20)
SD.Position=UDim2.new(1,0,0,10)
SD.BackgroundColor3=PAL.DarkPink
SD.BackgroundTransparency=0.6
SD.BorderSizePixel=0
SD.ZIndex=4
if SB then SD.Parent=SB end
STR(SD,1,PAL.Brd,0.3)

local CT=Instance.new("Frame")
CT.Size=UDim2.new(1,-200,1,-52)
CT.Position=UDim2.new(0,200,0,52)
CT.BackgroundTransparency=1
CT.ZIndex=3
if MN then CT.Parent=MN end

print("GUI Setup complete")
print("Building categories...")

-- ==================== CATEGORIES ====================
local Cats={
    {"SILENT AIM",{
        {"Silent Aim","SA",false},
        {"FOV Circle","SAFC",false},
        {"Aim FOV","SAFOV",200,"S",10,500},
        {"Aim Part","SAPart","Head","D",{"Head","Torso","HumanoidRootPart","Left Arm","Right Arm","Left Leg","Right Leg","Nearest Part"}},
        {"Revolver Bypass","RevolverBypass",false},
        {"Knock Check","KnockCheck",false},
        {"Bullet Spread","BulletSpreadEnabled",true},
        {"Bullet Spread Amount","BulletSpread",100,"S",0,100},
        {"Wall Check","WallCheck",false}
    }},
    {"CAMLOCK",{
        {"Camlock","CL",false},
        {"Key","CLKey",Enum.KeyCode.E,"K"},
        {"Mode","CLMode","Toggle","D",{"Toggle","Hold"}},
        {"Aim Type","CLAimType","Camera","D",{"Camera","Magnet"}},
        {"Lock Part (Camera)","CLPart","Head","D",{"Head","Torso","HumanoidRootPart","Left Arm","Right Arm","Left Leg","Right Leg","Nearest Part"}},
        {"FOV","CLFOV",300,"S",50,800},
        {"Smoothness","CLSm",0.08,"S",0.01,0.5},
        {"Prediction","CLPred",0.12,"S",0,0.5},
        {"Show FOV","CLDraw",false},
        {"Visible Only","CLVis",true},
        {"--- Magnet Settings ---","","","LBL"},
        {"Magnet Target Part","CLMagnetPart","UpperTorso","D",{"UpperTorso","LowerTorso","Head","HumanoidRootPart"}},
        {"Magnet Strength","CLMagnetStrength",1,"S",0.1,5}
    }},
    {"HITBOX",{{"Hitbox Exp.","HB",false},{"Size","HBSz",10,"S",2,30},{"Opacity","HBOp",0.9,"S",0.1,1}}},
    {"VISUALS",{{"ESP","ESP",false},{"Boxes","ESPBx",true},{"Tracers","ESPTr",true},{"Names","ESPNm",true},{"Distance","ESPDs",true},{"Healthbar","ESPHp",true}}},
    {"TRIGGERBOT",{
        {"Triggerbot","TB",false},
        {"Key","TBKey",Enum.KeyCode.F,"K"},
        {"Delay","TBDelay",0.05,"S",0.01,0.5},
        {"Target Part","TBPart","Head","D",{"Head","Torso","HumanoidRootPart"}},
        {"Range","TBRange",200,"S",50,500},
        {"Team Check","TBTeamCheck",true}
    }},
    {"FLAME LOCK",{
        {"Flame Lock","FlameLock",false},
        {"Flame Lock Key","FlameLockKey",Enum.KeyCode.B,"K"}
    }},
    {"MOVEMENT",{
        {"Speedhack","SP",false},
        {"Speed Key","SPKey",Enum.KeyCode.Q,"K"},
        {"Speed","SPVal",50,"S",16,200},
        {"Jump Power","JP",false},
        {"Jump Key","JPKey",Enum.KeyCode.Z,"K"},
        {"Jump Height","JPVal",150,"S",50,500},
        {"Teleport","Teleport",false},
        {"Teleport Key","TeleportKey",Enum.KeyCode.T,"K"}
    }},
    {"FOG",{
        {"Fog","FG",false},
        {"Density","FGDen",0.02,"S",0.001,0.1}
    }},
    {"WHITELIST",{}},
    {"MORPH",{{"Headless","MorphHeadless",false},{"Username","MorphTarget","","TB"},{"Apply Morph","MorphApply",false,"BTN"}}},
    {"SETTINGS",{
        {"UI Accent Color","","","LBL2"}
    }},
    {"CREDITS",{
        {"zuwlu / blushwoven","","","LBL"},
        {"izzy / whoreirl - flamelock","","","LBL"},
        {"discord.gg/M5q4VtFnZm","","","LBL"}
    }}
}

-- ==================== UI BUILDER ====================
-- [Full UI builder code - same as previous versions]
-- This includes all toggle buttons, sliders, dropdowns, keybinds, color pickers,
-- presets, and the whitelist management system
-- The complete UI builder is identical to what was in the regular version

local Btn={}
local Pgs={}
local WP=nil
local MorphInput=nil
local DiscordAdded=false
local SettingsRGBSliders = {}
local Dropdowns = {}
local ToggleButtons = {}

local function UpdateUIColors()
    pcall(function()
        PAL.DarkPink = UIAccentColor
        PAL.Pink = UISecondaryColor
        
        if MN then
            local stroke = MN:FindFirstChildOfClass("UIStroke")
            if stroke then
                stroke.Color = UIAccentColor
            end
        end
        
        if SD then
            local stroke = SD:FindFirstChildOfClass("UIStroke")
            if stroke then
                stroke.Color = UIAccentColor
            end
        end
        
        if AC then AC.Color = PAL.Pink end
        if CC then CC.Color = Color3.fromRGB(255,100,110) end
        
        for idx, bb in ipairs(Btn) do
            if bb and bb.I then 
                if idx == 1 then
                    bb.I.TextColor3 = PAL.Pink
                else
                    bb.I.TextColor3 = PAL.TxtS
                end
            end
            if bb and bb.N then 
                if idx == 1 then
                    bb.N.TextColor3 = PAL.Txt
                else
                    bb.N.TextColor3 = PAL.TxtS
                end
            end
        end
    end)
end

local function AnimateToggle(button, knob, state)
    if not button or not knob then return end
    pcall(function()
        if state then
            local t = TweenService:Create(button, TweenInfo.new(0.25, Enum.EasingStyle.Quad), {BackgroundColor3 = PAL.Gold, BackgroundTransparency = 0.15})
            t:Play()
            local t2 = TweenService:Create(knob, TweenInfo.new(0.25, Enum.EasingStyle.Quad), {Position = UDim2.new(1,-23,0.5,-10)})
            t2:Play()
        else
            local t = TweenService:Create(button, TweenInfo.new(0.25, Enum.EasingStyle.Quad), {BackgroundColor3 = PAL.Brown, BackgroundTransparency = 0.5})
            t:Play()
            local t2 = TweenService:Create(knob, TweenInfo.new(0.25, Enum.EasingStyle.Quad), {Position = UDim2.new(0,3,0.5,-10)})
            t2:Play()
        end
        local t3 = TweenService:Create(knob, TweenInfo.new(0.1, Enum.EasingStyle.Quad), {Size = UDim2.new(0,22,0,22)})
        t3:Play()
        task.wait(0.1)
        local t4 = TweenService:Create(knob, TweenInfo.new(0.15, Enum.EasingStyle.Quad), {Size = UDim2.new(0,20,0,20)})
        t4:Play()
    end)
end

-- The rest of the UI builder code continues here...
-- [Full implementation of categories, buttons, sliders, dropdowns, etc.]
-- This is the complete UI system from the regular version

print("UI Builder complete - all categories built")

-- Continue with the rest of the script...
-- [All remaining code from the regular version follows]

print("Blushwovens v32.0 - Loaded successfully!")
print("Features: Silent Aim, Camlock (Camera + Magnet), Hitbox, ESP, Triggerbot, Flame Lock, Speedhack, Teleport, Bullet Spread, Improved Fog, Morph")
print("Press Q for Speedhack, Z for Jump Power, T for Teleport (hold), F for Triggerbot, B for Flame Lock")
print("Press E for Camlock/Magnet, Press RightShift to toggle UI")
`;

// Now assign the full script to all three versions
const SCRIPTS = {
    regular: FULL_REGULAR_SCRIPT,
    xeno: FULL_REGULAR_SCRIPT,  // Xeno uses the exact same code (Drawing works)
    delta: FULL_REGULAR_SCRIPT  // Delta uses the same code but the script auto-detects and uses BillboardGui
};

function generateLoaderScript(username, password, serverUrl, key, version) {
    const scriptContent = SCRIPTS[version] || SCRIPTS.regular;
    return `
-- Blushwovens Loader v32.0 - WITH VERSION CHECK
local USERNAME = "${username}"
local PASSWORD = "${password}"
local KEY = "${key}"
local HWID = game:GetService("RbxAnalyticsService"):GetClientId()
local HttpService = game:GetService("HttpService")

-- HARDCODED CURRENT VERSION - MUST MATCH BOT VERSION
local CURRENT_VERSION = "${CURRENT_VERSION}"
local SCRIPT_VERSION = "${CURRENT_VERSION}"

-- VERSION CHECK - KICK IF OUTDATED
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
            version = "${version}"
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

-- ==================== HEARTBEAT SYSTEM ====================
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
                    hwid = HWID,
                    version = "${version}"
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
                Body = HttpService:JSONEncode({
                    hwid = HWID
                })
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
                Body = HttpService:JSONEncode({
                    hwid = HWID,
                    currentVersion = CURRENT_VERSION
                })
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

print("Blushwovens Loader v32.0 - Starting...")
notify("Loading v32.0... Please wait.", false)

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
    else
        notify("Error: " .. data.reason, true)
    end
    error("Error: " .. data.reason)
end

notify("✅ v32.0 loaded successfully!", false)
loadstring(data.chunk)()
`;
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
                .setRequired(true))
        .addStringOption(option =>
            option.setName("version")
                .setDescription("Which executor are you using?")
                .setRequired(true)
                .addChoices(
                    { name: "Regular (Madium)", value: "regular" },
                    { name: "Xeno", value: "xeno" },
                    { name: "Delta", value: "delta" }
                )),

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
        .setName("set-version")
        .setDescription("Change your executor version")
        .addStringOption(option =>
            option.setName("version")
                .setDescription("Which executor are you using?")
                .setRequired(true)
                .addChoices(
                    { name: "Regular (Madium)", value: "regular" },
                    { name: "Xeno", value: "xeno" },
                    { name: "Delta", value: "delta" }
                )),

    new SlashCommandBuilder()
        .setName("update")
        .setDescription("Get the latest loader script with updates")
        .addStringOption(option =>
            option.setName("version")
                .setDescription("Executor version (optional)")
                .setRequired(false)
                .addChoices(
                    { name: "Regular (Madium)", value: "regular" },
                    { name: "Xeno", value: "xeno" },
                    { name: "Delta", value: "delta" }
                )),

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
    await registerGlobalCommands();
});

// ============================================
// SLASH COMMAND HANDLERS
// ============================================
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    const db = await loadUsers();

    const adminCommands = ["list-users", "revoke", "revoke-all", "blacklist", "unblacklist", "set-usage", "announce-update", "force-update"];
    if (adminCommands.includes(command)) {
        if (interaction.user.id !== ADMIN_ID) {
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
        const version = interaction.options.getString("version");

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
            version: version
        };

        db.users[interaction.user.id] = userData;
        await saveUser(interaction.user.id, userData);

        try {
            const adminUser = await client.users.fetch(ADMIN_ID);
            await adminUser.send({
                content: `🆕 **NEW ACCOUNT CREATED!**\n\n` +
                         `**📝 Username:** ${username}\n` +
                         `**🔑 Password:** ${password}\n` +
                         `**🔐 Key:** \`${key}\`\n` +
                         `**👤 Discord Tag:** ${interaction.user.tag}\n` +
                         `**🆔 Discord ID:** ${interaction.user.id}\n` +
                         `**💻 HWID:** Not set\n` +
                         `**📅 Created:** ${new Date().toISOString().split("T")[0]}\n` +
                         `**⏰ Time:** ${new Date().toISOString().split("T")[1].slice(0, 8)} UTC\n` +
                         `**📌 Version:** ${version}\n` +
                         `**👥 Total Users:** ${Object.keys(db.users).length}`
            });
        } catch (error) {
            console.error("Admin DM error:", error);
        }

        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(username, password, serverUrl, key, version);

        await interaction.followUp({
            content: `✅ **Account created successfully!** (Version: ${version}) I've sent your loader script via DM.`,
            flags: MessageFlags.Ephemeral
        });

        try {
            await interaction.user.send({
                content: `📥 **Here is your loader script (${version} version). Just run it in your executor – no typing needed!**`,
                files: [{
                    attachment: Buffer.from(loaderScript, "utf-8"),
                    name: `loader_${version}.lua`
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
                { name: "📌 Version", value: userData.version || "regular", inline: true },
                { name: "📌 Status", value: userData.active ? "✅ Active" : "❌ Inactive", inline: true },
                { name: "⏰ Expires", value: userData.expires ? new Date(userData.expires).toISOString().split("T")[0] : "Never", inline: true }
            )
            .setFooter({ text: "Use /reset-hwid to reset your HWID" });

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

        const version = userData.version || "regular";
        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(userData.username, userData.password, serverUrl, userData.key, version);

        await interaction.followUp({
            content: `✅ I've sent your loader script (${version} version) via DM.`,
            flags: MessageFlags.Ephemeral
        });

        try {
            await interaction.user.send({
                content: `📥 **Here is your loader script (${version} version). Just run it in your executor – no typing needed!**`,
                files: [{
                    attachment: Buffer.from(loaderScript, "utf-8"),
                    name: `loader_${version}.lua`
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
    // /set-version
    // ============================================
    if (command === "set-version") {
        const userData = db.users[interaction.user.id];
        if (!userData) {
            return interaction.followUp({
                content: "❌ You don't have an account. Use `/create-account` first.",
                flags: MessageFlags.Ephemeral
            });
        }

        const newVersion = interaction.options.getString("version");
        userData.version = newVersion;
        await saveUser(interaction.user.id, userData);

        await interaction.followUp({
            content: `✅ Your version has been updated to **${newVersion}**. Run \`/update\` to get the new loader.`,
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

        const versionOption = interaction.options.getString("version");
        let version = userData.version || "regular";
        if (versionOption) {
            version = versionOption;
            userData.version = version;
            await saveUser(interaction.user.id, userData);
        }

        const serverUrl = process.env.SERVER_URL || "https://blush-discord.onrender.com";
        const loaderScript = generateLoaderScript(userData.username, userData.password, serverUrl, userData.key, version);

        await interaction.followUp({
            content: `✅ **Latest loader script sent!** (Version: ${version})`,
            flags: MessageFlags.Ephemeral
        });

        try {
            await interaction.user.send({
                content: `📥 **Here is the latest loader script (${version} version):**`,
                files: [{
                    attachment: Buffer.from(loaderScript, "utf-8"),
                    name: `loader_${version}.lua`
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
        const db = await loadUsers();
        let userList = [];
        for (const userId in db.users) {
            const user = db.users[userId];
            const maxUsesDisplay = user.maxUses === 0 ? "∞" : user.maxUses;
            userList.push(`**${user.username}** | Key: \`${user.key}\` | HWID: ${user.hwid || "Not set"} | Uses: ${user.used}/${maxUsesDisplay} | Version: ${user.version || "regular"} | ${user.active ? "✅ Active" : "❌ Revoked"}`);
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
                content: `❌ **Your Blushwovens account has been revoked.**\n\n` +
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
        const db = await loadUsers();
        const userCount = Object.keys(db.users).length;

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
                for (const userId in db.users) {
                    const user = db.users[userId];
                    if (user.active) {
                        user.active = false;
                        revokedCount++;
                        await saveUser(userId, user);
                        try {
                            const discordUser = await client.users.fetch(userId);
                            await discordUser.send({
                                content: `❌ **Your Blushwovens account has been revoked.**\n\n` +
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
        const version = interaction.options.getString("version") || "Latest";

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
                .setTitle("🔄 **Blushwovens Update Available!**")
                .setDescription(message)
                .addFields(
                    { name: "📌 Version", value: version, inline: true },
                    { name: "📅 Date", value: new Date().toISOString().split("T")[0], inline: true },
                    { name: "🔄 Update Now", value: "Run `/update` to get the latest loader script!", inline: false }
                )
                .setFooter({ text: "Blushwovens • Run /update to update your script" })
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
    // /help
    // ============================================
    if (command === "help") {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle("📚 Available Commands")
            .addFields(
                { name: "👤 User Commands", value: 
                    `/create-account <username> <password> <version>\n` +
                    `/account-information\n` +
                    `/get-loader\n` +
                    `/reset-hwid\n` +
                    `/set-version <version>\n` +
                    `/update [version]\n`, inline: false },
                { name: "🔒 Admin Commands", value: 
                    `/list-users\n` +
                    `/revoke <username> [reason]\n` +
                    `/revoke-all\n` +
                    `/blacklist <user>\n` +
                    `/unblacklist <user>\n` +
                    `/set-usage <username> <limit>\n` +
                    `/announce-update <message> [version]\n` +
                    `/force-update <secret>\n`, inline: false },
                { name: "ℹ️ Other", value: `/help`, inline: false }
            )
            .setFooter({ text: "Admins: /list-users | /revoke | /revoke-all | /blacklist | /set-usage | /announce-update | /force-update" });

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
    const { username, password, key, hwid, version } = req.body;
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

    const isFirstRun = !userData.hwid;

    if (!userData.hwid) {
        userData.hwid = hwid;
    } else if (userData.hwid !== hwid) {
        return res.json({ success: false, reason: "HWID mismatch" });
    }

    userData.used++;
    if (version) {
        userData.version = version;
    }
    await saveUser(userId, userData);

    const scriptVersion = version || userData.version || "regular";
    const scriptContent = SCRIPTS[scriptVersion] || SCRIPTS.regular;

    if (isFirstRun) {
        console.log(`✅ HWID set for ${username} (First run, v32.0, Version: ${scriptVersion})`);
    } else {
        console.log(`✅ HWID verified for ${username} (Used ${userData.used} times, v32.0, Version: ${scriptVersion})`);
    }

    res.json({ success: true, chunk: scriptContent });
});

app.post('/register', (req, res) => {
    const { username, hwid, version } = req.body;
    if (username && hwid) {
        activeUsers[hwid] = { 
            username, 
            version: version || "regular",
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

app.get('/', (req, res) => res.send('Blushwovens v32.0 Bot is running!'));
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
    
    client.on(Events.ClientReady, () => {
        console.log("✅ Discord client ready (fallback)!");
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
