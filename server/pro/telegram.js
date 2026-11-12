'use strict';
// KuentaPOS Pro – not open source. Use only with a valid KuentaPOS Pro license, see server/pro/LICENSE.md.
//
// Telegram via a bot of the workshop (Telegram Bot API). A bot cannot write to a phone number: the customer
// opens the link t.me/<bot>?start=<code> once (or scans the QR code) and presses "Start". KuentaPOS fetches the
// updates of the bot itself (no webhook, so it also works without a public address) and remembers the chat.
const crypto = require('crypto');
const L = require('../lib');
const LIZENZ = require('../lizenz');

const BASIS = () => (process.env.KUENTAPOS_TELEGRAM_URL || 'https://api.telegram.org').replace(/\/+$/, '');

const token = () => L.sw('telegram.token', '').trim();
const eingerichtet = () => !!token();

async function aufruf(methode, daten, { ohneLizenz } = {}) {
  if (!ohneLizenz) LIZENZ.brauche('telegram');
  const t = token();
  if (!t) throw new L.HttpError(400, 'Telegram ist nicht eingerichtet (Einstellungen → WhatsApp & Telegram).');
  const opts = { method: 'POST', signal: AbortSignal.timeout(30000) };
  if (daten instanceof FormData) opts.body = daten;
  else { opts.body = JSON.stringify(daten || {}); opts.headers = { 'Content-Type': 'application/json' }; }
  let r;
  try { r = await fetch(`${BASIS()}/bot${t}/${methode}`, opts); }
  catch (e) { throw new Error(`Telegram nicht erreichbar (${e.cause && e.cause.code ? e.cause.code : e.message}).`); }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    if (r.status === 401 || j.error_code === 401) throw new L.HttpError(400, 'Telegram lehnt den Bot-Token ab. Bitte den Token von @BotFather prüfen.');
    if (j.error_code === 403) throw new Error('Der Kunde hat den Bot blockiert oder den Chat gelöscht.');
    throw new Error(`Telegram meldet Fehler ${j.error_code || r.status}: ${j.description || r.statusText}`);
  }
  return j.result;
}

// name of the bot (cached per token; every tenant can have its own bot)
const botCache = new Map();
async function bot() {
  const t = token();
  if (botCache.has(t)) return botCache.get(t);
  const me = await aufruf('getMe');
  const b = { id: me.id, username: me.username, name: me.first_name };
  botCache.set(t, b);
  return b;
}

// link for a customer: creates the code on first use
async function link(kunid) {
  const d = L.db();
  const k = d.prepare('SELECT KUNID, TELEGRAM_CODE, TELEGRAM_CHATID, TELEGRAM_NAME FROM KUNDEN WHERE KUNID=?').get(kunid);
  if (!k) throw new L.HttpError(404, 'Kunde nicht gefunden.');
  let code = k.TELEGRAM_CODE;
  if (!code) { code = 'k' + crypto.randomBytes(9).toString('base64url'); d.prepare('UPDATE KUNDEN SET TELEGRAM_CODE=? WHERE KUNID=?').run(code, kunid); }
  const b = await bot();
  return { link: `https://t.me/${b.username}?start=${code}`, bot: b.username, verbunden: !!k.TELEGRAM_CHATID, name: k.TELEGRAM_NAME || null };
}

function trennen(kunid) {
  L.db().prepare('UPDATE KUNDEN SET TELEGRAM_CHATID=NULL, TELEGRAM_NAME=NULL, TELEGRAM_CODE=NULL WHERE KUNID=?').run(kunid);
  return { ok: true };
}

async function nachricht(chatId, text) {
  const m = await aufruf('sendMessage', { chat_id: chatId, text: String(text || ''), disable_web_page_preview: true });
  return { ok: true, id: m.message_id };
}
async function dokument(chatId, buf, filename, text) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (text) fd.append('caption', String(text).slice(0, 1024));
  fd.append('document', new Blob([buf], { type: 'application/pdf' }), filename);
  const m = await aufruf('sendDocument', fd);
  return { ok: true, id: m.message_id };
}

// Fetch new messages of the bot: "/start <code>" connects the chat with the customer, "/stop" disconnects it.
// Runs in the background (server/index.js); does nothing without license or token.
const laufend = new Set();   // tokens being fetched right now
async function abholen() {
  const t = token();
  if (!t || laufend.has(t) || !LIZENZ.hat('telegram')) return { neu: 0 };
  laufend.add(t);
  try {
    const { Dt } = require('../i18n');
    const offset = Number(L.sw('telegram.offset', '0')) || 0;
    const updates = await aufruf('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
    const d = L.db(); const f = L.firma();
    let neu = 0;
    for (const u of updates) {
      L.setSw('telegram.offset', String(u.update_id + 1));
      const m = u.message;
      if (!m || !m.chat || m.chat.type !== 'private' || typeof m.text !== 'string') continue;
      const chat = String(m.chat.id);
      const wer = [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(' ') + (m.from && m.from.username ? ` (@${m.from.username})` : '');
      const start = /^\/start(?:\s+(\S+))?/.exec(m.text.trim());
      const antwort = text => nachricht(chat, text).catch(e => console.warn('Telegram:', e.message));
      if (start) {
        const k = start[1] ? d.prepare('SELECT KUNID FROM KUNDEN WHERE TELEGRAM_CODE=?').get(start[1]) : null;
        if (!k) { await antwort(Dt('Dieser Link ist nicht (mehr) gültig. Bitte fragen Sie bei {firma} nach einem neuen Link.', { firma: f.FIRMENNAME || '' })); continue; }
        d.prepare('UPDATE KUNDEN SET TELEGRAM_CHATID=NULL, TELEGRAM_NAME=NULL WHERE TELEGRAM_CHATID=? AND KUNID<>?').run(chat, k.KUNID);
        d.prepare('UPDATE KUNDEN SET TELEGRAM_CHATID=?, TELEGRAM_NAME=? WHERE KUNID=?').run(chat, wer || chat, k.KUNID);
        neu++;
        await antwort(Dt('Willkommen! Sie erhalten Nachrichten von {firma} ab jetzt hier: Erinnerungen, Rechnungen und die Nachricht, wenn Ihr Fahrzeug fertig ist. Abmelden mit /stop.', { firma: f.FIRMENNAME || '' }));
      } else if (/^\/stop\b/.test(m.text.trim())) {
        d.prepare('UPDATE KUNDEN SET TELEGRAM_CHATID=NULL, TELEGRAM_NAME=NULL WHERE TELEGRAM_CHATID=?').run(chat);
        await antwort(Dt('Sie erhalten keine Nachrichten mehr von {firma} über Telegram.', { firma: f.FIRMENNAME || '' }));
      } else {
        await antwort(Dt('Nachrichten an diesen Chat werden nicht gelesen. Sie erreichen {firma} unter {telefon}.', { firma: f.FIRMENNAME || '', telefon: f.TELEFON || '' }));
      }
    }
    return { neu };
  } finally { laufend.delete(t); }
}

module.exports = { eingerichtet, bot, link, trennen, nachricht, dokument, abholen };
