'use strict';
// French tax system: SIREN check, TVA, legal mentions, lock of printed invoices, Factur-X EN 16931,
// cash register journal (signatures, chain, grand totals, closures, duplicates, archive, restore), FEC, Chorus Pro.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-fr-'));
process.env.KUENTA_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const BK = require('../server/backup');
const NIF = require('../public/js/nif.js');
const FRC = require('../server/fr/caisse');
const CH = require('../server/fr/chorus');

test('SIREN and SIRET check', () => {
  assert.ok(NIF.frSiren('732 829 320').ok);
  assert.ok(NIF.frSiren('73282932000074').ok);
  assert.ok(!NIF.frSiren('732829321').ok);
  assert.ok(!NIF.frSiren('12345').ok);
});

let rid, kunid;
test('France: TVA, mentions, lock, Factur-X', () => {
  assert.strictEqual(L.mwstRates()[61], 19);
  L.setSw('steuer.land', 'FR'); L.setSw('fr.forme', 'SARL'); L.setSw('fr.capital', '10 000 €'); L.setSw('fr.rcs', 'RCS Lyon 732 829 320');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Garage du Centre', STEUERNR='73282932000074', USTNR='FR44732829320', STRASSE='1 rue de la Paix', PLZ='69001', ORT='Lyon', LAND='FR', EMAIL='garage@example.fr', TELEFON='0400000000', IBAN='FR7630006000011234567890189'").run();
  assert.deepStrictEqual(L.mwstRates(), { 61: 20, 62: 10, 63: 0, 64: 5.5 });
  assert.strictEqual(G.lookups().land, 'FR');
  const k = G.saveRec('kunden', null, { NAME: 'Transports Martin SAS', ART: 1, SIREN: '73282932000074', USTID: 'FR44732829320', STRASSE: '2 avenue Foch', PLZ: '75008', ORT: 'Paris', LAND: 'FR', EMAIL: 'compta@example.fr', LEITWEGID: 'SERV01' });
  kunid = k.KUNID;
  const t = VG.template('rechnung', { kunid }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, BESTELLNR: 'ENG-42' }, pos: [
    { POSART: 'L', BEZEICHNUNG: 'Révision', MENGE: 1, VK: 100, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Filtre à huile', MENGE: 1, VK: 20, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Carte grise (débours)', MENGE: 1, VK: 50, MWST: 63, DURCHLAUFER: 1 }] });
  assert.strictEqual(r.kopf.GBRUTTO, 194);
  rid = r.kopf.RECHNUNGID;
  const m = r.fr.mentions.join('\n');
  assert.match(m, /Nature des opérations : opérations mixtes/);
  assert.match(m, /Débours, hors champ de la TVA/);
  assert.match(m, /Pas d'escompte/);
  assert.match(m, /trois fois le taux d'intérêt légal/);
  assert.match(m, /Indemnité forfaitaire pour frais de recouvrement : 40 €/);
  assert.deepStrictEqual(r.fr.pied.slice(0, 3), ['SARL au capital de 10 000 €', 'RCS Lyon 732 829 320', 'SIRET 732 829 320 00074']);
  assert.strictEqual(r.fr.sirenClient, '73282932000074');
  // printed invoices are locked in France
  VG.setFlag('rechnung', [rid], 'GEDRUCKT', 1);
  assert.throws(() => VG.save('rechnung', { kopf: VG.load('rechnung', rid).kopf, pos: r.pos }), /gesperrt/);
  // Factur-X EN 16931
  const x = require('../server/api/erechnung').create(rid, 'cii');
  assert.deepStrictEqual(x.problems, []);
  assert.match(x.xml, /<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>M1<\/ram:ID>/);
  assert.match(x.xml, /<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017<\/ram:ID>/);
  assert.match(x.xml, /<ram:SubjectCode>PMT<\/ram:SubjectCode>/);
  assert.match(x.xml, /<ram:SubjectCode>PMD<\/ram:SubjectCode>/);
  assert.match(x.xml, /<ram:SubjectCode>AAB<\/ram:SubjectCode>/);
  assert.match(x.xml, /<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">732829320<\/ram:ID>/);
  assert.match(x.xml, /<ram:SpecifiedLegalOrganization><ram:ID schemeID="0009">73282932000074<\/ram:ID>/);
  const z = require('../server/pdf/belege').zugferd(rid);
  assert.ok(z.pdf.includes(Buffer.from('factur-x.xml')));
  assert.ok(z.pdf.includes(Buffer.from('EN 16931')));
});

test('franchise en base: no TVA and its mention', () => {
  L.setOpt('Kleinunternehmer', '1');
  assert.strictEqual(L.mwstRates()[61], 0);
  assert.ok(require('../server/fr').mentions('rechnung', {}, []).includes('TVA non applicable, art. 293 B du CGI.'));
  L.setOpt('Kleinunternehmer', '0');
});

test('cash register: signed chain, grand totals, closures, duplicate, archive, restore', async () => {
  const KS = require('../server/api/kasse');
  const b1 = await KS.bon({ zahlart: 'BAR', gegeben: 50, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Ampoule', MENGE: 2, EINZEL: 12, MWST: 61 }] });
  assert.ok(b1.fr && b1.fr.nr === 1 && b1.fr.court.length === 4);
  const b2 = await KS.bon({ zahlart: 'BAR', gegeben: 10, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Essuie-glace', MENGE: 1, EINZEL: 8.5, MWST: 61 }] });
  await KS.storno(b2.bon.ID, {});
  const tickets = FRC.liste({ typ: 'ticket' });
  assert.strictEqual(tickets.length, 3);
  assert.strictEqual(tickets[0].GT, 24, '24 + 8.50 - 8.50');
  assert.strictEqual(tickets[0].GTABS, 41);
  assert.deepStrictEqual(FRC.duplicata(b1.bon.ID), { numero: 1 });
  assert.deepStrictEqual(FRC.duplicata(b1.bon.ID), { numero: 2 });
  await KS.abschluss({ ist: KS.status().bestand });
  const j = FRC.liste({ typ: 'cloture_j' });
  assert.strictEqual(j.length, 1);
  assert.strictEqual(JSON.parse(j[0].DATEN).tickets, 3);
  assert.strictEqual(FRC.cloture('M', L.today().slice(0, 7)).TYP, 'cloture_m');
  let v = FRC.verifier();
  assert.ok(v.ok, v.erreurs.join(', '));
  // manipulation is detected
  const d = L.db(); const t1 = d.prepare("SELECT * FROM SW_FR_JOURNAL WHERE TYP='ticket' AND NR=1").get();
  d.prepare("UPDATE SW_FR_JOURNAL SET TOTAL=1 WHERE ID=?").run(t1.ID);
  v = FRC.verifier();
  assert.ok(!v.ok && v.erreurs.some(e => /ticket 1: signature invalide/.test(e)));
  d.prepare('UPDATE SW_FR_JOURNAL SET TOTAL=? WHERE ID=?').run(t1.TOTAL, t1.ID);
  // archive with signature and public key
  const a = FRC.archive({ von: '2000-01-01', bis: '2999-12-31' });
  const files = require('../server/import/zip').readZip(a.buffer).entries.map(e => e.name);
  assert.deepStrictEqual(files.sort(), ['LISEZMOI.txt', 'archive.json', 'cle-publique.pem', 'journal.csv']);
  // restoring an older backup keeps the journal and records the event
  const backup = BK.createBackup({});
  await KS.bon({ zahlart: 'BAR', gegeben: 5, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Fusible', MENGE: 1, EINZEL: 2, MWST: 61 }] });
  BK.restoreBackup(backup.buffer);
  assert.strictEqual(FRC.liste({ typ: 'ticket' }).length, 4, 'ticket made after the backup is kept');
  assert.ok(FRC.liste({ typ: 'jet' }).some(e => e.REF === 'RESTAURATION'));
  assert.ok(FRC.verifier().ok);
  // a bon id used again after the restore: the new ticket and its own duplicate numbering
  const vor = BK.createBackup({});
  const alt = await KS.bon({ zahlart: 'BAR', gegeben: 5, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Ampoule', MENGE: 1, EINZEL: 3, MWST: 61 }] });
  FRC.duplicata(alt.bon.ID); FRC.duplicata(alt.bon.ID);
  BK.restoreBackup(vor.buffer);
  const neu = await KS.bon({ zahlart: 'BAR', gegeben: 5, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Balai', MENGE: 1, EINZEL: 4, MWST: 61 }] });
  assert.strictEqual(neu.bon.ID, alt.bon.ID, 'the restore makes the bon id free again');
  assert.ok(neu.fr.nr > alt.fr.nr, 'the receipt shows the new ticket');
  assert.strictEqual(neu.fr.signature.slice(0, 16), FRC.liste({ typ: 'ticket', limit: 1 })[0].SIG, 'signature of the latest ticket');
  assert.deepStrictEqual(FRC.duplicata(neu.bon.ID), { numero: 1 });
  assert.ok(FRC.verifier().ok);
});

test('FEC: 18 columns, balanced entries', () => {
  const r = require('../server/fr/fec').fec({ von: '2000-01-01', bis: '2999-12-31' });
  assert.match(r.filename, /^732829320FEC\d{8}\.txt$/);
  const lines = r.buffer.toString('utf8').replace(/\r\n$/, '').split('\r\n').map(l => l.split('\t'));
  assert.strictEqual(lines[0].length, 18); assert.strictEqual(lines[0][0], 'JournalCode');
  const num = s => Number(String(s).replace(',', '.'));
  const parEcriture = {};
  for (const l of lines.slice(1)) { assert.strictEqual(l.length, 18); parEcriture[l[2]] = (parEcriture[l[2]] || 0) + num(l[11]) - num(l[12]); }
  for (const [n, s] of Object.entries(parEcriture)) assert.ok(Math.abs(s) < 0.005, `${n} unbalanced ${s}`);
  const nr = String(VG.load('rechnung', rid).kopf.RECHNUNGNUMMER);
  const ve = lines.filter(l => l[0] === 'VE' && l[8] === nr);
  assert.deepStrictEqual(ve.map(l => [l[4], l[11], l[12]]), [['411000', '194,00', '0,00'], ['706000', '0,00', '100,00'], ['707000', '0,00', '20,00'], ['467000', '0,00', '50,00'], ['445710', '0,00', '24,00']]);
});

test('Chorus Pro: token, deposit, report', async () => {
  const calls = [];
  CH._setTransporte(async (method, url, headers, body) => {
    calls.push({ url, headers, body });
    if (url.endsWith('/api/oauth/token')) return { status: 200, text: JSON.stringify({ access_token: 'TOK', expires_in: 3600 }) };
    if (url.endsWith('/deposer/flux')) return { status: 200, text: JSON.stringify({ codeRetour: 0, numeroFluxDepot: 'CPP123', dateDepot: '2026-11-10' }) };
    if (url.endsWith('/consulterCRDetaille')) return { status: 200, text: JSON.stringify({ codeRetour: 0, etatCourantFlux: 'IN_INTEGRE' }) };
    return { status: 404, text: '{}' };
  });
  await assert.rejects(() => CH.deposer(rid), /Zugangsdaten/);
  CH.guardarAcceso({ clientId: 'cid', clientSecret: 'sec', login: 'TECH_1', password: 'pw' });
  const r = await CH.deposer(rid, 'Anna');
  assert.strictEqual(r.flux, 'CPP123');
  const dep = calls.find(c => c.url.endsWith('/deposer/flux'));
  assert.strictEqual(dep.headers.Authorization, 'Bearer TOK');
  assert.strictEqual(dep.headers['cpro-account'], Buffer.from('TECH_1:pw').toString('base64'));
  const body = JSON.parse(dep.body);
  assert.strictEqual(body.syntaxeFlux, 'IN_DP_E2_CII_FACTURX');
  assert.ok(Buffer.from(body.fichierFlux, 'base64').subarray(0, 5).toString() === '%PDF-');
  assert.strictEqual((await CH.compteRendu(rid)).statut, 'IN_INTEGRE');
  CH._setTransporte(null);
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  dbm.closeAll();
});
