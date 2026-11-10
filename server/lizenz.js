'use strict';
// Pro license: unlocks paid add-on features (e.g. SMS reminders).
//
// A license key is a record signed with Ed25519:
//   KUENTA1.<base64url(JSON)>.<base64url(signature)>
// Kuenta only contains the public key and can verify licenses with it, but cannot create
// any. They are issued with tools/lizenz/lizenz-werkzeug.js and the private key, which
// only the publisher holds.
//
// The license applies to the whole installation (all tenants) and is stored as lizenz.key in
// the data folder. It is checked without an internet connection.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbm = require('./db');
const { HttpError } = require('./lib');

// Public key of the publisher (Ed25519, raw, base64url)
let OEFFENTLICH = '0_vANdSqd8_PZimMSyXqoPQ89OJAU3uD18pBgGEriG0';

// Pro features. A license with "pro" unlocks all of them, including ones added later.
const FUNKTIONEN = {
  sms: 'SMS-Erinnerungen und SMS-Gateway',
};

// Purchase information shown in Kuenta (to be adjusted by the publisher before release)
const ANGEBOT = {
  seite: 'https://github.com/TherapyCenter/Kuenta/blob/main/PRO.md',
  // Address of the BTCPay "Point of Sale" app (license shop). Empty = order by email only.
  shop: '',
  text: 'Add-ons kosten je 10 € (einmalig) und werden mit Bitcoin (BTC, auch Lightning) oder Tether (USDT) bezahlt. Bestellung an heidepower@proton.me, nach Zahlungseingang erhalten Sie Ihren Lizenzschlüssel.',
};

const PRAEFIX = 'KUENTA1';
const datei = () => path.join(dbm.ROOT, 'lizenz.key');

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

// Verifies a key and returns the license data; throws on an invalid key.
function pruefen(text, oeffentlich = OEFFENTLICH) {
  const s = String(text || '').replace(/\s+/g, '');
  const teile = s.split('.');
  if (teile.length !== 3 || teile[0] !== PRAEFIX) throw new Error('Das ist kein Kuenta-Lizenzschlüssel.');
  let key;
  try { key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: oeffentlich }, format: 'jwk' }); }
  catch { throw new Error('In dieser Kuenta-Version ist kein gültiger Prüfschlüssel hinterlegt.'); }
  const ok = crypto.verify(null, Buffer.from(teile[0] + '.' + teile[1]), key, Buffer.from(teile[2], 'base64url'));
  if (!ok) throw new Error('Der Lizenzschlüssel ist ungültig (Signatur stimmt nicht). Bitte vollständig und unverändert einfügen.');
  let d;
  try { d = JSON.parse(Buffer.from(teile[1], 'base64url').toString('utf8')); } catch { throw new Error('Der Lizenzschlüssel ist beschädigt.'); }
  if (!d || !Array.isArray(d.funktionen)) throw new Error('Der Lizenzschlüssel ist beschädigt.');
  return d;
}

// Expired? bis = last valid day (YYYY-MM-DD) or empty = unlimited
function abgelaufen(d, heute = new Date().toISOString().slice(0, 10)) { return !!(d.bis && d.bis < heute); }

let cache = null; // { text, daten, fehler } – the file is small and is read on every request
function laden() {
  let text;
  try { text = fs.readFileSync(datei(), 'utf8'); } catch { cache = null; return null; }
  if (cache && cache.text === text) return cache;
  try { cache = { text, daten: pruefen(text), fehler: null }; }
  catch (e) { cache = { text, daten: null, fehler: e.message }; }
  return cache;
}

function hat(funktion) {
  const c = laden();
  if (!c || !c.daten || abgelaufen(c.daten)) return false;
  return c.daten.funktionen.includes('pro') || c.daten.funktionen.includes(funktion);
}

// For server routes: without a license, HTTP 402 with an understandable message
function brauche(funktion) {
  if (hat(funktion)) return;
  const c = laden();
  const name = FUNKTIONEN[funktion] || funktion;
  const grund = c && c.daten && abgelaufen(c.daten) ? `Ihre Kuenta-Pro-Lizenz ist am ${c.daten.bis.split('-').reverse().join('.')} abgelaufen.` : `„${name}“ ist eine Funktion von Kuenta Pro.`;
  const e = new HttpError(402, `${grund} Den Lizenzschlüssel tragen Sie unter Einstellungen → Lizenz ein.`);
  e.code = 'PRO';
  throw e;
}

// State for the user interface (without the key itself)
function status() {
  const c = laden();
  const funktionen = Object.keys(FUNKTIONEN).filter(hat);
  const basis = { funktionen, katalog: FUNKTIONEN, angebot: ANGEBOT };
  if (!c) return { ...basis, vorhanden: false };
  if (!c.daten) return { ...basis, vorhanden: true, fehler: c.fehler };
  const d = c.daten;
  return { ...basis, vorhanden: true, id: d.id, kunde: d.kunde, lizenziert: d.funktionen, ausgestellt: d.ausgestellt, bis: d.bis || null, abgelaufen: abgelaufen(d) };
}

function einspielen(text) {
  const s = String(text || '').replace(/\s+/g, '');
  const d = pruefen(s); // throws with a message
  if (abgelaufen(d)) throw new HttpError(400, `Dieser Lizenzschlüssel ist am ${d.bis.split('-').reverse().join('.')} abgelaufen.`);
  fs.mkdirSync(dbm.ROOT, { recursive: true });
  fs.writeFileSync(datei(), s + '\n');
  cache = null;
  return status();
}

function entfernen() { try { fs.unlinkSync(datei()); } catch {} cache = null; return status(); }

// For tests only: use a different verification key
function _pruefschluessel(x) { OEFFENTLICH = x; cache = null; }

module.exports = { pruefen, hat, brauche, status, einspielen, entfernen, abgelaufen, FUNKTIONEN, ANGEBOT, PRAEFIX, b64url, _pruefschluessel };
