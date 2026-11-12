'use strict';
// Tests of the DATEV interface: character set, header line, fiscal year, personal accounts, BU keys, master data
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-datev-'));
process.env.KUENTAPOS_DATA = tmp;

const dbm = require('../server/db');
const L = require('../server/lib');
const DATEV = require('../server/datev');

test.after(() => { dbm.closeAll(); fs.rmSync(tmp, { recursive: true, force: true }); });

// Windows-1252 file back to text (for the checks)
const CP = { 0x80: '€', 0x84: '„', 0x93: '“', 0x94: '”', 0x96: '–' };
const lesen = buf => Array.from(buf, b => CP[b] || String.fromCharCode(b)).join('');
const zeilen = buf => lesen(buf).split('\r\n').filter(Boolean);
const felder = z => z.split(';');

function buchung(r) {
  L.db().prepare('INSERT INTO FIBU (BELEGDATUM, SOLL, HABEN, BUCHUNGSTEXT, BELEGNUMMER, BETRAG, ERSTELLUNGSDATUM, EXPORTIERT, STEUERSCHLUESSEL, EINGANGID) VALUES (?,?,?,?,?,?,?,0,?,?)')
    .run(r.datum, r.soll, r.haben, r.text, r.beleg, r.betrag, L.today(), r.satz ?? null, r.eingang ?? null);
}

test('Grunddaten', () => {
  dbm.get();
  L.setSw('datev.berater', '29098'); L.setSw('datev.mandant', '55003'); L.setSw('datev.kontenlaenge', '4');
  const d = L.db();
  d.prepare("INSERT INTO KUNDEN (KUNID, NUMMER, ART, ANREDE, VORNAME, NAME, STRASSE, PLZ, ORT, LAND) VALUES (1, 10001, 0, 'Herr', 'Jürgen', 'Müller', 'Hauptstraße 5', '12345', 'Köln', 'D')").run();
  d.prepare("INSERT INTO KUNDEN (KUNID, NUMMER, ART, NAME, STRASSE, PLZ, ORT, LAND, USTID) VALUES (2, 10002, 1, 'Autohaus Groß GmbH', 'Ring 1', '1010', 'Wien', 'A', 'ATU12345678')").run();
  d.prepare("INSERT INTO KUNDEN (KUNID, NUMMER, ART, NAME) VALUES (3, 7, 0, 'Kurznummer')").run();
  d.prepare("INSERT INTO LIEFERANTEN (LIEFID, NUMMER, NAME, STRASSE, PLZ, ORT) VALUES (1, 70001, 'Teile Weiß KG', 'Weg 2', '50667', 'Köln')").run();
  d.prepare("INSERT INTO LIEFERANTEN (LIEFID, NUMMER, NAME) VALUES (2, 3, 'Lieferant mit Kurznummer')").run();
});

test('Zeichensatz Windows-1252', () => {
  const b = DATEV.toCp1252('Müller € „Groß“ – Łódź');
  assert.deepStrictEqual([...b.subarray(0, 6)], [0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]); // Müller
  assert.strictEqual(lesen(b), 'Müller € „Groß“ – Lódz');
  assert.ok(!b.includes(0xef), 'kein UTF-8-BOM');
});

test('Personenkonten: Bereich je Sachkontenlänge, sonst Sammelkonto', () => {
  assert.strictEqual(DATEV.debitorKonto(null, 10001), 10001);
  assert.strictEqual(DATEV.debitorKonto(12345, 10001), 12345);
  assert.strictEqual(DATEV.debitorKonto(null, 7), 10000);            // short number → collective debtor
  assert.strictEqual(DATEV.debitorKonto(70001, null), 10000);        // creditor range is not a debtor
  assert.strictEqual(DATEV.kreditorKonto(null, 3), 70000);           // short number → collective creditor
  assert.strictEqual(DATEV.kreditorKonto(null, 70001), 70001);
  L.setSw('datev.sammeldebitor', '19999');
  assert.strictEqual(DATEV.debitorKonto(null, 7), 19999);
  L.setSw('datev.kontenlaenge', '5');
  assert.strictEqual(DATEV.debitorKonto(null, 10001), 100000);       // with 5 digits: 100000–699999
  L.setSw('datev.kontenlaenge', '4'); L.setSw('datev.sammeldebitor', '');
});

test('Wirtschaftsjahr: Zeitraum über den Jahreswechsel wird abgelehnt', () => {
  assert.throws(() => DATEV.zeitraum({ von: '2026-12-01', bis: '2027-01-31' }), /Wirtschaftsjahr.*bis 31\.12\.2026 und ab 01\.01\.2027/s);
  assert.deepStrictEqual(DATEV.zeitraum({ von: '2026-01-01', bis: '2026-12-31' }).wj, { beginn: '2026-01-01', ende: '2026-12-31' });
  L.setSw('datev.wjbeginn', '7');                                    // different fiscal year 01.07.–30.06.
  assert.deepStrictEqual(DATEV.zeitraum({ von: '2026-12-01', bis: '2027-01-31' }).wj, { beginn: '2026-07-01', ende: '2027-06-30' });
  assert.throws(() => DATEV.zeitraum({ von: '2027-06-01', bis: '2027-07-31' }), /Wirtschaftsjahr/);
  L.setSw('datev.wjbeginn', '1');
  assert.throws(() => DATEV.zeitraum({ von: '2026-05-01', bis: '2026-04-01' }), /Startdatum/);
});

test('BU-Schlüssel: Umsatzsteuer für Erlöse, Vorsteuer für Eingangsrechnungen', () => {
  assert.strictEqual(DATEV.buSchluessel(19, false), '');             // switched off (automatic accounts)
  L.setSw('datev.buschluessel', '1');
  assert.strictEqual(DATEV.buSchluessel(19, false), '3');
  assert.strictEqual(DATEV.buSchluessel(7, false), '2');
  assert.strictEqual(DATEV.buSchluessel(19, true), '9');
  assert.strictEqual(DATEV.buSchluessel(7, true), '8');
  assert.strictEqual(DATEV.buSchluessel(0, true), '');
});

test('Buchungsstapel: Kopfzeile, Spalten, Umlaute, Markierung', () => {
  buchung({ datum: '2026-10-05', soll: 10001, haben: 8400, text: 'Rechnung an Müller', beleg: '2026-0815', betrag: 119, satz: 19 });
  buchung({ datum: '2026-10-07', soll: 3400, haben: 70001, text: 'ER Teile Weiß KG', beleg: 'R-77', betrag: 59.5, satz: 19, eingang: 1 });
  buchung({ datum: '2026-10-09', soll: 1200, haben: 10001, text: 'Gutschrift „Müller“', beleg: '2026-0816', betrag: -20, satz: 0 });
  const r = DATEV.buchungsstapel({ von: '2026-10-01', bis: '2026-10-31' });
  assert.strictEqual(r.count, 3);
  const z = zeilen(r.buffer);
  const k = felder(z[0]);
  assert.strictEqual(k.length, 31);
  assert.deepStrictEqual(k.slice(0, 5), ['"EXTF"', '700', '21', '"Buchungsstapel"', '13']);
  assert.match(k[5], /^\d{17}$/);
  assert.deepStrictEqual(k.slice(10, 16), ['29098', '55003', '20260101', '4', '20261001', '20261031']);
  assert.strictEqual(k[21], '"EUR"');
  assert.strictEqual(felder(z[1])[0], 'Umsatz (ohne Soll/Haben-Kz)');
  const b1 = felder(z[2]);
  assert.deepStrictEqual([b1[0], b1[1], b1[6], b1[7], b1[8], b1[9], b1[10], b1[13]], ['119,00', '"S"', '10001', '8400', '"3"', '0510', '"2026-0815"', '"Rechnung an Müller"']);
  assert.strictEqual(felder(z[3])[8], '"9"');                        // incoming invoice → input tax
  const b3 = felder(z[4]);
  assert.deepStrictEqual([b3[0], b3[1], b3[13]], ['20,00', '"H"', '"Gutschrift „Müller“"']);
  assert.ok(!r.buffer.includes(Buffer.from('Ã')), 'keine UTF-8-Umlaute');
  assert.ok(r.buffer.includes(0xfc), 'ü als Windows-1252');
  // mark: afterwards only new bookings
  DATEV.buchungsstapel({ von: '2026-10-01', bis: '2026-10-31', markieren: '1' });
  assert.strictEqual(DATEV.buchungsstapel({ von: '2026-10-01', bis: '2026-10-31' }).count, 0);
  assert.strictEqual(DATEV.buchungsstapel({ von: '2026-10-01', bis: '2026-10-31', alle: '1' }).count, 3);
  L.setSw('datev.buschluessel', '0');
});

test('Buchungsstapel: ungültige Konten werden gemeldet', () => {
  buchung({ datum: '2026-11-02', soll: 1234567, haben: 8400, text: 'zu lang', beleg: 'X1', betrag: 10 });
  assert.throws(() => DATEV.buchungsstapel({ von: '2026-11-01', bis: '2026-11-30' }), /Ungültige Konten.*X1/s);
  L.db().prepare("DELETE FROM FIBU WHERE BELEGNUMMER='X1'").run();
});

test('Debitoren/Kreditoren: nur bebuchte Konten, Firma/Person, Land und USt-IdNr.', () => {
  buchung({ datum: '2026-10-20', soll: 10002, haben: 8400, text: 'Rechnung Groß', beleg: '2026-0820', betrag: 500 });
  const r = DATEV.stammdaten({ von: '2026-10-01', bis: '2026-10-31' });
  const z = zeilen(r.buffer);
  const k = felder(z[0]);
  assert.deepStrictEqual(k.slice(0, 5), ['"EXTF"', '700', '16', '"Debitoren/Kreditoren"', '5']);
  assert.strictEqual(k.length, 31);
  assert.strictEqual(felder(z[1])[0], 'Konto');
  const rows = z.slice(2).map(felder);
  assert.deepStrictEqual(rows.map(x => x[0]), ['10001', '10002', '70001']); // collective accounts and accounts without bookings are not included
  const mueller = rows[0];
  assert.deepStrictEqual([mueller[1], mueller[3], mueller[4], mueller[6], mueller[10], mueller[15], mueller[17], mueller[18], mueller[19]],
    ['""', '"Müller"', '"Jürgen"', '1', '"Herr"', '"Hauptstraße 5"', '"12345"', '"Köln"', '"DE"']);
  const gross = rows[1];
  assert.deepStrictEqual([gross[1], gross[6], gross[8], gross[9], gross[19]], ['"Autohaus Groß GmbH"', '2', '"AT"', '"U12345678"', '"AT"']);
  assert.strictEqual(rows[2][1], '"Teile Weiß KG"');
  const alle = DATEV.stammdaten({ von: '2026-10-01', bis: '2026-10-31', alle: '1' });
  assert.strictEqual(alle.count, 3);                                 // short numbers (collective accounts) never as an account of their own
});
