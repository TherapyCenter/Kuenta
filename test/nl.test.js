'use strict';
// Dutch tax system: btw-id and KvK, rates, texts and footer, KOR, VAT return by rubrieken, Peppol BIS 3.0,
// Dutch documents.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTAPOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-nl-'));
process.env.KUENTAPOS_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const NIF = require('../public/js/nif.js');
const PP = require('../server/peppol');
const { I18N } = require('../server/i18n');

test('btw-id and KvK number', () => {
  assert.ok(NIF.nlBtw('NL123456782B01').ok, 'eleven test');
  assert.ok(NIF.nlBtw('NL000099998B57').ok, 'modulo 97');
  assert.ok(!NIF.nlBtw('NL123456783B01').ok);
  assert.ok(!NIF.nlBtw('DE123456789').ok);
  assert.ok(NIF.nlKvk('6863 6211').ok);
  assert.ok(!NIF.nlKvk('1234567').ok);
});

test('Dutch is a language for the user interface and documents', () => {
  assert.ok(I18N.LANGS.nl && I18N.UI_LANGS.nl);
  assert.strictEqual(I18N.tr('💾 Einstellungen speichern', 'nl'), '💾 Instellingen opslaan');
  assert.strictEqual(I18N.tr('Auftrag', 'nl'), 'Werkorder', 'document wording wins');
  assert.strictEqual(I18N.tr('Rechnung Nr. 7', 'nl'), 'Factuur nr. 7');
  assert.strictEqual(I18N.tr('zzgl. 21 % btw auf 100,00 €', 'nl'), '21 % btw over 100,00 €');
});

let rid;
test('Netherlands: rates, texts, footer, Peppol for a municipality', () => {
  L.setSw('steuer.land', 'NL'); L.setSw('nl.kvk', '68636211');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Garage De Vries B.V.', USTNR='NL123456782B01', STRASSE='Dorpsstraat 1', PLZ='1234 AB', ORT='Utrecht', LAND='NL', EMAIL='info@example.nl', TELEFON='030 1234567', IBAN='NL91ABNA0417164300', BIC='ABNANL2A'").run();
  assert.deepStrictEqual(L.mwstRates(), { 61: 21, 62: 9, 63: 0, 64: 0 });
  assert.strictEqual(G.lookups().land, 'NL');
  const k = G.saveRec('kunden', null, { NAME: 'Gemeente Utrecht', ART: 1, STRASSE: 'Stadsplateau 1', PLZ: '3521 AZ', ORT: 'Utrecht', LAND: 'NL', NL_OIN: '00000001002220647000', LEITWEGID: 'INK-2026-001' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, BESTELLNR: 'PO-4711' }, pos: [
    { POSART: 'L', ARTNUMMER: 'AW1', BEZEICHNUNG: 'Onderhoudsbeurt', MENGE: 1, VK: 200, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Ruitenwisservloeistof', MENGE: 2, VK: 5, MWST: 62 },
    { POSART: 'A', BEZEICHNUNG: 'APK-keuring leges (DP)', MENGE: 1, VK: 25, MWST: 63, DURCHLAUFER: 1 }] });
  rid = r.kopf.RECHNUNGID;
  assert.strictEqual(r.kopf.GBRUTTO, 242 + 10.9 + 25);
  const d = VG.load('rechnung', rid);
  assert.strictEqual(d.lx.ustLabel, 'btw');
  assert.deepStrictEqual(d.lx.pied, ['KvK 68636211', 'Btw-id NL123456782B01']);
  assert.ok(d.lx.mentions.some(m => /Doorlopende post/.test(m)));
  assert.deepStrictEqual(d.lx.warnungen, []);
  const p = PP.create(rid);
  assert.deepStrictEqual(p.problems, []);
  const x = p.xml;
  assert.match(x, /<cbc:CustomizationID>urn:cen\.eu:en16931:2017#compliant#urn:fdc:peppol\.eu:2017:poacc:billing:3\.0<\/cbc:CustomizationID>/);
  assert.match(x, /<cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="0106">68636211<\/cbc:EndpointID>/);
  assert.match(x, /<cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="0190">00000001002220647000<\/cbc:EndpointID>/);
  assert.match(x, /<cbc:CompanyID schemeID="0190">00000001002220647000<\/cbc:CompanyID>/);
  assert.match(x, /<cbc:BuyerReference>INK-2026-001<\/cbc:BuyerReference>/);
  assert.match(x, /<cac:TaxCategory><cbc:ID>S<\/cbc:ID><cbc:Percent>21\.00<\/cbc:Percent>/);
  assert.match(x, /<cbc:TaxExemptionReason>Doorlopende post/);
  assert.match(x, /<cbc:PayableAmount currencyID="EUR">277\.90<\/cbc:PayableAmount>/);
  assert.match(x, /<cbc:ID>NL91ABNA0417164300<\/cbc:ID>/);
  // credit note with the corrected invoice
  const c = PP.create(VG.storno(rid).id);
  assert.match(c.xml, /<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/);
  assert.match(c.xml, /<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>/);
  assert.match(c.xml, /<cbc:CreditedQuantity unitCode="C62">1<\/cbc:CreditedQuantity>/);
  // PDF in Dutch
  L.setSw('beleg.sprache', 'nl');
  assert.ok(require('../server/pdf/belege').vorgangPdf('rechnung', d).subarray(0, 5).toString() === '%PDF-');
  L.setSw('beleg.sprache', 'de');
});

test('KOR, reverse charge and missing data', () => {
  L.setOpt('Kleinunternehmer', '1');
  assert.strictEqual(L.mwstRates()[61], 0);
  assert.ok(require('../server/nl').mentions('rechnung', {}, []).some(m => /kleineondernemersregeling/.test(m)));
  L.setOpt('Kleinunternehmer', '0');
  const k = G.saveRec('kunden', null, { NAME: 'Autohaus Huber GmbH', ART: 1, USTID: 'ATU13585627', STRASSE: 'Hauptstraße 1', PLZ: '4020', ORT: 'Linz', LAND: 'AT' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, STEUERART: 'REVERSE_CHARGE', BESTELLNR: 'B-1' }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Reparatie', MENGE: 1, VK: 300, MWST: 61 }] });
  const d = VG.load('rechnung', r.kopf.RECHNUNGID);
  assert.ok(d.lx.mentions.includes('Btw verlegd.'));
  const p = PP.create(r.kopf.RECHNUNGID);
  assert.deepStrictEqual(p.problems, [], 'foreign customer: the btw-id is enough as Peppol address');
  assert.match(p.xml, /<cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="9914">ATU13585627<\/cbc:EndpointID>/);
  assert.match(p.xml, /<cbc:ID>AE<\/cbc:ID><cbc:Percent>0\.00<\/cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-AE<\/cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Btw verlegd<\/cbc:TaxExemptionReason>/);
  // Dutch business customer without KvK
  const k2 = G.saveRec('kunden', null, { NAME: 'Transport Jansen', ART: 1, STRASSE: 'Weg 2', PLZ: '1000 AA', ORT: 'Amsterdam', LAND: 'NL' });
  const t2 = VG.template('rechnung', { kunid: k2.KUNID }); delete t2.kopf._kunde;
  const r2 = VG.save('rechnung', { kopf: { ...t2.kopf, ANSICHTBRUTTO: 0 }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Reparatie', MENGE: 1, VK: 100, MWST: 61 }] });
  const pr = PP.create(r2.kopf.RECHNUNGID).problems;
  assert.ok(pr.some(x => /Peppol-Adresse des Kunden/.test(x)));
  assert.ok(pr.some(x => /NL-R-005/.test(x)));
});

test('VAT return by rubrieken', () => {
  const A = require('../server/nl/aangifte');
  const r = A.berekenen({ von: '2000-01-01', bis: '2999-12-31' });
  const R = r.rubrieken;
  assert.ok(Number.isInteger(R['1a'].omzet) && Number.isInteger(R['1a'].btw), 'whole euros');
  assert.ok(R['3b'].omzet >= 300, 'reverse charge service to an EU business');
  assert.strictEqual(r['5a'], R['1a'].btw + R['1b'].btw + R['1c'].btw);
  assert.strictEqual(r['5g'], r['5a'] - r['5b']);
  assert.ok(r.icp);
  assert.ok(r.doorlopend >= 0);
  const csv = A.csv({ von: '2000-01-01', bis: '2999-12-31' }).buffer.toString('utf8');
  assert.match(csv, /^﻿Rubriek;Omschrijving;Omzet;Omzetbelasting/);
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  dbm.closeAll();
});
