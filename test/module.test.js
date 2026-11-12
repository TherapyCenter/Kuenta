'use strict';
// Tests of the add-on modules: purchasing, time tracking, vehicle trading, register, down payment, collective invoice, import, email, PDF, tenants
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const zlib = require('zlib');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-mod-'));
process.env.KUENTAPOS_DATA = tmp;

const dbm = require('../server/db');
const L = require('../server/lib');
const G = require('../server/api/generic');
const VG = require('../server/api/vorgang');
const EK = require('../server/api/einkauf');
const ZT = require('../server/api/zeit');
const HD = require('../server/api/handel');
const KS = require('../server/api/kasse');
const SN = require('../server/api/schnittstellen');
const ER = require('../server/api/erechnung');
const PDF = require('../server/pdf/belege');
const MAIL = require('../server/mail');
const { readZip } = require('../server/import/zip');

test.after(() => { dbm.closeAll(); fs.rmSync(tmp, { recursive: true, force: true }); });

let kunde;
test('Grunddaten', () => {
  dbm.get();
  L.setOpt('Anmeldung', '0');
  const f = dbm.get().prepare('SELECT ID FROM FIRMENDATEN').get();
  dbm.get().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Test-Werkstatt', STRASSE='Weg 1', PLZ='12345', ORT='Ort', EMAIL='info@test.de', TELEFON='0123', IBAN='DE02120300000000202051', USTNR='DE123456789' WHERE ID=?").run(f.ID);
  kunde = G.saveRec('kunden', null, { NAME: 'Kunde', VORNAME: 'Karl', STRASSE: 'Str. 2', PLZ: '54321', ORT: 'Stadt', EMAIL: 'k@example.org', ART: 0 });
});

test('Einkauf: Eingangsrechnung mit Lagerbuchung, Barzahlung und E-Rechnungs-Import', () => {
  const lief = G.saveRec('lieferanten', null, { NAME: 'Teilehandel GmbH' });
  const art = G.saveRec('artikel', null, { ARTNUMMER: 'OF-1', BEZEICHNUNG1: 'Ölfilter', LAGERFUEHRUNG: 1, LAGER: 2, MWST: 61 });
  const r = EK.save({ kopf: { LIEFID: lief.LIEFID, RECHNUNGSNR: 'ER-100', DATUM: L.today(), LAGERGEBUCHT: 1 }, pos: [{ ARTID: art.ARTID, ARTNUMMER: 'OF-1', BEZEICHNUNG: 'Ölfilter', MENGE: 10, EKNETTO: 4.5, STEUERSATZ: 19 }] });
  assert.strictEqual(r.kopf.NETTO, 45); assert.strictEqual(r.kopf.BRUTTO, 53.55);
  assert.strictEqual(G.getRec('artikel', art.ARTID).LAGER, 12);
  assert.strictEqual(G.getRec('artikel', art.ARTID).EKPNETTO, 4.5);
  // saving again does not book twice
  EK.save({ kopf: { ...r.kopf }, pos: r.pos });
  assert.strictEqual(G.getRec('artikel', art.ARTID).LAGER, 12);
  EK.addPayment({ EINGANGID: r.kopf.ID, BETRAG: 53.55, ART: 'bar' });
  assert.strictEqual(EK.load(r.kopf.ID).offen, 0);
  assert.strictEqual(dbm.get().prepare('SELECT ZAHLSTATUS FROM SW_EINGANG WHERE ID=?').get(r.kopf.ID).ZAHLSTATUS, 2);
  assert.ok(dbm.get().prepare("SELECT AUSGABEN FROM KASSENBUCH WHERE VERWENDUNG LIKE 'Barzahlung Eingangsrechnung%'").get().AUSGABEN === 53.55);
  assert.throws(() => EK.remove(r.kopf.ID), /Zahlungen/);
  // read our own invoice as an incoming e-invoice
  const t = VG.template('rechnung', { kunid: kunde.KUNID }); delete t.kopf._kunde;
  const re = VG.save('rechnung', { kopf: t.kopf, pos: [{ POSART: 'A', ARTNUMMER: 'OF-1', BEZEICHNUNG: 'Ölfilter', MENGE: 2, VKBRUTTO: 11.9, MWST: 61 }] });
  const x = ER.create(re.kopf.RECHNUNGID, 'ubl');
  const imp = EK.importErechnung(Buffer.from(x.xml), 'rechnung.xml');
  assert.strictEqual(imp.kopf.BRUTTO, 23.8);
  assert.strictEqual(imp.pos[0].ARTID, art.ARTID);
  assert.ok(imp.lieferantNeu);
  assert.throws(() => EK.importErechnung(Buffer.from(x.xml), 'rechnung.xml'), /bereits erfasst/);
  // stocktaking
  const inv = EK.inventurNeu({ NAME: 'Test' });
  const p = inv.pos.find(q => q.ARTIKELID === art.ARTID);
  EK.inventurSpeichern(inv.liste.LISTID, [{ LISTPOSID: p.LISTPOSID, ISTLAGER: 11, ISTEK: 4.5 }]);
  assert.strictEqual(EK.inventurBuchen(inv.liste.LISTID).korrekturen, 1);
  assert.strictEqual(G.getRec('artikel', art.ARTID).LAGER, 11);
});

test('Zeiterfassung: Stempeluhr, Monatsauswertung, Abschluss', () => {
  const b = G.saveRec('benutzer', null, { NAME: 'Monteur', VORNAME: 'Max', ZEITERFASSUNG: 1, PERSONALNR: '7', SOLLMO: 8, SOLLDI: 8, SOLLMI: 8, SOLLDO: 8, SOLLFR: 8, URLAUBSANSPRUCH: 30 });
  assert.match(ZT.stempeln({ PERSONALNR: '7', AKTION: 'kommen' }).meldung, /Willkommen/);
  assert.throws(() => ZT.stempeln({ PERSONALNR: '7', AKTION: 'kommen' }), /bereits/);
  assert.strictEqual(ZT.anwesenheit()[0].status, 'anwesend');
  ZT.stempeln({ PERSONALNR: '7', AKTION: 'gehen' });
  assert.throws(() => ZT.stempeln({ PERSONALNR: '99', AKTION: 'kommen' }), /Personalnummer/);
  // fixed month: March 2025 (Mon 3.3.)
  ZT.speichern({ BENID: b.BENUTZERID, ART: 'A', DATUM: '2025-03-03', BEGINN: '07:00', ENDE: '16:30' });
  ZT.speichern({ BENID: b.BENUTZERID, ART: 'P', DATUM: '2025-03-03', BEGINN: '12:00', ENDE: '12:30' });
  ZT.speichern({ BENID: b.BENUTZERID, ART: 'U', DATUM: '2025-03-04', BISDATUM: '2025-03-05' });
  const m = ZT.monat(b.BENUTZERID, '2025-03');
  const t3 = m.tage.find(t => t.datum === '2025-03-03');
  assert.strictEqual(t3.ist, 9); assert.strictEqual(t3.saldo, 1);
  assert.strictEqual(m.summe.urlaub, 2);
  assert.strictEqual(m.summe.soll, 21 * 8);
  ZT.monatsabschluss(b.BENUTZERID, '2025-03');
  assert.throws(() => ZT.speichern({ BENID: b.BENUTZERID, ART: 'A', DATUM: '2025-03-10', BEGINN: '07:00', ENDE: '15:00' }), /abgeschlossen/);
  assert.strictEqual(Object.keys(ZT.feiertage(2025, 'HE')).includes('2025-06-19'), true); // Corpus Christi
});

test('Fahrzeughandel: Kalkulation, Verkauf per Rechnung, Storno zurück ins Lager, Kaufvertrag', () => {
  const fz = G.saveRec('fahrzeuglager', null, { MARKE: 'VW', MODELL: 'Golf', FZIDENTNR: 'WVWZZZ1KZ123', EKP: 8000, VKPBRUTTO: 11900, EINKAUF: '2025-01-10', MWSTAUSWEISBAR: 0 });
  assert.strictEqual(fz.FRZTYP, 2);
  HD.aufwandSpeichern({ FAHRID: fz.FAHR_ID, BESCHREIBUNG: 'Bremsen', BETRAGNETTO: 500 });
  const k = HD.kalkulation(fz.FAHR_ID);
  assert.strictEqual(k.einsatz, 8500); assert.ok(k.diffbesteuert);
  assert.strictEqual(k.mwst, 542.86); // 19/119 of the margin 3400
  const t = VG.template('rechnung', { kunid: kunde.KUNID }); delete t.kopf._kunde;
  const re = VG.save('rechnung', { kopf: t.kopf, pos: [HD.position(fz.FAHR_ID, 'verkauf')] });
  assert.strictEqual(re.kopf.GBRUTTO, 11900); assert.strictEqual(re.kopf.GMWST1, 0);
  assert.strictEqual(G.getRec('fahrzeuge', fz.FAHR_ID).FRZTYP, 0);
  assert.ok(G.kundenFahrzeuge(kunde.KUNID).some(f => f.FAHR_ID === fz.FAHR_ID));
  assert.strictEqual(HD.statistik({ von: '2000-01-01', bis: '2099-12-31' }).rows.length, 1);
  assert.match(ER.create(re.kopf.RECHNUNGID, 'cii').xml, /VATEX-EU-F/);
  VG.storno(re.kopf.RECHNUNGID);
  assert.strictEqual(G.getRec('fahrzeuge', fz.FAHR_ID).FRZTYP, 2);
  const v = G.saveRec('kaufvertraege', null, { NUMMER: 1, ART: 'GW', DATUM: L.today(), KUNID: kunde.KUNID, FAHRID: fz.FAHR_ID, KAUFPREIS: 11500, ANZAHLUNG: 1000 });
  assert.ok(JSON.parse(v.FAHRZEUG).fin);
  assert.throws(() => G.saveRec('kaufvertraege', v.ID, { ...v, GEWAEHRLEISTUNG: 2 }), /Verbraucher/);
  const rv = HD.vertragRechnung(v.ID);
  assert.strictEqual(VG.load('rechnung', rv.id).offen, 10500);
});

test('Kasse: Barverkauf mit Rechnung, Storno, Einzahlung, Abschluss mit Differenz, DSFinV-K', async () => {
  const b1 = await KS.bon({ positionen: [{ POSART: 'A', BEZEICHNUNG: 'Scheibenreiniger', MENGE: 2, EINZEL: 5.95, MWST: 61 }, { POSART: 'A', BEZEICHNUNG: 'Kaffee', MENGE: 1, EINZEL: 2, MWST: 62 }], zahlart: 'BAR', gegeben: 20 });
  assert.strictEqual(b1.bon.BRUTTO, 13.9); assert.strictEqual(b1.bon.RUECKGELD, 6.1);
  assert.ok(b1.bon.RECHNUNGID);
  assert.strictEqual(VG.load('rechnung', b1.bon.RECHNUNGID).offen, 0);
  assert.strictEqual(b1.ust.length, 2);
  await KS.bewegung({ typ: 'Einzahlung', betrag: 100, verwendung: 'Wechselgeld' });
  const b2 = await KS.bon({ positionen: [{ POSART: 'L', BEZEICHNUNG: 'Reifenwechsel', MENGE: 1, EINZEL: 40, MWST: 61 }], zahlart: 'EC' });
  const st = await KS.storno(b2.bon.ID, { rechnungskorrektur: true });
  assert.strictEqual(st.bon.BRUTTO, -40);
  await assert.rejects(() => KS.storno(b2.bon.ID, {}), /bereits/);
  const v = KS.abschlussVorschau();
  assert.strictEqual(v.soll, 113.9);
  const a = await KS.abschluss({ ist: 113.5, zaehlprotokoll: { '50': 2, '10': 1, '2': 1, '1': 1, '0.5': 1 } });
  assert.strictEqual(a.DIFFERENZ, -0.4);
  assert.strictEqual(KS.bestand(), 113.5);
  const ds = KS.dsfinvk({});
  const z = readZip(ds.buffer);
  for (const f of ['cashpointclosing.csv', 'transactions.csv', 'lines.csv', 'transactions_tse.csv', 'index.xml']) assert.ok(z.entries.some(e => e.name === f), f);
});

test('Anzahlung und Schlussrechnung, Sammelrechnung', () => {
  const t = VG.template('auftrag', { kunid: kunde.KUNID }); delete t.kopf._kunde; t.kopf.ANSICHTBRUTTO = 0;
  const auf = VG.save('auftrag', { kopf: t.kopf, pos: [{ POSART: 'L', BEZEICHNUNG: 'Motorinstandsetzung', MENGE: 1, VK: 2000, MWST: 61 }] });
  const anz = VG.anzahlungSpeichern({ AUFTRAGID: auf.kopf.AUFTRAGID, ART: 1, NETTO: 500, MWST: 61, BEZEICHNUNG: 'Anzahlung' });
  const ar = VG.anzahlungRechnung(anz.rows[0].ID);
  assert.strictEqual(VG.load('rechnung', ar.id).kopf.GBRUTTO, 595);
  const sr = VG.convert('auftrag', auf.kopf.AUFTRAGID, 'rechnung', 'wandeln');
  const s = VG.load('rechnung', sr.id);
  assert.strictEqual(s.kopf.GNETTO, 1500); assert.strictEqual(s.kopf.GBRUTTO, 1785); assert.strictEqual(s.kopf.DRUCKFORMULAR, 'schluss');
  const mk = () => { const x = VG.template('lieferschein', { kunid: kunde.KUNID }); delete x.kopf._kunde; return VG.save('lieferschein', { kopf: x.kopf, pos: [{ POSART: 'A', BEZEICHNUNG: 'Teil', MENGE: 1, VKBRUTTO: 10, MWST: 61 }] }).kopf.LIEFERSCHEINID; };
  const ids = [mk(), mk()];
  const sam = VG.sammelrechnung('lieferschein', ids);
  const r = VG.load('rechnung', sam.id);
  assert.strictEqual(r.kopf.GBRUTTO, 20); assert.strictEqual(r.pos.filter(p => p.POSART === 'T').length, 2);
  assert.throws(() => VG.sammelrechnung('lieferschein', ids), /bereits/);
});

test('Nettorechnung für Auslandskunden (Reverse Charge) in der E-Rechnung', () => {
  const k = G.saveRec('kunden', null, { NAME: 'NL Transport BV', ART: 1, STRASSE: 'Weg 3', PLZ: '1000', ORT: 'Amsterdam', LAND: 'NL', USTID: 'NL123456789B01', EMAIL: 'nl@example.org', NETTORECHNUNG: 1, EXPORTART: 'REVERSE_CHARGE' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  assert.strictEqual(t.kopf.STEUERART, 'REVERSE_CHARGE');
  const r = VG.save('rechnung', { kopf: t.kopf, pos: [{ POSART: 'L', BEZEICHNUNG: 'Reparatur', MENGE: 1, VK: 100, MWST: 61 }] });
  assert.strictEqual(r.kopf.GBRUTTO, 100);
  const x = ER.create(r.kopf.RECHNUNGID, 'cii').xml;
  assert.match(x, /<ram:CategoryCode>AE<\/ram:CategoryCode><ram:ExemptionReasonCode>VATEX-EU-AE/);
});

test('Rechnungsnummern: fortlaufend, nicht von Hand änderbar', () => {
  const pos = [{ POSART: 'L', BEZEICHNUNG: 'Arbeit', MENGE: 1, VK: 10, MWST: 61 }];
  const t = VG.template('rechnung');
  const a = VG.save('rechnung', { kopf: { ...t.kopf, RECHNUNGNUMMER: 99999999 }, pos });
  assert.notStrictEqual(a.kopf.RECHNUNGNUMMER, 99999999, 'eingetippte Nummer wird ignoriert');
  const b = VG.save('rechnung', { kopf: { ...VG.template('rechnung').kopf }, pos });
  assert.strictEqual(b.kopf.RECHNUNGNUMMER, a.kopf.RECHNUNGNUMMER + 1, 'keine Lücke');
  const c = VG.save('rechnung', { kopf: { ...a.kopf, RECHNUNGNUMMER: 12345 }, pos });
  assert.strictEqual(c.kopf.RECHNUNGNUMMER, a.kopf.RECHNUNGNUMMER, 'bestehende Rechnung behält ihre Nummer');
});

test('Datenimport: CSV-Assistent, DATANORM, Warenkorb', () => {
  const csv = Buffer.from('Nr;Name;Vorname;Ort;Telefon\n5001;Becker;Anna;Bonn;0228-1\n5002;Schmidt;Jan;Köln;\n', 'latin1');
  const v = SN.vorschau(csv);
  assert.strictEqual(v.delim, ';'); assert.strictEqual(v.zeilen, 3);
  const r = SN.importieren('kunden', csv, { ersteZeileUeberspringen: true, zuordnung: { NUMMER: 0, NAME: 1, VORNAME: 2, ORT: 3, TELEFON: 4 } });
  assert.deepStrictEqual([r.neu, r.geaendert], [2, 0]);
  assert.strictEqual(dbm.get().prepare('SELECT ORT FROM KUNDEN WHERE NUMMER=5002').get().ORT, 'Köln');
  const r2 = SN.importieren('kunden', csv, { ersteZeileUeberspringen: true, zuordnung: { NUMMER: 0, NAME: 1 } });
  assert.strictEqual(r2.geaendert, 2);
  const dn = Buffer.from('V;040;Teilehandel\nA;N;BR-123;00;Bremsscheibe vorne;Satz 2 Stück;1;0;Satz;8990;;;\nA;N;FI-9;00;Luftfilter;;2;0;Stk;1250;;;\nB;N;BR-123;BREMS;;;;;4012345678901;\n', 'latin1');
  const d = SN.datanorm(dn, { aufschlag: 40 });
  assert.strictEqual(d.neu, 2);
  const a = dbm.get().prepare("SELECT * FROM ARTIKEL WHERE ARTNUMMER='BR-123'").get();
  assert.strictEqual(a.VKPNETTO, 89.9); assert.strictEqual(a.EAN, '4012345678901');
  assert.strictEqual(dbm.get().prepare("SELECT VKPNETTO FROM ARTIKEL WHERE ARTNUMMER='FI-9'").get().VKPNETTO, 17.5);
  const w = SN.warenkorb(Buffer.from('Artikelnummer;Hersteller;Bezeichnung;Menge;VK;EK\n0 986 4B0 6;Bosch;Ölfilter;2;12,50;6,10\n', 'utf8'));
  assert.deepStrictEqual([w[0].artnr, w[0].bezeichnung, w[0].menge, w[0].preis, w[0].ek], ['0 986 4B0 6', 'Bosch Ölfilter', 2, 12.5, 6.1]);
});

test('PDF und ZUGFeRD: Anhang eingebettet', () => {
  const r = dbm.get().prepare('SELECT RECHNUNGID FROM RECHNUNGEN WHERE TYP=1 ORDER BY RECHNUNGID LIMIT 1').get();
  const z = PDF.zugferd(r.RECHNUNGID);
  const s = z.pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.7'));
  assert.match(s, /\/AFRelationship \/Alternative/);
  assert.match(s, /fx:ConformanceLevel>XRECHNUNG/);
  assert.ok(require('../server/xml').xmlFromPdf(z.pdf).includes('CrossIndustryInvoice'));
});

test('E-Mail per SMTP mit Anhang', async () => {
  let received = '';
  const srv = net.createServer(sock => {
    sock.write('220 test ESMTP\r\n');
    let data = false; let buf = '';
    sock.on('data', d => {
      buf += d.toString();
      if (data) { if (buf.includes('\r\n.\r\n')) { received = buf; data = false; buf = ''; sock.write('250 OK queued\r\n'); } return; }
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^EHLO/.test(line)) sock.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) sock.write(Buffer.from(line.slice(11), 'base64').toString() === '\0user\0pass' ? '235 ok\r\n' : '535 fail\r\n');
        else if (/^MAIL|^RCPT/.test(line)) sock.write('250 ok\r\n');
        else if (/^DATA/.test(line)) { sock.write('354 go\r\n'); data = true; }
        else if (/^QUIT/.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    await MAIL.send({ to: 'kunde@example.org', subject: 'Rechnung Nr. 1 – Prüfung äöü', text: 'Hallo', attachments: [{ filename: 'Rechnung.pdf', content: Buffer.from('%PDF-test'), contentType: 'application/pdf' }] },
      { host: '127.0.0.1', port: srv.address().port, secure: 'none', user: 'user', pass: 'pass', from: 'info@test.de', fromName: 'Test-Werkstatt' });
    assert.match(received, /Subject: =\?UTF-8\?B\?/);
    assert.match(received, /filename="Rechnung.pdf"/);
    assert.match(received, new RegExp(Buffer.from('%PDF-test').toString('base64')));
    await assert.rejects(() => MAIL.send({ to: 'x@example.org', subject: 's', text: 't' }, { host: '127.0.0.1', port: srv.address().port, secure: 'none', user: 'user', pass: 'falsch', from: 'a@b.de' }), /Anmeldung/);
  } finally { srv.close(); }
});

test('Mandanten: getrennte Datenbanken', () => {
  dbm.saveMandanten([{ id: 1, name: 'Mandant 1' }, { id: 2, name: 'Zweitbetrieb' }]);
  const n1 = dbm.get().prepare('SELECT COUNT(*) n FROM KUNDEN').get().n;
  const n2 = dbm.runAs(2, () => dbm.get().prepare('SELECT COUNT(*) n FROM KUNDEN').get().n);
  assert.ok(n1 > 0); assert.strictEqual(n2, 0);
  dbm.runAs(2, () => G.saveRec('kunden', null, { NAME: 'Nur im Zweitbetrieb' }));
  assert.strictEqual(dbm.get().prepare("SELECT COUNT(*) n FROM KUNDEN WHERE NAME='Nur im Zweitbetrieb'").get().n, 0);
  assert.ok(fs.existsSync(path.join(tmp, 'mandanten', '2', 'kuenta.db')));
});
void zlib;

test('TSE (fiskaly-Protokoll) und EC-Terminal (ZVT) gegen simulierte Gegenstellen', async () => {
  const http = require('http');
  const TSE = require('../server/kasse/tse');
  const ZVT = require('../server/kasse/zvt');
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      const body = b ? JSON.parse(b) : {}; calls.push(`${req.method} ${req.url.replace(/[0-9a-f-]{36}/g, 'ID')}`);
      const j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/auth') return j({ access_token: 'tok', access_token_expires_in: 600 });
      if (req.headers.authorization !== 'Bearer tok') { res.writeHead(401); return res.end('{}'); }
      if (/\/tx\//.test(req.url) && /tx_revision=2/.test(req.url)) return j({ number: 7, time_start: 1762600000, time_end: 1762600001, tss_serial_number: 'SERIAL1', qr_code_data: 'V0;KASSE1;Kassenbeleg-V1;Beleg^5.95_0.00_0.00_0.00_0.00^5.95:Bar;7;1;1762600000;1762600001;ecdsa;unixTime;SIG;PUB', signature: { value: 'SIG', counter: 1, algorithm: 'ecdsa-plain-SHA384', public_key: 'PUB' }, log: { timestamp_format: 'unixTime' }, process_data: Buffer.from('Beleg^5.95_0.00_0.00_0.00_0.00^5.95:Bar').toString('base64'), _receipt: body.schema });
      if (/\/tx\//.test(req.url)) return j({ state: 'ACTIVE' });
      if (/\/client\//.test(req.url)) return j({ serial_number: body.serial_number });
      if (/\/admin/.test(req.url)) return j({});
      if (req.method === 'PUT' && /\/tss\/[^/]+$/.test(req.url)) return j({ state: 'CREATED', admin_puk: 'PUK123' });
      if (req.method === 'PATCH') return j({ state: body.state, serial_number: 'SERIAL1', public_key: 'PUB', signature_algorithm: 'ecdsa-plain-SHA384' });
      j({});
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    L.setSw('tse.url', `http://127.0.0.1:${srv.address().port}`); L.setSw('tse.apikey', 'k'); L.setSw('tse.apisecret', 's');
    TSE._reset();
    const e = await TSE.einrichten({ adminPin: '123456' });
    assert.strictEqual(e.puk, 'PUK123');
    assert.ok(calls.includes('PATCH /tss/ID/admin') && calls.includes('PUT /tss/ID/client/ID'));
    const bon = await KS.bon({ positionen: [{ BEZEICHNUNG: 'Test', MENGE: 1, EINZEL: 5.95, MWST: 61 }], zahlart: 'BAR' });
    assert.strictEqual(bon.bon.TSE_SIGNATUR, 'SIG'); assert.strictEqual(bon.bon.TSE_ZAEHLER, 1); assert.match(bon.bon.TSE_QR, /^V0;/);
    assert.ok(calls.some(c => /tx_revision=2/.test(c)));
    srv.close();
    const b2 = await KS.bon({ positionen: [{ BEZEICHNUNG: 'Ausfall', MENGE: 1, EINZEL: 1, MWST: 61 }], zahlart: 'BAR' });
    assert.match(b2.bon.TSE_FEHLER, /TSE ausgefallen/);
  } finally { srv.close(); L.setSw('tse.aktiv', '0'); }
  // ZVT: terminal confirms registration and payment
  const seen = [];
  const term = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 3) { // evaluate APDUs one by one
        const len = buf[2]; if (buf.length < 3 + len) break;
        const apdu = buf.subarray(0, 3 + len); buf = buf.subarray(3 + len);
        seen.push(apdu.toString('hex'));
        if (apdu[0] === 0x06 && (apdu[1] === 0x00 || apdu[1] === 0x01)) { sock.write(Buffer.from([0x80, 0x00, 0x00])); sock.write(Buffer.from([0x04, 0x0f, 0x00])); sock.write(Buffer.from([0x06, 0x0f, 0x00])); }
      }
    });
  });
  await new Promise(r => term.listen(0, '127.0.0.1', r));
  try {
    L.setSw('ec.ip', '127.0.0.1'); L.setSw('ec.port', String(term.address().port));
    const r = await ZVT.zahlen(12.34);
    assert.ok(r.ok);
    assert.ok(seen.some(h => h.startsWith('0601') && h.includes('000000001234')), 'Betrag als BCD gesendet');
  } finally { term.close(); }
});

test('E-Mail: Übergabe an das Mailprogramm (Thunderbird-Aufruf und Entwurf)', () => {
  const MC = require('../server/mailclient');
  const file = path.join(tmp, 'Rechnung_1.pdf');
  const arg = MC.composeArg({ to: 'a@x.de; b@y.de', cc: '', bcc: 'kopie@werkstatt.de', subject: "Rechnung Nr. 1 – Müller's Auto", bodyFile: 'C:\temp\nachricht.html', files: [file] });
  assert.match(arg, /^to='a@x\.de,b@y\.de',bcc='kopie@werkstatt\.de',subject='Rechnung Nr\. 1 – Müller’s Auto',message='C:\temp\nachricht\.html',attachment='file:\/\//);
  assert.ok(!arg.includes('cc=\'\''));
  assert.strictEqual((arg.match(/'/g) || []).length % 2, 0);
  assert.strictEqual(MC.textToHtml('Hallo <Kunde>\nZeile 2'), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>Hallo &lt;Kunde&gt;<br>\nZeile 2</body></html>');
  const eml = MAIL.buildMessage({ from: '', to: 'k@example.org', bcc: 'kopie@werkstatt.de', subject: 'Test', text: 'x', unsent: true });
  assert.match(eml, /X-Unsent: 1/); assert.match(eml, /Bcc: kopie@werkstatt\.de/); assert.doesNotMatch(eml, /^From:/m);
  const sent = MAIL.buildMessage({ from: 'a@b.de', to: 'k@example.org', bcc: 'geheim@b.de', subject: 'Test', text: 'x' });
  assert.doesNotMatch(sent, /X-Unsent|Bcc:/);
  assert.ok(MC.isLocalRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }));
  assert.ok(!MC.isLocalRequest({ socket: { remoteAddress: '203.0.113.9' } }));
});

test('KFZ-Import: KuentaPOS-eigene Daten bleiben erhalten', () => {
  const { DatabaseSync } = require('node:sqlite');
  const KFZ = require('../server/import/kfz');
  const d = dbm.get();
  // create the "last import" state and KuentaPOS's own data
  d.prepare("INSERT OR REPLACE INTO SW_EINSTELLUNGEN (SCHLUESSEL, WERT) VALUES ('import.datum', ?)").run(new Date(Date.now() - 3600e3).toISOString());
  L.setSw('mail.versand', 'programm');
  d.prepare("INSERT INTO SW_TERMINE (BEGINN, TITEL) VALUES ('2026-11-10 08:00', 'Ölwechsel Testkunde')").run();
  const kunid = d.prepare('SELECT KUNID FROM KUNDEN ORDER BY KUNID LIMIT 1').get().KUNID;
  d.prepare("INSERT INTO SW_DOKUMENTE (BEZUG, BEZUGID, DATEINAME, PFAD) VALUES ('KUNDE', ?, 'eigen.pdf', 'dokumente/kunde/x/eigen.pdf')").run(kunid);
  d.prepare("UPDATE KUNDEN SET ERECHNUNG=3, LEITWEGID='991-12345-67', AENDERUNGSDATUM=? WHERE KUNID=?").run(L.now(), kunid);
  d.prepare("UPDATE FIRMENDATEN SET HANDELSREGISTER='HRB 4711'").run();

  const v = KFZ.importVorschau();
  assert.ok(v.ersetzt.some(e => e.tabelle === 'KUNDEN'), 'geänderter Kunde wird gemeldet');
  assert.ok(v.bleibt.some(e => e.tabelle === 'SW_TERMINE'));

  // simulate a "fresh import": empty database with a customer from the backup (without KuentaPOS columns) and a document from the backup
  const tmpDb = path.join(tmp, 'import-test.db');
  const n = new DatabaseSync(tmpDb);
  dbm.initSchema(n);
  n.prepare("INSERT INTO KUNDEN (KUNID, NAME) VALUES (?, 'Kunde aus KFZ-Faktura')").run(kunid);
  n.prepare("INSERT INTO FIRMENDATEN (ID, FIRMENNAME) VALUES (1, 'Werkstatt laut Sicherung')").run();
  n.prepare("INSERT INTO SW_DOKUMENTE (BEZUG, DATEINAME, PFAD) VALUES ('KUNDE', 'aus-sicherung.pdf', 'dokumente/kunde/1/a.pdf')").run();
  n.prepare("INSERT INTO SW_EINSTELLUNGEN (SCHLUESSEL, WERT) VALUES ('import.datum', 'neu')").run();
  n.close();
  const own = { KUNDEN: ['LEITWEGID', 'ERECHNUNG', 'EMAILRECHNUNG', 'AKTIV'], FIRMENDATEN: ['HANDELSREGISTER'] };
  const r = KFZ.keepKuentaPOSData(tmpDb, own);
  assert.ok(r.tabellen.SW_TERMINE >= 1);

  const c = new DatabaseSync(tmpDb);
  const k = c.prepare('SELECT NAME, ERECHNUNG, LEITWEGID FROM KUNDEN WHERE KUNID=?').get(kunid);
  assert.strictEqual(k.NAME, 'Kunde aus KFZ-Faktura');        // master data from the backup
  assert.strictEqual(k.ERECHNUNG, 3);                          // KuentaPOS field kept
  assert.strictEqual(k.LEITWEGID, '991-12345-67');
  assert.strictEqual(c.prepare('SELECT FIRMENNAME, HANDELSREGISTER FROM FIRMENDATEN').get().HANDELSREGISTER, 'HRB 4711');
  assert.strictEqual(c.prepare("SELECT WERT FROM SW_EINSTELLUNGEN WHERE SCHLUESSEL='mail.versand'").get().WERT, 'programm');
  assert.strictEqual(c.prepare("SELECT WERT FROM SW_EINSTELLUNGEN WHERE SCHLUESSEL='import.datum'").get().WERT, 'neu'); // import state not written back
  assert.strictEqual(c.prepare("SELECT COUNT(*) n FROM SW_TERMINE WHERE TITEL='Ölwechsel Testkunde'").get().n, 1);
  const docs = c.prepare('SELECT DATEINAME FROM SW_DOKUMENTE ORDER BY ID').all().map(x => x.DATEINAME);
  assert.ok(docs.includes('aus-sicherung.pdf') && docs.includes('eigen.pdf'));
  c.close();
});

test('Datenordner auf Netzlaufwerk wird erkannt', async () => {
  const D = require('../server/datenordner');
  const m = [{ mount: '/', type: 'ext4' }, { mount: '/mnt/nas', type: 'cifs' }];
  assert.strictEqual(D.typAusMounts('/mnt/nas/kuentapos', m), 'cifs');
  assert.strictEqual(D.typAusMounts('/mnt/nasx/kuentapos', m), 'ext4');
  if (process.platform === 'win32') assert.strictEqual(await D.istNetzlaufwerk(String.raw`\\nas\freigabe\kuentapos`), true);
  assert.strictEqual(await D.warnung(tmp), null);
});
