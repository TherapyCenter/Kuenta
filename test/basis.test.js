'use strict';
// Automated tests: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-test-'));
process.env.KUENTA_DATA = tmp;

const { writeZip, readZip } = require('../server/import/zip');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const ER = require('../server/api/erechnung');
const BK = require('../server/backup');
const G = require('../server/api/generic');

test.after(() => { dbm.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('ZIP: Lesen/Schreiben inkl. KFZ-Faktura-Passwortschutz (ZipCrypto)', () => {
  const files = [{ name: 'db\\DB1.bak', data: Buffer.from('Hallo Werkstatt '.repeat(100)) }, { name: 'reports/logo/logo.png', data: Buffer.from([1, 2, 3]) }];
  const z = readZip(writeZip(files, { password: 'geheim123' }));
  assert.strictEqual(z.encrypted, true);
  assert.deepStrictEqual(z.entries.map(e => e.name), ['db/DB1.bak', 'reports/logo/logo.png']);
  assert.strictEqual(z.read(z.entries[0], 'geheim123').toString(), files[0].data.toString());
  assert.throws(() => z.read(z.entries[0], 'falsch'), e => e.code === 'PASSWORD');
  assert.throws(() => z.read(z.entries[0]), e => e.code === 'PASSWORD');
});

test('Vorgangsberechnung brutto und netto', () => {
  dbm.get();
  const kb = { ANSICHTBRUTTO: 1 };
  const pb = [{ POSART: 'L', MENGE: 1, VKBRUTTO: 70, MWST: 61 }];
  VG.calc(kb, pb);
  assert.deepStrictEqual([kb.GNETTO, kb.GMWST1, kb.GBRUTTO], [58.82, 11.18, 70]);
  const kn = { ANSICHTBRUTTO: 0 };
  const pn = [{ POSART: 'A', MENGE: 2, VK: 10, MWST: 61, RABATT: 10, EK: 4 }, { POSART: 'L', MENGE: 1, VK: 100, MWST: 62 }, { POSART: 'L', MENGE: 1, VK: 30, DURCHLAUFER: 1 }, { POSART: 'T', BEZEICHNUNG: 'Hinweis' }];
  VG.calc(kn, pn);
  assert.strictEqual(kn.GNETTO, 148);
  assert.strictEqual(kn.GMWST1, 3.42);
  assert.strictEqual(kn.GMWST2, 7);
  assert.strictEqual(kn.GBRUTTO, 158.42);
  assert.strictEqual(kn.EINSATZ, 8);
});

test('Rechnung → Zahlung → Storno → E-Rechnung → Sicherung', () => {
  const k = G.saveRec('kunden', null, { NAME: 'Mustermann', VORNAME: 'Max', STRASSE: 'Teststr. 1', PLZ: '12345', ORT: 'Musterstadt', EMAIL: 'max@example.org', ART: 0 });
  assert.ok(k.NUMMER > 0);
  G.saveRec('kunden', null, { NAME: 'Firma', NUMMER: k.NUMMER + 1 });
  assert.throws(() => G.saveRec('kunden', null, { NAME: 'Doppelt', NUMMER: k.NUMMER }), /bereits vergeben/);
  const t = VG.template('rechnung', { kunid: k.KUNID });
  delete t.kopf._kunde;
  const saved = VG.save('rechnung', { kopf: t.kopf, pos: [{ POSART: 'L', BEZEICHNUNG: 'Inspektion', MENGE: 1.5, VKBRUTTO: 95, MWST: 61 }, { POSART: 'A', BEZEICHNUNG: 'Ölfilter', MENGE: 1, VKBRUTTO: 12.5, MWST: 61 }] });
  const id = saved.kopf.RECHNUNGID;
  assert.strictEqual(saved.kopf.GBRUTTO, 155);
  assert.strictEqual(saved.offen, 155);
  VG.addPayment({ RECHNUNGID: id, BETRAG: 55, ZAHLUNGSARTID: 1 });
  let r = VG.load('rechnung', id);
  assert.strictEqual(r.offen, 100);
  assert.strictEqual(r.kopf.ZAHLSTATUS, 1);
  const kb = dbm.get().prepare('SELECT * FROM KASSENBUCH WHERE RECHID=?').get(id);
  assert.strictEqual(kb.EINNAHMEN, 55);
  const x = ER.create(id, 'cii');
  assert.match(x.xml, /<ram:GrandTotalAmount>155\.00<\/ram:GrandTotalAmount>/);
  assert.match(x.xml, /<ram:DuePayableAmount>100\.00<\/ram:DuePayableAmount>/);
  const u = ER.create(id, 'ubl');
  assert.match(u.xml, /<cbc:PayableAmount currencyID="EUR">100\.00<\/cbc:PayableAmount>/);
  const st = VG.storno(id);
  r = VG.load('rechnung', id);
  assert.strictEqual(r.offen, 0);
  const kr = VG.load('korrektur', st.id);
  assert.strictEqual(kr.kopf.GBRUTTO, -155);
  assert.strictEqual(kr.offen, -55); // the part paid in cash has to be refunded
  assert.match(ER.create(st.id, 'cii').xml, /<ram:TypeCode>381<\/ram:TypeCode>/);
  // intra-community supply: XRechnung needs the full delivery address (BR-DE-10, BR-DE-11)
  const eu = G.saveRec('kunden', null, { NAME: 'Autohaus Huber GmbH', ART: 1, USTID: 'ATU13585627', STRASSE: 'Hauptstraße 1', PLZ: '4020', ORT: 'Linz', LAND: 'AT', EMAIL: 'office@example.at' });
  const ti = VG.template('rechnung', { kunid: eu.KUNID }); delete ti.kopf._kunde;
  const ig = VG.save('rechnung', { kopf: { ...ti.kopf, STEUERART: 'IG_LIEFERUNG' }, pos: [{ POSART: 'A', BEZEICHNUNG: 'Ersatzteil', MENGE: 1, VK: 80, MWST: 61 }] }).kopf.RECHNUNGID;
  assert.match(ER.create(ig, 'cii').xml, /<ram:ShipToTradeParty><ram:Name>Autohaus Huber GmbH<\/ram:Name><ram:PostalTradeAddress><ram:PostcodeCode>4020<\/ram:PostcodeCode><ram:LineOne>Hauptstraße 1<\/ram:LineOne><ram:CityName>Linz<\/ram:CityName><ram:CountryID>AT<\/ram:CountryID>/);
  assert.match(ER.create(ig, 'ubl').xml, /<cac:DeliveryLocation><cac:Address><cbc:StreetName>Hauptstraße 1<\/cbc:StreetName><cbc:CityName>Linz<\/cbc:CityName><cbc:PostalZone>4020<\/cbc:PostalZone>/);
  assert.throws(() => VG.remove('rechnung', id), /Zahlungen|stornieren/);
  // backup with password
  const b = BK.createBackup({ password: 'sicher123' });
  assert.ok(BK.inspectBackup(b.buffer).encrypted);
  assert.throws(() => BK.restoreBackup(b.buffer, { password: 'falsch' }), /Passwort/);
  dbm.get().prepare("UPDATE KUNDEN SET NAME='geändert' WHERE KUNID=?").run(k.KUNID);
  BK.restoreBackup(b.buffer, { password: 'sicher123' });
  assert.strictEqual(dbm.get().prepare('SELECT NAME FROM KUNDEN WHERE KUNID=?').get(k.KUNID).NAME, 'Mustermann');
  assert.match(b.filename, /^Kuenta-Sicherung_.*\.kuenta$/);
  // backups of the predecessor versions (KFZ-Faktotum *.kft, Schraubwerk *.swb) stay readable
  const neu = readZip(BK.createBackup({}).buffer);
  for (const alt of ['faktotum', 'schraubwerk']) {
    const buf = writeZip(neu.entries.filter(e => !e.dir).map(e => ({
      name: e.name === 'kuenta.json' ? alt + '.json' : e.name === 'db/kuenta.db' ? 'db/' + alt + '.db' : e.name,
      data: neu.read(e),
    })));
    assert.strictEqual(BK.inspectBackup(buf).encrypted, false);
    dbm.get().prepare("UPDATE KUNDEN SET NAME='geändert' WHERE KUNID=?").run(k.KUNID);
    BK.restoreBackup(buf);
    assert.strictEqual(dbm.get().prepare('SELECT NAME FROM KUNDEN WHERE KUNID=?').get(k.KUNID).NAME, 'Mustermann', alt);
  }
});

// Optional: check a real KFZ-Faktura data set (KUENTA_TEST_GBAK=path to DB1.bak)
test('KFZ-Faktura gbak-Import (optional)', { skip: !process.env.KUENTA_TEST_GBAK }, () => {
  const { gbakToSqlite } = require('../server/import/kfz');
  const out = path.join(tmp, 'gbak.db');
  const r = gbakToSqlite(fs.readFileSync(process.env.KUENTA_TEST_GBAK), out);
  assert.ok(r.stats.KUNDEN > 0);
  assert.strictEqual(r.skippedCount, 0);
});
