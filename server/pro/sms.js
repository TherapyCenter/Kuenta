'use strict';
// Kuenta Pro – not open source. Use only with a valid Kuenta Pro license, see server/pro/LICENSE.md.
//
// SMS sending via a freely configurable HTTP gateway: an SMS provider on the internet, an Android phone with
// a gateway app, or the Kuenta SMS relay (USB modem with SIM card on another computer, see installer/sms-relais).
const L = require('../lib');
const LIZENZ = require('../lizenz');

const VORWAHL = { DE: '49', AT: '43', CH: '41', LU: '352', NL: '31', BE: '32', FR: '33', IT: '39', ES: '34', PL: '48', CZ: '420', DK: '45' };

function landesvorwahl() {
  const land = String(L.firma().LAND || 'DE').trim().toUpperCase();
  return VORWAHL[land] || VORWAHL[land.slice(0, 2)] || '49';
}

// phone number in international format (+49…); null if it is not a valid number
function nummer(roh) {
  let s = String(roh || '').replace(/[\s/\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  else if (s.startsWith('0')) s = '+' + landesvorwahl() + s.slice(1);
  else if (/^\d/.test(s)) s = '+' + s;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
// Only mobile numbers can receive SMS (for unknown countries every number is accepted)
function istMobil(e164) {
  if (!e164) return false;
  if (e164.startsWith('+49')) return /^\+491[5-7]\d{7,10}$/.test(e164);
  if (e164.startsWith('+43')) return /^\+436\d{6,12}$/.test(e164);
  if (e164.startsWith('+41')) return /^\+417[5-9]\d{7}$/.test(e164);
  return true;
}
// First mobile number from the given fields (e.g. mobile, then phone)
function mobilnummer(...felder) {
  for (const f of felder) { const n = nummer(f); if (n && istMobil(n)) return n; }
  return null;
}

function einstellungen() {
  return {
    methode: L.sw('sms.methode', 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
    url: L.sw('sms.url', '').trim(),
    format: L.sw('sms.format', 'json'),                 // json | form
    header: L.sw('sms.header', ''),
    body: L.sw('sms.body', ''),
    benutzer: L.sw('sms.benutzer', ''),
    passwort: L.sw('sms.passwort', ''),
    absender: L.sw('sms.absender', '') || (L.firma().FIRMENNAME || '').slice(0, 11),
  };
}

// encode placeholders correctly for where they are used
function fuellen(vorlage, werte, art) {
  const kod = v => art === 'url' || art === 'form' ? encodeURIComponent(v) : art === 'json' ? JSON.stringify(String(v)).slice(1, -1) : String(v);
  return String(vorlage || '').replace(/\{(nummer|nummer_ohne_plus|text|absender)\}/g, (m, k) => kod(werte[k] ?? ''));
}

async function senden(an, text, override) {
  LIZENZ.brauche('sms');
  const c = { ...einstellungen(), ...(override || {}) };
  if (!c.url) throw new L.HttpError(400, 'Es ist kein SMS-Gateway eingerichtet (Einstellungen → Erinnerungen & SMS).');
  const n = nummer(an);
  if (!n) throw new L.HttpError(400, `„${an}“ ist keine gültige Rufnummer.`);
  const werte = { nummer: n, nummer_ohne_plus: n.slice(1), text: String(text || ''), absender: c.absender };
  const headers = { 'User-Agent': 'Kuenta' };
  for (const z of String(c.header || '').split(/\r?\n/)) { const i = z.indexOf(':'); if (i > 0) headers[z.slice(0, i).trim()] = z.slice(i + 1).trim(); }
  if (c.benutzer) headers.Authorization = 'Basic ' + Buffer.from(`${c.benutzer}:${c.passwort || ''}`).toString('base64');
  const opts = { method: c.methode, headers, signal: AbortSignal.timeout(20000) };
  if (c.methode === 'POST') {
    opts.body = fuellen(c.body, werte, c.format === 'form' ? 'form' : 'json');
    if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['Content-Type'] = c.format === 'form' ? 'application/x-www-form-urlencoded' : 'application/json';
  }
  let r;
  try { r = await fetch(fuellen(c.url, werte, 'url'), opts); }
  catch (e) { throw new Error(`SMS-Gateway nicht erreichbar (${e.cause && e.cause.code ? e.cause.code : e.message}). Läuft das Gateway und stimmt die Adresse?`); }
  const antwort = (await r.text().catch(() => '')).slice(0, 300);
  if (!r.ok) throw new Error(`SMS-Gateway meldet Fehler ${r.status}${antwort ? ': ' + antwort.replace(/\s+/g, ' ') : ''}`);
  return { ok: true, an: n, status: r.status, antwort };
}

module.exports = { senden, nummer, istMobil, mobilnummer, einstellungen, fuellen };
