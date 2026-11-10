#!/usr/bin/env node
'use strict';
// Kuenta SMS relay: runs on the computer with the USB modem (SIM card) and sends SMS for Kuenta.
// Kuenta sends POST /sms with {"nummer":"+4917…","text":"…"} and the header "X-Token: <token>".
// Sending via gammu (https://wammu.eu/gammu/), which supports most USB modems.
//
//   KUENTA_SMS_TOKEN=secret node kuenta-sms-relais.js
//
// Environment variables:
//   KUENTA_SMS_TOKEN    Required. Same value as in Kuenta (header X-Token).
//   PORT                Default 3790
//   HOST                Default 0.0.0.0 (all network interfaces)
//   KUENTA_SMS_BEFEHL   Default "gammu". With a running gammu-smsd: "gammu-smsd-inject".
//   KUENTA_SMS_GAMMURC  optional: path to the gammu configuration (passed as -c)
//   KUENTA_LANG         optional: language of the console output (de, en, es; default: system)
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Console output in the system language. The relay often runs alone on another computer,
// so it carries its own small table instead of Kuenta's language files.
const TEXTE = {
  en: { fehltToken: 'KUENTA_SMS_TOKEN is missing.', beispiel: 'Example: KUENTA_SMS_TOKEN=secret node kuenta-sms-relais.js', laeuft: 'Kuenta SMS relay running on {0}  (POST /sms, GET /status)', gesendet: 'SMS to {0} sent ({1} characters)', fehler: 'SMS to {0} failed: {1}' },
  de: { fehltToken: 'KUENTA_SMS_TOKEN fehlt.', beispiel: 'Beispiel: KUENTA_SMS_TOKEN=geheim node kuenta-sms-relais.js', laeuft: 'Kuenta-SMS-Relais läuft auf {0}  (POST /sms, GET /status)', gesendet: 'SMS an {0} gesendet ({1} Zeichen)', fehler: 'SMS an {0} fehlgeschlagen: {1}' },
  es: { fehltToken: 'Falta KUENTA_SMS_TOKEN.', beispiel: 'Ejemplo: KUENTA_SMS_TOKEN=secreto node kuenta-sms-relais.js', laeuft: 'Relé SMS de Kuenta en marcha en {0}  (POST /sms, GET /status)', gesendet: 'SMS a {0} enviado ({1} caracteres)', fehler: 'SMS a {0} fallido: {1}' },
};
function sprache() {
  const set = String(process.env.KUENTA_LANG || '').toLowerCase().slice(0, 2);
  if (TEXTE[set]) return set;
  let loc = '';
  try { loc = Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch { /* ignore */ }
  loc = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || loc).toLowerCase();
  return loc.startsWith('de') ? 'de' : loc.startsWith('es') ? 'es' : 'en';
}
const L = (key, ...werte) => TEXTE[sprache()][key].replace(/\{(\d)\}/g, (m, i) => werte[i]);

// GSM default alphabet (7 bit); other characters need Unicode SMS (70 instead of 160 characters)
const GSM7 = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€');

function gammuArgs(befehl, nummer, text, gammurc) {
  const unicode = [...text].some(c => !GSM7.has(c));
  const args = [];
  if (gammurc && !/smsd-inject/.test(befehl)) args.push('-c', gammurc);
  if (!/smsd-inject/.test(befehl)) args.push('sendsms');
  args.push('TEXT', nummer, '-len', String(text.length), '-text', text);
  if (unicode) args.push('-unicode');
  if (gammurc && /smsd-inject/.test(befehl)) args.unshift('-c', gammurc);
  return args;
}

function erstelleServer({ token, befehl = 'gammu', vorArgs = [], gammurc = '', log = console.log } = {}) {
  if (!token) throw new Error(L('fehltToken'));
  const tokenBuf = Buffer.from(token);
  let warteschlange = Promise.resolve();   // the modem can only send one SMS at a time
  const antwort = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') return antwort(res, 200, { ok: true, dienst: 'kuenta-sms-relais' });
    if (req.method !== 'POST' || req.url !== '/sms') return antwort(res, 404, { fehler: 'Unbekannte Adresse. Erwartet: POST /sms' });
    const t = Buffer.from(String(req.headers['x-token'] || ''));
    if (t.length !== tokenBuf.length || !crypto.timingSafeEqual(t, tokenBuf)) return antwort(res, 401, { fehler: 'Token falsch' });
    let roh = '';
    req.on('data', d => { roh += d; if (roh.length > 20000) req.destroy(); });
    req.on('end', () => {
      let b;
      try { b = JSON.parse(roh); } catch { return antwort(res, 400, { fehler: 'Inhalt ist kein JSON' }); }
      const nummer = String(b.nummer || '').trim(); const text = String(b.text || '');
      if (!/^\+?[1-9]\d{7,14}$/.test(nummer)) return antwort(res, 400, { fehler: 'Ungültige Rufnummer' });
      if (!text.trim()) return antwort(res, 400, { fehler: 'Kein Text' });
      warteschlange = warteschlange.then(() => new Promise(done => {
        execFile(befehl, [...vorArgs, ...gammuArgs(befehl, nummer, text, gammurc)], { timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
          if (err) { log(L('fehler', nummer, (stderr || err.message).trim())); antwort(res, 502, { fehler: `Versand fehlgeschlagen: ${(stderr || err.message).trim().slice(0, 300)}` }); }
          else { log(L('gesendet', nummer, text.length)); antwort(res, 200, { ok: true, ausgabe: String(stdout).trim().slice(-300) }); }
          done();
        });
      }));
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3790), host = process.env.HOST || '0.0.0.0';
  let srv;
  try { srv = erstelleServer({ token: process.env.KUENTA_SMS_TOKEN, befehl: process.env.KUENTA_SMS_BEFEHL || 'gammu', gammurc: process.env.KUENTA_SMS_GAMMURC || '' }); }
  catch (e) { console.error(e.message + ' ' + L('beispiel')); process.exit(1); }
  srv.listen(port, host, () => console.log(L('laeuft', `http://${host}:${port}`)));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { srv.close(); process.exit(0); });
}

module.exports = { erstelleServer, gammuArgs, GSM7 };
