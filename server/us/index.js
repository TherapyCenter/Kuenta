'use strict';
// US tax system (per tenant): sales tax instead of VAT. The shop sells at its own location, so one combined
// rate (state + county + city) applies; labor and fees can be non-taxable depending on the state.
// Customers with a resale or exemption certificate are tax exempt. Amounts in US dollars.
const L = require('../lib');

const activo = () => L.sw('steuer.land', 'DE') === 'US';
const num = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };

// tax codes 61..64 of KFZ-Faktura: 61 taxable, 62 taxable at a second rate, 63/64 non-taxable
function tasas() { return { rate: num('us.tax.rate', '0'), rate2: num('us.tax.rate2', '0') }; }
function mwstRates() { const t = tasas(); return { 61: t.rate, 62: t.rate2, 63: 0, 64: 0 }; }
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `Taxable (${t.rate} %)`, rate: t.rate },
    { id: 62, name: `Taxable, second rate (${t.rate2} %)`, rate: t.rate2 },
    { id: 63, name: 'Non-taxable (0 %)', rate: 0 },
  ];
}
const laborTaxable = () => L.sw('us.labor.taxable', '0') === '1';
const feesTaxable = () => L.sw('us.fees.taxable', '0') === '1';

module.exports = { activo, tasas, mwstRates, mwstList, laborTaxable, feesTaxable };
