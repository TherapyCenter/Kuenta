'use strict';
// Dutch tax system (per tenant): btw 21 % (hoog) and 9 % (laag), small business scheme (kleineondernemersregeling,
// art. 25 Wet OB 1968), invoice requirements of art. 35a Wet OB (btw-id of the supplier; of the customer with
// reverse charge and intra-community supplies), KvK number on business documents (art. 20 Handelsregisterwet).
// The legal texts are in Dutch on purpose: they are printed as written.
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.land() === 'NL';
const kor = () => L.optNum('Kleinunternehmer', 0) === 1;
const num = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };

// tax codes 61..64 of KFZ-Faktura: 61 hoog, 62 laag, 63 vrijgesteld / 0 % / doorlopende post, 64 not used (0 %)
function tasas() { return { hoog: num('nl.btw.hoog', '21'), laag: num('nl.btw.laag', '9') }; }
function mwstRates() {
  if (kor()) return { 61: 0, 62: 0, 63: 0, 64: 0 };
  const t = tasas(); return { 61: t.hoog, 62: t.laag, 63: 0, 64: 0 };
}
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `Hoog tarief (${t.hoog} %)`, rate: t.hoog },
    { id: 62, name: `Laag tarief (${t.laag} %)`, rate: t.laag },
    { id: 63, name: 'Vrijgesteld / 0 % (0 %)', rate: 0 },
  ];
}

// btw-id of the company (field "USt-IdNr.") and KvK number (setting nl.kvk, otherwise field Handelsregister)
function btw() { const r = NIF.nlBtw(L.firma().USTNR); return r.ok ? r.btw : ''; }
function kvk() { const r = NIF.nlKvk(L.sw('nl.kvk', '') || L.firma().HANDELSREGISTER); return r.ok ? r.kvk : ''; }

function pied() {
  return [kvk() && 'KvK ' + kvk(), btw() && 'Btw-id ' + btw(), L.sw('nl.vestiging', '') && 'Vestigingsnr. ' + L.sw('nl.vestiging', '')].filter(Boolean);
}

function mentions(typ, k, pos) {
  const out = [];
  const lines = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z');
  if (kor()) out.push('Vrijgesteld van btw op grond van de kleineondernemersregeling (art. 25 Wet OB 1968).');
  else if (k.STEUERART === 'REVERSE_CHARGE') out.push('Btw verlegd.');
  else if (k.STEUERART === 'IG_LIEFERUNG') out.push('Intracommunautaire levering, 0 % btw (art. 138 Btw-richtlijn).');
  else if (k.STEUERART === 'AUSFUHR') out.push('Uitvoer, 0 % btw (art. 146 Btw-richtlijn).');
  if (lines.some(p => Number(p.DIFFSTEUER) === 1)) out.push('Bijzondere regeling – gebruikte goederen (margeregeling). Btw wordt niet apart vermeld.');
  if (lines.some(p => Number(p.DURCHLAUFER) === 1)) out.push('(DP) = Doorlopende post, betaald in naam en voor rekening van de klant (geen btw).');
  return out;
}

function pruefen(typ, k, kunde = {}) {
  const w = [];
  if (typ !== 'rechnung' && typ !== 'korrektur') return w;
  if (!btw() && !kor()) w.push('Btw-id der Firma fehlt oder ist ungültig (Einstellungen → Firmendaten → USt-IdNr., z. B. NL123456782B01).');
  if (!kvk()) w.push('KvK-Nummer der Firma fehlt (Einstellungen → Nederland).');
  if ((k.STEUERART === 'REVERSE_CHARGE' || k.STEUERART === 'IG_LIEFERUNG') && !kunde.USTID) w.push('Btw verlegd / ICL: Btw-id des Kunden fehlt.');
  return w;
}

function kundeOf(k) { return k.KUNID ? L.db().prepare('SELECT USTID, NL_KVK, NL_OIN FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {}; }

function info(typ, k, pos) {
  const kd = kundeOf(k);
  return { land: 'NL', mentions: mentions(typ, k, pos), pied: pied(), ustLabel: 'btw', uidLabel: 'Uw btw-id', warnungen: pruefen(typ, k, kd) };
}

module.exports = { activo, kor, tasas, mwstRates, mwstList, btw, kvk, pied, mentions, pruefen, kundeOf, info };
