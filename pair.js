const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FileType = require('file-type');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  downloadContentFromMessage,
  DisconnectReason
} = require('baileys');

// ---------------- CONFIG ----------------

const BOT_NAME_FANCY = '𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳 𝐋𝙸𝚃𝙴';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'false',
  AUTO_LIKE_EMOJI: ['❤️‍🩹','🖤','👍','🍻','🎀','🤍','♥','🪬','✨','👏','👻'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/FZBpoVE47jr0wewO8KoLgz',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/i6kedi.jpg',
  NEWSLETTER_JID: '120363406513289787@newsletter',
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: process.env.OWNER_NUMBER || '94776803526',
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbCHfKjBFLgdGZehkP2G',
  BOT_NAME: 'QUEEN ASHI MINI BOT',
  BOT_VERSION: '0.1.1.V',
  OWNER_NAME: 'Dev xanz',
  IMAGE_PATH: 'https://files.catbox.moe/i6kedi.jpg',
  BOT_FOOTER: '',
  BUTTON_IMAGES: { ALIVE: 'https://files.catbox.moe/i6kedi.jpg' }
};

// ---------------- MONGO SETUP ----------------

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://podi_zoro:king@cluster0.nig7k0u.mongodb.net/';
const MONGO_DB = process.env.MONGO_DB || 'podi_zoro'
let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;

async function initMongo() {
  try {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected && mongoClient.topology.isConnected()) return;
  } catch(e){}
  mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await mongoClient.connect();
  mongoDB = mongoClient.db(MONGO_DB);

  sessionsCol = mongoDB.collection('sessions');
  numbersCol = mongoDB.collection('numbers');
  adminsCol = mongoDB.collection('admins');
  newsletterCol = mongoDB.collection('newsletter_list');
  configsCol = mongoDB.collection('configs');
  newsletterReactsCol = mongoDB.collection('newsletter_reacts');

  await sessionsCol.createIndex({ number: 1 }, { unique: true });
  await numbersCol.createIndex({ number: 1 }, { unique: true });
  await newsletterCol.createIndex({ jid: 1 }, { unique: true });
  await newsletterReactsCol.createIndex({ jid: 1 }, { unique: true });
  await configsCol.createIndex({ number: 1 }, { unique: true });
  console.log('✅ Mongo initialized and collections ready');
}

// ---------------- Mongo helpers ----------------

async function saveCredsToMongo(number, creds, keys = null) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
    await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
    console.log(`Saved creds to Mongo for ${sanitized}`);
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await sessionsCol.findOne({ number: sanitized });
    return doc || null;
  } catch (e) { console.error('loadCredsFromMongo error:', e); return null; }
}

async function removeSessionFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
    console.log(`Removed session from Mongo for ${sanitized}`);
  } catch (e) { console.error('removeSessionToMongo error:', e); }
}

async function addNumberToMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
    console.log(`Added number ${sanitized} to Mongo numbers`);
  } catch (e) { console.error('addNumberToMongo', e); }
}

async function removeNumberFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.deleteOne({ number: sanitized });
    console.log(`Removed number ${sanitized} from Mongo numbers`);
  } catch (e) { console.error('removeNumberFromMongo', e); }
}

async function getAllNumbersFromMongo() {
  try {
    await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
  try {
    await initMongo();
    const docs = await adminsCol.find({}).toArray();
    return docs.map(d => d.jid || d.number).filter(Boolean);
  } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function addAdminToMongo(jidOrNumber) {
  try {
    await initMongo();
    const doc = { jid: jidOrNumber };
    await adminsCol.updateOne({ jid: jidOrNumber }, { $set: doc }, { upsert: true });
    console.log(`Added admin ${jidOrNumber}`);
  } catch (e) { console.error('addAdminToMongo', e); }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    await initMongo();
    await adminsCol.deleteOne({ jid: jidOrNumber });
    console.log(`Removed admin ${jidOrNumber}`);
  } catch (e) { console.error('removeAdminFromMongo', e); }
}

async function addNewsletterToMongo(jid, emojis = []) {
  try {
    await initMongo();
    const doc = { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date() };
    await newsletterCol.updateOne({ jid }, { $set: doc }, { upsert: true });
    console.log(`Added newsletter ${jid} -> emojis: ${doc.emojis.join(',')}`);
  } catch (e) { console.error('addNewsletterToMongo', e); throw e; }
}

async function removeNewsletterFromMongo(jid) {
  try {
    await initMongo();
    await newsletterCol.deleteOne({ jid });
    console.log(`Removed newsletter ${jid}`);
  } catch (e) { console.error('removeNewsletterFromMongo', e); throw e; }
}

async function listNewslettersFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    await initMongo();
    const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
    if (!mongoDB) await initMongo();
    const col = mongoDB.collection('newsletter_reactions_log');
    await col.insertOne(doc);
    console.log(`Saved reaction ${emoji} for ${jid}#${messageId}`);
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('setUserConfigInMongo', e); }
}

async function loadUserConfigFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await configsCol.findOne({ number: sanitized });
    return doc ? doc.config : null;
  } catch (e) { console.error('loadUserConfigFromMongo', e); return null; }
}

// -------------- newsletter react-config helpers --------------

async function addNewsletterReactConfig(jid, emojis = []) {
  try {
    await initMongo();
    await newsletterReactsCol.updateOne({ jid }, { $set: { jid, emojis, addedAt: new Date() } }, { upsert: true });
    console.log(`Added react-config for ${jid} -> ${emojis.join(',')}`);
  } catch (e) { console.error('addNewsletterReactConfig', e); throw e; }
}

async function removeNewsletterReactConfig(jid) {
  try {
    await initMongo();
    await newsletterReactsCol.deleteOne({ jid });
    console.log(`Removed react-config for ${jid}`);
  } catch (e) { console.error('removeNewsletterReactConfig', e); throw e; }
}

async function listNewsletterReactsFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterReactsCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

async function getReactConfigForJid(jid) {
  try {
    await initMongo();
    const doc = await newsletterReactsCol.findOne({ jid });
    return doc ? (Array.isArray(doc.emojis) ? doc.emojis : []) : null;
  } catch (e) { console.error('getReactConfigForJid', e); return null; }
}
// ---------------- basic utils ----------------

function formatMessage(title, content, footer) {
  return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp(){ return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();

const socketCreationTime = new Map();

const otpStore = new Map();

// ---------------- helpers kept/adapted ----------------

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  const admins = await loadAdminsFromMongo();
  const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
  const botName = sessionConfig.botName || BOT_NAME_FANCY;
  const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
  const caption = formatMessage(botName, `📞 Number: ${number}\n🩵 Status: ${groupStatus}\n🕒 Connected at: ${getSriLankaTimestamp()}`, botName);
  for (const admin of admins) {
    try {
      const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
      if (String(image).startsWith('http')) {
        await socket.sendMessage(to, { image: { url: image }, caption });
      } else {
        try {
          const buf = fs.readFileSync(image);
          await socket.sendMessage(to, { image: buf, caption });
        } catch (e) {
          await socket.sendMessage(to, { image: { url: config.RCD_IMAGE_PATH }, caption });
        }
      }
    } catch (err) {
      console.error('Failed to send connect message to admin', admin, err?.message || err);
    }
  }
}

async function sendOwnerConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  try {
    const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
    const activeCount = activeSockets.size;
    const botName = sessionConfig.botName || BOT_NAME_FANCY;
    const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
    const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(`👑 OWNER CONNECT — ${botName}`, `📞 Number: ${number}\n🩵 Status: ${groupStatus}\n🕒 Connected at: ${getSriLankaTimestamp()}\n\n🔢 Active sessions: ${activeCount}`, botName);
    if (String(image).startsWith('http')) {
      await socket.sendMessage(ownerJid, { image: { url: image }, caption });
    } else {
      try {
        const buf = fs.readFileSync(image);
        await socket.sendMessage(ownerJid, { image: buf, caption });
      } catch (e) {
        await socket.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
      }
    }
  } catch (err) { console.error('Failed to send owner connect message:', err); }
}

async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`🔐 OTP VERIFICATION — ${BOT_NAME_FANCY}`, `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.\n\nNumber: ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
			  }

// ---------------- handlers (newsletter + reactions) ----------------

async function setupNewsletterHandlers(socket, sessionNumber) {
  const rrPointers = new Map();

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;

    try {
      const followedDocs = await listNewslettersFromMongo(); // array of {jid, emojis}
      const reactConfigs = await listNewsletterReactsFromMongo(); // [{jid, emojis}]
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

      const followedJids = followedDocs.map(d => d.jid);
      if (!followedJids.includes(jid) && !reactMap.has(jid)) return;

      let emojis = reactMap.get(jid) || null;
      if ((!emojis || emojis.length === 0) && followedDocs.find(d => d.jid === jid)) {
        emojis = (followedDocs.find(d => d.jid === jid).emojis || []);
      }
      if (!emojis || emojis.length === 0) emojis = config.AUTO_LIKE_EMOJI;

      let idx = rrPointers.get(jid) || 0;
      const emoji = emojis[idx % emojis.length];
      rrPointers.set(jid, (idx + 1) % emojis.length);

      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;

      let retries = 3;
      while (retries-- > 0) {
        try {
          if (typeof socket.newsletterReactMessage === 'function') {
            await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
          } else {
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
          }
          console.log(`Reacted to ${jid} ${messageId} with ${emoji}`);
          await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
          break;
        } catch (err) {
          console.warn(`Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
          await delay(1200);
        }
      }

    } catch (error) {
      console.error('Newsletter reaction handler error:', error?.message || error);
    }
  });
}


// ---------------- status + revocation + resizing ----------------

async function setupStatusHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
    try {
      if (config.AUTO_RECORDING === 'true') await socket.sendPresenceUpdate("recording", message.key.remoteJid);
      if (config.AUTO_VIEW_STATUS === 'true') {
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try { await socket.readMessages([message.key]); break; }
          catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries===0) throw error; }
        }
      }
      if (config.AUTO_LIKE_STATUS === 'true') {
        const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(message.key.remoteJid, { react: { text: randomEmoji, key: message.key } }, { statusJidList: [message.key.participant] });
            break;
          } catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries===0) throw error; }
        }
      }

    } catch (error) { console.error('Status handler error:', error); }
  });
}


async function handleMessageRevocation(socket, number) {
  socket.ev.on('messages.delete', async ({ keys }) => {
    if (!keys || keys.length === 0) return;
    const messageKey = keys[0];
    const userJid = jidNormalizedUser(socket.user.id);
    const deletionTime = getSriLankaTimestamp();
    const message = formatMessage('🗑️ MESSAGE DELETED', `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`, BOT_NAME_FANCY);
    try { await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: message }); }
    catch (error) { console.error('Failed to send deletion notification:', error); }
  });
}


async function resize(image, width, height) {
  let oyy = await Jimp.read(image);
  return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}


// ---------------- command handlers ----------------

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    const type = getContentType(msg.message);
    if (!msg.message) return;
    msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

    const from = msg.key.remoteJid;
    const sender = from;
    const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
    const senderNumber = (nowsender || '').split('@')[0];
    const botNumber = socket.user.id ? socket.user.id.split(':')[0] : '';
    const isOwner = senderNumber === config.OWNER_NUMBER.replace(/[^0-9]/g,'');

    const body = (type === 'conversation') ? msg.message.conversation
      : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text
      : (type === 'imageMessage' && msg.message.imageMessage.caption) ? msg.message.imageMessage.caption
      : (type === 'videoMessage' && msg.message.videoMessage.caption) ? msg.message.videoMessage.caption
      : (type === 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId
      : (type === 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
      : (type === 'viewOnceMessage') ? (msg.message.viewOnceMessage?.message?.imageMessage?.caption || '') : '';

    if (!body || typeof body !== 'string') return;

    const prefix = config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
    const args = body.trim().split(/ +/).slice(1);

    // helper: download quoted media into buffer
    async function downloadQuotedMedia(quoted) {
      if (!quoted) return null;
      const qTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) return null;
      const messageType = qType.replace(/Message$/i, '').toLowerCase();
      const stream = await downloadContentFromMessage(quoted[qType], messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return {
        buffer,
        mime: quoted[qType].mimetype || '',
        caption: quoted[qType].caption || quoted[qType].fileName || '',
        ptt: quoted[qType].ptt || false,
        fileName: quoted[qType].fileName || ''
      };
    }

    if (!command) return;

    try {
      switch (command) {
        // --- existing commands (deletemenumber, unfollow, newslist, admin commands etc.) ---
        // ... (keep existing other case handlers unchanged) ...
  case 'ts': {
    const axios = require('axios');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    let query = q.replace(/^[.\/!]ts\s*/i, '').trim();

    if (!query) {
        return await socket.sendMessage(sender, {
            text: '*TikTok එකේ මොකද්ද බලන්න ඕනෙ කියපං !* 🔍\n\nExample:\n.ts funny cats'
        }, { quoted: msg });
    }

    // 🔹 Load bot name dynamically
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = {};
    try {
        cfg = await loadUserConfigFromMongo(sanitized) || {};
    } catch {}
    let botName = cfg.botName || 'QUEEN ASHI MINI BOT';

    // 🔹 Fake contact for quoting (SAFE)
    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "BOT_FAKE_TS"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Dev Xanz Labs
END:VCARD`
            }
        }
    };

    try {
        await socket.sendMessage(sender, { text: `🔎 Searching TikTok for: *${query}* ...` }, { quoted: shonux });

        const searchParams = new URLSearchParams({
            keywords: query,
            count: '10',
            cursor: '0',
            HD: '1'
        });

        const response = await axios.post(
            "https://tikwm.com/api/feed/search",
            searchParams.toString(),
            {
                headers: {
                    'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8",
                    'User-Agent': "Mozilla/5.0"
                },
                timeout: 20000
            }
        );

        const videos = response?.data?.data?.videos || [];

        if (!videos.length) {
            return await socket.sendMessage(sender, {
                text: '⚠️ No videos found for this keyword.'
            }, { quoted: shonux });
        }

        const limit = 3;
        const results = videos.slice(0, limit);

        for (let i = 0; i < results.length; i++) {
            const v = results[i];
            const videoUrl = v.play || v.download;

            if (!videoUrl) continue;

            const caption = `
🎵 *${botName} TIK TOK DOWNLOADER*

📌 *\`Title:\`* ${v.title || 'No Title'}
👤 *\`Author:\`* ${v.author?.nickname || 'Unknown'}
❤️ *\`Likes:\`* ${v.digg_count || 0}
👁 *\`Views:\`* ${v.play_count || 0}
`.trim();

            await socket.sendMessage(sender, {
                video: { url: videoUrl },
                caption
            }, { quoted: shonux });

            await delay(1500); // avoid flood
        }

    } catch (err) {
        console.error('TikTok Search Error:', err);
        await socket.sendMessage(sender, {
            text: '❌ TikTok search failed. Try again later.'
        }, { quoted: shonux });
    }

    break;
}        

case 'getdp': {
  try {
    // Load bot name dynamically
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'QUEEN ASHI MINI BOT';

    // Get argument (.getdp 9477xxxxxx)
    let q =
      msg.message?.conversation?.split(" ")[1] ||
      msg.message?.extendedTextMessage?.text?.split(" ")[1];

    if (!q) {
      await socket.sendMessage(sender, {
        text: "❌ *Please provide a number*\n\nExample:\n.getdp 94771234567"
      });
      break;
    }

    const jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

    // Try to fetch profile picture
    let ppUrl;
    try {
      ppUrl = await socket.profilePictureUrl(jid, "image");
    } catch {
      ppUrl = "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg";
    }

    // Fake quoted vCard
    const metaQuote = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_GETDP"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Dev Xanz Labs
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    // Send image with menu button
    await socket.sendMessage(
      sender,
      {
        image: { url: ppUrl },
        caption: "🖼 *Here is the profile picture*",
        buttons: [
          {
            buttonId: `${config.PREFIX}menu`,
            buttonText: { displayText: "🚪 MENU" },
            type: 1
          }
        ],
        headerType: 4
      },
      { quoted: metaQuote }
    );

  } catch (err) {
    console.error("getdp error:", err);
    await socket.sendMessage(sender, {
      text: "⚠️ Error while fetching profile picture."
    });
  }
  break;
}
	
	
case 'deleteme': {
  // 'number' is the session number passed to setupCommandHandlers (sanitized in caller)
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  // determine who sent the command
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

  // Permission: only the session owner or the bot OWNER can delete this session
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or the bot owner can delete this session.' }, { quoted: msg });
    break;
  }

  try {
    // 1) Remove from Mongo
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);

    // 2) Remove temp session dir
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try {
      if (fs.existsSync(sessionPath)) {
        fs.removeSync(sessionPath);
        console.log(`Removed session folder: ${sessionPath}`);
      }
    } catch (e) {
      console.warn('Failed removing session folder:', e);
    }

    // 3) Try to logout & close socket
    try {
      if (typeof socket.logout === 'function') {
        await socket.logout().catch(err => console.warn('logout error (ignored):', err?.message || err));
      }
    } catch (e) { console.warn('socket.logout failed:', e?.message || e); }
    try { socket.ws?.close(); } catch (e) { console.warn('ws close failed:', e?.message || e); }

    // 4) Remove from runtime maps
    activeSockets.delete(sanitized);
    socketCreationTime.delete(sanitized);

    // 5) notify user
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION DELETED', '✅ Your session has been successfully deleted from MongoDB and local storage.', BOT_NAME_FANCY)
    }, { quoted: msg });

    console.log(`Session ${sanitized} deleted by ${senderNum}`);
  } catch (err) {
    console.error('deleteme command error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
case 'deletemenumber': {
  // args is available in the handler (body split). Expect args[0] = target number
  const targetRaw = (args && args[0]) ? args[0].trim() : '';
  if (!targetRaw) {
    await socket.sendMessage(sender, { text: '❗ Usage: .deletemenumber <number>\nExample: .deletemenumber 9478#######' }, { quoted: msg });
    break;
  }

  const target = targetRaw.replace(/[^0-9]/g, '');
  if (!/^\\d{6,}$/.test(target)) {
    await socket.sendMessage(sender, { text: '❗ Invalid number provided.' }, { quoted: msg });
    break;
  }

  // Permission check: only OWNER or configured admins can run this
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

  let allowed = false;
  if (senderNum === ownerNum) allowed = true;
  else {
    try {
      const adminList = await loadAdminsFromMongo();
      if (Array.isArray(adminList) && adminList.some(a => a.replace(/[^0-9]/g,'') === senderNum || a === senderNum || a === `${senderNum}@s.whatsapp.net`)) {
        allowed = true;
      }
    } catch (e) {
      console.warn('Failed checking admin list', e);
    }
  }

  if (!allowed) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only bot owner or admins can delete other sessions.' }, { quoted: msg });
    break;
  }

  try {
    // notify start
    await socket.sendMessage(sender, { text: `🗑️ Deleting session for ${target} — attempting now...` }, { quoted: msg });

    // 1) If active, try to logout + close
    const runningSocket = activeSockets.get(target);
    if (runningSocket) {
      try {
        if (typeof runningSocket.logout === 'function') {
          await runningSocket.logout().catch(e => console.warn('logout error (ignored):', e?.message || e));
        }
      } catch (e) { console.warn('Error during logout:', e); }
      try { runningSocket.ws?.close(); } catch (e) { console.warn('ws close error:', e); }
      activeSockets.delete(target);
      socketCreationTime.delete(target);
    }

    // 2) Remove from Mongo (sessions + numbers)
    await removeSessionFromMongo(target);
    await removeNumberFromMongo(target);

    // 3) Remove temp session dir if exists
    const tmpSessionPath = path.join(os.tmpdir(), `session_${target}`);
    try {
      if (fs.existsSync(tmpSessionPath)) {
        fs.removeSync(tmpSessionPath);
        console.log(`Removed temp session folder: ${tmpSessionPath}`);
      }
    } catch (e) {
      console.warn('Failed removing tmp session folder:', e);
    }

    // 4) Confirm to caller & notify owner
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION REMOVED', `✅ Session for number *${target}* has been deleted from MongoDB and runtime.`, BOT_NAME_FANCY)
    }, { quoted: msg });

    // optional: inform owner
    try {
      const ownerJid = `${ownerNum}@s.whatsapp.net`;
      await socket.sendMessage(ownerJid, {
        text: `👑 Notice: Session removed by ${senderNum}\n→ Number: ${target}\n→ Time: ${getSriLankaTimestamp()}`
      });
    } catch (e) { /* ignore notification errors */ }

    console.log(`deletemenumber: removed ${target} (requested by ${senderNum})`);
  } catch (err) {
    console.error('deletemenumber error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session for ${target}: ${err.message || err}` }, { quoted: msg });
  }

  break;
}





case 'cfn': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  const botName = cfg.botName || BOT_NAME_FANCY;
  const logo = cfg.logo || config.RCD_IMAGE_PATH;

  const full = body.slice(config.PREFIX.length + command.length).trim();
  if (!full) {
    await socket.sendMessage(sender, { text: `❗ Provide input: .cfn <jid@newsletter> | emoji1,emoji2\nExample: .cfn 120363402094635383@newsletter | 🔥,❤️` }, { quoted: msg });
    break;
  }

  const admins = await loadAdminsFromMongo();
  const normalizedAdmins = (admins || []).map(a => (a || '').toString());
  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
  const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
  if (!(isOwner || isAdmin)) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only owner or configured admins can add follow channels.' }, { quoted: msg });
    break;
  }

  let jidPart = full;
  let emojisPart = '';
  if (full.includes('|')) {
    const split = full.split('|');
    jidPart = split[0].trim();
    emojisPart = split.slice(1).join('|').trim();
  } else {
    const parts = full.split(/\s+/);
    if (parts.length > 1 && parts[0].includes('@newsletter')) {
      jidPart = parts.shift().trim();
      emojisPart = parts.join(' ').trim();
    } else {
      jidPart = full.trim();
      emojisPart = '';
    }
  }

  const jid = jidPart;
  if (!jid || !jid.endsWith('@newsletter')) {
    await socket.sendMessage(sender, { text: '❗ Invalid JID. Example: 120363402094635383@newsletter' }, { quoted: msg });
    break;
  }

  let emojis = [];
  if (emojisPart) {
    emojis = emojisPart.includes(',') ? emojisPart.split(',').map(e => e.trim()) : emojisPart.split(/\s+/).map(e => e.trim());
    if (emojis.length > 20) emojis = emojis.slice(0, 20);
  }

  try {
    if (typeof socket.newsletterFollow === 'function') {
      await socket.newsletterFollow(jid);
    }

    await addNewsletterToMongo(jid, emojis);

    const emojiText = emojis.length ? emojis.join(' ') : '(default set)';

    // Meta mention for botName
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CFN" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: `✅ Channel followed and saved!\n\nJID: ${jid}\nEmojis: ${emojiText}\nSaved by: @${senderIdSimple}`,
      footer: `📌 ${botName}`,
      mentions: [nowsender], // user mention
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 𝐌𝙴𝙽𝚄" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (e) {
    console.error('cfn error', e);
    await socket.sendMessage(sender, { text: `❌ Failed to save/follow channel: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'chr': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  const botName = cfg.botName || BOT_NAME_FANCY;
  const logo = cfg.logo || config.RCD_IMAGE_PATH;

  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

  const q = body.split(' ').slice(1).join(' ').trim();
  if (!q.includes(',')) return await socket.sendMessage(sender, { text: "❌ Usage: chr <channelJid/messageId>,<emoji>" }, { quoted: msg });

  const parts = q.split(',');
  let channelRef = parts[0].trim();
  const reactEmoji = parts[1].trim();

  let channelJid = channelRef;
  let messageId = null;
  const maybeParts = channelRef.split('/');
  if (maybeParts.length >= 2) {
    messageId = maybeParts[maybeParts.length - 1];
    channelJid = maybeParts[maybeParts.length - 2].includes('@newsletter') ? maybeParts[maybeParts.length - 2] : channelJid;
  }

  if (!channelJid.endsWith('@newsletter')) {
    if (/^\d+$/.test(channelJid)) channelJid = `${channelJid}@newsletter`;
  }

  if (!channelJid.endsWith('@newsletter') || !messageId) {
    return await socket.sendMessage(sender, { text: '❌ Provide channelJid/messageId format.' }, { quoted: msg });
  }

  try {
    await socket.newsletterReactMessage(channelJid, messageId.toString(), reactEmoji);
    await saveNewsletterReaction(channelJid, messageId.toString(), reactEmoji, sanitized);

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CHR" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: `✅ Reacted successfully!\n\nChannel: ${channelJid}\nMessage: ${messageId}\nEmoji: ${reactEmoji}\nBy: @${senderIdSimple}`,
      footer: `📌 ${botName}`,
      mentions: [nowsender], // user mention
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 𝐌𝙴𝙽𝚄" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (e) {
    console.error('chr command error', e);
    await socket.sendMessage(sender, { text: `❌ Failed to react: ${e.message || e}` }, { quoted: msg });
  }
  break;
}


case 'දාපන්':
case 'ඕනා':
case 'save': {
  try {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg) {
      return await socket.sendMessage(sender, { text: '*❌ Please reply to a message (status/media) to save it.*' }, { quoted: msg });
    }

    try { await socket.sendMessage(sender, { react: { text: '♻', key: msg.key } }); } catch(e){}

    // 🟢 Instead of bot’s own chat, use same chat (sender)
    const saveChat = sender;

    if (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage || quotedMsg.documentMessage || quotedMsg.stickerMessage) {
      const media = await downloadQuotedMedia(quotedMsg);
      if (!media || !media.buffer) {
        return await socket.sendMessage(sender, { text: '❌ Failed to download media.' }, { quoted: msg });
      }

      if (quotedMsg.imageMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Status Saved' });
      } else if (quotedMsg.videoMessage) {
        await socket.sendMessage(saveChat, { video: media.buffer, caption: media.caption || '✅ Status Saved', mimetype: media.mime || 'video/mp4' });
      } else if (quotedMsg.audioMessage) {
        await socket.sendMessage(saveChat, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: media.ptt || false });
      } else if (quotedMsg.documentMessage) {
        const fname = media.fileName || `saved_document.${(await FileType.fromBuffer(media.buffer))?.ext || 'bin'}`;
        await socket.sendMessage(saveChat, { document: media.buffer, fileName: fname, mimetype: media.mime || 'application/octet-stream' });
      } else if (quotedMsg.stickerMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Sticker Saved' });
      }

      await socket.sendMessage(sender, { text: '*Status saved successfully!*' }, { quoted: msg });

    } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
      const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
      await socket.sendMessage(saveChat, { text: `✅ *Status Saved / View once saved*\n\n${text}` });
      await socket.sendMessage(sender, { text: '*Text status saved successfully!*' }, { quoted: msg });
    } else {
      if (typeof socket.copyNForward === 'function') {
        try {
          const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId || msg.key;
          await socket.copyNForward(saveChat, msg.key, true);
          await socket.sendMessage(sender, { text: '*Saved (forwarded) successfully!*' }, { quoted: msg });
        } catch (e) {
          await socket.sendMessage(sender, { text: '❌ Could not forward the quoted message.' }, { quoted: msg });
        }
      } else {
        await socket.sendMessage(sender, { text: '❌ Unsupported quoted message type.' }, { quoted: msg });
      }
    }

  } catch (error) {
    console.error('❌ Save error:', error);
    await socket.sendMessage(sender, { text: '*❌ Failed to save status*' }, { quoted: msg });
  }
  break;
}

case 'alive': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    // Fake quoted vCard
    const metaQuote = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_ALIVE"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Dev Xanz Labs
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const text = `
🎀 𝐐𝐔𝐄𝐄𝐍 𝐀𝐒𝐇𝐈 𝐌𝐃 𝐀𝐋𝐈𝐕𝐄 𝐍𝐎𝐖

╭─── *「 ʙᴏᴛ ᴅᴇᴛᴀɪʟꜱ 」*
│ 👾 *\`Sᴛᴀᴛᴜꜱ :\`* Online
│ 👨‍💻 *\`Oᴡɴᴇʀ :\`* ${config.OWNER_NAME || 'Dev xanz'}
│ ⌛ *\`Uᴘᴛɪᴍᴇ :\`* ${hours}h ${minutes}m ${seconds}s
│ 🔮 *\`Pʟᴀᴛꜰᴏʀᴍ :\`* ${process.env.PLATFORM || 'Linux'}
│ 🖋️ *\`Pʀᴇꜰɪx :\`* ${config.PREFIX}
│ 💡 *\`Hᴏꜱᴛ :\`* Cloud
╰──────────────⦁✦⦁

╭─── *「 ᴍᴀɪɴ ᴄᴏᴍᴍᴀɴᴅꜱ 」*
│ 🚪 \`${config.PREFIX}menu\`
│ 👾 \`${config.PREFIX}alive\`
│ 👻 \`${config.PREFIX}ping\`
│ 🐉 \`${config.PREFIX}system\`
╰─────────────⦁✦⦁
`;

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 𝐌𝐄𝐍𝐔" }, type: 1 },
      { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "👻 𝐏𝐈𝐍𝐆" }, type: 1 }
    ];

    const imagePayload = String(logo).startsWith('http')
      ? { url: logo }
      : fs.readFileSync(logo);

    await socket.sendMessage(
      sender,
      {
        image: imagePayload,
        caption: text,
        footer: `${botName} 𝐀𝙻𝙸𝚅𝙴 𝐍𝙾𝚆`,
        buttons,
        headerType: 4
      },
      { quoted: metaQuote }
    );

  } catch (e) {
    console.error('alive error', e);
    await socket.sendMessage(sender, {
      text: '❌ Failed to send alive status.'
    }, { quoted: msg });
  }
  break;
}

//=======================================
 case 'ping': {
    // Reaction to show ping process start
    await socket.sendMessage(sender, {
        react: { text: "🎀", key: msg.key }
    });

    var inital = new Date().getTime();
    let ping = await socket.sendMessage(sender, { text: '*_ANALYZING SPEED..._*' });
    var final = new Date().getTime();

    // Progress bar animation
    await socket.sendMessage(sender, { text: '《 █▒▒▒▒▒▒▒▒▒▒▒》10%', edit: ping.key });
    await socket.sendMessage(sender, { text: '《 ████▒▒▒▒▒▒▒▒》30%', edit: ping.key });
    await socket.sendMessage(sender, { text: '《 ███████▒▒▒▒▒》50%', edit: ping.key });
    await socket.sendMessage(sender, { text: '《 ██████████▒▒》80%', edit: ping.key });
    await socket.sendMessage(sender, { text: '《 ████████████》100%', edit: ping.key });

    // Final output
    return await socket.sendMessage(sender, {
        text: `*♻ SPEED : ${final - inital} ms*\n`,
        edit: ping.key
    });
}

case 'vv':
case 'viewonce': {
    // Reaction when command starts
    await socket.sendMessage(sender, {
        react: { text: "🐳", key: msg.key }
    });

    // Owner check
    if (!isCreator) {
        return await socket.sendMessage(sender, {
            text: "*📛 This is an owner command.*"
        }, { quoted: msg });
    }

    // Check if replied to a message
    if (!msg.quoted) {
        return await socket.sendMessage(sender, {
            text: "*🍁 Please reply to a view once message!*"
        }, { quoted: msg });
    }

    // Check if it's a view-once message
    const quoted = msg.quoted;
    const isViewOnce = 
        quoted.message?.viewOnceMessage ||
        quoted.message?.viewOnceMessageV2 ||
        quoted.message?.viewOnceMessageV2Extension ||
        quoted.type?.includes('view_once');

    if (!isViewOnce) {
        return await socket.sendMessage(sender, {
            text: "*❌ This is not a view once message!*"
        }, { quoted: msg });
    }

    try {
        // Get the actual view once message data
        let viewOnceData = null;
        if (quoted.message?.viewOnceMessage) {
            viewOnceData = quoted.message.viewOnceMessage;
        } else if (quoted.message?.viewOnceMessageV2) {
            viewOnceData = quoted.message.viewOnceMessageV2;
        } else if (quoted.message?.viewOnceMessageV2Extension) {
            viewOnceData = quoted.message.viewOnceMessageV2Extension;
        } else {
            viewOnceData = quoted;
        }

        // Extract media type
        let mtype = "";
        let mimetype = "";
        let caption = quoted.text || "";
        
        // Determine message type from viewOnceData
        if (viewOnceData.message?.imageMessage) {
            mtype = "imageMessage";
            mimetype = viewOnceData.message.imageMessage.mimetype || "image/jpeg";
            caption = viewOnceData.message.imageMessage.caption || caption;
        } 
        else if (viewOnceData.message?.videoMessage) {
            mtype = "videoMessage";
            mimetype = viewOnceData.message.videoMessage.mimetype || "video/mp4";
            caption = viewOnceData.message.videoMessage.caption || caption;
        }
        else if (viewOnceData.message?.audioMessage) {
            mtype = "audioMessage";
            mimetype = viewOnceData.message.audioMessage.mimetype || "audio/mp4";
        }
        else if (viewOnceData.message?.documentMessage) {
            mtype = "documentMessage";
            mimetype = viewOnceData.message.documentMessage.mimetype || "application/octet-stream";
        }
        else {
            // Try from quoted directly
            mtype = quoted.mtype || quoted.type || "";
            mimetype = quoted.mimetype || "";
        }

        // Download the media
        let buffer;
        try {
            // Method 1: Use quoted.download() if available
            if (typeof quoted.download === 'function') {
                buffer = await quoted.download();
            } 
            // Method 2: Use socket.downloadMediaMessage()
            else if (typeof socket.downloadMediaMessage === 'function') {
                buffer = await socket.downloadMediaMessage(quoted);
            }
            // Method 3: Manual download from URL
            else if (viewOnceData.message?.[mtype]?.url) {
                const mediaUrl = viewOnceData.message[mtype].url;
                const res = await fetch(mediaUrl);
                buffer = await res.buffer();
            } else {
                throw new Error("No download method available");
            }
        } catch (downloadError) {
            console.error("Download error:", downloadError);
            return await socket.sendMessage(sender, {
                text: "❌ Failed to download media. Please try again."
            }, { quoted: msg });
        }

        if (!buffer || buffer.length === 0) {
            return await socket.sendMessage(sender, {
                text: "❌ No media content found."
            }, { quoted: msg });
        }

        // Prepare message content based on type
        let messageContent = {};
        
        switch (mtype) {
            case "imageMessage":
            case "image":
                messageContent = {
                    image: buffer,
                    caption: caption,
                    mimetype: mimetype || "image/jpeg"
                };
                break;
                
            case "videoMessage":
            case "video":
                messageContent = {
                    video: buffer,
                    caption: caption,
                    mimetype: mimetype || "video/mp4"
                };
                break;
                
            case "audioMessage":
            case "audio":
                messageContent = {
                    audio: buffer,
                    mimetype: "audio/mp4",
                    ptt: quoted.ptt || false
                };
                break;
                
            case "documentMessage":
            case "document":
                const ext = mimetype.split('/')[1] || 'bin';
                messageContent = {
                    document: buffer,
                    mimetype: mimetype,
                    fileName: `viewonce_${Date.now()}.${ext}`,
                    caption: caption || "View Once Document"
                };
                break;
                
            default:
                // Send as document if type is unknown
                messageContent = {
                    document: buffer,
                    fileName: `viewonce_${Date.now()}.file`,
                    caption: "View Once Media"
                };
        }

        // Send success message
        await socket.sendMessage(sender, {
            text: "✅ *View once message retrieved successfully!*"
        }, { quoted: msg });

        // Send the retrieved media
        await socket.sendMessage(sender, messageContent, { quoted: msg });

    } catch (error) {
        console.error("vv Error:", error);
        await socket.sendMessage(sender, {
            text: `❌ Error fetching vv message:\n${error.message}`
        }, { quoted: msg });
    }
    break;
		}
			  
case 'activesessions':
case 'active':
case 'bots': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    // Permission check - only owner and admins can use this
    const admins = await loadAdminsFromMongo();
    const normalizedAdmins = (admins || []).map(a => (a || '').toString());
    const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
    const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);

    if (!isOwner && !isAdmin) {
      await socket.sendMessage(sender, { 
        text: '❌ Permission denied. Only bot owner or admins can check active sessions.' 
      }, { quoted: msg });
      break;
    }

    const activeCount = activeSockets.size;
    const activeNumbers = Array.from(activeSockets.keys());

    // Meta AI mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ACTIVESESSIONS" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let text = `🧚‍♂️ 𝐓𝙾𝚃𝙰𝙻 𝐁𝙾𝚃𝚂  ${botName}\n\n`;
    text += `📊 *Total Active Sessions:* ${activeCount}\n\n`;

    if (activeCount > 0) {
      text += `📱 *Active Numbers :*\n`;
      activeNumbers.forEach((num, index) => {
        text += `${index + 1}. ${num}\n`;
      });
    } else {
      text += `⚠️ No active sessions found.`;
    }

    text += `\n⌛ Checked at: ${getSriLankaTimestamp()}`;

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: ``,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "👻 PING" }, type: 1 }
      ],
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('activesessions error', e);
    await socket.sendMessage(sender, { 
      text: '❌ Failed to fetch active sessions information.' 
    }, { quoted: msg });
  }
  break;
}

case 'song': {
    const yts = require("yt-search");
    const axios = require("axios");

    // Axios defaults
    const AXIOS_DEFAULTS = {
        timeout: 60000,
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
        },
    };

    // retry helper
    async function tryRequest(getter, attempts = 3) {
        let lastErr;
        for (let i = 1; i <= attempts; i++) {
            try {
                return await getter();
            } catch (e) {
                lastErr = e;
                if (i < attempts) await new Promise(r => setTimeout(r, 1000 * i));
            }
        }
        throw lastErr;
    }

    // APIs
    async function izumiByUrl(url) {
        const api = `https://api.srihub.store/download/ytmp3?apikey=${encodeURIComponent(url)}&format=mp3`;
        const res = await tryRequest(() => axios.get(api, AXIOS_DEFAULTS));
        if (res?.data?.result?.download) return res.data.result;
        throw new Error("Izumi URL failed");
    }

    async function izumiByQuery(q) {
        const api = `https://api.srihub.store/download/ytmp3?apikey=${encodeURIComponent(q)}`;
        const res = await tryRequest(() => axios.get(api, AXIOS_DEFAULTS));
        if (res?.data?.result?.download) return res.data.result;
        throw new Error("Izumi Query failed");
    }

    async function okatsu(url) {
        const api = `https://api.srihub.store/download/ytmp3?apikey=${encodeURIComponent(url)}`;
        const res = await tryRequest(() => axios.get(api, AXIOS_DEFAULTS));
        if (res?.data?.dl) {
            return {
                download: res.data.dl,
                title: res.data.title,
                thumbnail: res.data.thumb,
            };
        }
        throw new Error("Okatsu failed");
    }

    try {
        // read text
        const q =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            "";

        if (!q.trim()) {
            await socket.sendMessage(sender, {
                text: "🎵 *Please provide a song name or YouTube link!*",
            });
            break;
        }

        // detect url or search
        let video;
        if (q.includes("youtu.be") || q.includes("youtube.com")) {
            video = { url: q };
        } else {
case 'song': {
  // Dew Coders 2025 
  const yts = require('yt-search');
  const axios = require('axios');
  // මෙතනට අපේ සයිට් එකෙන් ඔයාලට free හම්බෙන Api Key එක දාන්න - https://bots.srihub.store
  const apikey = "dew_kI5goH3q6XmpI7stwPX9m0aICW9KBO6w1DM0kcBy"; // Paste Your Api Key Form https://bots.srihub.store
  const apibase = "https://api.srihub.store"

  // Extract message text safely
  const q =
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text ||
  msg.message?.imageMessage?.caption ||
  msg.message?.videoMessage?.caption ||
  "";

  if (!q.trim()) {
    return await socket.sendMessage(sender, { 
      text: '*Need YouTube URL or Title.*' 
    }, { quoted: msg });
  }

  // YouTube ID extractor
  const extractYouTubeId = (url) => {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const normalizeYouTubeLink = (str) => {
    const id = extractYouTubeId(str);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  };

  try {
    await socket.sendMessage(sender, { 
      react: { text: "🔍", key: msg.key } 
    }
  );

  let videoUrl = normalizeYouTubeLink(q.trim());

  // Search if not a link
  if (!videoUrl) {
    const search = await yts(q.trim());
    const found = search?.videos?.[0];

    if (!found) {
      return await socket.sendMessage(sender, {
        text: "*No results found.*"
      }, { quoted: msg });
    }

    videoUrl = found.url;
  }

  // --- API CALL ---
  const api = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodeURIComponent(videoUrl)}`;
  const get = await axios.get(api).then(r => r.data).catch(() => null);

  if (!get?.result) {
    return await socket.sendMessage(sender, {
      text: "*API Error. Try again later.*"
    }, { quoted: msg });
  }

  const { download_url, title, thumbnail, duration, quality } = get.result;

  const caption = `\`${title}\`
  
● ⏱️ *Dᴜʀᴀᴛɪᴏɴ :* ${duration || 'N/A'}
● 🎧 *Qᴜᴀʟɪᴛʏ :* ${quality || '128kbps'}

*Reply below number*

1.Document (mp3)
2.Audio (mp3)
3.Voice Note (ptt)

> ㋚ 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳 𝐋𝙸𝚃𝙴 `;

// Send main message
const resMsg = await socket.sendMessage(sender, {
  image: { url: thumbnail },
  caption: caption
}, { quoted: msg });

const handler = async (msgUpdate) => {
  try {
    const received = msgUpdate.messages && msgUpdate.messages[0];
    if (!received) return;

    const fromId = received.key.remoteJid || received.key.participant || (received.key.fromMe && sender);
    if (fromId !== sender) return;

    const text = received.message?.conversation || received.message?.extendedTextMessage?.text;
    if (!text) return;

    // ensure they quoted our card
    const quotedId = received.message?.extendedTextMessage?.contextInfo?.stanzaId ||
    received.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id;
    if (!quotedId || quotedId !== resMsg.key.id) return;

    const choice = text.toString().trim().split(/\s+/)[0];

    await socket.sendMessage(sender, { react: { text: "📥", key: received.key } });

    switch (choice) {
      case "1":
      await socket.sendMessage(sender, {
        document: { url: download_url },
        mimetype: "audio/mpeg",
        fileName: `${title}.mp3`
      }, { quoted: received });
      break;
      case "2":
      await socket.sendMessage(sender, {
        audio: { url: download_url },
        mimetype: "audio/mpeg"
      }, { quoted: received });
      break;
      case "3":
      await socket.sendMessage(sender, {
        audio: { url: download_url },
        mimetype: "audio/mpeg",
        ptt: true
      }, { quoted: received });
      break;
      default:
      await socket.sendMessage(sender, { text: "*Invalid option. Reply with 1, 2 or 3 (quote the card).*" }, { quoted: received });
      return;
    }

    // cleanup listener after successful send
    socket.ev.off('messages.upsert', handler);
  } catch (err) {
    console.error("Song handler error:", err);
    try { socket.ev.off('messages.upsert', handler); } catch (e) {}
  }
};

socket.ev.on('messages.upsert', handler);

// auto-remove handler after 60s
setTimeout(() => {
  try { socket.ev.off('messages.upsert', handler); } catch (e) {}
}, 60 * 1000);

// react to original command
await socket.sendMessage(sender, { react: { text: '🔎', key: msg.key } });

} catch (err) {
  console.error('Song case error:', err);
  await socket.sendMessage(sender, { text: "*`Error occurred while processing song request`*" }, { quoted: msg });
}
break;
}
			   
 case 'video': {
    const axios = require('axios');
    // Extract YT video id & normalize link (reuse from original)
    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }
    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
        return input;
    }
    // get message text
    const q = msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';
    if (!q || q.trim() === '') {
        await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' });
        break;
    }
    // load bot name
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'QUEEN ASHI MINI';    // fake contact for quoted card
    const botMention = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_VIDEO"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };
    try {
        // Determine video URL: if q contains YT id/url, use it; otherwise search by title
        let videoUrl = null;
        const maybeLink = convertYouTubeLink(q.trim());
        if (extractYouTubeId(q.trim())) {
            videoUrl = maybeLink;
        } else {
            // search by title using new API
            const searchUrl = `https:///www.movanest.xyz/v2/ytsearch?query=${encodeURIComponent(q.trim())}`;
            const searchRes = await axios.get(searchUrl, { 
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }).then(r => r.data).catch(e => null);
            if (!searchRes || !searchRes.status) {
                await socket.sendMessage(sender, { text: '*`Search API error or no response`*' }, { quoted: botMention });
                break;
            }
            const videos = (searchRes.results || []).filter(r => r.type === 'video');
            const first = videos[0];
            if (!first) {
                await socket.sendMessage(sender, { text: '*`No video results found for that title`*' }, { quoted: botMention });
                break;
            }
            videoUrl = first.url;
        }
        // call new mp4 API
        const apiUrl = `https:///www.movanest.xyz/v2/ytmp4?url=${encodeURIComponent(videoUrl)}`;
        const apiRes = await axios.get(apiUrl, { 
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        }).then(r => r.data).catch(e => null);
        console.log('API Response:', apiRes); // Log to debug
        if (!apiRes || !apiRes.status || !apiRes.results?.download?.url) {
            await socket.sendMessage(sender, { text: '*`MP4 API returned no download link. Try a different video or check logs.`*' }, { quoted: botMention });
            break;
        }
        // Normalize download URL and metadata
        const downloadUrl = apiRes.results.download.url;
        const title = apiRes.results.metadata.title || 'Unknown title';
        const thumb = apiRes.results.metadata.thumbnail || null;
        const duration = apiRes.results.metadata.timestamp || null;
        const quality = apiRes.results.download.quality || '360p';
        const filename = apiRes.results.download.filename || `${title}.mp4`;
        const caption = `*\`${title}\`*
        
● ⏱️ *Dᴜʀᴀᴛɪᴏɴ:* ${duration || 'N/A'}
● 📺 *Qᴜᴀʟɪᴛʏ:* ${quality}
● 🔗 *Lɪɴᴋ:* ${videoUrl}

*Reply to this message with a number*

1. 📄 MP4 as Document
2. ▶️ MP4 as Video

> 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳 𝐋𝙸𝚃𝙴`;
        // send thumbnail card if available
        const sendOpts = { quoted: botMention };
        const media = thumb ? { image: { url: thumb }, caption } : { text: caption };
        const resMsg = await socket.sendMessage(sender, media, sendOpts);
        // handler waits for quoted reply from same sender
        const handler = async (msgUpdate) => {
            try {
                const received = msgUpdate.messages && msgUpdate.messages[0];
                if (!received) return;
                const fromId = received.key.remoteJid || received.key.participant || (received.key.fromMe && sender);
                if (fromId !== sender) return;
                const text = received.message?.conversation || received.message?.extendedTextMessage?.text;
                if (!text) return;
                // ensure they quoted our card
                const quotedId = received.message?.extendedTextMessage?.contextInfo?.stanzaId ||
                    received.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id;
                if (!quotedId || quotedId !== resMsg.key.id) return;
                const choice = text.toString().trim().split(/\s+/)[0];
                await socket.sendMessage(sender, { react: { text: "🔌", key: received.key } });
                switch (choice) {
                    case "1":
                        await socket.sendMessage(sender, {
                            document: { url: downloadUrl },
                            mimetype: "video/mp4",
                            fileName: filename
                        }, { quoted: received });
                        break;
                    case "2":
                        await socket.sendMessage(sender, {
                            video: { url: downloadUrl },
                            mimetype: "video/mp4"
                        }, { quoted: received });
                        break;
                    default:
                        await socket.sendMessage(sender, { text: "*Invalid option. Reply with 1 or 2 (quote the card).*" }, { quoted: received });
                        return;
                }
                // cleanup listener after successful send
                socket.ev.off('messages.upsert', handler);
            } catch (err) {
                console.error("Video handler error:", err);
                try { socket.ev.off('messages.upsert', handler); } catch (e) {}
            }
        };
        socket.ev.on('messages.upsert', handler);
        // auto-remove handler after 60s
        setTimeout(() => {
            try { socket.ev.off('messages.upsert', handler); } catch (e) {}
        }, 60 * 1000);
        // react to original command
        await socket.sendMessage(sender, { react: { text: '🎬', key: msg.key } });
    } catch (err) {
        console.error('Video case error:', err);
        await socket.sendMessage(sender, { text: "*`Error occurred while processing video request`*" }, { quoted: botMention });
    }
    break;
	}
      
case 'csong': {
  const axios = require('axios');
  const fs = require('fs');
  const { exec } = require('child_process');

  async function getChannelName(jid) {
    try {
      const meta = await socket.newsletterMetadata(jid);
      return meta?.subject || jid;
    } catch {
      return jid;
    }
  }

  const full = msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text || '';

  const args = full.trim().split(/\s+/);
  args.shift(); // remove .csong

  if (args.length < 2) {
    await socket.sendMessage(sender, { text: "Use: .csong <channelJid> <song name>" });
    break;
  }

  const target = args.shift(); // channel jid
  const query = args.join(' ');

  await socket.sendMessage(sender, { react: { text: "🐻", key: msg.key } });

  try {
    const search = await axios.get(`https:///www.movanest.xyz/v2/ytsearch?query=${encodeURIComponent(query)}`);
    const video = search.data.results.find(v => v.type === "video");
    if (!video) return socket.sendMessage(sender,{text:"No results found"});

    const ytmp3 = await axios.get(`https:///www.movanest.xyz/v2/ytmp3?url=${encodeURIComponent(video.url)}`);
    const data = ytmp3.data.results;

    const title = data.metadata.title;
    const duration = data.metadata.timestamp;
    const thumb = data.metadata.thumbnail;
    const mp3Url = data.download.url;

    const mp3Path = `/tmp/${Date.now()}.mp3`;
    const opusPath = `/tmp/${Date.now()}.opus`;

    const stream = await axios.get(mp3Url, { responseType: "stream" });
    const writer = fs.createWriteStream(mp3Path);
    stream.data.pipe(writer);
    await new Promise(r => writer.on('finish', r));

    await new Promise((resolve, reject) => {
      exec(`ffmpeg -y -i "${mp3Path}" -c:a libopus -b:a 64k "${opusPath}"`,
        err => err ? reject(err) : resolve());
    });

    const channelName = await getChannelName(target);

    const caption = `✨ *Tɪᴛʟᴇ:* ${title}

  ● 📆 *Released date:* ${video.published || 'N/A'}
  ● ⏱️ *Duration time:* ${duration || 'N/A'}
  ● 👀 *View count :* ${video.views ? video.views.toLocaleString() : 'N/A'}

> *${channelName}*`;

    await socket.sendMessage(target, {
      image: { url: thumb },
      caption
    });

    await socket.sendMessage(target, {
      audio: fs.readFileSync(opusPath),
      mimetype: "audio/ogg; codecs=opus",
      ptt: true
    });

    await socket.sendMessage(sender, { text: "✅ *Song posted to channel successfully!*" });

    fs.unlinkSync(mp3Path);
    fs.unlinkSync(opusPath);

  } catch (e) {
    console.error(e);
    await socket.sendMessage(sender, { text: "❌ *Failed to process song*" });
  }
  break;																				  }
 case 'system': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SYSTEM" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    const os = require('os');
    const text = `
🐉 ${botName} 𝐒𝚈𝚂𝚃𝙴𝙼

●  💻 OS: ${os.type()} ${os.release()}
●  🚀 Platform: ${os.platform()}
●  🧠 CPU cores: ${os.cpus().length}
●  📺 Memory: ${(os.totalmem()/1024/1024/1024).toFixed(2)} GB
`;

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: `${botName}`,
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('system error', e);
    await socket.sendMessage(sender, { text: '❌ Failed to get system info.' }, { quoted: msg });
  }
  break;
}
case 'menu': {
  await socket.sendMessage(sender, { react: { text: "🧚‍♂️", key: msg.key } }).catch(()=>{});

  try {
    // ===== BASIC INFO =====
    const pushname = msg.pushName || 'User';
    const startTime = socketCreationTime?.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);

    // ===== GREETING =====
    const hr = new Date().getHours();
    const greeting =
      hr < 12 ? '🧘‍♀️ Good Morning' :
      hr < 18 ? '👻 Good Afternoon' :
      '🙋 Good Night';

    // ===== MENU TEXT =====
    const menuText = `
 ${greeting}, *${pushname}*
 
╔═════════════════════╗ 
    ㋚ 𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳 𝐋𝙸𝚃𝙴 
╚═════════════════════╝

╭── *「 🧚 𝐁𝙾𝚃 𝐌𝙰𝙸𝙽 𝐌𝙴𝙽𝚄 」*
│ 🎀 *\`Nᴀᴍᴇ :\`*  𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳
│ 👨‍💻 *\`Oᴡɴᴇʀ :\`*  Dev Xanz
│ 🧬 *\`Vᴇʀꜱɪᴏɴ :\`*  ${config.BOT_VERSION || '1.0.0'}
│ ⌛ *\`Uᴘᴛɪᴍᴇ :\`*  ${h}h ${m}m ${s}s
│ 🔮 *\`Pʟᴀᴛꜰᴏʀᴍ :\`*  ${process.env.PLATFORM || 'Linux'}
│ 💡 *\`Cᴏᴍᴍᴀᴅꜱ :\`*  50+
╰──────────────────⦁✦⦁

*「 𝐋𝐈𝐒𝐓 𝐎𝐅 𝐌𝐄𝐍𝐔 」*

> │ 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 𝐌𝐄𝐍𝐔
> │ 𝐔𝐒𝐄𝐑 𝐌𝐄𝐍𝐔
> │ 𝐆𝐑𝐔𝐎𝐏 𝐌𝐄𝐍𝐔
> │ 𝐂𝐎𝐍𝐅𝐈𝐆 𝐌𝐄𝐍𝐔

${config.BOT_FOOTER || '> ㋚ 𝐐𝐔𝐄𝐄𝐍 𝐀𝐒𝐇𝐈 𝐌𝐃 𝐋𝐈𝐓𝐄'}
`.trim();

    // ===== BUTTONS =====
    const buttons = [
      { buttonId: `${config.PREFIX}download`, buttonText: { displayText: "𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 𝐌𝐄𝐍𝐔" }, type: 1 },
      { buttonId: `${config.PREFIX}user`, buttonText: { displayText: "𝐎𝐖𝐍𝐄𝐑 𝐌𝐄𝐍𝐔" }, type: 1 },
      { buttonId: `${config.PREFIX}group`, buttonText: { displayText: "𝐆𝐑𝐔𝐎𝐏 𝐌𝐄𝐍𝐔" }, type: 1 },
      { buttonId: `${config.PREFIX}settings`, buttonText: { displayText: "𝐂𝐎𝐍𝐅𝐈𝐆 𝐌𝐀𝐍𝐀𝐆𝐄𝐑" }, type: 1 }
    ];

    // ===== FAKE CONTACT (for quoted context) =====
    const fakeContact = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "FAKE_CONTACT_MENU"
      },
      message: {
        contactMessage: {
          displayName: 'QUEEN ASHI MD',
          vcard: `BEGIN:VCARD
VERSION:3.0
N:QUEEN ASHI MD;;;;
FN:QUEEN ASHI MD
ORG:QUEEN ASHI MD
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    // ===== SEND MENU IMAGE WITH FAKE CONTACT =====
    await socket.sendMessage(sender, {
      image: { url: 'https://files.catbox.moe/i6kedi.jpg' },
      caption: menuText,
      footer: '',
      buttons,
      headerType: 4
    }, { quoted: fakeContact });

    // ===== OPTIONAL: SEND AUDIO =====
    await socket.sendMessage(sender, {
      audio: { url: 'https://drive.google.com/uc?export=download&id=1qafJfhII7vuZwGxPLGBsOLAnJnXgQAQl' },
      mimetype: 'audio/mpeg',
      ptt: true
    });

  } catch (err) {
    console.error('menu error:', err);
    await socket.sendMessage(sender, { text: '❌ Failed to show menu.' });
  }
  break;
}			  
// ==================== DOWNLOAD MENU ====================
case 'download': {
  try { await socket.sendMessage(sender, { react: { text: "🧬", key: msg.key } }); } catch(e){}

  try {
    let userCfg = {};
    try { 
      if (number && typeof loadUserConfigFromMongo === 'function') {
        userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; 
      }
    } catch(e){ userCfg = {}; }

    const title = userCfg.botName || 'QUEEN ASHI MD MINI';

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_DOWNLOAD"
      },
      message: {
        contactMessage: {
          displayName: title,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    const text = `
╭───❂ 𝐃𝙾𝚆𝙽𝙻𝙾𝙰𝙳 𝐌𝙴𝙽𝚄 ❂───╮
│
│ ➤ *\`Command .song\`*
│ ☛ Usage ${config.PREFIX}song (query)
│ _✨ Desc : download yt songs_
│
│ ➤ *\`Command .csong\`*
│ ☛ Usage ${config.PREFIX}csong (query)
│ _✨ Desc : post songs to channels_
│
│ ➤ *\`Command .tiktok\`*
│ ☛ Usage ${config.PREFIX}tiktok (url)
│ _✨ Desc : download tiktok videos_
│
│ ➤ *\`Command .video\`*
│ ☛ Usage ${config.PREFIX}video (query)
│ _✨ Desc : download yt videos_
│
│ ➤ *\`Command .apksearch\`*
│ ☛ Usage ${config.PREFIX}apksearch (app name)
│ _✨ Desc : get information for apks_
│
│ ➤ *\`Command .getdp\`*
│ ☛ Usage ${config.PREFIX}getdp (number)
│ _✨ Desc : get whatsapp dp picture_
│
│ ➤ *\`Command .save\`*
│ ☛ Usage ${config.PREFIX}save (reply to status)
│ _✨ Desc : download whatsapp status_
│
│ ➤ *\`Command .img\`*
│ ☛ Usage ${config.PREFIX}img (query)
│ _✨ Desc : download google images_
│
╰──────────────❂
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 𝐌𝐀𝐈𝐍 𝐌𝐄𝐍𝐔" }, type: 1 },
      { buttonId: `${config.PREFIX}user`, buttonText: { displayText: "🧑‍🔧 𝐔𝐒𝐄𝐑 𝐌𝐄𝐍𝐔" }, type: 1 }
    ];

    // 🔹 ONLY ADDITION: image + caption
    await socket.sendMessage(sender, {
      image: { url: 'https://i.ibb.co/PGZ0jS2D/tourl-1768647299517.jpg' },
      caption: text,
      footer: "㋚ 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳",
      buttons
    }, { quoted: shonux });

  } catch (err) {
    console.error('download command error:', err);
    try { 
      await socket.sendMessage(sender, { text: '❌ Failed to show download menu.' }, { quoted: msg }); 
    } catch(e){}
  }
  break;
		  }


// ==================== USER MENU ====================
case 'user': {
  try {
    await socket.sendMessage(sender, { react: { text: "🧬", key: msg.key } });
  } catch (e) {}

  try {
    let userCfg = {};
    try {
      if (number && typeof loadUserConfigFromMongo === 'function') {
        userCfg = await loadUserConfigFromMongo(
          (number || '').replace(/[^0-9]/g, '')
        ) || {};
      }
    } catch (e) {
      userCfg = {};
    }

    const title = userCfg.botName || 'QUEEN ASHI MD MINI';

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_USER"
      },
      message: {
        contactMessage: {
          displayName: title,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    const text = `
╭───❂ 𝐔𝚂𝙴𝚁 𝐂𝙾𝙼𝙼𝙰𝙽𝙳𝚂 ❂───╮
│
│ ➤ *\`Command .jid\`*
│ ☛ Usage ${config.PREFIX}jid
│ _✨ Desc : Get jid of a user_
│
│ ➤ *\`Command .block\`*
│ ☛ Usage ${config.PREFIX}block (number)
│ _✨ Desc : Block a user_
│
│ ➤ *\`Command .unblock\`*
│ ☛ Usage ${config.PREFIX}unblock (number)
│ _✨ Desc : Unblock a user_
│
│ ➤ *\`Command .ping\`*
│ ☛ Usage ${config.PREFIX}ping
│ _✨ Desc : Check bot ping_
│
│ ➤ *\`Command .alive\`*
│ ☛ Usage ${config.PREFIX}alive
│ _✨ Desc : Check bot alive status_
│
╰──────────────❂
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 𝐌𝐀𝐈𝐍 𝐌𝐄𝐍𝐔" }, type: 1 },
      { buttonId: `${config.PREFIX}settings`, buttonText: { displayText: "⚙️ 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      image: { url: 'https://i.ibb.co/21Q2m6CW/tourl-1768647451592.jpg' },
      caption: text,
      footer: "㋚ 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳",
      buttons
    }, { quoted: shonux });

  } catch (err) {
    console.error('user command error:', err);
    await socket.sendMessage(sender, {
      text: '❌ Failed to show user menu.'
    }, { quoted: msg });
  }
  break;
}
 // ==================== GRUOP MENU ===================
case 'group': {
  try { await socket.sendMessage(sender, { react: { text: "🧬", key: msg.key } }); } catch(e){}

  const text = `
╭──❂ 𝐆𝚁𝚄𝙾𝙿 𝐂𝙾𝙼𝙼𝙰𝙽𝙳𝚂 ❂──╮
│
│ ➤ *\`Command .add\`*
│ ☛ Usage ${config.PREFIX}add 947xxxxxxxx
│ _✨ Desc : Add a member to group_
│
│ ➤ *\`Command .setname\`*
│ ☛ Usage ${config.PREFIX}setname (group name)
│ _✨ Desc : Change group name_
│
│ ➤ *\`Command .warn\`*
│ ☛ Usage ${config.PREFIX}warn @user
│ _✨ Desc : Warn a group member_
│
│ ➤ *\`Command .kick\`*
│ ☛ Usage ${config.PREFIX}kick @user
│ _✨ Desc : Remove a member from group_
│
│ ➤ *\`Command .kickall\`*
│ ☛ Usage ${config.PREFIX}kickall
│ _✨ Desc : Remove all non-admin members_
│
│ ➤ *\`Command .open\`*
│ ☛ Usage ${config.PREFIX}open
│ _✨ Desc : Open group for everyone_
│
│ ➤ *\`Command .close\`*
│ ☛ Usage ${config.PREFIX}close
│ _✨ Desc : Close group (admins only)_
│
│ ➤ *\`Command .invite\`*
│ ☛ Usage ${config.PREFIX}invite
│ _✨ Desc : Get group invite link_
│
│ ➤ *\`Command .promote\`*
│ ☛ Usage ${config.PREFIX}promote @user
│ _✨ Desc : Promote member to admin_
│
│ ➤ *\`Command .demote\`*
│ ☛ Usage ${config.PREFIX}demote @user
│ _✨ Desc : Demote admin to member_
│
│ ➤ *\`Command .tagall\`*
│ ☛ Usage ${config.PREFIX}tagall (msg)
│ _✨ Desc : Mention all group members_
│
│ ➤ *\`Command .online\`*
│ ☛ Usage ${config.PREFIX}online
│ _✨ Desc : Check online members_
│
│ ➤ *\`Command .join\`*
│ ☛ Usage ${config.PREFIX}join (group link)
│ _✨ Desc : Join group via invite link_
│
╰──────────────❂
`.trim();

  const buttons = [
    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 𝐌𝙰𝙸𝙽 𝐌𝙴𝙽𝚄" }, type: 1 }
  ];

  await socket.sendMessage(sender, {
    image: { url: 'https://i.ibb.co/jk3TmSPx/tourl-1768806720932.jpg' }, // 🔹 change image if you want
    caption: text,
    footer: "㋚ 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳",
    buttons,
    headerType: 4
  }, { quoted: msg });

  break;
}			  

 // ==================== SETTINGS MENU ===================
case 'settings': {
  try {
    await socket.sendMessage(sender, { react: { text: "🧬", key: msg.key } });
  } catch (e) {}

  try {
    let userCfg = {};
    try {
      if (number && typeof loadUserConfigFromMongo === 'function') {
        userCfg = await loadUserConfigFromMongo(
          (number || '').replace(/[^0-9]/g, '')
        ) || {};
      }
    } catch (e) {
      userCfg = {};
    }

    const title = userCfg.botName || 'QUEEN ASHI MD MINI';

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_SETTINGS"
      },
      message: {
        contactMessage: {
          displayName: title,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    const text = `
╭─❂ ⚙ 𝐒𝙴𝚃𝚃𝙸𝙽𝙶𝚂 𝐂𝙾𝙼𝙼𝙰𝙽𝙳𝚂 ❂─╮
│
│ ➤ *\`Command .setbotname\`*
│ ☛ Usage ${config.PREFIX}setbotname (name)
│ _✨ Desc : Set a new bot name_
│
│ ➤ *\`Command .setlogo\`*
│ ☛ Usage ${config.PREFIX}setlogo (reply to image/url)
│ _✨ Desc : Change bot profile picture_
│
│ ➤ *\`Command .showconfig\`*
│ ☛ Usage ${config.PREFIX}showconfig
│ _✨ Desc : Show your current config_
│
│ ➤ *\`Command .resetconfig\`*
│ ☛ Usage ${config.PREFIX}resetconfig
│ _✨ Desc : Reset your bot config_
│
│ ➤ *\`Command .deleteme\`*
│ ☛ Usage ${config.PREFIX}deleteme
│ _✨ Desc : Delete your bot session_
│
╰──────────────❂
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🚪 𝐌𝙰𝙸𝙽 𝐌𝙴𝙽𝚄" }, type: 1 },
      { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👨‍💻 𝐃𝙴𝚅𝙴𝙻𝙾𝙿𝙴𝚁" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      image: { url: 'https://i.ibb.co/CKvxzpjb/tourl-1768647487785.jpg' },
      caption: text,
      footer: "㋚ 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳",
      buttons
    }, { quoted: shonux });

  } catch (err) {
    console.error('settings command error:', err);
    await socket.sendMessage(sender, {
      text: '❌ Failed to show settings menu.'
    }, { quoted: msg });
  }
  break;
		  }
			  
    case 'owner': {
    const ownerNumber = '+94776803526';
    const ownerName = 'DEV XANZ';
    const organization = '𝐃𝐄𝐕𝐄𝐋𝐎𝐏𝐄𝐑';

    const vcard = 'BEGIN:VCARD\n' +
                  'VERSION:3.0\n' +
                  `FN:${ownerName}\n` +
                  `ORG:${organization};\n` +
                  `TEL;type=CELL;type=VOICE;waid=${ownerNumber.replace('+', '')}:${ownerNumber}\n` +
                  'END:VCARD';

    try {
        // Send vCard contact
        const sent = await socket.sendMessage(from, {
            contacts: {
                displayName: ownerName,
                contacts: [{ vcard }]
            }
        });

        // Then send message with reference
        await socket.sendMessage(from, {
            text: `OWNER INFOMATION \n\n● 👤 Name: ${ownerName}\n● 📞 Number: ${ownerNumber}\n\n> ㋚ 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 𝐐𝚄𝙴𝙴𝙽 𝐀𝚂𝙷𝙸 𝐌𝙳`,
            contextInfo: {
                mentionedJid: [`${ownerNumber.replace('+', '')}@s.whatsapp.net`],
                quotedMessageId: sent.key.id
            }
        }, { quoted: msg });

    } catch (err) {
        console.error('❌ Owner command error:', err.message);
        await socket.sendMessage(from, {
            text: '❌ Error sending owner contact.'
        }, { quoted: msg });
    }

    break;
}



//💐💐💐💐💐💐






        case 'unfollow': {
  const jid = args[0] ? args[0].trim() : null;
  if (!jid) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide channel JID to unfollow. Example:\n.unfollow 120363396379901844@newsletter' }, { quoted: shonux });
  }

  const admins = await loadAdminsFromMongo();
  const normalizedAdmins = admins.map(a => (a || '').toString());
  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
  const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
  if (!(isOwner || isAdmin)) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❌ Permission denied. Only owner or admins can remove channels.' }, { quoted: shonux });
  }

  if (!jid.endsWith('@newsletter')) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Invalid JID. Must end with @newsletter' }, { quoted: shonux });
  }

  try {
    if (typeof socket.newsletterUnfollow === 'function') {
      await socket.newsletterUnfollow(jid);
    }
    await removeNewsletterFromMongo(jid);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Unfollowed and removed from DB: ${jid}` }, { quoted: shonux });
  } catch (e) {
    console.error('unfollow error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT ';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW5" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to unfollow: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'tiktok':
case 'ttdl':
case 'tt':
case 'tiktokdl': {
    try {
        // 🔹 Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'QUEEN ASHI MD MINI';
        // 🔹 Fake contact for Meta AI mention
        const botMention = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_TT"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();
        if (!q) {
            await socket.sendMessage(sender, {
                text: '*🚫 Please provide a TikTok video link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🚪 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }
        if (!q.includes("tiktok.com")) {
            await socket.sendMessage(sender, {
                text: '*🚫 Invalid TikTok link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🚪 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }
        // Parse username from URL
        const usernameMatch = q.match(/@([^\/]+)/);
        const username = usernameMatch ? usernameMatch[1] : 'Unknown';
        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Downloading TikTok video...*' }, { quoted: botMention });
        const apiUrl = `https:///movanest.xyz/v2/tiktok?url=${encodeURIComponent(q)}`;
        const { data } = await axios.get(apiUrl);
        if (!data.status || !data.results) {
            await socket.sendMessage(sender, {
                text: '*🚩 Failed to fetch TikTok video.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🚪 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }
        const { title } = data.results;
        const videoUrl = data.results.no_watermark;
        const titleText = `${botName} TIKTOK DOWNLOADER`;
        const content = `┏━━━━━━━━━━━━━━━━\n` +
                        `┃● 👤 \`User\` : @${username}\n` +
                        `┃● ✍️ \`Title\` : ${title}\n` +
                        `┗━━━━━━━━━━━━━━━━`;
        const footer = config.BOT_FOOTER || '';
        const captionMessage = formatMessage(titleText, content, footer);
        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: captionMessage,
            contextInfo: { mentionedJid: [sender] },
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🚪 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '👻 BOT INFO' }, type: 1 }
            ]
        }, { quoted: botMention });
    } catch (err) {
        console.error("Error in TikTok downloader:", err);
        await socket.sendMessage(sender, {
            text: '*❌ Internal Error. Please try again later.*',
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🚪 MENU' }, type: 1 }
            ]
        });
    }
    break;
}
case 'cid': {
    // Extract query from message
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    // ✅ Dynamic botName load
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'QUEEN ASHI MD MINI';

    // ✅ Fake Meta AI vCard (for quoted msg)
    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_CID"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    // Clean command prefix (.cid, /cid, !cid, etc.)
    const channelLink = q.replace(/^[.\/!]cid\s*/i, '').trim();

    // Check if link is provided
    if (!channelLink) {
        return await socket.sendMessage(sender, {
            text: '❎ Please provide a WhatsApp Channel link.\n\n📌 *Example:* .cid https://whatsapp.com/channel/123456789'
        }, { quoted: shonux });
    }

    // Validate link
    const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
    if (!match) {
        return await socket.sendMessage(sender, {
            text: '⚠️ *Invalid channel link format.*\n\nMake sure it looks like:\nhttps://whatsapp.com/channel/xxxxxxxxx'
        }, { quoted: shonux });
    }

    const inviteId = match[1];

    try {
        // Send fetching message
        await socket.sendMessage(sender, {
            text: `🔎 Fetching channel info for: *${inviteId}*`
        }, { quoted: shonux });

        // Get channel metadata
        const metadata = await socket.newsletterMetadata("invite", inviteId);

        if (!metadata || !metadata.id) {
            return await socket.sendMessage(sender, {
                text: '❌ Channel not found or inaccessible.'
            }, { quoted: shonux });
        }

        // Format details
        const infoText = `
📡 *𝐖hatsApp 𝐂hannel 𝐈nfo*

●  🆔 *𝐈D:* ${metadata.id}
●  📌 *𝐍ame:* ${metadata.name}
●  👥 *𝐅ollowers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}
●  📅 *𝐂reated 𝐎n:* ${metadata.creation_time ? new Date(metadata.creation_time * 1000).toLocaleString("si-LK") : 'Unknown'}

𝐏𝙾𝚆𝚁𝙴𝙳 𝐁𝚈 ${botName}
`;

        // Send preview if available
        if (metadata.preview) {
            await socket.sendMessage(sender, {
                image: { url: `https://pps.whatsapp.net${metadata.preview}` },
                caption: infoText
            }, { quoted: shonux });
        } else {
            await socket.sendMessage(sender, {
                text: infoText
            }, { quoted: shonux });
        }

    } catch (err) {
        console.error("CID command error:", err);
        await socket.sendMessage(sender, {
            text: '⚠️ An unexpected error occurred while fetching channel info.'
        }, { quoted: shonux });
    }

    break;
		}	
case 'add': {
  try {
    await socket.sendMessage(sender, { react: { text: '➕', key: msg.key } });
  } catch (e) {}

  // Group check
  if (!isGroup) {
    await socket.sendMessage(sender, {
      text: '❌ *This command can only be used in groups!*'
    }, { quoted: msg });
    break;
  }

  // Admin / Owner check
  if (!isSenderGroupAdmin && !isOwner) {
    await socket.sendMessage(sender, {
      text: '❌ *Only group admins or bot owner can add members!*'
    }, { quoted: msg });
    break;
  }

  // Usage check
  if (!args[0]) {
    await socket.sendMessage(sender, {
      text: `📌 *Usage:* ${config.PREFIX}add 94xxxxxxxxx\n\nExample:\n${config.PREFIX}add 947XXXXXXXX`
    }, { quoted: msg });
    break;
  }

  // Sanitize number
  const cleanNumber = args[0].replace(/[^0-9]/g, '');
  if (cleanNumber.length < 8) {
    await socket.sendMessage(sender, {
      text: '❌ *Invalid number format!*'
    }, { quoted: msg });
    break;
  }

  const jidToAdd = cleanNumber + '@s.whatsapp.net';

  try {
    await socket.groupParticipantsUpdate(from, [jidToAdd], 'add');

    await socket.sendMessage(sender, {
      text:
`✅ *MEMBER ADDED SUCCESSFULLY*

●  👤 Number : ${cleanNumber}
●  👥 Group  : Added to group

${config.BOT_FOOTER || ''}`
    }, { quoted: msg });

  } catch (error) {
    console.error('Add command error:', error);

    let errorMsg = 'Failed to add member.';
    if (error?.message?.includes('not-authorized')) {
      errorMsg = 'Bot is not admin!';
    } else if (error?.message?.includes('privacy')) {
      errorMsg = 'User privacy settings block adding!';
    }

    await socket.sendMessage(sender, {
      text: `❌ *${errorMsg}*`
    }, { quoted: msg });
  }

  break;
}
case 'kick': {
  try { 
    await socket.sendMessage(sender, { react: { text: '🦶', key: msg.key } }); 
  } catch(e){}

  // ✅ Must be group
  if (!isGroup) {
    await socket.sendMessage(sender, {
      text: '❌ *This command can only be used in groups!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Must be admin or owner
  if (!isSenderGroupAdmin && !isOwner) {
    await socket.sendMessage(sender, {
      text: '❌ *Only group admins or bot owner can kick members!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Check usage
  if (!args[0] && !msg.quoted) {
    await socket.sendMessage(sender, {
      text: `📌 *Usage:* ${config.PREFIX}kick 94xxxxxxxxx\nOr reply to a member's message with ${config.PREFIX}kick`
    }, { quoted: msg });
    break;
  }

  try {
    // ===== Determine number to kick =====
    let numberToKick;
    if (msg.quoted) {
      numberToKick = msg.quoted.sender;
    } else {
      const cleanNumber = args[0].replace(/[^0-9]/g, '');
      if (cleanNumber.length < 8) throw new Error('Invalid number format');
      numberToKick = cleanNumber + '@s.whatsapp.net';
    }

    // ===== Kick member =====
    await socket.groupParticipantsUpdate(from, [numberToKick], 'remove');

    // ===== Success message =====
    await socket.sendMessage(sender, {
      text: formatMessage(
        '🗑️ MEMBER KICKED',
        `Successfully removed ${numberToKick.split('@')[0]} from the group! 🚪`,
        config.BOT_FOOTER
      )
    }, { quoted: msg });

  } catch (error) {
    console.error('Kick command error:', error);

    let errorMsg = 'Failed to kick member!';
    if (error?.message?.includes('not-admin')) {
      errorMsg = '❌ Bot must be admin to kick members!';
    } else if (error?.message?.includes('privacy')) {
      errorMsg = '❌ User privacy settings block kicking!';
    }

    await socket.sendMessage(sender, {
      text: `❌ ${errorMsg}`
    }, { quoted: msg });
  }

  break;
}
case 'promote': {
  try { 
    await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } }); 
  } catch(e){}

  // ✅ Must be group
  if (!isGroup) {
    await socket.sendMessage(sender, {
      text: '❌ *This command can only be used in groups!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Must be admin or owner
  if (!isSenderGroupAdmin && !isOwner) {
    await socket.sendMessage(sender, {
      text: '❌ *Only group admins or bot owner can promote members!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Check usage
  if (!args[0] && !msg.quoted) {
    await socket.sendMessage(sender, {
      text: `📌 *Usage:* ${config.PREFIX}promote 94xxxxxxxxx\nOr reply to a member's message with ${config.PREFIX}promote`
    }, { quoted: msg });
    break;
  }

  try {
    // ===== Determine number to promote =====
    let numberToPromote;
    if (msg.quoted) {
      numberToPromote = msg.quoted.sender;
    } else {
      const cleanNumber = args[0].replace(/[^0-9]/g, '');
      if (cleanNumber.length < 8) throw new Error('Invalid number format');
      numberToPromote = cleanNumber + '@s.whatsapp.net';
    }

    // ===== Promote member =====
    await socket.groupParticipantsUpdate(from, [numberToPromote], 'promote');

    // ===== Success message =====
    await socket.sendMessage(sender, {
      text: formatMessage(
        '⬆️ MEMBER PROMOTED',
        `Successfully promoted ${numberToPromote.split('@')[0]} to group admin! 🌟`,
        config.BOT_FOOTER
      )
    }, { quoted: msg });

  } catch (error) {
    console.error('Promote command error:', error);

    let errorMsg = 'Failed to promote member!';
    if (error?.message?.includes('not-admin')) {
      errorMsg = '❌ Bot must be admin to promote members!';
    } else if (error?.message?.includes('privacy')) {
      errorMsg = '❌ User privacy settings block promotion!';
    }

    await socket.sendMessage(sender, {
      text: `❌ ${errorMsg}`
    }, { quoted: msg });
  }

  break;
		  }
case 'demote': {
  try { 
    await socket.sendMessage(sender, { react: { text: '🙆‍♀️', key: msg.key } }); 
  } catch(e){}

  // ✅ Must be group
  if (!isGroup) {
    await socket.sendMessage(sender, {
      text: '❌ *This command can only be used in groups!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Must be admin or owner
  if (!isSenderGroupAdmin && !isOwner) {
    await socket.sendMessage(sender, {
      text: '❌ *Only group admins or bot owner can demote admins!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Check usage
  if (!args[0] && !msg.quoted) {
    await socket.sendMessage(sender, {
      text: `📌 *Usage:* ${config.PREFIX}demote 94xxxxxxxxx\nOr reply to an admin's message with ${config.PREFIX}demote`
    }, { quoted: msg });
    break;
  }

  try {
    // ===== Determine number to demote =====
    let numberToDemote;
    if (msg.quoted) {
      numberToDemote = msg.quoted.sender;
    } else {
      const cleanNumber = args[0].replace(/[^0-9]/g, '');
      if (cleanNumber.length < 8) throw new Error('Invalid number format');
      numberToDemote = cleanNumber + '@s.whatsapp.net';
    }

    // ===== Demote member =====
    await socket.groupParticipantsUpdate(from, [numberToDemote], 'demote');

    // ===== Success message =====
    await socket.sendMessage(sender, {
      text: formatMessage(
        '⬇️ ADMIN DEMOTED',
        `Successfully demoted ${numberToDemote.split('@')[0]} from group admin! 📉`,
        config.BOT_FOOTER
      )
    }, { quoted: msg });

  } catch (error) {
    console.error('Demote command error:', error);

    let errorMsg = 'Failed to demote admin!';
    if (error?.message?.includes('not-admin')) {
      errorMsg = '❌ Bot must be admin to demote!';
    } else if (error?.message?.includes('privacy')) {
      errorMsg = '❌ User privacy settings block demotion!';
    }

    await socket.sendMessage(sender, {
      text: `❌ ${errorMsg}`
    }, { quoted: msg });
  }

  break;
}
case 'open': case 'unmute': {
  try { 
    await socket.sendMessage(sender, { react: { text: '🔓', key: msg.key } }); 
  } catch(e){}

  // ✅ Must be group
  if (!isGroup) {
    await socket.sendMessage(sender, {
      text: '❌ *This command can only be used in groups!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Must be admin or owner
  if (!isSenderGroupAdmin && !isOwner) {
    await socket.sendMessage(sender, {
      text: '❌ *Only group admins or bot owner can open the group!*'
    }, { quoted: msg });
    break;
  }

  try {
    // ===== Open group (allow all members to send messages) =====
    await socket.groupSettingUpdate(from, 'not_announcement');

    // ===== Success message with image =====
    const successImage = 'https://files.catbox.moe/84288h.jpg'; // replace with your own image if needed

    await socket.sendMessage(sender, {
      image: { url: successImage },
      caption: formatMessage(
        '🔓 GROUP OPENED',
        'Group is now open! All members can send messages. 🗣️',
        config.BOT_FOOTER
      )
    }, { quoted: msg });

  } catch (error) {
    console.error('Open command error:', error);

    await socket.sendMessage(sender, {
      text: `❌ *Failed to open group!* 😢\nError: ${error.message || 'Unknown error'}`
    }, { quoted: msg });
  }
  break;
	}
case 'close': case 'mute': {
  try { 
    await socket.sendMessage(sender, { react: { text: '🔒', key: msg.key } }); 
  } catch(e){}

  // ✅ Must be in a group
  if (!isGroup) {
    await socket.sendMessage(sender, {
      text: '❌ *This command can only be used in groups!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Must be admin or owner
  if (!isSenderGroupAdmin && !isOwner) {
    await socket.sendMessage(sender, {
      text: '❌ *Only group admins or bot owner can close the group!*'
    }, { quoted: msg });
    break;
  }

  try {
    // ===== Close group (only admins can send messages) =====
    await socket.groupSettingUpdate(from, 'announcement');

    // ===== Send success message with image =====
    const successImage = 'https://files.catbox.moe/84288h.jpg'; // Replace with your image URL if needed

    await socket.sendMessage(sender, {
      image: { url: successImage },
      caption: formatMessage(
        '🔒 GROUP CLOSED',
        'Group is now closed! Only admins can send messages. 🤫',
        config.BOT_FOOTER
      )
    }, { quoted: msg });

  } catch (error) {
    console.error('Close command error:', error);

    await socket.sendMessage(sender, {
      text: `❌ *Failed to close group!* 😢\nError: ${error.message || 'Unknown error'}`
    }, { quoted: msg });
  }
  break;
}
case 'kickall': case 'removeall': case 'cleargroup': {
  try { await socket.sendMessage(sender, { react: { text: '⚡', key: msg.key } }); } catch(e){}

  // ✅ Must be group
  if (!isGroup) {
    await socket.sendMessage(sender, {
      text: '❌ *This command can only be used in groups!*'
    }, { quoted: msg });
    break;
  }

  // ✅ Must be admin or owner
  if (!isSenderGroupAdmin && !isOwner) {
    await socket.sendMessage(sender, {
      text: '❌ *Only group admins or bot owner can use this command!*'
    }, { quoted: msg });
    break;
  }

  try {
    const groupMetadata = await socket.groupMetadata(from);
    const botJid = socket.user?.id || socket.user?.jid;

    // ✅ Exclude admins + bot
    const membersToRemove = groupMetadata.participants
      .filter(p => !p.admin && p.id !== botJid)
      .map(p => p.id);

    if (membersToRemove.length === 0) {
      await socket.sendMessage(sender, {
        text: '❌ *No members to remove! (All are admins or bot)*'
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⚠️ *WARNING* ⚠️\n\nRemoving *${membersToRemove.length}* members...`
    }, { quoted: msg });

    // ✅ Remove in batches of 50 to prevent rate limits
    const batchSize = 50;
    for (let i = 0; i < membersToRemove.length; i += batchSize) {
      const batch = membersToRemove.slice(i, i + batchSize);
      await socket.groupParticipantsUpdate(from, batch, 'remove');
      await new Promise(r => setTimeout(r, 2000)); // 2s delay
    }

    await socket.sendMessage(sender, {
      text: formatMessage(
        '🧹 GROUP CLEANED',
        `✅ Successfully removed *${membersToRemove.length}* members.\n\n> *Executed by:* @${m.sender.split('@')[0]}`,
        config.BOT_FOOTER
      ),
      mentions: [m.sender]
    }, { quoted: msg });

  } catch (error) {
    console.error('Kickall command error:', error);
    await socket.sendMessage(sender, {
      text: `❌ *Failed to remove members!*\nError: ${error.message || 'Unknown error'}`
    }, { quoted: msg });
  }
  break;
  }		
case 'warn': {
  try { await socket.sendMessage(sender, { react: { text: '⚠️', key: msg.key } }); } catch(e){}

  if (!isGroup) {
    await socket.sendMessage(sender, {
      text: '❌ *This command can only be used in groups!*'
    }, { quoted: msg });
    break;
  }

  if (!isSenderGroupAdmin && !isOwner) {
    await socket.sendMessage(sender, {
      text: '❌ *Only group admins or bot owner can warn members!*'
    }, { quoted: msg });
    break;
  }

  try {
    // ✅ Get target user: replied or mentioned
    let targetUser = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                     msg.message?.extendedTextMessage?.contextInfo?.participant;

    if (!targetUser) targetUser = m.mentionedJid?.[0];

    if (!targetUser) {
      await socket.sendMessage(sender, {
        text: `╭───────────────⭓
│ 📌 Usage:
│ Reply to user or tag someone
│ .warn @user [reason]
╰───────────────⭓`
      }, { quoted: msg });
      break;
    }

    // ✅ Prevent self-warn
    if (targetUser === m.sender) {
      await socket.sendMessage(sender, {
        text: '❌ You cannot warn yourself!'
      }, { quoted: msg });
      break;
    }

    // ✅ Prevent warning admins (unless owner)
    const groupMetadata = await socket.groupMetadata(from);
    const targetIsAdmin = groupMetadata.participants.find(p => p.id === targetUser)?.admin;

    if (targetIsAdmin && !isOwner) {
      await socket.sendMessage(sender, {
        text: '❌ Cannot warn group admins!'
      }, { quoted: msg });
      break;
    }

    const warnReason = args.slice(1).join(' ') || 'No reason provided';

    // ✅ Send warning message
    await socket.sendMessage(from, {
      text: `╭───────────────⭓
│ ⚠️ *WARNING ISSUED*
│
│ Target: @${targetUser.split('@')[0]}
│ Reason: ${warnReason}
│ By: @${m.sender.split('@')[0]}
╰───────────────⭓`,
      mentions: [targetUser, m.sender]
    }, { quoted: msg });

  } catch (error) {
    console.error('Warn command error:', error);
    await socket.sendMessage(sender, {
      text: `❌ Failed to warn user\nError: ${error.message || 'Unknown error'}`
    }, { quoted: msg });
  }

  break;
	 }  
case 'gjid':
case 'groupjid':
case 'grouplist': {
  try {
    // ✅ Owner check removed — now everyone can use it!

    await socket.sendMessage(sender, { 
      react: { text: "📝", key: msg.key } 
    });

    await socket.sendMessage(sender, { 
      text: "📝 Fetching group list..." 
    }, { quoted: msg });

    const groups = await socket.groupFetchAllParticipating();
    const groupArray = Object.values(groups);

    // Sort by creation time (oldest to newest)
    groupArray.sort((a, b) => a.creation - b.creation);

    if (groupArray.length === 0) {
      return await socket.sendMessage(sender, { 
        text: "❌ No groups found!" 
      }, { quoted: msg });
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY || "CHMA MD";

    // ✅ Pagination setup — 10 groups per message
    const groupsPerPage = 10;
    const totalPages = Math.ceil(groupArray.length / groupsPerPage);

    for (let page = 0; page < totalPages; page++) {
      const start = page * groupsPerPage;
      const end = start + groupsPerPage;
      const pageGroups = groupArray.slice(start, end);

      // ✅ Build message for this page
      const groupList = pageGroups.map((group, index) => {
        const globalIndex = start + index + 1;
        const memberCount = group.participants ? group.participants.length : 'N/A';
        const subject = group.subject || 'Unnamed Group';
        const jid = group.id;
        return `*${globalIndex}. ${subject}*\n👀 Members: ${memberCount}\n🆔 ${jid}`;
      }).join('\n\n');

      const textMsg = `❑ *Group List - ${botName}*\n\n▫️ Page ${page + 1}/${totalPages}\n▫️ Total Groups: ${groupArray.length}\n\n${groupList}`;

      await socket.sendMessage(sender, {
        text: textMsg,
        footer: `㋚ ${botName}`
      });

      // Add short delay to avoid spam
      if (page < totalPages - 1) {
        await delay(1000);
      }
    }

  } catch (err) {
    console.error('GJID command error:', err);
    await socket.sendMessage(sender, { 
      text: "❌ Failed to fetch group list. Please try again later." 
    }, { quoted: msg });
  }
  break;
}

case 'apksearch':
case 'apks':
case 'apkfind': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'QUEEN ASHI MD MINI'
        // ✅ Fake Meta contact message
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APK"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please provide an app name to search.*\n\nExample: .apksearch whatsapp',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🚪 MENU' }, type: 1 }
                ]
            }, { quoted: shonux });
        }

        await socket.sendMessage(sender, { text: '*⏳ Searching APKs...*' }, { quoted: shonux });

        // 🔹 Call API
        const apiUrl = `https://tharuzz-ofc-apis.vercel.app/api/search/apksearch?query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.success || !data.result || !data.result.length) {
            return await socket.sendMessage(sender, { text: '*❌ No APKs found for your query.*' }, { quoted: shonux });
        }

        // 🔹 Format results
        let message = `🔍 *APK Search Results for:* ${query}\n\n`;
        data.result.slice(0, 20).forEach((item, idx) => {
            message += `*${idx + 1}.* ${item.name}\n➡️ ID: \`${item.id}\`\n\n`;
        });
        message += `㋚ ${botName}`;

        // 🔹 Send results
        await socket.sendMessage(sender, {
            text: message,
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🚪 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '👻 BOT INFO' }, type: 1 }
            ],
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in APK search:", err);

        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'QUEEN ASHI MINI BOT AI';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APK"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}

// ---------------- list saved newsletters (show emojis) ----------------
case 'newslist': {
  try {
    const docs = await listNewslettersFromMongo();
    if (!docs || docs.length === 0) {
      let userCfg = {};
      try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
      const title = userCfg.botName || 'QUEEN ASHI MINI BOT AI';
      const shonux = {
          key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST" },
          message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❗ No channels saved in DB.' }, { quoted: shonux });
    }

    let txt = '*📁 Saved Newsletter Channels:*\n\n';
    for (const d of docs) {
      txt += `• ${d.jid}\n  Emojis: ${Array.isArray(d.emojis) && d.emojis.length ? d.emojis.join(' ') : '(default)'}\n\n`;
    }

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT ';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('newslist error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to list channels.' }, { quoted: shonux });
  }
  break;
}
			  
case 'owner': {
  try {
    // vCard with multiple details
    let vcard = 
      'BEGIN:VCARD\n' +
      'VERSION:3.0\n' +
      'FN:NIKKA\n' + // Name
      'ORG:WhatsApp Bot Developer;\n' + // Organization
      'TITLE:Founder & CEO of Queen Asha Mini Bot;\n' + // Title / Role
      'EMAIL;type=INTERNET:queenasha@gmail.com\n' + // Email
      'ADR;type=WORK:;;Mtara;;Sri Lanka\n' + // Address
      'URL:https://github.com\n' + // Website
      'TEL;type=CELL;type=VOICE;waid=94770051298\n' + // WhatsApp Number
      'TEL;type=CELL;type=VOICE;waid=94764040298\n' + // Second Number (Owner)
      'END:VCARD';

    await conn.sendMessage(
      m.chat,
      {
        contacts: {
          displayName: 'KAVINDU',       contacts: [{ vcard }]
        }
      },
      { quoted: m }
    );

  } catch (err) {
    console.error(err);
    await conn.sendMessage(m.chat, { text: '⚠️ Owner info fetch error.' }, { quoted: m });
  }
}
break;

case 'addadmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide a jid or number to add as admin\nExample: .addadmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Only owner can add admins.' }, { quoted: shonux });
  }

  try {
    await addAdminToMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Added admin: ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('addadmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to add admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'tagall': {
  try {
    if (!from || !from.endsWith('@g.us')) return await socket.sendMessage(sender, { text: '❌ This command can only be used in groups.' }, { quoted: msg });

    let gm = null;
    try { gm = await socket.groupMetadata(from); } catch(e) { gm = null; }
    if (!gm) return await socket.sendMessage(sender, { text: '❌ Failed to fetch group info.' }, { quoted: msg });

    const participants = gm.participants || [];
    if (!participants.length) return await socket.sendMessage(sender, { text: '❌ No members found in the group.' }, { quoted: msg });

    const text = args && args.length ? args.join(' ') : '📢 Announcement';

    let groupPP = 'https://i.ibb.co/9q2mG0Q/default-group.jpg';
    try { groupPP = await socket.profilePictureUrl(from, 'image'); } catch(e){}

    const mentions = participants.map(p => p.id || p.jid);
    const groupName = gm.subject || 'Group';
    const totalMembers = participants.length;

    const emojis = ['📢','🔊','🌐','🛡️','🚀','🎯','🧿','🪩','🌀','💠','🎊','🎧','📣','🗣️'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_TAGALL" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let caption = `*🏷️ Taged All Gruop Members* \n`;
	caption += `\n`;
    caption += `●  📌 *Group:* ${groupName}\n`;
    caption += `●  👥 *Members:* ${totalMembers}\n`;
    caption += `●  🧶 *Message:* ${text}\n`;
    caption += `\n\n`;
    caption += `🪇 *Mentioning all members below:*\n\n`;
    for (const m of participants) {
      const id = (m.id || m.jid);
      if (!id) continue;
      caption += `${randomEmoji} @${id.split('@')[0]}\n`;
    }
    caption += `\n> *${botName}*`;

    await socket.sendMessage(from, {
      image: { url: groupPP },
      caption,
      mentions,
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (err) {
    console.error('tagall error', err);
    await socket.sendMessage(sender, { text: '❌ Error running tagall.' }, { quoted: msg });
  }
  break;
}

case 'online': {
  try {
    if (!(from || '').endsWith('@g.us')) {
      await socket.sendMessage(sender, { text: '❌ This command works only in group chats.' }, { quoted: msg });
      break;
    }

    let groupMeta;
    try { groupMeta = await socket.groupMetadata(from); } catch (err) { console.error(err); break; }

    const callerJid = (nowsender || '').replace(/:.*$/, '');
    const callerId = callerJid.includes('@') ? callerJid : `${callerJid}@s.whatsapp.net`;
    const ownerNumberClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const isOwnerCaller = callerJid.startsWith(ownerNumberClean);
    const groupAdmins = (groupMeta.participants || []).filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
    const isGroupAdminCaller = groupAdmins.includes(callerId);

    if (!isOwnerCaller && !isGroupAdminCaller) {
      await socket.sendMessage(sender, { text: '❌ Only group admins or the bot owner can use this command.' }, { quoted: msg });
      break;
    }

    try { await socket.sendMessage(sender, { text: '🪐 Scanning for online members... please wait ~15 seconds' }, { quoted: msg }); } catch(e){}

    const participants = (groupMeta.participants || []).map(p => p.id);
    const onlineSet = new Set();
    const presenceListener = (update) => {
      try {
        if (update?.presences) {
          for (const id of Object.keys(update.presences)) {
            const pres = update.presences[id];
            if (pres?.lastKnownPresence && pres.lastKnownPresence !== 'unavailable') onlineSet.add(id);
            if (pres?.available === true) onlineSet.add(id);
          }
        }
      } catch (e) { console.warn('presenceListener error', e); }
    };

    for (const p of participants) {
      try { if (typeof socket.presenceSubscribe === 'function') await socket.presenceSubscribe(p); } catch(e){}
    }
    socket.ev.on('presence.update', presenceListener);

    const checks = 3; const intervalMs = 5000;
    await new Promise((resolve) => { let attempts=0; const iv=setInterval(()=>{ attempts++; if(attempts>=checks){ clearInterval(iv); resolve(); } }, intervalMs); });
    try { socket.ev.off('presence.update', presenceListener); } catch(e){}

    if (onlineSet.size === 0) {
      await socket.sendMessage(sender, { text: '⚠️ No online members detected (they may be hiding presence or offline).' }, { quoted: msg });
      break;
    }

    const onlineArray = Array.from(onlineSet).filter(j => participants.includes(j));
    const mentionList = onlineArray.map(j => j);

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ONLINE" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let txt = `🟢 *Online Members* — ${onlineArray.length}/${participants.length}\n\n`;
    onlineArray.forEach((jid, i) => {
      txt += `${i+1}. @${jid.split('@')[0]}\n`;
    });

    await socket.sendMessage(sender, {
      text: txt.trim(),
      mentions: mentionList
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (err) {
    console.error('Error in online command:', err);
    try { await socket.sendMessage(sender, { text: '❌ An error occurred while checking online members.' }, { quoted: msg }); } catch(e){}
  }
  break;
}



case 'deladmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'NIKKA MINI BOT AI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN1" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide a jid/number to remove\nExample: .deladmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT AI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Only owner can remove admins.' }, { quoted: shonux });
  }

  try {
    await removeAdminFromMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN3" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Removed admin: ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('deladmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN4" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to remove admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}

case 'admins': {
  try {
    const list = await loadAdminsFromMongo();
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!list || list.length === 0) {
      return await socket.sendMessage(sender, { text: 'No admins configured.' }, { quoted: shonux });
    }

    let txt = '*👑 Admins:*\n\n';
    for (const a of list) txt += `▫️ ${a}\n`;

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('admins error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'QUEEN ASHI MINI BOT AI';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '❌ Failed to list admins.' }, { quoted: shonux });
  }
  break;
}
case 'setlogo': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session logo.' }, { quoted: shonux });
    break;
  }

  const ctxInfo = (msg.message.extendedTextMessage || {}).contextInfo || {};
  const quotedMsg = ctxInfo.quotedMessage;
  const media = await downloadQuotedMedia(quotedMsg).catch(()=>null);
  let logoSetTo = null;

  try {
    if (media && media.buffer) {
      const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
      fs.ensureDirSync(sessionPath);
      const mimeExt = (media.mime && media.mime.split('/').pop()) || 'jpg';
      const logoPath = path.join(sessionPath, `logo.${mimeExt}`);
      fs.writeFileSync(logoPath, media.buffer);
      let cfg = await loadUserConfigFromMongo(sanitized) || {};
      cfg.logo = logoPath;
      await setUserConfigInMongo(sanitized, cfg);
      logoSetTo = logoPath;
    } else if (args && args[0] && (args[0].startsWith('http') || args[0].startsWith('https'))) {
      let cfg = await loadUserConfigFromMongo(sanitized) || {};
      cfg.logo = args[0];
      await setUserConfigInMongo(sanitized, cfg);
      logoSetTo = args[0];
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: '❗ Usage: Reply to an image with `.setlogo` OR provide an image URL: `.setlogo https://example.com/logo.jpg`' }, { quoted: shonux });
      break;
    }

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Logo set for this session: ${logoSetTo}` }, { quoted: shonux });
  } catch (e) {
    console.error('setlogo error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set logo: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'jid': {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'QUEEN ASHI MINI BOT AI'; // dynamic bot name

    const userNumber = sender.split('@')[0]; 

    // Reaction
    await socket.sendMessage(sender, { 
        react: { text: "🆔", key: msg.key } 
    });

    // Fake contact quoting for meta style
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_FAKE_ID" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, {
        text: `${sender}\n`,
    }, { quoted: shonux });
    break;
}

// use inside your switch(command) { ... } block

case 'block': {
  try {
    // caller number (who sent the command)
    const callerNumberClean = (senderNumber || '').replace(/[^0-9]/g, '');
    const ownerNumberClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const sessionOwner = (number || '').replace(/[^0-9]/g, '');

    // allow if caller is global owner OR this session's owner
    if (callerNumberClean !== ownerNumberClean && callerNumberClean !== sessionOwner) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ ඔබට මෙය භාවිත කිරීමට අවසර නැත. (Owner හෝ මෙහි session owner විය යුතුයි)' }, { quoted: msg });
      break;
    }

    // determine target JID: reply / mention / arg
    let targetJid = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.participant) targetJid = ctx.participant; // replied user
    else if (ctx?.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0]; // mentioned
    else if (args && args.length > 0) {
      const possible = args[0].trim();
      if (possible.includes('@')) targetJid = possible;
      else {
        const digits = possible.replace(/[^0-9]/g,'');
        if (digits) targetJid = `${digits}@s.whatsapp.net`;
      }
    }

    if (!targetJid) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❗ කරුණාකර reply කරන හෝ mention කරන හෝ number එක යොදන්න. උදාහරණය: .block 9477xxxxxxx' }, { quoted: msg });
      break;
    }

    // normalize
    if (!targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;
    if (!targetJid.endsWith('@s.whatsapp.net') && !targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;

    // perform block
    try {
      if (typeof socket.updateBlockStatus === 'function') {
        await socket.updateBlockStatus(targetJid, 'block');
      } else {
        // some bailey builds use same method name; try anyway
        await socket.updateBlockStatus(targetJid, 'block');
      }
      try { await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: `✅ @${targetJid.split('@')[0]} blocked successfully.`, mentions: [targetJid] }, { quoted: msg });
    } catch (err) {
      console.error('Block error:', err);
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ Failed to block the user. (Maybe invalid JID or API failure)' }, { quoted: msg });
    }

  } catch (err) {
    console.error('block command general error:', err);
    try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, { text: '❌ Error occurred while processing block command.' }, { quoted: msg });
  }
  break;
}

case 'unblock': {
  try {
    // caller number (who sent the command)
    const callerNumberClean = (senderNumber || '').replace(/[^0-9]/g, '');
    const ownerNumberClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const sessionOwner = (number || '').replace(/[^0-9]/g, '');

    // allow if caller is global owner OR this session's owner
    if (callerNumberClean !== ownerNumberClean && callerNumberClean !== sessionOwner) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ ඔබට මෙය භාවිත කිරීමට අවසර නැත. (Owner හෝ මෙහි session owner විය යුතුයි)' }, { quoted: msg });
      break;
    }

    // determine target JID: reply / mention / arg
    let targetJid = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.participant) targetJid = ctx.participant;
    else if (ctx?.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0];
    else if (args && args.length > 0) {
      const possible = args[0].trim();
      if (possible.includes('@')) targetJid = possible;
      else {
        const digits = possible.replace(/[^0-9]/g,'');
        if (digits) targetJid = `${digits}@s.whatsapp.net`;
      }
    }

    if (!targetJid) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❗ කරුණාකර reply කරන හෝ mention කරන හෝ number එක යොදන්න. උදාහරණය: .unblock 9477xxxxxxx' }, { quoted: msg });
      break;
    }

    // normalize
    if (!targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;
    if (!targetJid.endsWith('@s.whatsapp.net') && !targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;

    // perform unblock
    try {
      if (typeof socket.updateBlockStatus === 'function') {
        await socket.updateBlockStatus(targetJid, 'unblock');
      } else {
        await socket.updateBlockStatus(targetJid, 'unblock');
      }
      try { await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: `🔓 @${targetJid.split('@')[0]} unblocked successfully.`, mentions: [targetJid] }, { quoted: msg });
    } catch (err) {
      console.error('Unblock error:', err);
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ Failed to unblock the user.' }, { quoted: msg });
    }

  } catch (err) {
    console.error('unblock command general error:', err);
    try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, { text: '❌ Error occurred while processing unblock command.' }, { quoted: msg });
  }
  break;
}

case 'setbotname': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session bot name.' }, { quoted: shonux });
    break;
  }

  const name = args.join(' ').trim();
  if (!name) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Provide bot name. Example: `.setbotname QUEEN ASHI MINI - 01`' }, { quoted: shonux });
  }

  try {
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    cfg.botName = name;
    await setUserConfigInMongo(sanitized, cfg);

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Bot display name set for this session: ${name}` }, { quoted: shonux });
  } catch (e) {
    console.error('setbotname error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set bot name: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}

case 'showconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let txt = `*Session config for ${sanitized}:*\n`;
    txt += `• Bot name: ${botName}\n`;
    txt += `• Logo: ${cfg.logo || config.RCD_IMAGE_PATH}\n`;
    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('showconfig error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: shonux });
  }
  break;
}

case 'resetconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can reset configs.' }, { quoted: shonux });
    break;
  }

  try {
    await setUserConfigInMongo(sanitized, {});

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '✅ Session config reset to defaults.' }, { quoted: shonux });
  } catch (e) {
    console.error('resetconfig error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '❌ Failed to reset config.' }, { quoted: shonux });
  }
  break;
}


        // default
        default:
          break;
      }
    } catch (err) {
      console.error('Command handler error:', err);
      try { await socket.sendMessage(sender, { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('❌ ERROR', 'An error occurred while processing your command. Please try again.', BOT_NAME_FANCY) }); } catch(e){}
    }

  });
}

// ---------------- message handlers ----------------

function setupMessageHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
    if (config.AUTO_RECORDING === 'true') {
      try { await socket.sendPresenceUpdate('recording', msg.key.remoteJid); } catch (e) {}
    }
  });
}

// ---------------- cleanup helper ----------------

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch(e){}
    try { await removeNumberFromMongo(sanitized); } catch(e){}
    try {
      const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      const caption = formatMessage('👑 OWNER NOTICE — SESSION REMOVED', `Number: ${sanitized}\nSession removed due to logout.\n\nActive sessions now: ${activeSockets.size}`, BOT_NAME_FANCY);
      if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
    } catch(e){}
    console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// ---------------- auto-restart ----------------

function setupAutoRestart(socket, number) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
                         || lastDisconnect?.error?.statusCode
                         || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
      const isLoggedOut = statusCode === 401
                          || (lastDisconnect?.error && lastDisconnect.error.code === 'AUTHENTICATION')
                          || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
                          || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
      if (isLoggedOut) {
        console.log(`User ${number} logged out. Cleaning up...`);
        try { await deleteSessionAndCleanup(number, socket); } catch(e){ console.error(e); }
      } else {
        console.log(`Connection closed for ${number} (not logout). Attempt reconnect...`);
        try { await delay(10000); activeSockets.delete(number.replace(/[^0-9]/g,'')); socketCreationTime.delete(number.replace(/[^0-9]/g,'')); const mockRes = { headersSent:false, send:() => {}, status: () => mockRes }; await EmpirePair(number, mockRes); } catch(e){ console.error('Reconnect attempt failed', e); }
      }

    }

  });
}

// ---------------- EmpirePair (pairing, temp dir, persist to Mongo) ----------------

async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
  await initMongo().catch(()=>{});
  // Prefill from Mongo if available
  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

 try {
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    socketCreationTime.set(sanitizedNumber, Date.now());

    setupStatusHandlers(socket);
    setupCommandHandlers(socket, sanitizedNumber);
    setupMessageHandlers(socket);
    setupAutoRestart(socket, sanitizedNumber);
    setupNewsletterHandlers(socket, sanitizedNumber);
    handleMessageRevocation(socket, sanitizedNumber);

    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try { await delay(1500); code = await socket.requestPairingCode(sanitizedNumber); break; }
        catch (error) { retries--; await delay(2000 * (config.MAX_RETRIES - retries)); }
      }
      if (!res.headersSent) res.send({ code });
    }

    // Save creds to Mongo when updated
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
        const credsObj = JSON.parse(fileContent);
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
      } catch (err) { console.error('Failed saving creds on creds.update:', err); }
    });


    socket.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(()=>({ status: 'failed', error: 'joinGroup not configured' }));

          // try follow newsletters if configured
          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            for (const doc of newsletterListDocs) {
              const jid = doc.jid;
              try { if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(jid); } catch(e){}
            }
          } catch(e){}

          activeSockets.set(sanitizedNumber, socket);
          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;

          // Load per-session config (botName, logo)
          const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
          const useBotName = userConfig.botName || BOT_NAME_FANCY;
          const useLogo = userConfig.logo || config.RCD_IMAGE_PATH;

          const initialCaption = formatMessage(useBotName,
            `✓ Successfully connecting!\n\n✓ Number: ${sanitizedNumber}\n🕒 Connecting : Bot will become active in a few seconds`,
            useBotName
          );

          // send initial message
          let sentMsg = null;
          try {
            if (String(useLogo).startsWith('http')) {
              sentMsg = await socket.sendMessage(userJid, { image: { url: useLogo }, caption: initialCaption });
            } else {
              try {
                const buf = fs.readFileSync(useLogo);
                sentMsg = await socket.sendMessage(userJid, { image: buf, caption: initialCaption });
              } catch (e) {
                sentMsg = await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: initialCaption });
              }
            }
          } catch (e) {
            console.warn('Failed to send initial connect message (image). Falling back to text.', e?.message || e);
            try { sentMsg = await socket.sendMessage(userJid, { text: initialCaption }); } catch(e){}
          }

          await delay(4000);

          const updatedCaption = formatMessage(useBotName,
            `✓ Successfully connected and ACTIVE!\n\n✓ Number: ${sanitizedNumber}\n✓ Status: ${groupStatus}\n🕒 Connected at: ${getSriLankaTimestamp()}`,
            useBotName
          );

          try {
            if (sentMsg && sentMsg.key) {
              try {
                await socket.sendMessage(userJid, { delete: sentMsg.key });
              } catch (delErr) {
                console.warn('Could not delete original connect message (not fatal):', delErr?.message || delErr);
              }
            }

            try {
              if (String(useLogo).startsWith('http')) {
                await socket.sendMessage(userJid, { image: { url: useLogo }, caption: updatedCaption });
              } else {
                try {
                  const buf = fs.readFileSync(useLogo);
                  await socket.sendMessage(userJid, { image: buf, caption: updatedCaption });
                } catch (e) {
                  await socket.sendMessage(userJid, { text: updatedCaption });
                }
              }
            } catch (imgErr) {
              await socket.sendMessage(userJid, { text: updatedCaption });
            }
          } catch (e) {
            console.error('Failed during connect-message edit sequence:', e);
          }

          // send admin + owner notifications as before, with session overrides
          await sendAdminConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          await sendOwnerConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          await addNumberToMongo(sanitizedNumber);

        } catch (e) { 
          console.error('Connection open error:', e); 
          try { exec(`pm2.restart ${process.env.PM2_NAME || 'NIKKA-MINI-main'}`); } catch(e) { console.error('pm2 restart failed', e); }
        }
      }
      if (connection === 'close') {
        try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
      }

    });


    activeSockets.set(sanitizedNumber, socket);

  } catch (error) {
    console.error('Pairing error:', error);
    socketCreationTime.delete(sanitizedNumber);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }

}


// ---------------- endpoints (admin/newsletter management + others) ----------------

router.post('/newsletter/add', async (req, res) => {
  const { jid, emojis } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  if (!jid.endsWith('@newsletter')) return res.status(400).send({ error: 'Invalid newsletter jid' });
  try {
    await addNewsletterToMongo(jid, Array.isArray(emojis) ? emojis : []);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/newsletter/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeNewsletterFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/newsletter/list', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.status(200).send({ status: 'ok', channels: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// admin endpoints

router.post('/admin/add', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await addAdminToMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/admin/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeAdminFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/admin/list', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.status(200).send({ status: 'ok', admins: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// existing endpoints (connect, reconnect, active, etc.)

router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  if (activeSockets.has(number.replace(/[^0-9]/g, ''))) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(number, res);
});


router.get('/active', (req, res) => {
  res.status(200).send({ botName: BOT_NAME_FANCY, count: activeSockets.size, numbers: Array.from(activeSockets.keys()), timestamp: getSriLankaTimestamp() });
});


router.get('/ping', (req, res) => {
  res.status(200).send({ status: 'active', botName: BOT_NAME_FANCY, message: '🇱🇰NIKKA  FREE BOT', activesession: activeSockets.size });
});


router.get('/connect-all', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No numbers found to connect' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
      await EmpirePair(number, mockRes);
      results.push({ number, status: 'connection_initiated' });
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Connect all error:', error); res.status(500).send({ error: 'Failed to connect all bots' }); }
});


router.get('/reconnect', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No session numbers found in MongoDB' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
      try { await EmpirePair(number, mockRes); results.push({ number, status: 'connection_initiated' }); } catch (err) { results.push({ number, status: 'failed', error: err.message }); }
      await delay(1000);
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Reconnect error:', error); res.status(500).send({ error: 'Failed to reconnect bots' }); }
});


router.get('/update-config', async (req, res) => {
  const { number, config: configString } = req.query;
  if (!number || !configString) return res.status(400).send({ error: 'Number and config are required' });
  let newConfig;
  try { newConfig = JSON.parse(configString); } catch (error) { return res.status(400).send({ error: 'Invalid config format' }); }
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const otp = generateOTP();
  otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });
  try { await sendOTP(socket, sanitizedNumber, otp); res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' }); }
  catch (error) { otpStore.delete(sanitizedNumber); res.status(500).send({ error: 'Failed to send OTP' }); }
});


router.get('/verify-otp', async (req, res) => {
  const { number, otp } = req.query;
  if (!number || !otp) return res.status(400).send({ error: 'Number and OTP are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const storedData = otpStore.get(sanitizedNumber);
  if (!storedData) return res.status(400).send({ error: 'No OTP request found for this number' });
  if (Date.now() >= storedData.expiry) { otpStore.delete(sanitizedNumber); return res.status(400).send({ error: 'OTP has expired' }); }
  if (storedData.otp !== otp) return res.status(400).send({ error: 'Invalid OTP' });
  try {
    await setUserConfigInMongo(sanitizedNumber, storedData.newConfig);
    otpStore.delete(sanitizedNumber);
    const sock = activeSockets.get(sanitizedNumber);
    if (sock) await sock.sendMessage(jidNormalizedUser(sock.user.id), { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', BOT_NAME_FANCY) });
    res.status(200).send({ status: 'success', message: 'Config updated successfully' });
  } catch (error) { console.error('Failed to update config:', error); res.status(500).send({ error: 'Failed to update config' }); }
});


router.get('/getabout', async (req, res) => {
  const { number, target } = req.query;
  if (!number || !target) return res.status(400).send({ error: 'Number and target number are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    const statusData = await socket.fetchStatus(targetJid);
    const aboutStatus = statusData.status || 'No status available';
    const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
    res.status(200).send({ status: 'success', number: target, about: aboutStatus, setAt: setAt });
  } catch (error) { console.error(`Failed to fetch status for ${target}:`, error); res.status(500).send({ status: 'error', message: `Failed to fetch About status for ${target}.` }); }
});


// ---------------- Dashboard endpoints & static ----------------

const dashboardStaticDir = path.join(__dirname, 'dashboard_static');
if (!fs.existsSync(dashboardStaticDir)) fs.ensureDirSync(dashboardStaticDir);
router.use('/dashboard/static', express.static(dashboardStaticDir));
router.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(dashboardStaticDir, 'index.html'));
});


// API: sessions & active & delete

router.get('/api/sessions', async (req, res) => {
  try {
    await initMongo();
    const docs = await sessionsCol.find({}, { projection: { number: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
    res.json({ ok: true, sessions: docs });
  } catch (err) {
    console.error('API /api/sessions error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/active', async (req, res) => {
  try {
    const keys = Array.from(activeSockets.keys());
    res.json({ ok: true, active: keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.post('/api/session/delete', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) return res.status(400).json({ ok: false, error: 'number required' });
    const sanitized = ('' + number).replace(/[^0-9]/g, '');
    const running = activeSockets.get(sanitized);
    if (running) {
      try { if (typeof running.logout === 'function') await running.logout().catch(()=>{}); } catch(e){}
      try { running.ws?.close(); } catch(e){}
      activeSockets.delete(sanitized);
      socketCreationTime.delete(sanitized);
    }
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);
    try { const sessTmp = path.join(os.tmpdir(), `session_${sanitized}`); if (fs.existsSync(sessTmp)) fs.removeSync(sessTmp); } catch(e){}
    res.json({ ok: true, message: `Session ${sanitized} removed` });
  } catch (err) {
    console.error('API /api/session/delete error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/newsletters', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});
router.get('/api/admins', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


// ---------------- cleanup + process events ----------------

process.on('exit', () => {
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) {}
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try { fs.removeSync(path.join(os.tmpdir(), `session_${number}`)); } catch(e){}
  });
});


process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try { exec(`pm2.restart ${process.env.PM2_NAME || 'NIKKA-MINI-main'}`); } catch(e) { console.error('Failed to restart pm2:', e); }
});


// initialize mongo & auto-reconnect attempt

initMongo().catch(err => console.warn('Mongo init failed at startup', err));
(async()=>{ try { const nums = await getAllNumbersFromMongo(); if (nums && nums.length) { for (const n of nums) { if (!activeSockets.has(n)) { const mockRes = { headersSent:false, send:()=>{}, status:()=>mockRes }; await EmpirePair(n, mockRes); await delay(500); } } } } catch(e){} })();

module.exports = router;
