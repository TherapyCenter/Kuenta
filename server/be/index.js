'use strict';
// Belgian tax system (per tenant): btw / TVA 21 / 12 / 6 %, small business exemption (vrijstellingsregeling /
// régime de franchise, art. 56bis WBTW / Code TVA), invoice requirements of the royal decree no. 1 (enterprise
// number, RPR/RPM and seat on business documents, art. III.25 WER / CDE), legal texts in Dutch or in French
// depending on the document language. Since 2026 invoices between businesses go through Peppol (see ../nl/peppol.js).
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.land() === 'BE';
const franchise = () => L.optNum('Kleinunternehmer', 0) === 1;
const num = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };
const fr = () => L.sw('beleg.sprache', 'de') === 'fr';

// tax codes 61..64 of KFZ-Faktura: 61 21 %, 62 6 %, 64 12 %, 63 exempt / 0 % / disbursement
function tasas() { return { normaal: num('be.btw.normaal', '21'), verlaagd: num('be.btw.verlaagd', '6'), tussen: num('be.btw.tussen', '12') }; }
function mwstRates() {
  if (franchise()) return { 61: 0, 62: 0, 63: 0, 64: 0 };
  const t = tasas(); return { 61: t.normaal, 62: t.verlaagd, 63: 0, 64: t.tussen };
}
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `Normaal tarief / taux normal (${t.normaal} %)`, rate: t.normaal },
    { id: 64, name: `Tussentarief / taux intermédiaire (${t.tussen} %)`, rate: t.tussen },
    { id: 62, name: `Verlaagd tarief / taux réduit (${t.verlaagd} %)`, rate: t.verlaagd },
    { id: 63, name: 'Vrijgesteld / exonéré (0 %)', rate: 0 },
  ];
}

// enterprise number of the company (field "USt-IdNr." or "Steuernummer")
function ondernemingsnr() { const f = L.firma(); for (const v of [f.USTNR, f.STEUERNR]) { const r = NIF.beNr(v); if (r.ok) return r; } return null; }

function pied() {
  const o = ondernemingsnr(); const rpr = L.sw('be.rpr', '');
  // also under the franchise the business keeps its VAT number (BE + enterprise number)
  return [o && (fr() ? 'TVA ' : 'Btw ') + 'BE ' + o.anzeige,
    rpr && (fr() ? 'RPM ' : 'RPR ') + rpr].filter(Boolean);
}

const TEKST = {
  franchise: ['Bijzondere vrijstellingsregeling kleine ondernemingen (art. 56bis WBTW).', 'Régime particulier de franchise des petites entreprises (art. 56bis du Code TVA).'],
  verlegd: ['Btw verlegd – verlegging van heffing (art. 196 Richtlijn 2006/112/EG).', 'Autoliquidation – TVA due par le preneur (art. 196 de la directive 2006/112/CE).'],
  icl: ['Vrijgestelde intracommunautaire levering (art. 39bis WBTW).', 'Livraison intracommunautaire exemptée (art. 39bis du Code TVA).'],
  uitvoer: ['Vrijgestelde uitvoer (art. 39 WBTW).', 'Exportation exemptée (art. 39 du Code TVA).'],
  marge: ['Bijzondere regeling – gebruikte goederen (art. 58, § 4 WBTW). Btw niet aftrekbaar.', 'Régime particulier – biens d\'occasion (art. 58, § 4 du Code TVA). TVA non déductible.'],
  dp: ['(DP) = Uitgaven gedaan in naam en voor rekening van de klant (art. 28, 5° WBTW).', '(DP) = Débours exposés au nom et pour compte du client (art. 28, 5° du Code TVA).'],
};
const t = k => TEKST[k][fr() ? 1 : 0];

function mentions(typ, k, pos) {
  const out = [];
  const lines = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z');
  if (franchise()) out.push(t('franchise'));
  else if (k.STEUERART === 'REVERSE_CHARGE') out.push(t('verlegd'));
  else if (k.STEUERART === 'IG_LIEFERUNG') out.push(t('icl'));
  else if (k.STEUERART === 'AUSFUHR') out.push(t('uitvoer'));
  if (lines.some(p => Number(p.DIFFSTEUER) === 1)) out.push(t('marge'));
  if (lines.some(p => Number(p.DURCHLAUFER) === 1)) out.push(t('dp'));
  return out;
}

function pruefen(typ, k, kunde = {}) {
  const w = [];
  if (typ !== 'rechnung' && typ !== 'korrektur') return w;
  if (!ondernemingsnr()) w.push('Ondernemingsnummer der Firma fehlt oder ist ungültig (Einstellungen → Firmendaten → USt-IdNr., z. B. BE0123456749).');
  if (!L.sw('be.rpr', '')) w.push('RPR/RPM (Rechtsgebiet des Unternehmensgerichts) fehlt (Einstellungen → België / Belgique).');
  if ((k.STEUERART === 'REVERSE_CHARGE' || k.STEUERART === 'IG_LIEFERUNG') && !kunde.USTID) w.push('Verlegging / ICL: USt-IdNr. des Kunden fehlt.');
  return w;
}

function kundeOf(k) { return k.KUNID ? L.db().prepare('SELECT USTID, NL_KVK, NL_OIN FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {}; }

function info(typ, k, pos) {
  const kd = kundeOf(k);
  return { land: 'BE', mentions: mentions(typ, k, pos), pied: pied(), ustLabel: fr() ? 'TVA' : 'btw', uidLabel: fr() ? 'Votre n° TVA' : 'Uw btw-nummer', warnungen: pruefen(typ, k, kd) };
}

module.exports = { activo, franchise, tasas, mwstRates, mwstList, ondernemingsnr, pied, mentions, pruefen, kundeOf, info, fr };
