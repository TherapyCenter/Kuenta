'use strict';
// Tests: reminders of vehicle due dates by email and SMS, SMS gateway, SMS relay
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-erinnerung-'));
process.env.KUENTAPOS_DATA = tmp;

const dbm = require('../server/db');
const L = require('../server/lib');
const SMS = require('../server/pro/sms');
const LIZENZ = require('../server/lizenz');
const ER = require('../server/erinnerung');
const FI = require('../server/api/finanzen');
const RELAIS = require('../installer/sms-relais/kuentapos-sms-relais');

test.after(() => { dbm.closeAll(); fs.rmSync(tmp, { recursive: true, force: true }); });

// test gateway: remembers the requests, answers with status
function gateway(status = 200) {
  const anfragen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => { anfragen.push({ method: req.method, url: req.url, headers: req.headers, body: b }); res.writeHead(status); res.end(status === 200 ? '{"ok":true}' : 'kaputt'); });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, anfragen, url: `http://127.0.0.1:${srv.address().port}` })));
}
// test mail server (accepts everything)
function mailserver() {
  const mails = [];
  const srv = net.createServer(sock => {
    sock.write('220 test\r\n'); let data = false; let buf = '';
    sock.on('data', d => {
      buf += d.toString();
      if (data) { if (buf.includes('\r\n.\r\n')) { mails.push(buf); data = false; buf = ''; sock.write('250 ok\r\n'); } return; }
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^EHLO/.test(line)) sock.write('250 test\r\n');
        else if (/^MAIL|^RCPT/.test(line)) sock.write('250 ok\r\n');
        else if (/^DATA/.test(line)) { sock.write('354 go\r\n'); data = true; }
        else if (/^QUIT/.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, mails, port: srv.address().port })));
}

// test license with its own key pair (the real private key is held by the publisher only)
const crypto = require('crypto');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
LIZENZ._pruefschluessel(publicKey.export({ format: 'jwk' }).x);
function lizenz(daten) { const kopf = 'KUENTA1.' + Buffer.from(JSON.stringify(daten)).toString('base64url'); return kopf + '.' + crypto.sign(null, Buffer.from(kopf), privateKey).toString('base64url'); }

test('SMS ohne Pro-Lizenz: gesperrt mit Hinweis', async () => {
  await assert.rejects(() => SMS.senden('+491712345678', 't', { url: 'http://127.0.0.1:1/x' }), e => e.status === 402 && e.code === 'PRO');
  await assert.rejects(() => ER.senden({ feld: 'HU', von: L.today(), bis: L.today(), kanal: 'sms' }), e => e.status === 402);
  LIZENZ.einspielen(lizenz({ v: 1, id: 't1', kunde: 'Autohaus Test', funktionen: ['pro'], ausgestellt: L.today(), bis: null }));
  assert.ok(LIZENZ.hat('sms'));
});

const HU = L.addDays(L.today(), 10);
test('Grunddaten: Fahrzeuge mit fälliger HU', () => {
  const d = dbm.get();
  d.prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Autohaus Test', TELEFON='0221 123456', LAND='DE'").run();
  const kunde = (id, name, mobil, email, extra = '') => d.prepare(`INSERT INTO KUNDEN (KUNID, NUMMER, ANREDE, NAME, MOBIL, TELEFON, EMAIL${extra ? ', KEINEERINNERUNG' : ''}) VALUES (?,?,?,?,?,?,?${extra ? ', 1' : ''})`).run(id, 10000 + id, 'Herr', name, mobil, '0221 9999', email);
  kunde(1, 'Müller', '0171 2345678', 'mueller@example.org');
  kunde(2, 'Ohne', null, null);
  kunde(3, 'Abgemeldet', '0172 1111111', 'nein@example.org', 'x');
  for (const [id, kz, kun] of [[1, 'K-AB 123', 1], [2, 'K-CD 456', 2], [3, 'K-EF 789', 3]]) {
    d.prepare("INSERT INTO FAHRZEUGE (FAHR_ID, KENNZEICHEN, MARKE, MODELL, HU) VALUES (?,?, 'VW', 'Golf', ?)").run(id, kz, HU);
    d.prepare('INSERT INTO KUNDEN_FAHRZEUGE (KUNID, FAHRID) VALUES (?,?)').run(kun, id);
  }
});

test('Rufnummern: internationales Format und Mobilnummern', () => {
  assert.strictEqual(SMS.nummer('0171 234 56 78'), '+491712345678');
  assert.strictEqual(SMS.nummer('0049 171/2345678'), '+491712345678');
  assert.strictEqual(SMS.nummer('+43 664 1234567'), '+436641234567');
  assert.strictEqual(SMS.nummer('abc'), null);
  assert.ok(SMS.istMobil('+491712345678'));
  assert.ok(!SMS.istMobil('+492211234567'));                 // landline Cologne
  assert.strictEqual(SMS.mobilnummer('', '0221 123456', '0151-12345678'), '+4915112345678');
  assert.strictEqual(SMS.mobilnummer('0221 123456'), null);
});

test('SMS-Gateway: JSON, Formular, Anmeldung, Fehler', async () => {
  const g = await gateway();
  try {
    await SMS.senden('0171 2345678', 'Grüße "Test"', { url: g.url + '/send', methode: 'POST', format: 'json', body: '{"to":"{nummer}","msg":"{text}"}', header: 'X-Token: abc', benutzer: 'u', passwort: 'p', absender: '' });
    const a = g.anfragen[0];
    assert.deepStrictEqual(JSON.parse(a.body), { to: '+491712345678', msg: 'Grüße "Test"' });
    assert.strictEqual(a.headers['x-token'], 'abc');
    assert.strictEqual(a.headers.authorization, 'Basic ' + Buffer.from('u:p').toString('base64'));
    assert.match(a.headers['content-type'], /json/);
    await SMS.senden('+491712345678', 'a&b ü', { url: g.url + '/s', methode: 'POST', format: 'form', body: 'to={nummer_ohne_plus}&text={text}&from={absender}', header: '', benutzer: '', absender: 'Werkstatt' });
    assert.strictEqual(g.anfragen[1].body, 'to=491712345678&text=a%26b%20%C3%BC&from=Werkstatt');
    await SMS.senden('+491712345678', 'x y', { url: g.url + '/get?n={nummer}&t={text}', methode: 'GET', header: '', benutzer: '' });
    assert.strictEqual(g.anfragen[2].url, '/get?n=%2B491712345678&t=x%20y');
  } finally { g.srv.close(); }
  const kaputt = await gateway(500);
  try { await assert.rejects(() => SMS.senden('+491712345678', 't', { url: kaputt.url, methode: 'POST', body: '{}', header: '', benutzer: '' }), /Fehler 500/); }
  finally { kaputt.srv.close(); }
  await assert.rejects(() => SMS.senden('+491712345678', 't', { url: 'http://127.0.0.1:1/x', methode: 'POST', body: '{}', header: '', benutzer: '' }), /nicht erreichbar/);
});

test('Platzhalter im Erinnerungstext', () => {
  const r = FI.fahrzeugtermine({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30) }).rows.find(x => x.FAHR_ID === 1);
  const t = ER.platzhalter(ER.VORLAGE.sms, r, 'HU', '');
  assert.strictEqual(t, `Autohaus Test: Für Ihr Fahrzeug K-AB 123 ist am ${HU.slice(8, 10)}.${HU.slice(5, 7)}.${HU.slice(0, 4)} die Hauptuntersuchung (HU) fällig. Termin unter 0221 123456.`);
  assert.match(ER.platzhalter(ER.VORLAGE.text, r, 'HU', ''), /^Sehr geehrter Herr Müller,\n\nfür Ihr Fahrzeug VW Golf/);
});

test('Erinnerung per SMS: Versand, Überspringen, Protokoll', async () => {
  const g = await gateway();
  L.setSw('sms.url', g.url + '/sms'); L.setSw('sms.body', '{"nummer":"{nummer}","text":"{text}"}'); L.setSw('sms.format', 'json');
  try {
    const r = await ER.senden({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30), fahrids: [1, 2, 3], kanal: 'sms', user: 'Test' });
    assert.strictEqual(r.gesendet, 1);
    assert.deepStrictEqual(r.uebersprungen.map(u => u.grund).sort(), ['keine Mobilnummer', 'möchte keine Erinnerungen']);
    assert.strictEqual(JSON.parse(g.anfragen[0].body).nummer, '+491712345678');
    const rows = FI.fahrzeugtermine({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30) }).rows;
    assert.match(rows.find(x => x.FAHR_ID === 1).ERINNERT, / · sms$/);
    assert.strictEqual(rows.find(x => x.FAHR_ID === 2).ERINNERT, null);
    // service is a different due date: the HU reminder does not apply there
    const p = L.db().prepare("SELECT COUNT(*) n FROM SW_ERINNERUNGEN WHERE KANAL='sms' AND STATUS='gesendet' AND ART='HU'").get().n;
    assert.strictEqual(p, 1);
  } finally { g.srv.close(); }
  // gateway gone: error logged, sending stops
  const r2 = await ER.senden({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30), fahrids: [1], kanal: 'sms' });
  assert.strictEqual(r2.gesendet, 0); assert.ok(r2.abgebrochen); assert.match(r2.fehler[0].fehler, /nicht erreichbar/);
});

test('Erinnerung per E-Mail über SMTP', async () => {
  const m = await mailserver();
  L.setSw('smtp.host', '127.0.0.1'); L.setSw('smtp.port', String(m.port)); L.setSw('smtp.sicherheit', 'none'); L.setSw('smtp.absender', 'info@autohaus-test.de');
  try {
    const r = await ER.senden({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30), fahrids: [1, 2, 3], kanal: 'email' });
    assert.strictEqual(r.gesendet, 1);
    assert.strictEqual(m.mails.length, 1);
    assert.match(m.mails[0], /To: mueller@example.org/);
    assert.strictEqual(L.db().prepare("SELECT COUNT(*) n FROM SW_MAILS WHERE BEZUG='ERINNERUNG' AND STATUS='gesendet'").get().n, 1);
  } finally { m.srv.close(); }
});

test('Gedruckte Erinnerungsschreiben werden protokolliert', () => {
  const r = ER.briefeProtokollieren({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30), fahrids: [2] });
  assert.strictEqual(r.anzahl, 1);
  const row = FI.fahrzeugtermine({ feld: 'HU', von: L.today(), bis: L.addDays(L.today(), 30) }).rows.find(x => x.FAHR_ID === 2);
  assert.match(row.ERINNERT, / · brief$/);
});

test('SMS-Relais: Token, Aufruf von gammu, Unicode', async () => {
  const stub = path.join(tmp, 'gammu-stub.js'); const aufrufe = path.join(tmp, 'aufrufe.json');
  fs.writeFileSync(stub, `require('fs').appendFileSync(${JSON.stringify(aufrufe)}, JSON.stringify(process.argv.slice(2)) + '\\n'); console.log('OK');`);
  const srv = RELAIS.erstelleServer({ token: 'geheim', befehl: process.execPath, vorArgs: [stub], log: () => {} });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const post = (body, token = 'geheim') => fetch(url + '/sms', { method: 'POST', headers: { 'X-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.strictEqual((await post({ nummer: '+491712345678', text: 'x' }, 'falsch')).status, 401);
    assert.strictEqual((await post({ nummer: '12', text: 'x' })).status, 400);
    assert.strictEqual((await post({ nummer: '+491712345678', text: 'HU fällig – Grüße' })).status, 200);
    assert.strictEqual((await post({ nummer: '+491712345678', text: 'Gruß 🚗' })).status, 200);
    const a = fs.readFileSync(aufrufe, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(a[0].slice(0, 4), ['sendsms', 'TEXT', '+491712345678', '-len']);
    assert.ok(a[0].includes('-unicode'), 'Gedankenstrich ist kein GSM-Zeichen');
    assert.ok(a[1].includes('-unicode'));
    assert.deepStrictEqual(RELAIS.gammuArgs('gammu', '+49171', 'Grüße ß', ''), ['sendsms', 'TEXT', '+49171', '-len', '7', '-text', 'Grüße ß']);
    assert.deepStrictEqual(RELAIS.gammuArgs('gammu-smsd-inject', '+49171', 'Hallo', '/etc/gammurc'), ['-c', '/etc/gammurc', 'TEXT', '+49171', '-len', '5', '-text', 'Hallo']);
    assert.strictEqual((await fetch(url + '/status')).status, 200);
  } finally { srv.close(); }
});
