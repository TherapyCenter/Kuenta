'use strict';
// Austrian tax system (per tenant): USt rates 20 / 10 / 13 %, small business exemption (§ 6 Abs. 1 Z 27 UStG),
// invoice requirements of § 11 UStG (UID of the seller; UID of the customer above 10 000 € gross),
// business letter details of § 14 UGB (legal form, seat, company register number and court).
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.land() === 'AT';
const klein = () => L.optNum('Kleinunternehmer', 0) === 1;
const num = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };

// tax codes 61..64 of KFZ-Faktura: 61 normal, 62 reduced (10 %), 64 second reduced rate (13 %), 63 exempt / disbursement
function tasas() { return { normal: num('at.ust.normal', '20'), ermaessigt: num('at.ust.ermaessigt', '10'), ermaessigt2: num('at.ust.ermaessigt2', '13') }; }
function mwstRates() {
  if (klein()) return { 61: 0, 62: 0, 63: 0, 64: 0 };
  const t = tasas(); return { 61: t.normal, 62: t.ermaessigt, 63: 0, 64: t.ermaessigt2 };
}
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `Normalsteuersatz (${t.normal} %)`, rate: t.normal },
    { id: 62, name: `ermäßigter Steuersatz (${t.ermaessigt} %)`, rate: t.ermaessigt },
    { id: 64, name: `ermäßigter Steuersatz (${t.ermaessigt2} %)`, rate: t.ermaessigt2 },
    { id: 63, name: 'steuerfrei / durchlaufend (0 %)', rate: 0 },
  ];
}

// UID of the company (field "USt-IdNr." of the company data)
function uid() { const r = NIF.atUid(L.firma().USTNR); return r.ok ? r.uid : ''; }
// tax office and tax number (9 digits: 2 digits tax office + 7 digits) for FinanzOnline
function fastnr() { return String(L.firma().STEUERNR || '').replace(/\D/g, ''); }

// footer: UID, tax number, legal form, seat, company register number and court (§ 14 UGB)
function pied() {
  const f = L.firma();
  const fb = [L.sw('at.fn', ''), L.sw('at.gericht', '')].filter(Boolean).join(', ');
  return [f.USTNR && 'UID: ' + f.USTNR, f.STEUERNR && 'St.-Nr.: ' + f.STEUERNR,
    [L.sw('at.rechtsform', ''), L.sw('at.sitz', '') && 'Sitz ' + L.sw('at.sitz', '')].filter(Boolean).join(', '),
    fb && 'Firmenbuch: ' + fb].filter(Boolean); // otherwise the field Handelsregister follows in the footer
}

// texts on a document
function mentions(typ, k, pos) {
  const out = [];
  const lines = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z');
  if (klein()) out.push('Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.');
  else if (k.STEUERART === 'REVERSE_CHARGE') out.push('Die Steuerschuld geht auf den Leistungsempfänger über (Reverse Charge, Art. 196 MwSt-RL).');
  else if (k.STEUERART === 'IG_LIEFERUNG') out.push('Steuerfreie innergemeinschaftliche Lieferung gemäß Art. 6 Abs. 1 UStG.');
  else if (k.STEUERART === 'AUSFUHR') out.push('Steuerfreie Ausfuhrlieferung gemäß § 6 Abs. 1 Z 1 i. V. m. § 7 UStG.');
  if (lines.some(p => Number(p.DIFFSTEUER) === 1)) out.push('Differenzbesteuerung gemäß § 24 UStG. Die Umsatzsteuer wird nicht gesondert ausgewiesen.');
  if (lines.some(p => Number(p.DURCHLAUFER) === 1)) out.push('(DP) = Durchlaufender Posten gemäß § 4 Abs. 3 UStG, nicht umsatzsteuerpflichtig.');
  return out;
}

// checks of § 11 UStG before an invoice leaves KuentaPOS
function pruefen(typ, k, kunde = {}) {
  const w = [];
  if (typ !== 'rechnung' && typ !== 'korrektur') return w;
  if (!klein() && !uid()) w.push('UID-Nummer der Firma fehlt oder ist ungültig (Einstellungen → Firmendaten → USt-IdNr.).');
  const brutto = Math.abs(Number(k.GBRUTTO) || 0);
  const unternehmer = Number(k.KUNART) === 1 || !!kunde.USTID;
  if (brutto > 10000 && unternehmer && !kunde.USTID) w.push('Rechnung über 10.000 € brutto an ein Unternehmen: die UID-Nummer des Kunden ist Pflicht (§ 11 Abs. 1 Z 3 lit. i UStG).');
  if ((k.STEUERART === 'REVERSE_CHARGE' || k.STEUERART === 'IG_LIEFERUNG') && !kunde.USTID) w.push('Reverse Charge / innergemeinschaftliche Lieferung: UID-Nummer des Kunden fehlt.');
  return w;
}

// information for printing (browser and PDF)
function info(typ, k, pos) {
  const kd = k.KUNID ? L.db().prepare('SELECT USTID FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {};
  return { land: 'AT', mentions: mentions(typ, k, pos), pied: pied(), ustLabel: 'USt', uidLabel: 'Ihre UID-Nr.', warnungen: pruefen(typ, k, kd) };
}

module.exports = { activo, klein, tasas, mwstRates, mwstList, uid, fastnr, pied, mentions, pruefen, info };
