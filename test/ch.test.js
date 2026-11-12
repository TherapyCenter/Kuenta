'use strict';
// Swiss tax system: UID check, MWST rates, CHF, texts, QR-bill (payload, references, PDF payment part),
// cash rounding to 5 centimes, MWST return (effective and net tax rate method).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTAPOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-ch-'));
process.env.KUENTAPOS_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const NIF = require('../public/js/nif.js');
const Q = require('../server/ch/qrbill');

test('UID check', () => {
  assert.deepStrictEqual(NIF.chUid('CHE-116.281.710 MWST'), { ok: true, uid: 'CHE-116.281.710' });
  assert.ok(NIF.chUid('che116281710').ok);
  assert.ok(!NIF.chUid('CHE-116.281.711').ok);
});

test('QR-bill references and IBAN', () => {
  assert.strictEqual(Q.mod10('21000000000313947143000901'), '7');
  assert.strictEqual(Q.qrReferenz('2026-0815').length, 27);
  assert.strictEqual(Q.scor('539007547034'), 'RF18539007547034');
  assert.ok(Q.scorOk(Q.scor('R-1234')));
  assert.ok(Q.ibanOk('CH93 0076 2011 6238 5295 7'));
  assert.ok(!Q.ibanOk('DE89370400440532013000'));
  assert.ok(Q.istQrIban('CH4431999123000889012'));
  assert.ok(!Q.istQrIban('CH9300762011623852957'));
});

let rid;
test('Switzerland: rates, CHF, texts, QR-bill, PDF', () => {
  L.setSw('steuer.land', 'CH');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Garage Muster AG', USTNR='CHE-116.281.710', STRASSE='Bahnhofstrasse 12', PLZ='8001', ORT='Zürich', LAND='CH', EMAIL='info@example.ch', TELEFON='044 123 45 67', IBAN='CH93 0076 2011 6238 5295 7', HANDELSREGISTER='Handelsregister des Kantons Zürich'").run();
  assert.deepStrictEqual(L.mwstRates(), { 61: 8.1, 62: 2.6, 63: 0, 64: 3.8 });
  assert.strictEqual(L.waehrung(), 'CHF');
  assert.strictEqual(L.geld(1234.5, 'de-DE'), "CHF 1'234.50");
  assert.strictEqual(G.lookups().waehrung, 'CHF');
  const k = G.saveRec('kunden', null, { NAME: 'Meier', VORNAME: 'Hans', ART: 0, STRASSE: 'Seestrasse 7', PLZ: '8800', ORT: 'Thalwil', LAND: 'CH' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0 }, pos: [
    { POSART: 'L', BEZEICHNUNG: 'Service', MENGE: 1, VK: 200, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Strassenverkehrsamt (DP)', MENGE: 1, VK: 60, MWST: 63, DURCHLAUFER: 1 }] });
  assert.strictEqual(r.kopf.GBRUTTO, 216.2 + 60);
  rid = r.kopf.RECHNUNGID;
  const d = VG.load('rechnung', rid);
  assert.strictEqual(d.lx.ustLabel, 'MWST');
  assert.deepStrictEqual(d.lx.pied, ['MWST-Nr.: CHE-116.281.710 MWST']);
  assert.ok(d.lx.mentions.some(m => /Art. 24 Abs. 6 Bst. b MWSTG/.test(m)));
  const q = d.lx.qr;
  const lines = q.payload.split('\n');
  assert.deepStrictEqual(lines.slice(0, 11), ['SPC', '0200', '1', 'CH9300762011623852957', 'S', 'Garage Muster AG', 'Bahnhofstrasse', '12', '8001', 'Zürich', 'CH']);
  assert.deepStrictEqual(lines.slice(18, 20), ['276.20', 'CHF']);
  assert.deepStrictEqual(lines.slice(20, 27), ['S', 'Meier, Hans', 'Seestrasse', '7', '8800', 'Thalwil', 'CH']);
  assert.strictEqual(lines[27], 'SCOR');
  assert.ok(Q.scorOk(lines[28]));
  assert.strictEqual(lines[lines.length - 1], 'EPD');
  assert.strictEqual(lines.length, 31);
  assert.strictEqual(q.konto, 'CH93 0076 2011 6238 5295 7');
  // QR-IBAN: QR reference with check digit
  L.setSw('ch.qr.iban', 'CH4431999123000889012');
  const q2 = VG.load('rechnung', rid).lx.qr;
  assert.strictEqual(q2.refTyp, 'QRR');
  const ref = q2.payload.split('\n')[28];
  assert.match(ref, /^\d{27}$/);
  assert.strictEqual(Q.mod10(ref.slice(0, 26)), ref[26]);
  L.setSw('ch.qr.iban', '');
  // PDF: payment part without the footer on that page
  const pdf = require('../server/pdf/belege').vorgangPdf('rechnung', d);
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
});

test('cash register: rounding to 5 centimes for cash', async () => {
  const KS = require('../server/api/kasse');
  const b = await KS.bon({ zahlart: 'BAR', gegeben: 20, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Glühbirne', MENGE: 1, EINZEL: 12.32, MWST: 61 }] });
  assert.strictEqual(b.bon.BRUTTO, 12.3);
  assert.ok(b.pos.some(p => p.BEZEICHNUNG === 'Rundungsdifferenz' && Math.abs(p.BRUTTO + 0.02) < 1e-9));
  assert.strictEqual(b.bon.RUECKGELD, 7.7);
  const karte = await KS.bon({ zahlart: 'KARTE', positionen: [{ POSART: 'A', BEZEICHNUNG: 'Glühbirne', MENGE: 1, EINZEL: 12.32, MWST: 61 }] });
  assert.strictEqual(karte.bon.BRUTTO, 12.32, 'card payments are not rounded');
  assert.strictEqual(b.at, null);
});

test('MWST return: Ziffern, effective and net tax rate method', () => {
  const M = require('../server/ch/mwst');
  const von = '2000-01-01', bis = '2999-12-31';
  const r = M.calcular({ von, bis });
  const z = r.ziffern;
  assert.strictEqual(z['299'], Math.round((z['200'] - z['289']) * 100) / 100);
  const n = r.steuer.find(s => s.ziffer === '303');
  assert.ok(n.umsatz >= 200);
  assert.ok(Math.abs(n.steuer - n.umsatz * 0.081) < 0.05, 'tax as on the invoices (rounded per invoice)');
  assert.ok(r.durchlaufend >= 60);
  assert.strictEqual(z['500'], Math.max(0, Math.round((z['399'] - z['479']) * 100) / 100));
  L.setSw('ch.methode', 'saldo'); L.setSw('ch.saldo1', '6.2');
  const s = M.calcular({ von, bis });
  assert.strictEqual(s.steuer[0].ziffer, '322');
  assert.strictEqual(s.steuer[0].steuer, Math.round(s.ziffern['299'] * 6.2) / 100);
  assert.strictEqual(s.ziffern['400'], 0);
  const csv = M.csv({ von, bis }).buffer.toString('utf8');
  assert.match(csv, /^﻿Ziffer;Bezeichnung/);
  L.setSw('ch.methode', 'effektiv');
  L.setOpt('Kleinunternehmer', '1');
  assert.throws(() => M.calcular({ von, bis }), /nicht MWST-pflichtig/);
  assert.strictEqual(L.mwstRates()[61], 0);
  L.setOpt('Kleinunternehmer', '0');
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.waehrung(), 'EUR');
  dbm.closeAll();
});
