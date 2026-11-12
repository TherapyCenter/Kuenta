'use strict';
// Austrian tax system: UID check, USt rates, § 11 UStG checks, footer, RKSV (signed receipts, chain, turnover
// counter, start / monthly / collective receipts, DEP export, restore), UVA with FinanzOnline XML, ebInterface.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.KUENTAPOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-at-'));
process.env.KUENTAPOS_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const BK = require('../server/backup');
const NIF = require('../public/js/nif.js');
const RK = require('../server/at/rksv');

test('UID check', () => {
  assert.ok(NIF.atUid('ATU13585627').ok);
  assert.ok(NIF.atUid('atu 1358 5627').ok);
  assert.ok(!NIF.atUid('ATU13585628').ok);
  assert.ok(!NIF.atUid('DE123456789').ok);
});

let rid, kunid;
test('Austria: rates, texts, checks, footer', () => {
  L.setSw('steuer.land', 'AT'); L.setSw('at.rechtsform', 'GmbH'); L.setSw('at.sitz', 'Linz'); L.setSw('at.fn', 'FN 123456a'); L.setSw('at.gericht', 'Landesgericht Linz');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Autohaus Huber GmbH', USTNR='ATU13585627', STEUERNR='46 123/4567', STRASSE='Hauptstraße 1', PLZ='4020', ORT='Linz', LAND='AT', EMAIL='office@example.at', TELEFON='0732 1234', IBAN='AT611904300234573201', BIC='BKAUATWW'").run();
  assert.deepStrictEqual(L.mwstRates(), { 61: 20, 62: 10, 63: 0, 64: 13 });
  assert.strictEqual(L.waehrung(), 'EUR');
  assert.strictEqual(G.lookups().land, 'AT');
  const k = G.saveRec('kunden', null, { NAME: 'Spedition Maier GmbH', ART: 1, STRASSE: 'Industriezeile 5', PLZ: '4020', ORT: 'Linz', LAND: 'AT', EMAIL: 'buchhaltung@example.at', LEITWEGID: '123456' });
  kunid = k.KUNID;
  const t = VG.template('rechnung', { kunid }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, BESTELLNR: '4500012345' }, pos: [
    { POSART: 'L', BEZEICHNUNG: 'Service', MENGE: 1, VK: 100, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Ersatzteil', MENGE: 1, VK: 50, MWST: 64 },
    { POSART: 'A', BEZEICHNUNG: 'Begutachtung § 57a (DP)', MENGE: 1, VK: 30, MWST: 63, DURCHLAUFER: 1 }] });
  assert.strictEqual(r.kopf.GBRUTTO, 120 + 56.5 + 30);
  rid = r.kopf.RECHNUNGID;
  assert.strictEqual(r.lx.land, 'AT');
  assert.strictEqual(r.lx.ustLabel, 'USt');
  assert.ok(r.lx.mentions.some(m => /§ 4 Abs. 3 UStG/.test(m)));
  assert.deepStrictEqual(r.lx.pied, ['UID: ATU13585627', 'St.-Nr.: 46 123/4567', 'GmbH, Sitz Linz', 'Firmenbuch: FN 123456a, Landesgericht Linz']);
  assert.deepStrictEqual(r.lx.warnungen, []);
  // above 10 000 € gross a business customer needs a UID
  assert.ok(require('../server/at').pruefen('rechnung', { GBRUTTO: 12000, KUNART: 1 }, {}).some(w => /10.000 €/.test(w)));
  // PDF with Austrian texts
  const pdf = require('../server/pdf/belege').vorgangPdf('rechnung', VG.load('rechnung', rid));
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
});

test('small business: no USt and its text', () => {
  L.setOpt('Kleinunternehmer', '1');
  assert.strictEqual(L.mwstRates()[61], 0);
  assert.ok(require('../server/at').mentions('rechnung', {}, []).includes('Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.'));
  L.setOpt('Kleinunternehmer', '0');
});

test('RKSV: start receipt, signed chain, turnover counter, cancellation, monthly receipt, DEP, restore', async () => {
  const KS = require('../server/api/kasse');
  const st = await RK.aktivieren({ kassenid: 'KASSE-01' });
  assert.ok(st.aktiv && st.start && st.start.nr === 1);
  assert.match(st.start.qr, /^_R1-AT0_KASSE-01_1_\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}_0,00_0,00_0,00_0,00_0,00_/);
  assert.strictEqual(Buffer.from(st.aeskey, 'base64').length, 32);
  const b1 = await KS.bon({ zahlart: 'BAR', gegeben: 50, positionen: [
    { POSART: 'A', BEZEICHNUNG: 'Scheibenwischer', MENGE: 2, EINZEL: 12, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Kaffee', MENGE: 1, EINZEL: 3.3, MWST: 62 }] });
  assert.ok(b1.at && b1.at.nr === 2 && b1.at.kassenid === 'KASSE-01');
  const teile = b1.at.qr.split('_');
  assert.deepStrictEqual(teile.slice(5, 10), ['24,00', '3,30', '0,00', '0,00', '0,00']);
  assert.strictEqual(RK.zaehlerEntschluesseln(teile[10], 'KASSE-01', '2'), 2730, 'turnover counter in cents');
  // chain: previous signature = first 8 bytes of SHA-256 of the previous JWS
  const start = L.db().prepare('SELECT JWS FROM SW_AT_RKSV WHERE NR=1').get();
  assert.strictEqual(teile[12], crypto.createHash('sha256').update(start.JWS).digest().subarray(0, 8).toString('base64'));
  // the JWS contains exactly the code without the signature value
  const jws = L.db().prepare('SELECT JWS FROM SW_AT_RKSV WHERE NR=2').get().JWS;
  assert.strictEqual(Buffer.from(jws.split('.')[1], 'base64url').toString(), teile.slice(0, 13).join('_'));
  assert.strictEqual(JSON.parse(Buffer.from(jws.split('.')[0], 'base64url')).alg, 'ES256');
  // cancellation: STO marker, negative amounts, the counter goes back
  const s = await KS.storno(b1.bon.ID, {});
  const ts = s.at.qr.split('_');
  assert.strictEqual(ts[10], Buffer.from('STO').toString('base64'));
  assert.strictEqual(ts[5], '-24,00');
  // payment of an invoice at the register: amounts split like the invoice
  const p = await KS.bon({ zahlart: 'BAR', rechnungid: rid, gegeben: 300 });
  assert.deepStrictEqual(p.at.qr.split('_').slice(5, 10), ['120,00', '0,00', '56,50', '30,00', '0,00']);
  // a month later: monthly receipt before the next sale
  L.db().prepare("UPDATE SW_AT_RKSV SET ZEIT='2020-01-15 10:00:00'").run();
  const b3 = await KS.bon({ zahlart: 'BAR', gegeben: 10, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Sicherung', MENGE: 1, EINZEL: 2, MWST: 61 }] });
  const arten = RK.liste().map(e => e.ART).reverse();
  assert.deepStrictEqual(arten, ['START', 'BELEG', 'STORNO', 'BELEG', 'MONAT', 'BELEG']);
  assert.ok(b3.at.nr === 6);
  let v = RK.pruefen();
  assert.ok(v.ok, v.fehler.join(', '));
  // manipulation is detected
  const d = L.db(); const e2 = d.prepare('SELECT * FROM SW_AT_RKSV WHERE NR=2').get();
  d.prepare('UPDATE SW_AT_RKSV SET BETRAEGE=? WHERE NR=2').run('[2500,330,0,0,0]');
  v = RK.pruefen();
  assert.ok(!v.ok && v.fehler.some(f => /Beleg 2: Beträge/.test(f)));
  d.prepare('UPDATE SW_AT_RKSV SET BETRAEGE=? WHERE NR=2').run(e2.BETRAEGE);
  // DEP export
  const dep = JSON.parse(RK.dep().buffer.toString('utf8'));
  assert.strictEqual(dep['Belege-Gruppe'][0]['Belege-kompakt'].length, 6);
  // restoring an older backup keeps all receipts
  const backup = BK.createBackup({});
  await KS.bon({ zahlart: 'BAR', gegeben: 5, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Lampe', MENGE: 1, EINZEL: 4, MWST: 61 }] });
  BK.restoreBackup(backup.buffer);
  assert.strictEqual(RK.liste().length, 7, 'receipt made after the backup is kept');
  assert.ok(RK.pruefen().ok);
});

test('RKSV: failure of the signature device and collective receipt, A-Trust', async () => {
  const KS = require('../server/api/kasse');
  L.setSw('at.rksv.signatur', 'atrust'); L.setSw('at.rksv.atrust.user', 'u123'); L.setSw('at.rksv.atrust.pw', 'pw');
  let online = false; const calls = [];
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  RK._setTransporte(async (method, url, body) => {
    calls.push({ method, url, body });
    if (!online) throw new Error('offline');
    if (url.endsWith('/Certificate')) return { Signaturzertifikat: 'MIIB', Zertifizierungsstellen: [], ZertifikatsseriennummerHex: '5a3f2b1c' };
    const input = `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(body.jws_payload).toString('base64url')}`;
    return { result: `${input}.${crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}` };
  });
  const a = await KS.bon({ zahlart: 'BAR', gegeben: 5, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Clip', MENGE: 1, EINZEL: 1, MWST: 61 }] });
  assert.ok(a.at.ausfall);
  assert.ok(a.at.qr.endsWith('_' + Buffer.from(RK.AUSFALL).toString('base64')));
  online = true;
  const b = await KS.bon({ zahlart: 'BAR', gegeben: 5, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Clip', MENGE: 1, EINZEL: 1, MWST: 61 }] });
  assert.ok(!b.at.ausfall);
  assert.match(b.at.qr, /^_R1-AT1_KASSE-01_\d+_.*_5a3f2b1c_/);
  const arten = RK.liste({ limit: 3 }).map(e => e.ART).reverse();
  assert.deepStrictEqual(arten, ['BELEG', 'SAMMEL', 'BELEG']);
  const sign = calls.find(c => c.url.endsWith('/u123/Sign/JWS') && c.body);
  assert.strictEqual(sign.body.password, 'pw');
  assert.match(calls.find(c => c.url.endsWith('/Certificate')).url, /^https:\/\/hs-abnahme\.a-trust\.at\/asignrkonline\/v2\/u123\/Certificate$/);
  RK._setTransporte(null);
  L.setSw('at.rksv.signatur', 'test');
});

test('UVA: Kennzahlen and FinanzOnline XML', () => {
  L.db().prepare("UPDATE FIRMENDATEN SET STEUERNR='461234567'").run();
  const von = '2000-01-01', bis = '2999-12-31';
  const r = require('../server/at/uva').calcular({ von, bis });
  // invoice 100 at 20 % + 50 at 13 % + DP 30; register sales go through invoices as well (gross, 20 %)
  assert.ok(r.kz['006'] >= 50);
  assert.strictEqual(r.kz['000'], Math.round((r.kz['022'] + r.kz['029'] + r.kz['006'] + r.kz['011'] + r.kz['017'] + r.kz['016'] + r.kz['020']) * 100) / 100);
  assert.ok(r.durchlaufend >= 30);
  const x = require('../server/at/uva').xml({ von: '2026-01-01', bis: '2026-12-31' });
  const s = x.buffer.toString('utf8');
  assert.match(s, /<ERKLAERUNG art="U30">/);
  assert.match(s, /<IDENTIFIKATIONSBEGRIFF>461234567<\/IDENTIFIKATIONSBEGRIFF>/);
  assert.match(s, /<ZRVON type="jahrmonat">2026-01<\/ZRVON>/);
});

test('ebInterface 6.1', () => {
  const r = require('../server/at/ebinterface').create(rid);
  assert.deepStrictEqual(r.problems, []);
  assert.match(r.xml, /<Invoice xmlns="http:\/\/www\.ebinterface\.at\/schema\/6p1\/"/);
  assert.match(r.xml, /<InvoiceRecipientsBillerID>123456<\/InvoiceRecipientsBillerID>/);
  // order of the schema ebInterface 6.1: address first, then the ID of the other party; language with 2 letters
  assert.match(r.xml, /<\/Address><InvoiceRecipientsBillerID>123456<\/InvoiceRecipientsBillerID><\/Biller>/);
  assert.match(r.xml, /Language="de"/);
  assert.match(r.xml, /<OrderReference><OrderID>4500012345<\/OrderID><\/OrderReference>/);
  assert.match(r.xml, /<TaxPercent TaxCategoryCode="S">20.00<\/TaxPercent><TaxAmount>20.00<\/TaxAmount>/);
  assert.match(r.xml, /<TaxPercent TaxCategoryCode="S">13.00<\/TaxPercent><TaxAmount>6.50<\/TaxAmount>/);
  assert.match(r.xml, /<TotalGrossAmount>206.50<\/TotalGrossAmount>/);
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  dbm.closeAll();
});
