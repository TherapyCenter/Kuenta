'use strict';
// Tests: WhatsApp Business and Telegram add-ons (documents, "vehicle ready", reminders, connecting customers)
// against a simulated WhatsApp Cloud API and Telegram Bot API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-messenger-'));
process.env.KUENTAPOS_DATA = tmp;

const dbm = require('../server/db');
const L = require('../server/lib');
const LIZENZ = require('../server/lizenz');
const WA = require('../server/pro/whatsapp');
const TG = require('../server/pro/telegram');
const NR = require('../server/nachrichten');
const ER = require('../server/erinnerung');
const G = require('../server/api/generic');

// simulated Meta and Telegram servers in one
const anfragen = []; const updates = []; let waFehler = false;
const srv = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('latin1');
    const a = { method: req.method, url: req.url, headers: req.headers, body, json: /json/.test(req.headers['content-type'] || '') ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : null };
    anfragen.push(a);
    const send = (status, o) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/v21.0/PNID/')) {
      if (req.headers.authorization !== 'Bearer WATOKEN') return send(401, { error: { code: 190, message: 'Invalid OAuth access token' } });
      if (req.url.endsWith('/media')) return send(200, { id: 'MEDIA1' });
      if (waFehler) return send(400, { error: { code: 131026, message: 'Message undeliverable', error_data: { details: 'Empfänger hat kein WhatsApp' } } });
      return send(200, { messages: [{ id: 'wamid.' + anfragen.length }] });
    }
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
    if (!m || m[1] !== 'TGTOKEN') return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    if (m[2] === 'getMe') return send(200, { ok: true, result: { id: 1, username: 'werkstatt_bot', first_name: 'Werkstatt' } });
    if (m[2] === 'getUpdates') return send(200, { ok: true, result: updates.splice(0) });
    return send(200, { ok: true, result: { message_id: anfragen.length } });
  });
});
const letzte = (teil) => anfragen.filter(a => a.url.includes(teil)).pop();

test.before(() => new Promise(r => srv.listen(0, '127.0.0.1', () => {
  process.env.KUENTAPOS_WHATSAPP_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.KUENTAPOS_TELEGRAM_URL = `http://127.0.0.1:${srv.address().port}`;
  r();
})));
test.after(() => { srv.close(); dbm.closeAll(); fs.rmSync(tmp, { recursive: true, force: true }); });

// test license with its own key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
LIZENZ._pruefschluessel(publicKey.export({ format: 'jwk' }).x);
const lizenz = d => { const kopf = 'KUENTA1.' + Buffer.from(JSON.stringify(d)).toString('base64url'); return kopf + '.' + crypto.sign(null, Buffer.from(kopf), privateKey).toString('base64url'); };

const HU = L.addDays(L.today(), 10);
test('Grunddaten', () => {
  const d = dbm.get();
  d.prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Autohaus Test', TELEFON='0221 123456', LAND='DE'").run();
  d.prepare("INSERT INTO KUNDEN (KUNID, NUMMER, ANREDE, VORNAME, NAME, MOBIL) VALUES (1, 10001, 'Herr', 'Hans', 'Müller', '0171 2345678')").run();
  d.prepare("INSERT INTO KUNDEN (KUNID, NUMMER, NAME, TELEFON) VALUES (2, 10002, 'Festnetz', '0221 99999')").run();
  d.prepare('INSERT INTO FAHRZEUGE (FAHR_ID, KENNZEICHEN, MARKE, MODELL, HU) VALUES (1, ?, ?, ?, ?)').run('K-AB 123', 'VW', 'Golf', HU);
  d.prepare('INSERT INTO KUNDEN_FAHRZEUGE (KUNID, FAHRID) VALUES (1, 1)').run();
  d.prepare("INSERT INTO AUFTRAEGE (AUFTRAGID, AUFTRAGNUMMER, KUNID, KUNNAME, FAHRKENNZEICHEN, DATUM) VALUES (1, 5001, 1, 'Müller', 'K-AB 123', ?)").run(L.today());
  d.prepare("INSERT INTO AUFTRAEGE (AUFTRAGID, AUFTRAGNUMMER, KUNID, KUNNAME, FAHRKENNZEICHEN, DATUM) VALUES (2, 5002, 2, 'Festnetz', 'K-XY 1', ?)").run(L.today());
});

test('ohne Lizenz: gesperrt mit Pro-Hinweis', async () => {
  L.setSw('whatsapp.nummerid', 'PNID'); L.setSw('whatsapp.token', 'WATOKEN'); L.setSw('telegram.token', 'TGTOKEN');
  await assert.rejects(() => WA.test('+491712345678'), e => e.status === 402 && e.code === 'PRO');
  await assert.rejects(() => TG.link(1), e => e.status === 402);
  await assert.rejects(() => NR.fertigSenden({ auftragid: 1, kanal: 'whatsapp', an: '+491712345678' }), e => e.status === 402);
  assert.deepStrictEqual(await TG.abholen(), { neu: 0 });   // the background job does nothing without license
  assert.strictEqual(anfragen.length, 0);
});

test('einzelne Add-ons: WhatsApp und Telegram ohne SMS', () => {
  LIZENZ.einspielen(lizenz({ v: 1, id: 't1', kunde: 'Autohaus Test', funktionen: ['whatsapp', 'telegram'], ausgestellt: L.today(), bis: null }));
  assert.ok(LIZENZ.hat('whatsapp') && LIZENZ.hat('telegram'));
  assert.ok(!LIZENZ.hat('sms'));
  const k = NR.kanaele();
  assert.deepStrictEqual([k.whatsapp.lizenz, k.telegram.lizenz, k.sms.lizenz], [true, true, false]);
  assert.ok(k.whatsapp.eingerichtet && k.telegram.eingerichtet);
});

test('WhatsApp: Fahrzeug fertig mit Vorlage', async () => {
  const v = NR.fertigVorschau(1);
  assert.strictEqual(v.empfaenger.whatsapp, '+491712345678');
  assert.match(v.text, /K-AB 123/);
  const r = await NR.fertigSenden({ auftragid: 1, kanal: 'whatsapp', an: v.empfaenger.whatsapp, benutzer: 'Anna' });
  assert.strictEqual(r.an, '+491712345678');
  const a = letzte('/messages');
  assert.strictEqual(a.headers.authorization, 'Bearer WATOKEN');
  assert.strictEqual(a.json.to, '491712345678');
  assert.strictEqual(a.json.template.name, 'fahrzeug_fertig');
  assert.strictEqual(a.json.template.language.code, 'de');
  assert.deepStrictEqual(a.json.template.components[0].parameters.map(p => p.text), ['Hans Müller', 'K-AB 123', 'Autohaus Test', '0221 123456']);
  const log = dbm.get().prepare('SELECT * FROM SW_NACHRICHTEN ORDER BY ID DESC').get();
  assert.strictEqual(log.KANAL, 'whatsapp'); assert.strictEqual(log.STATUS, 'gesendet'); assert.strictEqual(log.BEZUG, 'auftrag'); assert.strictEqual(log.BENUTZER, 'Anna');
});

test('WhatsApp: Beleg als PDF (Upload, dann Vorlage mit Dokument)', async () => {
  const pdf = Buffer.from('%PDF-1.4 test');
  await NR.belegSenden({ typ: 'auftrag', id: 1, kanal: 'whatsapp', an: '0171 2345678', pdf: { buf: pdf, name: 'Auftrag_5001.pdf' } });
  const up = letzte('/media');
  assert.match(up.headers['content-type'], /multipart\/form-data/);
  assert.ok(up.body.includes('Auftrag_5001.pdf') && up.body.includes('%PDF-1.4 test'));
  const a = letzte('/messages');
  assert.strictEqual(a.json.template.name, 'beleg');
  assert.deepStrictEqual(a.json.template.components[0], { type: 'header', parameters: [{ type: 'document', document: { id: 'MEDIA1', filename: 'Auftrag_5001.pdf' } }] });
  assert.deepStrictEqual(a.json.template.components[1].parameters.map(p => p.text), ['Hans Müller', 'Auftrag', '5001', 'Autohaus Test']);
  assert.strictEqual(dbm.get().prepare('SELECT GEDRUCKT FROM AUFTRAEGE WHERE AUFTRAGID=1').get().GEDRUCKT, 1);
});

test('WhatsApp: Fehler von Meta wird gemeldet und protokolliert', async () => {
  waFehler = true;
  await assert.rejects(() => NR.fertigSenden({ auftragid: 1, kanal: 'whatsapp', an: '+491712345678' }), /WhatsApp meldet Fehler 131026: Empfänger hat kein WhatsApp/);
  waFehler = false;
  const log = dbm.get().prepare('SELECT * FROM SW_NACHRICHTEN ORDER BY ID DESC').get();
  assert.strictEqual(log.STATUS, 'Fehler');
  await assert.rejects(() => NR.fertigSenden({ auftragid: 2, kanal: 'whatsapp', an: '' }), /keine Mobilnummer/);
  await assert.rejects(() => NR.fertigSenden({ auftragid: 1, kanal: 'sms', an: '+491712345678' }), e => e.status === 402);
});

let code;
test('Telegram: Kunde verbindet sich über den Link', async () => {
  await assert.rejects(() => NR.fertigSenden({ auftragid: 1, kanal: 'telegram' }), /noch nicht mit Telegram verbunden/);
  const l = await TG.link(1);
  assert.strictEqual(l.bot, 'werkstatt_bot');
  assert.ok(!l.verbunden);
  code = new URL(l.link).searchParams.get('start');
  assert.match(l.link, /^https:\/\/t\.me\/werkstatt_bot\?start=k[\w-]+$/);
  assert.strictEqual((await TG.link(1)).link, l.link);   // the code stays the same
  updates.push({ update_id: 41, message: { chat: { id: 777, type: 'private' }, from: { first_name: 'Hans', username: 'hansm' }, text: '/start falsch' } });
  updates.push({ update_id: 42, message: { chat: { id: 777, type: 'private' }, from: { first_name: 'Hans', username: 'hansm' }, text: '/start ' + code } });
  assert.deepStrictEqual(await TG.abholen(), { neu: 1 });
  const k = dbm.get().prepare('SELECT TELEGRAM_CHATID, TELEGRAM_NAME FROM KUNDEN WHERE KUNID=1').get();
  assert.deepStrictEqual({ ...k }, { TELEGRAM_CHATID: '777', TELEGRAM_NAME: 'Hans (@hansm)' });
  assert.strictEqual(L.sw('telegram.offset'), '43');
  const antworten = anfragen.filter(a => a.url.endsWith('/sendMessage')).map(a => a.json.text);
  assert.match(antworten[0], /nicht \(mehr\) gültig/);
  assert.match(antworten[1], /Willkommen!.*Autohaus Test/);
  // the customer form must not overwrite the connection
  G.saveRec('kunden', 1, { NAME: 'Müller', TELEGRAM_CHATID: null, TELEGRAM_NAME: null }, null);
  assert.strictEqual(dbm.get().prepare('SELECT TELEGRAM_CHATID FROM KUNDEN WHERE KUNID=1').get().TELEGRAM_CHATID, '777');
});

test('Telegram: Fahrzeug fertig, Beleg und Erinnerung', async () => {
  await NR.fertigSenden({ auftragid: 1, kanal: 'telegram', text: 'Ihr Golf K-AB 123 ist fertig.' });
  let a = letzte('/sendMessage');
  assert.deepStrictEqual([a.json.chat_id, a.json.text], ['777', 'Ihr Golf K-AB 123 ist fertig.']);
  await NR.belegSenden({ typ: 'auftrag', id: 1, kanal: 'telegram', pdf: { buf: Buffer.from('%PDF-1.4 x'), name: 'Auftrag_5001.pdf' } });
  a = letzte('/sendDocument');
  assert.ok(a.body.includes('Auftrag_5001.pdf') && a.body.includes('777') && a.body.includes('Auftrag Nr. 5001 von Autohaus Test'));
  const r = await ER.senden({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30), fahrids: [1], kanal: 'telegram', user: 'Anna' });
  assert.strictEqual(r.gesendet, 1);
  assert.match(letzte('/sendMessage').json.text, /K-AB 123/);
});

test('WhatsApp: Erinnerung an die HU', async () => {
  const r = await ER.senden({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30), fahrids: [1], kanal: 'whatsapp', user: 'Anna' });
  assert.strictEqual(r.gesendet, 1);
  const a = letzte('/messages');
  assert.strictEqual(a.json.template.name, 'fahrzeugtermin');
  const p = a.json.template.components[0].parameters.map(x => x.text);
  assert.strictEqual(p.length, 6);
  assert.strictEqual(p[1], 'Hauptuntersuchung (HU)'); assert.strictEqual(p[2], 'K-AB 123');
  const e = dbm.get().prepare("SELECT * FROM SW_ERINNERUNGEN WHERE KANAL='whatsapp'").get();
  assert.strictEqual(e.STATUS, 'gesendet');
});

test('Telegram: /stop trennt, falscher Token wird verständlich gemeldet', async () => {
  updates.push({ update_id: 43, message: { chat: { id: 777, type: 'private' }, from: { first_name: 'Hans' }, text: '/stop' } });
  await TG.abholen();
  assert.strictEqual(dbm.get().prepare('SELECT TELEGRAM_CHATID FROM KUNDEN WHERE KUNID=1').get().TELEGRAM_CHATID, null);
  L.setSw('telegram.token', 'FALSCH');
  await assert.rejects(() => TG.bot(), /lehnt den Bot-Token ab/);
});
