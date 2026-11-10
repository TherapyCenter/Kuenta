#!/usr/bin/env node
'use strict';
// Kuenta license tool for the publisher. Runs without the Kuenta server, needs only Node.js.
//
//   node tools/lizenz/lizenz-werkzeug.js schluessel
//       Creates the key pair once. The private key is stored in
//       ~/.kuenta-lizenz/privat.pem (NEVER put it into the repository!). Enter the printed public
//       key in server/lizenz.js at OEFFENTLICH.
//
//   node tools/lizenz/lizenz-werkzeug.js ausstellen --kunde "Werkstatt Muster" --funktionen sms
//       [--bis 2027-12-31] [--zahlung "BTC 0.0012, txid …"] [--email kunde@example.de]
//       Prints the license key and records it in ~/.kuenta-lizenz/ausgestellt.csv.
//
//   node tools/lizenz/lizenz-werkzeug.js pruefen <key>
//       Shows the content of a key and verifies the signature.
//
//   node tools/lizenz/lizenz-werkzeug.js shop einrichten | shop test [--mail-an address]
//   node tools/lizenz/lizenz-werkzeug.js shop [--probe]
//       License shop: fetches paid add-on orders from the BTCPay Server, issues the keys
//       and sends them by email (settings in ~/.kuenta-lizenz/shop.json, see
//       tools/lizenz/README.md). "shop erledigt <ID>" records an order that was handled by hand.
//
// Change the folder: environment variable KUENTA_LIZENZ_HOME. Output follows the system language
// (KUENTA_LANG=de|en|es to choose).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { C } = require('../../server/i18n');

const HOME = process.env.KUENTA_LIZENZ_HOME || path.join(os.homedir(), '.kuenta-lizenz');
const PRIVAT = path.join(HOME, 'privat.pem');
const REGISTER = path.join(HOME, 'ausgestellt.csv');
const PRAEFIX = 'KUENTA1';

function args(liste) {
  const o = {}; const rest = [];
  for (let i = 0; i < liste.length; i++) {
    if (liste[i].startsWith('--')) o[liste[i].slice(2)] = liste[i + 1] && !liste[i + 1].startsWith('--') ? liste[++i] : true;
    else rest.push(liste[i]);
  }
  return { o, rest };
}

function oeffentlichAus(privat) { return crypto.createPublicKey(privat).export({ format: 'jwk' }).x; }

function schluessel() {
  if (fs.existsSync(PRIVAT)) {
    const priv = crypto.createPrivateKey(fs.readFileSync(PRIVAT));
    console.log(C(`Es gibt schon einen privaten Schlüssel: ${PRIVAT}`) + '\n' + C(`Öffentlicher Schlüssel: ${oeffentlichAus(priv)}`));
    return;
  }
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(PRIVAT, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  console.log(C(`Privater Schlüssel gespeichert: ${PRIVAT}`));
  console.log(C('WICHTIG: sicher sichern (z. B. verschlüsselter USB-Stick). Verloren = keine neuen Lizenzen; weitergegeben = jeder kann Lizenzen erzeugen.'));
  console.log('\n' + C('Öffentlicher Schlüssel (in server/lizenz.js bei OEFFENTLICH eintragen):') + '\n' + oeffentlichAus(privateKey));
}

function csv(v) { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// Creates and records a license, returns { daten, key }
function erzeugen(o) {
  if (!fs.existsSync(PRIVAT)) throw new Error(C(`Kein privater Schlüssel in ${PRIVAT}. Zuerst "schluessel" ausführen.`));
  if (!o.kunde || o.kunde === true) throw new Error(C('--kunde "Name der Werkstatt" fehlt.'));
  if (!o.funktionen || o.funktionen === true) throw new Error(C('--funktionen fehlt, z. B. --funktionen sms (mehrere mit Komma, "pro" = alle Add-ons, auch künftige).'));
  if (o.bis && !/^\d{4}-\d{2}-\d{2}$/.test(o.bis)) throw new Error(C('--bis bitte als JJJJ-MM-TT angeben.'));
  const priv = crypto.createPrivateKey(fs.readFileSync(PRIVAT));
  const daten = {
    v: 1,
    id: crypto.randomBytes(6).toString('hex'),
    kunde: String(o.kunde),
    funktionen: String(o.funktionen).split(',').map(s => s.trim()).filter(Boolean),
    ausgestellt: new Date().toISOString().slice(0, 10),
    bis: o.bis || null,
  };
  const kopf = PRAEFIX + '.' + Buffer.from(JSON.stringify(daten)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(kopf), priv).toString('base64url');
  const key = kopf + '.' + sig;
  fs.mkdirSync(HOME, { recursive: true });
  if (!fs.existsSync(REGISTER)) fs.writeFileSync(REGISTER, '﻿ID;Ausgestellt;Kunde;E-Mail;Funktionen;Gültig bis;Zahlung;Schlüssel\n');
  fs.appendFileSync(REGISTER, [daten.id, daten.ausgestellt, daten.kunde, o.email === true ? '' : o.email, daten.funktionen.join(','), daten.bis || 'unbefristet', o.zahlung === true ? '' : o.zahlung, key].map(csv).join(';') + '\n');
  return { daten, key };
}
function ausstellen(o) {
  const { daten, key } = erzeugen(o);
  console.log(C(`Lizenz ${daten.id} für „${daten.kunde}“ (${daten.funktionen.join(', ')}, ${daten.bis ? C('bis') + ' ' + daten.bis : C('unbefristet')}):`) + `\n\n${key}\n\n` + C(`Vermerkt in ${REGISTER}`));
}

function pruefen(key) {
  if (!key) throw new Error(C('Schlüssel fehlt.'));
  const teile = String(key).replace(/\s+/g, '').split('.');
  if (teile.length !== 3 || teile[0] !== PRAEFIX) throw new Error(C('Kein Kuenta-Lizenzschlüssel.'));
  const daten = JSON.parse(Buffer.from(teile[1], 'base64url').toString('utf8'));
  console.log(JSON.stringify(daten, null, 2));
  if (fs.existsSync(PRIVAT)) {
    const pub = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(PRIVAT)));
    const ok = crypto.verify(null, Buffer.from(teile[0] + '.' + teile[1]), pub, Buffer.from(teile[2], 'base64url'));
    console.log(C(ok ? 'Signatur: gültig' : 'Signatur: UNGÜLTIG'));
    if (!ok) process.exitCode = 1;
  }
}

// ---------- License shop via BTCPay Server ----------
async function shop(unter, o, rest) {
  const SHOP = require('./shop');
  if (unter === 'einrichten') {
    const r = SHOP.einrichten(HOME);
    console.log(r.neu ? C(`Vorlage angelegt: ${r.datei}`) + '\n' + C('Bitte BTCPay-Adresse, Store-ID, API-Schlüssel und SMTP-Zugang eintragen, dann "shop test".') : C(`Die Shop-Einstellungen gibt es schon: ${r.datei}`));
  } else if (unter === 'test') {
    await SHOP.test(HOME);
    console.log(C('Verbindung zum BTCPay Server in Ordnung.'));
    if (o['mail-an'] && o['mail-an'] !== true) {
      const c = JSON.parse(fs.readFileSync(path.join(HOME, 'shop.json'), 'utf8'));
      await require('../../server/mail').send({ to: o['mail-an'], subject: 'Test vom Kuenta-Lizenz-Shop', text: 'Der E-Mail-Versand funktioniert.' }, c.smtp);
      console.log(C(`Test-E-Mail an ${o['mail-an']} verschickt.`));
    }
  } else if (unter === 'erledigt') {
    if (!rest[0]) throw new Error(C('BTCPay-Rechnungs-ID fehlt: shop erledigt <ID>'));
    SHOP.erledigt(HOME, rest[0]);
    console.log(C(`Rechnung ${rest[0]} als erledigt vermerkt.`));
  } else if (!unter || unter === 'abholen') {
    const MAIL = require('../../server/mail');
    const r = await SHOP.abholen({ home: HOME, erzeugen, senden: (mail, smtp) => MAIL.send(mail, smtp), probe: !!o.probe });
    console.log((o.probe ? '[Probe] ' : '') + C(`Neue Lizenzen: ${r.neu}, versendet: ${r.versendet}`) + (r.offen.length ? ', ' + C(`von Hand zu klären: ${r.offen.length}`) : '') + (r.fehler.length ? ', ' + C(`Fehler: ${r.fehler.length}`) : ''));
    for (const x of [...r.offen, ...r.fehler]) console.log('  ' + x);
    if (r.fehler.length) process.exitCode = 1;
  } else throw new Error(C('Unbekannter Shop-Befehl. Möglich: shop einrichten | shop test [--mail-an adresse] | shop [abholen] [--probe] | shop erledigt <ID>'));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  if (cmd === 'schluessel') schluessel();
  else if (cmd === 'ausstellen') ausstellen(a.o);
  else if (cmd === 'pruefen') pruefen(a.rest[0]);
  else if (cmd === 'shop') await shop(a.rest[0], a.o, a.rest.slice(1));
  else console.log(C('Befehle:') + ' schluessel | ausstellen --kunde "…" --funktionen sms[,…]|pro [--bis JJJJ-MM-TT] [--zahlung "…"] [--email …] | pruefen <Schlüssel> | shop einrichten|test|abholen|erledigt');
}
if (require.main === module) main().catch(e => { console.error(C('Fehler:') + ' ' + e.message); process.exitCode = 1; });
module.exports = { erzeugen };
