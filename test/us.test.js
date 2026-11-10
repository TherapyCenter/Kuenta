'use strict';
// US tax system: dollars, sales tax with non-taxable labor, tax-exempt customers, fees, register with
// prices before tax, QuickBooks export, PDF with authorizations. German companies stay unchanged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-us-'));
process.env.KUENTA_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');

test('switching to the US: rates, currency, defaults', () => {
  assert.strictEqual(L.mwstRates()[61], 19);
  L.setSw('steuer.land', 'US'); L.setSw('us.tax.rate', '8.25');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Main Street Auto LLC', STRASSE='100 Main St', PLZ='62701', ORT='Springfield, IL', LAND='US'").run();
  L.setSw('us.reg.label', 'Repair Facility No.'); L.setSw('us.reg.nr', 'RF-12345');
  assert.deepStrictEqual(L.mwstRates(), { 61: 8.25, 62: 0, 63: 0, 64: 0 });
  const lk = G.lookups();
  assert.strictEqual(lk.land, 'US'); assert.strictEqual(lk.waehrung, 'USD'); assert.strictEqual(lk.usLaborFree, true);
  assert.strictEqual(L.geld(1234.5, 'en-GB'), '$1,234.50');
  const t = VG.template('rechnung', {});
  assert.strictEqual(t.kopf.ANSICHTBRUTTO, 0, 'prices before tax');
  assert.strictEqual(t.kopf.KUNLAND, 'US');
});

let rid;
test('invoice: parts taxable, labor not, fees, authorization; PDF', () => {
  const k = G.saveRec('kunden', null, { NAME: 'Miller', VORNAME: 'Sue', STRASSE: '5 Oak Ave', PLZ: '62704', ORT: 'Springfield, IL', LAND: 'US' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, FAHRKM: 48210, FAHRKMOUT: 48216, USALTTEILE: 'zurueck', USFREIGABE: JSON.stringify([{ betrag: 400, datum: L.today(), art: 'telefonisch', person: 'Sue Miller' }]) }, pos: [
    { POSART: 'A', BEZEICHNUNG: 'Brake pads', MENGE: 1, VK: 100, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Alternator', MENGE: 1, VK: 150, MWST: 61, TEILEZUSTAND: 'AUFBEREITET' },
    { POSART: 'L', BEZEICHNUNG: 'Labor', MENGE: 2, VK: 60, MWST: 61 },
    { POSART: 'A', ARTNUMMER: 'FEE', BEZEICHNUNG: 'Hazardous waste disposal', MENGE: 1, VK: 5, MWST: 63 }] });
  // 250 taxable × 8.25 % = 20.63; labor 120 and fee 5 non-taxable
  assert.strictEqual(r.kopf.GNETTO, 375);
  assert.strictEqual(r.kopf.GBRUTTO, 395.63);
  assert.strictEqual(r.tax[61].mwst, 20.63);
  assert.strictEqual(r.pos[1].TEILEZUSTAND, 'AUFBEREITET');
  assert.strictEqual(r.kopf.FAHRKMOUT, 48216);
  rid = r.kopf.RECHNUNGID;
  // labor becomes taxable by setting
  L.setSw('us.labor.taxable', '1');
  assert.strictEqual(VG.load('rechnung', rid).tax[61].netto, 370);
  L.setSw('us.labor.taxable', '0');
  const buf = require('../server/pdf/belege').vorgangPdf('rechnung', VG.load('rechnung', rid));
  assert.ok(buf.length > 1000);
});

test('tax-exempt customer', () => {
  const k = G.saveRec('kunden', null, { NAME: 'City of Springfield', ART: 1, TAXEXEMPT: 1, EXEMPTCERT: 'EX-998', EXEMPTREASON: 'Government' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  assert.strictEqual(t.kopf.STEUERART, 'EXEMPT');
  const r = VG.save('rechnung', { kopf: t.kopf, pos: [{ POSART: 'A', BEZEICHNUNG: 'Tires', MENGE: 4, VK: 100, MWST: 61 }] });
  assert.strictEqual(r.kopf.GBRUTTO, 400);
});

test('register: prices before tax, invoice and payment match', async () => {
  const KS = require('../server/api/kasse');
  const b = await KS.bon({ zahlart: 'BAR', gegeben: 50, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Wiper blades', MENGE: 2, EINZEL: 12.5, MWST: 61 }, { POSART: 'L', BEZEICHNUNG: 'Install', MENGE: 1, EINZEL: 10, MWST: 61 }] });
  assert.strictEqual(b.bon.BRUTTO, 37.06, '25 + 2.06 tax + 10 labor');
  const r = VG.load('rechnung', b.bon.RECHNUNGID);
  assert.strictEqual(r.kopf.GBRUTTO, 37.06);
  assert.strictEqual(r.offen, 0);
});

test('QuickBooks Online export', () => {
  const csv = require('../server/us/export').quickbooks({ von: '2000-01-01', bis: '2999-12-31' }).buffer.toString('utf8');
  assert.match(csv, /^InvoiceNo,Customer,InvoiceDate,DueDate,/);
  assert.match(csv, /,Sue Miller,\d\d\/\d\d\/\d{4},.*,Parts,Brake pads,1,100,100\.00,TAX,8\.25,USD/);
  assert.match(csv, /,Labor,Labor,2,60,120\.00,NON,0\.00,USD/);
  assert.match(csv, /,City of Springfield,.*,Tires,4,100,400\.00,NON,0\.00,USD/);
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  assert.strictEqual(L.waehrung(), 'EUR');
  dbm.closeAll();
});
