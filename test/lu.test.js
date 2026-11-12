'use strict';
// Luxembourg tax system: VAT number, rates, texts in French and German, footer, franchise, Peppol (9938),
// VAT return by eCDF fields with the eCDF XML.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTAPOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-lu-'));
process.env.KUENTAPOS_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const NIF = require('../public/js/nif.js');
const PP = require('../server/peppol');

test('VAT number', () => {
  assert.deepStrictEqual(NIF.luTva('LU 1502 7442'), { ok: true, nr: '15027442', tva: 'LU15027442' });
  assert.ok(!NIF.luTva('LU15027443').ok);
  assert.ok(!NIF.luTva('BE0123456749').ok);
});

let rid;
test('Luxembourg: rates, texts, footer, Peppol', () => {
  L.setSw('steuer.land', 'LU'); L.setSw('lu.rcs', 'B123456'); L.setSw('lu.autorisation', '10012345/0'); L.setSw('beleg.sprache', 'fr');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Garage Schmit Sàrl', USTNR='LU15027442', STRASSE='Rue de la Gare 1', PLZ='L-1611', ORT='Luxembourg', LAND='LU', EMAIL='info@example.lu', TELEFON='+352 123456', IBAN='LU280019400644750000', BIC='BCEELULL'").run();
  assert.deepStrictEqual(L.mwstRates(), { 61: 17, 62: 8, 63: 0, 64: 14 });
  const k = G.saveRec('kunden', null, { NAME: 'Transports Weber SA', ART: 1, USTID: 'LU20260743', STRASSE: 'Route d\'Arlon 5', PLZ: 'L-8009', ORT: 'Strassen', LAND: 'LU' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, BESTELLNR: 'BC-12' }, pos: [
    { POSART: 'L', BEZEICHNUNG: 'Entretien', MENGE: 2, VK: 80, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Pièce', MENGE: 1, VK: 50, MWST: 64 },
    { POSART: 'A', BEZEICHNUNG: 'Contrôle technique SNCT (DP)', MENGE: 1, VK: 40, MWST: 63, DURCHLAUFER: 1 }] });
  rid = r.kopf.RECHNUNGID;
  assert.strictEqual(r.kopf.GBRUTTO, 187.2 + 57 + 40);
  const d = VG.load('rechnung', rid);
  assert.strictEqual(d.lx.ustLabel, 'TVA');
  assert.deepStrictEqual(d.lx.pied, ['TVA LU15027442', 'RCS B123456', 'Autorisation d\'établissement 10012345/0']);
  assert.ok(d.lx.mentions.some(m => /Débours exposés/.test(m)));
  assert.deepStrictEqual(d.lx.warnungen, []);
  L.setSw('beleg.sprache', 'de');
  assert.ok(VG.load('rechnung', rid).lx.mentions.some(m => /Auslagen im Namen/.test(m)), 'German texts with the document language German');
  assert.ok(require('../server/pdf/belege').vorgangPdf('rechnung', d).subarray(0, 5).toString() === '%PDF-');
  const p = PP.create(rid);
  assert.deepStrictEqual(p.problems, []);
  assert.match(p.xml, /<cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="9938">LU15027442<\/cbc:EndpointID>/);
  assert.match(p.xml, /<cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="9938">LU20260743<\/cbc:EndpointID>/);
});

test('franchise and reverse charge', () => {
  L.setOpt('Kleinunternehmer', '1');
  assert.strictEqual(L.mwstRates()[61], 0);
  assert.ok(require('../server/lu').mentions('rechnung', {}, []).some(m => /Art. 57/.test(m)));
  assert.throws(() => require('../server/lu/tva').berechnen({ von: '2000-01-01', bis: '2999-12-31' }), /jährliche/);
  L.setOpt('Kleinunternehmer', '0');
  const k = G.saveRec('kunden', null, { NAME: 'Autohaus Huber GmbH', ART: 1, USTID: 'ATU13585627', STRASSE: 'Hauptstraße 1', PLZ: '4020', ORT: 'Linz', LAND: 'AT' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, STEUERART: 'REVERSE_CHARGE', BESTELLNR: 'B-1' }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Reparatur', MENGE: 1, VK: 300, MWST: 61 }] });
});

test('VAT return by eCDF fields and XML', () => {
  const T = require('../server/lu/tva');
  const r = T.berechnen({ von: '2000-01-01', bis: '2999-12-31' });
  const f = r.felder;
  assert.strictEqual(f['701'], 160); assert.strictEqual(f['702'], 27.2);
  assert.strictEqual(f['703'], 50); assert.strictEqual(f['704'], 7);
  assert.strictEqual(f['423'], 300, 'service to an EU business');
  assert.strictEqual(f['012'], 510); assert.strictEqual(f['021'], 300); assert.strictEqual(f['022'], 210);
  assert.strictEqual(f['022'], f['037'], 'taxable turnover = breakdown of the bases');
  assert.strictEqual(f['046'], 34.2); assert.strictEqual(f['105'], 34.2);
  assert.throws(() => T.xml({ von: '2026-10-01', bis: '2026-12-31' }), /Präfix/);
  L.setSw('lu.ecdf.prefix', 'ABC123'); L.setSw('lu.matricule', '20261234567');
  const x = T.xml({ von: '2026-10-01', bis: '2026-12-31' });
  const s = x.buffer.toString('utf8');
  assert.match(x.filename, /^ABC123X\d{8}T\d{6}01\.xml$/);
  assert.match(s, /<Declaration type="TVA_DECT" model="1" language="DE"><Year>2026<\/Year><Period>4<\/Period>/);
  assert.match(s, /<NumericField id="701">160,00<\/NumericField>/);
  assert.match(s, /<NumericField id="012">510,00<\/NumericField>/, 'field numbers as printed, with the leading zero');
  assert.ok(!/id="12"/.test(s));
  assert.match(s, /<VATNbr>15027442<\/VATNbr>/);
  // annual return TVA_DECA over the calendar year
  const a = T.xml({ jahr: '2026' }).buffer.toString('utf8');
  assert.match(a, /<Declaration type="TVA_DECA" model="1" language="DE"><Year>2026<\/Year><Period>1<\/Period>/);
  assert.match(a, /<NumericField id="022">210,00<\/NumericField>/);
});

test('recapitulative statement: goods and services per customer', () => {
  const T = require('../server/lu/tva');
  const k = G.saveRec('kunden', null, { NAME: 'Garage Dupont SA', ART: 1, USTID: 'BE0417497106', STRASSE: 'Rue Haute 1', PLZ: '4000', ORT: 'Liège', LAND: 'BE' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, STEUERART: 'IG_LIEFERUNG' }, pos: [{ POSART: 'A', BEZEICHNUNG: 'Pièce', MENGE: 2, VK: 125, MWST: 61 }] });
  const r = T.zusammenfassend({ von: '2000-01-01', bis: '2999-12-31' });
  assert.deepStrictEqual(r.waren, [{ land: 'BE', nummer: '0417497106', betrag: 250 }]);
  assert.deepStrictEqual(r.dienste, [{ land: 'AT', nummer: 'U13585627', betrag: 300 }]);
  L.setSw('lu.periode', 'mois');
  const s = T.xmlZm({ von: '2026-11-01', bis: '2026-11-30' }).buffer.toString('utf8');
  assert.match(s, /<Declaration type="TVA_LICM" model="1" language="DE"><Year>2026<\/Year><Period>11<\/Period><FormData><NumericField id="04">250,00<\/NumericField><NumericField id="08">0,00<\/NumericField><NumericField id="16">0,00<\/NumericField><Table><Line num="1"><TextField id="01">BE<\/TextField><TextField id="02">0417497106<\/TextField><NumericField id="03">250,00<\/NumericField><\/Line><\/Table>/);
  assert.match(s, /<Declaration type="TVA_PSIM"[^>]*>.*<NumericField id="04">300,00<\/NumericField><NumericField id="16">0,00<\/NumericField><Table><Line num="1"><TextField id="01">AT<\/TextField><TextField id="02">U13585627<\/TextField>/);
  assert.throws(() => T.xmlZm({ von: '2020-01-01', bis: '2020-01-31' }), /keine Zusammenfassende Meldung/);
  L.setSw('lu.periode', 'trimestre');
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  dbm.closeAll();
});
