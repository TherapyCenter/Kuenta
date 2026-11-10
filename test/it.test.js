'use strict';
// Italian tax system: partita IVA and codice fiscale, IVA rates, nature codes, texts and footer, stamp duty,
// split payment, FatturaPA (FPR12 / FPA12, TD04), IVA settlement with F24 code, sales register, Italian documents.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-it-'));
process.env.KUENTA_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const NIF = require('../public/js/nif.js');
const FPA = require('../server/it/fatturapa');
const { I18N } = require('../server/i18n');

test('partita IVA and codice fiscale', () => {
  assert.ok(NIF.itPiva('06363391001').ok);
  assert.ok(NIF.itPiva('IT 06363391001').ok);
  assert.ok(!NIF.itPiva('06363391002').ok);
  assert.ok(NIF.itCf('RSSMRA85T10A562S').ok);
  assert.ok(!NIF.itCf('RSSMRA85T10A562T').ok);
  assert.ok(NIF.itCf('06363391001').ok, 'companies: 11 digits');
});

test('Italian is a document language only', () => {
  assert.ok(I18N.LANGS.it && !I18N.UI_LANGS.it);
  assert.strictEqual(I18N.tr('Rechnung', 'it'), 'Fattura');
  assert.strictEqual(I18N.tr('zzgl. 22 % IVA auf 100,00 €', 'it'), 'IVA 22 % su 100,00 €');
  assert.strictEqual(I18N.tr('Seite 1 von 2', 'it'), 'Pagina 1 di 2');
});

let rid, kunid, kpa;
test('Italy: rates, texts, footer, stamp duty, FatturaPA', () => {
  L.setSw('steuer.land', 'IT'); L.setSw('it.provincia', 'MI'); L.setSw('it.rea.ufficio', 'MI'); L.setSw('it.rea.numero', '1234567'); L.setSw('it.capitale', '10.000,00'); L.setSw('it.sociounico', '1');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Officina Rossi S.r.l.', USTNR='06363391001', STEUERNR='', STRASSE='Via Roma 1', PLZ='20121', ORT='Milano', LAND='IT', EMAIL='info@example.it', TELEFON='02 1234567', IBAN='IT60X0542811101000000123456'").run();
  assert.deepStrictEqual(L.mwstRates(), { 61: 22, 62: 10, 63: 0, 64: 4 });
  assert.strictEqual(G.lookups().land, 'IT');
  const k = G.saveRec('kunden', null, { NAME: 'Bianchi', VORNAME: 'Luca', ART: 0, STRASSE: 'Corso Italia 5', PLZ: '10121', ORT: 'Torino (TO)', LAND: 'IT', IT_CF: 'RSSMRA85T10A562S', IT_PEC: 'luca@pec.example.it' });
  kunid = k.KUNID;
  const t = VG.template('rechnung', { kunid }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0 }, pos: [
    { POSART: 'L', BEZEICHNUNG: 'Tagliando', MENGE: 1, VK: 100, MWST: 61 },
    { POSART: 'A', BEZEICHNUNG: 'Filtro olio', MENGE: 2, VK: 10, MWST: 61, RABATT: 10 },
    { POSART: 'A', BEZEICHNUNG: 'Revisione – diritti Motorizzazione (DP)', MENGE: 1, VK: 79.02, MWST: 63, DURCHLAUFER: 1 }] });
  rid = r.kopf.RECHNUNGID;
  assert.strictEqual(r.kopf.GNETTO, 197.02);
  assert.strictEqual(r.kopf.GBRUTTO, Math.round((118 * 1.22 + 79.02) * 100) / 100);
  const d = VG.load('rechnung', rid);
  assert.strictEqual(d.lx.ustLabel, 'IVA');
  assert.strictEqual(d.lx.cfCliente, 'RSSMRA85T10A562S');
  assert.deepStrictEqual(d.lx.pied, ['P.IVA IT06363391001', 'REA MI-1234567', 'Cap. soc. € 10.000,00 i.v.', 'Socio unico']);
  assert.strictEqual(d.lx.bollo, 2, 'more than 77.47 € without IVA');
  assert.ok(d.lx.mentions.some(m => /art. 15 DPR 633\/72/.test(m)));
  assert.ok(d.lx.mentions.some(m => /bollo/.test(m)));
  assert.ok(d.lx.mentions.some(m => /^Copia di cortesia/.test(m)));
  assert.deepStrictEqual(d.lx.warnungen, []);
  // FatturaPA FPR12 to a consumer with PEC
  const f = FPA.create(rid);
  assert.deepStrictEqual(f.problems, []);
  assert.match(f.filename, /^IT06363391001_[0-9A-Z]{5}\.xml$/);
  const x = f.xml;
  assert.match(x, /<p:FatturaElettronica versione="FPR12"/);
  assert.match(x, /<CodiceDestinatario>0000000<\/CodiceDestinatario>.*<PECDestinatario>luca@pec\.example\.it<\/PECDestinatario>/);
  assert.match(x, /<RegimeFiscale>RF01<\/RegimeFiscale>/);
  assert.match(x, /<Provincia>MI<\/Provincia>/);
  assert.match(x, /<IscrizioneREA><Ufficio>MI<\/Ufficio><NumeroREA>1234567<\/NumeroREA><CapitaleSociale>10000\.00<\/CapitaleSociale><SocioUnico>SU<\/SocioUnico><StatoLiquidazione>LN<\/StatoLiquidazione><\/IscrizioneREA>/);
  assert.match(x, /<CodiceFiscale>RSSMRA85T10A562S<\/CodiceFiscale><Anagrafica><Nome>Luca<\/Nome><Cognome>Bianchi<\/Cognome><\/Anagrafica>/);
  assert.match(x, /<Comune>Torino<\/Comune><Provincia>TO<\/Provincia>/);
  assert.match(x, /<DatiBollo><BolloVirtuale>SI<\/BolloVirtuale><ImportoBollo>2\.00<\/ImportoBollo><\/DatiBollo>/);
  assert.match(x, /<Quantita>2\.00<\/Quantita><PrezzoUnitario>10\.00<\/PrezzoUnitario><ScontoMaggiorazione><Tipo>SC<\/Tipo><Percentuale>10\.00<\/Percentuale><\/ScontoMaggiorazione><PrezzoTotale>18\.00<\/PrezzoTotale><AliquotaIVA>22\.00<\/AliquotaIVA>/);
  assert.match(x, /<DatiRiepilogo><AliquotaIVA>22\.00<\/AliquotaIVA><ImponibileImporto>118\.00<\/ImponibileImporto><Imposta>25\.96<\/Imposta><EsigibilitaIVA>I<\/EsigibilitaIVA><\/DatiRiepilogo>/);
  assert.match(x, /<DatiRiepilogo><AliquotaIVA>0\.00<\/AliquotaIVA><Natura>N1<\/Natura><ImponibileImporto>79\.02<\/ImponibileImporto><Imposta>0\.00<\/Imposta><RiferimentoNormativo>Escluse ex art\. 15 DPR 633\/72<\/RiferimentoNormativo><\/DatiRiepilogo>/);
  assert.match(x, /<ImportoTotaleDocumento>222\.98<\/ImportoTotaleDocumento>/);
  assert.match(x, /<ModalitaPagamento>MP05<\/ModalitaPagamento>.*<ImportoPagamento>222\.98<\/ImportoPagamento>.*<IBAN>IT60X0542811101000000123456<\/IBAN>/);
  assert.match(x, /Revisione - diritti/, 'en dash replaced (Latin-1 only)');
  assert.ok(!/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/.test(x), 'only Basic Latin and Latin-1');
  // printed invoices are locked
  VG.setFlag('rechnung', [rid], 'GEDRUCKT', 1);
  assert.throws(() => VG.save('rechnung', { kopf: VG.load('rechnung', rid).kopf, pos: r.pos }), /gesperrt/);
  // PDF in Italian
  L.setSw('beleg.sprache', 'it');
  const pdf = require('../server/pdf/belege').vorgangPdf('rechnung', d);
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
  L.setSw('beleg.sprache', 'de');
});

test('public body: FPA12, split payment, credit note TD04', () => {
  const k = G.saveRec('kunden', null, { NAME: 'Comune di Bergamo', ART: 1, USTID: 'IT00218930163', STRASSE: 'Piazza Matteotti 27', PLZ: '24122', ORT: 'Bergamo BG', LAND: 'IT', IT_SDI: 'UFABCD', IT_SPLIT: 1 });
  kpa = k.KUNID;
  const t = VG.template('rechnung', { kunid: kpa }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, BESTELLNR: 'ODA-77' }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Manutenzione automezzo', MENGE: 1, VK: 500, MWST: 61 }] });
  const d = VG.load('rechnung', r.kopf.RECHNUNGID);
  assert.strictEqual(d.lx.split, 110);
  assert.ok(d.lx.mentions.some(m => /17-ter/.test(m)));
  const x = FPA.create(r.kopf.RECHNUNGID).xml;
  assert.match(x, /versione="FPA12"/);
  assert.match(x, /<CodiceDestinatario>UFABCD<\/CodiceDestinatario>/);
  assert.match(x, /<IdFiscaleIVA><IdPaese>IT<\/IdPaese><IdCodice>00218930163<\/IdCodice><\/IdFiscaleIVA><Anagrafica><Denominazione>Comune di Bergamo<\/Denominazione>/);
  assert.match(x, /<EsigibilitaIVA>S<\/EsigibilitaIVA>/);
  assert.match(x, /<DatiOrdineAcquisto><IdDocumento>ODA-77<\/IdDocumento><\/DatiOrdineAcquisto>/);
  assert.match(x, /<ImportoPagamento>500\.00<\/ImportoPagamento>/, 'the public body pays the net amount');
  // credit note
  const st = VG.storno(r.kopf.RECHNUNGID);
  const c = FPA.create(st.id).xml;
  assert.match(c, /<TipoDocumento>TD04<\/TipoDocumento>/);
  assert.match(c, /<PrezzoTotale>500\.00<\/PrezzoTotale>/, 'positive amounts');
  assert.match(c, new RegExp(`<DatiFattureCollegate><IdDocumento>${r.kopf.RECHNUNGNUMMER}</IdDocumento>`));
  assert.ok(!/<DatiPagamento>/.test(c));
});

test('regime forfettario and foreign customer', () => {
  L.setOpt('Kleinunternehmer', '1');
  assert.strictEqual(L.mwstRates()[61], 0);
  const IT = require('../server/it');
  assert.strictEqual(IT.natura({ MWST: 61 }, {}), 'N2.2');
  assert.ok(IT.mentions('rechnung', {}, [{ POSART: 'L', MWST: 61 }]).some(m => /Regime forfettario/.test(m)));
  L.setOpt('Kleinunternehmer', '0');
  const k = G.saveRec('kunden', null, { NAME: 'Autohaus Huber GmbH', ART: 1, USTID: 'ATU13585627', STRASSE: 'Hauptstraße 1', PLZ: '4020', ORT: 'Linz', LAND: 'AT' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, ANSICHTBRUTTO: 0, STEUERART: 'IG_LIEFERUNG' }, pos: [{ POSART: 'A', BEZEICHNUNG: 'Ricambio', MENGE: 1, VK: 300, MWST: 61 }] });
  const x = FPA.create(r.kopf.RECHNUNGID).xml;
  assert.match(x, /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario>/);
  assert.match(x, /<IdFiscaleIVA><IdPaese>AT<\/IdPaese><IdCodice>U13585627<\/IdCodice><\/IdFiscaleIVA>/);
  assert.match(x, /<CAP>00000<\/CAP><Comune>Linz<\/Comune><Nazione>AT<\/Nazione>/);
  assert.match(x, /<Natura>N3\.2<\/Natura>/);
  assert.ok(!/<DatiBollo>/.test(x), 'no stamp duty on intra-EU supplies');
});

test('IVA settlement, F24 code, register, receipt', async () => {
  const IVA = require('../server/it/iva');
  const r = IVA.liquidazione({ von: '2000-01-01', bis: '2999-12-31' });
  assert.ok(r.split >= 0, 'split payment IVA (the credit note cancels it out)');
  assert.strictEqual(r.debito, Math.round((r.aliquote.reduce((s, a) => s + a.imposta, 0) - r.split) * 100) / 100);
  assert.strictEqual(IVA.codiceTributo('2026-03-01').codice, '6003');
  L.setSw('it.liquidazione.periodo', 'trimestrale');
  assert.strictEqual(IVA.codiceTributo('2026-04-01').codice, '6032');
  assert.strictEqual(IVA.codiceTributo('2026-10-01').codice, '6099');
  const q = IVA.liquidazione({ von: '2026-01-01', bis: '2026-03-31' });
  assert.strictEqual(q.interessi, q.saldo > 0 ? Math.round(q.saldo) / 100 : 0);
  const csv = IVA.registro({ von: '2000-01-01', bis: '2999-12-31' }).buffer.toString('utf8');
  assert.match(csv, /^﻿Data;Numero;Tipo;Cliente/);
  assert.match(csv, /TD04/);
  // register: every sale is an invoice
  const KS = require('../server/api/kasse');
  const b = await KS.bon({ zahlart: 'BAR', gegeben: 50, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Lampadina', MENGE: 1, EINZEL: 12.2, MWST: 61 }] });
  assert.ok(b.bon.RECHNUNGID, 'invoice created for the sale');
  assert.strictEqual(KS.status().autorechnung, true);
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  dbm.closeAll();
});
