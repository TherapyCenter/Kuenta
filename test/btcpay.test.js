'use strict';
// Crypto payments via BTCPay Server, tested against a simulated BTCPay Server (Greenfield API)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-btcpay-'));
process.env.KUENTA_DATA = tmp;

const dbm = require('../server/db');
const L = require('../server/lib');
const VG = require('../server/api/vorgang');
const BTC = require('../server/btcpay');
const PDF = require('../server/pdf/belege');
const KS = require('../server/api/kasse');

// Simulated BTCPay Server: payment requests, invoices, payment methods
function btcpayAttrappe() {
  const st = { requests: {}, invoices: {}, archiviert: [], calls: [], n: 0, darfUngueltig: true };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      st.calls.push(`${req.method} ${req.url}`);
      const j = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'token geheim') return j({ code: 'unauthenticated', message: 'Authentication is required' }, 401);
      const u = new URL(req.url, 'http://x');
      let m;
      if (u.pathname === '/api/v1/stores/S1') return j({ id: 'S1', name: 'Werkstatt-Store', defaultCurrency: 'EUR' });
      if (u.pathname === '/api/v1/stores/S1/payment-methods') return j([{ paymentMethodId: 'BTC-CHAIN', enabled: true }, { paymentMethodId: 'BTC-LN', enabled: true }, { paymentMethodId: 'USDT-CHAIN', enabled: true }, { paymentMethodId: 'LTC-CHAIN', enabled: false }]);
      if (u.pathname === '/api/v1/stores/S1/payment-requests' && req.method === 'POST') {
        const id = 'PR' + (++st.n);
        st.requests[id] = { id, status: 'Pending', ...body };
        return j(st.requests[id]);
      }
      if ((m = /^\/api\/v1\/stores\/S1\/payment-requests\/(\w+)$/.exec(u.pathname))) {
        const pr = st.requests[m[1]]; if (!pr) return j({ message: 'not found' }, 404);
        if (req.method === 'DELETE') { st.archiviert.push(pr.id); pr.status = 'Archived'; return j({}); }
        return j(pr);
      }
      if (u.pathname === '/api/v1/stores/S1/invoices' && req.method === 'POST') {
        const id = 'K' + (++st.n);
        st.invoices[id] = { id, status: 'New', additionalStatus: 'None', checkoutLink: `http://pay/i/${id}`, bezahltMit: null, ...body };
        return j(st.invoices[id]);
      }
      if ((m = /^\/api\/v1\/stores\/S1\/invoices\/(K\d+)$/.exec(u.pathname))) return j(st.invoices[m[1]]);
      if ((m = /^\/api\/v1\/stores\/S1\/invoices\/(K\d+)\/status$/.exec(u.pathname))) {
        if (!st.darfUngueltig) return j({ message: 'forbidden' }, 403);
        st.invoices[m[1]].status = body.status; return j(st.invoices[m[1]]);
      }
      if ((m = /^\/api\/v1\/stores\/S1\/invoices\/(K\d+)\/payment-methods$/.exec(u.pathname))) {
        const inv = st.invoices[m[1]];
        return j([
          { paymentMethodId: 'BTC-CHAIN', destination: 'bc1qtest', paymentLink: 'bitcoin:bc1qtest?amount=0.0002', amount: '0.0002', currency: 'BTC', payments: inv.bezahltMit === 'BTC-CHAIN' ? [{ id: 'x' }] : [] },
          { paymentMethodId: 'BTC-LN', destination: 'lnbc200n1ptest', paymentLink: 'lightning:lnbc200n1ptest', amount: '0.0002', currency: 'BTC', payments: inv.bezahltMit === 'BTC-LN' ? [{ id: 'y' }] : [] },
        ]);
      }
      if (u.pathname === '/api/v1/stores/S1/invoices') {
        const pr = Object.values(st.requests).find(p => p.id === u.searchParams.get('textSearch'));
        return j(pr && pr.status === 'Completed' ? [{ id: 'INV-' + pr.id, status: 'Settled' }] : []);
      }
      if ((m = /^\/api\/v1\/stores\/S1\/invoices\/INV-\w+\/payment-methods$/.exec(u.pathname))) return j([{ paymentMethodId: 'BTC-CHAIN', payments: [] }, { paymentMethodId: 'BTC-LN', payments: [{ id: 'p1' }], totalPaid: '0.0001' }]);
      j({ message: 'unbekannt' }, 404);
    });
  });
  return { srv, st };
}

function pdfText(buf) {
  // text operators from all (compressed) streams as plain text
  const s = buf.toString('latin1'); let out = '';
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g; let m;
  while ((m = re.exec(s))) { let d = Buffer.from(m[1], 'latin1'); try { d = zlib.inflateSync(d); } catch { /* uncompressed */ } out += d.toString('latin1'); }
  return out.replace(/<([0-9a-f]+)> Tj/g, (x, hex) => Buffer.from(hex, 'hex').toString('latin1') + '\n');
}

let srv, st, port;
test.before(async () => {
  ({ srv, st } = btcpayAttrappe());
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  dbm.get();
});
test.after(() => { srv.close(); dbm.closeAll(); fs.rmSync(tmp, { recursive: true, force: true }); });

function rechnung(betrag = 119) {
  const t = VG.template('rechnung');
  return VG.save('rechnung', { kopf: { ...t.kopf, KUNNAME: 'Muster', KUNVORNAME: 'Max' }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Inspektion', MENGE: 1, VKBRUTTO: betrag, MWST: 61 }] }).kopf;
}

test('ausgeschaltet: kein Link, verständliche Meldung, keine Abfrage', async () => {
  const r = rechnung();
  await assert.rejects(BTC.link(r.RECHNUNGID), /ausgeschaltet/);
  assert.deepStrictEqual((await BTC.pruefen()).gebucht, []);
  assert.strictEqual(BTC.linkFuerBeleg(r.RECHNUNGID), null);
});

test('Verbindungstest zeigt Store und aktive Zahlungsarten, falscher Schlüssel wird erklärt', async () => {
  L.setSw('btcpay.url', `http://127.0.0.1:${port}/`); L.setSw('btcpay.storeid', 'S1'); L.setSw('btcpay.apikey', 'falsch');
  await assert.rejects(BTC.test(), /API-Schlüssel ist ungültig/);
  L.setSw('btcpay.apikey', 'geheim');
  const t = await BTC.test();
  assert.strictEqual(t.store, 'Werkstatt-Store');
  assert.deepStrictEqual(t.methoden, ['Bitcoin (on-chain)', 'Lightning', 'USDT (Liquid)']);
});

test('Zahlungslink, PDF mit QR-Code, automatische Buchung', async () => {
  L.setSw('btcpay.aktiv', '1'); L.setSw('btcpay.konto', '1365');
  const r = rechnung(119);
  const a = await BTC.link(r.RECHNUNGID);
  assert.strictEqual(a.link, `http://127.0.0.1:${port}/payment-requests/PR1`);
  assert.strictEqual(a.betrag, 119);
  const pr = st.requests.PR1;
  assert.strictEqual(pr.currency, 'EUR'); assert.strictEqual(pr.amount, 119); assert.strictEqual(pr.allowCustomPaymentAmounts, false);
  assert.match(pr.title, new RegExp(`Rechnung ${r.RECHNUNGNUMMER}`));
  // same amount: the existing link is reused
  assert.strictEqual((await BTC.link(r.RECHNUNGID)).link, a.link);
  assert.strictEqual(Object.keys(st.requests).length, 1);

  const text = pdfText(PDF.vorgangPdf('rechnung', VG.load('rechnung', r.RECHNUNGID)));
  assert.match(text, /Bezahlen mit Bitcoin, Lightning oder USDT/);
  assert.match(text, /payment-requests\/PR1/);

  // not paid yet
  let p = await BTC.pruefen();
  assert.deepStrictEqual(p.gebucht, []);
  // customer pays via Lightning
  pr.status = 'Completed';
  p = await BTC.pruefen();
  assert.strictEqual(p.gebucht.length, 1);
  assert.strictEqual(p.gebucht[0].methode, 'Lightning');
  const d = VG.load('rechnung', r.RECHNUNGID);
  assert.strictEqual(d.offen, 0);
  assert.strictEqual(d.zahlungen[0].BANKNAME, 'BTCPay · Lightning');
  const fibu = L.db().prepare('SELECT SOLL, BETRAG FROM FIBU WHERE RECHID=? AND ZAHLID IS NOT NULL').get(r.RECHNUNGID);
  assert.deepStrictEqual({ ...fibu }, { SOLL: 1365, BETRAG: 119 });
  // do not book a second time
  assert.deepStrictEqual((await BTC.pruefen()).gebucht, []);
  assert.strictEqual(VG.load('rechnung', r.RECHNUNGID).zahlungen.length, 1);
  // paid invoice: no link on the document any more
  assert.strictEqual(BTC.linkFuerBeleg(r.RECHNUNGID), null);
});

test('Teilzahlung per Überweisung: alter Link passt nicht mehr, neuer Link über den Rest', async () => {
  const r = rechnung(200);
  const a = await BTC.link(r.RECHNUNGID);
  VG.addPayment({ RECHNUNGID: r.RECHNUNGID, BETRAG: 50, ZAHLUNGSARTID: 3 });
  assert.strictEqual(BTC.linkFuerBeleg(r.RECHNUNGID), null, 'kein veralteter Betrag auf der PDF');
  const b = await BTC.link(r.RECHNUNGID);
  assert.notStrictEqual(b.link, a.link);
  assert.strictEqual(b.betrag, 150);
  assert.ok(st.archiviert.includes(a.link.split('/').pop()), 'alter Link wird bei BTCPay archiviert');
});

test('anders vollständig bezahlt: Link wird bei BTCPay archiviert', async () => {
  const r = rechnung(30);
  const a = await BTC.link(r.RECHNUNGID);
  VG.addPayment({ RECHNUNGID: r.RECHNUNGID, BETRAG: 30, ZAHLUNGSARTID: 1 });
  await BTC.pruefen();
  const id = a.link.split('/').pop();
  assert.ok(st.archiviert.includes(id));
  assert.strictEqual(BTC.liste(r.RECHNUNGID)[0].status, 'anders bezahlt');
});

test('Server nicht erreichbar: Fehler wird vermerkt, nichts gebucht', async () => {
  const r = rechnung(10);
  await BTC.link(r.RECHNUNGID);
  L.setSw('btcpay.url', 'http://127.0.0.1:1');
  const p = await BTC.pruefen();
  assert.deepStrictEqual(p.gebucht, []);
  assert.match(p.fehler[0], /nicht erreichbar/);
  assert.match(BTC.liste(r.RECHNUNGID)[0].fehler, /nicht erreichbar/);
  L.setSw('btcpay.url', `http://127.0.0.1:${port}`);
});

test('E-Mail-Vorlage enthält den Zahlungslink vor dem Gruß', async () => {
  const routes = new Map();
  require('../server/routes2')((m, p, fn) => routes.set(`${m} ${p}`, fn), { json: async () => ({}), readBody: async () => Buffer.alloc(0) });
  const r = rechnung(55);
  const a = await BTC.link(r.RECHNUNGID);
  const v = routes.get('GET /api/mail/vorlage/:art/:typ/:id')({ p: { art: 'vorgang', typ: 'rechnung', id: String(r.RECHNUNGID) }, q: {} });
  assert.ok(v.text.includes(`Bitcoin, Lightning oder USDT bezahlen:\n${a.link}\n\nMit freundlichen Grüßen`), v.text);
});

test('Kasse: Verkauf per Lightning, Bon erst nach Bestätigung durch BTCPay', async () => {
  L.setSw('btcpay.url', `http://127.0.0.1:${port}`); L.setSw('kasse.autorechnung', '1');
  const pos = [{ BEZEICHNUNG: 'Scheibenwischer', MENGE: 2, EINZEL: 12.5, MWST: 61 }];
  const k = await BTC.kasseStart({ betrag: 25, text: 'Scheibenwischer' });
  const inv = st.invoices[Object.keys(st.invoices).pop()];
  assert.strictEqual(inv.amount, 25); assert.strictEqual(inv.currency, 'EUR');
  assert.strictEqual(inv.checkout.speedPolicy, 'HighSpeed');
  assert.strictEqual(k.methoden[0].name, 'Lightning', 'Lightning zuerst');
  assert.match(k.methoden[0].link, /^lightning:lnbc/);
  assert.strictEqual(k.methoden[1].link, 'bitcoin:bc1qtest?amount=0.0002');

  assert.strictEqual((await BTC.kasseStatus(k.id)).status, 'offen');
  // not paid yet: no receipt, no invoice
  const reVorher = L.db().prepare('SELECT COUNT(*) n FROM RECHNUNGEN').get().n;
  await assert.rejects(KS.bon({ positionen: pos, zahlart: 'KRYPTO', kryptoid: k.id }), /noch nicht als bezahlt/);
  assert.strictEqual(L.db().prepare('SELECT COUNT(*) n FROM RECHNUNGEN').get().n, reVorher, 'keine Rechnung ohne Zahlung');

  inv.status = 'Processing';
  assert.strictEqual((await BTC.kasseStatus(k.id)).status, 'bestaetigung');
  inv.status = 'Settled'; inv.bezahltMit = 'BTC-LN';
  const s = await BTC.kasseStatus(k.id);
  assert.deepStrictEqual([s.status, s.methode], ['bezahlt', 'Lightning']);

  // different amount than paid: rejected
  await assert.rejects(KS.bon({ positionen: [{ ...pos[0], MENGE: 3 }], zahlart: 'KRYPTO', kryptoid: k.id }), /lautet über 25,00/);
  const b = await KS.bon({ positionen: pos, zahlart: 'KRYPTO', kryptoid: k.id });
  assert.strictEqual(b.bon.ZAHLART, 'KRYPTO'); assert.strictEqual(b.bon.BRUTTO, 25);
  assert.match(b.bon.VERWENDUNG, /Lightning/);
  const re = VG.load('rechnung', b.bon.RECHNUNGID);
  assert.strictEqual(re.offen, 0);
  assert.strictEqual(re.zahlungen[0].ZAHLART, 'Krypto (BTCPay)');
  assert.strictEqual(L.db().prepare('SELECT SOLL FROM FIBU WHERE ZAHLID=?').get(re.zahlungen[0].ID).SOLL, 1365);
  assert.strictEqual(L.db().prepare('SELECT COUNT(*) n FROM KASSENBUCH WHERE RECHID=?').get(b.bon.RECHNUNGID).n, 0, 'nicht ins Kassenbuch');
  // cannot be used a second time
  await assert.rejects(KS.bon({ positionen: pos, zahlart: 'KRYPTO', kryptoid: k.id }), /bereits für einen Bon/);
  // cash balance stays unchanged
  assert.strictEqual(KS.status().krypto, true);
});

test('Kasse: offene Rechnung per Krypto bezahlen', async () => {
  const r = rechnung(80);
  const k = await BTC.kasseStart({ betrag: 80, text: 'Rechnung' });
  st.invoices[Object.keys(st.invoices).pop()].status = 'Settled';
  const b = await KS.bon({ rechnungid: r.RECHNUNGID, betrag: 80, zahlart: 'KRYPTO', kryptoid: k.id });
  assert.strictEqual(b.bon.RECHNUNGID, r.RECHNUNGID);
  assert.strictEqual(VG.load('rechnung', r.RECHNUNGID).offen, 0);
});

test('Kasse: Abbruch setzt die BTCPay-Rechnung ungültig; ohne Recht warnt die Kasse bei späterer Zahlung', async () => {
  const k1 = await BTC.kasseStart({ betrag: 9.99 });
  const inv1 = st.invoices[Object.keys(st.invoices).pop()];
  assert.deepStrictEqual(await BTC.kasseAbbrechen(k1.id), { ungueltig: true });
  assert.strictEqual(inv1.status, 'Invalid');

  st.darfUngueltig = false;
  const k2 = await BTC.kasseStart({ betrag: 4.5 });
  const inv2 = st.invoices[Object.keys(st.invoices).pop()];
  assert.deepStrictEqual(await BTC.kasseAbbrechen(k2.id), { ungueltig: false });
  inv2.status = 'Settled'; // customer pays anyway
  await BTC.pruefen();
  const w = KS.status().kryptoWarnungen;
  assert.strictEqual(w.length, 1); assert.strictEqual(w[0].BETRAG, 4.5);
  await assert.rejects(KS.bon({ positionen: [{ BEZEICHNUNG: 'x', MENGE: 1, EINZEL: 9.99, MWST: 61 }], zahlart: 'KRYPTO', kryptoid: k1.id }), /noch nicht als bezahlt/, 'abgebrochene Zahlung ergibt keinen Bon');
  st.darfUngueltig = true;
});
