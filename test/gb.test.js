'use strict';
// UK tax system: VAT number check, pounds, VAT categories, 9-box return (standard, cash, flat rate),
// Xero/QuickBooks/Sage exports, HMRC MTD (OAuth, obligations, submission, fraud prevention headers).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-gb-'));
process.env.KUENTA_LANG = 'de';
process.env.KUENTA_HMRC_CLIENT_ID = 'test-client';
process.env.KUENTA_HMRC_CLIENT_SECRET = 'test-secret';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const NIF = require('../public/js/nif.js');
const VAT = require('../server/gb/vat');
const EX = require('../server/gb/export');
const HM = require('../server/gb/hmrc');

const HEUTE = L.today();
const Q = { von: HEUTE.slice(0, 7) + '-01', bis: HEUTE.slice(0, 7) + '-31' }; // current month

test('UK VAT registration number', () => {
  assert.ok(NIF.gbVat('GB 123 4567 82').ok);
  assert.strictEqual(NIF.gbVat('GB123456782').vrn, '123456782');
  assert.ok(!NIF.gbVat('GB123456789').ok);
  assert.ok(NIF.gbVat('GBGD123').ok);
});

test('German tenant unchanged; switching to the UK changes rates and currency', () => {
  assert.strictEqual(L.mwstRates()[61], 19);
  assert.strictEqual(L.geld(1234.5, 'de-DE'), '1.234,50 €');
  L.setSw('steuer.land', 'GB');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Smith Motors Ltd', USTNR='GB123456782', STRASSE='1 High Street', PLZ='SW1A 1AA', ORT='London', LAND='GB'").run();
  assert.deepStrictEqual(L.mwstRates(), { 61: 20, 62: 5, 63: 0, 64: 0 });
  const lk = G.lookups();
  assert.strictEqual(lk.land, 'GB'); assert.strictEqual(lk.waehrung, 'GBP'); assert.strictEqual(lk.gbRegistrado, true);
  assert.strictEqual(L.geld(1234.5, 'en-GB'), '£1,234.50');
  assert.strictEqual(L.geld(-12, 'en-GB'), '-£12.00');
  assert.strictEqual(require('../server/gb').vrn(), '123456782');
});

let rid;
test('UK invoice: standard, zero-rated and disbursement lines; PDF', () => {
  const k = G.saveRec('kunden', null, { NAME: 'Jones', VORNAME: 'Tom', STRASSE: '2 Mill Lane', PLZ: 'M1 1AA', ORT: 'Manchester', LAND: 'GB', NUMMER: 501 });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  assert.strictEqual(t.kopf.KUNLAND, 'GB');
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0 }, pos: [
    { POSART: 'L', BEZEICHNUNG: 'Full service', MENGE: 1, VK: 100, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'MOT test fee', MENGE: 1, VK: 54.85, MWST: 63, DURCHLAUFER: 1 },
    { POSART: 'A', BEZEICHNUNG: 'Printed manual', MENGE: 1, VK: 20, MWST: 64 }] });
  assert.strictEqual(r.kopf.GBRUTTO, 194.85);
  rid = r.kopf.RECHNUNGID;
  const buf = require('../server/pdf/belege').vorgangPdf('rechnung', VG.load('rechnung', rid));
  assert.ok(buf.length > 1000);
  // purchase invoice with VAT
  L.db().prepare("INSERT INTO SW_EINGANG (LIEFNAME, RECHNUNGSNR, DATUM, NETTO, MWST, BRUTTO, STEUERSATZ) VALUES ('Parts Ltd','P-1',?,50,10,60,20)").run(HEUTE);
});

test('VAT return: standard, cash accounting and flat rate scheme', () => {
  let r = VAT.calcular(Q);
  assert.strictEqual(r.boxes.vatDueSales, 20);
  assert.strictEqual(r.boxes.totalVatDue, 20);
  assert.strictEqual(r.boxes.vatReclaimedCurrPeriod, 10);
  assert.strictEqual(r.boxes.netVatDue, 10);
  assert.strictEqual(r.boxes.totalValueSalesExVAT, 120, 'disbursement is outside the scope');
  assert.strictEqual(r.boxes.totalValuePurchasesExVAT, 50);

  L.setSw('gb.schema', 'cash');
  r = VAT.calcular(Q);
  assert.strictEqual(r.boxes.vatDueSales, 0, 'nothing paid yet');
  VG.addPayment({ RECHNUNGID: rid, BETRAG: 194.85, ZAHLUNGSARTID: 3, DATUM: HEUTE });
  r = VAT.calcular(Q);
  assert.strictEqual(r.boxes.vatDueSales, 20);
  assert.strictEqual(r.boxes.vatReclaimedCurrPeriod, 0, 'purchase not paid');

  L.setSw('gb.schema', 'flat'); L.setSw('gb.flatrate', '8.5');
  r = VAT.calcular(Q);
  assert.strictEqual(r.boxes.vatDueSales, 11.9, '8.5 % of 140 (VAT-inclusive, without disbursement)');
  assert.strictEqual(r.boxes.totalValueSalesExVAT, 140);
  assert.strictEqual(r.boxes.vatReclaimedCurrPeriod, 0);
  L.setSw('gb.schema', 'standard');
});

test('Exports for Xero, QuickBooks, Sage and the VAT journal', () => {
  const x = EX.xeroVentas(Q).buffer.toString('utf8');
  assert.match(x, /^\*ContactName,/);
  assert.match(x, /Full service,1,100,,200,20% \(VAT on Income\)/);
  assert.match(x, /MOT test fee,1,54\.85,,200,No VAT/);
  assert.match(x, /Printed manual,1,20,,200,Zero Rated Income/);
  assert.match(EX.xeroCompras(Q).buffer.toString('utf8'), /Parts Ltd,.*,310,20% \(VAT on Expenses\)/);
  const qb = EX.quickbooks(Q).buffer.toString('utf8');
  assert.match(qb, /Full service,1,100,100\.00,20\.0% S,20\.00,GBP/);
  const sg = EX.sage(Q).buffer.toString('utf8');
  assert.match(sg, /^SI,C501,4000,0,\d\d\/\d\d\/\d{4},\d+,Tom Jones,100\.00,T1,20\.00/m);
  assert.match(sg, /^SI,C501,4000,.*,54\.85,T9,0\.00/m);
  assert.match(sg, /^PI,SUPPLIER,5000,.*,50\.00,T1,10\.00/m);
  assert.match(EX.diario(Q).buffer.toString('utf8'), /Sales invoice,\d+,Tom Jones,,Standard,20\.00,100\.00,20\.00,120\.00/);
});

test('HMRC: connect, obligations, submit with fraud prevention headers, token refresh', async () => {
  const calls = [];
  HM._setTransporte(async (method, url, headers, body) => {
    calls.push({ method, url, headers, body });
    const u = new URL(url);
    if (u.pathname === '/oauth/token') {
      const p = new URLSearchParams(body);
      assert.strictEqual(p.get('client_secret'), 'test-secret');
      return { status: 200, text: JSON.stringify({ access_token: 'AT-' + p.get('grant_type'), refresh_token: 'RT', expires_in: 14400, scope: 'read:vat write:vat' }) };
    }
    if (u.pathname.endsWith('/obligations')) return { status: 200, text: JSON.stringify({ obligations: [{ periodKey: '18A1', start: Q.von, end: Q.bis, due: Q.bis, status: 'O' }] }) };
    if (u.pathname.endsWith('/returns') && method === 'POST') return { status: 201, text: JSON.stringify({ processingDate: '2026-11-10T12:00:00.000Z', formBundleNumber: '256660290587', paymentIndicator: 'DD', chargeRefNumber: 'aCxFaNx0FZsCvyWF' }) };
    return { status: 404, text: '{}' };
  });
  await assert.rejects(() => HM.obligaciones({}), /nicht mit HMRC verbunden/);
  const a = HM.autorizar({ headers: { host: 'localhost:3700' } });
  const u = new URL(a.url);
  assert.strictEqual(u.origin, 'https://test-api.service.hmrc.gov.uk');
  assert.strictEqual(u.searchParams.get('scope'), 'read:vat write:vat');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://localhost:3700/api/gb/oauth/callback');
  await assert.rejects(() => HM.callback({ state: 'falsch', code: 'x' }), /abgelaufen oder ungültig/);
  await HM.callback({ state: u.searchParams.get('state'), code: 'CODE' });
  assert.ok(HM.estado().conectado);

  const client = { screens: [{ width: 1920, height: 1080, scaling: 1.25, colourDepth: 24 }], window: { width: 1400, height: 900 } };
  const obl = await HM.obligaciones({ status: 'O' }, { client, usuario: 'Anna' });
  assert.strictEqual(obl[0].periodKey, '18A1');
  const h = calls[calls.length - 1].headers;
  assert.match(calls[calls.length - 1].url, /\/organisations\/vat\/123456782\/obligations\?/);
  assert.strictEqual(h.Authorization, 'Bearer AT-authorization_code');
  assert.strictEqual(h.Accept, 'application/vnd.hmrc.1.0+json');
  assert.strictEqual(h['Gov-Client-Connection-Method'], 'DESKTOP_APP_DIRECT');
  assert.match(h['Gov-Client-Device-ID'], /^[0-9a-f-]{36}$/);
  assert.match(h['Gov-Client-User-IDs'], /kuenta=Anna/);
  assert.match(h['Gov-Client-Timezone'], /^UTC[+-]\d\d:\d\d$/);
  assert.strictEqual(h['Gov-Client-Screens'], 'width=1920&height=1080&scaling-factor=1.25&colour-depth=24');
  assert.strictEqual(h['Gov-Client-Window-Size'], 'width=1400&height=900');
  assert.match(h['Gov-Client-User-Agent'], /^os-family=.+&os-version=.+/);
  assert.match(h['Gov-Vendor-Version'], /^Kuenta=\d/);
  assert.match(h['Gov-Client-Local-IPs-Timestamp'], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

  await assert.rejects(() => HM.enviar({ periodKey: '18A1', start: Q.von, end: Q.bis }), /bestätigen/);
  const res = await HM.enviar({ periodKey: '18A1', start: Q.von, end: Q.bis, confirmado: true }, { client, usuario: 'Anna' });
  assert.strictEqual(res.formBundleNumber, '256660290587');
  const sent = JSON.parse(calls[calls.length - 1].body);
  assert.deepStrictEqual(sent, { periodKey: '18A1', vatDueSales: 20, vatDueAcquisitions: 0, totalVatDue: 20, vatReclaimedCurrPeriod: 10, netVatDue: 10, totalValueSalesExVAT: 120, totalValuePurchasesExVAT: 50, totalValueGoodsSuppliedExVAT: 0, totalAcquisitionsExVAT: 0, finalised: true });
  assert.strictEqual(HM.estado().enviadas[0].PERIODKEY, '18A1');

  // expired access token: refreshed with the refresh token
  const f = path.join(dbm.DATA_DIR, 'gb', 'token-sandbox.json');
  const tok = JSON.parse(fs.readFileSync(f, 'utf8')); tok.expires_at = Date.now() - 1000; fs.writeFileSync(f, JSON.stringify(tok));
  await HM.obligaciones({}, { client });
  assert.strictEqual(calls[calls.length - 1].headers.Authorization, 'Bearer AT-refresh_token');
  HM._setTransporte(null);
});

test('not VAT registered: no VAT; back to Germany', () => {
  L.setOpt('Kleinunternehmer', '1');
  assert.deepStrictEqual(L.mwstRates(), { 61: 0, 62: 0, 63: 0, 64: 0 });
  assert.strictEqual(VAT.calcular(Q).boxes.vatDueSales, 0);
  L.setOpt('Kleinunternehmer', '0');
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  assert.strictEqual(L.waehrung(), 'EUR');
  dbm.closeAll();
});
