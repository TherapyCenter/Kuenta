'use strict';
// License shop: fetch paid add-on orders from the (simulated) BTCPay Server, issue and send them
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-shop-'));
process.env.KUENTAPOS_LIZENZ_HOME = tmp;
process.env.KUENTAPOS_LANG = 'de';   // messages are checked in German
process.env.KUENTAPOS_DATA = path.join(tmp, 'daten');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(path.join(tmp, 'privat.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }));
const X = publicKey.export({ format: 'jwk' }).x;

const SHOP = require('../tools/lizenz/shop');
const { erzeugen } = require('../tools/lizenz/lizenz-werkzeug');
const LIZENZ = require('../server/lizenz');

const jetzt = () => Math.floor(Date.now() / 1000);
const invoices = [];
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const j = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers.authorization !== 'token lesen') return j({ message: 'unauthenticated' }, 401);
  if (u.pathname !== '/api/v1/stores/SHOP/invoices') return j({ message: 'nicht gefunden' }, 404);
  const skip = Number(u.searchParams.get('skip') || 0); const take = Number(u.searchParams.get('take') || 100);
  let l = invoices.filter(i => !u.searchParams.get('status') || i.status === u.searchParams.get('status'));
  if (u.searchParams.get('startDate')) l = l.filter(i => i.createdTime >= Number(u.searchParams.get('startDate')));
  j(l.slice(skip, skip + take));
});
const post = [];
const senden = async (mail, smtp) => { if (senden.kaputt) throw new Error('SMTP nicht erreichbar'); post.push({ mail, smtp }); };
const lauf = (o = {}) => SHOP.abholen({ home: tmp, erzeugen, senden, log: () => {}, ...o });

test.before(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  SHOP.einrichten(tmp);
  const c = JSON.parse(fs.readFileSync(path.join(tmp, 'shop.json'), 'utf8'));
  c.btcpay = { url: `http://127.0.0.1:${srv.address().port}/`, storeId: 'SHOP', apiKey: 'lesen' };
  c.smtp.host = 'smtp.test';
  fs.writeFileSync(path.join(tmp, 'shop.json'), JSON.stringify(c));
});
test.after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('Vorlage ausfüllen ist Pflicht', async () => {
  const anders = path.join(tmp, 'leer'); SHOP.einrichten(anders);
  await assert.rejects(SHOP.abholen({ home: anders, erzeugen, senden }), /Adresse, Store-ID und API-Schlüssel/);
});

test('Artikel und Kunde aus den Point-of-Sale-Daten', () => {
  assert.deepStrictEqual(SHOP.artikelAus({ itemCode: 'sms' }), ['sms']);
  assert.deepStrictEqual(SHOP.artikelAus({ posData: JSON.stringify({ cart: [{ id: 'sms', count: 1 }, { id: 'pro', count: 1 }] }) }), ['sms', 'pro']);
  assert.deepStrictEqual(SHOP.artikelAus({ posData: { cart: { sms: 1 } } }), ['sms']);
  assert.deepStrictEqual(SHOP.kundeAus({ buyerName: ' Werkstatt Huber ', buyerEmail: 'huber@example.de' }), { name: 'Werkstatt Huber', email: 'huber@example.de' });
});

test('erster Lauf beliefert keine alten Zahlungen', async () => {
  invoices.push({ id: 'ALT1', status: 'Settled', createdTime: jetzt() - 86400 * 30, amount: '10', currency: 'EUR', metadata: { itemCode: 'sms', buyerName: 'Alt', buyerEmail: 'alt@example.de' } });
  const r = await lauf();
  assert.strictEqual(r.neu, 0);
  assert.strictEqual(post.length, 0);
});

test('bezahlte Bestellung: gültiger Schlüssel per E-Mail, nur einmal', async () => {
  invoices.push({ id: 'INV1', status: 'Settled', createdTime: jetzt(), amount: '10', currency: 'EUR', metadata: { itemCode: 'sms', buyerName: 'Werkstatt Huber', buyerEmail: 'huber@example.de' } });
  invoices.push({ id: 'INV-OFFEN', status: 'New', createdTime: jetzt(), metadata: { itemCode: 'sms', buyerName: 'X', buyerEmail: 'x@example.de' } });
  invoices.push({ id: 'FREMD', status: 'Settled', createdTime: jetzt(), metadata: { itemCode: 'tshirt', buyerEmail: 'y@example.de' } });

  const probe = await lauf({ probe: true });
  assert.strictEqual(probe.neu, 1); assert.strictEqual(post.length, 0, 'Probe verschickt nichts');
  assert.ok(!fs.readFileSync(path.join(tmp, 'shop-stand.json'), 'utf8').includes('INV1'), 'Probe ändert nichts');

  const r = await lauf();
  assert.deepStrictEqual([r.neu, r.versendet], [1, 1]);
  assert.strictEqual(post.length, 1);
  const { mail, smtp } = post[0];
  assert.strictEqual(mail.to, 'huber@example.de'); assert.strictEqual(smtp.host, 'smtp.test');
  const key = mail.attachments[0].content.toString().trim();
  assert.ok(mail.text.includes(key));
  const d = LIZENZ.pruefen(key, X);
  assert.deepStrictEqual([d.kunde, d.funktionen, d.bis], ['Werkstatt Huber', ['sms'], null]);
  assert.match(fs.readFileSync(path.join(tmp, 'ausgestellt.csv'), 'utf8'), /Werkstatt Huber;huber@example.de;sms;unbefristet;BTCPay INV1/);

  const nochmal = await lauf();
  assert.deepStrictEqual([nochmal.neu, nochmal.versendet], [0, 0]);
  assert.strictEqual(post.length, 1);
});

test('zweites Add-on derselben E-Mail: neuer Schlüssel enthält alle', async () => {
  invoices.push({ id: 'INV2', status: 'Settled', createdTime: jetzt(), amount: '10', currency: 'EUR', metadata: { posData: { cart: [{ id: 'pro' }] }, buyerName: 'Werkstatt Huber', buyerEmail: 'HUBER@example.de' } });
  await lauf();
  const d = LIZENZ.pruefen(post[post.length - 1].mail.attachments[0].content.toString(), X);
  assert.deepStrictEqual(d.funktionen, ['pro'], '"pro" umfasst alles');
});

test('Mailfehler: Lizenz wird nur einmal ausgestellt und beim nächsten Lauf nachgeschickt', async () => {
  invoices.push({ id: 'INV3', status: 'Settled', createdTime: jetzt(), amount: '10', currency: 'EUR', metadata: { itemCode: 'sms', buyerName: 'Autohaus Berg', buyerEmail: 'berg@example.de' } });
  senden.kaputt = true;
  const r = await lauf();
  assert.strictEqual(r.neu, 1); assert.strictEqual(r.versendet, 0); assert.match(r.fehler[0], /erneut versucht/);
  senden.kaputt = false;
  const zeilenVorher = fs.readFileSync(path.join(tmp, 'ausgestellt.csv'), 'utf8').split('\n').length;
  const r2 = await lauf();
  assert.deepStrictEqual([r2.neu, r2.versendet], [0, 1]);
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'ausgestellt.csv'), 'utf8').split('\n').length, zeilenVorher, 'kein zweiter Schlüssel');
  assert.strictEqual(post[post.length - 1].mail.to, 'berg@example.de');
});

test('fehlende Angaben: zur Klärung gemeldet, mit "erledigt" abgehakt', async () => {
  invoices.push({ id: 'INV4', status: 'Settled', createdTime: jetzt(), metadata: { itemCode: 'sms', buyerEmail: 'ohne-name@example.de' } });
  const r = await lauf();
  assert.match(r.offen[0], /INV4: Name der Werkstatt fehlt/);
  SHOP.erledigt(tmp, 'INV4');
  assert.deepStrictEqual((await lauf()).offen, []);
});

test('falscher API-Schlüssel wird erklärt', async () => {
  const f = path.join(tmp, 'shop.json'); const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...c, btcpay: { ...c.btcpay, apiKey: 'falsch' } }));
  await assert.rejects(SHOP.test(tmp), /API-Schlüssel ungültig/);
  fs.writeFileSync(f, JSON.stringify(c));
  assert.deepStrictEqual(await SHOP.test(tmp), { ok: true, rechnungen: 1 });
});
