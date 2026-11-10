'use strict';
// French tax system (per tenant): TVA rates, franchise en base, legal mentions on invoices (art. 242 nonies A
// annexe II CGI, art. L441-9 and L441-10 Code de commerce), seller identification (SIREN/SIRET, RCS, capital).
// The legal mentions are in French on purpose: they are printed as written.
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.sw('steuer.land', 'DE') === 'FR';
const franchise = () => L.optNum('Kleinunternehmer', 0) === 1; // franchise en base de TVA (art. 293 B CGI)
const num = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };

// tax codes 61..64 of KFZ-Faktura: 61 normal, 62 intermediate, 64 reduced, 63 exempt / disbursement
function tasas() { return { normal: num('fr.tva.normal', '20'), intermediaire: num('fr.tva.intermediaire', '10'), reduit: num('fr.tva.reduit', '5.5') }; }
function mwstRates() {
  if (franchise()) return { 61: 0, 62: 0, 63: 0, 64: 0 };
  const t = tasas(); return { 61: t.normal, 62: t.intermediaire, 63: 0, 64: t.reduit };
}
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `TVA taux normal (${t.normal} %)`, rate: t.normal },
    { id: 62, name: `TVA taux intermédiaire (${t.intermediaire} %)`, rate: t.intermediaire },
    { id: 64, name: `TVA taux réduit (${t.reduit} %)`, rate: t.reduit },
    { id: 63, name: 'Exonéré / débours (0 %)', rate: 0 },
  ];
}

// SIRET of the business (field "Steuernummer") and SIREN (first 9 digits)
function siret() { const r = NIF.frSiren(L.firma().STEUERNR); return r.ok ? r.num : ''; }
const siren = () => siret().slice(0, 9);

// legal form, capital, RCS, SIRET, APE and VAT number for the footer
function pied() {
  const f = L.firma();
  const forme = [L.sw('fr.forme', ''), L.sw('fr.capital', '') && `au capital de ${L.sw('fr.capital', '')}`].filter(Boolean).join(' ');
  return [forme, L.sw('fr.rcs', '') || f.HANDELSREGISTER, siret() && `SIRET ${siret().replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, '$1 $2 $3 $4')}`,
    L.sw('fr.ape', '') && `APE ${L.sw('fr.ape', '')}`, f.USTNR && `TVA ${f.USTNR}`].filter(Boolean);
}

const PENALITES = "En cas de retard de paiement, des pénalités calculées à trois fois le taux d'intérêt légal sont exigibles.";
const ESCOMPTE = "Pas d'escompte pour paiement anticipé.";
const INDEMNITE = 'Indemnité forfaitaire pour frais de recouvrement : 40 € (art. L441-10 du Code de commerce).';

// mentions for a document; kunde = customer record (may be empty)
function mentions(typ, k, pos, kunde = {}) {
  const out = [];
  const lignes = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z');
  const pro = Number(k.KUNART) === 1 || !!kunde.SIREN || !!kunde.USTID;
  const facture = typ === 'rechnung' || typ === 'korrektur';
  if (facture) {
    const services = lignes.some(p => p.POSART === 'L'), biens = lignes.some(p => p.POSART !== 'L');
    out.push(`Nature des opérations : ${services && biens ? 'opérations mixtes (livraisons de biens et prestations de services)' : services ? 'prestations de services' : 'livraisons de biens'}.`);
    if (L.sw('fr.tva_debits', '0') === '1' && !franchise()) out.push("Option pour le paiement de la taxe d'après les débits.");
  }
  if (franchise()) out.push('TVA non applicable, art. 293 B du CGI.');
  else if (k.STEUERART === 'REVERSE_CHARGE') out.push('Autoliquidation – TVA due par le preneur (art. 283-2 du CGI).');
  else if (k.STEUERART === 'IG_LIEFERUNG') out.push('Exonération de TVA, article 262 ter I du CGI.');
  else if (k.STEUERART === 'AUSFUHR') out.push('Exonération de TVA, article 262 I du CGI.');
  if (lignes.some(p => Number(p.DIFFSTEUER) === 1)) out.push("Régime particulier – Biens d'occasion (art. 297 A du CGI).");
  if (lignes.some(p => Number(p.DURCHLAUFER) === 1)) out.push('(DP) = Débours, hors champ de la TVA (art. 267 II-2° du CGI).');
  if (typ === 'angebot' || typ === 'auftrag') out.push("Conformément à l'article L224-67 du Code de la consommation, vous pouvez opter pour des pièces de rechange issues de l'économie circulaire.");
  if (typ === 'rechnung') {
    out.push(L.sw('fr.escompte', ESCOMPTE));
    if (pro) out.push(L.sw('fr.penalites', PENALITES), INDEMNITE);
  }
  return out.filter(Boolean);
}

// information for printing (browser and PDF)
function info(typ, k, pos, kunde) {
  const kd = kunde || (k.KUNID ? L.db().prepare('SELECT SIREN, USTID FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {});
  return { activo: true, mentions: mentions(typ, k, pos, kd), pied: pied(), sirenClient: kd.SIREN || '' };
}

module.exports = { activo, franchise, tasas, mwstRates, mwstList, siret, siren, pied, mentions, info, PENALITES, ESCOMPTE };
