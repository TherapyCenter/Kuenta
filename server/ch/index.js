'use strict';
// Swiss tax system (per tenant): MWST rates 8.1 / 2.6 / 3.8 % (since 2024), amounts in Swiss francs,
// MWST number on invoices (Art. 26 MWSTG), businesses below the turnover limit are not MWST-registered,
// QR-bill with payment part on invoices (see qrbill.js), cash rounding to 5 centimes.
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.land() === 'CH';
// not registered for MWST (turnover below CHF 100 000): no MWST on invoices
const nichtPflichtig = () => L.optNum('Kleinunternehmer', 0) === 1;
const num = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };

// tax codes 61..64 of KFZ-Faktura: 61 normal rate, 62 reduced rate, 64 accommodation, 63 exempt / disbursement
function tasas() { return { normal: num('ch.mwst.normal', '8.1'), reduziert: num('ch.mwst.reduziert', '2.6'), beherbergung: num('ch.mwst.beherbergung', '3.8') }; }
function mwstRates() {
  if (nichtPflichtig()) return { 61: 0, 62: 0, 63: 0, 64: 0 };
  const t = tasas(); return { 61: t.normal, 62: t.reduziert, 63: 0, 64: t.beherbergung };
}
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `Normalsatz (${t.normal} %)`, rate: t.normal },
    { id: 62, name: `reduzierter Satz (${t.reduziert} %)`, rate: t.reduziert },
    { id: 64, name: `Sondersatz Beherbergung (${t.beherbergung} %)`, rate: t.beherbergung },
    { id: 63, name: 'von der Steuer ausgenommen / befreit (0 %)', rate: 0 },
  ];
}

// UID of the company (field "USt-IdNr."), shown as MWST number "CHE-123.456.789 MWST"
function uid() { const r = NIF.chUid(L.firma().USTNR); return r.ok ? r.uid : ''; }
const mwstNr = () => (uid() ? uid() + ' MWST' : '');

function pied() {
  // the commercial register (field Handelsregister) follows in the footer
  return [!nichtPflichtig() && mwstNr() ? 'MWST-Nr.: ' + mwstNr() : (uid() ? 'UID: ' + uid() : '')].filter(Boolean);
}

function mentions(typ, k, pos) {
  const out = [];
  const lines = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z');
  if (!nichtPflichtig()) {
    if (k.STEUERART === 'AUSFUHR' || k.STEUERART === 'IG_LIEFERUNG') out.push('Von der Steuer befreite Ausfuhr (Art. 23 Abs. 2 Ziff. 1 MWSTG).');
    else if (k.STEUERART === 'REVERSE_CHARGE') out.push('Ort der Leistung im Ausland (Art. 8 MWSTG): nicht der Schweizer MWST unterstellt.');
  }
  if (lines.some(p => Number(p.DIFFSTEUER) === 1)) out.push('Margenbesteuerung (Art. 24a MWSTG). Die MWST wird nicht offen ausgewiesen.');
  if (lines.some(p => Number(p.DURCHLAUFER) === 1)) out.push('(DP) = Durchlaufender Posten (Art. 24 Abs. 6 Bst. b MWSTG), nicht Teil des Entgelts.');
  return out;
}

function pruefen(typ) {
  const w = [];
  if ((typ === 'rechnung' || typ === 'korrektur') && !nichtPflichtig() && !uid()) w.push('MWST-Nummer der Firma fehlt oder ist ungültig (Einstellungen → Firmendaten → USt-IdNr., Format CHE-123.456.789).');
  return w;
}

// cash rounding: amounts paid in cash are rounded to 5 centimes
const rappen = v => Math.round(Math.round(Number(v) * 100) / 5) * 5 / 100;

function info(typ, k, pos, offen) {
  const out = { land: 'CH', mentions: mentions(typ, k, pos), pied: pied(), ustLabel: 'MWST', uidLabel: 'Ihre UID / MWST-Nr.', warnungen: pruefen(typ) };
  if (typ === 'rechnung' && L.sw('ch.qr.aktiv', '1') === '1') {
    try { out.qr = require('./qrbill').daten(k, offen ?? k.GBRUTTO); } catch (e) { out.warnungen.push('QR-Rechnung: ' + e.message); }
  }
  return out;
}

module.exports = { activo, nichtPflichtig, tasas, mwstRates, mwstList, uid, mwstNr, pied, mentions, pruefen, rappen, info };
