'use strict';
// Italian tax system (per tenant): IVA 22 / 10 / 4 % (second reduced rate adjustable, e.g. 5 %), flat rate scheme
// (regime forfettario, L. 190/2014), nature codes of the exempt operations (Natura N1..N5), virtual stamp duty
// (imposta di bollo, € 2 above € 77.47 without IVA), split payment for public bodies (art. 17-ter DPR 633/72),
// company details on documents (P.IVA, C.F., REA, share capital, single shareholder, liquidation; art. 2250 c.c.).
// The legal invoice is the electronic one (FatturaPA via SdI, see fatturapa.js); the printed PDF is a courtesy copy.
// The legal texts are in Italian on purpose: they are printed as written.
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.land() === 'IT';
const forfettario = () => L.optNum('Kleinunternehmer', 0) === 1;
const num = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };

// tax codes 61..64 of KFZ-Faktura: 61 ordinary, 62 reduced (10 %), 64 second reduced rate (4 % or 5 %), 63 exempt / disbursement
function tasas() { return { ordinaria: num('it.iva.ordinaria', '22'), ridotta: num('it.iva.ridotta', '10'), ridotta2: num('it.iva.ridotta2', '4') }; }
function mwstRates() {
  if (forfettario()) return { 61: 0, 62: 0, 63: 0, 64: 0 };
  const t = tasas(); return { 61: t.ordinaria, 62: t.ridotta, 63: 0, 64: t.ridotta2 };
}
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `Aliquota ordinaria (${t.ordinaria} %)`, rate: t.ordinaria },
    { id: 62, name: `Aliquota ridotta (${t.ridotta} %)`, rate: t.ridotta },
    { id: 64, name: `Aliquota ridotta (${t.ridotta2} %)`, rate: t.ridotta2 },
    { id: 63, name: 'Esente / escluso (0 %)', rate: 0 },
  ];
}

// partita IVA of the company (field "USt-IdNr.") and codice fiscale (field "Steuernummer", empty = P.IVA)
function piva() { const r = NIF.itPiva(L.firma().USTNR); return r.ok ? r.piva : ''; }
function cf() { const r = NIF.itCf(L.firma().STEUERNR); return r.ok ? r.cf : piva(); }

// nature of an operation without IVA (FatturaPA, Natura) with the legal reference
const NATURA = {
  N1: 'Escluse ex art. 15 DPR 633/72',
  'N2.1': 'Non soggette ad IVA ai sensi degli artt. da 7 a 7-septies DPR 633/72',
  'N2.2': 'Non soggette – regime forfettario (art. 1, commi 54-89, L. 190/2014)',
  'N3.1': 'Non imponibili – esportazioni (art. 8, c. 1, DPR 633/72)',
  'N3.2': 'Non imponibili – cessioni intracomunitarie (art. 41 DL 331/93)',
  N4: 'Esenti (art. 10 DPR 633/72)',
  N5: 'Regime del margine – IVA non esposta in fattura (art. 36 DL 41/95)',
};
// natura of a line, null = taxable
function natura(p, k) {
  if (Number(p.DURCHLAUFER) === 1) return 'N1';
  if (forfettario()) return 'N2.2';
  if (k.STEUERART === 'REVERSE_CHARGE') return 'N2.1';
  if (k.STEUERART === 'AUSFUHR') return 'N3.1';
  if (k.STEUERART === 'IG_LIEFERUNG') return 'N3.2';
  if (Number(p.DIFFSTEUER) === 1) return 'N5';
  const rate = mwstRates()[Number(p.MWST) || 61] ?? 0;
  return rate > 0 ? null : 'N4';
}

// virtual stamp duty: € 2 on invoices with more than € 77.47 not subject to IVA (exports, intra-EU supplies and
// reverse charge are outside the stamp duty)
const BOLLO = 2, SOGLIA_BOLLO = 77.47;
function bollo(k, pos) {
  if (L.sw('it.bollo', '1') !== '1') return 0;
  const senza = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z').filter(p => ['N1', 'N2.2', 'N4'].includes(natura(p, k)))
    .reduce((s, p) => s + Math.abs(Number(p.SUMME) || 0), 0);
  return senza > SOGLIA_BOLLO ? BOLLO : 0;
}

// split payment: public bodies pay the IVA directly to the treasury
const split = kunde => Number(kunde && kunde.IT_SPLIT) === 1;

// footer: P.IVA, C.F., REA, share capital, single shareholder, liquidation
function pied() {
  const f = L.firma();
  const rea = [L.sw('it.rea.ufficio', ''), L.sw('it.rea.numero', '')].filter(Boolean).join('-');
  return [piva() && 'P.IVA IT' + piva(), cf() && cf() !== piva() && 'C.F. ' + cf(), rea && 'REA ' + rea,
    L.sw('it.capitale', '') && `Cap. soc. € ${L.sw('it.capitale', '')} i.v.`,
    L.sw('it.sociounico', '0') === '1' && 'Socio unico', L.sw('it.liquidazione', '0') === '1' && 'In liquidazione'].filter(Boolean);
}

function mentions(typ, k, pos, kunde = {}) {
  const out = [];
  const lines = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z');
  const nat = new Set(lines.map(p => natura(p, k)).filter(Boolean));
  if (nat.has('N2.2')) out.push("Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, della Legge n. 190/2014 – Regime forfettario. Operazione senza applicazione dell'IVA.");
  if (nat.has('N2.1')) out.push('Operazione non soggetta ad IVA ai sensi dell\'art. 7-ter DPR 633/72 – inversione contabile (reverse charge).');
  if (nat.has('N3.1')) out.push('Operazione non imponibile ai sensi dell\'art. 8, c. 1, DPR 633/72.');
  if (nat.has('N3.2')) out.push('Operazione non imponibile ai sensi dell\'art. 41 DL 331/93.');
  if (nat.has('N5')) out.push('Regime del margine – beni usati (art. 36 DL 41/95). IVA non esposta in fattura.');
  if (nat.has('N1')) out.push('(DP) = Spese anticipate in nome e per conto del cliente, escluse dalla base imponibile ai sensi dell\'art. 15 DPR 633/72.');
  if (nat.has('N4')) out.push('Operazione esente ai sensi dell\'art. 10 DPR 633/72.');
  if ((typ === 'rechnung' || typ === 'korrektur') && split(kunde)) out.push('Scissione dei pagamenti ai sensi dell\'art. 17-ter DPR 633/72: l\'IVA è versata dal cessionario.');
  if ((typ === 'rechnung' || typ === 'korrektur') && bollo(k, pos)) out.push('Imposta di bollo di € 2,00 assolta in modo virtuale ai sensi dell\'art. 6, c. 2, DM 17/06/2014.');
  if (typ === 'rechnung' || typ === 'korrektur') out.push("Copia di cortesia, priva di valenza fiscale ai sensi dell'art. 21 DPR 633/72. L'originale della fattura elettronica è disponibile all'indirizzo telematico da Lei comunicato oppure nella Sua area riservata del sito dell'Agenzia delle Entrate.");
  return out;
}

// mandatory data before the invoice goes to the SdI
function pruefen(typ, k, kunde = {}) {
  const w = [];
  if (typ !== 'rechnung' && typ !== 'korrektur') return w;
  if (!piva()) w.push('Partita IVA der Firma fehlt oder ist ungültig (Einstellungen → Firmendaten → USt-IdNr., 11 Ziffern).');
  if (!L.sw('it.provincia', '')) w.push('Provinz der Firma fehlt (Einstellungen → Italia, z. B. MI).');
  const estero = k.KUNLAND && k.KUNLAND !== 'IT';
  if (!estero && !NIF.itPiva(kunde.USTID).ok && !NIF.itCf(kunde.IT_CF).ok) w.push('Partita IVA oder Codice Fiscale des Kunden fehlt (Kunde → Steuer & Buchhaltung).');
  if (!estero && NIF.itPiva(kunde.USTID).ok && !kunde.IT_SDI && !kunde.IT_PEC) w.push('Codice destinatario (SdI) oder PEC des Geschäftskunden fehlt – die Rechnung geht sonst nur in sein Postfach bei der Agenzia delle Entrate.');
  return w;
}

function kundeOf(k) { return k.KUNID ? L.db().prepare('SELECT USTID, IT_CF, IT_SDI, IT_PEC, IT_SPLIT FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {}; }

// information for printing (browser and PDF)
function info(typ, k, pos) {
  const kd = kundeOf(k);
  const out = { land: 'IT', mentions: mentions(typ, k, pos, kd), pied: pied(), ustLabel: 'IVA', uidLabel: 'P.IVA cliente', warnungen: pruefen(typ, k, kd) };
  if (kd.IT_CF) out.cfCliente = kd.IT_CF;
  const b = (typ === 'rechnung' || typ === 'korrektur') ? bollo(k, pos) : 0;
  if (b) out.bollo = b;
  if ((typ === 'rechnung' || typ === 'korrektur') && split(kd)) out.split = Math.round((Number(k.GBRUTTO) - Number(k.GNETTO)) * 100) / 100;
  return out;
}

module.exports = { activo, forfettario, tasas, mwstRates, mwstList, piva, cf, NATURA, natura, bollo, BOLLO, split, pied, mentions, pruefen, kundeOf, info };
