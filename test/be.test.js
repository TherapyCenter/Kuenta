'use strict';
// Belgian tax system: enterprise number, rates, texts in Dutch and French, footer, franchise, Peppol (0208),
// periodic VAT return by grids with the Intervat XML, French as document language.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTAPOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-be-'));
process.env.KUENTAPOS_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const NIF = require('../public/js/nif.js');
const PP = require('../server/peppol');
const { I18N } = require('../server/i18n');

test('enterprise number', () => {
  assert.deepStrictEqual(NIF.beNr('BE 0417.497.106'), { ok: true, nr: '0417497106', btw: 'BE0417497106', anzeige: '0417.497.106' });
  assert.ok(NIF.beNr('0123456749').ok);
  assert.ok(!NIF.beNr('BE0123456748').ok);
  assert.ok(!NIF.beNr('BE2123456749').ok, 'starts with 0 or 1');
});

test('French is a language for the user interface and documents', () => {
  assert.ok(I18N.LANGS.fr && I18N.UI_LANGS.fr);
  assert.strictEqual(I18N.tr('💾 Einstellungen speichern', 'fr'), '💾 Enregistrer les paramètres');
  assert.strictEqual(I18N.tr('Auftrag', 'fr'), 'Ordre de réparation', 'document wording wins');
  assert.strictEqual(I18N.tr('Rechnung Nr. 5', 'fr'), 'Facture n° 5');
  assert.strictEqual(I18N.tr('Summe netto', 'fr'), 'Total HT');
});

let rid, kunde;
test('Belgium: rates, texts, footer, Peppol between businesses', () => {
  L.setSw('steuer.land', 'BE'); L.setSw('be.rpr', 'Gent, afdeling Gent');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Garage Peeters BV', USTNR='BE0123456749', STRASSE='Kerkstraat 1', PLZ='9000', ORT='Gent', LAND='BE', EMAIL='info@example.be', TELEFON='09 123 45 67', IBAN='BE68539007547034', BIC='GKCCBEBB'").run();
  assert.deepStrictEqual(L.mwstRates(), { 61: 21, 62: 6, 63: 0, 64: 12 });
  assert.strictEqual(G.lookups().land, 'BE');
  kunde = G.saveRec('kunden', null, { NAME: 'Transport Janssens NV', ART: 1, USTID: 'BE0417497106', STRASSE: 'Industrieweg 5', PLZ: '2000', ORT: 'Antwerpen', LAND: 'BE', EMAIL: 'boekhouding@example.be' }).KUNID;
  const t = VG.template('rechnung', { kunid: kunde }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, BESTELLNR: 'PO-88' }, pos: [
    { POSART: 'L', BEZEICHNUNG: 'Onderhoud', MENGE: 2, VK: 70, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Handboek', MENGE: 1, VK: 20, MWST: 62 },
    { POSART: 'A', BEZEICHNUNG: 'Keuring (DP)', MENGE: 1, VK: 45, MWST: 63, DURCHLAUFER: 1 }] });
  rid = r.kopf.RECHNUNGID;
  assert.strictEqual(r.kopf.GBRUTTO, 169.4 + 21.2 + 45);
  const d = VG.load('rechnung', rid);
  assert.strictEqual(d.lx.ustLabel, 'btw');
  assert.deepStrictEqual(d.lx.pied, ['Btw BE 0123.456.749', 'RPR Gent, afdeling Gent']);
  assert.ok(d.lx.mentions.some(m => /art. 28, 5° WBTW/.test(m)));
  assert.deepStrictEqual(d.lx.warnungen, []);
  // French texts with the document language French
  L.setSw('beleg.sprache', 'fr');
  const dfr = VG.load('rechnung', rid);
  assert.deepStrictEqual(dfr.lx.pied, ['TVA BE 0123.456.749', 'RPM Gent, afdeling Gent']);
  assert.ok(dfr.lx.mentions.some(m => /Débours exposés/.test(m)));
  assert.ok(require('../server/pdf/belege').vorgangPdf('rechnung', dfr).subarray(0, 5).toString() === '%PDF-');
  L.setSw('beleg.sprache', 'de');
  // Peppol: enterprise numbers as electronic address and legal registration (0208)
  const p = PP.create(rid);
  assert.deepStrictEqual(p.problems, []);
  assert.match(p.xml, /<cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="0208">0123456749<\/cbc:EndpointID>/);
  assert.match(p.xml, /<cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="0208">0417497106<\/cbc:EndpointID>/);
  assert.match(p.xml, /<cbc:CompanyID>BE0123456749<\/cbc:CompanyID><cac:TaxScheme>/);
  assert.match(p.xml, /<cbc:RegistrationName>Garage Peeters BV<\/cbc:RegistrationName><cbc:CompanyID schemeID="0208">0123456749<\/cbc:CompanyID>/);
  assert.match(p.xml, /<cbc:Percent>6\.00<\/cbc:Percent>/);
  assert.match(p.xml, /<cbc:PayableAmount currencyID="EUR">235\.60<\/cbc:PayableAmount>/);
});

test('franchise, reverse charge', () => {
  L.setOpt('Kleinunternehmer', '1');
  assert.strictEqual(L.mwstRates()[61], 0);
  assert.ok(require('../server/be').mentions('rechnung', {}, []).some(m => /art. 56bis WBTW/.test(m)));
  assert.throws(() => require('../server/be/aangifte').berekenen({ von: '2000-01-01', bis: '2999-12-31' }), /keine periodische/);
  // the VAT number stays on documents and in Peppol (BR-E-02)
  assert.deepStrictEqual(require('../server/be').pied(), ['Btw BE 0123.456.749', 'RPR Gent, afdeling Gent']);
  assert.match(PP.create(rid).xml, /<cac:PartyTaxScheme><cbc:CompanyID>BE0123456749<\/cbc:CompanyID>/);
  L.setOpt('Kleinunternehmer', '0');
  const k = G.saveRec('kunden', null, { NAME: 'Autohaus Huber GmbH', ART: 1, USTID: 'ATU13585627', STRASSE: 'Hauptstraße 1', PLZ: '4020', ORT: 'Linz', LAND: 'AT' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, STEUERART: 'REVERSE_CHARGE', BESTELLNR: 'B-1' }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Herstelling', MENGE: 1, VK: 400, MWST: 61 }] });
  assert.ok(VG.load('rechnung', r.kopf.RECHNUNGID).lx.mentions.some(m => /Btw verlegd/.test(m)));
  assert.match(PP.create(r.kopf.RECHNUNGID).xml, /<cbc:EndpointID schemeID="9914">ATU13585627<\/cbc:EndpointID>/);
});

test('periodic VAT return: grids and Intervat XML', () => {
  VG.storno(rid);
  const A = require('../server/be/aangifte');
  const r = A.berekenen({ von: '2000-01-01', bis: '2999-12-31' });
  const g = r.roosters;
  assert.strictEqual(g['03'], 140);
  assert.strictEqual(g['01'], 20);
  assert.strictEqual(g['44'], 400, 'service to an EU business');
  assert.strictEqual(g['54'], 30.6);
  assert.strictEqual(g['49'], 160, 'credit note: base');
  assert.strictEqual(g['64'], 30.6, 'credit note: VAT to recover');
  assert.ok(!g['71'] && !g['72'], '54 and 64 cancel out');
  L.setSw('be.periode', 'maand');
  const x = A.xml({ von: '2026-11-01', bis: '2026-11-30' });
  const s = x.buffer.toString('utf8');
  assert.match(x.filename, /^BTW_0123456749_2026_M11\.xml$/);
  assert.match(s, /<ns2:VATConsignment xmlns="http:\/\/www\.minfin\.fgov\.be\/InputCommon" xmlns:ns2="http:\/\/www\.minfin\.fgov\.be\/VATConsignment" VATDeclarationsNbr="1">/);
  assert.match(s, /<VATNumber>0123456749<\/VATNumber>/);
  assert.match(s, /<ns2:Period><ns2:Month>11<\/ns2:Month><ns2:Year>2026<\/ns2:Year><\/ns2:Period>/);
  assert.match(s, /<ns2:Amount GridNumber="3">140\.00<\/ns2:Amount>/);
  L.setSw('be.periode', 'kwartaal');
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  dbm.closeAll();
});
