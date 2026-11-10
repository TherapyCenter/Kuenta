'use strict';
// UK tax system (per tenant): VAT rates and categories, VAT registration number, schemes.
// Switched on with the setting steuer.land = GB. Amounts are in pounds sterling (GBP).
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.sw('steuer.land', 'DE') === 'GB';
const registrado = () => L.optNum('Kleinunternehmer', 0) !== 1; // below the threshold = not VAT registered

// tax codes 61..64 of KFZ-Faktura: 61 standard, 62 reduced, 64 zero-rated, 63 exempt / outside the scope
function tasas() {
  const n = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };
  return { standard: n('gb.vat.standard', '20'), reduced: n('gb.vat.reduced', '5') };
}
function mwstRates() {
  if (!registrado()) return { 61: 0, 62: 0, 63: 0, 64: 0 };
  const t = tasas(); return { 61: t.standard, 62: t.reduced, 63: 0, 64: 0 };
}
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `Standard rate (${t.standard} %)`, rate: t.standard },
    { id: 62, name: `Reduced rate (${t.reduced} %)`, rate: t.reduced },
    { id: 64, name: 'Zero rate (0 %)', rate: 0 },
    { id: 63, name: 'Exempt / outside the scope (0 %)', rate: 0 },
  ];
}

// VAT category of an invoice line: S standard, R reduced, Z zero-rated, E exempt, O outside the scope
// (disbursements, services supplied abroad), M second-hand margin scheme, N not VAT registered
function categoria(p, kopf) {
  if (!registrado()) return 'N';
  if (Number(p.DURCHLAUFER) === 1) return 'O';
  if (Number(p.DIFFSTEUER) === 1) return 'M';
  if (kopf && kopf.STEUERART === 'REVERSE_CHARGE') return 'O';
  if (kopf && kopf.STEUERART) return 'Z'; // export of goods
  const code = Number(p.MWST) || 61;
  return code === 61 ? 'S' : code === 62 ? 'R' : code === 64 ? 'Z' : 'E';
}

// VAT scheme: standard (invoice basis), cash accounting or flat rate
const schema = () => ['cash', 'flat'].includes(L.sw('gb.schema', 'standard')) ? L.sw('gb.schema') : 'standard';
const flatRate = () => Number(String(L.sw('gb.flatrate', '8.5')).replace(',', '.')) || 0;

// VAT registration number of the business (9 digits, without "GB")
function vrn() {
  const f = L.firma();
  for (const v of [f.USTNR, f.STEUERNR]) { const r = NIF.gbVat(v); if (r.ok) return r.vrn; }
  return '';
}

module.exports = { activo, registrado, tasas, mwstRates, mwstList, categoria, schema, flatRate, vrn };
