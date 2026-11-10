'use strict';
// Luxembourg tax system (per tenant): TVA 17 / 14 / 8 % (the third rate adjustable, e.g. 3 %), franchise of small
// businesses (art. 57 LTVA), invoice requirements of art. 63 LTVA (VAT number of the supplier; of the customer with
// reverse charge and intra-community supplies), RCS number and business permit on business documents.
// Legal texts in French, or in German with the document language German. Invoices to public bodies go through
// Peppol (see ../peppol.js), the VAT return through eCDF (tva.js).
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.land() === 'LU';
const franchise = () => L.optNum('Kleinunternehmer', 0) === 1;
const num = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };
const de = () => L.sw('beleg.sprache', 'de') === 'de';

// tax codes 61..64 of KFZ-Faktura: 61 17 %, 62 8 %, 64 14 %, 63 exempt / 0 % / disbursement
function tasas() { return { normal: num('lu.tva.normal', '17'), reduit: num('lu.tva.reduit', '8'), intermediaire: num('lu.tva.intermediaire', '14') }; }
function mwstRates() {
  if (franchise()) return { 61: 0, 62: 0, 63: 0, 64: 0 };
  const t = tasas(); return { 61: t.normal, 62: t.reduit, 63: 0, 64: t.intermediaire };
}
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `Taux normal (${t.normal} %)`, rate: t.normal },
    { id: 64, name: `Taux intermédiaire (${t.intermediaire} %)`, rate: t.intermediaire },
    { id: 62, name: `Taux réduit (${t.reduit} %)`, rate: t.reduit },
    { id: 63, name: 'Exonéré / débours (0 %)', rate: 0 },
  ];
}

// VAT number of the company (field "USt-IdNr.")
function tva() { const r = NIF.luTva(L.firma().USTNR); return r.ok ? r : null; }

function pied() {
  const t = tva(); const f = L.firma();
  return [t && 'TVA ' + t.tva, (L.sw('lu.rcs', '') || f.HANDELSREGISTER) && 'RCS ' + (L.sw('lu.rcs', '') || f.HANDELSREGISTER),
    L.sw('lu.autorisation', '') && (de() ? 'Niederlassungsgenehmigung ' : 'Autorisation d\'établissement ') + L.sw('lu.autorisation', '')].filter(Boolean);
}

const TEXT = {
  franchise: ['TVA non applicable – régime de franchise des petites entreprises (art. 57 de la loi TVA).', 'Keine Mehrwertsteuer – Steuerbefreiung für Kleinunternehmen (Art. 57 MwSt-Gesetz).'],
  autoliquidation: ['Autoliquidation – TVA due par le preneur (art. 196 de la directive 2006/112/CE).', 'Steuerschuldnerschaft des Leistungsempfängers (Art. 196 der Richtlinie 2006/112/EG).'],
  icl: ['Livraison intracommunautaire exonérée (art. 43, § 1, d) de la loi TVA).', 'Steuerfreie innergemeinschaftliche Lieferung (Art. 43 Abs. 1 Buchst. d MwSt-Gesetz).'],
  export: ['Exportation exonérée (art. 43, § 1, a) de la loi TVA).', 'Steuerfreie Ausfuhr (Art. 43 Abs. 1 Buchst. a MwSt-Gesetz).'],
  marge: ['Régime particulier – biens d\'occasion (art. 56bis de la loi TVA). TVA non déductible.', 'Sonderregelung – Gebrauchtgegenstände (Art. 56bis MwSt-Gesetz). Keine abziehbare Mehrwertsteuer.'],
  debours: ['(DP) = Débours exposés au nom et pour compte du client (art. 28, § 3, c) de la loi TVA).', '(DP) = Auslagen im Namen und für Rechnung des Kunden (Art. 28 Abs. 3 Buchst. c MwSt-Gesetz).'],
};
const t = k => TEXT[k][de() ? 1 : 0];

function mentions(typ, k, pos) {
  const out = [];
  const lines = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z');
  if (franchise()) out.push(t('franchise'));
  else if (k.STEUERART === 'REVERSE_CHARGE') out.push(t('autoliquidation'));
  else if (k.STEUERART === 'IG_LIEFERUNG') out.push(t('icl'));
  else if (k.STEUERART === 'AUSFUHR') out.push(t('export'));
  if (lines.some(p => Number(p.DIFFSTEUER) === 1)) out.push(t('marge'));
  if (lines.some(p => Number(p.DURCHLAUFER) === 1)) out.push(t('debours'));
  return out;
}

function pruefen(typ, k, kunde = {}) {
  const w = [];
  if (typ !== 'rechnung' && typ !== 'korrektur') return w;
  if (!tva()) w.push('TVA-Nummer der Firma fehlt oder ist ungültig (Einstellungen → Firmendaten → USt-IdNr., z. B. LU15027442).');
  if ((k.STEUERART === 'REVERSE_CHARGE' || k.STEUERART === 'IG_LIEFERUNG') && !kunde.USTID) w.push('Autoliquidation / ICL: USt-IdNr. des Kunden fehlt.');
  return w;
}

function kundeOf(k) { return k.KUNID ? L.db().prepare('SELECT USTID, NL_KVK, NL_OIN FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {}; }

function info(typ, k, pos) {
  const kd = kundeOf(k);
  return { land: 'LU', mentions: mentions(typ, k, pos), pied: pied(), ustLabel: de() ? 'MwSt' : 'TVA', uidLabel: de() ? 'Ihre USt-IdNr.' : 'Votre n° TVA', warnungen: pruefen(typ, k, kd) };
}

module.exports = { activo, franchise, tasas, mwstRates, mwstList, tva, pied, mentions, pruefen, kundeOf, info, de };
